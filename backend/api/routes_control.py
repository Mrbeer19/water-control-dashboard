"""endpoint การสั่งงาน (PROMPT_05) — ตรงกับ lib/services/control.ts

★ ทุกคำสั่งต้องล็อกอิน + บทบาทขั้นต่ำ + PIN (ถ้าเปิด requirePinForControl) แล้วผ่าน interlock ใน api/control.py
★ ตอบ 202 ทันทีพร้อม CommandLogEntry — หน้าจอ poll GET /api/control/commands/:id จนได้สถานะสุดท้าย
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, ConfigDict, Field

from . import control
from .auth import AnyUser, CurrentUser
from .db import pool
from .errors import ApiException, not_found
from .mqtt import publisher
from .registry import registry

router = APIRouter(prefix="/api/control")
device_router = APIRouter(prefix="/api/devices")
TargetType = Literal["pump", "valve", "pressure_control", "system"]


class CommandBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    action: str = Field(min_length=1, max_length=40)
    value: str | float | None = None
    issued_by_user_id: str | None = Field(None, alias="issuedByUserId")
    reason: str | None = Field(None, max_length=500)
    pin: str | None = Field(None, max_length=12)
    confirm_token: str | None = Field(None, alias="confirmToken", max_length=200)


def _same_user(claimed: str | None, user: CurrentUser) -> None:
    if claimed not in (None, user.user_id):
        raise ApiException(403, "FORBIDDEN", "สั่งงานแทนผู้ใช้อื่นไม่ได้", "Cannot act on behalf of another user",
                           {"userId": claimed})


def _issue(kind: str, target_id: str, body: CommandBody, user: CurrentUser) -> dict[str, object]:
    _same_user(body.issued_by_user_id, user)
    with pool.connection() as conn:
        control.require_control(conn, registry(conn, fresh=True), user, body.pin)
        return control.issue(conn, publisher.publish, kind, target_id, body.action, body.value,
                             control.Issuer.of(user), body.reason, body.confirm_token)


@router.post("/pump/{pump_id}", status_code=202)
def post_pump(pump_id: str, body: CommandBody, user: AnyUser) -> dict[str, object]:
    return _issue("pump", pump_id, body, user)


@router.post("/valve/{valve_id}", status_code=202)
def post_valve(valve_id: str, body: CommandBody, user: AnyUser) -> dict[str, object]:
    """★ รับทั้ง id วาล์ว (valve-zone-8) และ id โซน (zone-8)"""
    return _issue("valve", valve_id, body, user)


@router.post("/pressure/{control_id}", status_code=202)
def post_pressure(control_id: str, body: CommandBody, user: AnyUser) -> dict[str, object]:
    return _issue("pressure_control", control_id, body, user)


@router.post("/system", status_code=202)
def post_system(body: CommandBody, user: AnyUser) -> dict[str, object]:
    return _issue("system", "system", body, user)


class PinBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str = Field(min_length=1, max_length=12)


@router.post("/unlock")
def post_unlock(body: PinBody, user: AnyUser) -> dict[str, object]:
    """ใส่ PIN ครั้งเดียว สั่งงานได้ 15 นาทีในเซสชันนี้ (แทนการตรวจ PIN ที่หน้าจออย่างเดียว)"""
    with pool.connection() as conn:
        return control.unlock(conn, registry(conn, fresh=True), user, body.pin)


class ClearLockoutBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    issued_by_user_id: str | None = Field(None, alias="issuedByUserId")
    reason: str | None = Field(None, max_length=500)
    pin: str | None = Field(None, max_length=12)


@router.post("/system/clear-lockout")
def post_clear_lockout(body: ClearLockoutBody, user: AnyUser) -> dict[str, object]:
    _same_user(body.issued_by_user_id, user)
    with pool.connection() as conn:
        control.require_control(conn, registry(conn, fresh=True), user, body.pin)
        return control.clear_lockout(conn, control.Issuer.of(user), body.reason)


@router.get("/commands")
def get_commands(response: Response, limit: Annotated[int, Query(ge=1, le=500)] = 50,
                 offset: Annotated[int, Query(ge=0)] = 0) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = control.list_entries(conn, registry(conn).timezone, limit, offset)
    response.headers["Cache-Control"] = "no-store"
    return body


@router.get("/commands/{command_id}")
def get_command(command_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        result = control.get_result(conn, registry(conn).timezone, command_id)
    if result is None:
        raise not_found("COMMAND_NOT_FOUND", f"ไม่พบคำสั่ง {command_id}", f"Command {command_id} not found",
                        id=command_id)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.get("/interlocks")
def get_interlocks(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = control.interlocks(conn)
    response.headers["Cache-Control"] = "no-store"
    return body


# ─────────────── ตารางเวลา ───────────────

class ScheduleBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    target_type: TargetType = Field(alias="targetType")
    target_id: str = Field(alias="targetId", min_length=1)
    action: str = Field(min_length=1, max_length=40)
    value: str | float | None = None
    time: str
    repeat: Literal["once", "daily", "weekdays", "weekly"]
    days_of_week: list[int] = Field(default_factory=list, alias="daysOfWeek", max_length=7)
    enabled: bool = True
    created_by_user_id: str | None = Field(None, alias="createdByUserId")


class SchedulePatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    enabled: bool | None = None
    time: str | None = None
    repeat: Literal["once", "daily", "weekdays", "weekly"] | None = None
    days_of_week: list[int] | None = Field(None, alias="daysOfWeek", max_length=7)


@router.get("/schedules")
def get_schedules() -> list[dict[str, object]]:
    with pool.connection() as conn:
        return control.list_schedules(conn, registry(conn).timezone)


@router.post("/schedules", status_code=201)
def post_schedule(body: ScheduleBody, user: AnyUser) -> dict[str, object]:
    _same_user(body.created_by_user_id, user)
    with pool.connection() as conn:
        control.require_control(conn, registry(conn, fresh=True), user, None)
        return control.create_schedule(conn, user, body.target_type, body.target_id, body.action, body.value,
                                       body.time, body.repeat, body.days_of_week, body.enabled)


@router.patch("/schedules/{schedule_id}")
def patch_schedule(schedule_id: str, body: SchedulePatch, user: AnyUser) -> dict[str, object]:
    with pool.connection() as conn:
        control.require_control(conn, registry(conn, fresh=True), user, None)
        return control.update_schedule(conn, user, schedule_id, body.model_dump(by_alias=True, exclude_none=True))


@router.delete("/schedules/{schedule_id}")
def delete_schedule(schedule_id: str, user: AnyUser) -> bool:
    with pool.connection() as conn:
        control.require_control(conn, registry(conn, fresh=True), user, None)
        return control.delete_schedule(conn, user, schedule_id)


# ─────────────── อุปกรณ์ ───────────────

class RebootBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin: str | None = Field(None, max_length=12)


@device_router.post("/{device_id}/reboot")
def post_reboot(device_id: str, user: AnyUser, body: RebootBody | None = None) -> dict[str, object]:
    with pool.connection() as conn:
        control.require_control(conn, registry(conn, fresh=True), user, body.pin if body else None)
        return control.reboot_device(conn, publisher.publish, user, device_id)
