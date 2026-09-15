"""ทะเบียน metric ฝั่ง backend — แหล่งเดียวของ "metric นี้อยู่ตารางไหน รวมแบบไหน หน่วยอะไร"

ใช้สองที่:
  1. scripts/gen_caggs.py  สร้าง db/07_caggs.sql (continuous aggregate ทุกชั้น)
  2. api/series.py         ตอบ /api/metrics/series

★ kind และหน่วยตรงกับ HANDOFF §2.11 และ lib/config/metrics.ts
  (หน้าบ้าน render ตาม kind ใน response — ถ้าตัดสินใจต่างจากหน้าบ้านต้องบอกให้แก้ทะเบียนตาม)
★ metric ที่ยังคำนวณไม่ได้ในเฟสนี้ (zone_outflow_lpm, unaccounted_percent, headcount) ไม่อยู่ในทะเบียน
  API จะตอบ 404 พร้อมเหตุผลแทนการเดาค่า
"""

from __future__ import annotations

from dataclasses import dataclass

GAUGE, COUNTER, AMOUNT, LEVEL, STATE = "gauge", "counter", "amount", "level", "state"


@dataclass(frozen=True)
class Measure:
    """ค่าวัดหนึ่งตัวที่ต้องมีคอลัมน์รวมใน continuous aggregate"""

    key: str    # prefix ของคอลัมน์ใน cagg เช่น power_w → power_w_sum, power_w_n, …
    expr: str   # นิพจน์ SQL บนแถวดิบ
    kind: str   # gauge | counter | amount | level


@dataclass(frozen=True)
class Source:
    table: str
    where: str | None
    measures: tuple[Measure, ...]

    def measure(self, key: str) -> Measure:
        return next(m for m in self.measures if m.key == key)


SOURCES: dict[str, Source] = {
    "pump": Source("pump_telemetry", None, (
        Measure("power_w", "power_w", GAUGE),
        Measure("current", "current", GAUGE),
        Measure("voltage", "voltage", GAUGE),
        Measure("flow", "flow_lpm", GAUGE),
        Measure("pressure", "pressure_bar", GAUGE),
        Measure("vfd", "vfd_hz", GAUGE),
        Measure("energy", "energy_kwh", COUNTER),
    )),
    "tank": Source("tank_telemetry", None, (
        Measure("volume", "volume_l", LEVEL),
        Measure("net_flow", "flow_in_lpm - flow_out_lpm", GAUGE),
    )),
    "meter": Source("meter_telemetry", None, (
        Measure("flow", "flow_lpm", GAUGE),
        Measure("inlet_pressure", "inlet_pressure_bar", GAUGE),
        Measure("volume", "volume_m3", COUNTER),
    )),
    "env": Source("env_telemetry", None, (
        Measure("temp", "temp_c", GAUGE),
        Measure("humidity", "humidity_pct", GAUGE),
        Measure("heat_index", "heat_index_c", GAUGE),
        Measure("pressure", "pressure_hpa", GAUGE),
        Measure("lux", "lux", GAUGE),
        Measure("rain", "rain_mm", AMOUNT),
    )),
    # ★ ใช้เฉพาะแถวยอดรวมทั้งตู้ ('total' ของตู้ 3 เฟส / 'single' ของตู้เฟสเดียว) — ห้าม SUM ข้ามเฟสเอง
    "power": Source("power_telemetry", "phase IN ('total', 'single')", (
        Measure("power_w", "power_w", GAUGE),
        Measure("current", "current", GAUGE),
        Measure("voltage", "voltage", GAUGE),
        Measure("energy", "energy_kwh", COUNTER),
    )),
    "device": Source("device_status", None, (
        Measure("rssi", "rssi", GAUGE),
        Measure("free_heap", "free_heap", GAUGE),
        Measure("uptime", "uptime_s", COUNTER),
    )),
    # ค่าที่ worker คำนวณระดับทั้งโรงงาน (ไม่ได้มาจากเซนเซอร์ตัวใด) · หนึ่งแถว = หนึ่งหน้าต่างที่ประเมิน
    "plant": Source("plant_metrics", None, (
        Measure("unaccounted", "unaccounted_percent", GAUGE),
    )),
}

LEVELS = (("5m", "5 minutes"), ("1h", "1 hour"), ("1d", "1 day"))


def cagg_name(source: str, level: str) -> str:
    return f"{source}_{level}"


