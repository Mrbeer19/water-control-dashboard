"""ทะเบียนและค่าตั้งจาก DB — cache สั้น ๆ 5 วินาที

★ จำนวนโซน/มิเตอร์/อุปกรณ์มาจาก DB เสมอ ห้ามมีเลขตายตัวในโค้ด
★ ค่าตั้งเปลี่ยนแล้วหน้าจอต้องเห็นภายในไม่กี่วินาที จึงไม่ cache นาน
"""

from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass, field

import psycopg
from psycopg.rows import dict_row

CACHE_SECONDS = 5.0
EMPTY_RANGE = {"criticalLow": None, "warningLow": None, "warningHigh": None, "criticalHigh": None}


def natural_key(value: str) -> list[object]:
    """zone-2 มาก่อน zone-10"""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", value)]


def _f(value: object) -> float | None:
    return None if value is None else float(value)  # type: ignore[arg-type]


@dataclass(frozen=True)
class Registry:
    entities: dict[str, dict[str, object]]
    devices: dict[str, dict[str, object]]
    zones: dict[str, dict[str, object]]
    departments: dict[str, dict[str, object]]
    thresholds: dict[tuple[str, str], dict[str, float | None]]
    settings: dict[str, dict[str, object]]
    settings_updated: dict[str, tuple[object, object]]
    loaded_at: float = field(default_factory=time.monotonic)

    @property
    def timezone(self) -> str:
        return str(self.settings.get("general", {}).get("timezone", ""))

    def of_type(self, source_type: str) -> list[dict[str, object]]:
        found = [e for e in self.entities.values() if e["source_type"] == source_type and e["active"]]
        return sorted(found, key=lambda e: natural_key(str(e["entity_id"])))

    def threshold(self, entity_id: str, metric: str) -> dict[str, float | None]:
        return dict(self.thresholds.get((entity_id, metric), EMPTY_RANGE))

    def spec(self, entity_id: str) -> dict[str, object]:
        entity = self.entities.get(entity_id)
        return dict(entity["spec"]) if entity is not None and entity.get("spec") else {}  # type: ignore[arg-type]

    def setting(self, section: str, key: str, default: object = None) -> object:
        return self.settings.get(section, {}).get(key, default)

    def meter_of_zone(self, zone_id: str) -> dict[str, object] | None:
        return next((e for e in self.of_type("meter") if e["zone_id"] == zone_id), None)

    def valve_of_zone(self, zone_id: str) -> dict[str, object] | None:
        return next((e for e in self.of_type("valve") if e["zone_id"] == zone_id), None)

    def main_meter(self) -> dict[str, object] | None:
        return next((e for e in self.of_type("meter") if self.spec(str(e["entity_id"])).get("isMain")), None)


_cache: Registry | None = None
_lock = threading.Lock()


def load_registry(conn: psycopg.Connection) -> Registry:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM entities")
        entities = {row["entity_id"]: row for row in cur.fetchall()}
        cur.execute("SELECT * FROM devices")
        devices = {row["device_id"]: row for row in cur.fetchall()}
        cur.execute("SELECT * FROM zones ORDER BY zone_number")
        zones = {row["zone_id"]: row for row in cur.fetchall()}
        cur.execute("SELECT * FROM departments")
        departments = {row["department_id"]: row for row in cur.fetchall()}
        cur.execute("SELECT * FROM thresholds")
        thresholds = {(row["entity_id"], row["metric"]): {
            "criticalLow": _f(row["crit_low"]), "warningLow": _f(row["warn_low"]),
            "warningHigh": _f(row["warn_high"]), "criticalHigh": _f(row["crit_high"])} for row in cur.fetchall()}
        cur.execute("SELECT section, value, updated_at, updated_by FROM settings")
        settings_rows = cur.fetchall()
    settings = {row["section"]: row["value"] for row in settings_rows}
    updated = {row["section"]: (row["updated_at"], row["updated_by"]) for row in settings_rows}
    return Registry(entities, devices, zones, departments, thresholds, settings, updated)


def registry(conn: psycopg.Connection, fresh: bool = False) -> Registry:
    global _cache
    with _lock:
        if not fresh and _cache is not None and time.monotonic() - _cache.loaded_at < CACHE_SECONDS:
            return _cache
    loaded = load_registry(conn)
    with _lock:
        _cache = loaded
    return loaded


def invalidate() -> None:
    global _cache
    with _lock:
        _cache = None


# ─────────────── สถานะ ───────────────

def status_from_range(value: float | None, rng: dict[str, float | None]) -> str:
    """ตรรกะเดียวกับ statusFromRange() ใน lib/mock/store.ts"""
    if value is None:
        return "ok"
    if rng.get("criticalLow") is not None and value <= rng["criticalLow"]:  # type: ignore[operator]
        return "critical"
    if rng.get("criticalHigh") is not None and value >= rng["criticalHigh"]:  # type: ignore[operator]
        return "critical"
    if rng.get("warningLow") is not None and value <= rng["warningLow"]:  # type: ignore[operator]
        return "warning"
    if rng.get("warningHigh") is not None and value >= rng["warningHigh"]:  # type: ignore[operator]
        return "warning"
    return "ok"


def worst_status(statuses: list[str]) -> str:
    """ตรรกะเดียวกับ worstStatus() — critical > offline > warning > ok"""
    for candidate in ("critical", "offline", "warning"):
        if candidate in statuses:
            return candidate
    return "ok"
