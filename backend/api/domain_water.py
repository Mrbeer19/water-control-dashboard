"""ประกอบ entity ฝั่งน้ำ — Tank · Pump · Valve · Zone · WaterMeter · MainMeter · PressureControl

★ รูปร่างตรงกับ lib/types.ts ทุกฟิลด์ (ตรวจด้วย tests/test_contract.py ที่คอมไพล์เทียบกับ types.ts จริง)
★ ปั๊มหลัก 1/2 จ่ายทุกโซนเหมือนกัน ห้ามบวกอัตราไหลของสองตัวรวมกัน
★ ปริมาตรบ่อสำรองมาจาก tank_volume() (ตาราง interpolate) ไม่ใช่ level × area
"""

from __future__ import annotations

import math

import psycopg

from .common import entity_or_404, getter, is_offline, iso_dt, iso_required, num, required
from .latest import Latest, latest_many, offline_devices
from .registry import Registry, status_from_range, worst_status
from .series import now_ms, to_dt
from .usage import counter_since, day_start, month_start

POWER_FACTOR_FALLBACK = 0.0


# ─────────────── ถัง ───────────────

def build_tanks(conn: psycopg.Connection, reg: Registry, only: str | None = None) -> list[dict[str, object]]:
    tz = reg.timezone
    tanks = [entity_or_404(reg, only, "tank")] if only else reg.of_type("tank")
    ids = [str(t["entity_id"]) for t in tanks]
    latest = latest_many(conn, "tank", ids)
    offline = offline_devices(conn)
    profiles: dict[str, list[dict[str, float]]] = {}
    for entity_id, level, volume in conn.execute("""
            SELECT p.entity_id, p.level_m, p.volume_l FROM tank_profiles p
             WHERE p.entity_id = ANY(%s)
               AND p.version = (SELECT max(version) FROM tank_profiles WHERE entity_id = p.entity_id)
             ORDER BY p.entity_id, p.level_m""", (ids,)).fetchall():
        profiles.setdefault(entity_id, []).append({"levelMeters": float(level), "volumeLiters": float(volume)})

    out = []
    for tank in tanks:
        entity_id = str(tank["entity_id"])
        spec = reg.spec(entity_id)
        current = latest[entity_id]
        level = num(current.get("level_m")) if current else None
        liters = num(current.get("volume_l"), 1) if current else None
        if liters is None and level is not None:
            row = conn.execute("SELECT tank_volume(%s, %s::numeric)", (entity_id, level)).fetchone()
            liters = num(row[0], 1) if row else None
        capacity = float(spec.get("capacityLiters", 0))  # type: ignore[arg-type]
        percent = liters / capacity * 100 if liters is not None and capacity > 0 else None
        inflow = num(current.get("flow_in_lpm"), 1) if current else None
        outflow = num(current.get("flow_out_lpm"), 1) if current else None
        net = inflow - outflow if inflow is not None and outflow is not None else None
        thresholds = reg.threshold(entity_id, "level_percent")
        status = "offline" if is_offline(tank, current, offline, reg) else status_from_range(percent, thresholds)
        shape = spec.get("shape", "rectangular")
        seen = current.recv_time if current else None
        out.append({
            "id": entity_id, "name": tank["name"], "nameEn": tank["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "role": spec.get("role"), "shape": shape, "levelSource": spec.get("levelSource", "sensor"),
            "levelToVolumeTable": profiles.get(entity_id) if shape in ("pond", "irregular") else None,
            "manualReadingAt": None, "manualReadingBy": None,
            "capacityLiters": capacity, "currentLiters": required(liters, 1), "percentFull": required(percent, 2),
            "levelMeters": required(level), "heightMeters": float(spec.get("heightMeters", 0)),  # type: ignore[arg-type]
            "inflowLpm": required(inflow, 1), "outflowLpm": required(outflow, 1), "netFlowLpm": required(net, 1),
            "thresholdsPercent": thresholds,
            "minutesToFull": round((capacity - liters) / net) if net and net > 1 and liters is not None else None,
            "minutesToEmpty": round(liters / -net) if net and net < -1 and liters is not None else None,
            "deviceId": tank["device_id"], "location": spec.get("location", ""),
            "locationEn": spec.get("locationEn", ""),
        })
    return out


def tank_totals(tanks: list[dict[str, object]]) -> dict[str, float]:
    stored = sum(float(t["currentLiters"]) for t in tanks)  # type: ignore[arg-type]
    capacity = sum(float(t["capacityLiters"]) for t in tanks)  # type: ignore[arg-type]
    return {"storedLiters": round(stored), "capacityLiters": capacity,
            "percentFull": round(stored / capacity * 100, 1) if capacity else 0.0}


# ─────────────── ปั๊ม ───────────────

def _pump_spans(conn: psycopg.Connection, ids: list[str], since_ms: int) -> dict[str, dict[str, object]]:
    rows = conn.execute("""
        SELECT entity_id,
               coalesce(sum(extract(epoch FROM coalesce(ended_at, now()) - started_at))
                        FILTER (WHERE state = 'running'), 0) / 3600.0 AS running_hours,
               count(*) FILTER (WHERE state = 'running' AND started_at >= %s) AS starts_today,
               max(started_at) FILTER (WHERE state = 'running') AS last_started,
               max(ended_at) FILTER (WHERE state = 'running') AS last_stopped
          FROM state_spans WHERE metric = 'pump_run_state' AND entity_id = ANY(%s)
         GROUP BY entity_id""", (to_dt(since_ms), ids)).fetchall()
    return {r[0]: {"running_hours": float(r[1]), "starts_today": int(r[2]), "last_started": r[3], "last_stopped": r[4]}
            for r in rows}


def build_pumps(conn: psycopg.Connection, reg: Registry, only: str | None = None) -> list[dict[str, object]]:
    tz = reg.timezone
    pumps = [entity_or_404(reg, only, "pump")] if only else reg.of_type("pump")
    ids = [str(p["entity_id"]) for p in pumps]
    latest = latest_many(conn, "pump", ids)
    offline = offline_devices(conn)
    spans = _pump_spans(conn, ids, day_start(now_ms(), tz))
    pressure = reg.spec("pressure-control-1")
    service_interval = float(reg.setting("maintenance", "serviceIntervalHours", 2000))  # type: ignore[arg-type]

    out = []
    for pump in pumps:
        entity_id = str(pump["entity_id"])
        spec, current = reg.spec(entity_id), latest[entity_id]
        get = getter(current)
        voltage, current_a, power = num(get("voltage"), 1), num(get("current"), 2), num(get("power_w"), 0)
        pf = power / (math.sqrt(3) * voltage * current_a) if power and voltage and current_a else POWER_FACTOR_FALLBACK
        run_state = str(get("run_state") or "stopped")
        has_vfd = bool(spec.get("hasVfd"))
        vfd = num(get("vfd_hz"), 1)
        control_mode = spec.get("controlMode", "auto")
        span = spans.get(entity_id, {})
        runtime = float(spec.get("initialRuntimeHours", 0)) + float(span.get("running_hours", 0))  # type: ignore[arg-type]
        until_service = round(service_interval - (runtime % service_interval), 1) if service_interval > 0 else 0.0
        thresholds = reg.threshold(entity_id, "current_amp")
        if is_offline(pump, current, offline, reg):
            status = "offline"
        elif run_state == "fault":
            status = "critical"
        else:
            status = worst_status([status_from_range(current_a, thresholds), "warning" if until_service < 50 else "ok"])
        seen = current.recv_time if current else None
        out.append({
            "id": entity_id, "name": pump["name"], "nameEn": pump["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "role": spec.get("role"), "runState": run_state, "controlMode": control_mode,
            "electrical": {"voltage": required(voltage, 1), "current": required(current_a, 2),
                           "powerWatt": required(power, 0), "energyKwh": required(get("energy_kwh"), 3),
                           "powerFactor": round(min(pf, 1.0), 3)},
            "hasVfd": has_vfd, "vfdFrequencyHz": vfd if has_vfd else None,
            "speedPercent": round(vfd / 50 * 100, 1) if has_vfd and vfd is not None else None,
            "pressureSetpointBar": pressure.get("setpointBar") if control_mode == "pid" else None,
            "flowLpm": required(get("flow_lpm"), 1), "dischargePressureBar": required(get("pressure_bar"), 2),
            "runtimeHours": round(runtime, 2), "startsToday": int(span.get("starts_today", 0)),  # type: ignore[call-overload]
            "lastStartedAt": iso_dt(span.get("last_started"), tz),  # type: ignore[arg-type]
            "lastStoppedAt": iso_dt(span.get("last_stopped"), tz),  # type: ignore[arg-type]
            "faultCode": None, "faultMessage": None, "hoursUntilService": until_service,
            "sourceTankId": spec.get("sourceTankId"), "servesZoneIds": list(spec.get("servesZoneIds", [])),  # type: ignore[call-overload]
            "deviceId": pump["device_id"],
        })
    return out


# ─────────────── วาล์ว ───────────────

def build_valves(conn: psycopg.Connection, reg: Registry) -> list[dict[str, object]]:
    tz = reg.timezone
    valves = reg.of_type("valve")
    ids = [str(v["entity_id"]) for v in valves]
    offline = offline_devices(conn)
    positions = {r[0]: (r[1], r[2], int(r[3])) for r in conn.execute("""
        SELECT entity_id,
               (array_agg(state ORDER BY started_at DESC))[1],
               max(started_at),
               count(*) FILTER (WHERE state = 'closed')
          FROM state_spans WHERE metric = 'valve_position' AND entity_id = ANY(%s) GROUP BY entity_id""",
        (ids,)).fetchall()}
    commands = {r[0]: r[1] for r in conn.execute("""
        SELECT DISTINCT ON (target_id) target_id, command_id FROM commands
         WHERE target_kind = 'valve' AND target_id = ANY(%s) ORDER BY target_id, created_at DESC""", (ids,)).fetchall()}
    out = []
    for valve in valves:
        entity_id = str(valve["entity_id"])
        # ★ ยังไม่เคยได้ feedback = ใช้สถานะตั้งต้นของโรงงาน (วาล์วโซนเปิดค้างไว้) — DECISIONS D-28
        position, actuated, cycles = positions.get(entity_id, ("open", None, 0))
        status = "offline" if valve["device_id"] in offline else ("critical" if position == "fault" else "ok")
        seen = actuated
        out.append({
            "id": entity_id, "name": valve["name"], "nameEn": valve["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "zoneId": valve["zone_id"], "position": position,
            "openPercent": 100 if position == "open" else 0 if position == "closed" else 50,
            "remoteEnabled": bool(reg.spec(entity_id).get("remoteEnabled", True)),
            "lastCommandId": str(commands[entity_id]) if entity_id in commands else None,
            "lastActuatedAt": iso_dt(actuated, tz), "cycleCount": cycles, "deviceId": valve["device_id"],
        })
    return out


# ─────────────── มิเตอร์ ───────────────

def _meter_volumes(conn: psycopg.Connection, reg: Registry, meters: list[dict[str, object]],
                   latest: dict[str, Latest | None]) -> dict[str, tuple[float | None, float | None]]:
    now = now_ms()
    today, month = day_start(now, reg.timezone), month_start(now, reg.timezone)
    result = {}
    for meter in meters:
        entity_id = str(meter["entity_id"])
        total = num(latest[entity_id].get("volume_m3"), 4) if latest[entity_id] else None
        result[entity_id] = (counter_since(conn, "meter_telemetry", "volume_m3", entity_id, today, total),
                             counter_since(conn, "meter_telemetry", "volume_m3", entity_id, month, total))
    return result


def build_meters(conn: psycopg.Connection, reg: Registry, include_main: bool = False,
                 only_main: bool = False) -> list[dict[str, object]]:
    tz = reg.timezone
    meters = [m for m in reg.of_type("meter")
              if (bool(reg.spec(str(m["entity_id"])).get("isMain")) == only_main) or (include_main and not only_main)]
    ids = [str(m["entity_id"]) for m in meters]
    latest = latest_many(conn, "meter", ids)
    offline = offline_devices(conn)
    volumes = _meter_volumes(conn, reg, meters, latest)
    out = []
    for meter in meters:
        entity_id = str(meter["entity_id"])
        spec, current = reg.spec(entity_id), latest[entity_id]
        today, month = volumes[entity_id]
        flow = num(current.get("flow_lpm"), 1) if current else None
        thresholds = reg.threshold(entity_id, "flow_lpm")
        status = "offline" if is_offline(meter, current, offline, reg) else status_from_range(flow, thresholds)
        seen = current.recv_time if current else None
        item: dict[str, object] = {
            "id": entity_id, "name": meter["name"], "nameEn": meter["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "pipeSizeInches": spec.get("pipeSizeInches", 1), "flowLpm": required(flow, 1),
            "totalizerCubicMeters": required(current.get("volume_m3") if current else None, 4),
            "todayCubicMeters": required(today, 4), "monthCubicMeters": required(month, 4),
            "pulsesPerLiter": spec.get("pulsesPerLiter", 0), "zoneId": meter["zone_id"],
            "deviceId": meter["device_id"],
        }
        if spec.get("isMain"):
            inlet = num(current.get("inlet_pressure_bar"), 2) if current else None
            item |= {"zoneId": None, "supplierName": spec.get("supplierName", ""),
                     "supplierNameEn": spec.get("supplierNameEn", ""),
                     "supplierMeterNo": spec.get("supplierMeterNo", ""), "inletPressureBar": required(inlet, 2)}
            if status == "ok" and inlet is not None and inlet < 1.8:
                item["status"] = "warning"
        out.append(item)
    return out


# ─────────────── โซน ───────────────

def build_zones(conn: psycopg.Connection, reg: Registry, only: str | None = None) -> list[dict[str, object]]:
    tz = reg.timezone
    zones = [reg.zones[only]] if only and only in reg.zones else [] if only else list(reg.zones.values())
    if only and not zones:
        entity_or_404(reg, only, "zone")
    meters = {str(m["zone_id"]): m for m in reg.of_type("meter") if m["zone_id"] is not None}
    meter_list = [meters[str(z["zone_id"])] for z in zones if str(z["zone_id"]) in meters]
    latest = latest_many(conn, "meter", [str(m["entity_id"]) for m in meter_list])
    offline = offline_devices(conn)
    volumes = _meter_volumes(conn, reg, meter_list, latest)
    leaks = {r[0] for r in conn.execute("""SELECT entity_id FROM alerts
                                            WHERE kind = 'ZONE_LEAK_SUSPECTED' AND ended_at IS NULL""").fetchall()}
    out = []
    for zone in zones:
        zone_id = str(zone["zone_id"])
        meter = meters.get(zone_id)
        meter_id = str(meter["entity_id"]) if meter else ""
        valve = reg.valve_of_zone(zone_id)
        current = latest.get(meter_id) if meter else None
        flow = num(current.get("flow_lpm"), 1) if current else None
        thresholds = reg.threshold(meter_id, "flow_lpm")
        status = "offline" if meter is None or is_offline(meter, current, offline, reg) \
            else status_from_range(flow, thresholds)
        today, month = volumes.get(meter_id, (None, None))
        seen = current.recv_time if current else None
        out.append({
            "id": zone_id, "name": zone["name_th"], "nameEn": zone["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "zoneNumber": zone["zone_number"], "area": zone["area_th"] or "", "areaEn": zone["area_en"] or "",
            "departmentId": zone["department_id"], "meterId": meter_id,
            "valveId": str(valve["entity_id"]) if valve else "", "flowLpm": required(flow, 1),
            "todayCubicMeters": required(today, 4), "monthCubicMeters": required(month, 4),
            "dailyQuotaCubicMeters": num(zone["quota_m3_day"], 2), "thresholdsLpm": thresholds,
            "isVip": bool(zone["is_vip"]), "leakSuspected": zone_id in leaks,
        })
    return out


# ─────────────── ระบบควบคุมแรงดัน ───────────────

def build_pressure_control(conn: psycopg.Connection, reg: Registry) -> dict[str, object]:
    """★ ค่า setpoint/gain อยู่ใน PLC — ตอนนี้แสดงค่าตั้งตอนติดตั้ง (spec) + แรงดันจริงจากปั๊มที่ลูปคุม (D-29)"""
    tz = reg.timezone
    entity = entity_or_404(reg, "pressure-control-1", "pressure_control")
    spec = reg.spec("pressure-control-1")
    pump_id = str(spec.get("controlledPumpId", ""))
    current = latest_many(conn, "pump", [pump_id]).get(pump_id) if pump_id else None
    measured = num(current.get("pressure_bar"), 2) if current else None
    vfd = num(current.get("vfd_hz"), 1) if current else None
    running = bool(current and current.get("run_state") == "running")
    setpoint = float(spec.get("setpointBar", 0))  # type: ignore[arg-type]
    if not running or measured is None:
        status = "offline"
    else:
        deviation = abs(setpoint - measured)
        status = "critical" if deviation > 0.8 else "warning" if deviation > 0.5 else "ok"
    seen = current.recv_time if current else None
    return {
        "id": entity["entity_id"], "name": entity["name"], "nameEn": entity["name_en"], "status": status,
        "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
        "setpointBar": setpoint, "measuredPressureBar": required(measured, 2), "mode": spec.get("mode", "manual"),
        "headcount": None, "headcountUpdatedAt": None,
        "outputPercent": round(vfd / 50 * 100, 1) if running and vfd is not None else 0.0,
        "gains": spec.get("gains", {"kp": 0, "ki": 0, "kd": 0}), "controlledPumpId": pump_id,
        "setpointLimitsBar": spec.get("setpointLimitsBar", {"min": 0, "max": 0}),
    }
