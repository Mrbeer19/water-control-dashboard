"""กฎตรวจค่าตั้งที่มีเฉพาะฝั่งเซิร์ฟเวอร์ — ไม่ต้องมี DB"""

import copy
import json

import pytest

from api.settings import invalid, masked, server_errors, shape_errors, timezone_errors
from tests.helpers import BACKEND

BASE = json.loads((BACKEND / "tests" / "fixtures" / "settings_golden.json").read_text(encoding="utf-8"))[0]["settings"]


def paths(errors):
    return [e["path"] for e in errors]


def test_kathmandu_is_rejected_for_non_whole_hour_offset():
    errors = timezone_errors("Asia/Kathmandu", None)
    assert paths(errors) == ["general.timezone"] and "whole-hour" in errors[0]["messageEn"]
    assert paths(timezone_errors("America/St_Johns", None)) == ["general.timezone"]   # −03:30 ติดลบก็ต้องจับได้


def test_whole_hour_timezone_must_still_match_aggregates():
    assert timezone_errors("Asia/Bangkok", "Asia/Bangkok") == []
    assert timezone_errors("Asia/Tokyo", None) == []
    assert "rebuild" in timezone_errors("Asia/Tokyo", "Asia/Bangkok")[0]["messageEn"]
    assert "Unknown" in timezone_errors("Mars/Olympus", None)[0]["messageEn"]


def test_frontend_defaults_pass_server_rules():
    assert server_errors(copy.deepcopy(BASE), "Asia/Bangkok") == []


@pytest.mark.parametrize(("mutate", "expected"), [
    (lambda s: s["notifications"].update(minimumSeverity="urgent"), ["notifications.minimumSeverity"]),
    (lambda s: s["notifications"].update(enabledChannels=["email", "fax"]), ["notifications.enabledChannels"]),
    (lambda s: s["notifications"].update(deduplicationWindowMinutes=10.5),
     ["notifications.deduplicationWindowMinutes"]),
    (lambda s: s["notifications"]["quietHours"].update(startTime="25:00"), ["notifications.quietHours.startTime"]),
    (lambda s: s["maintenance"].update(backupTime="2:30"), ["maintenance.backupTime"]),
    (lambda s: s["security"].update(sessionTimeoutMinutes=0), ["security.sessionTimeoutMinutes"]),
    (lambda s: s["security"].update(minimumRoleForControl="root"), ["security.minimumRoleForControl"]),
    (lambda s: s["thresholds"]["tankLevelPercent"]["tank-1"].update(warningLow=10),
     ["thresholds.tankLevelPercent.tank-1"]),
    (lambda s: s["thresholds"].update(unaccountedWarningPercent=20), ["thresholds.unaccountedCriticalPercent"]),
])
def test_server_rules(mutate, expected):
    settings = copy.deepcopy(BASE)
    mutate(settings)
    assert paths(server_errors(settings, "Asia/Bangkok")) == expected


def test_null_threshold_bounds_are_allowed_and_ordered_ignoring_nulls():
    settings = copy.deepcopy(BASE)
    settings["thresholds"]["pumpCurrentAmp"] = {"criticalLow": None, "warningLow": None, "warningHigh": 12,
                                                "criticalHigh": None}
    assert server_errors(settings, "Asia/Bangkok") == []


def test_shape_rejects_unknown_missing_wrong_type_and_null():
    reference = {"siteName": "x", "refreshIntervalMs": 2000, "wallDisplayMode": False,
                 "tiers": [{"maxCubicMeters": 30}]}
    value = {"siteName": 5, "refreshIntervalMs": True, "wallDisplayMode": None, "colour": "red",
             "tiers": [{"maxCubicMeters": None}, {"maxCubicMeters": "30"}]}
    assert paths(shape_errors("general", value, reference)) == [
        "general.colour", "general.siteName", "general.refreshIntervalMs", "general.wallDisplayMode",
        "general.tiers.1.maxCubicMeters"]
    assert paths(shape_errors("general", {"siteName": "x"}, reference)) == [
        "general.refreshIntervalMs", "general.wallDisplayMode", "general.tiers"]
    assert shape_errors("general", {"timezone": "x"}, None) == []


def test_optional_contract_fields_may_be_absent():
    assert shape_errors("general", {"siteName": "x"}, {"siteName": "x", "temperatureUnit": "celsius"}) == []


def test_token_is_masked_to_last_four_characters():
    assert masked("abcdefgh1234") == "••••1234"
    assert masked(None) == "" and masked("") == ""


def test_invalid_flattens_errors_for_api_error_details():
    exc = invalid([{"path": "a", "messageTh": "หนึ่ง", "messageEn": "one"},
                   {"path": "a", "messageTh": "สอง", "messageEn": "two"},
                   {"path": "b", "messageTh": "สาม", "messageEn": "three"}])
    assert exc.status == 400 and exc.code == "SETTINGS_INVALID"
    assert exc.details == {"a": "หนึ่ง · สอง", "b": "สาม"}
    assert exc.message_en.startswith("3 settings error(s) — one")
