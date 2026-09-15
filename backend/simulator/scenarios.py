"""สถานการณ์ที่ต้องใช้ข้อมูลต่อเนื่องหลายนาที (S13 รั่วกลางคืน · S14 ปั๊มเสื่อม · เฟส 6 เติมบ่อสำรอง)

สถานการณ์ที่ฉีดข้อความเฉพาะจุด (S2–S12) อยู่ใน tests/test_scenarios.py ซึ่งยิงข้อความเองได้แม่นกว่า
★ สถานการณ์กำหนดระดับน้ำตั้งต้นของถังได้ (`tanks: {tank-id: percent}`) — ผลของสมดุลน้ำขึ้นกับระดับถังมาก
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

NAMES = ("night_leak", "pump_degrading", "pond_fill")


@dataclass(frozen=True)
class Scenarios:
    leak: dict | None = None
    degrade: dict | None = None
    tank_start: dict[str, float] = field(default_factory=dict)

    @classmethod
    def from_names(cls, names: list[str], profile: dict) -> Scenarios:
        config = profile["scenarios"]
        tank_start: dict[str, float] = {}
        for name in names:
            tank_start |= {tid: float(percent) for tid, percent in config[name].get("tanks", {}).items()}
        return cls(leak=config["night_leak"] if "night_leak" in names else None,
                   degrade=config["pump_degrading"] if "pump_degrading" in names else None,
                   tank_start=tank_start)

    def leak_lpm(self, local: datetime, served_zone_ids: list[str]) -> float:
        """น้ำที่รั่วก่อนถึงมิเตอร์โซน — ปั๊มที่จ่ายโซนนั้นต้องสูบเพิ่ม แต่มิเตอร์โซนไม่เห็น"""
        if self.leak is None or self.leak["zone"] not in served_zone_ids:
            return 0.0
        start, end, hour = self.leak["from_hour"], self.leak["to_hour"], local.hour
        night = (hour >= start or hour < end) if start > end else (start <= hour < end)
        return float(self.leak["lpm"]) if night else 0.0

    def degradation(self, pump_id: str) -> float:
        if self.degrade is None or self.degrade["pump"] != pump_id:
            return 1.0
        return float(self.degrade["power_factor"])
