"""เซสชันผู้ใช้ — รหัสผ่าน argon2 · token สุ่มที่ DB เก็บเฉพาะ hash · cookie httpOnly

★ เซิร์ฟเวอร์เป็นคนกำหนดวันหมดอายุ (security.sessionTimeoutMinutes) หน้าจอยืดเองไม่ได้
★ ชื่อผู้ใช้ผิด / รหัสผิด / ยังไม่เคยตั้งรหัส ตอบข้อความเดียวกัน ไม่บอกใบ้ว่าชื่อไหนมีจริง
★ ผิดครบ 5 ครั้งใน 15 นาทีต่อชื่อผู้ใช้ ล็อกชื่อนั้นชั่วคราว (นับทั้งชื่อที่ไม่มีจริง)
★ ต่ออายุได้เรื่อย ๆ ขณะใช้งาน แต่เซสชันหนึ่งอยู่ได้ไม่เกิน 12 ชั่วโมงนับจากล็อกอิน
"""

from __future__ import annotations

import hashlib
import os
import secrets
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Annotated

import psycopg
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, Request, Response

from .common import iso_required
from .db import pool
from .errors import ApiException
from .registry import Registry

COOKIE = "wcm_session"
MAX_FAILURES = 5
FAILURE_WINDOW_MINUTES = 15
MAX_SESSION_HOURS = 12
MIN_PASSWORD_LENGTH = 10
ROLE_RANK = {"viewer": 0, "operator": 1, "admin": 2}

_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash(secrets.token_hex(16))   # เทียบกับตัวนี้เมื่อไม่มีผู้ใช้ ให้เวลาตอบเท่ากัน

