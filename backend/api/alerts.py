"""alert · การรับทราบ · การส่งแจ้งเตือน — read model ของ /api/alerts และข้อความที่ notifier ส่งจริง

★ ข้อความ (messageTh/messageEn) ประกอบจาก AlertCode + entity ที่นี่ที่เดียว
  /api/alerts · /preview · notifier ใช้ชุดเดียวกัน — preview จึงตรงกับของที่ส่งจริงเสมอ
★ state คิดจากข้อมูล ไม่เก็บซ้ำ: ปิดแล้ว = resolved · มีคนรับทราบ = acknowledged · นอกนั้น active
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from .common import iso_dt, iso_required, num
from .errors import ApiException, bad_request, not_found
from .registry import Registry
from .series import to_dt

SEVERITIES = ("critical", "warning", "info")
STATES = ("active", "acknowledged", "resolved")
SOURCE_TYPES = ("tank", "pump", "zone", "valve", "meter", "sensor", "device", "electric_node", "pressure_control",
                "system")
CHANNELS = ("line", "email", "sms", "buzzer", "webhook")
SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
LEVEL_WORD = {"critical": ("วิกฤต", "critical"), "warning": ("เตือน", "warning"), "info": ("แจ้งให้ทราบ", "info")}
SEVERITY_MARK = {"critical": "🔴 วิกฤต", "warning": "🟡 เตือน", "info": "🔵 แจ้งให้ทราบ"}
TH_MONTHS = ("ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.")

# AlertCode → (ไทย, อังกฤษ, หน่วยของค่าที่วัด) · ตัวแปร {name} {nameEn} {level} {levelEn}
# ★ ต้องครบทุกรหัสใน AlertCode ของ lib/types.ts (tests/test_alerts_units.py ตรวจ)
CATALOG: dict[str, tuple[str, str, str | None]] = {
    "TANK_LEVEL_LOW": ("ระดับน้ำ{name} ต่ำกว่าเกณฑ์{level}", "{nameEn} level below {levelEn} threshold", "%"),
    "TANK_LEVEL_HIGH": ("ระดับน้ำ{name} สูงเกินเกณฑ์{level} — เสี่ยงน้ำล้น",
                        "{nameEn} level above {levelEn} threshold — overflow risk", "%"),
    "TANK_LEVEL_STALE": ("ระดับน้ำ{name} ไม่เปลี่ยนนานผิดปกติ — ตรวจเซนเซอร์ระดับ",
                         "{nameEn} level unchanged for too long — check the level sensor", None),
    "PUMP_FAULT": ("{name} แจ้งขัดข้อง", "{nameEn} reported a fault", None),
    "PUMP_OVERCURRENT": ("กระแส{name} สูงเกินเกณฑ์{level}", "{nameEn} current above {levelEn} threshold", "A"),
    "PUMP_DRY_RUN": ("{name} เดินตัวเปล่า — ถังต้นทางอาจแห้ง", "{nameEn} running dry — source tank may be empty", None),
    "PUMP_ALTERNATION": ("สลับปั๊มหลักตามรอบอัตโนมัติ ({name})", "Automatic main pump alternation ({nameEn})", None),
    "PUMP_SERVICE_DUE": ("{name} ถึงกำหนดบำรุงรักษา", "{nameEn} is due for service", "h"),
    "PRESSURE_OUT_OF_RANGE": ("แรงดันน้ำ{name} ออกนอกช่วงเกณฑ์{level}", "{nameEn} pressure outside {levelEn} range",
                              "bar"),
    "VFD_FAULT": ("อินเวอร์เตอร์ของ{name} ขัดข้อง", "{nameEn} VFD fault", None),
    "ZONE_LEAK_SUSPECTED": ("สงสัยน้ำรั่วที่{name} — มีการไหลต่อเนื่องช่วงไม่มีการใช้งาน",
                            "Suspected leak in {nameEn} — continuous flow while idle", "L/min"),
    "ZONE_QUOTA_EXCEEDED": ("{name} ใช้น้ำเกินโควตาวันนี้", "{nameEn} exceeded today's water quota", "m³"),
    "ZONE_FLOW_HIGH": ("อัตราไหล{name} สูงเกินเกณฑ์{level} — ตรวจท่อแตก",
                       "{nameEn} flow above {levelEn} threshold — check for a burst pipe", "L/min"),
    "UNACCOUNTED_WATER_HIGH": ("น้ำสูญหายเกินเกณฑ์{level} — มิเตอร์หลักสูงกว่าผลรวมทุกโซน",
                               "Unaccounted water above {levelEn} threshold — main meter exceeds zone total", "%"),
    "MAIN_SUPPLY_PRESSURE_LOW": ("แรงดันน้ำประปาขาเข้าต่ำ ({name})", "Low mains supply pressure ({nameEn})", "bar"),
    "ELECTRIC_OVERCURRENT": ("กระแส{name} สูงเกินเกณฑ์{level}", "{nameEn} current above {levelEn} threshold", "A"),
    "ELECTRIC_PHASE_LOSS": ("{name} ไฟตกหรือขาดเฟส", "{nameEn} phase loss", "V"),
    "ENV_TEMP_HIGH": ("อุณหภูมิ{name} สูงเกินเกณฑ์{level}", "{nameEn} temperature above {levelEn} threshold", "°C"),
    "ENV_HUMIDITY_HIGH": ("ความชื้น{name} สูงเกินเกณฑ์{level}", "{nameEn} humidity above {levelEn} threshold", "%RH"),
    "ENV_HEAVY_RAIN": ("ฝนตกหนักที่{name}", "Heavy rain at {nameEn}", "mm/h"),
    "DEVICE_OFFLINE": ("{name} ขาดการติดต่อ", "{nameEn} is offline", None),
    "DEVICE_WEAK_SIGNAL": ("สัญญาณ Wi-Fi ของ{name} อ่อน", "Weak Wi-Fi signal on {nameEn}", "dBm"),
    "DEVICE_LOW_MEMORY": ("หน่วยความจำของ{name} เหลือน้อย", "{nameEn} is low on memory", "B"),
    "DEVICE_FIRMWARE_MISMATCH": ("เฟิร์มแวร์ของ{name} ไม่ตรงรุ่นที่กำหนด", "{nameEn} firmware version mismatch", None),
    "ANOMALY_DETECTED": ("AI ตรวจพบความผิดปกติที่{name}", "AI detected an anomaly at {nameEn}", None),
    "COMMAND_TIMEOUT": ("คำสั่งไปยัง{name} ไม่ได้รับการยืนยันภายในเวลา", "Command to {nameEn} timed out", None),
    "BACKUP_FAILED": ("สำรองข้อมูลไม่สำเร็จ", "Backup failed", None),
}

ALERT_SELECT = """
    SELECT a.alert_id, a.entity_id, a.kind, a.severity, a.started_at, a.ended_at, a.peak_value, a.threshold,
           a.read_at, a.occurrence_count, a.anomaly_id,
           e.source_type, e.name AS entity_name, e.name_en AS entity_name_en, e.spec,
           z.department_id AS zone_department,
           ack.id AS ack_id, ack.acknowledged_at AS ack_at, ack.user_id AS ack_user,
           u.display_name AS ack_name, u.role AS ack_role
      FROM alerts a
      LEFT JOIN entities e ON e.entity_id = a.entity_id
      LEFT JOIN zones z ON z.zone_id = e.zone_id
      LEFT JOIN LATERAL (SELECT k.id, k.acknowledged_at, k.user_id FROM alert_acknowledgements k
                          WHERE k.alert_id = a.alert_id
                          ORDER BY k.acknowledged_at DESC, k.id DESC LIMIT 1) ack ON true
      LEFT JOIN users u ON u.user_id = ack.user_id"""

STATE_EXPR = ("CASE WHEN a.ended_at IS NOT NULL THEN 'resolved' "
              "WHEN ack.id IS NOT NULL THEN 'acknowledged' ELSE 'active' END")


# ─────────────── ข้อความ ───────────────

def message(code: str, severity: str, name: str, name_en: str) -> tuple[str, str]:
    th, en, _unit = CATALOG.get(code, ("เหตุการณ์ " + code + " ที่{name}", code + " at {nameEn}", None))
    level_th, level_en = LEVEL_WORD.get(severity, ("", ""))
    fields = {"name": name, "nameEn": name_en, "level": level_th, "levelEn": level_en}
    return th.format(**fields), en.format(**fields)


def unit_of(code: str) -> str | None:
    return CATALOG[code][2] if code in CATALOG else None


def thai_datetime(value: datetime, tz: str) -> str:
    """ตรงกับ formatDateTimeTH(…, 'th') ของหน้าบ้าน เช่น "14 ก.ย. 2569 12:26:43\""""
    local = value.astimezone(ZoneInfo(tz))
    return f"{local.day} {TH_MONTHS[local.month - 1]} {local.year + 543} {local:%H:%M:%S}"


