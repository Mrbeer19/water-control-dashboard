"""unit test ของด่านตรวจคำสั่งและตารางเวลา — ไม่ต้องมี DB/MQTT

★ กฎที่ใช้ทดสอบอ่านจาก db/06_seed.sql ตัวจริง — แก้ข้อความ/พารามิเตอร์ใน seed แล้วเทสยังตรวจของจริงเสมอ
"""

import json
import re
from datetime import datetime

import pytest

from api import interlock
from api.control import next_run, to_result
from api.interlock import Context, Rule, Target
from tests.helpers import BACKEND, BKK

ROW = re.compile(r"\('([A-Z_]+)', '(\w+)', '(\w+)', '\{([^}]*)\}', '(\{.*?\})',\s*'(.*?)',\s*'(.*?)',"
                 r"\s*(true|false), (true|false), (\d+)\)", re.S)


def seed_rules() -> list[Rule]:
    sql = (BACKEND / "db" / "06_seed.sql").read_text(encoding="utf-8")
    block = sql[sql.index("INSERT INTO interlock_rules"):]
    block = block[:block.index(";\n")]
    rules = [Rule(m[0], m[1], m[2], tuple(a for a in m[3].split(",") if a), json.loads(m[4]), m[5], m[6],
                  m[7] == "true", m[8] == "true") for m in ROW.findall(block)]
    assert len(rules) == block.count("\n  ('"), "แกะแถวใน seed ได้ไม่ครบ"
    return rules


RULES = seed_rules()


def context(**overrides) -> Context:
    zones = {f"zone-{i}": {"id": f"zone-{i}", "name": f"โซน {i}", "nameEn": f"Zone {i}", "isVip": i == 8}
             for i in (1, 2, 8)}
    base = {
        "lockout": False,
        "tanks": {"tank-1": {"id": "tank-1", "name": "ถังใต้ดินหลัก", "nameEn": "Main Underground Tank",
                             "percentFull": 60.0, "status": "ok"}},
        "pumps": {
            "pump-1": {"id": "pump-1", "name": "ปั๊มหลัก 1", "nameEn": "Main Pump 1", "sourceTankId": "tank-1",
                       "runState": "stopped", "controlMode": "auto", "hasVfd": False, "faultCode": None,
                       "servesZoneIds": ["zone-1", "zone-2"]},
            "pump-3": {"id": "pump-3", "name": "ปั๊มโซน VIP", "nameEn": "VIP Zone Pump", "sourceTankId": "tank-2",
                       "runState": "stopped", "controlMode": "pid", "hasVfd": True, "faultCode": None,
                       "servesZoneIds": ["zone-8"]}},
        "valves": {f"valve-zone-{i}": {"id": f"valve-zone-{i}", "zoneId": f"zone-{i}", "position": "open",
                                       "remoteEnabled": True} for i in (1, 2, 8)},
        "zones": zones,
        "pressure": {"setpointLimitsBar": {"min": 1.5, "max": 4.5}},
        "closing": set(),
        "recent_closes": lambda seconds: 0,
    }
    base.update(overrides)
    return Context(**base)


def target(kind: str, ident: str) -> Target:
    return Target(kind, ident, ident, ident)


def codes(violations) -> list[str]:
    return [v.rule.rule_id for v in violations]


def check(ctx, kind, ident, action, value=None, automatic=False, confirmed=False):
    return interlock.evaluate(ctx, RULES, target(kind, ident), action, value, automatic, confirmed)


def test_every_seeded_rule_has_an_implementation_and_covers_mock_codes():
    assert {rule.check_name for rule in RULES} <= set(interlock.CHECKS)
    mock = (BACKEND.parent / "lib" / "mock" / "control.ts").read_text(encoding="utf-8")
    mock_codes = set(re.findall(r"reason\(\s*'([A-Z_]+)'", mock)) | set(re.findall(r"code: '([A-Z_]+)'", mock))
    assert mock_codes - {"NOT_FOUND", "BLOCKED"} <= {rule.rule_id for rule in RULES}, mock_codes