SESSION_SELECT = """
    SELECT u.user_id, u.display_name, u.role, u.department_id, s.token_hash, s.created_at, s.expires_at
      FROM sessions s JOIN users u ON u.user_id = s.user_id"""


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    try:
        matched = _hasher.verify(stored or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return matched and stored is not None


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def timeout_minutes(reg: Registry) -> int:
    return max(1, int(reg.setting("security", "sessionTimeoutMinutes", 30)))  # type: ignore[call-overload]


@dataclass(frozen=True)
class CurrentUser:
    user_id: str
    display_name: str
    role: str
    department_id: str | None
    token_hash: str
    signed_in_at: datetime
    expires_at: datetime

    def user(self) -> dict[str, object]:
        return {"id": self.user_id, "displayName": self.display_name, "role": self.role,
                "departmentId": self.department_id, "active": True}

    def session(self, tz: str) -> dict[str, object]:
        return {"user": self.user(), "signedInAt": iso_required(self.signed_in_at, tz),
                "expiresAt": iso_required(self.expires_at, tz)}


def _fail(th: str, en: str) -> dict[str, object]:
    return {"ok": False, "session": None, "errorTh": th, "errorEn": en}


def find_session(conn: psycopg.Connection, token: str | None) -> CurrentUser | None:
    if not token:
        return None
    row = conn.execute(f"""{SESSION_SELECT}
                            WHERE s.token_hash = %s AND s.revoked_at IS NULL AND s.expires_at > now() AND u.active""",
                       (token_hash(token),)).fetchone()
    return None if row is None else CurrentUser(*row)


def login(conn: psycopg.Connection, reg: Registry, username: str, password: str,
          ip: str | None) -> tuple[dict[str, object], CurrentUser | None, str | None]:
    """(SignInResult, ผู้ใช้, token สำหรับ cookie) — token เป็น None เมื่อไม่ผ่าน"""
    name = username.strip().lower()
    if name == "":
        return _fail("กรุณากรอกชื่อผู้ใช้", "Enter a username"), None, None
    if password == "":
        return _fail("กรุณากรอกรหัสผ่าน", "Enter a password"), None, None
    failures = conn.execute("""SELECT count(*) FROM login_failures
                                WHERE username = %s AND at > now() - make_interval(mins => %s)""",
                            (name, FAILURE_WINDOW_MINUTES)).fetchone()
    if failures is not None and failures[0] >= MAX_FAILURES:
        return _fail(f"ลองรหัสผิดหลายครั้ง ระบบล็อกชื่อผู้ใช้นี้ชั่วคราว {FAILURE_WINDOW_MINUTES} นาที",
                     f"Too many failed attempts — try again in {FAILURE_WINDOW_MINUTES} minutes"), None, None

    row = conn.execute("SELECT user_id, password_hash, active FROM users WHERE lower(username) = %s",
                       (name,)).fetchone()
    if row is None or not verify_password(row[1], password):
        conn.execute("INSERT INTO login_failures (username, ip) VALUES (%s, %s)", (name, ip))
        return _fail("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "Incorrect username or password"), None, None
    user_id, stored, active = row
    if not active:
        return _fail("บัญชีนี้ถูกปิดการใช้งาน ติดต่อผู้ดูแลระบบ",
                     "This account is disabled — contact an administrator"), None, None

    token = secrets.token_urlsafe(32)
    with conn.transaction():
        conn.execute("DELETE FROM login_failures WHERE username = %s", (name,))
        if _hasher.check_needs_rehash(stored):
            conn.execute("UPDATE users SET password_hash = %s WHERE user_id = %s", (hash_password(password), user_id))
        conn.execute("""INSERT INTO sessions (token_hash, user_id, expires_at, ip)
                        VALUES (%s, %s, now() + make_interval(mins => %s), %s)""",
                     (token_hash(token), user_id, timeout_minutes(reg), ip))
        conn.execute("INSERT INTO audit_log (user_id, action, target, result) VALUES (%s, 'login', %s, 'ok')",
                     (user_id, ip))
    current = find_session(conn, token)
    if current is None:
        return _fail("เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง", "Sign-in failed — please try again"), None, None
    return {"ok": True, "session": current.session(reg.timezone), "errorTh": None, "errorEn": None}, current, token


def refresh(conn: psycopg.Connection, reg: Registry, current: CurrentUser) -> CurrentUser | None:
    """ต่ออายุอีก sessionTimeoutMinutes แต่ไม่เกิน 12 ชั่วโมงจากตอนล็อกอิน · หมดสิทธิ์ต่อแล้วคืน None"""
    row = conn.execute("""
        UPDATE sessions SET last_seen_at = now(),
               expires_at = least(now() + make_interval(mins => %s), created_at + make_interval(hours => %s))
         WHERE token_hash = %s AND revoked_at IS NULL AND expires_at > now()
        RETURNING expires_at""", (timeout_minutes(reg), MAX_SESSION_HOURS, current.token_hash)).fetchone()
    if row is None or row[0] <= datetime.now(UTC):
        return None
    return replace(current, expires_at=row[0])


def logout(conn: psycopg.Connection, token: str) -> None:
    conn.execute("UPDATE sessions SET revoked_at = now() WHERE token_hash = %s AND revoked_at IS NULL",
                 (token_hash(token),))


# ─────────────── ใช้กับ route ───────────────

def current_user(request: Request) -> CurrentUser | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with pool.connection() as conn:
        return find_session(conn, token)


def require_role(minimum: str) -> Callable[[Request], CurrentUser]:
    def dependency(request: Request) -> CurrentUser:
        user = current_user(request)
        if user is None:
            raise ApiException(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบ", "Sign in required")
        if ROLE_RANK.get(user.role, -1) < ROLE_RANK[minimum]:
            raise ApiException(403, "FORBIDDEN", "สิทธิ์ของผู้ใช้นี้ไม่พอสำหรับการทำรายการนี้",
                               "Your role cannot perform this action", {"role": user.role, "required": minimum})
        return user
    return dependency


AnyUser = Annotated[CurrentUser, Depends(require_role("viewer"))]
Operator = Annotated[CurrentUser, Depends(require_role("operator"))]
Admin = Annotated[CurrentUser, Depends(require_role("admin"))]


def set_cookie(response: Response, token: str, current: CurrentUser) -> None:
    seconds = max(0, int((current.expires_at - datetime.now(UTC)).total_seconds()))
    # ★ ระบบใน LAN เข้าผ่าน http ได้ — ตั้ง COOKIE_SECURE=1 เมื่อ nginx เปิด https แล้ว
    response.set_cookie(COOKIE, token, max_age=seconds, httponly=True, samesite="strict", path="/api",
                        secure=os.environ.get("COOKIE_SECURE") == "1")


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/api", httponly=True, samesite="strict")
