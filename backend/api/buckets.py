"""ตัดช่วงเวลาเป็น bucket — พอร์ตตรงตัวจาก lib/utils/time-buckets.ts

★★ ห้ามเขียนกติกาขึ้นใหม่จากตารางในเอกสาร ★★
  ถ้าสองฝั่งไม่ตรงกัน หน้าจอจะขอ granularity ที่ backend ปฏิเสธ หรือกลับกัน
  ความตรงตรวจด้วย tests/test_buckets_parity.py ซึ่งเทียบกับค่าที่คำนวณจากไฟล์ .ts จริง
  (สร้างใหม่ได้ด้วย node scripts/gen_buckets_golden.mjs)

เวลาทั้งหมดเป็น epoch milliseconds (int) เหมือนฝั่งหน้าบ้าน
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

MS_MINUTE = 60_000
MS_HOUR = 3_600_000
MS_DAY = 86_400_000

GRANULARITIES = ("raw", "minute_5", "minute_15", "hour", "day", "week", "month", "year")

APPROX_MS = {
    "raw": 2_000,
    "minute_5": 5 * MS_MINUTE,
    "minute_15": 15 * MS_MINUTE,
    "hour": MS_HOUR,
    "day": MS_DAY,
    "week": 7 * MS_DAY,
    "month": 30 * MS_DAY,
    "year": 365 * MS_DAY,
}

MAX_POINTS_PER_SERIES = 1_000

# (ช่วงยาวสุด, ความละเอียดที่ยอม, ค่าเริ่มต้น) — เรียงจากสั้นไปยาว เหมือน PAIRING ใน .ts
PAIRING: tuple[tuple[float, tuple[str, ...], str], ...] = (
    (MS_HOUR, ("raw", "minute_5"), "raw"),
    (24 * MS_HOUR, ("minute_5", "minute_15", "hour"), "minute_15"),
    (7 * MS_DAY, ("minute_15", "hour", "day"), "hour"),
    (31 * MS_DAY, ("hour", "day", "week"), "day"),
    (366 * MS_DAY, ("day", "week", "month"), "month"),
    (math.inf, ("month", "year"), "month"),
)


def _row(range_ms: float) -> tuple[float, tuple[str, ...], str]:
    return next((row for row in PAIRING if range_ms <= row[0]), PAIRING[-1])


def preferred_granularity(from_ms: int, to_ms: int) -> str:
    return _row(max(0, to_ms - from_ms))[2]


def allowed_granularities(from_ms: int, to_ms: int) -> tuple[str, ...]:
    return _row(max(0, to_ms - from_ms))[1]


def granularity_options(from_ms: int, to_ms: int) -> list[dict[str, object]]:
    range_ms = max(0, to_ms - from_ms)
    allowed = set(_row(range_ms)[1])
    options: list[dict[str, object]] = []
    for value in GRANULARITIES:
        approx_points = math.ceil(range_ms / APPROX_MS[value])
        if value in allowed:
            options.append({"value": value, "disabled": False, "reasonKey": None, "approxPoints": approx_points})
        else:
            reason = "tooManyPoints" if approx_points > MAX_POINTS_PER_SERIES else "tooLong"
            options.append({"value": value, "disabled": True, "reasonKey": reason, "approxPoints": approx_points})
    return options


def coerce_granularity(current: str, from_ms: int, to_ms: int) -> str:
    _, allowed, preferred = _row(max(0, to_ms - from_ms))
    return current if current in allowed else preferred


# ─────────────── ตัดขอบช่วงตามเขตเวลา ───────────────

Parts = tuple[int, int, int, int, int, int]  # year, month(1–12), day, hour, minute, second


@lru_cache(maxsize=16)
def _zone(time_zone: str) -> ZoneInfo:
    return ZoneInfo(time_zone)


def zoned_parts(timestamp: int, time_zone: str) -> Parts:
    # Intl.DateTimeFormat ไม่คืนมิลลิวินาที → ตัดเศษวินาทีทิ้งแบบเดียวกัน
    local = datetime.fromtimestamp(timestamp // 1000, tz=_zone(time_zone))
    return local.year, local.month, local.day, local.hour, local.minute, local.second


def _date_utc(year: int, month: int, day: int, hour: int, minute: int, second: int) -> int:
    """Date.UTC() ของ JS — ยอมให้วัน/เดือนล้นแล้วปัดขึ้นเอง (เช่น วันที่ 32)"""
    extra_years, month_index = divmod(month - 1, 12)
    base = datetime(year + extra_years, month_index + 1, 1, tzinfo=UTC)
    moment = base + timedelta(days=day - 1, hours=hour, minutes=minute, seconds=second)
    return int(moment.timestamp()) * 1000


def _offset_ms(timestamp: int, time_zone: str) -> int:
    as_utc = _date_utc(*zoned_parts(timestamp, time_zone))
    return as_utc - (timestamp // 1000) * 1000


def zoned_time_to_ms(parts: Parts, time_zone: str) -> int:
    """เวลาหน้าปัดในเขตเวลานั้น → epoch ms (คิด offset สองรอบเหมือน .ts เผื่อไซต์ที่มี DST)"""
    naive = _date_utc(*parts)
    guess = naive - _offset_ms(naive, time_zone)
    return naive - _offset_ms(guess, time_zone)


def _weekday_in_zone(timestamp: int, time_zone: str) -> int:
    """0 = อาทิตย์ เหมือน JS"""
    local = datetime.fromtimestamp(timestamp // 1000, tz=_zone(time_zone))
    return (local.weekday() + 1) % 7


def _step_back(midnight_ms: int, days: int, time_zone: str) -> int:
    cursor = midnight_ms
    for _ in range(days):
        y, mo, d, _h, _mi, _s = zoned_parts(cursor - 12 * MS_HOUR, time_zone)
        cursor = zoned_time_to_ms((y, mo, d, 0, 0, 0), time_zone)
    return cursor


def bucket_start(timestamp: int, granularity: str, time_zone: str) -> int:
    """ต้นช่วง — สัปดาห์เริ่มวันจันทร์ · วันเริ่ม 00:00 ตามเขตเวลา"""
    if granularity == "raw":
        return timestamp
    y, mo, d, h, mi, s = zoned_parts(timestamp, time_zone)
    if granularity in ("minute_5", "minute_15"):
        size = 5 if granularity == "minute_5" else 15
        return zoned_time_to_ms((y, mo, d, h, (mi // size) * size, 0), time_zone)
    if granularity == "hour":
        return zoned_time_to_ms((y, mo, d, h, 0, 0), time_zone)
    if granularity == "day":
        return zoned_time_to_ms((y, mo, d, 0, 0, 0), time_zone)
    if granularity == "month":
        return zoned_time_to_ms((y, mo, 1, 0, 0, 0), time_zone)
    if granularity == "year":
        return zoned_time_to_ms((y, 1, 1, 0, 0, 0), time_zone)
    if granularity == "week":
        midnight = zoned_time_to_ms((y, mo, d, 0, 0, 0), time_zone)
        back_days = (_weekday_in_zone(midnight, time_zone) + 6) % 7   # อาทิตย์(0) → 6 · จันทร์(1) → 0
        return _step_back(midnight, back_days, time_zone)
    raise ValueError(f"granularity ไม่รู้จัก: {granularity}")


def next_bucket_start(start: int, granularity: str, time_zone: str) -> int:
    if granularity == "raw":
        return start + APPROX_MS["raw"]
    if granularity == "minute_5":
        return start + 5 * MS_MINUTE
    if granularity == "minute_15":
        return start + 15 * MS_MINUTE
    if granularity == "hour":
        return start + MS_HOUR
    y, mo, d, _h, _mi, _s = zoned_parts(start, time_zone)
    if granularity == "day":
        return zoned_time_to_ms((y, mo, d + 1, 0, 0, 0), time_zone)
    if granularity == "week":
        return zoned_time_to_ms((y, mo, d + 7, 0, 0, 0), time_zone)
    if granularity == "month":
        next_month, next_year = (1, y + 1) if mo == 12 else (mo + 1, y)
        return zoned_time_to_ms((next_year, next_month, 1, 0, 0, 0), time_zone)
    if granularity == "year":
        return zoned_time_to_ms((y + 1, 1, 1, 0, 0, 0), time_zone)
    raise ValueError(f"granularity ไม่รู้จัก: {granularity}")


def bucket_starts(from_ms: int, to_ms: int, granularity: str, time_zone: str) -> list[int]:
    """ต้นช่วงทั้งหมดใน from–to รวมช่วงที่ไม่มีข้อมูล"""
    out: list[int] = []
    cursor = bucket_start(from_ms, granularity, time_zone)
    guard = 0
    while cursor < to_ms and guard < MAX_POINTS_PER_SERIES * 4:
        out.append(cursor)
        nxt = next_bucket_start(cursor, granularity, time_zone)
        if nxt <= cursor:
            break
        cursor = nxt
        guard += 1
    return out


def expected_samples(start: int, granularity: str, time_zone: str, sample_ms: int = 2_000) -> int:
    end = next_bucket_start(start, granularity, time_zone)
    return max(1, math.floor((end - start) / sample_ms + 0.5))   # Math.round ของ JS ปัดครึ่งขึ้น


def is_partial_bucket(start: int, granularity: str, time_zone: str, now_ms: int) -> bool:
    return next_bucket_start(start, granularity, time_zone) > now_ms
