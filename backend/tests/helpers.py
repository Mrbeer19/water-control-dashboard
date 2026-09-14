"""ตัวช่วยของ integration test — คุยกับ stack จริงที่ docker compose ขึ้นไว้"""

from __future__ import annotations

import json
import subprocess
import threading
import time
import urllib.request
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TypeVar
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt
import psycopg

BACKEND = Path(__file__).resolve().parents[1]
BKK = ZoneInfo("Asia/Bangkok")
T = TypeVar("T")


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (BACKEND / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def now() -> datetime:
    """เวลาปัจจุบันตัดเหลือมิลลิวินาที — ตรงกับความละเอียดที่ส่งใน payload จึงเทียบใน DB ได้ตรง ๆ"""
    current = datetime.now(UTC)
    return current.replace(microsecond=current.microsecond // 1000 * 1000)


def iso(at: datetime) -> str:
    return at.astimezone(BKK).isoformat(timespec="milliseconds")


class Clock:
    """เวลาที่เดินทีละก้าวคงที่ — ข้อความในเคสเดียวกันจะได้ `at` ไม่ซ้ำและเรียงกัน"""

    def __init__(self, start: datetime, step_s: float) -> None:
        self._t = start
        self._step = timedelta(seconds=step_s)

    def next(self) -> datetime:
        self._t += self._step
        return self._t


def wait_for(check: Callable[[], T], timeout: float, message: str, interval: float = 0.5) -> T:
    deadline = time.monotonic() + timeout
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() > deadline:
            raise AssertionError(f"หมดเวลา {timeout:.0f} วินาที: {message}")
        time.sleep(interval)


class Db:
    """ต่อใหม่เองเมื่อ DB หลุด (S9 ปิด DB กลางเทส)"""

    def __init__(self, env: dict[str, str]) -> None:
        self._kwargs = {"host": "127.0.0.1", "port": 5432, "dbname": env["POSTGRES_DB"],
                        "user": env["POSTGRES_USER"], "password": env["POSTGRES_PASSWORD"]}
        self._conn: psycopg.Connection | None = None

    def rows(self, sql: str, *params: object) -> list[tuple]:
        for attempt in (1, 2):
            try:
                if self._conn is None or self._conn.closed:
                    self._conn = psycopg.connect(**self._kwargs, autocommit=True, connect_timeout=3)
                with self._conn.cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchall() if cur.description else []
            except psycopg.OperationalError:
                self._conn = None
                if attempt == 2:
                    raise
        return []

    def value(self, sql: str, *params: object) -> object:
        return self.rows(sql, *params)[0][0]

    def run(self, sql: str, params: dict[str, object]) -> None:
        """รันคำสั่งที่ใช้พารามิเตอร์แบบมีชื่อ %(name)s"""
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(**self._kwargs, autocommit=True, connect_timeout=3)
        with self._conn.cursor() as cur:
            cur.execute(sql, params)

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()


class DeviceClient:
    """เล่นเป็นอุปกรณ์หนึ่งตัวด้วยรหัสของอุปกรณ์นั้น (ACL จริงทำงานด้วย)"""

    def __init__(self, device_id: str, password: str, keepalive: int = 30, clean_session: bool = True) -> None:
        self.device_id = device_id
        self._connected = threading.Event()
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, protocol=mqtt.MQTTv311,
                                  client_id=f"test-{device_id}-{uuid.uuid4().hex[:6]}", clean_session=clean_session)
        self.client.username_pw_set(f"dev-{device_id}", password)
        self.client.will_set(f"plant/water/device/{device_id}/status",
                             json.dumps({"deviceId": device_id, "online": False}), qos=1, retain=True)
        self.client.on_connect = lambda *args: self._connected.set()
        self.client.reconnect_delay_set(1, 5)
        self.client.connect("127.0.0.1", 1883, keepalive=keepalive)
        self.client.loop_start()
        if not self._connected.wait(10):
            raise AssertionError(f"{device_id} ต่อ MQTT ไม่ได้")
        self.closed = False

    def publish(self, subtopic: str, payload: dict, retain: bool = False, wait: bool = True) -> mqtt.MQTTMessageInfo:
        info = self.client.publish(f"plant/water/{subtopic}", json.dumps(payload), qos=1, retain=retain)
        if wait:
            info.wait_for_publish(10)
        return info

    def telemetry(self, kind: str, ident: str, at: datetime, values: dict, wait: bool = True) -> mqtt.MQTTMessageInfo:
        return self.publish(f"{kind}/{ident}/telemetry",
                            {"deviceId": self.device_id, "at": iso(at), "values": values}, wait=wait)

    def status(self, at: datetime, retain: bool = True) -> None:
        self.publish(f"device/{self.device_id}/status", {
            "deviceId": self.device_id, "at": iso(at), "online": True, "rssi": -60, "uptimeSeconds": 100,
            "freeHeapBytes": 160000, "reconnectCount": 0, "lastError": None}, retain=retain)

    def close(self) -> None:
        """ปิดแบบสุภาพ — broker ไม่ส่ง LWT"""
        if not self.closed:
            self.client.disconnect()
            self.client.loop_stop()
            self.closed = True

    def kill(self) -> None:
        """ตัดสายกระทันหัน — broker จะส่ง LWT แทนอุปกรณ์"""
        self.client.loop_stop()
        sock = self.client.socket()
        if sock is not None:
            sock.close()
        self.closed = True


def ingest_metrics() -> dict:
    with urllib.request.urlopen("http://127.0.0.1:8080/metrics", timeout=3) as response:
        return json.load(response)


def ingest_health_status() -> int:
    with urllib.request.urlopen("http://127.0.0.1:8080/health", timeout=3) as response:
        return response.status


def compose(*args: str, timeout: float = 180) -> str:
    result = subprocess.run(["docker", "compose", *args], cwd=BACKEND, check=True, capture_output=True, text=True,
                            timeout=timeout)
    return result.stdout


def container_state(service: str) -> str:
    container = compose("ps", "-q", service).strip()
    result = subprocess.run(["docker", "inspect", "-f", "{{.State.StartedAt}} restarts={{.RestartCount}}", container],
                            check=True, capture_output=True, text=True)
    return result.stdout.strip()


def ingest_drained(timeout: float = 120) -> None:
    def drained() -> bool:
        metrics = ingest_metrics()
        depth = metrics["queue_depth"]
        return depth["processor"] == 0 and depth["writer"] == 0 and metrics["spool_bytes"] == 0
    wait_for(drained, timeout, "ingest ยังเขียนไม่หมดคิว")
    time.sleep(1.5)   # รอก้อนสุดท้ายที่อยู่ในรอบ batch 1 วินาที


def set_password(username: str, password: str) -> None:
    """ตั้งรหัสผ่านผ่านสคริปต์จริงใน container api — เซสชันเดิมของผู้ใช้นั้นถูกยกเลิก"""
    subprocess.run(["docker", "compose", "exec", "-T", "api", "python", "-m", "api.set_password", username, "--stdin"],
                   cwd=BACKEND, input=password + "\n", check=True, capture_output=True, text=True, timeout=60)


def set_pin(username: str, pin: str) -> None:
    """ตั้ง PIN สั่งงานผ่านสคริปต์จริงใน container api"""
    subprocess.run(["docker", "compose", "exec", "-T", "api", "python", "-m", "api.set_password", username, "--pin",
                    "--stdin"], cwd=BACKEND, input=pin + "\n", check=True, capture_output=True, text=True, timeout=60)
