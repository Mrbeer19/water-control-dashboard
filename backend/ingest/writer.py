"""เขียนลง DB เป็นก้อน — 200 แถว หรือ 1 วินาที แล้วแต่ถึงก่อน

★ DB ล่ม → ก้อนนั้นลง spool ทันที แล้วลองต่อใหม่เป็นระยะ ต่อได้เมื่อไหร่ replay spool ก่อนของใหม่
★ ข้อมูลเสียบางแถว (ละเมิด constraint) ห้ามทำให้ทั้งก้อนหาย และห้ามวน spool ไม่รู้จบ
  → ถอยไปเขียนทีละ op แล้วทิ้งเฉพาะตัวที่เสียพร้อม log
"""

from __future__ import annotations

import queue
import threading
import time
from datetime import UTC, datetime

import psycopg

from .log import log
from .metrics import Metrics
from .spool import Spool

INSERT_SQL: dict[str, str] = {
    # ★ ปริมาตรถังคิดด้วย tank_volume() ใน DB — ที่เดียวกับที่ API ใช้ ไม่มีสูตรซ้ำในโค้ด
    "tank_telemetry": """
        INSERT INTO tank_telemetry (time, recv_time, entity_id, seq, level_m, volume_l, profile_version,
                                    flow_in_lpm, flow_out_lpm)
        VALUES (%(time)s, %(recv_time)s, %(entity_id)s, %(seq)s, %(level_m)s,
                tank_volume(%(entity_id)s, %(level_m)s::numeric),
                (SELECT max(version) FROM tank_profiles WHERE entity_id = %(entity_id)s),
                %(flow_in_lpm)s, %(flow_out_lpm)s)
        ON CONFLICT DO NOTHING""",
    "pump_telemetry": """
        INSERT INTO pump_telemetry (time, recv_time, entity_id, seq, voltage, current, power_w, energy_kwh,
                                    flow_lpm, pressure_bar, vfd_hz, run_state)
        VALUES (%(time)s, %(recv_time)s, %(entity_id)s, %(seq)s, %(voltage)s, %(current)s, %(power_w)s,
                %(energy_kwh)s, %(flow_lpm)s, %(pressure_bar)s, %(vfd_hz)s, %(run_state)s)
        ON CONFLICT DO NOTHING""",
    "meter_telemetry": """
        INSERT INTO meter_telemetry (time, recv_time, entity_id, seq, pulse_count, volume_m3, flow_lpm,
                                     inlet_pressure_bar)
        VALUES (%(time)s, %(recv_time)s, %(entity_id)s, %(seq)s, %(pulse_count)s, %(volume_m3)s, %(flow_lpm)s,
                %(inlet_pressure_bar)s)
        ON CONFLICT DO NOTHING""",
    "env_telemetry": """
        INSERT INTO env_telemetry (time, recv_time, entity_id, seq, temp_c, humidity_pct, pressure_hpa, lux,
                                   rain_mm, heat_index_c)
        VALUES (%(time)s, %(recv_time)s, %(entity_id)s, %(seq)s, %(temp_c)s, %(humidity_pct)s, %(pressure_hpa)s,
                %(lux)s, %(rain_mm)s, %(heat_index_c)s)
        ON CONFLICT DO NOTHING""",
    "power_telemetry": """
        INSERT INTO power_telemetry (time, recv_time, entity_id, phase, seq, voltage, current, power_w,
                                     energy_kwh, pf, frequency)
        VALUES (%(time)s, %(recv_time)s, %(entity_id)s, %(phase)s, %(seq)s, %(voltage)s, %(current)s,
                %(power_w)s, %(energy_kwh)s, %(pf)s, %(frequency)s)
        ON CONFLICT DO NOTHING""",
    "device_status": """
        INSERT INTO device_status (time, recv_time, entity_id, seq, rssi, uptime_s, free_heap, reconnect_count,
                                   last_error)
        VALUES (%(time)s, %(recv_time)s, %(entity_id)s, %(seq)s, %(rssi)s, %(uptime_s)s, %(free_heap)s,
                %(reconnect_count)s, %(last_error)s)
        ON CONFLICT DO NOTHING""",
}

