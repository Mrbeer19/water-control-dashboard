"""ผลจากทีม AI (PROMPT_04 งานที่ 6) — backend รับ เก็บ และเสิร์ฟตาม docs/AI_CONTRACT.md · ไม่เขียนโมเดลเอง

ทางเข้า (บริการ AI → backend): POST /api/ai/anomalies · /forecasts · /maintenance · /metrics · PUT /api/ai/status
ทางออก (หน้าจอ): GET ตาม TODO(backend) ใน lib/services/ai.ts

★ type · detector · target · key · trend · horizon · format เป็น string เปิด ห้ามทำ enum ปิด
★ score 0–1 (สูง = แย่) · healthScore 0–100 (สูง = ดี) ทิศทางกลับกัน — นอกช่วงปฏิเสธพร้อมบอกเหตุ ไม่เดาหารให้
★ sourceId บังคับและต้องเป็น entity ที่มีจริง — ไม่มีแล้วหมุดไม่ขึ้นบนกราฟ
★ field ที่ทีม AI ไม่ได้ส่งมา จะไม่มีใน response เลย ไม่เติม null หรือค่าปลอม (หลักการข้อ 3 ของสัญญา)
"""

from __future__ import annotations

import hmac
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal

import psycopg
from fastapi import Depends, Request
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .auth import current_user
from .common import iso_dt, iso_required, num
from .errors import ApiException, bad_request, not_found
from .latest import publish
from .series import to_dt

MAX_POINTS = 10_000
MAX_BATCH = 500
HEARTBEAT_MINUTES = 5

Severity = Literal["critical", "warning", "info"]
SourceType = Literal["tank", "pump", "zone", "valve", "meter", "sensor", "device", "electric_node", "pressure_control",
                     "system"]
Primitive = str | int | float | bool | None
Name = Annotated[str, Field(min_length=1, max_length=200)]
Text = Annotated[str, Field(max_length=4000)]
Unit01 = Annotated[float, Field(ge=0, le=1)]


# ─────────────── รูปข้อมูลขาเข้า (camelCase ตามสัญญา) ───────────────

