"""ตรวจเกณฑ์จากข้อความ MQTT ตรง ๆ (ไม่อ่านจาก DB เพราะต้องเร็ว)

★ debounce: ต้องเกินเกณฑ์ 3 รอบติดถึงนับเป็นเหตุ และกลับปกติ 3 รอบติดถึงปิดเหตุ
  ไม่ debounce = แจ้งเตือนวันละหลายร้อยครั้งจนไม่มีใครอ่าน
★ สร้าง op เฉพาะขอบขาเข้า/ขาออก ไม่ใช่ทุกรอบที่ยังเกินเกณฑ์
★ kind ของ alert ใช้ AlertCode ใน lib/types.ts ตรง ๆ หน้าบ้านจะได้ไม่ต้องแปลง
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .cache import Threshold

DEBOUNCE_COUNT = 3


def classify(value: float, threshold: Threshold, sides: frozenset[str]) -> tuple[str, str, float] | None:
    """คืน (severity, side, ค่าเกณฑ์ที่ละเมิด) หรือ None ถ้าอยู่ในเกณฑ์"""
    if "high" in sides:
        if threshold.crit_high is not None and value >= threshold.crit_high:
            return "critical", "high", threshold.crit_high
    if "low" in sides:
        if threshold.crit_low is not None and value <= threshold.crit_low:
            return "critical", "low", threshold.crit_low
    if "high" in sides:
        if threshold.warn_high is not None and value >= threshold.warn_high:
            return "warning", "high", threshold.warn_high
    if "low" in sides:
        if threshold.warn_low is not None and value <= threshold.warn_low:
            return "warning", "low", threshold.warn_low
    return None


@dataclass
class _RuleState:
    breaches: int = 0
    normals: int = 0
    open: bool = False
    severity: str | None = None
    window_severity: str | None = None
    first_breach_at: datetime | None = None
    first_normal_at: datetime | None = None
    peak: float | None = None
    side: str | None = None
    limit: float | None = None


def _worse(a: str | None, b: str) -> str:
    return "critical" if "critical" in (a, b) else b


class RuleEngine:
    def __init__(self, debounce: int = DEBOUNCE_COUNT) -> None:
        self._debounce = debounce
        self._state: dict[tuple[str, str], _RuleState] = {}

    def mark_open(self, entity_id: str, code: str, severity: str) -> None:
        """เหตุที่ยังเปิดค้างใน DB ตอน ingest เริ่มใหม่ — ต้องรู้ไว้ ไม่งั้นกลับปกติแล้วจะไม่มีใครปิด"""
        self._state[(entity_id, code)] = _RuleState(open=True, severity=severity)

    def evaluate(self, entity_id: str, code: str, value: float | None, threshold: Threshold | None,
                 sides: frozenset[str], at: datetime) -> list[dict[str, object]]:
        if value is None or threshold is None:
            return []  # ไม่มีค่า ≠ ปกติ — ไม่นับทั้งสองทาง
        state = self._state.setdefault((entity_id, code), _RuleState())
        hit = classify(value, threshold, sides)
        key = {"entity_id": entity_id, "kind": code}

        if hit is not None:
            severity, side, limit = hit
            state.normals, state.first_normal_at = 0, None
            if state.breaches == 0:
                state.first_breach_at, state.peak, state.side = at, value, side
            state.breaches += 1
            state.window_severity = _worse(state.window_severity, severity)
            state.limit = limit if state.limit is None or severity == "critical" else state.limit
            if state.side == side:
                state.peak = max(state.peak, value) if side == "high" else min(state.peak, value)  # type: ignore[type-var]

            if not state.open and state.breaches >= self._debounce:
                state.open, state.severity = True, state.window_severity
                return [{"op": "alert_open", "params": {**key, "severity": state.severity,
                                                         "started_at": state.first_breach_at,
                                                         "peak_value": state.peak, "threshold": state.limit}}]
            if state.open and severity == "critical" and state.severity != "critical":
                state.severity = "critical"
                return [{"op": "alert_escalate", "params": key}]
            return []

        state.breaches, state.window_severity = 0, None
        if not state.open:
            state.peak = state.side = state.limit = None
            return []
        if state.normals == 0:
            state.first_normal_at = at
        state.normals += 1
        if state.normals < self._debounce:
            return []
        op = {"op": "alert_close", "params": {**key, "ended_at": state.first_normal_at, "peak_value": state.peak}}
        self._state[(entity_id, code)] = _RuleState()
        return [op]