# op อื่นที่ไม่ใช่ insert — ★ ทุกตัวต้องรันซ้ำได้โดยผลไม่เปลี่ยน (spool อาจ replay ซ้ำ)
EXEC_SQL: dict[str, list[str]] = {
    "state_change": [
        """UPDATE state_spans SET ended_at = %(at)s
            WHERE entity_id = %(entity_id)s AND metric = %(metric)s AND ended_at IS NULL
              AND state <> %(state)s AND started_at <= %(at)s""",
        """INSERT INTO state_spans (entity_id, metric, state, started_at)
           SELECT %(entity_id)s, %(metric)s, %(state)s, %(at)s
            WHERE NOT EXISTS (SELECT 1 FROM state_spans
                               WHERE entity_id = %(entity_id)s AND metric = %(metric)s AND ended_at IS NULL)""",
    ],
    "alert_open": [
        """INSERT INTO alerts (entity_id, kind, severity, started_at, peak_value, threshold)
           VALUES (%(entity_id)s, %(kind)s, %(severity)s, %(started_at)s, %(peak_value)s, %(threshold)s)
           ON CONFLICT (entity_id, kind) WHERE ended_at IS NULL DO NOTHING""",
    ],
    "alert_escalate": [
        """UPDATE alerts SET severity = 'critical'
            WHERE entity_id = %(entity_id)s AND kind = %(kind)s AND ended_at IS NULL""",
    ],
    "alert_close": [
        """UPDATE alerts SET ended_at = %(ended_at)s, peak_value = COALESCE(%(peak_value)s, peak_value)
            WHERE entity_id = %(entity_id)s AND kind = %(kind)s AND ended_at IS NULL
              AND started_at <= %(ended_at)s""",
    ],
    "counter_reset": [
        """INSERT INTO counter_resets (entity_id, metric, phase, at, value_before, value_after)
           VALUES (%(entity_id)s, %(metric)s, %(phase)s, %(at)s, %(value_before)s, %(value_after)s)
           ON CONFLICT DO NOTHING""",
    ],
}


def connect(dsn: str) -> psycopg.Connection:
    return psycopg.connect(dsn, autocommit=True, connect_timeout=3,
                           keepalives=1, keepalives_idle=5, keepalives_interval=2, keepalives_count=3)


