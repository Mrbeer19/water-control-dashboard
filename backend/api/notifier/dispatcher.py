"""ตัดสินว่าจะส่งอะไร ถึงใคร เมื่อไร แล้วส่งผ่าน channels.py

รอบละ 2 วินาที:
  1. alert ที่เปิดอยู่และยังไม่ได้ประเมินที่ระดับนี้ → สร้างแถว notification_log (ช่องทาง × ผู้รับ)
  2. ไม่มีใครรับทราบเกิน escalationAfterMinutes → ส่งซ้ำหนึ่งรอบ
  3. รับทราบแบบ snooze แล้วครบเวลาแต่ยังไม่หาย → เตือนซ้ำหนึ่งรอบ
  4. ส่งแถวที่ถึงเวลา · ล้มชั่วคราวลองใหม่หลัง 30 วินาที และ 2 นาที (รวม 3 ครั้ง)

★ ข้อความมาจาก api.alerts.render_notification() ตัวเดียวกับ /api/alerts/:id/preview
★ อ่าน settings.notifications ทุกรอบ แก้ค่าตั้งแล้วมีผลภายในไม่กี่วินาที
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

import psycopg

from ..alerts import SEVERITY_RANK, get_alert, render_notification
from ..registry import Registry, registry
from .channels import Channel, DeliveryError, Message

MAX_ATTEMPTS = 3
RETRY_DELAYS = (30, 120)
STALE_SENDING_SECONDS = 120
LOOKBACK_HOURS = 24
BATCH = 20


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now().astimezone().isoformat(timespec="milliseconds"), "service": "notifier",
              "entity_id": fields.pop("entity_id", None), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


# ─────────────── กฎ (pure — ทดสอบได้ไม่ต้องมี DB) ───────────────

def parse_hhmm(text: str) -> time:
    hour, minute = text.split(":")
    return time(int(hour), int(minute))


def in_quiet_hours(now_local: time, quiet: dict[str, object]) -> bool:
    """ช่วงเงียบข้ามเที่ยงคืนได้ (22:00–06:00) · เริ่มนับรวม สิ้นสุดไม่รวม"""
    if not quiet.get("enabled"):
        return False
    start, end = parse_hhmm(str(quiet["startTime"])), parse_hhmm(str(quiet["endTime"]))
    if start == end:
        return False
    if start < end:
        return start <= now_local < end
    return now_local >= start or now_local < end


def should_notify(severity: str, notified: str | None, minimum: str, quiet_active: bool,
                  override: str) -> tuple[bool, bool]:
    """(ส่งตอนนี้, จดว่าประเมินระดับนี้แล้ว)"""
    rank = SEVERITY_RANK.get(severity, 0)
    if notified is not None and rank <= SEVERITY_RANK.get(notified, 0):
        return False, False
    if rank < SEVERITY_RANK.get(minimum, 0):
        return False, True
    if quiet_active and rank < SEVERITY_RANK.get(override, 2):
        return False, False          # เลื่อน — ส่งเมื่อพ้นช่วงเงียบถ้ายังไม่หาย
    return True, True


def retry_delay(attempts: int) -> int | None:
    """หน่วงก่อนลองครั้งถัดไปหลังล้มครั้งที่ `attempts` — None = เลิกลอง"""
    return RETRY_DELAYS[attempts - 1] if attempts < MAX_ATTEMPTS else None


# ─────────────── รอบทำงาน ───────────────

class Dispatcher:
    def __init__(self, channels: dict[str, Channel]) -> None:
        self.channels = channels

    def run_once(self, conn: psycopg.Connection) -> None:
        reg = registry(conn)
        notif: dict[str, object] = dict(reg.settings.get("notifications", {}))
        quiet: dict[str, object] = dict(notif.get("quietHours") or {})  # type: ignore[call-overload]
        now_local = datetime.now(UTC).astimezone(ZoneInfo(reg.timezone)).time()
        quiet_active = in_quiet_hours(now_local, quiet)
        override = str(quiet.get("overrideSeverity", "critical"))

        conn.execute("""UPDATE notification_log SET state = 'queued', updated_at = now()
                         WHERE state = 'sending' AND last_attempt_at < now() - make_interval(secs => %s)""",
                     (STALE_SENDING_SECONDS,))
        self._evaluate_new(conn, notif, quiet_active, override)
        self._remind(conn, notif, quiet_active, override)
        self._send_due(conn, reg)

    def _queue(self, conn: psycopg.Connection, alert_id: int, notif: dict[str, object], reason: str) -> int:
        recipients: dict[str, list[str]] = dict(notif.get("recipients") or {})  # type: ignore[call-overload]
        count = 0
        for channel in notif.get("enabledChannels") or []:  # type: ignore[attr-defined]
            if channel not in self.channels:
                continue
            for recipient in recipients.get(channel, []):
                conn.execute("""INSERT INTO notification_log (alert_id, channel, recipient, reason)
                                VALUES (%s, %s, %s, %s)""", (alert_id, channel, recipient, reason))
                count += 1
        log("notifications_queued", alert_id=alert_id, reason=reason, count=count)
        return count

    def _evaluate_new(self, conn: psycopg.Connection, notif: dict[str, object], quiet_active: bool,
                      override: str) -> None:
        rows = conn.execute("""SELECT alert_id, severity, notified_severity FROM alerts
                                WHERE ended_at IS NULL AND started_at > now() - make_interval(hours => %s)
                                  AND notified_severity IS DISTINCT FROM severity
                                ORDER BY started_at""", (LOOKBACK_HOURS,)).fetchall()
        minimum = str(notif.get("minimumSeverity", "warning"))
        for alert_id, severity, notified in rows:
            send, mark = should_notify(severity, notified, minimum, quiet_active, override)
            if not mark:
                continue
            with conn.transaction():
                if send:
                    sent_before = conn.execute("SELECT 1 FROM notification_log WHERE alert_id = %s LIMIT 1",
                                               (alert_id,)).fetchone()
                    self._queue(conn, alert_id, notif, "escalated" if sent_before else "raised")
                conn.execute("UPDATE alerts SET notified_severity = %s WHERE alert_id = %s", (severity, alert_id))

    def _remind(self, conn: psycopg.Connection, notif: dict[str, object], quiet_active: bool, override: str) -> None:
        minutes = int(notif.get("escalationAfterMinutes") or 0)  # type: ignore[call-overload]
        candidates: list[tuple[int, str, str]] = []
        if minutes > 0:
            candidates += [(r[0], r[1], "unacknowledged") for r in conn.execute("""
                SELECT a.alert_id, a.severity FROM alerts a
                 WHERE a.ended_at IS NULL AND a.started_at <= now() - make_interval(mins => %s)
                   AND a.started_at > now() - make_interval(hours => %s)
                   AND EXISTS (SELECT 1 FROM notification_log n WHERE n.alert_id = a.alert_id)
                   AND NOT EXISTS (SELECT 1 FROM notification_log n
                                    WHERE n.alert_id = a.alert_id AND n.reason = 'unacknowledged')
                   AND NOT EXISTS (SELECT 1 FROM alert_acknowledgements k WHERE k.alert_id = a.alert_id)""",
                (minutes, LOOKBACK_HOURS)).fetchall()]
        candidates += [(r[0], r[1], "snooze_ended") for r in conn.execute("""
            SELECT a.alert_id, a.severity FROM alerts a
              JOIN LATERAL (SELECT acknowledged_at, snooze_minutes FROM alert_acknowledgements k
                             WHERE k.alert_id = a.alert_id ORDER BY acknowledged_at DESC LIMIT 1) k ON true
             WHERE a.ended_at IS NULL AND k.snooze_minutes IS NOT NULL
               AND k.acknowledged_at + make_interval(mins => k.snooze_minutes) <= now()
               AND NOT EXISTS (SELECT 1 FROM notification_log n WHERE n.alert_id = a.alert_id
                                AND n.reason = 'snooze_ended' AND n.created_at >= k.acknowledged_at)""").fetchall()]
        for alert_id, severity, reason in candidates:
            if quiet_active and SEVERITY_RANK.get(severity, 0) < SEVERITY_RANK.get(override, 2):
                continue
            with conn.transaction():
                if self._queue(conn, alert_id, notif, reason) == 0:
                    # ไม่มีผู้รับ — จดแถวล้มเหลวไว้หนึ่งแถว ไม่งั้นจะวนประเมินซ้ำทุกรอบ
                    conn.execute("""INSERT INTO notification_log (alert_id, channel, recipient, reason, state, error)
                                    VALUES (%s, 'buzzer', '-', %s, 'failed', 'ไม่มีช่องทาง/ผู้รับที่เปิดไว้')""",
                                 (alert_id, reason))

    def _send_due(self, conn: psycopg.Connection, reg: Registry) -> None:
        with conn.transaction():
            due = conn.execute("""
                UPDATE notification_log SET state = 'sending', attempts = attempts + 1,
                       last_attempt_at = now(), updated_at = now()
                 WHERE id IN (SELECT id FROM notification_log WHERE state = 'queued' AND next_attempt_at <= now()
                               ORDER BY next_attempt_at, id LIMIT %s FOR UPDATE SKIP LOCKED)
                RETURNING id, alert_id, channel, recipient, attempts""", (BATCH,)).fetchall()
        base_topic = str(reg.setting("network", "mqttBaseTopic", "plant/water"))
        for delivery_id, alert_id, channel, recipient, attempts in due:
            alert = get_alert(conn, reg.timezone, alert_id)
            try:
                if alert is None:
                    raise DeliveryError("alert ถูกลบไปแล้ว", permanent=True)
                sender = self.channels.get(channel)
                if sender is None:
                    raise DeliveryError(f"ไม่มีตัวส่งของช่องทาง {channel}", permanent=True)
                title, body = render_notification(alert, reg)
                sender.send(Message(recipient, title, body, alert, base_topic))
            except Exception as exc:  # noqa: BLE001 — plugin พังต้องไม่ทำให้ทั้งลูปหยุด
                permanent = isinstance(exc, DeliveryError) and exc.permanent
                delay = None if permanent else retry_delay(attempts)
                if delay is None:
                    conn.execute("UPDATE notification_log SET state = 'failed', error = %s, updated_at = now() "
                                 "WHERE id = %s", (str(exc), delivery_id))
                else:
                    conn.execute("""UPDATE notification_log SET state = 'queued', error = %s, updated_at = now(),
                                           next_attempt_at = now() + make_interval(secs => %s) WHERE id = %s""",
                                 (str(exc), delay, delivery_id))
                log("delivery_failed", level="warning", delivery_id=delivery_id, alert_id=alert_id, channel=channel,
                    attempts=attempts, permanent=permanent, retry_in_s=delay, error=str(exc))
            else:
                conn.execute("""UPDATE notification_log SET state = 'delivered', delivered_at = now(), error = NULL,
                                       updated_at = now() WHERE id = %s""", (delivery_id,))
                log("delivered", delivery_id=delivery_id, alert_id=alert_id, channel=channel, recipient=recipient)
