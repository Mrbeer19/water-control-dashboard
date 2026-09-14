"""ปริมาณสะสมตามช่วง · ค่าน้ำขั้นบันได · รอบบิล · น้ำสูญหาย

★ ปริมาณต่อช่วงใช้โค้ดชุดเดียวกับ /api/metrics/series (fetch_buckets + build_points)
  ตัวเลขในรายงาน/การ์ดจึงตรงกับกราฟเป๊ะ ไม่มี query แยกที่ให้ผลคนละเลข
★ อัตราค่าน้ำ/ค่าไฟอ่านจากตาราง tariffs ตาม effective_from ไม่ hardcode
"""

from __future__ import annotations

import psycopg

from . import buckets as bk
from .metric_registry import AMOUNT, COUNTER, MetricDef
from .registry import Registry
from .series import LEVEL_OF, build_points, calendar_bounds, fetch_buckets, fetch_prior_counter, iso, now_ms, to_dt


def _granularity(start_ms: int, end_ms: int) -> str:
    return "hour" if end_ms - start_ms <= 31 * bk.MS_DAY else "day"


def counter_total(conn: psycopg.Connection, tz: str, source: str, measure: str, entity_id: str,
                  start_ms: int, end_ms: int) -> float | None:
    """ผลรวม delta ของตัวนับในช่วง — รีเซ็ตกลางช่วงนับถูกต้องที่ความละเอียดรายชั่วโมง/รายวัน
    ★ ผู้เรียกต้องส่ง start ที่ตรงขอบชั่วโมง/วัน (เที่ยงคืน, ต้นรอบบิล) ไม่งั้น bucket แรกจะเริ่มก่อน start
    """
    if end_ms <= start_ms:
        return 0.0
    granularity = _granularity(start_ms, end_ms)
    bounds = calendar_bounds(start_ms, end_ms, granularity, tz)
    if not bounds:
        return None
    definition = MetricDef(source, measure, COUNTER, "")
    level = LEVEL_OF[granularity]
    rows = fetch_buckets(conn, definition, level, entity_id, bounds)
    prior = fetch_prior_counter(conn, definition, level, entity_id, bounds[0][0])
    deltas = [p["delta"] for p in build_points(COUNTER, rows, bounds, now_ms(), prior) if p["delta"] is not None]
    return float(sum(deltas)) if deltas else None  # type: ignore[arg-type]


def amount_total(conn: psycopg.Connection, tz: str, source: str, measure: str, entity_id: str,
                 start_ms: int, end_ms: int) -> float | None:
    if end_ms <= start_ms:
        return 0.0
    granularity = _granularity(start_ms, end_ms)
    bounds = calendar_bounds(start_ms, end_ms, granularity, tz)
    rows = fetch_buckets(conn, MetricDef(source, measure, AMOUNT, ""), LEVEL_OF[granularity], entity_id, bounds)
    sums = [p["sum"] for p in build_points(AMOUNT, rows, bounds, now_ms()) if p["sum"] is not None]
    return float(sum(sums)) if sums else None  # type: ignore[arg-type]


def tank_liters_before(conn: psycopg.Connection, entity_id: str, moment_ms: int,
                       fallback_after: bool = False) -> float | None:
    """ปริมาตรถัง ณ เวลาหนึ่ง = ค่าล่าสุดก่อนเวลานั้น (ปริมาตรคิดด้วย tank_volume() ตอนรับข้อมูล)

    fallback_after: ไม่มีข้อมูลก่อนเวลานั้น (ช่วงเริ่มก่อนติดตั้ง) ให้ใช้ค่าแรกหลังจากนั้นแทน
    ★ ตรงกับที่ตัวนับของมิเตอร์เริ่มนับจากค่าแรกในช่วง — ไม่งั้น Δstorage = 0 แล้วเตือนรั่วตอนเติมถัง
    """
    row = conn.execute("""SELECT volume_l FROM tank_telemetry WHERE entity_id = %s AND time < %s
                           AND volume_l IS NOT NULL ORDER BY time DESC LIMIT 1""",
                       (entity_id, to_dt(moment_ms))).fetchone()
    if row is None and fallback_after:
        row = conn.execute("""SELECT volume_l FROM tank_telemetry WHERE entity_id = %s AND time >= %s
                               AND volume_l IS NOT NULL ORDER BY time ASC LIMIT 1""",
                           (entity_id, to_dt(moment_ms))).fetchone()
    return None if row is None else float(row[0])


