"""เกณฑ์รับงานเฟส 4 งานที่ 2 — alert · การรับทราบ · notifier กับ stack จริง

รัน: .venv/bin/pytest -m integration tests/test_alerts_api.py -v   (make up ก่อน)

★ ใช้ env-pump-room + ENV_TEMP_HIGH ซึ่ง simulator ไม่ทำให้เกิดเอง · ลบเฉพาะแถวของตัวเองตอนเริ่ม
★ เปิด/ปิด alert ด้วย SQL ชุดเดียวกับที่ ingest ใช้ (EXEC_SQL) จึงทดสอบกฎกันสแปมของ writer ไปด้วย
★ ทิ้ง alert ที่รับทราบและปิดแล้วไว้ให้ make contract ตรวจรูป RecoveryEvent / AlertAcknowledgement ได้
"""

from __future__ import annotations

import json
import threading
import time

import httpx
import paho.mqtt.client as mqtt
import pytest

from ingest.writer import EXEC_SQL
from tests.helpers import now, wait_for

pytestmark = pytest.mark.integration

API = "http://127.0.0.1:8000"
ENTITY, CODE = "env-pump-room", "ENV_TEMP_HIGH"


def run_op(db, op: str, **params: object) -> None:
    for sql in EXEC_SQL[op]:
        db.run(sql, params)


@pytest.fixture
def api():
    with httpx.Client(base_url=API, timeout=20) as client:
        yield client


@pytest.fixture
def buzzer(env):
    """ฟัง topic บัซเซอร์ด้วยสิทธิ์ของ simulator (อ่านได้ทั้ง plant/water/#)"""
    received: list[dict] = []
    subscribed = threading.Event()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test-buzzer-listener")
    client.username_pw_set("simulator", env["MQTT_PASSWORD_SIMULATOR"])
    client.on_connect = lambda c, *_: c.subscribe("plant/water/buzzer/cmd", qos=1)
    client.on_subscribe = lambda *_: subscribed.set()
    client.on_message = lambda _c, _u, message: received.append(json.loads(message.payload))
    client.connect("127.0.0.1", 1883)
    client.loop_start()
    assert subscribed.wait(10), "subscribe topic บัซเซอร์ไม่สำเร็จ"
    yield received
    client.loop_stop()
    client.disconnect()


def deliveries_of(api, alert_id: str) -> list[dict]:
    return api.get("/api/notifications/deliveries", params={"alertId": alert_id}).json()


