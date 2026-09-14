"""เกณฑ์รับงานเฟส 3 — /api/metrics/series ผ่าน 10 ข้อเดียวกับ npm run check:series + อีก 3 ข้อ

รัน: .venv/bin/pytest -m integration tests/test_series_parity.py -v   (ต้องมี api + timescaledb ขึ้นอยู่)

★ ใช้ข้อมูลปี 2025 ที่สร้างขึ้นเองแบบกำหนดค่าได้ ไม่ปนกับข้อมูลสดของ ingest/simulator
★ ตัวนับเป็น "เลขหน้าปัดสะสมจริง" ไม่ใช่อินทิเกรตอัตราไหลแบบ mock
  จึงจับบั๊ก last − first ที่ check:series ฝั่ง mock จับไม่ได้ (PROBLEMS.md P-01)
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta

import httpx
import pytest

from tests.helpers import BKK

pytestmark = pytest.mark.integration

API = "http://127.0.0.1:8000"


def bkk(*args: int) -> datetime:
    return datetime(*args, tzinfo=BKK)


def ms(value: datetime) -> int:
    return round(value.timestamp() * 1000)


START, END = bkk(2025, 1, 1), bkk(2025, 3, 1)
RESET_AT = bkk(2025, 1, 20, 12, 0)                                  # เปลี่ยนมิเตอร์ ตัวนับกลับเป็น 0
GAP = (bkk(2025, 1, 10, 6, 0), bkk(2025, 1, 10, 9, 0))             # ไม่มีข้อมูลเลย 3 ชั่วโมง
PARTIAL = (bkk(2025, 1, 15, 14, 0), bkk(2025, 1, 15, 14, 40))       # ชั่วโมงที่ข้อมูลหาย 40 นาที
LATE_JAN31, EARLY_FEB1 = bkk(2025, 1, 31, 23, 59), bkk(2025, 2, 1, 0, 0)


@pytest.fixture(scope="module", autouse=True)
def dataset(db):
    """สร้างข้อมูลทดสอบ (รันซ้ำได้ไม่ซ้ำแถว) แล้ว materialize aggregate ช่วงนั้น

    ★ ข้อมูลเก่ากว่าหน้าต่าง refresh policy ต้องสั่ง refresh เอง (DECISIONS D-24)
    """
    p = {"start": START, "end": END, "reset": RESET_AT, "gap_start": GAP[0], "gap_end": GAP[1],
         "part_start": PARTIAL[0], "part_end": PARTIAL[1]}
    missing = "(ts >= %(gap_start)s AND ts < %(gap_end)s) OR (ts >= %(part_start)s AND ts < %(part_end)s)"

    # ตัวนับพลังงาน pump-2: ขึ้น 3 kWh ต่อชั่วโมง · รีเซ็ตเป็น 0 ตอน RESET_AT
    db.run(f"""
        INSERT INTO pump_telemetry (time, entity_id, energy_kwh)
        SELECT ts, 'pump-2', CASE WHEN ts < %(reset)s THEN 5000 + extract(epoch FROM ts - %(start)s) / 1200.0
                                  ELSE extract(epoch FROM ts - %(reset)s) / 1200.0 END
          FROM generate_series(%(start)s::timestamptz, %(end)s::timestamptz - interval '1 minute',
                               interval '1 minute') AS ts
         WHERE NOT ({missing})
        ON CONFLICT DO NOTHING""", p)

    # อุณหภูมิ/ฝน env-outdoor: แกว่งตามเวลาของวัน · null ทุกนาทีที่ 7 · ฝนช่วงบ่ายวันคู่
    db.run(f"""
        INSERT INTO env_telemetry (time, entity_id, temp_c, rain_mm)
        SELECT ts, 'env-outdoor',
               CASE WHEN extract(minute FROM ts)::int %% 7 = 0 THEN NULL
                    ELSE 28 + 5 * sin(2 * pi() * extract(epoch FROM ts - %(start)s) / 86400)
                         + (extract(minute FROM ts)::int %% 5) * 0.1 END,
               CASE WHEN extract(day FROM ts AT TIME ZONE 'Asia/Bangkok')::int %% 2 = 0
                         AND extract(hour FROM ts AT TIME ZONE 'Asia/Bangkok') BETWEEN 15 AND 16
                    THEN 0.05 ELSE 0 END
          FROM generate_series(%(start)s::timestamptz, %(end)s::timestamptz - interval '1 minute',
                               interval '1 minute') AS ts
         WHERE NOT ({missing})
        ON CONFLICT DO NOTHING""", p)
    # ค่าสุดขั้วคร่อมเที่ยงคืน: ต้องไปอยู่วันที่ถูกต้องตามเวลาไทย (ไม่ใช่ UTC)
    db.run("UPDATE env_telemetry SET temp_c = 40.5 WHERE entity_id = 'env-outdoor' AND time = %(t)s", {"t": LATE_JAN31})
    db.run("UPDATE env_telemetry SET temp_c = 10.5 WHERE entity_id = 'env-outdoor' AND time = %(t)s", {"t": EARLY_FEB1})

    # ช่วงสถานะปั๊ม 5 ม.ค.
    for state, a, b in (("running", (8, 0), (10, 0)), ("stopped", (10, 0), (11, 30)),
                        ("running", (11, 30), (13, 0)), ("stopped", (13, 0), (18, 0))):
        db.run("""
            INSERT INTO state_spans (entity_id, metric, state, started_at, ended_at)
            SELECT 'pump-2', 'pump_run_state', %(state)s, %(a)s, %(b)s
             WHERE NOT EXISTS (SELECT 1 FROM state_spans WHERE entity_id = 'pump-2'
                                AND metric = 'pump_run_state' AND started_at = %(a)s)""",
               {"state": state, "a": bkk(2025, 1, 5, *a), "b": bkk(2025, 1, 5, *b)})

    window = {"a": bkk(2024, 12, 30), "b": bkk(2025, 3, 3)}
    for source in ("pump", "env"):
        for level in ("5m", "1h", "1d"):
            db.run(f"CALL refresh_continuous_aggregate('{source}_{level}', %(a)s::timestamptz, %(b)s::timestamptz)",
                   window)


def series(**params: object) -> httpx.Response:
    return httpx.get(f"{API}/api/metrics/series", params=params, timeout=30)


def points(source_type: str, source_id: str, metric: str, frm: datetime, to: datetime, granularity: str) -> list:
    response = series(sourceType=source_type, sourceId=source_id, metric=metric, **{"from": ms(frm)}, to=ms(to),
                      granularity=granularity)
    assert response.status_code == 200, response.text
    return response.json()["points"]


def day_bucket(source_type: str, source_id: str, metric: str, day: datetime) -> dict:
    """bucket รายวันของวันหนึ่ง — ขอหน้าต่าง 3 วัน เพราะ PAIRING ไม่ให้ใช้ day กับช่วง ≤ 24 ชม."""
    window = points(source_type, source_id, metric, day - timedelta(days=1), day + timedelta(days=2), "day")
    return next(p for p in window if p["timestamp"] == ms(day))


def close(a: float, b: float) -> bool:
    return abs(a - b) <= max(1e-6 * abs(b), 1e-9)


# ─────────────── 1–2 ผลรวมข้ามระดับของ counter / amount ───────────────

@pytest.mark.parametrize("day", [bkk(2025, 1, 5), bkk(2025, 1, 10)], ids=["ปกติ", "มีช่วงข้อมูลหาย"])
def test_01_counter_hourly_sum_equals_daily(day):
    hours = points("pump", "pump-2", "energy_kwh", day, day + timedelta(days=1), "hour")
    daily = day_bucket("pump", "pump-2", "energy_kwh", day)
    assert len(hours) == 24
    total = sum(h["delta"] for h in hours if h["delta"] is not None)
    assert close(total, daily["delta"]), (total, daily["delta"])
    assert close(daily["delta"], 72.0)          # 3 kWh × 24 ชม. — ชั่วโมงที่ข้อมูลหายรวมไปอยู่ใน bucket ถัดไป


def test_01b_amount_hourly_sum_equals_daily():
    day, nxt = bkk(2025, 1, 4), bkk(2025, 1, 5)
    hours = points("sensor", "env-outdoor", "rainfall", day, nxt, "hour")
    daily = day_bucket("sensor", "env-outdoor", "rainfall", day)
    total = sum(h["sum"] for h in hours if h["sum"] is not None)
    assert total > 0 and close(total, daily["sum"])


def test_02_daily_sum_equals_monthly():
    days = points("pump", "pump-2", "energy_kwh", bkk(2025, 2, 1), bkk(2025, 3, 1), "day")
    months = points("pump", "pump-2", "energy_kwh", START, END, "month")
    february = next(m for m in months if m["timestamp"] == ms(bkk(2025, 2, 1)))
    assert len(days) == 28
    assert close(sum(d["delta"] for d in days), february["delta"])

    rain_days = points("sensor", "env-outdoor", "rainfall", bkk(2025, 2, 1), bkk(2025, 3, 1), "day")
    rain_feb = next(m for m in points("sensor", "env-outdoor", "rainfall", START, END, "month")
                    if m["timestamp"] == ms(bkk(2025, 2, 1)))
    assert close(sum(d["sum"] for d in rain_days), rain_feb["sum"])


# ─────────────── 3–6 gauge ───────────────

DAY15 = (bkk(2025, 1, 15), bkk(2025, 1, 16))


def test_03_gauge_daily_avg_is_count_weighted_not_mean_of_hourly_avgs():
    hours = [h for h in points("sensor", "env-outdoor", "temperature", *DAY15, "hour") if h["count"] > 0]
    day = day_bucket("sensor", "env-outdoor", "temperature", DAY15[0])
    weighted = sum(h["avg"] * h["count"] for h in hours) / sum(h["count"] for h in hours)
    plain = sum(h["avg"] for h in hours) / len(hours)
    assert close(day["avg"], weighted)
    assert not close(day["avg"], plain), "ข้อมูลทดสอบต้องมีชั่วโมงที่ count ไม่เท่ากัน ไม่งั้นข้อนี้ไม่ได้พิสูจน์อะไร"


def test_04_gauge_daily_min_max_equal_hourly_extremes():
    hours = [h for h in points("sensor", "env-outdoor", "temperature", *DAY15, "hour") if h["count"] > 0]
    day = day_bucket("sensor", "env-outdoor", "temperature", DAY15[0])
    assert day["min"] == min(h["min"] for h in hours) and day["max"] == max(h["max"] for h in hours)


def test_05_gauge_min_at_max_at_exist_and_point_to_the_extreme_hour():
    hours = [h for h in points("sensor", "env-outdoor", "temperature", *DAY15, "hour") if h["count"] > 0]
    day = day_bucket("sensor", "env-outdoor", "temperature", DAY15[0])
    assert ms(DAY15[0]) <= day["minAt"] < ms(DAY15[1]) and ms(DAY15[0]) <= day["maxAt"] < ms(DAY15[1])
    assert day["minAt"] == min(hours, key=lambda h: h["min"])["minAt"]
    assert day["maxAt"] == max(hours, key=lambda h: h["max"])["maxAt"]


def test_06_gauge_bucket_has_no_sum_key():
    for granularity, frm, to in (("raw", bkk(2025, 1, 15, 10), bkk(2025, 1, 15, 10, 30)),
                                 ("hour", *DAY15), ("month", START, END)):
        for point in points("sensor", "env-outdoor", "temperature", frm, to, granularity):
            assert point["kind"] == "gauge" and "sum" not in point


# ─────────────── 7–8 ครบทุก bucket · ช่วงว่างเป็น null ───────────────

def test_07_08_all_buckets_returned_and_gaps_are_null_not_zero():
    day = points("sensor", "env-outdoor", "temperature", bkk(2025, 1, 10), bkk(2025, 1, 11), "hour")
    assert len(day) == 24
    gap_hours = [h for h in day if ms(GAP[0]) <= h["timestamp"] < ms(GAP[1])]
    assert len(gap_hours) == 3
    for hour in gap_hours:
        assert hour["count"] == 0 and hour["expectedCount"] == 1800
        assert hour["avg"] is None and hour["min"] is None and hour["max"] is None and hour["minAt"] is None
    counters = points("pump", "pump-2", "energy_kwh", bkk(2025, 1, 10), bkk(2025, 1, 11), "hour")
    assert [h["delta"] for h in counters if ms(GAP[0]) <= h["timestamp"] < ms(GAP[1])] == [None, None, None]


# ─────────────── 9 ช่วงสถานะ ───────────────

def test_09_state_spans_contiguous_and_sum_to_range():
    frm, to = bkk(2025, 1, 5, 7, 0), bkk(2025, 1, 5, 19, 0)
    response = httpx.get(f"{API}/api/metrics/state-spans", params={
        "sourceType": "pump", "sourceId": "pump-2", "from": ms(frm), "to": ms(to)}, timeout=30)
    assert response.status_code == 200, response.text
    spans = response.json()
    assert spans[0]["from"] == ms(frm) and spans[-1]["to"] == ms(to)
    assert all(a["to"] == b["from"] for a, b in zip(spans, spans[1:], strict=False))
    assert sum(s["durationMs"] for s in spans) == ms(to) - ms(frm)
    assert [s["state"] for s in spans] == ["no_data", "running", "stopped", "running", "stopped", "no_data"]

    bucket = day_bucket("pump", "pump-2", "pump_run_state", bkk(2025, 1, 5))
    assert bucket["kind"] == "state" and bucket["durationsMs"]["running"] == 3.5 * 3_600_000
    assert bucket["entries"]["running"] == 2


# ─────────────── 10 ความเร็ว ───────────────

def test_10_two_years_monthly_under_500ms():
    params = {"sourceType": "pump", "sourceId": "pump-2", "metric": "energy_kwh",
              "from": ms(bkk(2024, 3, 1)), "to": ms(bkk(2026, 3, 1)), "granularity": "month"}
    series(**params)                                       # อุ่นเครื่อง connection pool
    started = time.perf_counter()
    response = series(**params)
    elapsed_ms = (time.perf_counter() - started) * 1000
    print(f"\nเกณฑ์ 10: 2 ปีรายเดือน {len(response.json()['points'])} จุด ใน {elapsed_ms:.0f} ms")
    assert response.status_code == 200 and len(response.json()["points"]) == 24
    assert elapsed_ms < 500


# ─────────────── 11 ปฏิเสธคำขอที่เกินกติกา ───────────────

def test_11_pairing_violation_and_too_many_points_are_400():
    bad_pair = series(sourceType="pump", sourceId="pump-2", metric="energy_kwh", **{"from": ms(START)},
                      to=ms(bkk(2025, 1, 31)), granularity="raw")
    assert bad_pair.status_code == 400
    assert bad_pair.json()["code"] == "GRANULARITY_NOT_ALLOWED" and bad_pair.json()["details"]["suggested"] == "day"

    too_many = series(sourceType="pump", sourceId="pump-2", metric="energy_kwh", **{"from": ms(bkk(1935, 1, 1))},
                      to=ms(bkk(2025, 1, 1)), granularity="month")
    assert too_many.status_code == 400 and too_many.json()["code"] == "TOO_MANY_POINTS"
    assert set(too_many.json()) == {"code", "messageTh", "messageEn", "details", "traceId"}


# ─────────────── 12 ขอบวันตามเวลาไทย ───────────────

def test_12_day_bucket_starts_at_midnight_bangkok():
    response = series(sourceType="sensor", sourceId="env-outdoor", metric="temperature",
                      **{"from": ms(bkk(2025, 1, 31))}, to=ms(bkk(2025, 2, 2)), granularity="day")
    body = response.json()
    jan31, feb1 = body["points"]
    assert body["timezone"] == "Asia/Bangkok" and body["from"].endswith("+07:00")
    assert jan31["timestamp"] == ms(bkk(2025, 1, 31)) and feb1["timestamp"] == ms(bkk(2025, 2, 1))
    assert jan31["max"] == 40.5 and jan31["maxAt"] == ms(LATE_JAN31)     # 23:59 ยังเป็นวันที่ 31
    assert feb1["min"] == 10.5 and feb1["minAt"] == ms(EARLY_FEB1)       # 00:00 เป็นวันใหม่


# ─────────────── 13 ตัวนับรีเซ็ต ───────────────

def test_13_counter_reset_flagged_and_delta_never_negative():
    hours = points("pump", "pump-2", "energy_kwh", bkk(2025, 1, 20), bkk(2025, 1, 21), "hour")
    reset_hour = next(h for h in hours if h["timestamp"] == ms(RESET_AT))
    assert reset_hour["resetDetected"] is True
    assert all(h["delta"] is None or h["delta"] >= 0 for h in hours)
    assert sum(1 for h in hours if h["resetDetected"]) == 1
