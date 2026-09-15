"""ด่านตรวจคำสั่งฝั่งเซิร์ฟเวอร์ (PROMPT_05 งานที่ 3) — ★ ด่านสุดท้ายแทน PLC หลังย้ายวาล์วไป ESP32

★ กฎโหลดจากตาราง interlock_rules ทุกครั้ง (เปิด/ปิด · พารามิเตอร์ · ข้อความ) โค้ดมีแค่ "วิธีตรวจ" ตาม check_name
★ ห้ามเชื่อว่าหน้าจอกรองมาแล้ว — ทุกคำสั่งผ่านที่นี่ก่อนเขียน commands เสมอ (รวม curl และตารางเวลา)
★ ตรรกะแปลงจาก pumpInterlock() / valveInterlock() / validate() ใน lib/mock/control.ts
★ กฎที่ไม่รู้จักวิธีตรวจ = ระงับคำสั่ง (fail-closed) ไม่ใช่ปล่อยผ่าน
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

import psycopg

from .domain_water import build_pressure_control, build_pumps, build_tanks, build_valves, build_zones
from .registry import Registry

Fields = dict[str, object] | None


@dataclass(frozen=True)
class Rule:
    rule_id: str
    target_kind: str
    check_name: str
    actions: tuple[str, ...]
    params: dict[str, object]
    message_th: str
    message_en: str
    blocks_auto: bool
    blocks_manual: bool


@dataclass(frozen=True)
class Target:
    kind: str
    id: str
    name: str
    name_en: str


@dataclass
class Context:
    """สภาพระบบ ณ ตอนตรวจ — ประกอบจากฟังก์ชันชุดเดียวกับที่หน้าจอเห็น"""

    lockout: bool
    tanks: dict[str, dict[str, object]]
    pumps: dict[str, dict[str, object]]
    valves: dict[str, dict[str, object]]
    zones: dict[str, dict[str, object]]
    pressure: dict[str, object]
    closing: set[str]                              # วาล์วที่มีคำสั่งปิดค้างรอ feedback
    recent_closes: Callable[[float], int]          # จำนวนคำสั่งปิดวาล์วในกี่วินาทีที่ผ่านมา


@dataclass(frozen=True)
class Violation:
    rule: Rule
    message_th: str
    message_en: str
    confirmable: bool                              # ผ่านได้ถ้ามีโทเคนยืนยันชั้นที่สอง


Check = Callable[[Context, Target, "str | None", object, dict[str, object]], Fields]

CONFIRMABLE = frozenset({"vip_zone_unconfirmed", "system_unconfirmed"})
NEEDS_VALUE = frozenset({"value_between", "setpoint_within_limits", "pid_requires_vfd"})
# กฎที่ผลไม่ขึ้นกับสภาพหน้างาน — ใช้ปฏิเสธการตั้งตารางเวลาที่ไม่มีวันผ่านด่าน
STATIC_AUTO = frozenset({"vip_zone", "always"})


def _number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


class _Blank(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def render(template: str, fields: dict[str, object]) -> str:
    return template.format_map(_Blank(fields))


# ─────────────── วิธีตรวจ ───────────────

def _control_locked(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    return {} if ctx.lockout and action not in (params.get("except_actions") or []) else None


def _source_tank_below(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    """★ ใช้ค่าล่าสุดที่เคยได้แม้อุปกรณ์เพิ่งหลุด — ต่ำก็คือต่ำ (D-60)
    ★ ถังที่ไม่เคยได้ค่าเลย (lastSeen = 1970) ไม่ถูกตัดสินว่าต่ำ เพราะปั๊มยังมีด่าน level switch ใน PLC อีกชั้น
    """
    pump = ctx.pumps.get(target.id) or {}
    tank = ctx.tanks.get(str(pump.get("sourceTankId")))
    minimum = float(params.get("min_percent", 15))  # type: ignore[arg-type]
    if tank is None or str(tank.get("lastSeen", "")).startswith("1970") \
            or float(tank["percentFull"]) >= minimum:  # type: ignore[arg-type]
        return None
    return {"tank": tank["name"], "tankEn": tank["nameEn"], "percent": f"{float(tank['percentFull']):.1f}",  # type: ignore[arg-type]
            "min": _number(minimum)}


def _pump_in_fault(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    pump = ctx.pumps.get(target.id) or {}
    return {"code": pump.get("faultCode") or "-"} if pump.get("runState") == "fault" else None


def _pump_locked_out(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    return {} if (ctx.pumps.get(target.id) or {}).get("controlMode") == "locked_out" else None


def _pid_requires_vfd(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    pump = ctx.pumps.get(target.id) or {}
    return {} if action == "set_mode" and value == "pid" and not pump.get("hasVfd") else None


def _remote_disabled(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    valve = ctx.valves.get(target.id)
    return {} if valve is not None and valve.get("remoteEnabled") is False else None


def _valve_moving(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    return {} if (ctx.valves.get(target.id) or {}).get("position") in ("opening", "closing") else None


def _vip_zone(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    zone = ctx.zones.get(str((ctx.valves.get(target.id) or {}).get("zoneId")))
    return {"zone": zone["name"], "zoneEn": zone["nameEn"]} if zone is not None and zone.get("isVip") else None


def _close_rate_limit(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    maximum = int(params.get("max_closes", 3))  # type: ignore[call-overload]
    window = float(params.get("window_seconds", 10))  # type: ignore[arg-type]
    return {"max": maximum, "window": _number(window)} if ctx.recent_closes(window) >= maximum else None


def _last_open_valve(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    """ปั๊มที่กำลังเดินต้องเหลือวาล์วปลายทางที่เปิดอยู่อย่างน้อยหนึ่งตัว"""
    zone_id = (ctx.valves.get(target.id) or {}).get("zoneId")
    for pump in ctx.pumps.values():
        served = pump.get("servesZoneIds") or []
        if pump.get("runState") != "running" or zone_id not in served:  # type: ignore[operator]
            continue
        still_open = [v for v in ctx.valves.values()
                      if v.get("zoneId") in served and v["id"] != target.id  # type: ignore[operator]
                      and v.get("position") != "closed" and v["id"] not in ctx.closing]
        if not still_open:
            return {"pump": pump["name"], "pumpEn": pump["nameEn"]}
    return None


def _out_of_range(value: object, low: object, high: object) -> Fields:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        number = math.nan
    lo, hi = float(low), float(high)  # type: ignore[arg-type]
    if math.isfinite(number) and lo <= number <= hi:
        return None
    return {"min": _number(lo), "max": _number(hi)}


def _value_between(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    return _out_of_range(value, params.get("min", 0), params.get("max", 100))


def _setpoint_within_limits(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    limits = ctx.pressure.get("setpointLimitsBar") or {}
    return _out_of_range(value, limits.get("min", 0), limits.get("max", 0))  # type: ignore[union-attr]


def _always(ctx: Context, target: Target, action: str | None, value: object, params: dict) -> Fields:
    return {}


CHECKS: dict[str, Check] = {
    "control_locked": _control_locked, "source_tank_below": _source_tank_below, "pump_in_fault": _pump_in_fault,
    "pump_locked_out": _pump_locked_out, "pid_requires_vfd": _pid_requires_vfd, "remote_disabled": _remote_disabled,
    "valve_moving": _valve_moving, "vip_zone": _vip_zone, "vip_zone_unconfirmed": _vip_zone,
    "close_rate_limit": _close_rate_limit, "last_open_valve_of_running_pump": _last_open_valve,
    "value_between": _value_between, "setpoint_within_limits": _setpoint_within_limits, "always": _always,
    "system_unconfirmed": _always,
}


# ─────────────── โหลดกฎ · สภาพระบบ ───────────────

def load_rules(conn: psycopg.Connection) -> list[Rule]:
    rows = conn.execute("""SELECT rule_id, target_kind, check_name, actions, params, message_th, message_en,
                                  blocks_auto, blocks_manual
                             FROM interlock_rules WHERE enabled ORDER BY sort_order, rule_id""").fetchall()
    return [Rule(r[0], r[1], r[2], tuple(r[3] or ()), dict(r[4] or {}), r[5], r[6], r[7], r[8]) for r in rows]


def build_context(conn: psycopg.Connection, reg: Registry) -> Context:
    closing = {row[0] for row in conn.execute("""SELECT target_id FROM commands WHERE target_kind = 'valve'
                                                   AND action = 'close'
                                                   AND status IN ('pending', 'awaiting_feedback')""")}

    def recent_closes(seconds: float) -> int:
        # ★ นับคำสั่งที่ไม่ถูกปฏิเสธ รวมที่ยังรอ feedback · คำสั่งย่อยของปุ่มทั้งระบบไม่นับ
        row = conn.execute("""SELECT count(*) FROM commands WHERE target_kind = 'valve' AND action = 'close'
                                 AND parent_id IS NULL AND status <> 'rejected'
                                 AND created_at > clock_timestamp() - make_interval(secs => %s)""",
                           (seconds,)).fetchone()
        return int(row[0])  # type: ignore[index]

    return Context(lockout=bool(reg.setting("security", "controlLockout", False)),
                   tanks={str(t["id"]): t for t in build_tanks(conn, reg)},
                   pumps={str(p["id"]): p for p in build_pumps(conn, reg)},
                   valves={str(v["id"]): v for v in build_valves(conn, reg)},
                   zones={str(z["id"]): z for z in build_zones(conn, reg)},
                   pressure=build_pressure_control(conn, reg), closing=closing, recent_closes=recent_closes)


# ─────────────── ตัดสิน ───────────────

def applies(rule: Rule, kind: str, action: str | None) -> bool:
    return rule.target_kind in (kind, "any") and (not rule.actions or action in rule.actions)


def evaluate(ctx: Context, rules: list[Rule], target: Target, action: str, value: object, automatic: bool,
             confirmed: bool) -> list[Violation]:
    found: list[Violation] = []
    for rule in rules:
        if not applies(rule, target.kind, action) or not (rule.blocks_auto if automatic else rule.blocks_manual):
            continue
        confirmable = rule.check_name in CONFIRMABLE
        if confirmable and confirmed:
            continue
        check = CHECKS.get(rule.check_name)
        if check is None:
            found.append(Violation(rule, f"กฎ {rule.rule_id} ตั้งค่าผิด (ไม่รู้จักวิธีตรวจ {rule.check_name}) — ระงับคำสั่งไว้ก่อน",
                                   f"Rule {rule.rule_id} is misconfigured (unknown check {rule.check_name}); "
                                   "command held", False))
            continue
        fields = check(ctx, target, action, value, rule.params)
        if fields is not None:
            found.append(Violation(rule, render(rule.message_th, fields), render(rule.message_en, fields), confirmable))
    return found


def requires_confirmation(ctx: Context, rules: list[Rule], target: Target, action: str) -> bool:
    return any(applies(rule, target.kind, action) and rule.check_name in CONFIRMABLE
               and CHECKS[rule.check_name](ctx, target, action, None, rule.params) is not None for rule in rules)


def interlock_for(ctx: Context, rules: list[Rule], target: Target, actions: tuple[str, ...]) -> dict[str, object]:
    """ControlInterlock ของหน้าจอ — ★ blockedActions ว่าง + blocked=true = ล็อกทุกคำสั่ง (ตามคอมเมนต์ใน types.ts)"""
    reasons: list[dict[str, str]] = []
    blocked: list[str] = []
    block_all = False
    for rule in rules:
        if rule.target_kind not in (target.kind, "any") or not rule.blocks_manual or rule.check_name in NEEDS_VALUE:
            continue
        check = CHECKS.get(rule.check_name)
        fields = {} if check is None else check(ctx, target, rule.actions[0] if rule.actions else None, None,
                                                 rule.params)
        if fields is None:
            continue
        reasons.append({"code": rule.rule_id, "messageTh": render(rule.message_th, fields),
                        "messageEn": render(rule.message_en, fields)})
        if rule.check_name in CONFIRMABLE:
            continue                                  # แค่เตือนให้ยืนยันสองชั้น ไม่ได้ล็อก
        if rule.actions:
            blocked.extend(a for a in rule.actions if a in actions and a not in blocked)
        else:
            block_all = True
    return {"targetType": target.kind, "targetId": target.id, "blocked": block_all or bool(blocked),
            "blockedActions": [] if block_all else blocked, "reasons": reasons}
