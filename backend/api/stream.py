"""WebSocket /api/stream — รวบ event ให้เหลือไม่เกิน 1 ข้อความต่อ 2 วินาทีต่อ client (PROMPT_04 งานที่ 5)

ingest ─PUBLISH telemetry/alerts/system─► Hub ─ทุก 2 วินาที─► ประกอบ entity เต็มก้อน ─► client ที่สนใจ channel นั้น

★ หนึ่งข้อความ = อาร์เรย์ของ RealtimeEvent ใน lib/types.ts · entity ทั้งก้อน ไม่ส่ง patch (P-03)
★ ส่งเฉพาะ entity ที่เนื้อหาเปลี่ยนจริง (ไม่นับ lastSeen/updatedAt) · ไม่มีอะไรเปลี่ยน = ไม่ส่งเลย (P-02)
★ เลือก channel ได้: /api/stream?channels=telemetry,alerts (ไม่ระบุ = ทุก channel)
★ client ช้าไม่ถ่วงคนอื่น — ของที่ค้างส่งถูกรวมเป็นก้อนเดียวโดยใช้ค่าล่าสุดของแต่ละ entity
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime

import redis
import redis.asyncio as aioredis
from fastapi import WebSocket, WebSocketDisconnect

from . import ai, control
from . import alerts as al
from .db import pool
from .domain_site import build_devices, build_electric_nodes, build_sensors, connection_status
from .domain_water import build_meters, build_pressure_control, build_pumps, build_tanks, build_zones
from .registry import registry
from .series import iso, now_ms

TICK_SECONDS = 2.0
CHANNELS = ("telemetry", "alerts", "commands", "system")
SUBSCRIBED = ("telemetry", "alerts", "system", "commands")
# RealtimeEvent.type → RealtimeChannel (ต้องครบทุก type ใน lib/types.ts — tests/test_stream_units.py ตรวจ)
CHANNEL_OF = {
    "tank": "telemetry", "pump": "telemetry", "valve": "telemetry", "zone": "telemetry", "meter": "telemetry",
    "main_meter": "telemetry", "sensor": "telemetry", "electric_node": "telemetry", "pressure_control": "telemetry",
    "device": "system", "connection": "system", "alert": "alerts", "anomaly": "alerts", "command_result": "commands",
}
SOURCE_ALIASES = {"env": "sensor", "power": "electric_node"}
VOLATILE = frozenset({"lastSeen", "updatedAt", "lastSyncAt", "latencyMs"})


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now().astimezone().isoformat(timespec="milliseconds"), "service": "api",
              "entity_id": None, "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


@dataclass
class Dirty:
    """สิ่งที่มีคนแจ้งว่าเปลี่ยนตั้งแต่รอบก่อน — เก็บแค่ id ยังไม่ประกอบอะไร"""

    telemetry: dict[str, set[str]] = field(default_factory=dict)
    alerts: set[tuple[str, str]] = field(default_factory=set)
    alert_ids: set[int] = field(default_factory=set)
    anomaly_ids: set[int] = field(default_factory=set)
    command_ids: set[str] = field(default_factory=set)
    devices: set[str] = field(default_factory=set)
    connection: bool = False

    def empty(self) -> bool:
        return not (self.telemetry or self.alerts or self.alert_ids or self.anomaly_ids or self.command_ids
                    or self.devices or self.connection)

    def add(self, channel: str, data: dict[str, object]) -> None:
        if channel == "telemetry":
            source = str(data.get("sourceType"))
            source = SOURCE_ALIASES.get(source, source)
            if source == "device":
                self.devices.add(str(data.get("entityId")))
            else:
                self.telemetry.setdefault(source, set()).add(str(data.get("entityId")))
        elif channel == "alerts":
            if str(data.get("anomalyId", "")).isdigit():
                self.anomaly_ids.add(int(str(data["anomalyId"])))
            elif str(data.get("alertId", "")).isdigit():
                self.alert_ids.add(int(str(data["alertId"])))
            elif data.get("entityId") and data.get("code"):
                self.alerts.add((str(data["entityId"]), str(data["code"])))
        elif channel == "commands":
            if data.get("commandId"):
                self.command_ids.add(str(data["commandId"]))
        elif channel == "system":
            if data.get("deviceId"):
                self.devices.add(str(data["deviceId"]))
            self.connection = True


def key_of(event: dict[str, object]) -> tuple[str, str]:
    payload = event["payload"]
    if not isinstance(payload, dict):
        return str(event["type"]), ""
    return str(event["type"]), str(payload.get("id") or payload.get("commandId") or "")


def fingerprint(event: dict[str, object]) -> str:
    payload = event["payload"]
    content = {k: v for k, v in payload.items() if k not in VOLATILE} if isinstance(payload, dict) else payload
    return hashlib.sha1(json.dumps(content, sort_keys=True, default=str).encode()).hexdigest()


def build_events(dirty: Dirty) -> list[dict[str, object]]:
    """ประกอบ entity เต็มก้อนด้วยฟังก์ชันชุดเดียวกับ REST — payload จึงตรงกับ GET ทุก field"""
    found: list[tuple[str, dict[str, object]]] = []
    with pool.connection() as conn:
        reg = registry(conn)
        tele = dirty.telemetry

        def pick(kind: str, items: list[dict[str, object]], ids: set[str]) -> None:
            found.extend((kind, item) for item in items if item["id"] in ids)

        if "tank" in tele:
            pick("tank", build_tanks(conn, reg), tele["tank"])
        if "pump" in tele:
            pick("pump", build_pumps(conn, reg), tele["pump"])
            if str(reg.spec("pressure-control-1").get("controlledPumpId", "")) in tele["pump"]:
                found.append(("pressure_control", build_pressure_control(conn, reg)))
        if "meter" in tele:
            meters = [m for m in build_meters(conn, reg, include_main=True) if m["id"] in tele["meter"]]
            found.extend(("main_meter" if m["zoneId"] is None else "meter", m) for m in meters)
            zone_ids = {str(m["zoneId"]) for m in meters if m["zoneId"] is not None}
            if zone_ids:
                pick("zone", build_zones(conn, reg), zone_ids)
        if "sensor" in tele:
            pick("sensor", build_sensors(conn, reg), tele["sensor"])
        if "electric_node" in tele:
            pick("electric_node", build_electric_nodes(conn, reg), tele["electric_node"])
        if dirty.devices:
            pick("device", build_devices(conn, reg), dirty.devices)

        alert_ids = set(dirty.alert_ids)
        for entity_id, code in sorted(dirty.alerts):
            row = conn.execute("""SELECT alert_id FROM alerts WHERE entity_id = %s AND kind = %s
                                   ORDER BY started_at DESC LIMIT 1""", (entity_id, code)).fetchone()
            if row is not None:
                alert_ids.add(int(row[0]))
        for alert_id in sorted(alert_ids):
            alert = al.get_alert(conn, reg.timezone, alert_id)
            if alert is not None:
                found.append(("alert", alert))
        for command_id in sorted(dirty.command_ids):
            result = control.get_result(conn, reg.timezone, command_id)
            if result is not None:
                found.append(("command_result", result))
        for anomaly_id in sorted(dirty.anomaly_ids):
            anomaly = ai.get_anomaly(conn, reg.timezone, anomaly_id)
            if anomaly is not None:
                found.append(("anomaly", anomaly))
        if dirty.connection:
            found.append(("connection", connection_status(conn, reg)))
        at = iso(now_ms(), reg.timezone)
    return [{"type": kind, "at": at, "payload": payload} for kind, payload in found]


class Client:
    def __init__(self, websocket: WebSocket, channels: frozenset[str]) -> None:
        self.websocket = websocket
        self.channels = channels
        self.pending: dict[tuple[str, str], dict[str, object]] = {}
        self.wake = asyncio.Event()

    def offer(self, events: list[dict[str, object]]) -> None:
        for event in events:
            if CHANNEL_OF.get(str(event["type"])) in self.channels:
                self.pending[key_of(event)] = event      # ค้างส่งอยู่ = ทับด้วยค่าล่าสุด
        if self.pending:
            self.wake.set()

    async def run(self) -> None:
        last_sent = float("-inf")
        try:
            while True:
                await self.wake.wait()
                # ★ ถึงรอบ hub จะมาเร็ว/ช้ากว่ากำหนดเล็กน้อย ห้ามส่งถี่กว่า 1 ครั้งต่อ TICK_SECONDS ต่อ client
                await asyncio.sleep(max(0.0, last_sent + TICK_SECONDS - time.monotonic()))
                self.wake.clear()
                batch, self.pending = list(self.pending.values()), {}
                last_sent = time.monotonic()
                await self.websocket.send_json(batch)
        except Exception:  # noqa: BLE001 — client ปิดไปแล้ว ตัวรับฝั่ง endpoint จะเก็บกวาดเอง
            return


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()
        self.dirty = Dirty()
        self.fingerprints: dict[tuple[str, str], str] = {}
        self._tasks: list[asyncio.Task[None]] = []

    def start(self) -> None:
        self._tasks = [asyncio.create_task(self._listen()), asyncio.create_task(self._tick())]

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def changed(self, events: list[dict[str, object]]) -> list[dict[str, object]]:
        fresh = []
        for event in events:
            key, mark = key_of(event), fingerprint(event)
            if event["type"] in ("alert", "anomaly", "command_result") or self.fingerprints.get(key) != mark:
                self.fingerprints[key] = mark
                fresh.append(event)
        return fresh

    async def _listen(self) -> None:
        url = os.environ.get("REDIS_URL", "redis://redis:6379/0")
        while True:
            client = aioredis.from_url(url)
            try:
                async with client.pubsub() as pubsub:
                    await pubsub.subscribe(*SUBSCRIBED)
                    log("stream_subscribed", channels=list(SUBSCRIBED))
                    async for message in pubsub.listen():
                        if message["type"] != "message":
                            continue
                        channel = message["channel"]
                        with contextlib.suppress(ValueError, TypeError, AttributeError):
                            self.dirty.add(channel.decode() if isinstance(channel, bytes) else str(channel),
                                           json.loads(message["data"]))
            except (redis.RedisError, OSError) as exc:
                log("stream_redis_error", level="warning", error=str(exc))
                await asyncio.sleep(3)
            finally:
                await client.aclose()

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(TICK_SECONDS)
            if not self.clients:
                self.dirty = Dirty()                  # ไม่มีใครดูอยู่ ไม่ต้องประกอบ entity ให้เปลือง DB
                continue
            if self.dirty.empty():
                continue
            dirty, self.dirty = self.dirty, Dirty()
            try:
                events = await asyncio.to_thread(build_events, dirty)
            except Exception as exc:  # noqa: BLE001 — รอบนี้พังต้องไม่ทำให้ stream หยุดทั้งระบบ
                log("stream_build_failed", level="error", error=str(exc))
                continue
            fresh = self.changed(events)
            if fresh:
                for client in list(self.clients):
                    client.offer(fresh)


hub = Hub()


async def stream_endpoint(websocket: WebSocket) -> None:
    raw = websocket.query_params.get("channels")
    wanted = frozenset(CHANNELS) if not raw else frozenset(p.strip() for p in raw.split(",") if p.strip())
    if not wanted or not wanted <= set(CHANNELS):
        await websocket.close(code=1008, reason="unknown channel")
        return
    await websocket.accept()
    client = Client(websocket, wanted)
    hub.clients.add(client)
    sender = asyncio.create_task(client.run())
    try:
        while True:
            await websocket.receive_text()             # หน้าจอไม่ได้ส่งอะไรมา แต่ต้องอ่านเพื่อรู้ว่าปิดแล้ว
    except WebSocketDisconnect:
        pass
    finally:
        hub.clients.discard(client)
        sender.cancel()
