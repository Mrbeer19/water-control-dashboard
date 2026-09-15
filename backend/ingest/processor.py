"""ประมวลผลข้อความทีละตัวใน thread เดียว — สถานะในหน่วยความจำจึงไม่ต้องล็อก

MQTT thread แค่โยนข้อความเข้าคิว · writer thread แค่เขียน · ตรรกะทั้งหมดอยู่ที่นี่
"""

from __future__ import annotations

import json
import queue
import threading
import time
import traceback
from dataclasses import dataclass
from datetime import UTC, datetime

import psycopg

from .cache import Cache, Entity, last_counter
from .liveness import Event, Liveness
from .log import log
from .metrics import Metrics
from .normalize import Normalized, PayloadError, normalize_status, normalize_telemetry
from .redis_pub import RedisPublisher
from .router import is_command, route
from .rules import RuleEngine
from .states import StateTracker
from .writer import Writer, connect

SOURCE_TYPE_OF_KIND = {"tank": "tank", "pump": "pump", "meter": "meter", "env": "sensor", "power": "electric_node"}

# ตัวนับสะสม: ตาราง → [(คอลัมน์, ชื่อ metric)]
COUNTER_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "pump_telemetry": [("energy_kwh", "energy_kwh")],
    "meter_telemetry": [("pulse_count", "pulse_count"), ("volume_m3", "volume_cubic_meters")],
    "power_telemetry": [("energy_kwh", "energy_kwh")],
    "device_status": [("uptime_s", "uptime_seconds")],
}
COUNTER_EPSILON = 1e-9
HIGH = frozenset({"high"})
LOW = frozenset({"low"})
BOTH = frozenset({"low", "high"})


@dataclass(frozen=True)
class ProcessorConfig:
    base_topic: str
    clock_skew_s: float
    offline_after_s: float


