"""unit test ของ /api/stream — การรวบ event · กรอง channel · จังหวะส่ง (ไม่ต้องมี Redis/DB)"""

import asyncio
import re
import time

from api import stream
from api.stream import CHANNEL_OF, CHANNELS, Client, Dirty, Hub, fingerprint
from tests.helpers import BACKEND


def frontend_event_types() -> set[str]:
    source = (BACKEND.parent / "lib" / "types.ts").read_text(encoding="utf-8")
    block = re.search(r"export type RealtimeEvent =(.*?);\n", source, re.S)
    channels = re.search(r"export type RealtimeChannel =(.*?);", source, re.S)
    assert block is not None and channels is not None
    assert set(re.findall(r"'([a-z_]+)'", channels.group(1))) == set(CHANNELS)
    return set(re.findall(r"type: '([a-z_]+)'", block.group(1)))


def test_every_realtime_event_type_has_a_channel():
    assert set(CHANNEL_OF) == frontend_event_types()
    assert set(CHANNEL_OF.values()) <= set(CHANNELS)


def test_dirty_collects_ids_by_source_without_building_anything():
    dirty = Dirty()
    assert dirty.empty()
    for _ in range(14):     # ข้อความ telemetry ถี่ ๆ ของ entity เดิม = งานเดียว
        dirty.add("telemetry", {"entityId": "tank-1", "sourceType": "tank"})
    dirty.add("telemetry", {"entityId": "env-outdoor", "sourceType": "env"})
    dirty.add("telemetry", {"entityId": "esp32-vip", "sourceType": "device"})
    dirty.add("alerts", {"type": "alert_open", "entityId": "pump-1", "code": "PUMP_OVERCURRENT"})
    dirty.add("alerts", {"alertId": "42"})
    dirty.add("system", {"type": "device_offline", "deviceId": "esp32-pond"})
    assert dirty.telemetry == {"tank": {"tank-1"}, "sensor": {"env-outdoor"}}
    assert dirty.devices == {"esp32-vip", "esp32-pond"} and dirty.connection
    assert dirty.alerts == {("pump-1", "PUMP_OVERCURRENT")} and dirty.alert_ids == {42}


def test_fingerprint_ignores_timestamps_only():
    base = {"type": "tank", "at": "x",
            "payload": {"id": "tank-1", "percentFull": 50.0, "lastSeen": "a", "updatedAt": "a"}}
    same = {**base, "payload": {**base["payload"], "lastSeen": "b", "updatedAt": "b"}}
    moved = {**base, "payload": {**base["payload"], "percentFull": 50.1}}
    assert fingerprint(base) == fingerprint(same) != fingerprint(moved)

    hub = Hub()
    assert hub.changed([base]) == [base]
    assert hub.changed([same]) == []                      # เนื้อหาไม่เปลี่ยน ไม่ส่ง
    assert hub.changed([moved]) == [moved]
    alert = {"type": "alert", "at": "x", "payload": {"id": "1"}}
    assert hub.changed([alert]) == [alert] and hub.changed([alert]) == [alert]   # alert ส่งทุกครั้งที่มีคนแจ้ง


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[tuple[float, list]] = []

    async def send_json(self, data: list) -> None:
        self.sent.append((time.monotonic(), data))


def event(kind: str, ident: str, value: int) -> dict:
    return {"type": kind, "at": "x", "payload": {"id": ident, "value": value}}


def test_client_filters_channels_and_keeps_latest_per_entity():
    client = Client(FakeSocket(), frozenset({"alerts"}))   # type: ignore[arg-type]
    client.offer([event("tank", "tank-1", 1), event("alert", "7", 1)])
    client.offer([event("alert", "7", 2), event("alert", "8", 1)])
    assert sorted((k, e["payload"]["value"]) for k, e in client.pending.items()) == [(("alert", "7"), 2),
                                                                                    (("alert", "8"), 1)]


def test_client_never_sends_more_often_than_one_tick(monkeypatch):
    monkeypatch.setattr(stream, "TICK_SECONDS", 0.2)

    async def scenario() -> FakeSocket:
        socket = FakeSocket()
        client = Client(socket, frozenset(CHANNELS))   # type: ignore[arg-type]
        runner = asyncio.create_task(client.run())
        for i in range(40):                      # 20 ข้อความ/วินาที นาน 2 วินาที
            client.offer([event("pump", "pump-1", i), event("tank", "tank-1", i)])
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.3)
        runner.cancel()
        return socket

    sent = asyncio.run(scenario()).sent
    gaps = [b[0] - a[0] for a, b in zip(sent, sent[1:], strict=False)]
    assert 8 <= len(sent) <= 12 and min(gaps) >= 0.19, (len(sent), gaps)
    assert all(len(batch) == 2 for _, batch in sent)             # รวมเป็นก้อนเดียว entity ละ 1 ตัว
    assert sent[-1][1][0]["payload"]["value"] == 39              # ก้อนสุดท้ายเป็นค่าล่าสุดเสมอ
