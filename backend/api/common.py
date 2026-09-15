"""ตัวช่วยร่วมของ router — เวลา · ตัวเลข · 404 · offline"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from .errors import bad_request, not_found
from .latest import Latest
from .registry import Registry

# ★ entity ที่ไม่เคยได้ยินเสียงเลยตั้งแต่ติดตั้ง — lastSeen ต้องเป็น string ตามสัญญา จึงใช้ epoch 0
#   พร้อม status 'offline' (DECISIONS D-27)
NEVER = datetime(1970, 1, 1, tzinfo=UTC)


def iso_dt(value: datetime | None, tz: str) -> str | None:
    return None if value is None else value.astimezone(ZoneInfo(tz)).isoformat(timespec="milliseconds")


def iso_required(value: datetime | None, tz: str) -> str:
    return iso_dt(value if value is not None else NEVER, tz)  # type: ignore[return-value]


def now_dt() -> datetime:
    return datetime.now(UTC)


def num(value: object, digits: int = 3) -> float | None:
    """ค่าที่อาจไม่มี → null (ไม่ใช่ 0)"""
    if value is None:
        return None
    number = float(value)  # type: ignore[arg-type]
    return round(number, digits) if math.isfinite(number) else None


def required(value: object, digits: int = 3) -> float:
    """ฟิลด์ที่สัญญาบังคับเป็น number — ไม่มีค่าเลยใช้ 0 และ entity จะถูกตั้ง status offline (D-27)"""
    found = num(value, digits)
    return 0.0 if found is None else found


def parse_time(raw: str | None, default_ms: int, field: str) -> int:
    """รับได้ทั้ง epoch ms และ ISO 8601 (TimeRange ของหน้าบ้านเป็น ISO)"""
    if raw is None or raw == "":
        return default_ms
    if raw.lstrip("-").isdigit():
        return int(raw)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise bad_request("VALIDATION_FAILED", f"รูปแบบเวลา {field} ไม่ถูกต้อง", f"Invalid time for {field}",
                          field=field) from exc
    if parsed.tzinfo is None:
        raise bad_request("VALIDATION_FAILED", f"เวลา {field} ต้องมี offset", f"{field} must include an offset",
                          field=field)
    return round(parsed.timestamp() * 1000)


def entity_or_404(reg: Registry, entity_id: str, *source_types: str) -> dict[str, object]:
    entity = reg.entities.get(entity_id)
    if entity is None or entity["source_type"] not in source_types or not entity["active"]:
        raise not_found("ENTITY_NOT_FOUND", f"ไม่พบ {entity_id}", f"{entity_id} not found", id=entity_id)
    return entity


def timeout_seconds(reg: Registry) -> float:
    return float(reg.setting("network", "deviceTimeoutSeconds", 30))  # type: ignore[arg-type]


def getter(latest: Latest | None) -> Callable[[str], object]:
    """ตัวอ่านค่าจาก Latest ที่อาจไม่มี — ไม่มีข้อมูลคืน None ทุกคีย์"""
    return latest.get if latest is not None else (lambda _key: None)


def is_offline(entity: dict[str, object], latest: Latest | None, offline: dict[str, datetime], reg: Registry) -> bool:
    """offline เมื่อ: ไม่มีข้อมูล · อุปกรณ์ที่วัดถูก ingest ตัดสินว่า offline · ข้อมูลเก่าเกินกำหนด"""
    if latest is None or latest.recv_time is None:
        return True
    if entity.get("device_id") in offline:
        return True
    return (now_dt() - latest.recv_time).total_seconds() > timeout_seconds(reg) * 2