class Processor(threading.Thread):
    def __init__(self, cfg: ProcessorConfig, dsn: str, cache: Cache, writer: Writer, redis_pub: RedisPublisher,
                 metrics: Metrics, now: float) -> None:
        super().__init__(name="processor", daemon=True)
        self.inbox: queue.Queue[tuple[object, ...]] = queue.Queue(maxsize=100_000)
        self._cfg = cfg
        self._dsn = dsn
        self._cache = cache
        self._writer = writer
        self._redis = redis_pub
        self._metrics = metrics
        self._rules = RuleEngine()
        self._states = StateTracker()
        self._counters: dict[tuple[str, str, str | None], tuple[float, datetime] | None] = {}
        self._lookup_conn: psycopg.Connection | None = None
        self._skew_logged: dict[str, float] = {}
        self._stopping = threading.Event()

        timeout = cache.device_timeout_s if cache.device_timeout_s is not None else cfg.offline_after_s
        self._liveness = Liveness(timeout)
        self._liveness.track(cache.tracked_device_ids, now)
        for entity_id, metric, state, started_at in cache.open_spans:
            self._states.seed(entity_id, metric, state, started_at)
        for entity_id, kind, severity in cache.open_alerts:
            self._rules.mark_open(entity_id, kind, severity)

    def stop(self) -> None:
        self._stopping.set()

    def run(self) -> None:
        while not (self._stopping.is_set() and self.inbox.empty()):
            try:
                item = self.inbox.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                self._dispatch(item)
            except Exception as exc:  # noqa: BLE001 — ห้าม crash ไม่ว่าข้อความจะเพี้ยนแค่ไหน
                self._metrics.dropped("processor_error")
                log("processor_error", level="error", error=repr(exc), trace=traceback.format_exc(limit=5))

    def _dispatch(self, item: tuple[object, ...]) -> None:
        kind = item[0]
        if kind == "mqtt":
            _, topic, payload, recv_ts = item
            self._handle_message(str(topic), bytes(payload), float(recv_ts))  # type: ignore[arg-type]
        elif kind == "tick":
            self._apply_liveness(self._liveness.check(float(item[1])))  # type: ignore[arg-type]
        elif kind == "refresh":
            self._refresh()

    def _refresh(self) -> None:
        try:
            self._cache.load()
        except psycopg.Error as exc:
            log("cache_refresh_failed", level="warning", error=str(exc).strip())
            return
        self._liveness.track(self._cache.tracked_device_ids, datetime.now(UTC).timestamp())

    # ─────────────── ข้อความ ───────────────

    def _drop(self, reason: str, entity_id: str | None = None, **fields: object) -> None:
        self._metrics.dropped(reason)
        log("message_dropped", entity_id=entity_id, level="warning", reason=reason, **fields)

    def _handle_message(self, topic: str, raw: bytes, recv_ts: float) -> None:
        self._metrics.inc("messages_total")
        recv_time = datetime.fromtimestamp(recv_ts, tz=UTC)
        if is_command(topic, self._cfg.base_topic):
            return                      # คำสั่งขาออกของระบบเอง ไม่ใช่ข้อมูลเข้า — ไม่นับเป็นข้อความทิ้ง
        found = route(topic, self._cfg.base_topic)
        if found is None:
            self._drop("unknown_topic", topic=topic)
            return
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            self._drop("invalid_json", found.entity_id, topic=topic)
            return

        if found.channel == "status":
            self._handle_status(found.entity_id, payload, recv_ts, recv_time)
            return
        if found.channel == "feedback":
            return  # คำสั่ง/feedback เป็นหน้าที่ของ dispatcher

        entity = self._cache.entities.get(found.entity_id)
        if entity is None or not entity.active:
            self._drop("unknown_entity", found.entity_id, topic=topic)
            return
        if entity.source_type != SOURCE_TYPE_OF_KIND[found.kind]:
            self._drop("kind_mismatch", entity.entity_id, topic=topic, source_type=entity.source_type)
            return
        try:
            message = normalize_telemetry(found.kind, entity.entity_id, payload, recv_time)
        except PayloadError as exc:
            self._drop(str(exc), entity.entity_id, topic=topic)
            return

        self._after_normalize(entity.entity_id, message, recv_time)
        if message.device_id is not None and entity.device_id is not None and message.device_id != entity.device_id:
            log("device_mismatch", entity_id=entity.entity_id, level="warning",
                payload_device=message.device_id, registered_device=entity.device_id)

        self._counters_check(message)
        if found.kind == "pump":
            row = message.rows[0][1]
            self._put_all(self._states.observe(entity.entity_id, "pump_run_state", row["run_state"],  # type: ignore[arg-type]
                                               message.at))
        self._evaluate_rules(entity, message)
        if entity.device_id is not None:
            self._apply_liveness(self._liveness.touch(entity.device_id, recv_ts))
        self._redis.latest(entity.entity_id, entity.source_type, message)

    def _handle_status(self, device_id: str, payload: object, recv_ts: float, recv_time: datetime) -> None:
        entity = self._cache.entities.get(device_id)
        if entity is None or entity.source_type != "device":
            self._drop("unknown_device", device_id)
            return
        try:
            message, online = normalize_status(device_id, payload, recv_time)
        except PayloadError as exc:
            self._drop(str(exc), device_id)
            return
        if online is False:
            log("lwt_offline", entity_id=device_id)
            self._apply_liveness(self._liveness.lwt_offline(device_id, recv_ts))
            return
        assert message is not None
        self._after_normalize(device_id, message, recv_time)
        self._counters_check(message)
        self._apply_liveness(self._liveness.touch(device_id, recv_ts))
        self._redis.latest(device_id, "device", message)

    def _after_normalize(self, entity_id: str, message: Normalized, recv_time: datetime) -> None:
        for issue in message.issues:
            log(str(issue.get("event")), entity_id=entity_id, level="warning",
                **{k: v for k, v in issue.items() if k != "event"})
        skew_s = (recv_time - message.at).total_seconds()
        if abs(skew_s) > self._cfg.clock_skew_s:
            # ★ ยังเก็บแถว ห้ามทิ้ง — แค่บันทึกว่านาฬิกาบอร์ดเพี้ยน
            # log ไม่เกินนาทีละครั้งต่อ entity — บอร์ดที่นาฬิกาเพี้ยนส่งทุก 2 วิ ไม่งั้น log ท่วมดิสก์
            self._metrics.inc("clock_skew_total")
            last = self._skew_logged.get(entity_id, 0.0)
            if time.monotonic() - last >= 60:
                self._skew_logged[entity_id] = time.monotonic()
                log("clock_skew", entity_id=entity_id, level="warning", skew_s=round(skew_s, 1),
                    device_at=message.at.isoformat())
        for table, row in message.rows:
            self._writer.put({"op": "insert", "table": table, "row": row})
        self._metrics.inc("rows_enqueued", len(message.rows))

    def _put_all(self, ops: list[dict[str, object]]) -> None:
        for op in ops:
            self._writer.put(op)

    # ─────────────── ตัวนับรีเซ็ต ───────────────

    def _last_counter(self, table: str, column: str, entity_id: str,
                      phase: str | None) -> tuple[float, datetime] | None:
        try:
            if self._lookup_conn is None or self._lookup_conn.closed:
                self._lookup_conn = connect(self._dsn)
            return last_counter(self._lookup_conn, table, column, entity_id, phase)
        except psycopg.Error:
            self._lookup_conn = None
            return None

    def _counters_check(self, message: Normalized) -> None:
        for table, row in message.rows:
            for column, metric in COUNTER_COLUMNS.get(table, []):
                value = row.get(column)
                if value is None:
                    continue
                entity_id, phase, at = str(row["entity_id"]), row.get("phase"), message.at
                key = (entity_id, column, phase)  # type: ignore[assignment]
                if key not in self._counters:
                    self._counters[key] = self._last_counter(table, column, entity_id, phase)  # type: ignore[arg-type]
                previous = self._counters[key]
                if previous is not None and at <= previous[1]:
                    continue  # ข้อความเก่ากว่าค่าล่าสุด ไม่ใช่การรีเซ็ต
                self._counters[key] = (float(value), at)  # type: ignore[arg-type]
                if previous is not None and float(value) < previous[0] - COUNTER_EPSILON:  # type: ignore[arg-type]
                    log("counter_reset", entity_id=entity_id, level="warning", metric=metric, phase=phase,
                        value_before=previous[0], value_after=value)
                    self._writer.put({"op": "counter_reset", "params": {
                        "entity_id": entity_id, "metric": metric, "phase": phase, "at": at,
                        "value_before": previous[0], "value_after": value}})

    # ─────────────── เกณฑ์เตือน ───────────────

    def _rule_inputs(self, entity: Entity, message: Normalized):  # noqa: ANN202
        """(entity ที่เปิด alert, AlertCode, entity เจ้าของเกณฑ์, metric, ค่า, ด้านที่ตรวจ)"""
        rows = [row for _, row in message.rows]
        row = rows[0]
        eid = entity.entity_id
        if entity.source_type == "pump":
            yield eid, "PUMP_OVERCURRENT", eid, "current_amp", row["current"], HIGH
            # แรงดันต่ำตอนปั๊มหยุดเป็นเรื่องปกติ ตรวจเฉพาะตอนเดิน
            if row["run_state"] == "running":
                yield eid, "PRESSURE_OUT_OF_RANGE", eid, "pressure_bar", row["pressure_bar"], BOTH
        elif entity.source_type == "tank":
            percent = self._cache.tank_percent(eid, row["level_m"])  # type: ignore[arg-type]
            yield eid, "TANK_LEVEL_LOW", eid, "level_percent", percent, LOW
            yield eid, "TANK_LEVEL_HIGH", eid, "level_percent", percent, HIGH
        elif entity.source_type == "meter" and entity.zone_id is not None:
            # เกณฑ์ผูกกับมิเตอร์ แต่เหตุเป็นของโซน (หน้าจอพาไปหน้าโซน)
            yield entity.zone_id, "ZONE_FLOW_HIGH", eid, "flow_lpm", row["flow_lpm"], HIGH
        elif entity.source_type == "sensor":
            yield eid, "ENV_TEMP_HIGH", eid, "temperature", row["temp_c"], HIGH
            yield eid, "ENV_HUMIDITY_HIGH", eid, "humidity", row["humidity_pct"], HIGH
        elif entity.source_type == "electric_node":
            # ★ ตู้ 3 เฟสส่ง 3 แถวต่อข้อความ — ต้องรวมเป็นค่าเดียวต่อข้อความ ไม่งั้น debounce นับ 3 ในรอบเดียว
            currents = [r["current"] for r in rows if r["current"] is not None]
            yield eid, "ELECTRIC_OVERCURRENT", eid, "current_amp", max(currents) if currents else None, HIGH

    def _evaluate_rules(self, entity: Entity, message: Normalized) -> None:
        for alert_entity, code, threshold_entity, metric, value, sides in self._rule_inputs(entity, message):
            threshold = self._cache.thresholds.get((threshold_entity, metric))
            for op in self._rules.evaluate(alert_entity, code, value, threshold, sides, message.at):
                self._writer.put(op)
                log(op["op"], entity_id=alert_entity, kind=code, **{
                    k: v for k, v in op["params"].items() if k in ("severity", "peak_value", "threshold")})  # type: ignore[union-attr]
                self._redis.event("alerts", {"type": op["op"], "entityId": alert_entity, "code": code})

    # ─────────────── liveness ───────────────

    def _apply_liveness(self, events: list[Event]) -> None:
        for state, device_id, at in events:
            self._put_all(self._states.observe(device_id, "online_state", state, at))
            if state == "offline":
                log("device_offline", entity_id=device_id, level="warning")
                self._writer.put({"op": "alert_open", "params": {
                    "entity_id": device_id, "kind": "DEVICE_OFFLINE", "severity": "critical",
                    "started_at": at, "peak_value": None, "threshold": None}})
            else:
                log("device_online", entity_id=device_id)
                self._writer.put({"op": "alert_close", "params": {
                    "entity_id": device_id, "kind": "DEVICE_OFFLINE", "ended_at": at, "peak_value": None}})
            self._redis.event("system", {"type": f"device_{state}", "deviceId": device_id, "at": at.isoformat()})
