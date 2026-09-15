"""ตัวนับสำหรับ /metrics — เขียนจากหลาย thread จึงล็อกทุกครั้ง"""

from __future__ import annotations

import threading
import time
from collections import Counter, deque


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Counter[str] = Counter()
        self._dropped: Counter[str] = Counter()
        self._gauges: dict[str, float | bool | None] = {
            "db_up": False,
            "mqtt_connected": False,
            "spool_bytes": 0,
            "last_flush_lag_ms": None,
            "max_flush_lag_ms_1m": None,
        }
        self._written: deque[tuple[float, int]] = deque()
        self._lags: deque[tuple[float, float]] = deque()

    def inc(self, name: str, amount: int = 1) -> None:
        with self._lock:
            self._counters[name] += amount

    def dropped(self, reason: str) -> None:
        with self._lock:
            self._dropped[reason] += 1

    def set(self, name: str, value: float | bool | None) -> None:
        with self._lock:
            self._gauges[name] = value

    def get(self, name: str) -> float | bool | None:
        with self._lock:
            return self._gauges.get(name)

    def rows_written(self, count: int, lag_ms: float) -> None:
        now = time.monotonic()
        with self._lock:
            self._counters["rows_written"] += count
            self._written.append((now, count))
            self._lags.append((now, lag_ms))
            self._gauges["last_flush_lag_ms"] = round(lag_ms, 1)
            self._trim(now)

    def _trim(self, now: float) -> None:
        while self._written and now - self._written[0][0] > 10:
            self._written.popleft()
        while self._lags and now - self._lags[0][0] > 60:
            self._lags.popleft()

    def snapshot(self, queue_depths: dict[str, int]) -> dict[str, object]:
        now = time.monotonic()
        with self._lock:
            self._trim(now)
            rows_10s = sum(count for _, count in self._written)
            max_lag = max((lag for _, lag in self._lags), default=None)
            return {
                **self._counters,
                **self._gauges,
                "max_flush_lag_ms_1m": None if max_lag is None else round(max_lag, 1),
                "rows_per_second_10s": round(rows_10s / 10, 2),
                "dropped": dict(self._dropped),
                "queue_depth": queue_depths,
            }
