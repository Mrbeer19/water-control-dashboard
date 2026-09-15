"""เกณฑ์รับงานเฟส 4 งานที่ 3–4 — เข้าสู่ระบบ + ค่าตั้งระบบ กับ stack จริง

รัน: .venv/bin/pytest -m integration tests/test_auth_settings_api.py -v   (make up ก่อน)
★ ทุกเทสในไฟล์นี้แก้ค่าตั้งร่วมกัน — fixture ของโมดูลคืนค่าโรงงานให้เสมอแม้เทสล้ม
"""

from __future__ import annotations

import json
import secrets
import time
from datetime import datetime

import httpx
import pytest

from tests.helpers import wait_for

pytestmark = pytest.mark.integration
API = "http://127.0.0.1:8000"
VALID_GROUP = "C" + "a1" * 16


@pytest.fixture
def api():
    with httpx.Client(base_url=API, timeout=30) as client:
        yield client


@pytest.fixture(scope="module", autouse=True)
def restore_factory_settings(passwords, db):
    yield
    with httpx.Client(base_url=API, timeout=30) as client:
        client.post("/api/auth/login", json={"username": "admin", "password": passwords["admin"]})
        client.post("/api/settings/reset")
    db.rows("DELETE FROM settings_secrets")


# ─────────────── เข้าสู่ระบบ ───────────────

def test_login_session_refresh_logout(api, passwords, db):
    wrong = api.post("/api/auth/login", json={"username": "somchai", "password": "wrong-password-1"}).json()
    ghost = api.post("/api/auth/login", json={"username": "ghost", "password": "wrong-password-1"}).json()
    expected = {"ok": False, "session": None, "errorTh": "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
                "errorEn": "Incorrect username or password"}
    assert wrong == expected and ghost == expected          # ไม่บอกใบ้ว่าชื่อไหนมีอยู่จริง
    assert api.post("/api/auth/login", json={"username": " ", "password": "x"}).json()["errorEn"] == "Enter a username"
    assert api.get("/api/auth/session").json() is None and api.get("/api/auth/me").json() is None

    response = api.post("/api/auth/login", json={"username": "SomChai", "password": passwords["somchai"]})
    result = response.json()
    assert result["ok"] is True and result["errorTh"] is None
    assert result["session"]["user"] == {"id": "user-somchai", "displayName": "ช่างสมชาย", "role": "operator",
                                         "departmentId": "dept-facility", "active": True}
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    token = api.cookies.get("wcm_session")
    assert token and db.rows("SELECT 1 FROM sessions WHERE token_hash = %s", token) == []   # DB เก็บแค่ hash

    session = api.get("/api/auth/session").json()
    lifetime = datetime.fromisoformat(session["expiresAt"]) - datetime.fromisoformat(session["signedInAt"])
    assert 29 * 60 <= lifetime.total_seconds() <= 31 * 60              # security.sessionTimeoutMinutes = 30
    time.sleep(1.1)
    refreshed = api.post("/api/auth/refresh").json()
    assert datetime.fromisoformat(refreshed["expiresAt"]) > datetime.fromisoformat(session["expiresAt"])
    assert api.get("/api/auth/me").json()["id"] == "user-somchai"

    assert api.post("/api/auth/logout").status_code == 204
    with httpx.Client(base_url=API, cookies={"wcm_session": token}) as stale:
        assert stale.get("/api/auth/me").json() is None                # เซิร์ฟเวอร์ยกเลิกจริง ไม่ใช่แค่ลบ cookie
        assert stale.post("/api/auth/refresh").json() is None


def test_repeated_failures_lock_username_even_when_it_does_not_exist(api, db):
    name = f"ghost-{secrets.token_hex(4)}"
    for _ in range(5):
        api.post("/api/auth/login", json={"username": name, "password": "wrong-password-1"})
    locked = api.post("/api/auth/login", json={"username": name, "password": "wrong-password-1"}).json()
    assert locked["ok"] is False and locked["errorEn"].startswith("Too many failed attempts")
    db.rows("DELETE FROM login_failures WHERE username = %s", name)


# ─────────────── ค่าตั้ง ───────────────

