"""จับการเปลี่ยนสถานะ → ปิด span เดิม เปิด span ใหม่ใน state_spans

★ ข้อความที่เก่ากว่าสถานะล่าสุด (QoS 1 ส่งซ้ำ/มาช้า) ห้ามย้อนแก้ประวัติ
"""

from __future__ import annotations

from datetime import datetime


class StateTracker:
    def __init__(self) -> None:
        self._last: dict[tuple[str, str], tuple[str, datetime]] = {}

    def seed(self, entity_id: str, metric: str, state: str, at: datetime) -> None:
        self._last[(entity_id, metric)] = (state, at)

    def current(self, entity_id: str, metric: str) -> str | None:
        found = self._last.get((entity_id, metric))
        return None if found is None else found[0]

    def observe(self, entity_id: str, metric: str, state: str | None, at: datetime) -> list[dict[str, object]]:
        if state is None:
            return []
        key = (entity_id, metric)
        previous = self._last.get(key)
        if previous is not None and at <= previous[1]:
            return []
        self._last[key] = (state, at)
        if previous is not None and previous[0] == state:
            return []
        return [{"op": "state_change", "params": {"entity_id": entity_id, "metric": metric, "state": state, "at": at}}]
