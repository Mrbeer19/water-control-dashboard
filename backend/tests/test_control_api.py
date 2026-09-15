"""เกณฑ์รับงานเฟส 5 ทั้ง 8 ข้อ — สั่งงานจริงผ่าน API · interlock · MQTT · feedback · timeout

รัน: .venv/bin/pytest -m integration tests/test_control_api.py -v   (make up ก่อน)

★ ปิด simulator ระหว่างเทส — เทสเล่นเป็น ESP32/PLC เองด้วยรหัสและ ACL ของอุปกรณ์จริง
  จึงคุมระดับน้ำ ตำแหน่งวาล์ว และการตอบ/ไม่ตอบ feedback ได้แน่นอน แล้วเปิด simulator คืนตอนจบ
"""

from __future__ import annotations

import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from tests.helpers import BACKEND, iso, now, wait_for

pytestmark = pytest.mark.integration
API = "http://127.0.0.1:8000"
SIM = ["docker", "compose", "-f", "docker-compose.yml", "-f", "docker-compose.sim.yml"]


@pytest.fixture(scope="module", autouse=True)
def quiet_plant(db):
    subprocess.run([*SIM, "stop", "simulator"], cwd=BACKEND, check=True, capture_output=True, timeout=120)
    try:
        yield
    finally:
        # เก็บกวาดให้ระบบกลับสภาพปกติเสมอ แม้เทสล้มกลางทาง · เปิด simulator คืนก่อนอย่างอื่น
        subprocess.run([*SIM, "up", "-d", "simulator"], cwd=BACKEND, check=False, capture_output=True, timeout=300)
        db.rows("UPDATE settings SET value = jsonb_set(value, '{controlLockout}', 'false') WHERE section = 'security'")
        db.rows("""UPDATE entities SET spec = (spec - 'controlModeBeforeLockout') || jsonb_build_object(
                       'controlMode', coalesce(spec->'controlModeBeforeLockout', '"auto"'::jsonb))
                    WHERE source_type = 'pump' AND spec->>'controlMode' = 'locked_out'""")
        db.rows("DELETE FROM state_spans WHERE metric = 'valve_position'")
        db.rows("DELETE FROM command_schedules")
        db.rows("DELETE FROM login_failures WHERE starts_with(username, 'pin:')")


@pytest.fixture
def api():
    with httpx.Client(base_url=API, timeout=30) as client:
        yield client


def forget_recent_closes(db) -> None:
    """ให้เพดานปิดวาล์วของเทสก่อนหน้าไม่ลามมาเทสนี้ (ย้อนเวลาคำสั่งเก่าออกนอกหน้าต่าง)"""
    db.rows("UPDATE commands SET created_at = created_at - interval '1 hour' WHERE target_kind = 'valve'")


class Device:
    """เล่นเป็นอุปกรณ์ปลายทาง — subscribe cmd ตาม ACL ของอุปกรณ์จริง แล้วตอบ feedback หรือเงียบ"""

    def __init__(self, device_factory, device_id: str, topics: list[str], reply: bool = True) -> None:
        self.received: list[tuple[str, dict]] = []
        self.reply = reply
        self.node = device_factory(device_id)
        self.node.client.on_message = self._on_message
        for topic in topics:
            self.node.client.subscribe(topic, qos=1)
        time.sleep(0.8)

    def _on_message(self, _client, _userdata, message) -> None:
        payload = json.loads(message.payload)
        self.received.append((message.topic, payload))
        if self.reply and message.topic.endswith("/cmd"):
            _base1, _base2, kind, ident, _cmd = message.topic.split("/")
            body = {"commandId": payload["commandId"], "ok": True, "at": iso(now())}
            position = {"open": "open", "close": "closed"}.get(payload.get("action"))
            if position:
                body["position"] = position
            self.node.client.publish(f"plant/water/{kind}/{ident}/feedback", json.dumps(body), qos=1)


def result_of(client: httpx.Client, command_id: str, state: str, timeout: float) -> dict:
    def reached() -> dict | None:
        result = client.get(f"/api/control/commands/{command_id}").json()
        return result if result["state"] == state else None
    return wait_for(reached, timeout, f"คำสั่ง {command_id} ต้องถึงสถานะ {state}")


# ─────────────── เกณฑ์ข้อ 1 ───────────────

