"""ค่าล่าสุดของ entity — อ่านจาก Redis ก่อน ถ้าไม่มี (หมดอายุ/Redis ล่ม) ถอยไปแถวล่าสุดใน DB

★ PROMPT_04: ค่าล่าสุดอ่านจาก Redis ไม่ query DB ทุกครั้ง
★ ค่าที่ได้เป็นชื่อคอลัมน์ของตาราง (level_m, current, …) ไม่ใช่ชื่อ field ใน payload
"""

from __future__ import annotations

import json
import os
from datetime import datetime

import psycopg
import redis
from psycopg.rows import dict_row

TABLE_OF = {"tank": "tank_telemetry", "pump": "pump_telemetry", "meter": "meter_telemetry",
            "sensor": "env_telemetry", "electric_node": "power_telemetry", "device": "device_status"}
SKIP = {"time", "recv_time", "entity_id", "seq", "phase"}
FALLBACK_WINDOW = "1 day"


class Latest:
    """ค่าล่าสุดหนึ่ง entity · values = คอลัมน์ของตาราง · phases = เฉพาะตู้ไฟ"""

    def __init__(self, at: datetime | None, recv_time: datetime | None, values: dict[str, object],
                 phases: dict[str, dict[str, object]] | None = None) -> None:
        self.at = at
        self.recv_time = recv_time
        self.values = values
        self.phases = phases or {}

    def get(self, key: str) -> object:
        return self.values.get(key)


def _client() -> redis.Redis:
    return redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"),
                                socket_timeout=0.5, socket_connect_timeout=0.5)


_redis = _client()


def _parse(raw: bytes) -> Latest | None:
    try:
        doc = json.loads(raw)
    except ValueError:
        return None
    values = dict(doc.get("values") or {})
    phases = values.pop("phases", None)
    recv = doc.get("recvTime")
    return Latest(datetime.fromisoformat(doc["at"]) if doc.get("at") else None,
                  datetime.fromisoformat(recv) if recv else None, values, phases)


def _from_db(conn: psycopg.Connection, source_type: str, entity_ids: list[str]) -> dict[str, Latest]:
    table = TABLE_OF[source_type]
    found: dict[str, Latest] = {}
    with conn.cursor(row_factory=dict_row) as cur:
        if source_type == "electric_node":
            cur.execute(f"""SELECT DISTINCT ON (entity_id, phase) * FROM {table}
                             WHERE entity_id = ANY(%s) AND time > now() - interval '{FALLBACK_WINDOW}'
                             ORDER BY entity_id, phase, time DESC""", (entity_ids,))
            for row in cur.fetchall():
                item = found.setdefault(row["entity_id"], Latest(row["time"], row["recv_time"], {}, {}))
                item.phases[row["phase"]] = {k: v for k, v in row.items() if k not in SKIP}
                if row["time"] > (item.at or row["time"]):
                    item.at, item.recv_time = row["time"], row["recv_time"]
            for item in found.values():
                total = item.phases.get("total") or item.phases.get("single") or {}
                item.values = dict(total)
        else:
            cur.execute(f"""SELECT DISTINCT ON (entity_id) * FROM {table}
                             WHERE entity_id = ANY(%s) AND time > now() - interval '{FALLBACK_WINDOW}'
                             ORDER BY entity_id, time DESC""", (entity_ids,))
            for row in cur.fetchall():
                found[row["entity_id"]] = Latest(row["time"], row["recv_time"],
                                                 {k: v for k, v in row.items() if k not in SKIP})
    return found


def latest_many(conn: psycopg.Connection, source_type: str, entity_ids: list[str]) -> dict[str, Latest | None]:
    result: dict[str, Latest | None] = dict.fromkeys(entity_ids)
    if not entity_ids:
        return result
    try:
        raws = _redis.mget([f"latest:{entity_id}" for entity_id in entity_ids])
    except redis.RedisError:
        raws = [None] * len(entity_ids)
    missing = []
    for entity_id, raw in zip(entity_ids, raws, strict=True):
        parsed = _parse(raw) if raw is not None else None
        if parsed is None:
            missing.append(entity_id)
        else:
            if source_type == "electric_node" and parsed.phases:
                parsed.values = dict(parsed.phases.get("total") or parsed.phases.get("single") or {})
            result[entity_id] = parsed
    if missing:
        result.update(_from_db(conn, source_type, missing))
    return result


def offline_devices(conn: psycopg.Connection) -> dict[str, datetime]:
    """อุปกรณ์ที่ ingest ตัดสินว่า offline อยู่ตอนนี้ → เวลาที่เริ่ม offline"""
    rows = conn.execute("""SELECT entity_id, started_at FROM state_spans
                            WHERE metric = 'online_state' AND state = 'offline' AND ended_at IS NULL""").fetchall()
    return {row[0]: row[1] for row in rows}