# ─────────────── เวลาอ้างอิง ───────────────

def day_start(now: int, tz: str) -> int:
    return bk.bucket_start(now, "day", tz)


def month_start(now: int, tz: str) -> int:
    return bk.bucket_start(now, "month", tz)


def billing_period(now: int, cycle_start_day: int, tz: str) -> tuple[int, int]:
    """รอบบิลปัจจุบัน — ตรรกะเดียวกับ currentBillingPeriod() แต่ตัดขอบตามเขตเวลาของระบบ"""
    y, m, _d, *_ = bk.zoned_parts(now, tz)
    start = bk.zoned_time_to_ms((y, m, cycle_start_day, 0, 0, 0), tz)
    if start > now:
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
        start = bk.zoned_time_to_ms((y, m, cycle_start_day, 0, 0, 0), tz)
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    return start, bk.zoned_time_to_ms((ny, nm, cycle_start_day, 0, 0, 0), tz)


# ─────────────── อัตรา ───────────────

def tariff(conn: psycopg.Connection, kind: str, on_ms: int, tz: str) -> dict[str, object] | None:
    y, m, d, *_ = bk.zoned_parts(on_ms, tz)
    row = conn.execute("SELECT tariff_config(%s, make_date(%s, %s, %s))", (kind, y, m, d)).fetchone()
    return None if row is None or row[0] is None else row[0]


def water_tiers(config: dict[str, object] | None) -> list[dict[str, object]]:
    """config ในตาราง tariffs → WaterTariffTier[] ของหน้าบ้าน"""
    if config is None:
        return []
    tiers = []
    for index, tier in enumerate(config.get("tiers", []), start=1):  # type: ignore[union-attr]
        low, high = tier["min_m3"], tier["max_m3"]
        start = low + 1 if low > 0 else 0
        label_th = f"{start}–{high} ลบ.ม." if high is not None else f"{start} ลบ.ม. ขึ้นไป"
        label_en = f"{start}–{high} m³" if high is not None else f"{start}+ m³"
        tiers.append({"id": f"tier-{index}", "name": label_th, "nameEn": label_en, "minCubicMeters": low,
                      "maxCubicMeters": high, "ratePerCubicMeter": tier["rate"]})
    return tiers


def split_into_tiers(cubic_meters: float, tiers: list[dict[str, object]]) -> list[dict[str, object]]:
    """ตรรกะเดียวกับ splitIntoTiers() ใน lib/utils/calculation.ts"""
    breakdown: list[dict[str, object]] = []
    remaining = max(0.0, cubic_meters)
    for tier in tiers:
        if remaining <= 0:
            break
        high, low = tier["maxCubicMeters"], tier["minCubicMeters"]
        capacity = remaining if high is None else float(high) - float(low)  # type: ignore[arg-type]
        consumed = min(remaining, max(0.0, capacity))
        if consumed <= 0:
            continue
        rate = float(tier["ratePerCubicMeter"])  # type: ignore[arg-type]
        breakdown.append({"tierId": tier["id"], "tierName": tier["name"], "cubicMeters": round(consumed, 2),
                          "ratePerCubicMeter": rate, "amountBaht": round(consumed * rate, 2)})
        remaining -= consumed
    return breakdown


def tier_cost(cubic_meters: float, tiers: list[dict[str, object]]) -> float:
    return round(sum(float(t["amountBaht"]) for t in split_into_tiers(cubic_meters, tiers)), 2)  # type: ignore[arg-type]