def test_alert_lifecycle_notify_acknowledge_resolve_reopen(db, env, api, buzzer):
    db.rows("DELETE FROM alerts WHERE entity_id = %s AND kind = %s", ENTITY, CODE)

    # ── เปิด ──
    run_op(db, "alert_open", entity_id=ENTITY, kind=CODE, severity="critical", started_at=now(),
           peak_value=46.2, threshold=45)
    page = api.get("/api/alerts", params={"sourceIds": ENTITY, "codes": CODE}).json()
    assert page["total"] == 1, page
    alert = page["items"][0]
    alert_id = alert["id"]
    assert (alert["state"], alert["read"], alert["occurrenceCount"]) == ("active", False, 1)
    assert (alert["sourceType"], alert["sourceName"]) == ("sensor", "เซนเซอร์ห้องปั๊ม")
    assert alert["messageTh"] == "อุณหภูมิเซนเซอร์ห้องปั๊ม สูงเกินเกณฑ์วิกฤต"
    assert (alert["triggerValue"], alert["thresholdValue"], alert["unit"]) == (46.2, 45, "°C")
    assert api.get("/api/alerts", params={"severity": "warning", "sourceIds": ENTITY}).json()["total"] == 0

    # ── notifier: ค่าตั้งต้นเปิด email (2 ผู้รับ) + buzzer (1 ตู้) ──
    def settled() -> list[dict] | None:
        rows = deliveries_of(api, alert_id)
        return rows if len(rows) == 3 and all(r["deliveryState"] in ("delivered", "failed") for r in rows) else None

    deliveries = wait_for(settled, 20, "notifier ต้องสร้างและส่งครบ 3 รายการภายใน 20 วินาที")
    assert sorted(r["channel"] for r in deliveries) == ["buzzer", "email", "email"]
    buzz = next(r for r in deliveries if r["channel"] == "buzzer")
    assert (buzz["deliveryState"], buzz["recipient"], buzz["attempts"]) == ("delivered", "ตู้คอนโทรลหลัก", 1)
    message = wait_for(lambda: [m for m in buzzer if m["alertId"] == alert_id], 5, "ต้องได้คำสั่งบัซเซอร์ทาง MQTT")[0]
    assert (message["cabinet"], message["pattern"], message["code"]) == ("ตู้คอนโทรลหลัก", "continuous", CODE)

    mail = next(r for r in deliveries if r["channel"] == "email")
    if not env.get("SMTP_HOST"):
        # เครื่อง dev ไม่มีเมลเซิร์ฟเวอร์ → ล้มทันทีพร้อมบอกเหตุ ไม่ลองซ้ำเปล่า ๆ
        assert (mail["deliveryState"], mail["attempts"]) == ("failed", 1)
        assert "SMTP_HOST" in mail["errorMessage"]
        assert api.post(f"/api/notifications/deliveries/{mail['id']}/retry").json()["deliveryState"] == "queued"
        wait_for(lambda: next(r for r in deliveries_of(api, alert_id) if r["id"] == mail["id"])["attempts"] == 2,
                 15, "กดส่งซ้ำแล้ว notifier ต้องลองอีกครั้ง")
    assert api.post(f"/api/notifications/deliveries/{buzz['id']}/retry").status_code == 409

    # ── preview = ข้อความเดียวกับที่ส่งจริง ──
    preview = api.get(f"/api/alerts/{alert_id}/preview", params={"channel": "buzzer"}).json()
    assert (preview["recipient"], preview["deliveryState"]) == ("ตู้คอนโทรลหลัก", "delivered")
    assert preview["title"] == "🔴 วิกฤต · โรงงานสาขาธัญบุรี"
    assert "ค่าที่วัดได้: 46.2 °C (เกณฑ์ 45 °C)" in preview["body"].split("\n")
    line = api.get(f"/api/alerts/{alert_id}/preview", params={"channel": "line"}).json()
    assert (line["recipient"], line["deliveryState"]) == ("-", None)

    # ── อ่าน · รับทราบ ──
    assert api.post(f"/api/alerts/{alert_id}/read").json()["read"] is True
    ack_url = f"/api/alerts/{alert_id}/acknowledge"
    assert api.post(ack_url, json={"acknowledgedByUserId": "user-accounting"}).status_code == 403
    assert api.post(ack_url, json={"acknowledgedByUserId": "nobody"}).status_code == 400
    assert api.post(ack_url, json={"acknowledgedByUserId": "user-somchai", "snoozeMinutes": 0}).status_code == 400
    ack = api.post(ack_url, json={"acknowledgedByUserId": "user-somchai", "note": "เปิดพัดลมแล้ว",
                                  "snoozeMinutes": 30}).json()
    assert ack["acknowledgedBy"] == {"userId": "user-somchai", "displayName": "ช่างสมชาย", "role": "operator"}
    assert (ack["note"], ack["snoozeMinutes"]) == ("เปิดพัดลมแล้ว", 30)
    current = api.get(f"/api/alerts/{alert_id}").json()
    assert (current["state"], current["acknowledgementId"]) == ("acknowledged", ack["id"])
    acks = api.get("/api/alerts/acknowledgements", params={"alertId": alert_id}).json()
    assert [a["id"] for a in acks] == [ack["id"]]
    assert db.rows("SELECT 1 FROM audit_log WHERE action = 'alert_acknowledge' AND target = %s", f"alert:{alert_id}")

    # ── ปิด → หน้าเหตุการณ์ที่คลี่คลาย ──
    run_op(db, "alert_close", entity_id=ENTITY, kind=CODE, ended_at=now(), peak_value=None)
    resolved = api.get(f"/api/alerts/{alert_id}").json()
    assert resolved["state"] == "resolved" and resolved["resolvedAt"] is not None
    recovery = next(r for r in api.get("/api/alerts/recoveries", params={"limit": 100}).json()
                    if r["alertId"] == alert_id)
    assert recovery["acknowledgedBy"]["userId"] == "user-somchai"
    assert (recovery["durationMinutes"], recovery["minutesToAcknowledge"]) == (0, 0)

    # ── เกิดซ้ำภายในหน้าต่างกันสแปม → แถวเดิม นับเพิ่ม ไม่ส่งรอบใหม่ ──
    run_op(db, "alert_open", entity_id=ENTITY, kind=CODE, severity="warning", started_at=now(),
           peak_value=41.0, threshold=40)
    rows = db.rows("SELECT occurrence_count, severity, ended_at FROM alerts WHERE entity_id = %s AND kind = %s",
                   ENTITY, CODE)
    assert rows == [(2, "critical", None)], rows
    again = api.get(f"/api/alerts/{alert_id}").json()
    assert (again["occurrenceCount"], again["state"]) == (2, "acknowledged")
    time.sleep(5)   # มากกว่า 2 รอบของ notifier
    assert len(deliveries_of(api, alert_id)) == 3

    run_op(db, "alert_close", entity_id=ENTITY, kind=CODE, ended_at=now(), peak_value=None)


def test_alert_filters_ids_and_bodies_are_validated(api):
    assert api.get("/api/alerts", params={"severity": "urgent"}).json()["code"] == "VALIDATION_FAILED"
    assert api.get("/api/alerts", params={"codes": "NOT_A_CODE"}).status_code == 400
    assert api.get("/api/alerts", params={"limit": 0}).status_code == 400
    assert api.get("/api/alerts/abc").status_code == 404
    assert api.get("/api/alerts/999999999").json()["code"] == "ALERT_NOT_FOUND"
    assert api.get("/api/alerts/1/preview", params={"channel": "fax"}).status_code == 400
    assert api.post("/api/notifications/deliveries/999999999/retry").status_code == 404
    missing = api.post("/api/alerts/999999999/acknowledge", json={"acknowledgedByUserId": "user-somchai"})
    assert missing.status_code == 404
    page = api.get("/api/alerts", params={"severity": "critical,warning", "limit": 2}).json()
    assert page["limit"] == 2 and len(page["items"]) <= 2
    counts = api.get("/api/alerts/unread-count").json()
    assert set(counts) == {"total", "critical"} and counts["critical"] <= counts["total"]
    assert isinstance(api.post("/api/alerts/read-all").json(), int)
