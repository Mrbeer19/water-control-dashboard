"""unit test ของการประกอบ bucket และช่วงสถานะ — ไม่ต้องมี DB"""

from datetime import UTC, datetime

from api.series import NO_DATA, SeriesQuery, build_points, build_timeline, compare_range, state_points

HOUR = 3_600_000


def bounds(n: int, start: int = 0, step: int = HOUR) -> list[tuple[int, int]]:
    return [(start + i * step, start + (i + 1) * step) for i in range(n)]


def counter_rows(lasts: list[float | None]) -> list[dict]:
    return [{"n": 0 if v is None else 10, "last": v, "first": v} for v in lasts]


# ─────────────── counter: delta ข้าม bucket ───────────────

def test_counter_delta_crosses_buckets_so_sums_telescope():
    points = build_points("counter", counter_rows([10.0, 12.5, 15.0]), bounds(3), now=10 * HOUR, prior=9.0)
    assert [p["delta"] for p in points] == [1.0, 2.5, 2.5]
    assert sum(p["delta"] for p in points) == 15.0 - 9.0


def test_counter_gap_is_null_and_next_bucket_includes_consumption_during_gap():
    points = build_points("counter", counter_rows([10.0, None, 14.0]), bounds(3), now=10 * HOUR, prior=9.0)
    assert points[1]["delta"] is None and points[1]["count"] == 0
    assert points[2]["delta"] == 4.0


def test_counter_reset_is_flagged_and_never_negative():
    points = build_points("counter", counter_rows([100.0, 3.0, 5.0]), bounds(3), now=10 * HOUR, prior=99.0)
    assert points[1] == {**points[1], "delta": 3.0, "resetDetected": True}
    assert all(p["delta"] >= 0 for p in points)
    assert points[2]["resetDetected"] is False and points[2]["delta"] == 2.0


def test_counter_without_prior_uses_first_value_of_bucket():
    rows = [{"n": 5, "last": 20.0, "first": 18.0}]
    assert build_points("counter", rows, bounds(1), now=10 * HOUR, prior=None)[0]["delta"] == 2.0


# ─────────────── gauge / level / amount ───────────────

def test_gauge_has_no_sum_key_and_empty_bucket_is_null_not_zero():
    at = datetime(2026, 9, 13, tzinfo=UTC)
    rows = [{"n": 4, "s": 100.0, "mn": 20.0, "mx": 30.0, "mn_at": at, "mx_at": at},
            {"n": 0, "s": None, "mn": None, "mx": None, "mn_at": None, "mx_at": None}]
    points = build_points("gauge", rows, bounds(2), now=10 * HOUR)
    assert "sum" not in points[0] and "sum" not in points[1]
    assert points[0]["avg"] == 25.0 and points[0]["minAt"] == round(at.timestamp() * 1000)
    assert points[1] == {"timestamp": HOUR, "count": 0, "expectedCount": 1800, "isPartial": False,
                         "kind": "gauge", "avg": None, "min": None, "max": None, "minAt": None, "maxAt": None}


def test_level_scale_to_percent_and_partial_flag():
    rows = [{"n": 3, "last": 35000.0, "mn": 30000.0, "mx": 40000.0}]
    point = build_points("level", rows, bounds(1), now=HOUR // 2, scale=100 / 70000)[0]
    assert point["last"] == 50.0 and point["isPartial"] is True


def test_amount_bucket_shape():
    point = build_points("amount", [{"n": 2, "s": 1.5, "mx": 1.0}], bounds(1), now=10 * HOUR)[0]
    assert set(point) == {"timestamp", "count", "expectedCount", "isPartial", "kind", "sum", "max"}


# ─────────────── ช่วงสถานะ ───────────────

def test_timeline_is_contiguous_clipped_and_sums_to_range():
    spans = [("running", -HOUR, 2 * HOUR), ("stopped", 2 * HOUR, 3 * HOUR), ("running", 4 * HOUR, None)]
    timeline = build_timeline(spans, [], 0, 6 * HOUR, now=5 * HOUR)
    assert timeline == [(0, 2 * HOUR, "running"), (2 * HOUR, 3 * HOUR, "stopped"), (3 * HOUR, 4 * HOUR, NO_DATA),
                        (4 * HOUR, 5 * HOUR, "running"), (5 * HOUR, 6 * HOUR, NO_DATA)]
    assert sum(e - s for s, e, _ in timeline) == 6 * HOUR


def test_offline_device_masks_stale_open_state():
    spans = [("running", 0, None)]                      # span ค้างเปิดไว้ แต่บอร์ดดับไปแล้ว
    timeline = build_timeline(spans, [(HOUR, None)], 0, 3 * HOUR, now=3 * HOUR)
    assert timeline == [(0, HOUR, "running"), (HOUR, 3 * HOUR, NO_DATA)]


def test_state_bucket_durations_and_entries():
    timeline = [(0, 30 * 60_000, "running"), (30 * 60_000, 90 * 60_000, "stopped"), (90 * 60_000, 2 * HOUR, "running")]
    points = state_points(timeline, bounds(2), now=10 * HOUR)
    assert points[0]["durationsMs"] == {"running": 30 * 60_000, "stopped": 30 * 60_000}
    assert points[0]["entries"] == {"stopped": 1}          # running ต่อมาจากก่อนช่วง ไม่นับว่า "เข้า"
    assert points[1]["durationsMs"] == {"stopped": 30 * 60_000, "running": 30 * 60_000}
    assert points[1]["entries"] == {"running": 1}


def test_compare_ranges():
    q = SeriesQuery("pump", "pump-1", "flow_lpm", 1_000_000, 4_600_000, "hour", compare="previous")
    assert compare_range(q) == (-2_600_000, 1_000_000)
    leap = round(datetime(2028, 2, 29, 5, tzinfo=UTC).timestamp() * 1000)
    shifted = compare_range(SeriesQuery("pump", "p", "flow_lpm", leap, leap + HOUR, "hour", compare="last_year"))
    assert datetime.fromtimestamp(shifted[0] / 1000, tz=UTC) == datetime(2027, 3, 1, 5, tzinfo=UTC)
