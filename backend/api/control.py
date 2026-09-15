"""การสั่งงาน (PROMPT_05) — สิทธิ์+PIN → ★ interlock → commands+audit_log → publish MQTT → 202 ทันที

★ วาล์วส่งไป ESP32 (plant/water/valve/:id/cmd) · ปั๊มและลูปแรงดันส่งไป PLC — ห้ามส่งคำสั่งวาล์วไป PLC
★ ถูกปฏิเสธ = HTTP 409 และบันทึกทั้ง commands (rejected) และ audit_log — เป็นหลักฐานว่าด่านทำงาน
★ ไม่ได้ feedback ภายใน 10 วินาที = timeout "ไม่ทราบผล" ไม่ใช่ล้มเหลว — กดซ้ำอาจเกิดค้อนน้ำ
★ คำสั่งจากตารางเวลา issued_by = 'schedule:<id>' นับเป็นระบบอัตโนมัติ
"""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import time as clock
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from . import interlock
from .auth import ROLE_RANK, CurrentUser, verify_password
from .common import entity_or_404, iso_dt, iso_required
from .errors import ApiException, bad_request, not_found
from .latest import publish as publish_event
from .registry import Registry, invalidate, registry

FEEDBACK_TIMEOUT_MS = 10_000
CONFIRM_TTL_SECONDS = 120
UNLOCK_MINUTES = 15
PIN_FAILURES = 5
PIN_WINDOW_MINUTES = 15
CONTROL_LOCK = "SELECT pg_advisory_xact_lock(hashtext('water-control'))"

ACTIONS: dict[str, tuple[str, ...]] = {
    "pump": ("start", "stop", "set_mode", "reset_fault"),
    "valve": ("open", "close", "set_open_percent"),
    "pressure_control": ("set_setpoint", "set_mode"),
    "system": ("emergency_stop", "open_all", "close_all"),
}
MODE_VALUES = {"pump": ("auto", "manual", "pid"), "pressure_control": ("manual", "headcount", "schedule")}
TOPIC_KIND = {"pump": "pump", "valve": "valve", "pressure_control": "pressure"}
FEEDBACK_KIND = {"pump": "pump", "valve": "valve", "pressure": "pressure_control"}
STATE_OF = {"pending": "sending", "awaiting_feedback": "awaiting_feedback", "confirmed": "success",
            "timeout": "timeout", "rejected": "failed"}
PARENT_VALUE = {"emergency_stop": "all_stopped", "open_all": "all_open", "close_all": "all_closed"}
TIMEOUT_MESSAGE = ("ไม่ได้รับการยืนยันจากอุปกรณ์ภายใน 10 วินาที — ไม่ทราบผล อุปกรณ์อาจขยับไปแล้ว "
                   "ตรวจที่หน้างานก่อนสั่งซ้ำ")
BROKER_TH = "ส่งคำสั่งไม่ออก — ติดต่อ MQTT broker ไม่ได้ คำสั่งนี้ไม่ถึงอุปกรณ์แน่นอน"
BROKER_EN = "Could not reach the MQTT broker — this command did not reach the device"
HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d")

Publisher = Callable[[str, dict[str, object]], bool]


@dataclass(frozen=True)
class Issuer:
    actor_id: str            # user id หรือ schedule:<id>
    display_name: str
    role: str
    automatic: bool

    @classmethod
    def of(cls, user: CurrentUser) -> Issuer:
        return cls(user.user_id, user.display_name, user.role, False)


# ─────────────── สิทธิ์ + PIN ───────────────

def _require_role(reg: Registry, user: CurrentUser) -> None:
    minimum = str(reg.setting("security", "minimumRoleForControl", "operator"))
    if ROLE_RANK.get(user.role, -1) < ROLE_RANK.get(minimum, 1):
        raise ApiException(403, "FORBIDDEN", f"สั่งงานได้ตั้งแต่บทบาท {minimum} ขึ้นไป",
                           f"Control requires the {minimum} role or higher", {"role": user.role, "required": minimum})


def verify_pin(conn: psycopg.Connection, user: CurrentUser, pin: str) -> None:
    key = f"pin:{user.user_id}"
    failures = conn.execute("""SELECT count(*) FROM login_failures
                                WHERE username = %s AND at > now() - make_interval(mins => %s)""",
                            (key, PIN_WINDOW_MINUTES)).fetchone()
    if failures is not None and failures[0] >= PIN_FAILURES:
        raise ApiException(403, "PIN_LOCKED", f"ใส่ PIN ผิดหลายครั้ง ระงับการสั่งงานของผู้ใช้นี้ {PIN_WINDOW_MINUTES} นาที",
                           f"Too many wrong PINs — control is suspended for {PIN_WINDOW_MINUTES} minutes")
    row = conn.execute("SELECT pin_hash FROM users WHERE user_id = %s", (user.user_id,)).fetchone()
    if row is None or row[0] is None:
        raise ApiException(403, "PIN_NOT_SET", "ผู้ใช้นี้ยังไม่ได้ตั้ง PIN — ให้ผู้ดูแลตั้งด้วย make password NAME=… PIN=1",
                           "No control PIN is set for this user")
    if not verify_password(row[0], pin):
        conn.execute("INSERT INTO login_failures (username) VALUES (%s)", (key,))
        raise ApiException(403, "PIN_INVALID", "PIN ไม่ถูกต้อง", "Incorrect PIN")
    conn.execute("DELETE FROM login_failures WHERE username = %s", (key,))


