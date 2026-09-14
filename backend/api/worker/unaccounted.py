"""น้ำสูญหาย (PROMPT_06 งานที่ 1) — worker ประเมินหน้าต่างย้อนหลังทุกขอบ 5 นาที

  น้ำสูญหาย = มิเตอร์หลัก − Σ ทุกโซน − Δ ปริมาณน้ำในถังทุกใบ (รวมบ่อสำรอง)

★ สูตรเดียวกับ /api/meters/unaccounted (usage.unaccounted_water) ต่างแค่รวมตัวนับรายห้านาที
★ ตัดสินเฉพาะเมื่อข้อมูลครบ — มิเตอร์หรือถังตัวไหนไม่มีข้อมูลในหน้าต่าง = ไม่ตัดสินและเก็บ % เป็น null
  (มิเตอร์โซนหลุดตัวเดียว Σโซนจะต่ำลง แล้วเตือนรั่วปลอมทั้งโรงงาน)
★ น้ำเข้าต่ำกว่า MIN_MAIN_M3 ในหน้าต่าง = ไม่เตือน — หารด้วยเลขเล็ก การปัดเศษของเซนเซอร์ระดับทำ % แกว่งหลักร้อย
★ SQL เปิด/ปิด alert ชุดเดียวกับ ingest (เหตุเดิมกลับมาในหน้าต่างกันสแปม = เปิดแถวเดิม) notifier ส่งต่อเหมือนเหตุอื่น
"""

from __future__ import annotations

from dataclasses import dataclass

import psycopg

from .. import buckets as bk
from ..latest import publish
from ..registry import Registry
from ..series import iso, to_dt
from ..usage import unaccounted_water

KIND = "UNACCOUNTED_WATER_HIGH"
PLANT = "plant"
WINDOW_MINUTES = 60
MIN_MAIN_M3 = 1.0

IS_OPEN = "SELECT 1 FROM alerts WHERE entity_id = %(entity_id)s AND kind = %(kind)s AND ended_at IS NULL"
REOPEN = """
    UPDATE alerts SET ended_at = NULL, occurrence_count = occurrence_count + 1
     WHERE alert_id = (
       SELECT a.alert_id FROM alerts a
        WHERE a.entity_id = %(entity_id)s AND a.kind = %(kind)s AND a.ended_at IS NOT NULL
          AND a.ended_at >= %(at)s - make_interval(mins => (
                SELECT (value->>'deduplicationWindowMinutes')::int FROM settings WHERE section = 'notifications'))
          AND NOT EXISTS (SELECT 1 FROM alerts o
                           WHERE o.entity_id = a.entity_id AND o.kind = a.kind AND o.ended_at IS NULL)
        ORDER BY a.ended_at DESC LIMIT 1)"""
OPEN = """
    INSERT INTO alerts (entity_id, kind, severity, started_at, peak_value, threshold)
    VALUES (%(entity_id)s, %(kind)s, %(severity)s, %(at)s, %(peak_value)s, %(threshold)s)
    ON CONFLICT (entity_id, kind) WHERE ended_at IS NULL DO NOTHING"""
ONGOING = """
    UPDATE alerts SET severity = CASE WHEN %(severity)s = 'critical' THEN 'critical' ELSE severity END,
                      peak_value = GREATEST(peak_value, %(peak_value)s),
                      threshold = CASE WHEN %(severity)s = 'critical' THEN %(threshold)s ELSE threshold END
     WHERE entity_id = %(entity_id)s AND kind = %(kind)s AND ended_at IS NULL"""
CLOSE = """
    UPDATE alerts SET ended_at = %(at)s
     WHERE entity_id = %(entity_id)s AND kind = %(kind)s AND ended_at IS NULL AND started_at <= %(at)s"""
STORE = """
    INSERT INTO plant_metrics (time, entity_id, window_minutes, main_m3, zone_m3, storage_delta_m3, unaccounted_m3,
                               unaccounted_percent)
    VALUES (%(at)s, %(entity_id)s, %(window)s, %(main)s, %(zone)s, %(storage)s, %(unaccounted)s, %(percent)s)
    ON CONFLICT (entity_id, time) DO UPDATE SET
      window_minutes = EXCLUDED.window_minutes, main_m3 = EXCLUDED.main_m3, zone_m3 = EXCLUDED.zone_m3,
      storage_delta_m3 = EXCLUDED.storage_delta_m3, unaccounted_m3 = EXCLUDED.unaccounted_m3,
      unaccounted_percent = EXCLUDED.unaccounted_percent"""


@dataclass(frozen=True)
class Verdict:
    severity: str | None          # None = ปกติ (หรือไม่ได้ตัดสิน ดู skipped)
    skipped: str | None = None    # incomplete · low_inflow


