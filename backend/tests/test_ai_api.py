"""เกณฑ์รับงานเฟส 4 งานที่ 6 — ผลจากทีม AI กับ stack จริง

รัน: .venv/bin/pytest -m integration tests/test_ai_api.py -v   (make up ก่อน)
★ ทิ้งผลที่ส่งเข้าไว้ในฐานข้อมูล ให้ make contract ตรวจรูปของทุก endpoint ได้
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

import httpx
import pytest

pytestmark = pytest.mark.integration
API = "http://127.0.0.1:8000"


def at(minutes_ago: int = 0) -> str:
    return (datetime.now(UTC) - timedelta(minutes=minutes_ago)).astimezone().isoformat(timespec="seconds")


@pytest.fixture
def api():
    with httpx.Client(base_url=API, timeout=20) as client:
        yield client


def test_anomaly_without_source_id_is_rejected_with_readable_error(api, signed_in):
    admin = signed_in("admin")
    missing = admin.post("/api/ai/anomalies", json={"type": "night_leak", "detectedAt": at()})
    body = missing.json()
    assert missing.status_code == 400 and body["code"] == "SOURCE_ID_REQUIRED"
    assert "sourceId" in body["messageEn"] and "หมุด" in body["messageTh"]

    unknown = admin.post("/api/ai/anomalies", json={"type": "night_leak", "detectedAt": at(), "sourceId": "zone-99"})
    assert unknown.json()["code"] == "SOURCE_NOT_FOUND"
    percent = admin.post("/api/ai/anomalies", json={"type": "night_leak", "detectedAt": at(), "sourceId": "zone-7",
                                                    "score": 87})
    assert percent.json()["code"] == "SCORE_OUT_OF_RANGE" and "divide" in percent.json()["messageEn"]
    mismatch = admin.post("/api/ai/anomalies", json={"type": "x", "detectedAt": at(), "sourceId": "zone-7",
                                                     "sourceType": "pump"})
    assert mismatch.json()["code"] == "SOURCE_TYPE_MISMATCH"
    anonymous = api.post("/api/ai/anomalies", json={"type": "x", "detectedAt": at(), "sourceId": "zone-7"})
    assert anonymous.status_code == 401
    assert signed_in("somchai").post("/api/ai/anomalies", json={}).status_code in (400, 403)


def test_anomaly_roundtrip_open_types_partial_fields_alert_and_review(api, signed_in, db):
    admin, operator = signed_in("admin"), signed_in("somchai")
    # รอบก่อนที่ล้มกลางทางอาจทิ้ง alert ของโซนนี้ค้างไว้ — ปิดก่อนให้ผลของเทสนี้เป็นของรอบนี้จริง
    db.rows("UPDATE alerts SET ended_at = now() WHERE entity_id = 'zone-7' AND kind = 'ANOMALY_DETECTED' "
            "AND ended_at IS NULL")
    external = f"ai-test-{secrets.token_hex(4)}"
    minimal = admin.post("/api/ai/anomalies", json={"id": external, "type": "brand_new_type_xyz",
                                                    "detectedAt": at(30), "sourceId": "zone-7"})
    assert minimal.status_code == 201
    first = minimal.json()
    assert (first["type"], first["status"], first["sourceType"], first["sourceId"]) == \
        ("brand_new_type_xyz", "active", "zone", "zone-7")
    assert first["sourceName"] and not {"score", "severity", "evidence", "features", "detector"} & set(first)
    assert first["alertId"] is None                        # ไม่มี severity → ไม่เปิด alert

    full = admin.post("/api/ai/anomalies", json={
        "id": external, "type": "night_leak", "detectedAt": at(30), "sourceId": "zone-7", "score": 0.82,
        "severity": "warning", "detector": "isolation_forest", "metric": "flow_lpm",
        "evidence": [{"timestamp": 1_789_400_000_000, "value": 14.2}],
        "features": [{"key": "flow_lpm", "value": 14.2, "expected": 1.0, "contribution": 0.7}],
        "summaryTh": "มีน้ำไหลต่อเนื่องกลางดึก", "extra": {"nights": 3}}).json()
    assert full["id"] == first["id"] and full["score"] == 0.82 and full["extra"] == {"nights": 3}   # ส่งซ้ำ = แถวเดิม
    alert = api.get(f"/api/alerts/{full['alertId']}").json()
    assert (alert["code"], alert["anomalyEventId"], alert["sourceId"], alert["state"]) == \
        ("ANOMALY_DETECTED", full["id"], "zone-7", "active")

    unscored = admin.post("/api/ai/anomalies", json={"type": "sensor_drift", "detectedAt": at(5),
                                                     "sourceId": "tank-1"}).json()
    high = [i["id"] for i in api.get("/api/ai/anomalies", params={"minScore": 0.9, "limit": 500}).json()["items"]]
    assert unscored["id"] in high and full["id"] not in high          # ไม่มี score ต้องไม่ถูกกรองทิ้งเงียบ ๆ
    zones = api.get("/api/ai/anomalies", params={"sourceType": "zone", "type": "night_leak", "limit": 500}).json()
    assert full["id"] in [i["id"] for i in zones["items"]] and unscored["id"] not in [i["id"] for i in zones["items"]]
    assert api.get("/api/ai/anomalies", params={"severity": "urgent"}).status_code == 400

    url = f"/api/ai/anomalies/{full['id']}"
    assert api.post(f"{url}/feedback", json={"feedback": "confirmed"}).status_code == 401
    reviewed = operator.post(f"{url}/feedback", json={"feedback": "confirmed"}).json()
    assert (reviewed["feedback"], reviewed["status"]) == ("confirmed", "active")   # feedback ไม่ใช่การปิดเคส
    closed = operator.post(f"{url}/status", json={"status": "dismissed"}).json()
    assert closed["status"] == "dismissed" and closed["resolvedAt"] is not None
    assert api.get(f"/api/alerts/{full['alertId']}").json()["state"] == "resolved"

    resent = admin.post("/api/ai/anomalies", json={"id": external, "type": "night_leak", "detectedAt": at(30),
                                                   "sourceId": "zone-7", "status": "active"}).json()
    assert (resent["status"], resent["feedback"]) == ("dismissed", "confirmed")    # การตัดสินของคนไม่ถูกทับ
    assert api.get("/api/ai/anomalies/999999999").json()["code"] == "ANOMALY_NOT_FOUND"


def test_forecasts_maintenance_metrics_and_service_status(api, signed_in):
    admin = signed_in("admin")
    stamp = int(datetime.now(UTC).timestamp() * 1000)
    created = admin.post("/api/ai/forecasts", json=[{
        "id": "fc-tank-1-24h", "target": "tank_level", "targetId": "tank-1", "generatedAt": at(), "horizon": "24h",
        "unit": "%", "confidence": 0.8,
        "forecast": [{"timestamp": stamp + 3_600_000, "value": 60, "lowerBound": 55, "upperBound": 65}]}]).json()
    assert isinstance(created, list) and created[0]["target"] == "tank_level"
    single = api.get("/api/ai/forecast", params={"target": "tank_level", "targetId": "tank-1"}).json()
    assert single["forecast"][0]["lowerBound"] == 55 and "value" not in single
    assert api.get("/api/ai/forecast", params={"target": "never_sent"}).json()["code"] == "FORECAST_NOT_FOUND"
    assert "tank_level" in {f["target"] for f in api.get("/api/ai/forecast").json()}

    bad = admin.post("/api/ai/maintenance", json={"targetType": "pump", "targetId": "pump-1", "generatedAt": at(),
                                                  "healthScore": 150})
    assert bad.json()["code"] == "HEALTH_SCORE_OUT_OF_RANGE" and "opposite" in bad.json()["messageEn"]
    admin.post("/api/ai/maintenance", json={"id": "mt-pump-1", "targetType": "pump", "targetId": "pump-1",
                                            "generatedAt": at(), "healthScore": 62, "failureProbability": 0.4,
                                            "trend": "down", "recommendationTh": "ตรวจแบริ่ง"})
    [pump] = api.get("/api/ai/maintenance", params={"targetId": "pump-1"}).json()
    assert (pump["healthScore"], pump["targetName"], pump["trend"]) == (62, "ปั๊มหลัก 1", "down")

    admin.post("/api/ai/metrics", json=[
        {"key": "pump_efficiency", "computedAt": at(), "value": 0.71, "scopeId": "pump-1", "status": "warning",
         "thresholds": {"criticalLow": 0.5, "warningLow": 0.75, "warningHigh": None, "criticalHigh": None}},
        {"key": "leak_index", "computedAt": at(), "value": 0.1, "status": "ok", "higherIsWorse": True}])
    abnormal = api.get("/api/ai/metrics", params={"abnormalOnly": "true"}).json()
    assert "pump_efficiency" in {m["key"] for m in abnormal} and "leak_index" not in {m["key"] for m in abnormal}
    efficiency = next(m for m in abnormal if m["key"] == "pump_efficiency")
    assert efficiency["scopeType"] == "pump" and efficiency["thresholds"]["warningHigh"] is None

    assert api.put("/api/ai/status", json={"models": ["x"]}).status_code == 401
    status = admin.put("/api/ai/status", json={"models": ["isolation-forest-v1"], "mode": "live", "accuracy": 0.91,
                                               "message": None, "summaryText": "ตรวจครบ 28 จุด"}).json()
    assert status["reachable"] is True and status["models"] == ["isolation-forest-v1"]
    assert status["lastResultAt"] is not None and status["accuracy"] == 0.91