def test_vip_close_never_passes_automatically_and_needs_confirmation_by_hand():
    ctx = context()
    automatic = check(ctx, "valve", "valve-zone-8", "close", automatic=True)
    assert codes(automatic) == ["VIP_AUTO_CLOSE"] and not automatic[0].confirmable
    manual = check(ctx, "valve", "valve-zone-8", "close")
    assert codes(manual) == ["VIP_ZONE"] and manual[0].confirmable
    assert check(ctx, "valve", "valve-zone-8", "close", confirmed=True) == []
    assert check(ctx, "valve", "valve-zone-8", "close", automatic=True, confirmed=True) != []   # โทเคนช่วยระบบอัตโนมัติไม่ได้
    assert check(ctx, "valve", "valve-zone-8", "open", automatic=True) == []
    assert interlock.requires_confirmation(ctx, RULES, target("valve", "valve-zone-8"), "close")
    assert not interlock.requires_confirmation(ctx, RULES, target("valve", "valve-zone-1"), "close")


def test_low_source_tank_blocks_pump_start_with_readable_thai_message():
    low = context(tanks={"tank-1": {"id": "tank-1", "name": "ถังใต้ดินหลัก", "nameEn": "Main Underground Tank",
                                    "percentFull": 8.57, "status": "critical"}})
    violations = check(low, "pump", "pump-1", "start")
    assert codes(violations) == ["SOURCE_TANK_LOW"]
    assert violations[0].message_th == "ถังใต้ดินหลักต่ำกว่า 15% (8.6%) — สตาร์ตแล้วปั๊มจะดูดแห้ง"
    assert check(low, "pump", "pump-1", "stop") == []
    stale = context(tanks={"tank-1": {**low.tanks["tank-1"], "status": "offline"}})
    assert codes(check(stale, "pump", "pump-1", "start")) == ["SOURCE_TANK_LOW"]   # เซนเซอร์เพิ่งหลุด ค่าล่าสุดยังต่ำ = ยังห้าม
    never = context(tanks={"tank-1": {**low.tanks["tank-1"], "status": "offline", "percentFull": 0,
                                      "lastSeen": "1970-01-01T07:00:00.000+07:00"}})
    assert check(never, "pump", "pump-1", "start") == []              # ไม่เคยได้ค่าเลย ≠ ต่ำ (PLC มีด่านของตัวเอง)


def test_close_rate_limit_and_last_open_outlet_of_running_pump():
    busy = context(recent_closes=lambda seconds: 3)
    violation = check(busy, "valve", "valve-zone-1", "close")
    assert codes(violation) == ["VALVE_CLOSE_RATE"] and "3 ตัวใน 10 วินาที" in violation[0].message_th
    assert check(busy, "valve", "valve-zone-1", "open") == []

    running = context()
    running.pumps["pump-1"]["runState"] = "running"
    assert check(running, "valve", "valve-zone-1", "close") == []
    running.valves["valve-zone-2"]["position"] = "closed"
    assert codes(check(running, "valve", "valve-zone-1", "close")) == ["PUMP_DOWNSTREAM_CLOSED"]
    running.valves["valve-zone-2"]["position"] = "open"
    running.closing.add("valve-zone-2")                               # กำลังจะถูกปิดก็นับว่าไม่เหลือแล้ว
    assert codes(check(running, "valve", "valve-zone-1", "close")) == ["PUMP_DOWNSTREAM_CLOSED"]


def test_lockout_blocks_everything_except_emergency_stop():
    locked = context(lockout=True)
    assert "CONTROL_LOCKED" in codes(check(locked, "valve", "valve-zone-1", "open"))
    assert "CONTROL_LOCKED" in codes(check(locked, "pump", "pump-1", "stop"))
    assert check(locked, "system", "system", "emergency_stop") == []
    listed = interlock.interlock_for(locked, RULES, target("valve", "valve-zone-1"), ("open", "close"))
    assert listed["blocked"] is True and listed["blockedActions"] == []
    assert listed["reasons"][0]["code"] == "CONTROL_LOCKED"