def stop_vip_pump(api, device) -> None:
    """ปั๊ม VIP เดินอยู่ = วาล์ว VIP เป็นทางจ่ายเดียว ด่าน PUMP_DOWNSTREAM_CLOSED จะปฏิเสธก่อนถึงเรื่องยืนยันสองชั้น"""
    device("esp32-vip").telemetry("pump", "pump-3", now(), {"runState": "stopped"})

    def stopped() -> bool:
        return next(p for p in api.get("/api/pumps").json() if p["id"] == "pump-3")["runState"] == "stopped"
    wait_for(stopped, 15, "ปั๊ม VIP ต้องหยุดก่อน")


def test_1_closing_vip_zone_by_curl_is_409_and_audited(api, db, signed_in, pins, device):
    stop_vip_pump(api, device)
    operator = signed_in("somchai")
    response = operator.post("/api/control/valve/zone-8", json={"action": "close", "pin": pins["somchai"]})
    body = response.json()
    assert response.status_code == 409 and body["code"] == "CONFIRMATION_REQUIRED"
    assert body["details"]["confirmToken"] and body["messageTh"] == "โซน VIP — ต้องยืนยันสองชั้นก่อนตัดน้ำ"
    command_id = body["details"]["commandId"]
    assert db.rows("SELECT status, reject_code FROM commands WHERE command_id = %s", command_id) == \
        [("rejected", "CONFIRMATION_REQUIRED")]
    assert db.rows("SELECT result FROM audit_log WHERE command_id = %s", command_id) == [("rejected",)]

    assert api.post("/api/control/valve/zone-8", json={"action": "close"}).status_code == 401
    assert signed_in("accounting").post("/api/control/valve/zone-8", json={"action": "close"}).json()["code"] == \
        "FORBIDDEN"
    assert operator.post("/api/control/valve/zone-8", json={"action": "close"}).json()["code"] == "PIN_REQUIRED"
    assert operator.post("/api/control/valve/zone-8", json={"action": "close", "pin": "0000"}).json()["code"] \
        in ("PIN_INVALID",) or pins["somchai"] == "0000"


# ─────────────── เกณฑ์ข้อ 2 ───────────────

def test_2_same_command_from_a_schedule_is_rejected(api, db, signed_in, pins):
    operator = signed_in("somchai")
    operator.post("/api/control/unlock", json={"pin": pins["somchai"]})
    blocked = operator.post("/api/control/schedules", json={"targetType": "valve", "targetId": "valve-zone-8",
                                                            "action": "close", "time": "03:00", "repeat": "daily"})
    assert blocked.status_code == 409 and blocked.json()["code"] == "SCHEDULE_ALWAYS_BLOCKED"

    # ตารางที่หลุดเข้ามาในฐานข้อมูลได้ (เช่นนำเข้าจากที่อื่น) ต้องถูกด่านตอนถึงเวลาอยู่ดี
    schedule_id = db.value("""INSERT INTO command_schedules (target_kind, target_id, action, value, run_time, repeat,
                                                             enabled, next_run_at, created_by)
                              VALUES ('valve', 'valve-zone-8', 'close', 'null'::jsonb, '03:00', 'daily', true,
                                      now() - interval '1 second', 'user-somchai') RETURNING schedule_id""")
    issuer = f"schedule:{schedule_id}"
    rows = wait_for(lambda: db.rows("SELECT status, reject_code, command_id FROM commands WHERE issued_by = %s",
                                    issuer),
                    25, "dispatcher ต้องเดินตารางที่ถึงเวลา")
    assert rows[0][:2] == ("rejected", "VIP_AUTO_CLOSE")
    assert db.rows("SELECT result, user_id FROM audit_log WHERE command_id = %s", rows[0][2]) == [("rejected", issuer)]
    listed = next(s for s in api.get("/api/control/schedules").json() if s["id"] == str(schedule_id))
    assert listed["lastResultState"] == "failed" and listed["nextRunAt"] is not None


# ─────────────── เกณฑ์ข้อ 3 · 6 · 7 ───────────────

