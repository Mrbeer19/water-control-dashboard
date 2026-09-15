"""python -m api.dispatcher — วนจนได้ SIGTERM

  MQTT  plant/water/{valve,pump,pressure}/:id/feedback → คิวในหน่วยความจำ → control.handle_feedback()
  ทุก 1 วินาที  control.sweep_timeouts() · control.settle_parents()
  ทุก 10 วินาที control.run_due_schedules()

★ ตรรกะทั้งหมดอยู่ใน api/control.py (ทดสอบได้ไม่ต้องมี MQTT) — ไฟล์นี้แค่ต่อสายและจับเวลา
★ healthcheck: ไฟล์ HEARTBEAT ถูกแตะทุกรอบที่คุย DB สำเร็จ
"""

from __future__ import annotations

import json
import os
import queue
import signal
import time
from datetime import datetime
from pathlib import Path

import paho.mqtt.client as mqtt
import psycopg

from .. import control
from ..db import conninfo
from ..mqtt import MqttPublisher

POLL_SECONDS = 0.25
SWEEP_EVERY = 1.0
SCHEDULE_EVERY = 10.0
HEARTBEAT = Path("/tmp/dispatcher.alive")


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now().astimezone().isoformat(timespec="milliseconds"), "service": "dispatcher",
              "entity_id": fields.pop("entity_id", None), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def base_topic() -> str:
    """อ่าน network.mqttBaseTopic จาก DB (วนรอจน DB พร้อม)"""
    while True:
        try:
            with psycopg.connect(conninfo("dispatcher"), connect_timeout=3) as conn:
                row = conn.execute("SELECT value->>'mqttBaseTopic' FROM settings WHERE section = 'network'").fetchone()
                return (row[0] if row and row[0] else "plant/water").rstrip("/")
        except psycopg.OperationalError as exc:
            log("database_unavailable", level="error", error=str(exc).strip())
            time.sleep(3)


def main() -> None:
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    base = base_topic()
    inbox: queue.Queue[tuple[str, str, bytes]] = queue.Queue()
    env = os.environ

    def on_connect(client: mqtt.Client, _userdata: object, _flags: object, reason_code: object,
                   _properties: object = None) -> None:
        client.subscribe(f"{base}/+/+/feedback", qos=1)
        log("mqtt_connected", topic=f"{base}/+/+/feedback", reason=str(reason_code))

    def on_message(_client: mqtt.Client, _userdata: object, message: mqtt.MQTTMessage) -> None:
        parts = message.topic.split("/")
        if len(parts) >= 3:
            inbox.put((parts[-3], parts[-2], message.payload))

    listener = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"dispatcher-{os.getpid()}", clean_session=True)
    listener.username_pw_set(env.get("MQTT_USER", "api"), env.get("MQTT_PASSWORD", ""))
    listener.on_connect = on_connect
    listener.on_message = on_message
    listener.reconnect_delay_set(1, 10)
    listener.connect_async(env.get("MQTT_HOST", "mosquitto"), int(env.get("MQTT_PORT", "1883")), keepalive=30)
    listener.loop_start()

    publisher = MqttPublisher("dispatcher")
    conn: psycopg.Connection | None = None
    last_sweep = last_schedule = 0.0
    log("dispatcher_started")
    while not stopping:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(conninfo("dispatcher"), autocommit=True, connect_timeout=3)
            while True:
                try:
                    kind, target_id, raw = inbox.get_nowait()
                except queue.Empty:
                    break
                try:
                    payload = json.loads(raw)
                except ValueError:
                    log("feedback_not_json", level="warning", entity_id=target_id)
                    continue
                command_id = control.handle_feedback(conn, kind, target_id, payload)
                log("feedback", entity_id=target_id, kind=kind, command_id=command_id)
            now = time.monotonic()
            if now - last_sweep >= SWEEP_EVERY:
                for command_id in control.sweep_timeouts(conn):
                    log("command_timeout", level="warning", command_id=command_id)
                control.settle_parents(conn)
                last_sweep = now
            if now - last_schedule >= SCHEDULE_EVERY:
                ran = control.run_due_schedules(conn, publisher.publish)
                if ran:
                    log("schedules_ran", count=ran)
                last_schedule = now
            HEARTBEAT.touch()
        except psycopg.OperationalError as exc:
            log("database_unavailable", level="error", error=str(exc).strip())
            conn = None
            time.sleep(3)
        time.sleep(POLL_SECONDS)
    listener.loop_stop()
    listener.disconnect()
    log("dispatcher_stopped")


if __name__ == "__main__":
    main()
