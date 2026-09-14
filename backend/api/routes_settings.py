"""endpoint ค่าตั้งระบบ (PROMPT_04 งานที่ 4) — ตรงกับ lib/services/settings.ts

★ อ่าน (GET /api/settings) ไม่ต้องล็อกอิน เพราะจอแขวนผนังต้องรู้ refreshInterval/หน่วย — token ถูกปิดบังเสมอ
★ เขียน · ส่งออก · ทดสอบ ต้องเป็น admin
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Body, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from . import settings as st
from .auth import Admin
from .db import pool
from .registry import registry

router = APIRouter(prefix="/api/settings")


@router.get("")
def get_settings(response: Response) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    with pool.connection() as conn:
        return st.load_settings(conn, registry(conn))


@router.get("/export")
def get_export(_user: Admin) -> JSONResponse:
    """★ ไม่มี token หรือความลับใด ๆ ในไฟล์ — ไฟล์นี้ถูกส่งต่อกันได้"""
    with pool.connection() as conn:
        body = st.load_settings(conn, registry(conn), export=True)
    filename = f"water-settings-{datetime.now():%Y%m%d-%H%M}.json"
    return JSONResponse(body, headers={"Content-Disposition": f'attachment; filename="{filename}"',
                                       "Cache-Control": "no-store"})


@router.post("/reset")
def post_reset(user: Admin) -> dict[str, object]:
    with pool.connection() as conn:
        return st.reset_settings(conn, user.user_id)


@router.post("/import")
def post_import(body: Annotated[Any, Body()], user: Admin) -> dict[str, object]:
    with pool.connection() as conn:
        return st.import_settings(conn, body, user.user_id)


@router.post("/network/test")
def post_network_test(_user: Admin, body: Annotated[dict[str, Any] | None, Body()] = None) -> dict[str, object]:
    with pool.connection() as conn:
        return st.network_test(registry(conn), body)


class LineTestBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_id: str = Field(alias="groupId", min_length=1)


@router.post("/line/test")
def post_line_test(body: LineTestBody, _user: Admin) -> dict[str, object]:
    with pool.connection() as conn:
        return st.line_test(registry(conn), body.group_id)


@router.patch("/{section}")
def patch_section(section: str, body: Annotated[Any, Body()], user: Admin) -> dict[str, object]:
    with pool.connection() as conn:
        return st.patch_section(conn, section, body, user.user_id)