def judge(percent: float, main_m3: float, limits: dict[str, float | None], missing: list[str]) -> Verdict:
    if missing:
        return Verdict(None, "incomplete")
    if main_m3 < MIN_MAIN_M3:
        return Verdict(None, "low_inflow")
    critical, warning = limits.get("criticalHigh"), limits.get("warningHigh")
    if critical is not None and percent >= critical:
        return Verdict("critical")
    if warning is not None and percent >= warning:
        return Verdict("warning")
    return Verdict(None)


def window_end(moment_ms: int, tz: str) -> int:
    """ตัดลงขอบ 5 นาทีตามเวลาโรงงาน — ตรงกับ bucket ของ aggregate ชั้น 5 นาที"""
    return bk.bucket_start(moment_ms, "minute_5", tz)


def missing_sources(conn: psycopg.Connection, reg: Registry, start_ms: int, end_ms: int) -> list[str]:
    meters = [str(e["entity_id"]) for e in reg.of_type("meter")]
    tanks = [str(e["entity_id"]) for e in reg.of_type("tank")]
    rows = conn.execute("""
        SELECT DISTINCT entity_id FROM meter_telemetry
         WHERE entity_id = ANY(%(meters)s) AND time >= %(start)s AND time < %(end)s AND volume_m3 IS NOT NULL
        UNION
        SELECT DISTINCT entity_id FROM tank_telemetry
         WHERE entity_id = ANY(%(tanks)s) AND time >= %(start)s AND time < %(end)s AND volume_l IS NOT NULL""",
                        {"meters": meters, "tanks": tanks, "start": to_dt(start_ms), "end": to_dt(end_ms)}).fetchall()
    seen = {row[0] for row in rows}
    return [entity_id for entity_id in meters + tanks if entity_id not in seen]


def apply_alert(conn: psycopg.Connection, verdict: Verdict, percent: float, limits: dict[str, float | None],
                at_ms: int) -> str:
    """คืน opened · ongoing · closed · normal · skipped"""
    if verdict.skipped is not None:
        return "skipped"          # ข้อมูลไม่พอ — ไม่เปิดและไม่ปิด (ปิดตอนข้อมูลหายจะทำให้เหตุที่ยังอยู่หายไปจากจอ)
    params: dict[str, object] = {"entity_id": PLANT, "kind": KIND, "at": to_dt(at_ms)}
    if verdict.severity is None:
        return "closed" if conn.execute(CLOSE, params).rowcount else "normal"
    threshold = limits.get("criticalHigh" if verdict.severity == "critical" else "warningHigh")
    values = {**params, "severity": verdict.severity, "peak_value": percent, "threshold": threshold}
    if conn.execute(IS_OPEN, params).fetchone() is not None:
        conn.execute(ONGOING, values)
        return "ongoing"
    conn.execute(REOPEN, values)
    conn.execute(OPEN, values)
    conn.execute(ONGOING, values)     # แถวที่ถูกเปิดกลับมาได้ค่าสูงสุดและระดับของรอบนี้ด้วย
    return "opened"


def evaluate(conn: psycopg.Connection, reg: Registry, end_ms: int,
             window_minutes: int = WINDOW_MINUTES) -> dict[str, object]:
    """ประเมินหน้าต่าง [end − window, end) → plant_metrics หนึ่งแถว (เวลา = ปลายหน้าต่าง) + เปิด/ปิด alert"""
    start_ms = end_ms - window_minutes * 60_000
    audit = unaccounted_water(conn, reg, start_ms, end_ms, granularity="minute_5")
    missing = missing_sources(conn, reg, start_ms, end_ms)
    limits = reg.threshold(PLANT, "unaccounted_percent")
    percent = float(audit["unaccountedPercent"])  # type: ignore[arg-type]
    verdict = judge(percent, float(audit["mainMeterCubicMeters"]), limits, missing)  # type: ignore[arg-type]
    conn.execute(STORE, {"at": to_dt(end_ms), "entity_id": PLANT, "window": window_minutes,
                         "main": audit["mainMeterCubicMeters"], "zone": audit["zoneTotalCubicMeters"],
                         "storage": audit["storageDeltaCubicMeters"],
                         "unaccounted": None if missing else audit["unaccountedCubicMeters"],
                         "percent": None if missing else percent})
    action = apply_alert(conn, verdict, percent, limits, end_ms)
    if action in ("opened", "closed"):
        publish("alerts", {"type": f"alert_{'open' if action == 'opened' else 'close'}", "entityId": PLANT,
                           "code": KIND})
    return {**audit, "windowMinutes": window_minutes, "evaluatedAt": iso(end_ms, reg.timezone), "missing": missing,
            "severity": verdict.severity, "skipped": verdict.skipped, "alert": action}
