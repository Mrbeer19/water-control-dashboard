"""endpoint การแจ้งเตือน (PROMPT_04 งานที่ 2)

★ path ที่เจาะจง (unread-count, read-all, acknowledgements, recoveries) ต้องประกาศก่อน /alerts/{alert_id}
★ endpoint ที่เขียนข้อมูลยังไม่ตรวจ session — เพิ่มในเฟส 4c (auth)
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from . import alerts as al
from .auth import AnyUser, Operator
from .common import parse_time
from .db import pool
from .errors import ApiException, bad_request
from .latest import publish
from .registry import registry

router = APIRouter(prefix="/api")


def _values(raw: list[str] | None, allowed: tuple[str, ...] | frozenset[str], field: str) -> list[str] | None:
    """รับได้ทั้ง ?x=a&x=b และ ?x=a,b"""
    if not raw:
        return None
    items = [part.strip() for chunk in raw for part in chunk.split(",") if part.strip()]
    for item in items:
        if item not in allowed:
            raise bad_request("VALIDATION_FAILED", f"ค่า {field} ไม่ถูกต้อง: {item}", f"Invalid {field}: {item}",
                              field=field)
    return items or None


def _free(raw: list[str] | None) -> list[str] | None:
    items = [part.strip() for chunk in raw or [] for part in chunk.split(",") if part.strip()]
    return items or None


def _time(raw: str | None, field: str) -> int | None:
    return None if raw is None or raw == "" else parse_time(raw, 0, field)


@router.get("/alerts")
def get_alerts(
    response: Response,
    severity: Annotated[list[str] | None, Query()] = None,
    state: Annotated[list[str] | None, Query()] = None,
    source_type: Annotated[list[str] | None, Query(alias="sourceType")] = None,
    codes: Annotated[list[str] | None, Query()] = None,
    source_ids: Annotated[list[str] | None, Query(alias="sourceIds")] = None,
    department_ids: Annotated[list[str] | None, Query(alias="departmentIds")] = None,
    unread_only: bool = Query(False, alias="unreadOnly"),
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    query = al.AlertFilter(
        severities=_values(severity, al.SEVERITIES, "severity"), states=_values(state, al.STATES, "state"),
        source_types=_values(source_type, al.SOURCE_TYPES, "sourceType"),
        codes=_values(codes, frozenset(al.CATALOG), "codes"), source_ids=_free(source_ids),
        department_ids=_free(department_ids), unread_only=unread_only, from_ms=_time(frm, "from"),
        to_ms=_time(to, "to"), limit=limit, offset=offset)
    with pool.connection() as conn:
        body = al.list_alerts(conn, registry(conn).timezone, query)
    response.headers["Cache-Control"] = "max-age=1"
    return body


@router.get("/alerts/unread-count")
def get_unread_count(response: Response) -> dict[str, int]:
    with pool.connection() as conn:
        body = al.unread_count(conn)
    response.headers["Cache-Control"] = "max-age=1"
    return body


@router.post("/alerts/read-all")
def post_read_all(_user: AnyUser) -> int:
    with pool.connection() as conn:
        return al.mark_all_read(conn)


@router.get("/alerts/acknowledgements")
def get_acknowledgements(alert_id: str | None = Query(None, alias="alertId")) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return al.acknowledgements(conn, registry(conn).timezone, None if alert_id is None else al.parse_id(alert_id))


@router.get("/alerts/recoveries")
def get_recoveries(frm: str | None = Query(None, alias="from"), to: str | None = None,
                   limit: int = Query(20, ge=1, le=500)) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return al.recoveries(conn, registry(conn).timezone, _time(frm, "from"), _time(to, "to"), limit)


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: str) -> dict[str, object]:
    with pool.connection() as conn:
        return al.require_alert(conn, registry(conn).timezone, al.parse_id(alert_id))


@router.post("/alerts/{alert_id}/read")
def post_read(alert_id: str, _user: AnyUser) -> dict[str, object]:
    with pool.connection() as conn:
        body = al.mark_read(conn, registry(conn).timezone, al.parse_id(alert_id))
    publish("alerts", {"alertId": body["id"]})
    return body


class AcknowledgeBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    acknowledged_by_user_id: str | None = Field(None, alias="acknowledgedByUserId")
    note: str | None = Field(None, max_length=500)
    snooze_minutes: int | None = Field(None, alias="snoozeMinutes", ge=1, le=1440)


@router.post("/alerts/{alert_id}/acknowledge")
def post_acknowledge(alert_id: str, body: AcknowledgeBody, user: Operator) -> dict[str, object]:
    """★ ผู้รับทราบคือผู้ที่ล็อกอิน · acknowledgedByUserId ในสัญญาเดิม ถ้าส่งมาต้องเป็นคนเดียวกัน"""
    if body.acknowledged_by_user_id not in (None, user.user_id):
        raise ApiException(403, "FORBIDDEN", "รับทราบแทนผู้ใช้อื่นไม่ได้", "Cannot acknowledge on behalf of another user",
                           {"acknowledgedByUserId": body.acknowledged_by_user_id})
    note = body.note.strip() if body.note and body.note.strip() else None
    with pool.connection() as conn:
        ack = al.acknowledge(conn, registry(conn).timezone, al.parse_id(alert_id), user.user_id, note,
                             body.snooze_minutes)
    publish("alerts", {"alertId": ack["alertId"]})
    return ack


@router.get("/alerts/{alert_id}/preview")
def get_preview(alert_id: str, channel: str = "line") -> dict[str, object]:
    _values([channel], al.CHANNELS, "channel")
    with pool.connection() as conn:
        return al.preview(conn, registry(conn), al.parse_id(alert_id), channel)


@router.get("/notifications/deliveries")
def get_deliveries(alert_id: str | None = Query(None, alias="alertId")) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return al.deliveries(conn, registry(conn).timezone, None if alert_id is None else al.parse_id(alert_id))


@router.post("/notifications/deliveries/{delivery_id}/retry")
def post_retry(delivery_id: str, _user: Operator) -> dict[str, object]:
    with pool.connection() as conn:
        return al.retry_delivery(conn, registry(conn).timezone, al.parse_id(delivery_id, "DELIVERY"))
