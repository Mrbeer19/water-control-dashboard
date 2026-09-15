"""ทะเบียนจาก DB เก็บไว้ในหน่วยความจำ รีเฟรชทุก 60 วินาที

★ จำนวนโซน/มิเตอร์/อุปกรณ์มาจาก DB ทั้งหมด ไม่มีเลขตายตัวในโค้ด
★ DB ล่มระหว่างรีเฟรช → ใช้ของเดิมต่อ ingest ต้องไม่หยุดเพราะรีเฟรชไม่ได้
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import psycopg

from .writer import connect


@dataclass(frozen=True)
class Entity:
    entity_id: str
    source_type: str
    device_id: str | None
    zone_id: str | None
    spec: dict[str, object]
    active: bool


@dataclass(frozen=True)
class Threshold:
    warn_low: float | None
    warn_high: float | None
    crit_low: float | None
    crit_high: float | None


def _f(value: object) -> float | None:
    return None if value is None else float(value)  # type: ignore[arg-type]


class Cache:
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self.entities: dict[str, Entity] = {}
        self.thresholds: dict[tuple[str, str], Threshold] = {}
        self.profiles: dict[str, list[tuple[float, float]]] = {}
        self.tracked_device_ids: list[str] = []
        self.device_timeout_s: float | None = None
        self.open_spans: list[tuple[str, str, str, datetime]] = []
        self.open_alerts: list[tuple[str, str, str]] = []

    def load(self, include_open_records: bool = False) -> None:
        with connect(self._dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT entity_id, source_type, device_id, zone_id, spec, active FROM entities")
            entities = {row[0]: Entity(*row) for row in cur.fetchall()}

            cur.execute("SELECT entity_id, metric, warn_low, warn_high, crit_low, crit_high FROM thresholds")
            thresholds = {(row[0], row[1]): Threshold(_f(row[2]), _f(row[3]), _f(row[4]), _f(row[5]))
                          for row in cur.fetchall()}

            cur.execute("""SELECT p.entity_id, p.level_m, p.volume_l FROM tank_profiles p
                            WHERE p.version = (SELECT max(version) FROM tank_profiles WHERE entity_id = p.entity_id)
                            ORDER BY p.entity_id, p.level_m""")
            profiles: dict[str, list[tuple[float, float]]] = {}
            for entity_id, level, volume in cur.fetchall():
                profiles.setdefault(entity_id, []).append((float(level), float(volume)))

            # ESP32 ต้องส่งข้อมูลตลอด จึงเฝ้าตั้งแต่เริ่ม · อุปกรณ์อื่นเฝ้าเมื่อเคยได้ยินเสียงแล้ว
            cur.execute("SELECT device_id FROM devices WHERE active AND kind = 'esp32' ORDER BY device_id")
            tracked = [row[0] for row in cur.fetchall()]

            cur.execute("SELECT value -> 'deviceTimeoutSeconds' FROM settings WHERE section = 'network'")
            row = cur.fetchone()
            timeout = _f(row[0]) if row is not None else None

            if include_open_records:
                cur.execute("SELECT entity_id, metric, state, started_at FROM state_spans WHERE ended_at IS NULL")
                self.open_spans = list(cur.fetchall())
                cur.execute("SELECT entity_id, kind, severity FROM alerts WHERE ended_at IS NULL")
                self.open_alerts = list(cur.fetchall())

        self.entities, self.thresholds, self.profiles = entities, thresholds, profiles
        self.tracked_device_ids, self.device_timeout_s = tracked, timeout

    def tank_percent(self, entity_id: str, level_m: float | None) -> float | None:
        """ระดับน้ำเป็น % ของความจุ — interpolate แบบเดียวกับ tank_volume() ใน DB (clamp ที่ขอบตาราง)"""
        entity = self.entities.get(entity_id)
        profile = self.profiles.get(entity_id)
        capacity = entity.spec.get("capacityLiters") if entity is not None else None
        if level_m is None or not profile or not isinstance(capacity, (int, float)) or capacity <= 0:
            return None
        if level_m <= profile[0][0]:
            volume = profile[0][1]
        elif level_m >= profile[-1][0]:
            volume = profile[-1][1]
        else:
            volume = profile[-1][1]
            for (lo_level, lo_volume), (hi_level, hi_volume) in zip(profile, profile[1:], strict=False):
                if lo_level <= level_m <= hi_level:
                    volume = lo_volume + (level_m - lo_level) * (hi_volume - lo_volume) / (hi_level - lo_level)
                    break
        return volume / capacity * 100


def last_counter(dsn_conn: psycopg.Connection, table: str, column: str, entity_id: str,
                 phase: str | None) -> tuple[float, datetime] | None:
    """ค่าสะสมล่าสุดที่อยู่ใน DB — ใช้ตั้งต้นการจับตัวนับรีเซ็ตหลัง ingest เริ่มใหม่"""
    from psycopg import sql

    query = sql.SQL("SELECT {col}, time FROM {tbl} WHERE entity_id = %s {phase} AND {col} IS NOT NULL "
                    "ORDER BY time DESC LIMIT 1").format(
        col=sql.Identifier(column), tbl=sql.Identifier(table),
        phase=sql.SQL("AND phase = %s") if phase is not None else sql.SQL(""))
    params: tuple[object, ...] = (entity_id, phase) if phase is not None else (entity_id,)
    with dsn_conn.cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
    return None if row is None else (float(row[0]), row[1])