def test_settings_are_composed_from_source_tables(api):
    settings = api.get("/api/settings").json()
    assert {"general", "thresholds", "network", "notifications", "billing", "ai", "maintenance", "security",
            "updatedAt", "updatedBy"} <= set(settings)
    assert settings["thresholds"]["tankLevelPercent"]["tank-1"] == {
        "criticalLow": 20, "warningLow": 35, "warningHigh": 95, "criticalHigh": 98}
    assert settings["thresholds"]["unaccountedCriticalPercent"] == 15
    assert [t["ratePerCubicMeter"] for t in settings["billing"]["tiers"]] == [17, 19.5, 21.8, 23.4, 25.6]
    assert settings["billing"]["electricityRatePerKwh"] == 4.18


def test_writes_require_admin(api, signed_in):
    operator = signed_in("somchai")
    assert api.patch("/api/settings/general", json={"siteName": "x"}).json()["code"] == "UNAUTHENTICATED"
    assert operator.patch("/api/settings/general", json={"siteName": "x"}).json()["code"] == "FORBIDDEN"
    for path in ("/api/settings/reset", "/api/settings/import", "/api/settings/network/test"):
        assert operator.post(path, json={}).status_code == 403
    assert operator.get("/api/settings/export").status_code == 403


def test_line_token_is_never_returned_and_mask_does_not_overwrite(api, signed_in, db):
    admin = signed_in("admin")
    line = {"enabled": True, "channelAccessTokenMasked": "real-secret-token-abcd1234",
            "groups": [{"id": "g1", "name": "ทีมซ่อม", "groupId": VALID_GROUP, "active": True}],
            "severityRouting": {"critical": ["g1"], "warning": [], "info": []},
            "quietHours": {"enabled": False, "startTime": "22:00", "endTime": "06:00", "overrideSeverity": "critical"},
            "debounceSeconds": 300, "escalationTimeoutMinutes": 15, "enabledCodes": {"TANK_LEVEL_LOW": True}}
    saved = admin.patch("/api/settings/line", json=line).json()
    assert saved["line"]["channelAccessTokenMasked"] == "••••1234"

    admin.patch("/api/settings/line", json={"debounceSeconds": 120})   # ส่ง mask เดิมกลับไปทั้งก้อน
    assert db.value("SELECT value FROM settings_secrets WHERE key = 'line.channelAccessToken'") == \
        "real-secret-token-abcd1234"
    export = admin.get("/api/settings/export")
    assert "attachment" in export.headers["content-disposition"]
    assert export.json()["line"]["channelAccessTokenMasked"] == "" and export.json()["line"]["debounceSeconds"] == 120
    everything = json.dumps(api.get("/api/settings").json()) + export.text + json.dumps(
        db.rows("SELECT old_value, new_value FROM audit_log WHERE action = 'settings_update'"), default=str)
    assert "real-secret-token" not in everything

    tested = admin.post("/api/settings/line/test", json={"groupId": "g1"}).json()
    assert (tested["ok"], tested["channel"], tested["recipient"]) == (False, "line", "ทีมซ่อม")
    assert tested["message"].startswith("offline_mode")


def test_timezone_with_non_whole_hour_offset_is_rejected(api, signed_in):
    admin = signed_in("admin")
    response = admin.patch("/api/settings/general", json={"timezone": "Asia/Kathmandu"})
    body = response.json()
    assert response.status_code == 400 and body["code"] == "SETTINGS_INVALID"
    assert "whole-hour" in body["messageEn"] and "general.timezone" in body["details"]
    assert "general.timezone" in admin.patch("/api/settings/general", json={"timezone": "Asia/Tokyo"}).json()["details"]
    assert api.get("/api/settings").json()["general"]["timezone"] == "Asia/Bangkok"


def test_patch_is_partial_and_uses_frontend_rules(api, signed_in):
    admin = signed_in("admin")
    bad = admin.patch("/api/settings/billing", json={"billingCycleStartDay": 29, "vatPercent": 120})
    assert bad.status_code == 400
    assert set(bad.json()["details"]) == {"billing.vatPercent", "billing.billingCycleStartDay"}
    assert set(admin.patch("/api/settings/general", json={"refreshIntervalMs": "fast"}).json()["details"]) == \
        {"general.refreshIntervalMs"}
    assert "general.colour" in admin.patch("/api/settings/general", json={"colour": "red"}).json()["details"]
    assert admin.patch("/api/settings/nope", json={}).status_code == 404

    saved = admin.patch("/api/settings/general", json={"siteName": "โรงงานทดสอบ"}).json()
    assert saved["general"]["siteName"] == "โรงงานทดสอบ" and saved["general"]["siteNameEn"] == "Thanyaburi Plant"
    assert saved["updatedBy"]["userId"] == "user-admin"


