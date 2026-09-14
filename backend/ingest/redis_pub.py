"""ค่าล่าสุด + pub/sub ผ่าน Redis

★ Redis ล่ม ≠ ingest ล่ม — ของจริงอยู่ใน DB แล้ว Redis เป็นแค่ทางลัดให้ API/WS
"""

from __future__ import annotations

import json
import time

import redis

from .log import log
from .metrics import Metrics
from .normalize import Normalized

LATEST_TTL_S = 300
ERROR_LOG_EVERY_S = 30


class RedisPublisher:
    def __init__(self, url: str, metrics: Metrics) -> None:
        self._client = redis.Redis.from_url(url, socket_timeout=0.5, socket_connect_timeout=0.5)
        self._metrics = metrics
        self._last_error_log = 0.0

    def _failed(self, exc: redis.RedisError) -> None:
        self._metrics.dropped("redis_error")
        now = time.monotonic()
        if now - self._last_error_log > ERROR_LOG_EVERY_S:
            self._last_error_log = now
            log("redis_error", level="warning", error=str(exc))

    def latest(self, entity_id: str, source_type: str, message: Normalized) -> None:
        values: dict[str, object] = {}
        for table, row in message.rows:
            skip = {"time", "recv_time", "entity_id", "seq", "phase"}
            reading = {k: v for k, v in row.items() if k not in skip}
            if table == "power_telemetry":
                values.setdefault("phases", {})[str(row["phase"])] = reading  # type: ignore[index]
            else:
                values.update(reading)
        recv_time = message.rows[0][1]["recv_time"] if message.rows else None
        # ★ recvTime = นาฬิกาเซิร์ฟเวอร์ ใช้เป็น lastSeen (นาฬิกาบอร์ดเพี้ยนได้)
        document = {"entityId": entity_id, "sourceType": source_type, "at": message.at.isoformat(),
                    "recvTime": recv_time.isoformat() if recv_time is not None else None,  # type: ignore[union-attr]
                    "values": values}
        try:
            with self._client.pipeline(transaction=False) as pipe:
                pipe.set(f"latest:{entity_id}", json.dumps(document, default=str), ex=LATEST_TTL_S)
                pipe.publish("telemetry", json.dumps({"entityId": entity_id, "sourceType": source_type,
                                                      "at": document["at"]}))
                pipe.execute()
        except redis.RedisError as exc:
            self._failed(exc)

    def event(self, channel: str, payload: dict[str, object]) -> None:
        try:
            self._client.publish(channel, json.dumps(payload, default=str))
        except redis.RedisError as exc:
            self._failed(exc)