def test_value_ranges_vfd_and_fault_rules():
    ctx = context()
    assert codes(check(ctx, "valve", "valve-zone-1", "set_open_percent", 150.0)) == ["BAD_VALUE"]
    assert codes(check(ctx, "valve", "valve-zone-1", "set_open_percent", "abc")) == ["BAD_VALUE"]
    assert check(ctx, "valve", "valve-zone-1", "set_open_percent", 60.0) == []
    setpoint = check(ctx, "pressure_control", "pressure-control-1", "set_setpoint", 5.0)
    assert codes(setpoint) == ["SETPOINT_OUT_OF_RANGE"] and "1.5–4.5 bar" in setpoint[0].message_th
    assert codes(check(ctx, "pump", "pump-1", "set_mode", "pid")) == ["NO_VFD"]
    assert check(ctx, "pump", "pump-3", "set_mode", "pid") == []
    ctx.pumps["pump-1"] |= {"runState": "fault", "faultCode": "F07"}
    assert check(ctx, "pump", "pump-1", "start")[0].message_th == "ปั๊มขัดข้อง (F07) ต้องเคลียร์ก่อนจึงสั่งเดินได้"
    listed = interlock.interlock_for(ctx, RULES, target("pump", "pump-1"), ("start", "stop", "set_mode", "reset_fault"))
    assert listed["blockedActions"] == ["start"] and listed["blocked"] is True


def test_system_commands_cannot_be_scheduled_and_mass_valve_actions_need_confirmation():
    ctx = context()
    assert codes(check(ctx, "system", "system", "close_all", automatic=True)) == ["SYSTEM_AUTO"]
    manual = check(ctx, "system", "system", "close_all")
    assert codes(manual) == ["SYSTEM_CONFIRM"] and manual[0].confirmable
    assert check(ctx, "system", "system", "emergency_stop") == []


def test_vip_valve_listing_warns_but_does_not_block():
    listed = interlock.interlock_for(context(), RULES, target("valve", "valve-zone-8"), ("open", "close"))
    assert listed == {"targetType": "valve", "targetId": "valve-zone-8", "blocked": False, "blockedActions": [],
                      "reasons": [{"code": "VIP_ZONE", "messageTh": "โซน VIP — ต้องยืนยันสองชั้นก่อนตัดน้ำ",
                                   "messageEn": "VIP zone — closing requires a second confirmation"}]}


def test_unknown_check_name_fails_closed():
    broken = Rule("TYPO", "valve", "no_such_check", ("open",), {}, "x", "x", True, True)
    violations = interlock.evaluate(context(), [broken], target("valve", "valve-zone-1"), "open", None, False, False)
    assert codes(violations) == ["TYPO"] and "ระงับคำสั่ง" in violations[0].message_th


@pytest.mark.parametrize(("after", "repeat", "days", "expected"), [
    (datetime(2026, 9, 14, 10, 0, tzinfo=BKK), "daily", [], datetime(2026, 9, 14, 22, 0, tzinfo=BKK)),
    (datetime(2026, 9, 14, 23, 0, tzinfo=BKK), "daily", [], datetime(2026, 9, 15, 22, 0, tzinfo=BKK)),
    # ตรงเวลาพอดี = รอบหน้า
    (datetime(2026, 9, 14, 22, 0, tzinfo=BKK), "once", [], datetime(2026, 9, 15, 22, 0, tzinfo=BKK)),
    (datetime(2026, 9, 19, 23, 0, tzinfo=BKK), "weekdays", [], datetime(2026, 9, 21, 22, 0, tzinfo=BKK)),  # เสาร์ → จันทร์
    (datetime(2026, 9, 14, 23, 0, tzinfo=BKK), "weekly", [0], datetime(2026, 9, 20, 22, 0, tzinfo=BKK)),  # 0 = อาทิตย์
])
def test_next_run_in_plant_time(after, repeat, days, expected):
    assert next_run("22:00", repeat, days, True, after, "Asia/Bangkok") == expected
    assert next_run("22:00", repeat, days, False, after, "Asia/Bangkok") is None


def test_timeout_is_reported_as_unknown_not_failed():
    row = {"command_id": "3f9b1b8e-5c1f-4f0e-9a51-2b1e0c7d9a10", "status": "timeout", "reject_code": None,
           "reject_reason": None, "sent_at": None, "confirmed_at": None, "latency_ms": None, "feedback_value": None}
    result = to_result(row, "Asia/Bangkok")
    assert (result["state"], result["errorCode"]) == ("timeout", "FEEDBACK_TIMEOUT")
    assert "ไม่ทราบผล" in result["errorMessage"]
    rejected = to_result(row | {"status": "rejected", "reject_code": "VIP_AUTO_CLOSE", "reject_reason": "ห้าม"},
                         "Asia/Bangkok")
    assert (rejected["state"], rejected["errorCode"]) == ("failed", "VIP_AUTO_CLOSE")
    assert to_result(row | {"status": "confirmed", "feedback_value": "closed", "latency_ms": 840},
                     "Asia/Bangkok")["state"] == "success"