def js_number(value: float) -> str:
    """ตัวเลขแบบ `${v}` ของ JavaScript — 45.0 → "45" · 45.6 → "45.6\""""
    number = float(value)
    return str(int(number)) if number.is_integer() and abs(number) < 1e21 else repr(number)


def render_notification(alert: dict[str, object], reg: Registry) -> tuple[str, str]:
    """(หัวข้อ, เนื้อความ) ที่ส่งออกจริง — รูปแบบเดียวกับ getNotificationPreview() เดิมของหน้าบ้าน"""
    title = f"{SEVERITY_MARK.get(str(alert['severity']), '')} · {reg.setting('general', 'siteName', '')}"
    lines = [title, str(alert["messageTh"]), f"จุดเกิดเหตุ: {alert['sourceName']}"]
    trigger, threshold = alert["triggerValue"], alert["thresholdValue"]
    if trigger is not None and threshold is not None:
        unit = alert["unit"] or ""
        lines.append(f"ค่าที่วัดได้: {js_number(trigger)} {unit} (เกณฑ์ {js_number(threshold)} {unit})")  # type: ignore[arg-type]
    lines.append(f"เวลา: {thai_datetime(datetime.fromisoformat(str(alert['raisedAt'])), reg.timezone)}")
    if int(alert["occurrenceCount"]) > 1:  # type: ignore[call-overload]
        lines.append(f"เกิดซ้ำ {alert['occurrenceCount']} ครั้ง")
    return title, "\n".join(lines)


