"""ตัดสินน้ำสูญหาย · ขอบหน้าต่าง · สถานการณ์ระดับถังตั้งต้นของ simulator — ไม่ต้องมี docker"""

from __future__ import annotations

import random
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from api.worker.unaccounted import EDGE_TOLERANCE_MS, MIN_MAIN_M3, judge, uncovered, window_end
from simulator.plant import Plant
from simulator.scenarios import Scenarios

LIMITS = {"criticalLow": None, "warningLow": None, "warningHigh": 8.0, "criticalHigh": 15.0}
PROFILE = yaml.safe_load((Path(__file__).parents[1] / "simulator" / "profiles.yaml").read_text(encoding="utf-8"))
BKK = ZoneInfo("Asia/Bangkok")


def test_judge_uses_threshold_table_limits_inclusive():
    assert judge(7.99, 10, LIMITS, []).severity is None
    assert judge(8.0, 10, LIMITS, []).severity == "warning"
    assert judge(15.0, 10, LIMITS, []).severity == "critical"


def test_judge_refuses_to_decide_without_every_meter_and_tank():
    verdict = judge(40.0, 10, LIMITS, ["meter-zone-3"])
    assert verdict.severity is None and verdict.skipped == "incomplete"


def test_judge_ignores_tiny_inflow_where_rounding_dominates():
    verdict = judge(250.0, MIN_MAIN_M3 - 0.01, LIMITS, [])
    assert verdict.severity is None and verdict.skipped == "low_inflow"


def test_source_must_cover_both_edges_of_the_window_not_just_appear_once():
    start, end = 0, 3_600_000
    spans = {"steady": (1_000, end - 2_000),
             "went_silent": (1_000, 20 * 60_000),                       # หยุดส่งตั้งแต่นาทีที่ 20
             "came_late": (start + EDGE_TOLERANCE_MS + 1, end - 2_000),
             "just_within": (start + EDGE_TOLERANCE_MS, end - EDGE_TOLERANCE_MS)}
    assert uncovered([*spans, "never_seen"], spans, start, end) == ["went_silent", "came_late", "never_seen"]


def test_window_end_snaps_down_to_local_five_minutes():
    moment = datetime(2026, 9, 13, 23, 43, 10, tzinfo=BKK)
    expected = datetime(2026, 9, 13, 23, 40, tzinfo=BKK)
    assert window_end(int(moment.timestamp() * 1000), "Asia/Bangkok") == int(expected.timestamp() * 1000)


def test_scenarios_set_starting_tank_levels():
    pond = Plant(PROFILE, Scenarios.from_names(["pond_fill"], PROFILE), random.Random(1))
    assert round(pond.tank_percent("tank-3"), 3) == 89
    pond.step(datetime(2026, 9, 13, 14, 0, tzinfo=BKK), 2.0)
    assert pond.pond_fill_on

    night = Plant(PROFILE, Scenarios.from_names(["night_leak"], PROFILE), random.Random(1))
    assert round(night.tank_percent("tank-1"), 3) == 94
    assert round(night.tank_percent("tank-3"), 3) == PROFILE["tanks"]["tank-3"]["initial_percent"]
