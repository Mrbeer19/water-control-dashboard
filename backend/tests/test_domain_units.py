"""unit test ของการคำนวณฝั่ง API ที่ต้องตรงกับหน้าบ้าน — ไม่ต้องมี DB"""

from datetime import datetime

import pytest

from api.domain_site import dew_point
from api.registry import status_from_range, worst_status
from api.usage import billing_period, split_into_tiers, tier_cost, water_tiers
from tests.helpers import BKK

TARIFF = {"tiers": [{"min_m3": 0, "max_m3": 30, "rate": 17.0}, {"min_m3": 30, "max_m3": 50, "rate": 19.5},
                    {"min_m3": 50, "max_m3": 80, "rate": 21.8}, {"min_m3": 80, "max_m3": 100, "rate": 23.4},
                    {"min_m3": 100, "max_m3": None, "rate": 25.6}], "service_charge": 90, "vat_percent": 7}


def ms(*args):
    return round(datetime(*args, tzinfo=BKK).timestamp() * 1000)


def test_water_tiers_shape_matches_frontend_defaults():
    tiers = water_tiers(TARIFF)
    assert [t["name"] for t in tiers] == ["0–30 ลบ.ม.", "31–50 ลบ.ม.", "51–80 ลบ.ม.", "81–100 ลบ.ม.",
                                          "101 ลบ.ม. ขึ้นไป"]
    assert tiers[1] == {"id": "tier-2", "name": "31–50 ลบ.ม.", "nameEn": "31–50 m³", "minCubicMeters": 30,
                        "maxCubicMeters": 50, "ratePerCubicMeter": 19.5}


def test_split_into_tiers_is_cumulative_not_highest_rate():
    tiers = water_tiers(TARIFF)
    breakdown = split_into_tiers(45, tiers)
    assert [(b["cubicMeters"], b["amountBaht"]) for b in breakdown] == [(30, 510.0), (15, 292.5)]
    assert tier_cost(45, tiers) == 802.5 != 45 * 19.5
    assert tier_cost(0, tiers) == 0 and tier_cost(120, tiers) == 2534.0


@pytest.mark.parametrize(("now", "start", "end"), [
    (ms(2026, 9, 13, 10), ms(2026, 9, 1), ms(2026, 10, 1)),
    (ms(2026, 9, 1, 0, 0), ms(2026, 9, 1), ms(2026, 10, 1)),
    (ms(2026, 1, 5, 10), ms(2026, 1, 1), ms(2026, 2, 1)),
])
def test_billing_period_calendar_cycle(now, start, end):
    assert billing_period(now, 1, "Asia/Bangkok") == (start, end)


def test_billing_period_mid_month_cycle_rolls_back_before_start_day():
    assert billing_period(ms(2026, 1, 10), 18, "Asia/Bangkok") == (ms(2025, 12, 18), ms(2026, 1, 18))
    assert billing_period(ms(2026, 1, 20), 18, "Asia/Bangkok") == (ms(2026, 1, 18), ms(2026, 2, 18))


def test_status_rules_match_mock():
    rng = {"criticalLow": 20, "warningLow": 35, "warningHigh": 95, "criticalHigh": 98}
    assert [status_from_range(v, rng) for v in (10, 20, 30, 50, 96, 98)] == \
        ["critical", "critical", "warning", "ok", "warning", "critical"]
    assert status_from_range(None, rng) == "ok"
    assert worst_status(["ok", "warning", "offline"]) == "offline"
    assert worst_status(["offline", "critical"]) == "critical"


def test_dew_point_matches_mock_formula():
    # ค่าอ้างอิงจาก dewPoint() ใน lib/mock/store.ts ด้วย node
    assert dew_point(34.5, 68) == 27.7
    assert dew_point(28, 85) == 25.2
    assert dew_point(None, 50) is None