# ─────────────── แปลงแถว → type ของหน้าบ้าน ───────────────

def actor(user_id: object, name: object, role: object) -> dict[str, object]:
    return {"userId": user_id, "displayName": name or user_id, "role": role or "viewer"}


def to_alert(row: dict[str, object], tz: str) -> dict[str, object]:
    code, severity = str(row["kind"]), str(row["severity"])
    name = str(row["entity_name"] or row["entity_id"] or "ระบบ")
    name_en = str(row["entity_name_en"] or row["entity_id"] or "System")
    th, en = message(code, severity, name, name_en)
    spec = row["spec"] or {}
    moments = [m for m in (row["started_at"], row["ended_at"], row["read_at"], row["ack_at"]) if m is not None]
    has_values = row["peak_value"] is not None or row["threshold"] is not None
    if row["ended_at"] is not None:
        state = "resolved"
    else:
        state = "acknowledged" if row["ack_id"] is not None else "active"
    return {
        "id": str(row["alert_id"]), "name": th,
        "createdAt": iso_required(row["started_at"], tz), "updatedAt": iso_required(max(moments), tz),  # type: ignore[type-var]
        "severity": severity, "state": state, "code": code,
        "sourceType": row["source_type"] if row["source_type"] in SOURCE_TYPES else "system",
        "sourceId": row["entity_id"] or "system", "sourceName": name,
        "departmentId": row["zone_department"] or spec.get("departmentId"),  # type: ignore[union-attr]
        "messageTh": th, "messageEn": en,
        "triggerValue": num(row["peak_value"], 2), "thresholdValue": num(row["threshold"], 2),
        "unit": unit_of(code) if has_values else None,
        "raisedAt": iso_required(row["started_at"], tz), "resolvedAt": iso_dt(row["ended_at"], tz),  # type: ignore[arg-type]
        "read": row["read_at"] is not None,
        "acknowledgementId": None if row["ack_id"] is None else str(row["ack_id"]),
        "anomalyEventId": None if row["anomaly_id"] is None else str(row["anomaly_id"]),
        "occurrenceCount": int(row["occurrence_count"]),  # type: ignore[call-overload]
    }