def require_control(conn: psycopg.Connection, reg: Registry, user: CurrentUser, pin: str | None) -> None:
    """บทบาทขั้นต่ำ + PIN (ใส่ครั้งเดียวผ่าน /unlock แล้วใช้ได้ 15 นาที หรือแนบ pin มากับคำสั่ง)"""
    _require_role(reg, user)
    if not reg.setting("security", "requirePinForControl", True):
        return
    unlocked = conn.execute("SELECT control_unlocked_until > now() FROM sessions WHERE token_hash = %s",
                            (user.token_hash,)).fetchone()
    if unlocked is not None and unlocked[0]:
        return
    if not pin:
        raise ApiException(403, "PIN_REQUIRED", "ต้องใส่ PIN ก่อนสั่งงาน", "Enter your control PIN first")
    verify_pin(conn, user, pin)


def unlock(conn: psycopg.Connection, reg: Registry, user: CurrentUser, pin: str) -> dict[str, object]:
    _require_role(reg, user)
    verify_pin(conn, user, pin)
    row = conn.execute("""UPDATE sessions SET control_unlocked_until = now() + make_interval(mins => %s)
                           WHERE token_hash = %s RETURNING control_unlocked_until""",
                       (UNLOCK_MINUTES, user.token_hash)).fetchone()
    return {"unlockedUntil": iso_dt(row[0] if row else None, reg.timezone)}


# ─────────────── เป้าหมาย · ค่า · โทเคนยืนยัน ───────────────

def resolve_target(reg: Registry, kind: str, raw_id: str) -> interlock.Target:
    if kind == "system":
        if raw_id != "system":
            raise not_found("ENTITY_NOT_FOUND", f"ไม่พบ {raw_id}", f"{raw_id} not found", id=raw_id)
        return interlock.Target("system", "system", "ทั้งระบบ", "Whole system")
    if kind == "valve" and raw_id in reg.zones:           # รับ id โซนได้ด้วย (curl /api/control/valve/zone-8)
        valve = reg.valve_of_zone(raw_id)
        if valve is None:
            raise not_found("ENTITY_NOT_FOUND", f"โซน {raw_id} ไม่มีวาล์ว", f"Zone {raw_id} has no valve", id=raw_id)
        raw_id = str(valve["entity_id"])
    entity = entity_or_404(reg, raw_id, kind)
    return interlock.Target(kind, raw_id, str(entity["name"]), str(entity["name_en"]))


def normalize_value(kind: str, action: str, value: object) -> str | float | None:
    if action == "set_mode":
        if value not in MODE_VALUES.get(kind, ()):
            raise bad_request("VALIDATION_FAILED", f"โหมด {value} ใช้กับ {kind} ไม่ได้",
                              f"Mode {value} is not valid for {kind}",
                              field="value")
        return str(value)
    if action in ("set_open_percent", "set_setpoint"):
        try:
            if isinstance(value, bool) or value is None:
                raise ValueError
            return float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise bad_request("VALIDATION_FAILED", "คำสั่งนี้ต้องมีค่าเป็นตัวเลข", "This action needs a numeric value",
                              field="value") from exc
    return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _create_token(conn: psycopg.Connection, issuer: Issuer, target: interlock.Target, action: str,
                  value: object) -> str:
    token = secrets.token_urlsafe(24)
    conn.execute("""INSERT INTO control_confirmations (token_hash, user_id, target_kind, target_id, action, value,
                                                       expires_at)
                    VALUES (%s, %s, %s, %s, %s, %s, now() + make_interval(secs => %s))""",
                 (_token_hash(token), issuer.actor_id, target.kind, target.id, action, Jsonb(value),
                  CONFIRM_TTL_SECONDS))
    return token


def _consume_token(conn: psycopg.Connection, token: str, issuer: Issuer, target: interlock.Target, action: str,
                   value: object) -> bool:
    """ใช้ได้ครั้งเดียว · ต้องเป็นผู้ใช้ เป้าหมาย คำสั่ง และค่าเดียวกับตอนขอยืนยัน · ไม่ตรง = เหมือนไม่มีโทเคน"""
    row = conn.execute("""UPDATE control_confirmations SET used_at = now()
                           WHERE token_hash = %s AND used_at IS NULL AND expires_at > now() AND user_id = %s
                             AND target_kind = %s AND target_id = %s AND action = %s
                             AND value IS NOT DISTINCT FROM %s
                           RETURNING 1""",
                       (_token_hash(token), issuer.actor_id, target.kind, target.id, action, Jsonb(value))).fetchone()
    return row is not None


# ─────────────── บันทึก ───────────────