class _In(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class PointIn(_In):
    timestamp: int
    value: float


class ForecastPointIn(PointIn):
    lower_bound: float | None = None
    upper_bound: float | None = None


class BandIn(_In):
    lower: list[PointIn] = Field(max_length=MAX_POINTS)
    upper: list[PointIn] = Field(max_length=MAX_POINTS)


class FeatureIn(_In):
    key: Name
    value: float
    expected: float | None = None
    contribution: Unit01 | None = None


class RangeIn(_In):
    critical_low: float | None
    warning_low: float | None
    warning_high: float | None
    critical_high: float | None


class AnomalyIn(_In):
    id: Name | None = None
    type: Name
    detected_at: AwareDatetime
    status: Literal["active", "resolved", "dismissed"] = "active"
    resolved_at: AwareDatetime | None = None
    evidence: list[PointIn] | None = Field(None, max_length=MAX_POINTS)
    expected_band: BandIn | None = None
    suggested_action: Text | None = None
    feedback: Literal["confirmed", "false_positive"] | None = None
    detector: Name | None = None
    score: float | None = None
    severity: Severity | None = None
    source_type: SourceType | None = None
    source_id: str | None = None
    source_name: Name | None = None
    metric: Name | None = None
    window_start: AwareDatetime | None = None
    window_end: AwareDatetime | None = None
    features: list[FeatureIn] | None = Field(None, max_length=500)
    alert_id: str | None = None
    model_name: Name | None = None
    summary_th: Text | None = None
    summary_en: Text | None = None
    extra: dict[str, Primitive] | None = None


class ForecastIn(_In):
    id: Name | None = None
    target: Name
    generated_at: AwareDatetime
    target_id: Name | None = None
    target_name: Name | None = None
    metric: Name | None = None
    unit: Name | None = None
    horizon_hours: float | None = Field(None, ge=0)
    history: list[PointIn] | None = Field(None, max_length=MAX_POINTS)
    forecast: list[ForecastPointIn] | None = Field(None, max_length=MAX_POINTS)
    model_name: Name | None = None
    mape_percent: float | None = Field(None, ge=0)
    horizon: Name | None = None
    value: float | None = None
    expected_at: AwareDatetime | None = None
    confidence: Unit01 | None = None
    summary_th: Text | None = None
    summary_en: Text | None = None


class MaintenanceIn(_In):
    id: Name | None = None
    target_type: SourceType
    target_id: Name
    generated_at: AwareDatetime
    target_name: Name | None = None
    failure_probability: Unit01 | None = None
    days_until_service: float | None = None
    estimated_issue_date: AwareDatetime | None = None
    health_score: float | None = None
    trend: Name | None = None
    features: list[FeatureIn] | None = Field(None, max_length=500)
    model_name: Name | None = None
    note: Text | None = None
    recommendation_th: Text | None = None
    recommendation_en: Text | None = None


class MetricIn(_In):
    key: Name
    computed_at: AwareDatetime
    value: float | None = None
    text: Text | None = None
    unit: Name | None = None
    format: Name | None = None
    decimals: int | None = Field(None, ge=0, le=10)
    scope_type: SourceType | None = None
    scope_id: Name | None = None
    scope_name: Name | None = None
    target: float | None = None
    thresholds: RangeIn | None = None
    status: Literal["ok", "warning", "critical", "offline"] | None = None
    previous_value: float | None = None
    change_percent: float | None = None
    trend: Name | None = None
    higher_is_worse: bool | None = None
    confidence: Unit01 | None = None
    basis: list[FeatureIn] | None = Field(None, max_length=500)
    series: list[PointIn] | None = Field(None, max_length=MAX_POINTS)
    model_name: Name | None = None
    summary_th: Text | None = None
    summary_en: Text | None = None
    extra: dict[str, Primitive] | None = None


class StatusIn(_In):
    models: list[Name] = Field(default_factory=list, max_length=50)
    message: Text | None = None
    mode: Name | None = None
    last_trained_at: AwareDatetime | None = None
    training_days: float | None = Field(None, ge=0)
    accuracy: Unit01 | None = None
    false_positive_rate: Unit01 | None = None
    summary_text: Text | None = None


# ─────────────── สิทธิ์ของผู้ส่งผล ───────────────

def ai_writer(request: Request) -> str:
    """บริการ AI ใช้ Authorization: Bearer <AI_INGEST_TOKEN> · หรือผู้ดูแลระบบที่ล็อกอิน (ใช้ทดสอบ/นำเข้ามือ)"""
    token = os.environ.get("AI_INGEST_TOKEN", "")
    supplied = request.headers.get("authorization", "")
    if token and hmac.compare_digest(supplied.encode(), f"Bearer {token}".encode()):
        return "ai-service"
    user = current_user(request)
    if user is None:
        raise ApiException(401, "UNAUTHENTICATED", "ต้องใช้ token ของบริการ AI หรือเข้าสู่ระบบด้วยผู้ดูแลระบบ",
                           "AI service token or admin session required")
    if user.role != "admin":
        raise ApiException(403, "FORBIDDEN", "ส่งผลของ AI ได้เฉพาะบริการ AI หรือผู้ดูแลระบบ",
                           "Only the AI service or an administrator may submit AI results", {"role": user.role})
    return user.user_id


AiWriter = Annotated[str, Depends(ai_writer)]


# ─────────────── ตัวช่วย ───────────────

def _dump(value: object) -> Jsonb | None:
    if value is None:
        return None
    if isinstance(value, RangeIn):
        return Jsonb(value.model_dump(by_alias=True))                  # ThresholdRange ต้องมีครบ 4 key
    if isinstance(value, BaseModel):
        return Jsonb(value.model_dump(by_alias=True, exclude_none=True))
    if isinstance(value, list):
        return Jsonb([v.model_dump(by_alias=True, exclude_none=True) if isinstance(v, BaseModel) else v for v in value])
    return Jsonb(value)


def compact(required: dict[str, object], optional: dict[str, object]) -> dict[str, object]:
    """★ ของที่ไม่ได้ส่งมาไม่มีใน response — ไม่เติม null/ค่าปลอม"""
    return {**required, **{key: value for key, value in optional.items() if value is not None}}


def _entity(conn: psycopg.Connection, entity_id: str, declared: str | None, field: str) -> tuple[str, str]:
    row = conn.execute("SELECT source_type, name FROM entities WHERE entity_id = %s", (entity_id,)).fetchone()
    if row is None:
        raise bad_request("SOURCE_NOT_FOUND", f"{field} {entity_id} ไม่มีในทะเบียนอุปกรณ์ของระบบ",
                          f"{field} {entity_id} is not a known entity", field=field)
    if declared is not None and declared != row[0]:
        raise bad_request("SOURCE_TYPE_MISMATCH", f"{entity_id} เป็นชนิด {row[0]} ไม่ใช่ {declared}",
                          f"{entity_id} is a {row[0]}, not {declared}", field=field)
    return str(row[0]), str(row[1])


def _upsert(conn: psycopg.Connection, table: str, values: dict[str, object], keep: tuple[str, ...] = (),
            touch: str = "") -> int:
    """แถวที่มี external_id เดิม = อัปเดต · คอลัมน์ใน keep ไม่ถูกทับ (ของที่คนตัดสินแล้ว)"""
    columns = list(values)
    updates = [f"{c} = EXCLUDED.{c}" for c in columns if c != "external_id" and c not in keep]
    updates += [touch] if touch else []
    row = conn.execute(f"""INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(f'%({c})s' for c in columns)})
                           ON CONFLICT (external_id) DO UPDATE SET {', '.join(updates)} RETURNING id""",
                       values).fetchone()
    return int(row[0])  # type: ignore[index]


def _rows(conn: psycopg.Connection, query: str, params: list[object] | tuple[object, ...]) -> list[dict[str, object]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params)  # type: ignore[arg-type]
        return cur.fetchall()


def _audit(conn: psycopg.Connection, user_id: str, action: str, target: str, value: object) -> None:
    conn.execute("INSERT INTO audit_log (user_id, action, target, new_value, result) VALUES (%s, %s, %s, %s, 'ok')",
                 (user_id, action, target, json.dumps(value, ensure_ascii=False)))


def _batch(body: object) -> list:
    items = body if isinstance(body, list) else [body]
    if len(items) > MAX_BATCH:
        raise bad_request("BATCH_TOO_LARGE", f"ส่งได้ครั้งละไม่เกิน {MAX_BATCH} รายการ",
                          f"At most {MAX_BATCH} items per request", limit=MAX_BATCH)
    return items


# ─────────────── ความผิดปกติ ───────────────

ANOMALY_SELECT = """SELECT a.*, e.name AS entity_name FROM ai_anomalies a
                     LEFT JOIN entities e ON e.entity_id = a.source_id"""


def to_anomaly(row: dict[str, object], tz: str) -> dict[str, object]:
    return compact(
        {"id": str(row["id"]), "type": row["anomaly_type"], "detectedAt": iso_required(row["detected_at"], tz),  # type: ignore[arg-type]
         "status": row["status"], "resolvedAt": iso_dt(row["resolved_at"], tz), "feedback": row["feedback"],  # type: ignore[arg-type]
         "alertId": None if row["alert_id"] is None else str(row["alert_id"])},
        {"evidence": row["evidence"], "expectedBand": row["expected_band"], "suggestedAction": row["suggested_action"],
         "detector": row["detector"], "score": num(row["score"], 4), "severity": row["severity"],
         "sourceType": row["source_type"], "sourceId": row["source_id"], "sourceName": row["entity_name"],
         "metric": row["metric"], "windowStart": iso_dt(row["window_start"], tz),  # type: ignore[arg-type]
         "windowEnd": iso_dt(row["window_end"], tz), "features": row["features"],  # type: ignore[arg-type]
         "modelName": row["model_name"], "summaryTh": row["summary_th"], "summaryEn": row["summary_en"],
         "extra": row["extra"]})


def get_anomaly(conn: psycopg.Connection, tz: str, anomaly_id: int) -> dict[str, object] | None:
    rows = _rows(conn, f"{ANOMALY_SELECT} WHERE a.id = %s", (anomaly_id,))
    return to_anomaly(rows[0], tz) if rows else None


def require_anomaly(conn: psycopg.Connection, tz: str, anomaly_id: int) -> dict[str, object]:
    found = get_anomaly(conn, tz, anomaly_id)
    if found is None:
        raise not_found("ANOMALY_NOT_FOUND", f"ไม่พบความผิดปกติ {anomaly_id}", f"Anomaly {anomaly_id} not found",
                        id=anomaly_id)
    return found


@dataclass(frozen=True)
class AnomalyFilter:
    types: list[str] | None = None
    statuses: list[str] | None = None
    detectors: list[str] | None = None
    severities: list[str] | None = None
    source_types: list[str] | None = None
    min_score: float | None = None
    from_ms: int | None = None
    to_ms: int | None = None
    limit: int = 50
    offset: int = 0


def list_anomalies(conn: psycopg.Connection, tz: str, f: AnomalyFilter) -> dict[str, object]:
    """★ ตัวกรองต้องไม่ทิ้งผลที่ไม่ได้ระบุ severity/score เงียบ ๆ (สัญญาข้อ AnomalyEvent)"""
    where: list[str] = []
    params: list[object] = []
    for values, clause in ((f.types, "a.anomaly_type = ANY(%s)"), (f.statuses, "a.status = ANY(%s)"),
                           (f.detectors, "a.detector = ANY(%s)"),
                           (f.severities, "(a.severity IS NULL OR a.severity = ANY(%s))"),
                           (f.source_types, "a.source_type = ANY(%s)")):
        if values is not None:
            where.append(clause)
            params.append(values)
    if f.min_score is not None:
        where.append("(a.score IS NULL OR a.score >= %s)")
        params.append(f.min_score)
    if f.from_ms is not None:
        where.append("a.detected_at >= %s")
        params.append(to_dt(f.from_ms))
    if f.to_ms is not None:
        where.append("a.detected_at <= %s")
        params.append(to_dt(f.to_ms))
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT count(*) FROM ai_anomalies a{clause}", params).fetchone()  # type: ignore[arg-type]
    rows = _rows(conn, f"{ANOMALY_SELECT}{clause} ORDER BY a.detected_at DESC, a.id DESC LIMIT %s OFFSET %s",
                 [*params, f.limit, f.offset])
    return {"items": [to_anomaly(r, tz) for r in rows], "total": int(total[0]) if total else 0,  # type: ignore[index]
            "limit": f.limit, "offset": f.offset}


def _link_alert(conn: psycopg.Connection, anomaly_id: int) -> int | None:
    """ความผิดปกติระดับเตือนขึ้นไปที่ยังเปิดอยู่ → alert ANOMALY_DETECTED (entity เดียวกันรวมเป็น alert เดียว)"""
    source_id, severity, status, alert_id, detected_at = conn.execute(
        "SELECT source_id, severity, status, alert_id, detected_at FROM ai_anomalies WHERE id = %s",
        (anomaly_id,)).fetchone()  # type: ignore[misc]
    if alert_id is not None or status != "active" or severity not in ("warning", "critical"):
        return None
    existing = conn.execute("""SELECT alert_id FROM alerts
                                WHERE entity_id = %s AND kind = 'ANOMALY_DETECTED' AND ended_at IS NULL""",
                            (source_id,)).fetchone()
    if existing is not None:
        alert_id = existing[0]
        conn.execute("""UPDATE alerts SET occurrence_count = occurrence_count + 1,
                               severity = CASE WHEN %s = 'critical' THEN 'critical' ELSE severity END
                         WHERE alert_id = %s""", (severity, alert_id))
    else:
        alert_id = conn.execute("""INSERT INTO alerts (entity_id, kind, severity, started_at, anomaly_id)
                                   VALUES (%s, 'ANOMALY_DETECTED', %s, %s, %s) RETURNING alert_id""",
                                (source_id, severity, detected_at, anomaly_id)).fetchone()[0]  # type: ignore[index]
    conn.execute("UPDATE ai_anomalies SET alert_id = %s WHERE id = %s", (alert_id, anomaly_id))
    return int(alert_id)


def ingest_anomaly(conn: psycopg.Connection, tz: str, item: AnomalyIn) -> dict[str, object]:
    if not item.source_id:
        raise bad_request("SOURCE_ID_REQUIRED",
                          "ต้องมี sourceId ของจุดที่ผิดปกติ — ไม่มีแล้วหมุดความผิดปกติจะไม่ขึ้นบนกราฟใดเลย",
                          "sourceId is required — without it the anomaly marker cannot be placed on any chart",
                          field="sourceId")
    if item.score is not None and not 0 <= item.score <= 1:
        raise bad_request("SCORE_OUT_OF_RANGE",
                          f"score ต้องอยู่ระหว่าง 0–1 (สูง = ผิดปกติมาก) แต่ได้ {item.score} — ถ้าโมเดลให้ 0–100 ให้หาร 100 ก่อนส่ง",
                          f"score must be between 0 and 1 (higher = more abnormal) but got {item.score}; "
                          "divide 0–100 scores by 100 before sending", field="score")
    if item.window_start is not None and item.window_end is not None and item.window_end < item.window_start:
        raise bad_request("VALIDATION_FAILED", "windowEnd ต้องไม่ก่อน windowStart",
                          "windowEnd must not precede windowStart",
                          field="windowEnd")
    source_type, _ = _entity(conn, item.source_id, item.source_type, "sourceId")
    values = {
        "external_id": item.id, "detected_at": item.detected_at, "source_id": item.source_id,
        "source_type": source_type, "anomaly_type": item.type, "detector": item.detector, "severity": item.severity,
        "score": item.score, "metric": item.metric, "window_start": item.window_start, "window_end": item.window_end,
        "evidence": _dump(item.evidence), "expected_band": _dump(item.expected_band), "features": _dump(item.features),
        "suggested_action": item.suggested_action, "summary_th": item.summary_th, "summary_en": item.summary_en,
        "model_name": item.model_name, "extra": _dump(item.extra), "status": item.status,
        "resolved_at": item.resolved_at or (datetime.now(UTC) if item.status != "active" else None),
        "feedback": item.feedback,
    }
    with conn.transaction():
        anomaly_id = _upsert(conn, "ai_anomalies", values, keep=("status", "resolved_at", "feedback"),
                             touch="updated_at = now()")
        alert_id = _link_alert(conn, anomaly_id)
    publish("alerts", {"anomalyId": anomaly_id})
    if alert_id is not None:
        publish("alerts", {"alertId": alert_id})
    return require_anomaly(conn, tz, anomaly_id)


def review_anomaly(conn: psycopg.Connection, tz: str, anomaly_id: int, user_id: str, *, status: str | None = None,
                   feedback: str | None = None) -> dict[str, object]:
    """ปิดเคส (status) หรือส่งผลตรวจหน้างาน (feedback) · ปิดครบทุกเคสของ alert แล้ว alert ปิดตาม"""
    with conn.transaction():
        if status is not None:
            row = conn.execute("""UPDATE ai_anomalies SET status = %s, updated_at = now(),
                                         resolved_at = CASE WHEN %s = 'active' THEN NULL ELSE now() END
                                   WHERE id = %s RETURNING alert_id""", (status, status, anomaly_id)).fetchone()
        else:
            row = conn.execute("""UPDATE ai_anomalies SET feedback = %s, updated_at = now()
                                   WHERE id = %s RETURNING alert_id""",
                               (feedback, anomaly_id)).fetchone()
        if row is None:
            raise not_found("ANOMALY_NOT_FOUND", f"ไม่พบความผิดปกติ {anomaly_id}", f"Anomaly {anomaly_id} not found",
                            id=anomaly_id)
        alert_id = row[0]
        if status not in (None, "active") and alert_id is not None:
            still_open = conn.execute("SELECT 1 FROM ai_anomalies WHERE alert_id = %s AND status = 'active' LIMIT 1",
                                      (alert_id,)).fetchone()
            if still_open is None:
                conn.execute("UPDATE alerts SET ended_at = now() WHERE alert_id = %s AND ended_at IS NULL", (alert_id,))
        action = "anomaly_status" if status is not None else "anomaly_feedback"
        _audit(conn, user_id, action, f"anomaly:{anomaly_id}", {"status": status} if status else {"feedback": feedback})
    publish("alerts", {"anomalyId": anomaly_id})
    if alert_id is not None:
        publish("alerts", {"alertId": alert_id})
    return require_anomaly(conn, tz, anomaly_id)


# ─────────────── พยากรณ์ · บำรุงรักษา · ค่าที่คำนวณ · สถานะ ───────────────

def to_forecast(row: dict[str, object], tz: str) -> dict[str, object]:
    return compact(
        {"id": str(row["id"]), "target": row["target"], "generatedAt": iso_required(row["generated_at"], tz)},  # type: ignore[arg-type]
        {"targetId": row["target_id"], "targetName": row["target_name"], "metric": row["metric"], "unit": row["unit"],
         "horizonHours": num(row["horizon_hours"], 2), "history": row["history"], "forecast": row["forecast"],
         "modelName": row["model_name"], "mapePercent": num(row["mape_percent"], 2), "horizon": row["horizon"],
         "value": num(row["value"], 4), "expectedAt": iso_dt(row["expected_at"], tz),  # type: ignore[arg-type]
         "confidence": num(row["confidence"], 4), "summaryTh": row["summary_th"], "summaryEn": row["summary_en"]})


def ingest_forecasts(conn: psycopg.Connection, tz: str, items: list[ForecastIn]) -> list[dict[str, object]]:
    ids = []
    with conn.transaction():
        for item in items:
            ids.append(_upsert(conn, "ai_forecasts", {
                "external_id": item.id, "target": item.target, "target_id": item.target_id,
                "target_name": item.target_name, "metric": item.metric, "unit": item.unit, "horizon": item.horizon,
                "horizon_hours": item.horizon_hours, "generated_at": item.generated_at, "history": _dump(item.history),
                "forecast": _dump(item.forecast), "value": item.value, "expected_at": item.expected_at,
                "confidence": item.confidence, "mape_percent": item.mape_percent, "model_name": item.model_name,
                "summary_th": item.summary_th, "summary_en": item.summary_en}))
    rows = _rows(conn, "SELECT * FROM ai_forecasts WHERE id = ANY(%s) ORDER BY id", (ids,))
    return [to_forecast(r, tz) for r in rows]


def forecasts(conn: psycopg.Connection, tz: str, target: str | None, target_id: str | None,
              horizon: str | None) -> list[dict[str, object]]:
    """ล่าสุดของแต่ละ (target, targetId, horizon) — ทีม AI เพิ่ม target ใหม่ได้โดยไม่ต้องแก้อะไร"""
    where, params = [], []
    for value, column in ((target, "target"), (target_id, "target_id"), (horizon, "horizon")):
        if value is not None:
            where.append(f"{column} = %s")
            params.append(value)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = _rows(conn, f"""SELECT DISTINCT ON (target, coalesce(target_id, ''), coalesce(horizon, '')) *
                            FROM ai_forecasts{clause}
                            ORDER BY target, coalesce(target_id, ''), coalesce(horizon, ''),
                                     generated_at DESC, id DESC""",
                 params)
    rows.sort(key=lambda r: (r["generated_at"], r["id"]), reverse=True)  # type: ignore[arg-type, return-value]
    return [to_forecast(r, tz) for r in rows]


def to_maintenance(row: dict[str, object], tz: str) -> dict[str, object]:
    return compact(
        {"id": str(row["id"]), "targetType": row["target_type"], "targetId": row["target_id"],
         "generatedAt": iso_required(row["generated_at"], tz)},  # type: ignore[arg-type]
        {"targetName": row["target_name"] or row["entity_name"],
         "failureProbability": num(row["failure_probability"], 4),
         "daysUntilService": num(row["days_until_service"], 1),
         "estimatedIssueDate": iso_dt(row["estimated_issue_date"], tz),  # type: ignore[arg-type]
         "healthScore": num(row["health_score"], 1), "trend": row["trend"], "features": row["features"],
         "modelName": row["model_name"], "note": row["note"], "recommendationTh": row["recommendation_th"],
         "recommendationEn": row["recommendation_en"]})


def ingest_maintenance(conn: psycopg.Connection, tz: str, items: list[MaintenanceIn]) -> list[dict[str, object]]:
    for item in items:
        if item.health_score is not None and not 0 <= item.health_score <= 100:
            raise bad_request("HEALTH_SCORE_OUT_OF_RANGE",
                              f"healthScore ต้องอยู่ระหว่าง 0–100 (สูง = ดี · กลับทางกับ score) แต่ได้ {item.health_score}",
                              f"healthScore must be between 0 and 100 (higher = healthier, opposite of score) "
                              f"but got {item.health_score}", field="healthScore")
        _entity(conn, item.target_id, item.target_type, "targetId")
    ids = []
    with conn.transaction():
        for item in items:
            ids.append(_upsert(conn, "ai_maintenance", {
                "external_id": item.id, "target_type": item.target_type, "target_id": item.target_id,
                "generated_at": item.generated_at, "target_name": item.target_name,
                "failure_probability": item.failure_probability, "days_until_service": item.days_until_service,
                "estimated_issue_date": item.estimated_issue_date, "health_score": item.health_score,
                "trend": item.trend, "features": _dump(item.features), "model_name": item.model_name,
                "note": item.note, "recommendation_th": item.recommendation_th,
                "recommendation_en": item.recommendation_en}))
    rows = _rows(conn, """SELECT m.*, e.name AS entity_name FROM ai_maintenance m
                           LEFT JOIN entities e ON e.entity_id = m.target_id
                          WHERE m.id = ANY(%s) ORDER BY m.id""", (ids,))
    return [to_maintenance(r, tz) for r in rows]


def maintenance(conn: psycopg.Connection, tz: str, target_type: str | None,
                target_id: str | None) -> list[dict[str, object]]:
    where, params = [], []
    for value, column in ((target_type, "m.target_type"), (target_id, "m.target_id")):
        if value is not None:
            where.append(f"{column} = %s")
            params.append(value)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = _rows(conn, f"""SELECT * FROM (
                             SELECT DISTINCT ON (m.target_type, m.target_id) m.*, e.name AS entity_name
                               FROM ai_maintenance m LEFT JOIN entities e ON e.entity_id = m.target_id{clause}
                              ORDER BY m.target_type, m.target_id, m.generated_at DESC, m.id DESC) latest
                            ORDER BY generated_at DESC, id DESC""", params)
    return [to_maintenance(r, tz) for r in rows]


def to_metric(row: dict[str, object], tz: str) -> dict[str, object]:
    return compact(
        {"key": row["key"], "computedAt": iso_required(row["computed_at"], tz)},  # type: ignore[arg-type]
        {"value": num(row["value"], 6), "text": row["text"], "unit": row["unit"], "format": row["format"],
         "decimals": row["decimals"], "scopeType": row["scope_type"], "scopeId": row["scope_id"],
         "scopeName": row["scope_name"] or row["entity_name"], "target": num(row["target"], 6),
         "thresholds": row["thresholds"], "status": row["status"], "previousValue": num(row["previous_value"], 6),
         "changePercent": num(row["change_percent"], 2), "trend": row["trend"],
         "higherIsWorse": row["higher_is_worse"], "confidence": num(row["confidence"], 4), "basis": row["basis"],
         "series": row["series"], "modelName": row["model_name"], "summaryTh": row["summary_th"],
         "summaryEn": row["summary_en"], "extra": row["extra"]})


def ingest_metrics(conn: psycopg.Connection, tz: str, items: list[MetricIn]) -> list[dict[str, object]]:
    scope_types = [_entity(conn, item.scope_id, item.scope_type, "scopeId")[0] if item.scope_id else item.scope_type
                   for item in items]
    ids = []
    with conn.transaction():
        for item, scope_type in zip(items, scope_types, strict=True):
            values = {"key": item.key, "computed_at": item.computed_at, "value": item.value, "text": item.text,
                      "unit": item.unit, "format": item.format, "decimals": item.decimals, "scope_type": scope_type,
                      "scope_id": item.scope_id, "scope_name": item.scope_name, "target": item.target,
                      "thresholds": _dump(item.thresholds), "status": item.status,
                      "previous_value": item.previous_value, "change_percent": item.change_percent,
                      "trend": item.trend, "higher_is_worse": item.higher_is_worse, "confidence": item.confidence,
                      "basis": _dump(item.basis), "series": _dump(item.series), "model_name": item.model_name,
                      "summary_th": item.summary_th, "summary_en": item.summary_en, "extra": _dump(item.extra)}
            columns = list(values)
            row = conn.execute(f"""INSERT INTO ai_metrics ({', '.join(columns)})
                                   VALUES ({', '.join(f'%({c})s' for c in columns)}) RETURNING id""", values).fetchone()
            ids.append(int(row[0]))  # type: ignore[index]
    rows = _rows(conn, """SELECT m.*, e.name AS entity_name FROM ai_metrics m
                           LEFT JOIN entities e ON e.entity_id = m.scope_id
                          WHERE m.id = ANY(%s) ORDER BY m.id""", (ids,))
    return [to_metric(r, tz) for r in rows]


def metrics(conn: psycopg.Connection, tz: str, keys: list[str] | None, scope_types: list[str] | None,
            scope_ids: list[str] | None, abnormal_only: bool) -> list[dict[str, object]]:
    """ค่าล่าสุดของแต่ละ (key, scope) · abnormalOnly: ตัวที่ทีม AI ไม่ได้ระบุ status ไม่นับว่าผิดปกติ"""
    where, params = [], []
    for values, column in ((keys, "m.key"), (scope_types, "m.scope_type"), (scope_ids, "m.scope_id")):
        if values is not None:
            where.append(f"{column} = ANY(%s)")
            params.append(values)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = _rows(conn, f"""SELECT * FROM (
                             SELECT DISTINCT ON (m.key, coalesce(m.scope_type, ''), coalesce(m.scope_id, ''))
                                    m.*, e.name AS entity_name
                               FROM ai_metrics m LEFT JOIN entities e ON e.entity_id = m.scope_id{clause}
                              ORDER BY m.key, coalesce(m.scope_type, ''), coalesce(m.scope_id, ''),
                                       m.computed_at DESC, m.id DESC) latest
                            {"WHERE status IS NOT NULL AND status <> 'ok'" if abnormal_only else ""}
                            ORDER BY key, scope_id NULLS FIRST""", params)
    return [to_metric(r, tz) for r in rows]


def report_status(conn: psycopg.Connection, item: StatusIn) -> None:
    conn.execute("""INSERT INTO ai_status (id, reported_at, models, message, mode, last_trained_at, training_days,
                                           accuracy, false_positive_rate, summary_text)
                    VALUES (true, now(), %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET reported_at = now(), models = EXCLUDED.models,
                        message = EXCLUDED.message, mode = EXCLUDED.mode, last_trained_at = EXCLUDED.last_trained_at,
                        training_days = EXCLUDED.training_days, accuracy = EXCLUDED.accuracy,
                        false_positive_rate = EXCLUDED.false_positive_rate, summary_text = EXCLUDED.summary_text""",
                 (Jsonb(item.models), item.message, item.mode, item.last_trained_at, item.training_days, item.accuracy,
                  item.false_positive_rate, item.summary_text))


def service_status(conn: psycopg.Connection, tz: str) -> dict[str, object]:
    """reachable = บริการ AI ส่งสัญญาณชีพภายใน 5 นาที · lastResultAt = ผลล่าสุดที่รับไว้ไม่ว่าชนิดไหน"""
    rows = _rows(conn, """SELECT *, reported_at > now() - make_interval(mins => %s) AS fresh FROM ai_status""",
                 (HEARTBEAT_MINUTES,))
    last = conn.execute("""SELECT greatest((SELECT max(received_at) FROM ai_anomalies),
                                           (SELECT max(received_at) FROM ai_forecasts),
                                           (SELECT max(received_at) FROM ai_maintenance),
                                           (SELECT max(received_at) FROM ai_metrics))""").fetchone()
    row = rows[0] if rows else None
    fresh = bool(row and row["fresh"])
    message = row["message"] if row and fresh else \
        f"ยังไม่ได้รับสัญญาณจากบริการ AI ภายใน {HEARTBEAT_MINUTES} นาทีที่ผ่านมา"
    return compact(
        {"reachable": fresh, "lastResultAt": iso_dt(last[0] if last else None, tz),
         "models": list(row["models"]) if row else [], "message": message},  # type: ignore[call-overload]
        {} if row is None else {
            "mode": row["mode"], "lastTrainedAt": iso_dt(row["last_trained_at"], tz),  # type: ignore[arg-type]
            "trainingDays": num(row["training_days"], 1), "accuracy": num(row["accuracy"], 4),
            "falsePositiveRate": num(row["false_positive_rate"], 4), "summaryText": row["summary_text"]})
