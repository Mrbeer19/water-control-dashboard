"""เข้าสู่ระบบ (PROMPT_04 งานที่ 3) — ตรงกับ lib/services/auth.ts และ getCurrentUser()

★ ล็อกอินไม่ผ่านตอบ 200 + SignInResult { ok: false } ตามสัญญา signIn() ที่ไม่ throw
★ ไม่มีเซสชัน: /session /refresh /me ตอบ null (ไม่ใช่ 401) ตามสัญญาที่คืน `T | null`
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from . import auth
from .db import pool
from .registry import registry

router = APIRouter(prefix="/api/auth")


class LoginBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(max_length=100)
    password: str = Field(max_length=200)


@router.post("/login")
def post_login(body: LoginBody, request: Request, response: Response) -> dict[str, object]:
    ip = request.client.host if request.client else None
    with pool.connection() as conn:
        result, current, token = auth.login(conn, registry(conn), body.username, body.password, ip)
    if current is not None and token is not None:
        auth.set_cookie(response, token, current)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/logout", status_code=204)
def post_logout(request: Request) -> Response:
    token = request.cookies.get(auth.COOKIE)
    if token:
        with pool.connection() as conn:
            auth.logout(conn, token)
    response = Response(status_code=204)
    auth.clear_cookie(response)
    return response


@router.get("/session")
def get_session(request: Request, response: Response) -> dict[str, object] | None:
    response.headers["Cache-Control"] = "no-store"
    with pool.connection() as conn:
        current = auth.find_session(conn, request.cookies.get(auth.COOKIE))
        return None if current is None else current.session(registry(conn).timezone)


@router.post("/refresh")
def post_refresh(request: Request, response: Response) -> dict[str, object] | None:
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(auth.COOKIE)
    with pool.connection() as conn:
        reg = registry(conn)
        current = auth.find_session(conn, token)
        refreshed = None if current is None else auth.refresh(conn, reg, current)
    if refreshed is None or token is None:
        auth.clear_cookie(response)
        return None
    auth.set_cookie(response, token, refreshed)
    return refreshed.session(reg.timezone)


@router.get("/me")
def get_me(request: Request, response: Response) -> dict[str, object] | None:
    response.headers["Cache-Control"] = "no-store"
    current = auth.current_user(request)
    return None if current is None else current.user()