class Writer(threading.Thread):
    def __init__(self, dsn: str, spool: Spool, metrics: Metrics, batch_rows: int = 200, batch_ms: int = 1000,
                 retry_s: float = 2.0) -> None:
        super().__init__(name="writer", daemon=True)
        self.inbox: queue.Queue[dict[str, object]] = queue.Queue(maxsize=200_000)
        self._dsn = dsn
        self._spool = spool
        self._metrics = metrics
        self._batch_rows = batch_rows
        self._batch_s = batch_ms / 1000
        self._retry_s = retry_s
        self._conn: psycopg.Connection | None = None
        self._next_retry = 0.0
        self._stopping = threading.Event()

    def put(self, op: dict[str, object]) -> None:
        self.inbox.put(op)

    def stop(self) -> None:
        self._stopping.set()

    def run(self) -> None:
        pending: list[dict[str, object]] = []
        rows = 0
        started = 0.0
        self._metrics.set("spool_bytes", self._spool.size_bytes())
        while not (self._stopping.is_set() and self.inbox.empty() and not pending):
            try:
                op = self.inbox.get(timeout=0.2)
            except queue.Empty:
                op = None
            if op is not None:
                if not pending:
                    started = time.monotonic()
                pending.append(op)
                rows += op["op"] == "insert"
            due = bool(pending) and (rows >= self._batch_rows or time.monotonic() - started >= self._batch_s)
            if due or (self._stopping.is_set() and pending and self.inbox.empty()):
                self._flush(pending)
                pending, rows = [], 0
            elif not pending and self._conn is None and self._spool.has_pending():
                self._ensure_db()  # DB กลับมาแล้วแต่ไม่มีข้อความใหม่ → replay ได้เลยไม่ต้องรอ
        if self._conn is not None:
            self._conn.close()

    # ─────────────── เชื่อมต่อ ───────────────

    def _mark_down(self, exc: BaseException) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except psycopg.Error:
                pass
        self._conn = None
        self._next_retry = time.monotonic() + self._retry_s
        if self._metrics.get("db_up") is not False:
            log("db_down", level="error", error=str(exc).strip())
        self._metrics.set("db_up", False)

    def _ensure_db(self) -> bool:
        if self._conn is not None and not self._conn.closed:
            return True
        if time.monotonic() < self._next_retry:
            return False
        try:
            self._conn = connect(self._dsn)
        except psycopg.OperationalError as exc:
            self._mark_down(exc)
            return False
        try:
            if self._spool.has_pending():
                before = self._spool.size_bytes()
                replayed = self._spool.replay(self._execute)
                log("spool_replayed", ops=replayed, bytes=before)
        except psycopg.OperationalError as exc:
            self._mark_down(exc)
            return False
        finally:
            self._metrics.set("spool_bytes", self._spool.size_bytes())
        log("db_up")
        self._metrics.set("db_up", True)
        return True

    # ─────────────── เขียน ───────────────

    def _flush(self, ops: list[dict[str, object]]) -> None:
        if not self._ensure_db():
            self._spool_ops(ops)
            return
        try:
            self._execute(ops)
        except psycopg.OperationalError as exc:
            self._mark_down(exc)
            self._spool_ops(ops)

    def _spool_ops(self, ops: list[dict[str, object]]) -> None:
        self._spool.append(ops)
        self._metrics.inc("ops_spooled", len(ops))
        self._metrics.set("spool_bytes", self._spool.size_bytes())

    def _execute(self, ops: list[dict[str, object]]) -> None:
        assert self._conn is not None
        try:
            self._execute_batch(ops)
        except psycopg.OperationalError:
            raise
        except psycopg.Error as exc:
            log("batch_rejected", level="warning", error=str(exc).strip(), ops=len(ops))
            self._execute_one_by_one(ops)

    def _execute_batch(self, ops: list[dict[str, object]]) -> None:
        assert self._conn is not None
        inserts: dict[str, list[dict[str, object]]] = {}
        others: list[dict[str, object]] = []
        for op in ops:
            if op["op"] == "insert":
                inserts.setdefault(str(op["table"]), []).append(op["row"])  # type: ignore[arg-type]
            else:
                others.append(op)
        with self._conn.transaction(), self._conn.cursor() as cur:
            for table, rows in inserts.items():
                cur.executemany(INSERT_SQL[table], rows)
            for op in others:
                for sql in EXEC_SQL[str(op["op"])]:
                    cur.execute(sql, op["params"])  # type: ignore[arg-type]
        self._record_written(inserts)

    def _execute_one_by_one(self, ops: list[dict[str, object]]) -> None:
        assert self._conn is not None
        written: dict[str, list[dict[str, object]]] = {}
        with self._conn.transaction(), self._conn.cursor() as cur:
            for op in ops:
                try:
                    with self._conn.transaction():
                        if op["op"] == "insert":
                            cur.execute(INSERT_SQL[str(op["table"])], op["row"])  # type: ignore[arg-type]
                            written.setdefault(str(op["table"]), []).append(op["row"])  # type: ignore[arg-type]
                        else:
                            for sql in EXEC_SQL[str(op["op"])]:
                                cur.execute(sql, op["params"])  # type: ignore[arg-type]
                except psycopg.OperationalError:
                    raise
                except psycopg.Error as exc:
                    detail = op.get("row") or op.get("params") or {}
                    log("write_rejected", entity_id=detail.get("entity_id"), level="error",  # type: ignore[union-attr]
                        op=op["op"], table=op.get("table"), error=str(exc).strip())
                    self._metrics.dropped("write_rejected")
        self._record_written(written)

    def _record_written(self, inserts: dict[str, list[dict[str, object]]]) -> None:
        rows = [row for batch in inserts.values() for row in batch]
        if not rows:
            return
        now = datetime.now(UTC)
        lag_ms = max((now - row["recv_time"]).total_seconds() * 1000 for row in rows)  # type: ignore[operator]
        self._metrics.rows_written(len(rows), lag_ms)
