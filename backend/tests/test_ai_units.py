"""unit test ของทางรับผลจากทีม AI — ไม่ต้องมี DB"""

import pytest
from pydantic import ValidationError
from starlette.requests import Request

from api import ai
from api.errors import ApiException


def request_with(headers: dict[str, str]) -> Request:
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]})


def test_compact_never_invents_missing_fields():
    assert ai.compact({"id": "1", "resolvedAt": None}, {"score": None, "severity": "warning", "extra": {}}) == \
        {"id": "1", "resolvedAt": None, "severity": "warning", "extra": {}}


def test_minimal_anomaly_row_renders_only_what_was_sent():
    row = {"id": 5, "anomaly_type": "brand_new_type", "detected_at": None, "status": "active", "resolved_at": None,
           "feedback": None, "alert_id": None, "evidence": None, "expected_band": None, "suggested_action": None,
           "detector": None, "score": None, "severity": None, "source_type": "zone", "source_id": "zone-7",
           "entity_name": "โซน 7", "metric": None, "window_start": None, "window_end": None, "features": None,
           "model_name": None, "summary_th": None, "summary_en": None, "extra": None}
    rendered = ai.to_anomaly(row, "Asia/Bangkok")
    assert set(rendered) == {"id", "type", "detectedAt", "status", "resolvedAt", "feedback", "alertId", "sourceType",
                             "sourceId", "sourceName"}
    assert rendered["type"] == "brand_new_type"          # string เปิด ไม่ถูกแปลงหรือปฏิเสธ


def test_contract_payload_is_accepted_in_camel_case_and_open_strings_pass():
    item = ai.AnomalyIn.model_validate({
        "id": "ai-1", "type": "pipe_burst_risk", "detectedAt": "2026-09-14T02:10:00+07:00", "sourceId": "zone-7",
        "detector": "some_future_detector", "score": 0.4, "evidence": [{"timestamp": 1, "value": 2.5}],
        "expectedBand": {"lower": [], "upper": []}, "features": [{"key": "flow_lpm", "value": 1.0}],
        "extra": {"nights": 3, "confirmedBy": None}})
    assert item.detected_at.utcoffset() is not None and item.detector == "some_future_detector"


@pytest.mark.parametrize("payload", [
    {"type": "night_leak", "detectedAt": "2026-09-14T02:10:00", "sourceId": "zone-7"},          # ไม่มี offset
    {"type": "", "detectedAt": "2026-09-14T02:10:00+07:00", "sourceId": "zone-7"},             # type ว่าง
    {"type": "night_leak", "detectedAt": "2026-09-14T02:10:00+07:00", "targetId": "zone-7"},   # ชื่อ field ผิดสัญญา
    {"type": "night_leak", "detectedAt": "2026-09-14T02:10:00+07:00", "severity": "urgent"},
])
def test_invalid_anomaly_payloads_are_rejected(payload):
    with pytest.raises(ValidationError):
        ai.AnomalyIn.model_validate(payload)


def test_unit_ranges_are_enforced_for_probabilities():
    with pytest.raises(ValidationError):
        ai.ForecastIn.model_validate({"target": "tank_level", "generatedAt": "2026-09-14T00:00:00+07:00",
                                      "confidence": 1.2})
    with pytest.raises(ValidationError):
        ai.MaintenanceIn.model_validate({"targetType": "pump", "targetId": "pump-1",
                                         "generatedAt": "2026-09-14T00:00:00+07:00", "failureProbability": 63})


def test_threshold_range_keeps_all_four_keys_when_stored():
    metric = ai.MetricIn.model_validate({"key": "pump_efficiency", "computedAt": "2026-09-14T00:00:00+07:00",
                                         "thresholds": {"criticalLow": 0.5, "warningLow": 0.65, "warningHigh": None,
                                                        "criticalHigh": None}})
    assert ai._dump(metric.thresholds).obj == {"criticalLow": 0.5, "warningLow": 0.65, "warningHigh": None,  # type: ignore[union-attr]
                                               "criticalHigh": None}


def test_writer_accepts_service_token_only_when_configured(monkeypatch):
    monkeypatch.setenv("AI_INGEST_TOKEN", "s3cret-token")
    assert ai.ai_writer(request_with({"Authorization": "Bearer s3cret-token"})) == "ai-service"
    with pytest.raises(ApiException) as wrong:
        ai.ai_writer(request_with({"Authorization": "Bearer guess"}))
    assert wrong.value.status == 401
    monkeypatch.setenv("AI_INGEST_TOKEN", "")
    with pytest.raises(ApiException):
        ai.ai_writer(request_with({"Authorization": "Bearer "}))      # token ว่างต้องไม่เปิดทางให้ใครก็ได้


def test_batch_limit():
    assert ai._batch({"a": 1}) == [{"a": 1}]
    with pytest.raises(ApiException):
        ai._batch([{}] * (ai.MAX_BATCH + 1))
