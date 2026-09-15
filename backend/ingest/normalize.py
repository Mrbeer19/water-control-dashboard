"""payload ดิบ → แถวของตาราง

★ ค่าที่ไม่มีหรืออ่านไม่ได้ = None เสมอ ห้ามแปลงเป็น 0
  ใช้ values.get('lux') ไม่ใช่ values.get('lux', 0) — ไม่งั้น "ไม่มีเซนเซอร์" จะกลายเป็น "แสง 0 lux"
★ ค่าเกินช่วงทางกายภาพ → None แต่ยังเก็บแถวไว้ (รู้ว่าอุปกรณ์ส่งมา แค่ค่านั้นเชื่อไม่ได้)
★ `at` ต้องมี offset — ไม่มี offset แปลว่าไม่รู้ว่าเป็นเวลาเขตไหน ทิ้งทั้งข้อความดีกว่าเก็บผิดที่
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

Bounds = tuple[float, float]

# ชื่อ field ใน payload → (คอลัมน์, ช่วงที่เป็นไปได้ทางกายภาพ)
TANK_FIELDS: dict[str, tuple[str, Bounds]] = {
    "levelMeters": ("level_m", (0, 20)),
    "flowInLpm": ("flow_in_lpm", (0, 10_000)),
    "flowOutLpm": ("flow_out_lpm", (0, 10_000)),
}
PUMP_FIELDS: dict[str, tuple[str, Bounds]] = {
    "voltage": ("voltage", (0, 500)),
    "currentAmp": ("current", (0, 500)),
    "powerWatt": ("power_w", (0, 1_000_000)),
    "energyKwh": ("energy_kwh", (0, 1e12)),
    "flowLpm": ("flow_lpm", (0, 10_000)),
    "pressureBar": ("pressure_bar", (0, 25)),
    "vfdHz": ("vfd_hz", (0, 120)),
}
METER_FIELDS: dict[str, tuple[str, Bounds]] = {
    "pulseCount": ("pulse_count", (0, 1e15)),
    "volumeM3": ("volume_m3", (0, 1e12)),
    "flowLpm": ("flow_lpm", (0, 10_000)),
    "inletPressureBar": ("inlet_pressure_bar", (0, 25)),
}
ENV_FIELDS: dict[str, tuple[str, Bounds]] = {
    "temperatureC": ("temp_c", (-40, 85)),
    "humidityPct": ("humidity_pct", (0, 100)),
    "pressureHpa": ("pressure_hpa", (800, 1100)),
    "lux": ("lux", (0, 200_000)),
    "rainMm": ("rain_mm", (0, 500)),
}
POWER_PHASE_FIELDS: dict[str, tuple[str, Bounds]] = {
    "voltage": ("voltage", (0, 500)),
    "currentAmp": ("current", (0, 5_000)),
    "powerWatt": ("power_w", (0, 10_000_000)),
    "energyKwh": ("energy_kwh", (0, 1e12)),
    "pf": ("pf", (0, 1)),
    "frequencyHz": ("frequency", (40, 70)),
}
STATUS_FIELDS: dict[str, tuple[str, Bounds]] = {
    "rssi": ("rssi", (-120, 0)),
    "uptimeSeconds": ("uptime_s", (0, 1e10)),
    "freeHeapBytes": ("free_heap", (0, 1e9)),
    "reconnectCount": ("reconnect_count", (0, 1e9)),
}

TABLE_FIELDS = {
    "tank": ("tank_telemetry", TANK_FIELDS),
    "pump": ("pump_telemetry", PUMP_FIELDS),
    "meter": ("meter_telemetry", METER_FIELDS),
    "env": ("env_telemetry", ENV_FIELDS),
}

PUMP_RUN_STATES = frozenset({"running", "stopped", "starting", "stopping", "fault"})
PHASES = ("L1", "L2", "L3", "single")
# คอลัมน์ที่เป็นจำนวนนับ เก็บเป็น int
INTEGER_COLUMNS = frozenset({"pulse_count", "reconnect_count"})


class PayloadError(ValueError):
    """ข้อความใช้ไม่ได้ทั้งก้อน (ต่างจากค่าบางตัวที่เสียซึ่งแค่ตั้งเป็น None)"""


@dataclass
class Normalized:
    at: datetime
    seq: int | None
    device_id: str | None
    rows: list[tuple[str, dict[str, object]]]
    issues: list[dict[str, object]] = field(default_factory=list)


def parse_at(raw: object) -> datetime:
    if not isinstance(raw, str):
        raise PayloadError("missing_at")
    try:
        at = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise PayloadError("invalid_at") from exc
    if at.tzinfo is None or at.utcoffset() is None:
        raise PayloadError("at_without_offset")
    return at


def _number(values: dict[str, object], key: str, bounds: Bounds, issues: list[dict[str, object]]) -> float | None:
    raw = values.get(key)
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
        issues.append({"event": "invalid_value", "field": key, "value": raw})
        return None
    low, high = bounds
    if raw < low or raw > high:
        issues.append({"event": "out_of_range", "field": key, "value": raw})
        return None
    return float(raw)


def _fill(values: dict[str, object], fields: dict[str, tuple[str, Bounds]], row: dict[str, object],
          issues: list[dict[str, object]]) -> None:
    for key, (column, bounds) in fields.items():
        value = _number(values, key, bounds, issues)
        row[column] = int(value) if value is not None and column in INTEGER_COLUMNS else value


def _unknown_fields(values: dict[str, object], known: set[str], issues: list[dict[str, object]]) -> None:
    extra = sorted(set(values) - known)
    if extra:
        issues.append({"event": "unknown_field", "fields": extra})


def _seq(payload: dict[str, object], issues: list[dict[str, object]]) -> int | None:
    raw = payload.get("seq")
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        issues.append({"event": "invalid_value", "field": "seq", "value": raw})
        return None
    return raw


def _device_id(payload: dict[str, object]) -> str | None:
    raw = payload.get("deviceId")
    return raw if isinstance(raw, str) and raw else None


def heat_index(temp_c: float | None, humidity_pct: float | None) -> float | None:
    """ดัชนีความร้อน (Rothfusz) — สูตรเดียวกับ lib/mock/simulator.ts heatIndexOf()"""
    if temp_c is None or humidity_pct is None:
        return None
    if temp_c < 27:
        return round(temp_c, 1)
    t = temp_c * 9 / 5 + 32
    r = humidity_pct
    hf = (-42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r - 0.00683783 * t * t
          - 0.05481717 * r * r + 0.00122874 * t * t * r + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r)
    return round((hf - 32) * 5 / 9, 1)


def normalize_telemetry(kind: str, entity_id: str, payload: object, recv_time: datetime) -> Normalized:
    if not isinstance(payload, dict):
        raise PayloadError("payload_not_object")
    at = parse_at(payload.get("at"))
    values = payload.get("values")
    if not isinstance(values, dict):
        raise PayloadError("values_not_object")

    issues: list[dict[str, object]] = []
    seq = _seq(payload, issues)
    base: dict[str, object] = {"time": at, "recv_time": recv_time, "entity_id": entity_id, "seq": seq}

    if kind == "power":
        rows = _power_rows(values, base, issues)
    else:
        table, fields = TABLE_FIELDS[kind]
        row = dict(base)
        _fill(values, fields, row, issues)
        known = set(fields)
        if kind == "pump":
            known.add("runState")
            row["run_state"] = _run_state(values, issues)
        if kind == "env":
            row["heat_index_c"] = heat_index(row["temp_c"], row["humidity_pct"])  # type: ignore[arg-type]
        _unknown_fields(values, known, issues)
        rows = [(table, row)]

    return Normalized(at, seq, _device_id(payload), rows, issues)


def _run_state(values: dict[str, object], issues: list[dict[str, object]]) -> str | None:
    raw = values.get("runState")
    if raw is None:
        return None
    if raw not in PUMP_RUN_STATES:
        issues.append({"event": "invalid_value", "field": "runState", "value": raw})
        return None
    return raw  # type: ignore[return-value]


def _power_rows(values: dict[str, object], base: dict[str, object],
                issues: list[dict[str, object]]) -> list[tuple[str, dict[str, object]]]:
    """ตู้ไฟส่งทุกเฟสในข้อความเดียว: values.phases = {"L1": {...}, "L2": {...}, "L3": {...}} หรือ {"single": {...}}"""
    phases = values.get("phases")
    if not isinstance(phases, dict) or not phases:
        raise PayloadError("phases_missing")
    unknown = sorted(set(phases) - set(PHASES))
    if unknown:
        issues.append({"event": "unknown_phase", "phases": unknown})
    _unknown_fields(values, {"phases"}, issues)

    rows: list[tuple[str, dict[str, object]]] = []
    for phase in PHASES:
        reading = phases.get(phase)
        if reading is None:
            continue
        if not isinstance(reading, dict):
            issues.append({"event": "invalid_value", "field": f"phases.{phase}"})
            continue
        row = {**base, "phase": phase}
        _fill(reading, POWER_PHASE_FIELDS, row, issues)
        _unknown_fields(reading, set(POWER_PHASE_FIELDS), issues)
        rows.append(("power_telemetry", row))
    if not rows:
        raise PayloadError("phases_missing")
    three_phase = [row for _, row in rows if row["phase"] in ("L1", "L2", "L3")]
    if three_phase:
        rows.append(("power_telemetry", _total_row(base, three_phase)))
    return rows


def _total_row(base: dict[str, object], phases: list[dict[str, object]]) -> dict[str, object]:
    """ยอดรวมทั้งตู้ ณ เวลาเดียวกัน — เก็บเป็นแถว phase='total'

    ★ ต้องรวมตอนรับข้อมูล ไม่ใช่ตอน query: min/max ของผลรวมหาจาก min/max รายเฟสไม่ได้
    ★ ยอดรวมที่ต้องบวก (W, kWh) ขาดเฟสไหนก็เป็น None — บวกเท่าที่มีจะได้ตัวเลขต่ำกว่าจริงแบบเงียบ ๆ
    """
    def values(column: str) -> list[float]:
        return [float(r[column]) for r in phases if r[column] is not None]  # type: ignore[arg-type]

    def complete_sum(column: str) -> float | None:
        found = values(column)
        return sum(found) if len(found) == 3 else None

    currents, voltages, frequencies = values("current"), values("voltage"), values("frequency")
    power = complete_sum("power_w")
    apparent = [float(r["voltage"]) * float(r["current"]) for r in phases  # type: ignore[arg-type]
                if r["voltage"] is not None and r["current"] is not None]
    pf = power / sum(apparent) if power is not None and len(apparent) == 3 and sum(apparent) > 0 else None
    return {
        **base,
        "phase": "total",
        "voltage": sum(voltages) / len(voltages) if voltages else None,
        "current": max(currents) if currents else None,   # เฟสที่หนักสุด — ใช้เทียบพิกัดเบรกเกอร์
        "power_w": power,
        "energy_kwh": complete_sum("energy_kwh"),
        "pf": min(pf, 1.0) if pf is not None else None,
        "frequency": sum(frequencies) / len(frequencies) if frequencies else None,
    }


def normalize_status(device_id: str, payload: object, recv_time: datetime) -> tuple[Normalized | None, bool | None]:
    """คืน (แถว device_status, สถานะ online ที่อุปกรณ์บอกเอง)

    LWT ที่ broker ส่งแทนอุปกรณ์ตอนหลุดคือ {"deviceId": ..., "online": false} — ไม่มี `at` ก็ได้
    """
    if not isinstance(payload, dict):
        raise PayloadError("payload_not_object")
    online = payload.get("online")
    if online is False:
        return None, False

    at = parse_at(payload.get("at"))
    issues: list[dict[str, object]] = []
    seq = _seq(payload, issues)
    row: dict[str, object] = {"time": at, "recv_time": recv_time, "entity_id": device_id, "seq": seq}
    _fill(payload, STATUS_FIELDS, row, issues)
    last_error = payload.get("lastError")
    row["last_error"] = last_error if isinstance(last_error, str) else None

    has_reading = any(row[column] is not None for column, _ in STATUS_FIELDS.values()) or row["last_error"] is not None
    rows = [("device_status", row)] if has_reading else []
    return Normalized(at, seq, _device_id(payload), rows, issues), (True if online is True else None)