def test_thresholds_and_tariffs_are_written_to_their_source_tables(api, signed_in, db):
    admin = signed_in("admin")
    thresholds = api.get("/api/settings").json()["thresholds"]
    thresholds["tankLevelPercent"]["tank-1"] = {"criticalLow": 10, "warningLow": 25, "warningHigh": 90,
                                                "criticalHigh": 97}
    assert admin.patch("/api/settings/thresholds", json={"tankLevelPercent": thresholds["tankLevelPercent"]}).is_success
    assert [tuple(float(v) for v in row) for row in db.rows(
        "SELECT crit_low, warn_low, warn_high, crit_high FROM thresholds WHERE entity_id = 'tank-1' "
        "AND metric = 'level_percent'")] == [(10, 25, 90, 97)]
    wait_for(lambda: api.get("/api/tanks/tank-1").json()["thresholdsPercent"]["warningLow"] == 25, 10,
             "สำเนาเกณฑ์ใน Tank ต้องตามตาราง thresholds")
    thresholds["tankLevelPercent"]["tank-1"]["warningLow"] = 5
    assert admin.patch("/api/settings/thresholds", json={"tankLevelPercent": thresholds["tankLevelPercent"]}
                       ).status_code == 400

    billing = api.get("/api/settings").json()["billing"]
    billing["tiers"][0]["ratePerCubicMeter"] = 18
    assert admin.patch("/api/settings/billing", json={"tiers": billing["tiers"]}).is_success
    today = db.rows("""SELECT config FROM tariffs WHERE kind = 'water'
                        AND effective_from = (now() AT TIME ZONE 'Asia/Bangkok')::date""")
    assert today and today[0][0]["tiers"][0]["rate"] == 18
    assert db.value("SELECT count(*) FROM tariffs WHERE kind = 'water'") >= 2           # อัตราเก่ายังอยู่
    assert api.get("/api/settings").json()["billing"]["tiers"][0]["ratePerCubicMeter"] == 18


def test_import_reports_errors_without_writing_then_applies(api, signed_in):
    admin = signed_in("admin")
    assert admin.post("/api/settings/import", json={"foo": 1}).json() == {"ok": False, "errors": [{
        "path": "file", "messageTh": "โครงสร้างไฟล์ไม่ตรงกับค่าตั้งค่าของระบบนี้",
        "messageEn": "File structure does not match this system’s settings"}]}
    exported = admin.get("/api/settings/export").json()
    exported["general"]["siteName"] = " "
    result = admin.post("/api/settings/import", json=exported).json()
    assert result["ok"] is False and [e["path"] for e in result["errors"]] == ["general.siteName"]
    assert api.get("/api/settings").json()["general"]["siteName"] != " "

    exported["general"]["siteName"] = "นำเข้าจากไฟล์"
    assert admin.post("/api/settings/import", json=exported).json() == {"ok": True, "errors": []}
    assert api.get("/api/settings").json()["general"]["siteName"] == "นำเข้าจากไฟล์"


def test_network_test_really_opens_tcp(signed_in):
    admin = signed_in("admin")
    result = admin.post("/api/settings/network/test", json={"mqttHost": "mosquitto", "mqttPort": 1883,
                                                            "plcHost": "mosquitto", "plcPort": 1}).json()
    assert result["mqtt"] is True and result["plc"] is False and isinstance(result["latencyMs"], int)


def test_reset_restores_factory_values(api, signed_in, db):
    admin = signed_in("admin")
    admin.patch("/api/settings/general", json={"siteName": "ก่อนคืนค่า"})
    restored = admin.post("/api/settings/reset").json()
    assert restored["general"]["siteName"] == "โรงงานสาขาธัญบุรี"
    assert restored["thresholds"]["tankLevelPercent"]["tank-1"]["warningLow"] == 35
    assert restored["billing"]["tiers"][0]["ratePerCubicMeter"] == 17
    assert db.value("SELECT count(*) FROM audit_log WHERE action = 'settings_reset'") >= 1