def electricity_rate(config: dict[str, object] | None) -> float:
    if config is None:
        return 0.0
    return float(config.get("rate_per_kwh", 0)) + float(config.get("ft_per_kwh", 0))  # type: ignore[arg-type]


# ─────────────── น้ำสูญหาย ───────────────

def unaccounted_water(conn: psycopg.Connection, reg: Registry, start_ms: int, end_ms: int) -> dict[str, object]:
    """น้ำสูญหาย = มิเตอร์หลัก − Σ ทุกโซน − Δ ปริมาณน้ำในถังทุกใบ (รวมบ่อสำรอง)

    ★ ห้ามละ Δstorage: ช่วงเติมถังน้ำที่ผ่านมิเตอร์หลักยังไม่ถูกใช้ ถ้าไม่หักจะเตือนว่ารั่วทุกครั้งที่เติม
    """
    tz = reg.timezone
    main = reg.main_meter()
    main_m3 = counter_total(conn, tz, "meter", "volume", str(main["entity_id"]), start_ms, end_ms) if main else None
    zone_m3 = 0.0
    for meter in reg.of_type("meter"):
        if meter["zone_id"] is None:
            continue
        zone_m3 += counter_total(conn, tz, "meter", "volume", str(meter["entity_id"]), start_ms, end_ms) or 0.0
    storage_l = 0.0
    for tank in reg.of_type("tank"):
        before, after = tank_liters_before(conn, str(tank["entity_id"]), start_ms, fallback_after=True), \
            tank_liters_before(conn, str(tank["entity_id"]), min(end_ms, now_ms() + 1))
        if before is not None and after is not None:
            storage_l += after - before

    limits = reg.threshold("plant", "unaccounted_percent")
    main_value = round(main_m3, 2) if main_m3 is not None else 0.0
    zone_value, storage_value = round(zone_m3, 2), round(storage_l / 1000, 2)
    unaccounted = round(main_value - zone_value - storage_value, 2)
    percent = round(unaccounted / main_value * 100, 2) if main_value else 0.0
    critical, warning = limits.get("criticalHigh"), limits.get("warningHigh")
    if main_m3 is None:
        status = "offline"                    # ไม่มีข้อมูลมิเตอร์หลัก ≠ ปกติ
    elif critical is not None and percent >= critical:
        status = "critical"
    elif warning is not None and percent >= warning:
        status = "warning"
    else:
        status = "ok"
    return {"periodStart": iso(start_ms, tz), "periodEnd": iso(end_ms, tz), "mainMeterCubicMeters": main_value,
            "zoneTotalCubicMeters": zone_value, "storageDeltaCubicMeters": storage_value,
            "unaccountedCubicMeters": unaccounted, "unaccountedPercent": percent, "status": status}


def counter_since(conn: psycopg.Connection, table: str, column: str, entity_id: str, since_ms: int,
                  latest: float | None, phase_filter: str = "") -> float | None:
    """ทางลัดสำหรับการ์ดสด: ค่าล่าสุด − ค่าสุดท้ายก่อนเวลาเริ่ม (2 index lookup แทนการรวมทุก bucket)

    ★ รายงานที่ต้องตรงกับกราฟใช้ counter_total() — ทางลัดนี้นับรีเซ็ตกลางช่วงได้แค่ครั้งเดียว
    """
    if latest is None:
        return None
    where = f"entity_id = %s AND {column} IS NOT NULL{phase_filter}"
    before = conn.execute(f"SELECT {column} FROM {table} WHERE {where} AND time < %s ORDER BY time DESC LIMIT 1",
                          (entity_id, to_dt(since_ms))).fetchone()
    if before is None:
        before = conn.execute(f"SELECT {column} FROM {table} WHERE {where} AND time >= %s ORDER BY time ASC LIMIT 1",
                              (entity_id, to_dt(since_ms))).fetchone()
    if before is None:
        return None
    delta = latest - float(before[0])
    return latest if delta < 0 else delta