def test_3_6_7_confirmed_vip_close_goes_to_esp32_and_reports_real_latency(api, db, signed_in, pins, device):
    forget_recent_closes(db)
    stop_vip_pump(api, device)
    vip = Device(device, "esp32-vip", ["plant/water/valve/valve-zone-8/cmd"])
    plc = Device(device, "plc-1", ["plant/water/pump/+/cmd", "plant/water/pressure/+/cmd"], reply=False)
    operator = signed_in("somchai")
    request = {"action": "close", "pin": pins["somchai"], "reason": "ซ่อมท่อโซน VIP"}
    token = operator.post("/api/control/valve/valve-zone-8", json=request).json()["details"]["confirmToken"]

    accepted = operator.post("/api/control/valve/valve-zone-8", json=request | {"confirmToken": token})
    assert accepted.status_code == 202
    entry = accepted.json()
    assert entry["command"]["requiresConfirmation"] is True and entry["result"]["state"] == "awaiting_feedback"
    result = result_of(operator, entry["command"]["id"], "success", 10)
    assert isinstance(result["latencyMs"], int) and 0 < result["latencyMs"] < 10_000
    assert result["feedbackValue"] == "closed"

    assert [topic for topic, _ in vip.received] == ["plant/water/valve/valve-zone-8/cmd"]   # ★ ไป ESP32
    assert plc.received == []                                                              # ★ ไม่ไป PLC
    assert vip.received[0][1]["commandId"] == entry["command"]["id"]
    assert db.rows("SELECT result, latency_ms > 0 FROM audit_log WHERE command_id = %s", entry["command"]["id"]) == \
        [("confirmed", True)]
    assert next(v for v in api.get("/api/valves").json() if v["id"] == "valve-zone-8")["position"] == "closed"

    reused = operator.post("/api/control/valve/valve-zone-8", json=request | {"confirmToken": token})
    assert reused.status_code == 409 and reused.json()["code"] == "CONFIRMATION_REQUIRED"     # โทเคนใช้ได้ครั้งเดียว

    reopened = operator.post("/api/control/valve/valve-zone-8", json={"action": "open", "pin": pins["somchai"]})
    result_of(operator, reopened.json()["command"]["id"], "success", 10)


# ─────────────── เกณฑ์ข้อ 4 ───────────────

def test_4_six_simultaneous_closes_are_capped_not_all_accepted(db, signed_in, pins, device):
    forget_recent_closes(db)
    Device(device, "esp32-valve-bank", [f"plant/water/valve/valve-zone-{i}/cmd" for i in range(1, 8)])
    operator = signed_in("somchai")
    assert operator.post("/api/control/unlock", json={"pin": pins["somchai"]}).json()["unlockedUntil"]

    def close(zone: int) -> httpx.Response:
        with httpx.Client(base_url=API, timeout=30, cookies=operator.cookies) as client:
            return client.post(f"/api/control/valve/valve-zone-{zone}", json={"action": "close"})

    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(close, range(1, 7)))
    assert sorted(r.status_code for r in responses) == [202, 202, 202, 409, 409, 409]
    rejected = [r.json() for r in responses if r.status_code == 409]
    assert {(r["code"], r["details"]["rule"]) for r in rejected} == {("INTERLOCK_REJECTED", "VALVE_CLOSE_RATE")}
    for response in responses:
        if response.status_code == 202:
            result_of(operator, response.json()["command"]["id"], "success", 10)
    db.rows("DELETE FROM state_spans WHERE metric = 'valve_position'")
    forget_recent_closes(db)


# ─────────────── เกณฑ์ข้อ 5 ───────────────

def test_5_no_feedback_becomes_timeout_not_failed(db, signed_in, pins, device):
    silent = Device(device, "esp32-valve-bank", ["plant/water/valve/valve-zone-7/cmd"], reply=False)
    operator = signed_in("somchai")
    started = time.monotonic()
    response = operator.post("/api/control/valve/valve-zone-7", json={"action": "open", "pin": pins["somchai"]})
    assert response.status_code == 202
    command_id = response.json()["command"]["id"]
    result = result_of(operator, command_id, "timeout", 20)
    assert time.monotonic() - started >= 9.5
    assert result["errorCode"] == "FEEDBACK_TIMEOUT" and "ไม่ทราบผล" in result["errorMessage"]
    assert silent.received, "คำสั่งต้องถึงอุปกรณ์จริง แค่ไม่มี feedback กลับมา"
    assert db.rows("SELECT status FROM commands WHERE command_id = %s", command_id) == [("timeout",)]
    assert db.rows("SELECT result FROM audit_log WHERE command_id = %s", command_id) == [("timeout",)]


# ─────────────── เกณฑ์ข้อ 8 ───────────────