@dataclass(frozen=True)
class MetricDef:
    source: str              # key ใน SOURCES
    measure: str             # key ของ Measure
    kind: str                # kind ที่ตอบกลับหน้าบ้าน
    unit: str
    scale: str | None = None  # "capacity_percent" = ÷ ความจุถัง × 100


# (sourceType ตาม MetricSourceType, metric ตาม MetricKey) → นิยาม
METRICS: dict[tuple[str, str], MetricDef] = {
    ("tank", "level_liters"): MetricDef("tank", "volume", LEVEL, "L"),
    ("tank", "level_percent"): MetricDef("tank", "volume", LEVEL, "%", scale="capacity_percent"),
    ("tank", "net_flow_lpm"): MetricDef("tank", "net_flow", GAUGE, "L/min"),

    ("pump", "flow_lpm"): MetricDef("pump", "flow", GAUGE, "L/min"),
    ("pump", "power_watt"): MetricDef("pump", "power_w", GAUGE, "W"),
    ("pump", "current_amp"): MetricDef("pump", "current", GAUGE, "A"),
    ("pump", "voltage_volt"): MetricDef("pump", "voltage", GAUGE, "V"),
    ("pump", "pressure_bar"): MetricDef("pump", "pressure", GAUGE, "bar"),
    ("pump", "vfd_frequency_hz"): MetricDef("pump", "vfd", GAUGE, "Hz"),
    ("pump", "energy_kwh"): MetricDef("pump", "energy", COUNTER, "kWh"),

    ("meter", "flow_lpm"): MetricDef("meter", "flow", GAUGE, "L/min"),
    ("meter", "pressure_bar"): MetricDef("meter", "inlet_pressure", GAUGE, "bar"),
    ("meter", "volume_cubic_meters"): MetricDef("meter", "volume", COUNTER, "m³"),
    # โซนอ่านจากมิเตอร์ของโซนนั้น (entity ชนิด meter ที่ zone_id ตรงกัน)
    ("zone", "flow_lpm"): MetricDef("meter", "flow", GAUGE, "L/min"),
    ("zone", "volume_cubic_meters"): MetricDef("meter", "volume", COUNTER, "m³"),
    # ระดับทั้งโรงงานที่คิดได้แล้วจากมิเตอร์หลักตัวเดียว
    ("system", "main_inflow_lpm"): MetricDef("meter", "flow", GAUGE, "L/min"),
    # worker น้ำสูญหายเขียนทุก 5 นาที (หน้าต่าง 60 นาที) · ข้อมูลไม่ครบ = null
    ("system", "unaccounted_percent"): MetricDef("plant", "unaccounted", GAUGE, "%"),

    ("sensor", "temperature"): MetricDef("env", "temp", GAUGE, "°C"),
    ("sensor", "humidity"): MetricDef("env", "humidity", GAUGE, "%RH"),
    ("sensor", "heat_index"): MetricDef("env", "heat_index", GAUGE, "°C"),
    ("sensor", "pressure_hpa"): MetricDef("env", "pressure", GAUGE, "hPa"),
    ("sensor", "illuminance_lux"): MetricDef("env", "lux", GAUGE, "lux"),
    ("sensor", "rainfall"): MetricDef("env", "rain", AMOUNT, "mm"),

    ("electric_node", "power_watt"): MetricDef("power", "power_w", GAUGE, "W"),
    ("electric_node", "current_amp"): MetricDef("power", "current", GAUGE, "A"),
    ("electric_node", "voltage_volt"): MetricDef("power", "voltage", GAUGE, "V"),
    ("electric_node", "energy_kwh"): MetricDef("power", "energy", COUNTER, "kWh"),

    ("device", "rssi_dbm"): MetricDef("device", "rssi", GAUGE, "dBm"),
    ("device", "free_heap_bytes"): MetricDef("device", "free_heap", GAUGE, "B"),
    ("device", "uptime_seconds"): MetricDef("device", "uptime", COUNTER, "s"),
}

# metric ชนิดสถานะอ่านจาก state_spans ไม่ผ่าน aggregate
STATE_METRICS = frozenset({"pump_run_state", "online_state"})

# metric ที่มีในสัญญาแต่ต้องรอเฟสอื่นคำนวณ — ตอบ 404 พร้อมบอกว่ารออะไร
PENDING_METRICS = {
    "zone_outflow_lpm": "รอ worker สมดุลน้ำ (เฟส 6)",
    "headcount": "ยังไม่มีแหล่งข้อมูลจำนวนคนจาก PLC",
}
