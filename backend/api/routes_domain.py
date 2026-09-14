"""endpoint รายโดเมน (PROMPT_04 งานที่ 1) — อ่านอย่างเดียว

★ /history คืนข้อมูล "ดิบ" (ลดความละเอียดตาม intervalSeconds) ใช้กับกราฟจิ๋วในการ์ด
  คนละเรื่องกับ /api/metrics/series ที่คืน bucket รวมช่วง — ห้ามยุบรวมกัน
★ ใส่ Cache-Control: max-age=1 ทุก endpoint อ่านอย่างเดียว ลดภาระตอนหน้าจอดึงถี่ (PROBLEMS P-02)
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import psycopg
from fastapi import APIRouter, Depends, Query, Response

from . import buckets as bk
from .common import entity_or_404, parse_time
from .db import pool
from .domain_site import (
    alert_counts,
    build_departments,
    build_devices,
    build_electric_nodes,
    build_sensors,
    build_users,
    connection_status,
    device_summary,
    service_health,
    utc_now_iso,
)
from .domain_water import (
    build_meters,
    build_pressure_control,
    build_pumps,
    build_tanks,
    build_valves,
    build_zones,
    tank_totals,
)
from .errors import ApiException, bad_request, not_found
from .metric_registry import AMOUNT, COUNTER, LEVEL, METRICS, SOURCES
from .registry import Registry, registry, worst_status
from .reports import daily_points, department_usage
from .series import now_ms, to_dt
from .usage import (
    billing_period,
    counter_total,
    day_start,
    month_start,
    tariff,
    tier_cost,
    unaccounted_water,
    water_tiers,
)

router = APIRouter(prefix="/api")
MAX_HISTORY_POINTS = 2_000
MAX_DAILY_DAYS = 400


@dataclass(frozen=True)
class HistoryParams:
    frm: str | None
    to: str | None
    interval: int | None


def history_params(frm: str | None = Query(None, alias="from"), to: str | None = None,
                   interval: int | None = Query(None, gt=0),
                   interval_seconds: int | None = Query(None, alias="intervalSeconds", gt=0)) -> HistoryParams:
    """★ lib/services เขียน `interval=` ส่วนสเปกเขียน `intervalSeconds=` — รับทั้งคู่ หน่วยวินาทีเหมือนกัน"""
    return HistoryParams(frm, to, interval if interval is not None else interval_seconds)


HISTORY = Depends(history_params)


def _cached(response: Response) -> None:
    response.headers["Cache-Control"] = "max-age=1"


def _period(reg: Registry, frm: str | None, to: str | None) -> tuple[int, int]:
    now = now_ms()
    cycle = int(reg.setting("billing", "billingCycleStartDay", 1))  # type: ignore[call-overload]
    start, _end = billing_period(now, cycle, reg.timezone)
    start_ms, end_ms = parse_time(frm, start, "from"), parse_time(to, now, "to")
    if end_ms <= start_ms:
        raise bad_request("INVALID_RANGE", "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "`to` must be after `from`")
    return start_ms, min(end_ms, now)


def _period_start(reg: Registry, period: str) -> int:
    now = now_ms()
    if period == "today":
        return day_start(now, reg.timezone)
    if period == "month":
        return month_start(now, reg.timezone)
    raise bad_request("VALIDATION_FAILED", "period ต้องเป็น today หรือ month", "period must be today or month",
                      field="period")


# ─────────────── ประวัติดิบ ───────────────

def history(conn: psycopg.Connection, reg: Registry, source_type: str, entity_id: str, metric: str,
            frm: str | None, to: str | None, interval: int | None) -> list[dict[str, object]]:
    definition = METRICS.get((source_type, metric))
    if definition is None:
        raise bad_request("METRIC_NOT_SUPPORTED", f"{source_type} ไม่มีประวัติ {metric}",
                          f"No history for metric {metric} on {source_type}", metric=metric)
    now = now_ms()
    end_ms = parse_time(to, now, "to")
    start_ms = parse_time(frm, end_ms - 3_600_000, "from")
    if end_ms <= start_ms:
        raise bad_request("INVALID_RANGE", "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "`to` must be after `from`")
    span_s = (end_ms - start_ms) / 1000
    step = max(2, interval or math.ceil(span_s / 1000))
    if span_s / step > MAX_HISTORY_POINTS:
        raise bad_request("TOO_MANY_POINTS", f"ขอข้อมูลดิบเกิน {MAX_HISTORY_POINTS} จุด เพิ่ม intervalSeconds",
                          f"More than {MAX_HISTORY_POINTS} raw points; increase intervalSeconds",
                          limit=MAX_HISTORY_POINTS)

    source = SOURCES[definition.source]
    measure = source.measure(definition.measure)
    expr = measure.expr
    aggregate = {COUNTER: f"last({expr}, time)", LEVEL: f"last({expr}, time)", AMOUNT: f"sum({expr})"}.get(
        measure.kind, f"avg({expr})")
    where = f" AND ({source.where})" if source.where else ""
    scale = 1.0
    if definition.scale == "capacity_percent":
        capacity = float(reg.spec(entity_id).get("capacityLiters", 0))  # type: ignore[arg-type]
        scale = 100 / capacity if capacity > 0 else 0.0
    rows = conn.execute(f"""
        SELECT time_bucket(make_interval(secs => %s), time) AS b, {aggregate}
          FROM {source.table}
         WHERE entity_id = %s AND time >= %s AND time < %s AND ({expr}) IS NOT NULL{where}
         GROUP BY b ORDER BY b""", (step, entity_id, to_dt(start_ms), to_dt(end_ms))).fetchall()
    return [{"timestamp": round(b.timestamp() * 1000), "value": round(float(v) * scale, 3)}
            for b, v in rows if v is not None]


def _history_route(source_type: str, entity_id: str, metric: str, q: HistoryParams,
                   response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        reg = registry(conn)
        entity_or_404(reg, entity_id, source_type)
        target = entity_id
        if source_type == "zone":
            meter = reg.meter_of_zone(entity_id)
            if meter is None:
                raise not_found("ENTITY_NOT_FOUND", f"โซน {entity_id} ไม่มีมิเตอร์", f"Zone {entity_id} has no meter")
            target = str(meter["entity_id"])
        body = history(conn, reg, source_type, target, metric, q.frm, q.to, q.interval)
    _cached(response)
    return body


# ─────────────── ถัง ───────────────

@router.get("/tanks")
def get_tanks(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_tanks(conn, registry(conn))
    _cached(response)
    return body


@router.get("/tanks/summary")
def get_tank_summary(response: Response) -> dict[str, float]:
    with pool.connection() as conn:
        body = tank_totals(build_tanks(conn, registry(conn)))
    _cached(response)
    return body


@router.get("/tanks/{tank_id}")
def get_tank(tank_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_tanks(conn, registry(conn), only=tank_id)[0]
    _cached(response)
    return body


@router.get("/tanks/{tank_id}/history")
def get_tank_history(tank_id: str, response: Response, metric: str = "level_percent",
                     q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("tank", tank_id, metric, q, response)


# ─────────────── ปั๊ม ───────────────

@router.get("/pumps")
def get_pumps(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_pumps(conn, registry(conn))
    _cached(response)
    return body


@router.get("/pumps/energy")
def get_pump_energy(response: Response, period: str = "today") -> float:
    with pool.connection() as conn:
        reg = registry(conn)
        since = _period_start(reg, period)
        total = 0.0
        for pump in reg.of_type("pump"):
            total += counter_total(conn, reg.timezone, "pump", "energy", str(pump["entity_id"]), since, now_ms()) or 0.0
    _cached(response)
    return round(total, 2)


@router.get("/pumps/{pump_id}")
def get_pump(pump_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_pumps(conn, registry(conn), only=pump_id)[0]
    _cached(response)
    return body


@router.get("/pumps/{pump_id}/history")
def get_pump_history(pump_id: str, response: Response, metric: str = "power_watt",
                     q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("pump", pump_id, metric, q, response)


# ─────────────── วาล์ว · โซน ───────────────

@router.get("/valves")
def get_valves(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_valves(conn, registry(conn))
    _cached(response)
    return body


@router.get("/zones")
def get_zones(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_zones(conn, registry(conn))
    _cached(response)
    return body


@router.get("/zones/consumption")
def get_zone_consumption(response: Response, period: str = "today") -> list[dict[str, object]]:
    with pool.connection() as conn:
        reg = registry(conn)
        _period_start(reg, period)
        zones = build_zones(conn, reg)
    key = "todayCubicMeters" if period == "today" else "monthCubicMeters"
    _cached(response)
    return [{"zoneId": z["id"], "name": z["name"], "cubicMeters": z[key]} for z in zones]


@router.get("/zones/cost")
def get_zone_costs(response: Response, frm: str | None = Query(None, alias="from"), to: str | None = None):
    """ค่าน้ำประมาณรายโซน — ★ คิดขั้นบันไดจากปริมาณของโซนนั้นเอง ผลรวมทุกโซนจึงไม่เท่าบิลจริง (เหมือนหน้าบ้าน)"""
    with pool.connection() as conn:
        reg = registry(conn)
        start, end = _period(reg, frm, to)
        tiers = water_tiers(tariff(conn, "water", start, reg.timezone))
        rows = []
        for zone in reg.zones.values():
            meter = reg.meter_of_zone(str(zone["zone_id"]))
            m3 = counter_total(conn, reg.timezone, "meter", "volume", str(meter["entity_id"]), start, end) \
                if meter else None
            rows.append((zone, round(m3 or 0.0, 2)))
    total = sum(m3 for _, m3 in rows)
    _cached(response)
    return [{"zoneId": z["zone_id"], "name": z["name_th"], "nameEn": z["name_en"], "departmentId": z["department_id"],
             "cubicMeters": m3, "costBaht": tier_cost(m3, tiers),
             "sharePercent": round(m3 / total * 100, 1) if total else 0.0} for z, m3 in rows]


@router.get("/zones/{zone_id}")
def get_zone(zone_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_zones(conn, registry(conn), only=zone_id)[0]
    _cached(response)
    return body


@router.get("/zones/{zone_id}/history")
def get_zone_history(zone_id: str, response: Response, metric: str = "flow_lpm",
                     q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("zone", zone_id, metric, q, response)


# ─────────────── มิเตอร์ ───────────────

@router.get("/meters")
def get_zone_meters(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_meters(conn, registry(conn))
    _cached(response)
    return body


@router.get("/meters/main")
def get_main_meter(response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        meters = build_meters(conn, registry(conn), only_main=True)
    if not meters:
        raise not_found("ENTITY_NOT_FOUND", "ไม่พบมิเตอร์หลัก", "Main meter not found")
    _cached(response)
    return meters[0]


@router.get("/meters/balance")
def get_flow_balance(response: Response) -> dict[str, float]:
    with pool.connection() as conn:
        reg = registry(conn)
        main = build_meters(conn, reg, only_main=True)
        zones = build_zones(conn, reg)
    _cached(response)
    return {"inflowLpm": float(main[0]["flowLpm"]) if main else 0.0,  # type: ignore[arg-type]
            "outflowLpm": round(sum(float(z["flowLpm"]) for z in zones), 1)}  # type: ignore[arg-type]


@router.get("/meters/unaccounted")
def get_unaccounted(response: Response, frm: str | None = Query(None, alias="from"), to: str | None = None):
    with pool.connection() as conn:
        reg = registry(conn)
        start, end = _period(reg, frm, to)
        body = unaccounted_water(conn, reg, start, end)
    _cached(response)
    return body


@router.get("/meters/daily")
def get_daily_usage(response: Response, frm: str | None = Query(None, alias="from"), to: str | None = None,
                    projection: bool = False) -> list[dict[str, object]]:
    """ยอดใช้น้ำรายวัน = Σ มิเตอร์ทุกโซน · ค่าน้ำรายวันเฉลี่ยตามสัดส่วนจากค่าน้ำทั้งรอบบิล (D-70)

    ★ projection: จุดพยากรณ์มาจากทีม AI — ยังไม่มีผลพยากรณ์จึงยังไม่ต่อจุดอนาคต (D-31)
    """
    with pool.connection() as conn:
        reg = registry(conn)
        tz, now = reg.timezone, now_ms()
        end = parse_time(to, now, "to")
        start = bk.bucket_start(parse_time(frm, day_start(now, tz) - 29 * bk.MS_DAY, "from"), "day", tz)
        if (end - start) / bk.MS_DAY > MAX_DAILY_DAYS:
            raise bad_request("RANGE_TOO_LONG", f"ขอรายวันได้ไม่เกิน {MAX_DAILY_DAYS} วัน",
                              f"Daily usage limited to {MAX_DAILY_DAYS} days")
        body = daily_points(conn, reg, start, end)
    _cached(response)
    return body


@router.get("/meters/{meter_id}/history")
def get_meter_history(meter_id: str, response: Response, metric: str = "flow_lpm",
                      q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("meter", meter_id, metric, q, response)


# ─────────────── แรงดัน ───────────────

@router.get("/pressure")
def get_pressure(response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_pressure_control(conn, registry(conn))
    _cached(response)
    return body


@router.get("/pressure/history")
def get_pressure_history(response: Response, metric: str = "pressure_bar",
                         q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    with pool.connection() as conn:
        pump_id = str(registry(conn).spec("pressure-control-1").get("controlledPumpId", ""))
    return _history_route("pump", pump_id, metric, q, response)


@router.get("/pressure/headcount")
def get_headcount(response: Response) -> dict[str, object]:
    _cached(response)
    return {"headcount": None, "updatedAt": None}   # ยังไม่มีแหล่งข้อมูลจำนวนคน


# ─────────────── สภาพแวดล้อม ───────────────

@router.get("/environment")
def get_environment(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_sensors(conn, registry(conn))
    _cached(response)
    return body


@router.get("/environment/rainfall")
def get_rainfall(response: Response):
    with pool.connection() as conn:
        sensors = [s for s in build_sensors(conn, registry(conn)) if s["hasRainGauge"]]
    _cached(response)
    if not sensors or sensors[0]["latest"]["rainfallMmPerHour"] is None:  # type: ignore[index]
        return None
    latest = sensors[0]["latest"]
    return {"mmPerHour": latest["rainfallMmPerHour"], "detected": bool(latest["rainDetected"])}  # type: ignore[index]


@router.get("/environment/{sensor_id}")
def get_sensor(sensor_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_sensors(conn, registry(conn), only=sensor_id)[0]
    _cached(response)
    return body


@router.get("/environment/{sensor_id}/latest")
def get_sensor_latest(sensor_id: str, response: Response) -> dict[str, object]:
    return get_sensor(sensor_id, response)["latest"]  # type: ignore[return-value]


@router.get("/environment/{sensor_id}/history")
def get_sensor_history(sensor_id: str, response: Response, metric: str = "temperature",
                       q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("sensor", sensor_id, metric, q, response)


# ─────────────── ไฟฟ้า · แผนก · ผู้ใช้ ───────────────

@router.get("/electric/nodes")
def get_electric_nodes(response: Response, department_id: str | None = Query(None, alias="departmentId")):
    with pool.connection() as conn:
        body = build_electric_nodes(conn, registry(conn), department_id=department_id)
    _cached(response)
    return body


@router.get("/electric/summary")
def get_electric_summary(response: Response, period: str = "today") -> list[dict[str, object]]:
    with pool.connection() as conn:
        reg = registry(conn)
        _period_start(reg, period)
        nodes = build_electric_nodes(conn, reg)
    key = "todayEnergyKwh" if period == "today" else "monthEnergyKwh"
    _cached(response)
    return [{"departmentId": d["id"], "departmentName": d["name"],
             "energyKwh": round(sum(float(n[key]) for n in nodes if n["departmentId"] == d["id"]), 1)}  # type: ignore[arg-type]
            for d in build_departments(reg)]


@router.get("/electric/nodes/{node_id}")
def get_electric_node(node_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_electric_nodes(conn, registry(conn), only=node_id)[0]
    _cached(response)
    return body


@router.get("/electric/nodes/{node_id}/history")
def get_electric_history(node_id: str, response: Response, metric: str = "power_watt",
                         q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("electric_node", node_id, metric, q, response)


@router.get("/departments")
def get_departments(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_departments(registry(conn))
    _cached(response)
    return body


@router.get("/departments/usage")
def get_department_usage(response: Response, frm: str | None = Query(None, alias="from"), to: str | None = None):
    """★ ผลลัพธ์หลักของโปรเจกต์ — คิดจากข้อมูลที่บันทึกจริงตลอดช่วง ไม่ใช่ค่าสะสมล่าสุด"""
    with pool.connection() as conn:
        reg = registry(conn)
        start, end = _period(reg, frm, to)
        body = department_usage(conn, reg, start, end)
    _cached(response)
    return body


@router.get("/users")
def get_users(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = build_users(conn)
    _cached(response)
    return body


# ─────────────── อุปกรณ์ ───────────────

@router.get("/devices")
def get_devices(response: Response, kind: str | None = None, role: str | None = None) -> list[dict[str, object]]:
    with pool.connection() as conn:
        devices = build_devices(conn, registry(conn))
    _cached(response)
    return [d for d in devices if (kind is None or d["kind"] == kind) and (role is None or d["role"] == role)]


@router.get("/devices/summary")
def get_device_summary(response: Response) -> dict[str, int]:
    with pool.connection() as conn:
        body = device_summary(build_devices(conn, registry(conn)))
    _cached(response)
    return body


@router.get("/devices/{device_id}")
def get_device(device_id: str, response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = build_devices(conn, registry(conn), only=device_id)[0]
    _cached(response)
    return body


@router.get("/devices/{device_id}/history")
def get_device_history(device_id: str, response: Response, metric: str = "rssi_dbm",
                       q: HistoryParams = HISTORY) -> list[dict[str, object]]:
    return _history_route("device", device_id, metric, q, response)


@router.post("/devices/{device_id}/ping")
def ping_device(device_id: str) -> dict[str, object]:
    """★ ตัดสินจากข้อความล่าสุดที่ ingest ได้รับ ไม่ได้ส่ง ICMP (container ไม่มีสิทธิ์และ VLAN แยกกัน)"""
    with pool.connection() as conn:
        device = build_devices(conn, registry(conn), only=device_id)[0]
    return {"reachable": device["status"] != "offline", "latencyMs": None}


@router.get("/devices/firmware-jobs/{job_id}")
def firmware_job(job_id: str) -> None:
    raise ApiException(501, "NOT_IMPLEMENTED", "ยังไม่มีงานอัปเดตเฟิร์มแวร์ — รอสัญญา OTA กับทีมฮาร์ดแวร์",
                       "Firmware jobs are not available yet — the OTA contract with hardware is pending",
                       {"jobId": job_id})


@router.post("/devices/{device_id}/firmware")
def device_command(device_id: str) -> None:
    raise ApiException(501, "NOT_IMPLEMENTED", "คำสั่งไปยังอุปกรณ์เปิดใช้ในเฟสระบบควบคุม (ต้องผ่าน audit log)",
                       "Device commands arrive with the control phase (audited)", {"deviceId": device_id})


# ─────────────── ระบบ ───────────────

@router.get("/system/connection")
def get_connection(response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        body = connection_status(conn, registry(conn))
    _cached(response)
    return body


@router.get("/system/services")
def get_services(response: Response) -> list[dict[str, object]]:
    with pool.connection() as conn:
        body = service_health(conn, registry(conn))
    _cached(response)
    return body


@router.get("/system/summary")
def get_system_summary(response: Response) -> dict[str, object]:
    with pool.connection() as conn:
        reg = registry(conn)
        tanks, pumps = build_tanks(conn, reg), build_pumps(conn, reg)
        zones, nodes = build_zones(conn, reg), build_electric_nodes(conn, reg)
        main = build_meters(conn, reg, only_main=True)
        devices = build_devices(conn, reg)
        pressure = build_pressure_control(conn, reg)
        unread, critical, anomalies = alert_counts(conn)
        now = now_ms()
        cycle = int(reg.setting("billing", "billingCycleStartDay", 1))  # type: ignore[call-overload]
        start, _ = billing_period(now, cycle, reg.timezone)
        unaccounted = unaccounted_water(conn, reg, start, now)
        # ★ พลังงานวันนี้ = ปั๊ม + ตู้ไฟรายแผนก (ตามคำอธิบายของ SystemSummary.todayEnergyKwh)
        today = day_start(now, reg.timezone)
        pump_kwh = sum(counter_total(conn, reg.timezone, "pump", "energy", str(p["id"]), today, now) or 0.0
                       for p in pumps)
    totals = tank_totals(tanks)
    node_kwh = sum(float(n["todayEnergyKwh"]) for n in nodes)  # type: ignore[arg-type]
    pid_running = any(p["controlMode"] == "pid" and p["runState"] == "running" for p in pumps)
    _cached(response)
    return {
        "totalStoredLiters": totals["storedLiters"], "totalCapacityLiters": totals["capacityLiters"],
        "totalStoredPercent": totals["percentFull"],
        "mainInflowLpm": float(main[0]["flowLpm"]) if main else 0.0,  # type: ignore[arg-type]
        "zoneOutflowLpm": round(sum(float(z["flowLpm"]) for z in zones), 1),  # type: ignore[arg-type]
        "todayConsumptionCubicMeters": round(sum(float(z["todayCubicMeters"]) for z in zones), 2),  # type: ignore[arg-type]
        "monthConsumptionCubicMeters": round(sum(float(z["monthCubicMeters"]) for z in zones), 2),  # type: ignore[arg-type]
        "todayEnergyKwh": round(pump_kwh + node_kwh, 1),
        "systemPressureBar": pressure["measuredPressureBar"] if pid_running else None,
        "pumpsRunning": sum(p["runState"] == "running" for p in pumps), "pumpsTotal": len(pumps),
        "zonesActive": sum(float(z["flowLpm"]) > 0.5 for z in zones), "zonesTotal": len(zones),  # type: ignore[arg-type]
        "devicesOnline": sum(d["status"] != "offline" for d in devices), "devicesTotal": len(devices),
        "unreadAlerts": unread, "criticalAlerts": critical, "openAnomalies": anomalies, "unaccounted": unaccounted,
        "overallStatus": worst_status([str(x["status"]) for x in [*tanks, *pumps, *zones, *nodes]]
                                      + [str(unaccounted["status"])]),
        "updatedAt": utc_now_iso(reg),
    }