def to_ack(row: dict[str, object], tz: str) -> dict[str, object]:
    at = iso_required(row["acknowledged_at"], tz)  # type: ignore[arg-type]
    return {"id": str(row["id"]), "name": f"รับทราบ {row['kind']}", "createdAt": at, "updatedAt": at,
            "alertId": str(row["alert_id"]), "acknowledgedBy": actor(row["user_id"], row["display_name"], row["role"]),
            "acknowledgedAt": at, "note": row["note"], "snoozeMinutes": row["snooze_minutes"]}


def to_delivery(row: dict[str, object], tz: str) -> dict[str, object]:
    return {"id": str(row["id"]), "name": f"{row['channel']} → {row['recipient']}",
            "createdAt": iso_required(row["created_at"], tz), "updatedAt": iso_required(row["updated_at"], tz),  # type: ignore[arg-type]
            "alertId": str(row["alert_id"]), "channel": row["channel"], "deliveryState": row["state"],
            "recipient": row["recipient"], "attempts": row["attempts"],
            "lastAttemptAt": iso_dt(row["last_attempt_at"], tz), "deliveredAt": iso_dt(row["delivered_at"], tz),  # type: ignore[arg-type]
            "errorMessage": row["error"]}


# ─────────────── อ่าน ───────────────

@dataclass(frozen=True)
class AlertFilter:
    severities: list[str] | None = None
    states: list[str] | None = None
    source_types: list[str] | None = None
    codes: list[str] | None = None
    source_ids: list[str] | None = None
    department_ids: list[str] | None = None
    unread_only: bool = False
    from_ms: int | None = None
    to_ms: int | None = None
    limit: int = 50
    offset: int = 0


def parse_id(raw: str, what: str = "ALERT") -> int:
    if not raw.isdigit():
        raise not_found(f"{what}_NOT_FOUND", f"ไม่พบ {raw}", f"{raw} not found", id=raw)
    return int(raw)


def _rows(conn: psycopg.Connection, query: str, params: list[object] | tuple[object, ...]) -> list[dict[str, object]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params)  # type: ignore[arg-type]
        return cur.fetchall()


def list_alerts(conn: psycopg.Connection, tz: str, f: AlertFilter) -> dict[str, object]:
    where: list[str] = []
    params: list[object] = []
    for values, expr in ((f.severities, "a.severity"), (f.states, STATE_EXPR),
                         (f.source_types, "coalesce(e.source_type, 'system')"), (f.codes, "a.kind"),
                         (f.source_ids, "a.entity_id"),
                         (f.department_ids, "coalesce(z.department_id, e.spec->>'departmentId')")):
        if values is not None:
            where.append(f"{expr} = ANY(%s)")
            params.append(values)
    if f.unread_only:
        where.append("a.read_at IS NULL")
    if f.from_ms is not None:
        where.append("a.started_at >= %s")
        params.append(to_dt(f.from_ms))
    if f.to_ms is not None:
        where.append("a.started_at <= %s")
        params.append(to_dt(f.to_ms))
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    total = conn.execute(f"SELECT count(*) FROM ({ALERT_SELECT}{clause}) t", params).fetchone()  # type: ignore[arg-type]
    rows = _rows(conn, f"{ALERT_SELECT}{clause} ORDER BY a.started_at DESC, a.alert_id DESC LIMIT %s OFFSET %s",
                 [*params, f.limit, f.offset])
    return {"items": [to_alert(r, tz) for r in rows], "total": int(total[0]) if total else 0,  # type: ignore[index]
            "limit": f.limit, "offset": f.offset}


def get_alert(conn: psycopg.Connection, tz: str, alert_id: int) -> dict[str, object] | None:
    rows = _rows(conn, f"{ALERT_SELECT} WHERE a.alert_id = %s", (alert_id,))
    return to_alert(rows[0], tz) if rows else None


