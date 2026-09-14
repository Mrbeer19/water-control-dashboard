"""endpoint ผลจากทีม AI (PROMPT_04 งานที่ 6) — ตรงกับ lib/services/ai.ts และ docs/AI_CONTRACT.md

★ อ่าน: ไม่ต้องล็อกอิน (D-41) · ปิดเคส/ส่งผลตรวจ: operator ขึ้นไป · ส่งผลเข้า: บริการ AI (token) หรือ admin
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Body, Query, Response
from pydantic import BaseModel, ConfigDict

from . import ai
from .alerts import SEVERITIES, SOURCE_TYPES, parse_id
from .auth import Operator
from .common import parse_time
from .db import pool
from .errors import bad_request, not_found
from .registry import registry

router = APIRouter(prefix="/api/ai")
STATUSES = ("active", "resolved", "dismissed")


def _list(raw: list[str] | None, allowed: tuple[str, ...] | None, field: str) -> list[str] | None:
    """รับได้ทั้ง ?x=a&x=b และ ?x=a,b · allowed=None = string เปิด"""
    items = [part.strip() for chunk in raw or [] for part in chunk.split(",") if part.strip()]
    for item in items if allowed is not None else []:
        if item not in allowed:
            raise bad_request("VALIDATION_FAILED", f"ค่า {field} ไม่ถูกต้อง: {item}", f"Invalid {field}: {item}",
                              field=field)
    return items or None


def _cached(response: Response) -> None:
    response.headers["Cache-Control"] = "max-age=1"


# ─────────────── ความผิดปกติ ───────────────

@router.get("/anomalies")
def get_anomalies(
    response: Response,
    type_: Annotated[list[str] | None, Query(alias="type")] = None,
    status: Annotated[list[str] | None, Query()] = None,
    detector: Annotated[list[str] | None, Query()] = None,
    severity: Annotated[list[str] | None, Query()] = None,
    source_type: Annotated[list[str] | None, Query(alias="sourceType")] = None,
    min_score: Annotated[float | None, Query(alias="minScore", ge=0, le=1)] = None,
    frm: Annotated[str | None, Query(alias="from")] = None,
    to: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, object]:
    query = ai.AnomalyFilter(
        types=_list(type_, None, "type"), statuses=_list(status, STATUSES, "status"),
        detectors=_list(detector, None, "detector"), severities=_list(severity, SEVERITIES, "severity"),
        source_types=_list(source_type, SOURCE_TYPES, "sourceType"), min_score=min_score,
        from_ms=parse_time(frm, 0, "from") if frm else None, to_ms=parse_time(to, 0, "to") if to else None,
        limit=limit, offset=offset)
    with pool.connection() as conn:
        body = ai.list_anomalies(conn, registry(conn).timezone, query)
    _cached(response)
    return body


@router.post("/anomalies", status_code=201)
def post_anomaly(body: ai.AnomalyIn, _writer: ai.AiWriter) -> dict[str, object]:
    with pool.connection() as conn:
        return ai.ingest_anomaly(conn, registry(conn).timezone, body)


@router.get("/anomalies/{anomaly_id}")
def get_anomaly(anomaly_id: str) -> dict[str, object]:
    with pool.connection() as conn:
        return ai.require_anomaly(conn, registry(conn).timezone, parse_id(anomaly_id, "ANOMALY"))


class FeedbackBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feedback: Literal["confirmed", "false_positive"] | None


class StatusBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["active", "resolved", "dismissed"]


@router.post("/anomalies/{anomaly_id}/feedback")
def post_feedback(anomaly_id: str, body: FeedbackBody, user: Operator) -> dict[str, object]:
    """★ ผลตรวจหน้างานให้ทีม AI ใช้ปรับโมเดล — ไม่ใช่การปิดเคส"""
    with pool.connection() as conn:
        return ai.review_anomaly(conn, registry(conn).timezone, parse_id(anomaly_id, "ANOMALY"), user.user_id,
                                 feedback=body.feedback)


@router.post("/anomalies/{anomaly_id}/status")
def post_status(anomaly_id: str, body: StatusBody, user: Operator) -> dict[str, object]:
    with pool.connection() as conn:
        return ai.review_anomaly(conn, registry(conn).timezone, parse_id(anomaly_id, "ANOMALY"), user.user_id,
                                 status=body.status)


# ─────────────── พยากรณ์ · บำรุงรักษา · ค่าที่คำนวณ ───────────────

@router.get("/forecast", response_model=None)
def get_forecast(response: Response, target: str | None = None,
                 target_id: Annotated[str | None, Query(alias="targetId")] = None,
                 horizon: str | None = None) -> dict[str, object] | list[dict[str, object]]:
    """ระบุ target = รายการล่าสุดรายการเดียว (getForecast) · ไม่ระบุ = ทุกรายการที่มี (getForecasts)"""
    with pool.connection() as conn:
        found = ai.forecasts(conn, registry(conn).timezone, target, target_id, horizon)
    _cached(response)
    if target is None:
        return found
    if not found:
        raise not_found("FORECAST_NOT_FOUND", f"ทีม AI ยังไม่ได้ส่งผลพยากรณ์ {target}",
                        f"No forecast for {target} has been received from the AI service", target=target)
    return found[0]


@router.post("/forecasts", status_code=201)
def post_forecasts(body: Annotated[ai.ForecastIn | list[ai.ForecastIn], Body()],
                   _writer: ai.AiWriter) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return ai.ingest_forecasts(conn, registry(conn).timezone, ai._batch(body))


@router.get("/maintenance")
def get_maintenance(response: Response, target_type: Annotated[str | None, Query(alias="targetType")] = None,
                    target_id: Annotated[str | None, Query(alias="targetId")] = None) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = ai.maintenance(conn, registry(conn).timezone, target_type, target_id)
    _cached(response)
    return body


@router.post("/maintenance", status_code=201)
def post_maintenance(body: Annotated[ai.MaintenanceIn | list[ai.MaintenanceIn], Body()],
                     _writer: ai.AiWriter) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return ai.ingest_maintenance(conn, registry(conn).timezone, ai._batch(body))


@router.get("/metrics")
def get_metrics(
    response: Response,
    key: Annotated[list[str] | None, Query()] = None,
    scope_type: Annotated[list[str] | None, Query(alias="scopeType")] = None,
    scope_id: Annotated[list[str] | None, Query(alias="scopeId")] = None,
    abnormal_only: Annotated[bool, Query(alias="abnormalOnly")] = False,
) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = ai.metrics(conn, registry(conn).timezone, _list(key, None, "key"),
                          _list(scope_type, SOURCE_TYPES, "scopeType"), _list(scope_id, None, "scopeId"), abnormal_only)
    _cached(response)
    return body


@router.post("/metrics", status_code=201)
def post_metrics(body: Annotated[ai.MetricIn | list[ai.MetricIn], Body()],
                 _writer: ai.AiWriter) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return ai.ingest_metrics(conn, registry(conn).timezone, ai._batch(body))


# ─────────────── สถานะบริการ ───────────────

@router.get("/status")
def get_status(response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = ai.service_status(conn, registry(conn).timezone)
    _cached(response)
    return body


@router.put("/status")
def put_status(body: ai.StatusIn, _writer: ai.AiWriter) -> dict[str, object]:
    """สัญญาณชีพจากบริการ AI — ส่งอย่างน้อยทุก 5 นาที ไม่งั้นหน้าจอขึ้นว่าติดต่อไม่ได้"""
    with pool.connection() as conn:
        ai.report_status(conn, body)
        return ai.service_status(conn, registry(conn).timezone)