def test_8_low_tank_blocks_pump_start_with_thai_reason(api, signed_in, pins, device):
    node = device("esp32-pump-house")
    node.telemetry("tank", "tank-1", now(), {"levelMeters": 0.3})
    wait_for(lambda: api.get("/api/tanks/tank-1").json()["percentFull"] < 15, 15, "ระดับถัง 1 ต้องต่ำลงก่อน")
    try:
        operator = signed_in("somchai")
        response = operator.post("/api/control/pump/pump-1", json={"action": "start", "pin": pins["somchai"]})
        body = response.json()
        assert response.status_code == 409 and body["details"]["rule"] == "SOURCE_TANK_LOW"
        assert body["messageTh"].startswith("ถังใต้ดินหลักต่ำกว่า 15%") and "ดูดแห้ง" in body["messageTh"]
        pump = next(i for i in api.get("/api/control/interlocks").json() if i["targetId"] == "pump-1")
        assert "start" in pump["blockedActions"] and pump["reasons"][0]["code"] == "SOURCE_TANK_LOW"
    finally:
        node.telemetry("tank", "tank-1", now(), {"levelMeters": 2.4})


# ─────────────── หยุดฉุกเฉิน · ตารางเวลา · บันทึก ───────────────

def test_emergency_stop_locks_all_control_until_cleared(api, db, signed_in, pins, device):
    plc = Device(device, "plc-1", ["plant/water/pump/+/cmd"])
    operator = signed_in("somchai")
    pin = pins["somchai"]
    stopped = operator.post("/api/control/system", json={"action": "emergency_stop", "pin": pin})
    assert stopped.status_code == 202
    result = result_of(operator, stopped.json()["command"]["id"], "success", 12)
    assert result["feedbackValue"] == "all_stopped"
    assert sorted(topic for topic, _ in plc.received) == [f"plant/water/pump/pump-{i}/cmd" for i in (1, 2, 3)]
    assert db.value("SELECT value->>'controlLockout' FROM settings WHERE section = 'security'") == "true"
    assert {p["controlMode"] for p in api.get("/api/pumps").json()} == {"locked_out"}

    locked = operator.post("/api/control/valve/valve-zone-1", json={"action": "open", "pin": pin})
    assert locked.status_code == 409 and locked.json()["details"]["rule"] == "CONTROL_LOCKED"
    assert all(i["blocked"] for i in api.get("/api/control/interlocks").json())

    cleared = operator.post("/api/control/system/clear-lockout", json={"pin": pin})
    assert cleared.status_code == 200 and cleared.json()["result"]["state"] == "success"
    assert db.value("SELECT value->>'controlLockout' FROM settings WHERE section = 'security'") == "false"
    modes = {p["id"]: p["controlMode"] for p in api.get("/api/pumps").json()}
    assert modes == {"pump-1": "auto", "pump-2": "auto", "pump-3": "pid"}                 # คืนโหมดเดิม


def test_schedules_crud_and_command_log(api, signed_in, pins):
    operator = signed_in("somchai")
    assert signed_in("accounting").post("/api/control/schedules", json={}).status_code in (400, 403)
    operator.post("/api/control/unlock", json={"pin": pins["somchai"]})
    created = operator.post("/api/control/schedules", json={"targetType": "valve", "targetId": "valve-zone-7",
                                                            "action": "close", "time": "22:00", "repeat": "daily"})
    assert created.status_code == 201
    schedule = created.json()
    assert schedule["nextRunAt"].endswith("T22:00:00.000+07:00") and schedule["createdBy"]["userId"] == "user-somchai"
    assert operator.post("/api/control/schedules", json={"targetType": "valve", "targetId": "valve-zone-7",
                                                         "action": "open", "time": "05:30",
                                                         "repeat": "weekly"}).status_code == 400
    paused = operator.patch(f"/api/control/schedules/{schedule['id']}", json={"enabled": False}).json()
    assert paused["enabled"] is False and paused["nextRunAt"] is None
    assert operator.delete(f"/api/control/schedules/{schedule['id']}").json() is True
    assert operator.delete(f"/api/control/schedules/{schedule['id']}").status_code == 404

    log = api.get("/api/control/commands", params={"limit": 200}).json()
    states = {entry["result"]["state"] for entry in log}
    assert {"failed", "timeout", "success"} <= states
    assert all(entry["result"]["state"] != "failed" or entry["result"]["errorCode"] for entry in log)