def require_alert(conn: psycopg.Connection, tz: str, alert_id: int) -> dict[str, object]:
    alert = get_alert(conn, tz, alert_id)
    if alert is None:
        raise not_found("ALERT_NOT_FOUND", f"ไม่พบ alert {alert_id}", f"Alert {alert_id} not found", id=alert_id)
    return alert


def unread_count(conn: psycopg.Connection) -> dict[str, int]:
    row = conn.execute("""SELECT count(*), count(*) FILTER (WHERE severity = 'critical') FROM alerts
                           WHERE read_at IS NULL AND ended_at IS NULL""").fetchone()
    return {"total": int(row[0]), "critical": int(row[1])}  # type: ignore[index]


def acknowledgements(conn: psycopg.Connection, tz: str, alert_id: int | None) -> list[dict[str, object]]:
    clause, params = ("WHERE k.alert_id = %s", (alert_id,)) if alert_id is not None else ("", ())
    rows = _rows(conn, f"""SELECT k.*, a.kind, u.display_name, u.role FROM alert_acknowledgements k
                            JOIN alerts a ON a.alert_id = k.alert_id
                            LEFT JOIN users u ON u.user_id = k.user_id
                            {clause} ORDER BY k.acknowledged_at DESC, k.id DESC LIMIT 500""", params)
    return [to_ack(r, tz) for r in rows]


def recoveries(conn: psycopg.Connection, tz: str, from_ms: int | None, to_ms: int | None,
               limit: int) -> list[dict[str, object]]:
    """★ ระยะเวลาเกิดเหตุ = raisedAt → resolvedAt ไม่ใช่ถึงตอนกดรับทราบ (รับทราบ ≠ หาย)"""
    where, params = ["a.ended_at IS NOT NULL"], []  # type: ignore[var-annotated]
    if from_ms is not None:
        where.append("a.ended_at >= %s")
        params.append(to_dt(from_ms))
    if to_ms is not None:
        where.append("a.ended_at <= %s")
        params.append(to_dt(to_ms))
    rows = _rows(conn, f"{ALERT_SELECT} WHERE {' AND '.join(where)} ORDER BY a.ended_at DESC, a.alert_id DESC LIMIT %s",
                 [*params, limit])
    out = []
    for row in rows:
        alert = to_alert(row, tz)
        started, ended, acked = row["started_at"], row["ended_at"], row["ack_at"]
        out.append({
            "alertId": alert["id"], "code": alert["code"], "sourceType": alert["sourceType"],
            "sourceId": alert["sourceId"], "sourceName": alert["sourceName"], "severity": alert["severity"],
            "messageTh": alert["messageTh"], "messageEn": alert["messageEn"], "raisedAt": alert["raisedAt"],
            "resolvedAt": alert["resolvedAt"],
            "durationMinutes": max(0, round((ended - started).total_seconds() / 60)),  # type: ignore[operator]
            "acknowledgedBy": None if row["ack_user"] is None
            else actor(row["ack_user"], row["ack_name"], row["ack_role"]),
            "minutesToAcknowledge": None if acked is None
            else max(0, round((acked - started).total_seconds() / 60)),  # type: ignore[operator]
        })
    return out


def deliveries(conn: psycopg.Connection, tz: str, alert_id: int | None) -> list[dict[str, object]]:
    clause, params = ("WHERE alert_id = %s", (alert_id,)) if alert_id is not None else ("", ())
    rows = _rows(conn, f"SELECT * FROM notification_log {clause} ORDER BY created_at DESC, id DESC LIMIT 500", params)
    return [to_delivery(r, tz) for r in rows]


def preview(conn: psycopg.Connection, reg: Registry, alert_id: int, channel: str) -> dict[str, object]:
    alert = require_alert(conn, reg.timezone, alert_id)
    latest = conn.execute("""SELECT recipient, state FROM notification_log WHERE alert_id = %s AND channel = %s
                              ORDER BY created_at DESC, id DESC LIMIT 1""", (alert_id, channel)).fetchone()
    configured = reg.setting("notifications", "recipients", {}).get(channel, [])  # type: ignore[union-attr]
    title, body = render_notification(alert, reg)
    return {"alertId": alert["id"], "channel": channel,
            "recipient": latest[0] if latest else (configured[0] if configured else "-"),
            "title": title, "body": body, "deliveryState": latest[1] if latest else None}


