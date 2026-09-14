"""archive · retention · backup — ส่วนคำนวณล้วน ไม่ต้องมี docker และไม่ต้องมี pyarrow"""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from api.worker.archive import (
    MIN_RETENTION_DAYS,
    arrow_type_name,
    day_bounds,
    days_between,
    days_to_verify,
    last_complete_day,
    retention_cutoff,
)
from api.worker.backup import is_due, missing_tables, size_problem, to_delete

TZ = "Asia/Bangkok"
BKK = ZoneInfo(TZ)


def ms(at: datetime) -> int:
    return int(at.timestamp() * 1000)


def utc_chunk(month: int, day: int) -> tuple[int, int]:
    """chunk 1 วันของ TimescaleDB ตัดเที่ยงคืน UTC = 07:00 เวลาไทย"""
    return ms(datetime(2026, month, day, tzinfo=UTC)), ms(datetime(2026, month, day + 1, tzinfo=UTC))


def test_days_follow_plant_timezone_not_utc():
    start, end = day_bounds(date(2026, 8, 1), TZ)
    assert start == ms(datetime(2026, 8, 1, tzinfo=BKK)) and end == ms(datetime(2026, 8, 2, tzinfo=BKK))
    assert days_between(*utc_chunk(8, 1), TZ) == [date(2026, 8, 1), date(2026, 8, 2)]


def test_days_come_from_existing_chunks_so_old_data_is_never_skipped_and_gaps_cost_nothing():
    chunks = [utc_chunk(1, 10), utc_chunk(8, 1), utc_chunk(8, 2)]          # ข้อมูลเก่ามากกับข้อมูลล่าสุด เว้นช่วงกลาง
    assert days_to_verify(chunks, None, TZ) == [date(2026, 1, 10), date(2026, 1, 11), date(2026, 8, 1),
                                                 date(2026, 8, 2), date(2026, 8, 3)]
    assert days_to_verify([], None, TZ) == []


def test_half_dropped_day_is_neither_rechecked_nor_rewritten():
    chunks = [utc_chunk(8, 1), utc_chunk(8, 2)]
    previous_drop = ms(datetime(2026, 8, 1, tzinfo=UTC))                   # 1 ส.ค. เหลือแค่ตั้งแต่ 07:00
    assert days_to_verify(chunks, previous_drop, TZ) == [date(2026, 8, 2), date(2026, 8, 3)]
    at_local_midnight = ms(datetime(2026, 8, 1, tzinfo=BKK))
    assert days_to_verify(chunks, at_local_midnight, TZ)[0] == date(2026, 8, 1)


def test_data_backfilled_before_the_last_drop_line_must_still_be_archived_before_it_can_be_dropped():
    previous_drop = ms(datetime(2026, 8, 1, tzinfo=UTC))
    backfilled = [utc_chunk(1, 10)]                                        # นำเข้าย้อนหลังหลังลบไปแล้ว
    assert days_to_verify(backfilled, previous_drop, TZ) == [date(2026, 1, 10), date(2026, 1, 11)]


def test_recent_days_wait_for_late_data_before_archiving():
    assert last_complete_day(ms(datetime(2026, 9, 14, 1, 30, tzinfo=BKK)), TZ) == date(2026, 9, 12)
    assert last_complete_day(ms(datetime(2026, 9, 14, 3, 0, tzinfo=BKK)), TZ) == date(2026, 9, 13)


def test_retention_has_a_floor_and_cuts_at_local_midnight():
    now = ms(datetime(2026, 9, 14, 12, tzinfo=BKK))
    assert retention_cutoff(now, 365, TZ) == ms(datetime(2025, 9, 14, tzinfo=BKK))
    assert retention_cutoff(now, 1, TZ) == ms(datetime(2026, 9, 14, tzinfo=BKK)) - MIN_RETENTION_DAYS * 86_400_000


def test_postgres_types_map_to_arrow_without_losing_unknown_types():
    assert arrow_type_name("timestamp with time zone") == "timestamp"
    assert arrow_type_name("double precision") == "float64" and arrow_type_name("bigint") == "int64"
    assert arrow_type_name("boolean") == "bool_" and arrow_type_name("jsonb") == "string"


def test_backup_is_due_once_per_day_after_backup_time():
    at = datetime(2026, 9, 14, 2, 30, tzinfo=BKK)
    assert is_due(at, "02:30", date(2026, 9, 13), True)
    assert not is_due(at.replace(minute=29), "02:30", date(2026, 9, 13), True)
    assert not is_due(at, "02:30", date(2026, 9, 14), True)
    assert not is_due(at, "02:30", None, False)


def test_backup_file_checks():
    assert size_problem(0, 10_000, None) is not None
    assert size_problem(10, 10_000, None) is None                          # ครั้งแรกไม่มีอะไรให้เทียบ
    assert size_problem(400, 10_000, (1_000, 10_000)) is not None          # ฐานข้อมูลเท่าเดิมแต่ไฟล์เหลือ 40%
    assert size_problem(600, 10_000, (1_000, 10_000)) is None
    # หลัง retention ลบ chunk ฐานข้อมูลเล็กลงจริง ไฟล์เล็กลงตามสัดส่วน = ปกติ (เคยถูกปฏิเสธผิด ๆ)
    assert size_problem(1_082_875, 40_000_000, (2_780_328, 100_000_000)) is None
    listing = "\n".join(f"1; 0 1 TABLE DATA public {t} postgres" for t in ("entities", "settings", "alerts", "tariffs"))
    assert missing_tables(listing) == ["meter_telemetry"]


def test_backup_rotation_keeps_newest_files():
    names = [f"water-202609{day:02d}-0230.dump" for day in range(1, 17)]
    assert to_delete(list(reversed(names)), keep=14) == names[:2]
    assert to_delete(names[:3], keep=14) == []
