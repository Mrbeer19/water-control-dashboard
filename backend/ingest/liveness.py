"""จับอุปกรณ์ตาย — ต้องมีสองทาง ห้ามมีทางเดียว

ทาง A  LWT (retained) ที่ broker ส่งแทนเมื่อบอร์ดหลุดแบบรู้ตัว → offline ทันที
ทาง B  ตรวจเป็นระยะว่าอุปกรณ์ไหนเงียบเกินกำหนด → จับ "บอร์ดค้างที่ยังต่อ MQTT อยู่แต่เลิกส่ง"
       ★ ทาง B สำคัญกว่า เพราะเคสนั้นสถานะยัง online ทุกอย่างดูปกติ กราฟแค่นิ่ง ๆ
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

Event = tuple[str, str, datetime]  # (online|offline, device_id, เวลาที่เปลี่ยน)


def _dt(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, tz=UTC)


@dataclass
class _Device:
    since: float
    last_seen: float | None = None
    online: bool | None = None


class Liveness:
    def __init__(self, timeout_s: float) -> None:
        self.timeout_s = timeout_s
        self._devices: dict[str, _Device] = {}

    def track(self, device_ids: list[str], now: float) -> None:
        for device_id in device_ids:
            self._devices.setdefault(device_id, _Device(since=now))

    def touch(self, device_id: str, recv_ts: float) -> list[Event]:
        device = self._devices.setdefault(device_id, _Device(since=recv_ts))
        device.last_seen = recv_ts
        if device.online is True:
            return []
        device.online = True
        return [("online", device_id, _dt(recv_ts))]

    def lwt_offline(self, device_id: str, recv_ts: float) -> list[Event]:
        device = self._devices.setdefault(device_id, _Device(since=recv_ts))
        if device.online is False:
            return []
        device.online = False
        return [("offline", device_id, _dt(recv_ts))]

    def check(self, now: float) -> list[Event]:
        events: list[Event] = []
        for device_id, device in self._devices.items():
            if device.online is False:
                continue
            reference = device.last_seen if device.last_seen is not None else device.since
            if now - reference > self.timeout_s:
                device.online = False
                # ข้อความสุดท้ายคือเวลาที่เงียบไปจริง · ไม่เคยได้ยินเลยใช้เวลาที่ตรวจพบ
                events.append(("offline", device_id, _dt(reference if device.last_seen is not None else now)))
        return events