# ─────────────── เขียน ───────────────

def mark_read(conn: psycopg.Connection, tz: str, alert_id: int) -> dict[str, object]:
    conn.execute("UPDATE alerts SET read_at = coalesce(read_at, now()) WHERE alert_id = %s", (alert_id,))
    return require_alert(conn, tz, alert_id)


def mark_all_read(conn: psycopg.Connection) -> int:
    return conn.execute("UPDATE alerts SET read_at = now() WHERE read_at IS NULL").rowcount


def acknowledge(conn: psycopg.Connection, tz: str, alert_id: int, user_id: str, note: str | None,
                snooze_minutes: int | None) -> dict[str, object]:
    """★ ผู้สิทธิ์ดูอย่างเดียว (viewer) รับทราบไม่ได้ · ทุกครั้งลง audit_log
    ★ เฟส 4c: ผู้รับทราบจะมาจาก session ที่ล็อกอิน ไม่ใช่จาก body
    """
    user = conn.execute("SELECT display_name, role, active FROM users WHERE user_id = %s", (user_id,)).fetchone()
    if user is None or not user[2]:
        raise bad_request("VALIDATION_FAILED", "ไม่พบผู้ใช้ที่รับทราบ", "Unknown acknowledging user",
                          field="acknowledgedByUserId")
    if user[1] not in ("operator", "admin"):
        raise ApiException(403, "FORBIDDEN", "ผู้ใช้สิทธิ์ดูอย่างเดียวรับทราบ alert ไม่ได้",
                           "Viewers cannot acknowledge alerts", {"role": user[1]})
    with conn.transaction():
        found = conn.execute("UPDATE alerts SET read_at = coalesce(read_at, now()) WHERE alert_id = %s RETURNING kind",
                             (alert_id,)).fetchone()
        if found is None:
            raise not_found("ALERT_NOT_FOUND", f"ไม่พบ alert {alert_id}", f"Alert {alert_id} not found", id=alert_id)
        ack = conn.execute("""INSERT INTO alert_acknowledgements (alert_id, user_id, note, snooze_minutes)
                              VALUES (%s, %s, %s, %s) RETURNING id, acknowledged_at""",
                           (alert_id, user_id, note, snooze_minutes)).fetchone()
        conn.execute("""INSERT INTO audit_log (user_id, action, target, new_value, result)
                        VALUES (%s, 'alert_acknowledge', %s, %s, 'ok')""",
                     (user_id, f"alert:{alert_id}",
                      json.dumps({"note": note, "snoozeMinutes": snooze_minutes}, ensure_ascii=False)))
    return to_ack({"id": ack[0], "acknowledged_at": ack[1], "kind": found[0], "alert_id": alert_id,  # type: ignore[index]
                   "user_id": user_id, "display_name": user[0], "role": user[1], "note": note,
                   "snooze_minutes": snooze_minutes}, tz)


def retry_delivery(conn: psycopg.Connection, tz: str, delivery_id: int) -> dict[str, object]:
    """ส่งซ้ำเฉพาะแถวที่ล้มเหลว · แถวที่กำลังส่ง/รอส่งคืนตามเดิม · ★ ผลจริงรู้ในรอบถัดไปของ notifier"""
    rows = _rows(conn, "SELECT state FROM notification_log WHERE id = %s", (delivery_id,))
    if not rows:
        raise not_found("DELIVERY_NOT_FOUND", f"ไม่พบการส่ง {delivery_id}", f"Delivery {delivery_id} not found",
                        id=delivery_id)
    if rows[0]["state"] == "delivered":
        raise ApiException(409, "ALREADY_DELIVERED", "รายการนี้ส่งถึงปลายทางแล้ว", "Delivery already succeeded",
                           {"id": delivery_id})
    conn.execute("""UPDATE notification_log SET state = 'queued', next_attempt_at = now(), updated_at = now()
                     WHERE id = %s AND state = 'failed'""", (delivery_id,))
    return to_delivery(_rows(conn, "SELECT * FROM notification_log WHERE id = %s", (delivery_id,))[0], tz)
