"""ตรรกะเงินของรายงาน — ไม่ต้องมี docker"""

from __future__ import annotations

from api.reports import Tariff, bill, js_round
from api.usage import water_tiers

SEED = {"tiers": [{"min_m3": 0, "max_m3": 30, "rate": 17.0}, {"min_m3": 30, "max_m3": 50, "rate": 19.5},
                  {"min_m3": 50, "max_m3": 80, "rate": 21.8}, {"min_m3": 80, "max_m3": 100, "rate": 23.4},
                  {"min_m3": 100, "max_m3": None, "rate": 25.6}], "service_charge": 90, "vat_percent": 7}
WATER = Tariff(water_tiers(SEED), 90.0, 7.0)


def test_js_round_rounds_half_up_like_math_round_not_bankers():
    assert js_round(2.5, 0) == 3.0 and round(2.5) == 2
    assert js_round(0.125) == 0.13 and round(0.125, 2) == 0.12
    assert js_round(-0.5, 0) == 0.0


def test_tiers_are_cumulative_so_45_m3_is_not_45_times_the_second_rate():
    result = bill(45, WATER)
    assert [(t["cubicMeters"], t["amountBaht"]) for t in result["tierBreakdown"]] == [(30, 510.0), (15, 292.5)]
    assert result["subtotalBaht"] == 802.5 != 45 * 19.5
    assert abs(result["vatBaht"] - (802.5 + 90) * 0.07) <= 0.005
    assert result["totalBaht"] == js_round(802.5 + 90 + result["vatBaht"])


def test_zero_usage_still_pays_service_charge_with_vat():
    result = bill(0, WATER)
    assert result["tierBreakdown"] == [] and result["subtotalBaht"] == 0
    assert result["totalBaht"] == 96.3


def test_top_tier_has_no_ceiling():
    result = bill(130, WATER)
    assert result["tierBreakdown"][-1]["cubicMeters"] == 30
    assert result["subtotalBaht"] == js_round(30 * 17 + 20 * 19.5 + 30 * 21.8 + 20 * 23.4 + 30 * 25.6)


def test_flat_rate_tariff_is_one_uncapped_tier():
    flat = Tariff([{"id": "tier-electric", "name": "flat", "minCubicMeters": 0, "maxCubicMeters": None,
                    "ratePerCubicMeter": 4.5772}], 0.0, 7.0)
    result = bill(100, flat)
    assert result["subtotalBaht"] == 457.72 and result["serviceChargeBaht"] == 0