def _record(conn: psycopg.Connection, command_id: uuid.UUID, target: interlock.Target, action: str, value: object,
            issuer: Issuer, reason: str | None, status: str, requires_confirmation: bool,
            parent_id: uuid.UUID | None = None, reject_code: str | None = None,
            reject_reason: str | None = None) -> None:
    conn.execute("""INSERT INTO commands (command_id, target_kind, target_id, action, payload, issued_by, status,
                                          reject_code, reject_reason, reason, requires_confirmation, timeout_ms,
                                          parent_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                 (command_id, target.kind, target.id, action, Jsonb({"value": value}), issuer.actor_id, status,
                  reject_code, reject_reason, reason, requires_confirmation, FEEDBACK_TIMEOUT_MS, parent_id))
    conn.execute("""INSERT INTO audit_log (user_id, action, target, new_value, result, command_id)
                    VALUES (%s, %s, %s, %s, %s, %s)""",
                 (issuer.actor_id, f"control:{action}", f"{target.kind}:{target.id}",
                  json.dumps({"value": value, "reason": reason, "rejectCode": reject_code,
                              "rejectReason": reject_reason},
                             ensure_ascii=False), status, command_id))


def _audit_result(conn: psycopg.Connection, command_ids: list[str], status: str) -> None:
    conn.execute("""UPDATE audit_log a SET result = %s, latency_ms = c.latency_ms FROM commands c
                     WHERE c.command_id = a.command_id AND a.command_id = ANY(%s::uuid[])""", (status, command_ids))


def _send(conn: psycopg.Connection, publish: Publisher, base: str, command_id: uuid.UUID, kind: str, target_id: str,
          action: str, value: object) -> bool:
    topic = f"{base.rstrip('/')}/{TOPIC_KIND[kind]}/{target_id}/cmd"
    ok = publish(topic, {"commandId": str(command_id), "action": action, "value": value,
                         "issuedAt": datetime.now(UTC).isoformat(timespec="milliseconds"),
                         "timeoutMs": FEEDBACK_TIMEOUT_MS})
    if ok:
        conn.execute("""UPDATE commands SET status = 'awaiting_feedback', sent_at = now(), updated_at = now()
                         WHERE command_id = %s AND status = 'pending'""", (command_id,))
        _audit_result(conn, [str(command_id)], "awaiting_feedback")
    else:
        conn.execute("""UPDATE commands SET status = 'rejected', reject_code = 'BROKER_UNAVAILABLE', reject_reason = %s,
                                            updated_at = now() WHERE command_id = %s""", (BROKER_TH, command_id))
        _audit_result(conn, [str(command_id)], "rejected")
    publish_event("commands", {"commandId": str(command_id)})
    return ok


def _engage_lockout(conn: psycopg.Connection) -> None:
    """★ หยุดฉุกเฉินมีผลที่ซอฟต์แวร์ทันที ไม่รอ feedback — ล็อกทุกคำสั่ง และจำโหมดเดิมของปั๊มไว้คืนตอนปลดล็อก"""
    conn.execute("""UPDATE settings SET value = jsonb_set(value, '{controlLockout}', 'true'), updated_at = now()
                     WHERE section = 'security'""")
    conn.execute("""UPDATE entities SET spec = spec || jsonb_build_object(
                        'controlModeBeforeLockout',
                        coalesce(spec->'controlModeBeforeLockout', spec->'controlMode', '"auto"'::jsonb),
                        'controlMode', 'locked_out')
                     WHERE source_type = 'pump'""")


def _dispatch_system(conn: psycopg.Connection, reg: Registry, publish: Publisher, base: str, parent_id: uuid.UUID,
                     action: str, issuer: Issuer, reason: str | None) -> None:
    """คำสั่งทั้งระบบ = คำสั่งย่อยต่ออุปกรณ์ แต่ละตัวมี feedback ของตัวเอง · dispatcher สรุปผลของคำสั่งแม่"""
    if action == "emergency_stop":
        children = [("pump", str(p["entity_id"]), "stop") for p in reg.of_type("pump")]
    else:
        children = [("valve", str(v["entity_id"]), "open" if action == "open_all" else "close")
                    for v in reg.of_type("valve")]
    sent = 0
    for kind, target_id, child_action in children:
        child_id = uuid.uuid4()
        entity = reg.entities[target_id]
        target = interlock.Target(kind, target_id, str(entity["name"]), str(entity["name_en"]))
        with conn.transaction():
            _record(conn, child_id, target, child_action, None, issuer, reason, "pending", False, parent_id=parent_id)
        sent += _send(conn, publish, base, child_id, kind, target_id, child_action, None)
    if sent:
        conn.execute("""UPDATE commands SET status = 'awaiting_feedback', sent_at = now(), updated_at = now()
                         WHERE command_id = %s""", (parent_id,))
        _audit_result(conn, [str(parent_id)], "awaiting_feedback")
    else:
        conn.execute("""UPDATE commands SET status = 'rejected', reject_code = 'BROKER_UNAVAILABLE', reject_reason = %s,
                                            updated_at = now() WHERE command_id = %s""", (BROKER_TH, parent_id))
        _audit_result(conn, [str(parent_id)], "rejected")
    publish_event("commands", {"commandId": str(parent_id)})


# ─────────────── สั่งงาน ───────────────

def issue(conn: psycopg.Connection, publish: Publisher, kind: str, raw_id: str, action: str, value: object,
          issuer: Issuer, reason: str | None, confirm_token: str | None) -> dict[str, object]:
    reg = registry(conn, fresh=True)
    if action not in ACTIONS.get(kind, ()):
        raise bad_request("ACTION_NOT_ALLOWED", f"คำสั่ง {action} ใช้กับ {kind} ไม่ได้",
                          f"Action {action} is not valid for {kind}", action=action)
    target = resolve_target(reg, kind, raw_id)
    value = normalize_value(kind, action, value)
    command_id = uuid.uuid4()
    token: str | None = None
    code = ""
    with conn.transaction():
        conn.execute(CONTROL_LOCK)       # ★ ตัดสินทีละคำสั่ง — ปิดวาล์ว 6 ตัวพร้อมกันต้องนับเพดานได้ถูก
        rules = interlock.load_rules(conn)
        ctx = interlock.build_context(conn, reg)
        confirmed = bool(confirm_token) and _consume_token(conn, str(confirm_token), issuer, target, action, value)
        violations = interlock.evaluate(ctx, rules, target, action, value, issuer.automatic, confirmed)
        needs_confirmation = interlock.requires_confirmation(ctx, rules, target, action)
        if violations:
            blocking = [v for v in violations if not v.confirmable]
            first = blocking[0] if blocking else violations[0]
            if not blocking and not issuer.automatic:
                token = _create_token(conn, issuer, target, action, value)
                code = "CONFIRMATION_REQUIRED"
            else:
                code = first.rule.rule_id
            _record(conn, command_id, target, action, value, issuer, reason, "rejected", needs_confirmation,
                    reject_code=code, reject_reason=first.message_th)
        else:
            _record(conn, command_id, target, action, value, issuer, reason, "pending", needs_confirmation)
            if kind == "system" and action == "emergency_stop":
                _engage_lockout(conn)
    if kind == "system" and action == "emergency_stop" and not violations:
        invalidate()
    publish_event("commands", {"commandId": str(command_id)})

    if violations:
        details: dict[str, str | int | float | bool | None] = {"commandId": str(command_id), "rule": code}
        if token is not None:
            details |= {"confirmToken": token, "expiresInSeconds": CONFIRM_TTL_SECONDS}
        raise ApiException(409, "CONFIRMATION_REQUIRED" if token else "INTERLOCK_REJECTED", first.message_th,
                           first.message_en, details)

    base = str(reg.setting("network", "mqttBaseTopic", "plant/water"))
    if kind == "system":
        _dispatch_system(conn, reg, publish, base, command_id, action, issuer, reason)
    elif not _send(conn, publish, base, command_id, kind, target.id, action, value):
        raise ApiException(503, "BROKER_UNAVAILABLE", BROKER_TH, BROKER_EN, {"commandId": str(command_id)})
    return require_entry(conn, reg.timezone, str(command_id))


def clear_lockout(conn: psycopg.Connection, issuer: Issuer, reason: str | None) -> dict[str, object]:
    """ปลดล็อกหลังหยุดฉุกเฉิน — เป็นการเปลี่ยนสถานะในซอฟต์แวร์ ไม่ได้สั่งอุปกรณ์ จึงบันทึกว่ายืนยันแล้วทันที"""
    reg = registry(conn, fresh=True)
    command_id = uuid.uuid4()
    target = interlock.Target("system", "system", "ทั้งระบบ", "Whole system")
    with conn.transaction():
        conn.execute(CONTROL_LOCK)
        conn.execute("""UPDATE settings SET value = jsonb_set(value, '{controlLockout}', 'false'), updated_at = now()
                         WHERE section = 'security'""")
        conn.execute("""UPDATE entities SET spec = (spec - 'controlModeBeforeLockout') || jsonb_build_object(
                            'controlMode', coalesce(spec->'controlModeBeforeLockout', '"auto"'::jsonb))
                         WHERE source_type = 'pump' AND spec->>'controlMode' = 'locked_out'""")
        _record(conn, command_id, target, "set_mode", "auto", issuer, reason or "ปลดล็อกหลังหยุดฉุกเฉิน", "confirmed", False)
        conn.execute("""UPDATE commands SET sent_at = now(), confirmed_at = now(), latency_ms = 0, feedback_value = %s
                         WHERE command_id = %s""", (Jsonb("auto"), command_id))
    invalidate()
    publish_event("commands", {"commandId": str(command_id)})
    return require_entry(conn, reg.timezone, str(command_id))


# ─────────────── อ่าน ───────────────

COMMAND_SELECT = """
    SELECT c.*, u.display_name, u.role, e.name AS entity_name
      FROM commands c
      LEFT JOIN users u ON u.user_id = c.issued_by
      LEFT JOIN entities e ON e.entity_id = c.target_id"""


def _scalar(value: object) -> str | float | int | None:
    return value if isinstance(value, str | int | float) and not isinstance(value, bool) else None


def _actor(actor_id: str, display_name: object, role: object) -> dict[str, object]:
    if actor_id.startswith("schedule:"):
        return {"userId": actor_id, "displayName": f"ตารางเวลา #{actor_id.split(':', 1)[1]}", "role": "operator"}
    return {"userId": actor_id, "displayName": display_name or actor_id, "role": role or "viewer"}


def to_result(row: dict[str, object], tz: str) -> dict[str, object]:
    status = str(row["status"])
    code, message = row["reject_code"], row["reject_reason"]
    if status == "timeout":
        code, message = "FEEDBACK_TIMEOUT", TIMEOUT_MESSAGE
    return {"commandId": str(row["command_id"]), "state": STATE_OF[status], "sentAt": iso_dt(row["sent_at"], tz),  # type: ignore[arg-type]
            "feedbackAt": iso_dt(row["confirmed_at"], tz), "latencyMs": row["latency_ms"],  # type: ignore[arg-type]
            "feedbackValue": _scalar(row["feedback_value"]), "errorCode": code, "errorMessage": message, "attempt": 1}


def to_entry(row: dict[str, object], tz: str) -> dict[str, object]:
    issued = iso_required(row["created_at"], tz)  # type: ignore[arg-type]
    target_name = row["entity_name"] or ("ทั้งระบบ" if row["target_kind"] == "system" else row["target_id"])
    return {"command": {
        "id": str(row["command_id"]), "name": f"{row['action']} → {target_name}", "createdAt": issued,
        "updatedAt": iso_required(row["updated_at"], tz), "targetType": row["target_kind"],  # type: ignore[arg-type]
        "targetId": row["target_id"], "targetName": target_name, "action": row["action"],
        "value": _scalar((row["payload"] or {}).get("value")),  # type: ignore[union-attr]
        "issuedBy": _actor(str(row["issued_by"]), row["display_name"], row["role"]), "issuedAt": issued,
        "requiresConfirmation": bool(row["requires_confirmation"]), "timeoutMs": row["timeout_ms"],
        "reason": row["reason"]}, "result": to_result(row, tz)}


def _command_rows(conn: psycopg.Connection, clause: str, params: tuple | list) -> list[dict[str, object]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"{COMMAND_SELECT} {clause}", params)  # type: ignore[arg-type]
        return cur.fetchall()


def _uuid(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise not_found("COMMAND_NOT_FOUND", f"ไม่พบคำสั่ง {raw}", f"Command {raw} not found", id=raw) from exc


def require_entry(conn: psycopg.Connection, tz: str, command_id: str) -> dict[str, object]:
    rows = _command_rows(conn, "WHERE c.command_id = %s", (_uuid(command_id),))
    if not rows:
        raise not_found("COMMAND_NOT_FOUND", f"ไม่พบคำสั่ง {command_id}", f"Command {command_id} not found", id=command_id)
    return to_entry(rows[0], tz)


def get_result(conn: psycopg.Connection, tz: str, command_id: str) -> dict[str, object] | None:
    try:
        rows = _command_rows(conn, "WHERE c.command_id = %s", (uuid.UUID(command_id),))
    except ValueError:
        return None
    return to_result(rows[0], tz) if rows else None


def list_entries(conn: psycopg.Connection, tz: str, limit: int, offset: int) -> list[dict[str, object]]:
    return [to_entry(r, tz) for r in _command_rows(conn, "ORDER BY c.created_at DESC LIMIT %s OFFSET %s",
                                                   (limit, offset))]


def interlocks(conn: psycopg.Connection) -> list[dict[str, object]]:
    reg = registry(conn, fresh=True)
    rules = interlock.load_rules(conn)
    ctx = interlock.build_context(conn, reg)
    out = []
    for kind in ("pump", "valve"):
        for entity in reg.of_type(kind):
            target = interlock.Target(kind, str(entity["entity_id"]), str(entity["name"]), str(entity["name_en"]))
            out.append(interlock.interlock_for(ctx, rules, target, ACTIONS[kind]))
    return out


# ─────────────── ฝั่ง dispatcher: feedback · timeout · สรุปคำสั่งแม่ ───────────────

def _apply_effect(conn: psycopg.Connection, kind: str, target_id: str, action: str | None, observed: object) -> None:
    """ความจริงจากอุปกรณ์ — บันทึกแม้ไม่มีคำสั่งรออยู่ (เช่นช่างหมุนวาล์วที่ตู้เอง)"""
    if kind == "valve" and observed in ("open", "closed", "opening", "closing", "fault"):
        conn.execute("""UPDATE state_spans SET ended_at = now() WHERE entity_id = %s AND metric = 'valve_position'
                          AND ended_at IS NULL AND state <> %s""", (target_id, observed))
        conn.execute("""INSERT INTO state_spans (entity_id, metric, state, started_at)
                        SELECT %s, 'valve_position', %s, now()
                         WHERE NOT EXISTS (SELECT 1 FROM state_spans WHERE entity_id = %s AND metric = 'valve_position'
                                             AND ended_at IS NULL)""", (target_id, observed, target_id))
    elif kind == "pump" and action == "set_mode" and observed in MODE_VALUES["pump"]:
        conn.execute("""UPDATE entities SET spec = spec || jsonb_build_object('controlMode', %s::text)
                         WHERE entity_id = %s""",
                     (observed, target_id))
    elif kind == "pressure_control" and action == "set_setpoint" and isinstance(observed, int | float):
        conn.execute("""UPDATE entities SET spec = spec || jsonb_build_object('setpointBar', %s::numeric,
                                                                             'mode', 'manual')
                         WHERE entity_id = %s""", (observed, target_id))


def handle_feedback(conn: psycopg.Connection, topic_kind: str, target_id: str, payload: object) -> str | None:
    """feedback = {commandId?, ok?, position|runState|mode|value, error?} · ไม่มี commandId ใช้คำสั่งล่าสุดที่รออยู่"""
    kind = FEEDBACK_KIND.get(topic_kind)
    if kind is None or not isinstance(payload, dict):
        return None
    try:
        wanted = uuid.UUID(str(payload["commandId"])) if payload.get("commandId") else None
    except ValueError:
        wanted = None
    ok = payload.get("ok") is not False
    observed = next((payload[k] for k in ("position", "runState", "mode", "value") if payload.get(k) is not None), None)
    with conn.transaction():
        row = conn.execute(f"""SELECT command_id, action FROM commands
                                WHERE target_kind = %s AND target_id = %s AND status IN ('pending', 'awaiting_feedback')
                                {"AND command_id = %s" if wanted else ""}
                                ORDER BY created_at DESC LIMIT 1 FOR UPDATE""",
                           (kind, target_id, *([wanted] if wanted else []))).fetchone()
        if ok:
            _apply_effect(conn, kind, target_id, row[1] if row else None, observed)
        if row is None:
            return None
        if ok:
            conn.execute("""UPDATE commands SET status = 'confirmed', confirmed_at = now(), updated_at = now(),
                                   latency_ms = (extract(epoch FROM now() - created_at) * 1000)::int,
                                   feedback_value = %s
                             WHERE command_id = %s""", (Jsonb(_scalar(observed)), row[0]))
        else:
            conn.execute("""UPDATE commands SET status = 'rejected', reject_code = 'DEVICE_REJECTED',
                                   reject_reason = %s,
                                   feedback_value = %s, updated_at = now() WHERE command_id = %s""",
                         (f"อุปกรณ์ปฏิเสธคำสั่ง: {payload.get('error') or 'ไม่ระบุเหตุผล'}", Jsonb(_scalar(observed)), row[0]))
        _audit_result(conn, [str(row[0])], "confirmed" if ok else "rejected")
    publish_event("commands", {"commandId": str(row[0])})
    return str(row[0])


def sweep_timeouts(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute("""UPDATE commands c SET status = 'timeout', updated_at = now()
                            WHERE c.status IN ('pending', 'awaiting_feedback')
                              AND c.created_at + make_interval(secs => c.timeout_ms / 1000.0) < now()
                              AND NOT EXISTS (SELECT 1 FROM commands ch WHERE ch.parent_id = c.command_id)
                            RETURNING c.command_id""").fetchall()
    ids = [str(r[0]) for r in rows]
    if ids:
        _audit_result(conn, ids, "timeout")
        for command_id in ids:
            publish_event("commands", {"commandId": command_id})
    return ids


def settle_parents(conn: psycopg.Connection) -> list[str]:
    rows = conn.execute("""SELECT p.command_id, p.action, array_agg(ch.status), max(ch.latency_ms)
                             FROM commands p JOIN commands ch ON ch.parent_id = p.command_id
                            WHERE p.status IN ('pending', 'awaiting_feedback')
                            GROUP BY p.command_id, p.action""").fetchall()
    settled = []
    for parent_id, action, statuses, latency in rows:
        if any(s in ("pending", "awaiting_feedback") for s in statuses):
            continue
        if all(s == "confirmed" for s in statuses):
            conn.execute("""UPDATE commands SET status = 'confirmed', confirmed_at = now(), latency_ms = %s,
                                   feedback_value = %s, updated_at = now() WHERE command_id = %s""",
                         (latency, Jsonb(PARENT_VALUE.get(action)), parent_id))
            status = "confirmed"
        elif "timeout" in statuses:
            conn.execute("UPDATE commands SET status = 'timeout', updated_at = now() WHERE command_id = %s",
                         (parent_id,))
            status = "timeout"
        else:
            conn.execute("""UPDATE commands SET status = 'rejected', reject_code = 'CHILD_REJECTED', updated_at = now(),
                                   reject_reason = 'อุปกรณ์บางตัวไม่ได้รับหรือปฏิเสธคำสั่ง — ดูรายการคำสั่งย่อย'
                             WHERE command_id = %s""", (parent_id,))
            status = "rejected"
        _audit_result(conn, [str(parent_id)], status)
        publish_event("commands", {"commandId": str(parent_id)})
        settled.append(str(parent_id))
    return settled


# ─────────────── ตารางเวลา ───────────────

def next_run(run_time: str, repeat: str, days: list[int], enabled: bool, after: datetime, tz: str) -> datetime | None:
    """ครั้งถัดไปตามเวลาโรงงาน — ตรรกะเดียวกับ computeNextRun() ใน lib/mock/control.ts"""
    if not enabled:
        return None
    hour, minute = (int(part) for part in run_time.split(":"))
    zone = ZoneInfo(tz)
    local = after.astimezone(zone)
    day = local.date()
    if datetime.combine(day, time(hour, minute), tzinfo=zone) <= local:
        day += timedelta(days=1)
    for _ in range(8):
        weekday = (day.weekday() + 1) % 7                    # 0 = อาทิตย์ เหมือน Date.getDay()
        if repeat in ("daily", "once") or (repeat == "weekdays" and 1 <= weekday <= 5) or \
                (repeat == "weekly" and weekday in days):
            return datetime.combine(day, time(hour, minute), tzinfo=zone)
        day += timedelta(days=1)
    return None


SCHEDULE_SELECT = """
    SELECT s.*, c.status AS last_status, u.display_name, u.role, e.name AS entity_name
      FROM command_schedules s
      LEFT JOIN commands c ON c.command_id = s.last_command_id
      LEFT JOIN users u ON u.user_id = s.created_by
      LEFT JOIN entities e ON e.entity_id = s.target_id"""


def to_schedule(row: dict[str, object], tz: str) -> dict[str, object]:
    target_name = row["entity_name"] or "ระบบ"
    return {
        "id": str(row["schedule_id"]), "name": f"{row['action']} → {target_name} {row['run_time']}",
        "createdAt": iso_required(row["created_at"], tz), "updatedAt": iso_required(row["updated_at"], tz),  # type: ignore[arg-type]
        "targetType": row["target_kind"], "targetId": row["target_id"], "targetName": target_name,
        "action": row["action"], "value": _scalar(row["value"]), "time": row["run_time"], "repeat": row["repeat"],
        "daysOfWeek": list(row["days_of_week"] or []), "enabled": bool(row["enabled"]),  # type: ignore[call-overload]
        "nextRunAt": iso_dt(row["next_run_at"], tz), "lastRunAt": iso_dt(row["last_run_at"], tz),  # type: ignore[arg-type]
        "lastResultState": STATE_OF.get(str(row["last_status"])) if row["last_status"] else None,
        "createdBy": _actor(str(row["created_by"]), row["display_name"], row["role"]),
    }


def _schedule_rows(conn: psycopg.Connection, clause: str, params: tuple) -> list[dict[str, object]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"{SCHEDULE_SELECT} {clause}", params)  # type: ignore[arg-type]
        return cur.fetchall()


def _schedule_id(raw: str) -> int:
    if not raw.isdigit():
        raise not_found("SCHEDULE_NOT_FOUND", f"ไม่พบตารางเวลา {raw}", f"Schedule {raw} not found", id=raw)
    return int(raw)


def require_schedule(conn: psycopg.Connection, tz: str, schedule_id: int) -> dict[str, object]:
    rows = _schedule_rows(conn, "WHERE s.schedule_id = %s", (schedule_id,))
    if not rows:
        raise not_found("SCHEDULE_NOT_FOUND", f"ไม่พบตารางเวลา {schedule_id}", f"Schedule {schedule_id} not found",
                        id=schedule_id)
    return to_schedule(rows[0], tz)


def list_schedules(conn: psycopg.Connection, tz: str) -> list[dict[str, object]]:
    return [to_schedule(r, tz) for r in _schedule_rows(conn, "ORDER BY s.run_time, s.schedule_id", ())]


def _check_timing(run_time: str, repeat: str, days: list[int]) -> None:
    if HHMM.fullmatch(run_time) is None:
        raise bad_request("VALIDATION_FAILED", "เวลาต้องอยู่ในรูปแบบ HH:mm", "Time must be HH:mm", field="time")
    if repeat not in ("once", "daily", "weekdays", "weekly"):
        raise bad_request("VALIDATION_FAILED", "รูปแบบการทำซ้ำไม่ถูกต้อง", "Invalid repeat", field="repeat")
    if any(day not in range(7) for day in days) or (repeat == "weekly" and not days):
        raise bad_request("VALIDATION_FAILED", "ทำซ้ำรายสัปดาห์ต้องเลือกวัน 0–6 อย่างน้อยหนึ่งวัน",
                          "Weekly schedules need at least one day between 0 and 6", field="daysOfWeek")


def create_schedule(conn: psycopg.Connection, user: CurrentUser, kind: str, raw_id: str, action: str, value: object,
                    run_time: str, repeat: str, days: list[int], enabled: bool) -> dict[str, object]:
    reg = registry(conn, fresh=True)
    if action not in ACTIONS.get(kind, ()):
        raise bad_request("ACTION_NOT_ALLOWED", f"คำสั่ง {action} ใช้กับ {kind} ไม่ได้",
                          f"Action {action} is not valid for {kind}", action=action)
    target = resolve_target(reg, kind, raw_id)
    value = normalize_value(kind, action, value)
    _check_timing(run_time, repeat, days)
    # ★ ไม่ยอมให้ตั้งตารางที่ไม่มีวันผ่านด่าน (เช่นปิดโซน VIP) — ถึงเวลาจริงก็ถูกตรวจซ้ำอีกรอบอยู่ดี
    rules = interlock.load_rules(conn)
    ctx = interlock.build_context(conn, reg)
    static = [v for v in interlock.evaluate(ctx, rules, target, action, value, True, False)
              if v.rule.check_name in interlock.STATIC_AUTO]
    if static:
        raise ApiException(409, "SCHEDULE_ALWAYS_BLOCKED", static[0].message_th, static[0].message_en,
                           {"rule": static[0].rule.rule_id})
    upcoming = next_run(run_time, repeat, days, enabled, datetime.now(UTC), reg.timezone)
    row = conn.execute("""INSERT INTO command_schedules (target_kind, target_id, action, value, run_time, repeat,
                                                         days_of_week, enabled, next_run_at, created_by)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING schedule_id""",
                       (target.kind, target.id, action, Jsonb(value), run_time, repeat, days, enabled, upcoming,
                        user.user_id)).fetchone()
    conn.execute("INSERT INTO audit_log (user_id, action, target, new_value, result) VALUES (%s, %s, %s, %s, 'ok')",
                 (user.user_id, "schedule:create", f"schedule:{row[0]}",  # type: ignore[index]
                  json.dumps({"target": target.id, "action": action, "time": run_time, "repeat": repeat},
                             ensure_ascii=False)))
    return require_schedule(conn, reg.timezone, int(row[0]))  # type: ignore[index]


def update_schedule(conn: psycopg.Connection, user: CurrentUser, raw_id: str,
                    changes: dict[str, object]) -> dict[str, object]:
    reg = registry(conn)
    schedule_id = _schedule_id(raw_id)
    current = conn.execute("""SELECT run_time, repeat, days_of_week, enabled FROM command_schedules
                               WHERE schedule_id = %s""",
                           (schedule_id,)).fetchone()
    if current is None:
        raise not_found("SCHEDULE_NOT_FOUND", f"ไม่พบตารางเวลา {schedule_id}", f"Schedule {schedule_id} not found",
                        id=schedule_id)
    run_time = str(changes.get("time") or current[0])
    repeat = str(changes.get("repeat") or current[1])
    days = list(changes["daysOfWeek"]) if changes.get("daysOfWeek") is not None else list(current[2] or [])  # type: ignore[call-overload]
    enabled = bool(changes["enabled"]) if changes.get("enabled") is not None else bool(current[3])
    _check_timing(run_time, repeat, days)
    conn.execute("""UPDATE command_schedules SET run_time = %s, repeat = %s, days_of_week = %s, enabled = %s,
                           next_run_at = %s, updated_at = now() WHERE schedule_id = %s""",
                 (run_time, repeat, days, enabled, next_run(run_time, repeat, days, enabled, datetime.now(UTC),
                                                            reg.timezone), schedule_id))
    conn.execute("INSERT INTO audit_log (user_id, action, target, new_value, result) VALUES (%s, %s, %s, %s, 'ok')",
                 (user.user_id, "schedule:update", f"schedule:{schedule_id}", json.dumps(changes, ensure_ascii=False)))
    return require_schedule(conn, reg.timezone, schedule_id)


def delete_schedule(conn: psycopg.Connection, user: CurrentUser, raw_id: str) -> bool:
    schedule_id = _schedule_id(raw_id)
    if conn.execute("DELETE FROM command_schedules WHERE schedule_id = %s", (schedule_id,)).rowcount == 0:
        raise not_found("SCHEDULE_NOT_FOUND", f"ไม่พบตารางเวลา {schedule_id}", f"Schedule {schedule_id} not found",
                        id=schedule_id)
    conn.execute("INSERT INTO audit_log (user_id, action, target, result) VALUES (%s, 'schedule:delete', %s, 'ok')",
                 (user.user_id, f"schedule:{schedule_id}"))
    return True


def run_due_schedules(conn: psycopg.Connection, publish: Publisher) -> int:
    """★ สั่งในนาม schedule:<id> (ระบบอัตโนมัติ) ผ่านด่านชุดเดียวกับคน · คำสั่งพลาดรอบ (dispatcher ดับ) ทำครั้งเดียวแล้วไปรอบถัดไป"""
    reg = registry(conn)
    due = conn.execute("""SELECT schedule_id, target_kind, target_id, action, value, run_time, repeat, days_of_week,
                                 next_run_at
                            FROM command_schedules WHERE enabled AND next_run_at <= now()
                           ORDER BY next_run_at""").fetchall()
    ran = 0
    for schedule_id, kind, target_id, action, value, run_time, repeat, days, due_at in due:
        enabled = repeat != "once"
        upcoming = next_run(run_time, repeat, list(days or []), enabled, datetime.now(UTC), reg.timezone)
        claimed = conn.execute("""UPDATE command_schedules SET next_run_at = %s, enabled = %s, last_run_at = now(),
                                         updated_at = now()
                                   WHERE schedule_id = %s AND next_run_at = %s RETURNING 1""",
                               (upcoming, enabled, schedule_id, due_at)).fetchone()
        if claimed is None:
            continue
        issuer = Issuer(f"schedule:{schedule_id}", f"ตารางเวลา #{schedule_id}", "operator", True)
        command_id: object = None
        try:
            entry = issue(conn, publish, kind, target_id, action, value, issuer, f"ตารางเวลา #{schedule_id}", None)
            command_id = entry["command"]["id"]  # type: ignore[index]
        except ApiException as exc:
            command_id = (exc.details or {}).get("commandId")
        if command_id:
            conn.execute("UPDATE command_schedules SET last_command_id = %s WHERE schedule_id = %s",
                         (uuid.UUID(str(command_id)), schedule_id))
        ran += 1
    return ran


# ─────────────── อุปกรณ์ ───────────────

def reboot_device(conn: psycopg.Connection, publish: Publisher, user: CurrentUser, device_id: str) -> dict[str, object]:
    """DeviceActionResult · ★ รีบูตระยะไกลได้เฉพาะ ESP32 (อ่าน plant/water/<device>/cmd ของตัวเองตาม ACL)"""
    reg = registry(conn)
    device = reg.devices.get(device_id)
    if device is None:
        raise not_found("ENTITY_NOT_FOUND", f"ไม่พบอุปกรณ์ {device_id}", f"Device {device_id} not found", id=device_id)
    at = datetime.now(UTC)
    if device["kind"] != "esp32":
        return {"deviceId": device_id, "action": "reboot", "ok": False, "latencyMs": None,
                "message": "รีบูตจากระยะไกลทำได้เฉพาะ ESP32 — PLC/HMI/gateway ต้องรีสตาร์ตที่ตู้",
                "at": iso_required(at, reg.timezone)}
    started = clock.perf_counter()
    base = str(reg.setting("network", "mqttBaseTopic", "plant/water"))
    ok = publish(f"{base.rstrip('/')}/{device_id}/cmd", {"action": "reboot", "requestedBy": user.user_id,
                                                         "at": at.isoformat(timespec="milliseconds")})
    latency = round((clock.perf_counter() - started) * 1000)
    conn.execute("""INSERT INTO audit_log (user_id, action, target, result, latency_ms)
                    VALUES (%s, 'device:reboot', %s, %s, %s)""",
                 (user.user_id, f"device:{device_id}", "sent" if ok else "rejected", latency if ok else None))
    return {"deviceId": device_id, "action": "reboot", "ok": ok, "latencyMs": latency if ok else None,
            "message": "ส่งคำสั่งรีบูตแล้ว อุปกรณ์จะหลุดออนไลน์ชั่วครู่แล้วกลับมา" if ok else BROKER_TH,
            "at": iso_required(at, reg.timezone)}
