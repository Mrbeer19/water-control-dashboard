"""ประกอบ entity ฝั่งอาคาร/ระบบ — EnvironmentSensor · ElectricNode · Device · Department · User · สรุประบบ"""

from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

from .common import entity_or_404, getter, is_offline, iso_dt, iso_required, now_dt, num, required
from .latest import TABLE_OF, latest_many, offline_devices
from .registry import Registry, natural_key, status_from_range, worst_status
from .series import iso, now_ms, to_dt
from .usage import counter_since, day_start, month_start


def dew_point(temp_c: float | None, humidity: float | None) -> float | None:
    """จุดน้ำค้าง (Magnus) — สูตรเดียวกับ dewPoint() ใน lib/mock/store.ts"""
    if temp_c is None or humidity is None:
        return None
    a, b = 17.27, 237.7
    alpha = a * temp_c / (b + temp_c) + math.log(min(max(humidity, 1), 100) / 100)
    return round(b * alpha / (a - alpha), 1)


# ─────────────── สภาพแวดล้อม ───────────────

def build_sensors(conn: psycopg.Connection, reg: Registry, only: str | None = None) -> list[dict[str, object]]:
    tz = reg.timezone
    sensors = [entity_or_404(reg, only, "sensor")] if only else reg.of_type("sensor")
    ids = [str(s["entity_id"]) for s in sensors]
    latest = latest_many(conn, "sensor", ids)
    offline = offline_devices(conn)
    now = now_ms()
    out = []
    for sensor in sensors:
        entity_id = str(sensor["entity_id"])
        spec, current = reg.spec(entity_id), latest[entity_id]
        get = getter(current)
        temp, humidity = num(get("temp_c"), 1), num(get("humidity_pct"), 1)
        has_rain, has_weather = bool(spec.get("hasRainGauge")), bool(spec.get("hasWeatherSensors"))

        rain_hour = rain_today = rain_month = rain_recent = None
        if has_rain:
            rain = conn.execute("""
                SELECT coalesce(sum(rain_sum) FILTER (WHERE bucket >= %(hour)s), 0),
                       coalesce(sum(rain_sum) FILTER (WHERE bucket >= %(day)s), 0),
                       coalesce(sum(rain_sum), 0),
                       coalesce(sum(rain_sum) FILTER (WHERE bucket >= %(recent)s), 0)
                  FROM env_5m WHERE entity_id = %(id)s AND bucket >= %(month)s""",
                {"id": entity_id, "hour": to_dt(now - 3_600_000), "day": to_dt(day_start(now, tz)),
                 "month": to_dt(month_start(now, tz)), "recent": to_dt(now - 600_000)}).fetchone()
            rain_hour, rain_today, rain_month, rain_recent = (num(v, 2) for v in rain)  # type: ignore[union-attr]

        trend, change = None, None
        pressure = num(get("pressure_hpa"), 1)
        if has_weather and pressure is not None:
            past = conn.execute("""SELECT pressure_sum / NULLIF(pressure_n, 0) FROM env_5m
                                    WHERE entity_id = %s AND bucket <= %s AND pressure_n > 0
                                    ORDER BY bucket DESC LIMIT 1""", (entity_id, to_dt(now - 3 * 3_600_000))).fetchone()
            if past is not None and past[0] is not None:
                change = round(pressure - float(past[0]), 2)
                trend = "rising" if change >= 1 else "falling" if change <= -1 else "steady"

        temp_limits, humidity_limits = reg.threshold(entity_id, "temperature"), reg.threshold(entity_id, "humidity")
        status = "offline" if is_offline(sensor, current, offline, reg) else worst_status(
            [status_from_range(temp, temp_limits), status_from_range(humidity, humidity_limits)])
        seen = current.recv_time if current else None
        out.append({
            "id": entity_id, "name": sensor["name"], "nameEn": sensor["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "location": spec.get("location"), "locationLabel": spec.get("locationLabel", ""),
            "locationLabelEn": spec.get("locationLabelEn", ""),
            "latest": {
                "timestamp": round(current.at.timestamp() * 1000) if current and current.at else 0,
                "temperatureCelsius": required(temp, 1), "humidityPercent": required(humidity, 1),
                "dewPointCelsius": required(dew_point(temp, humidity), 1),
                "heatIndexCelsius": required(get("heat_index_c"), 1),
                # ★ จุดในอาคารไม่มี barometer / light / rain gauge → null ไม่ใช่ 0
                "pressureHpa": pressure if has_weather else None,
                "illuminanceLux": num(get("lux"), 0) if has_weather else None,
                "rainfallMmPerHour": rain_hour, "rainfallTodayMm": rain_today, "rainfallMonthMm": rain_month,
                "rainDetected": (rain_recent or 0) > 0 if has_rain else None,
            },
            "temperatureThresholds": temp_limits, "humidityThresholds": humidity_limits,
            "hasRainGauge": has_rain, "hasWeatherSensors": has_weather,
            "pressureTrend3h": trend, "pressureChange3hHpa": change, "deviceId": sensor["device_id"],
        })
    return out


# ─────────────── ตู้ไฟ ───────────────

TOTAL_PHASE = " AND phase IN ('total', 'single')"
PHASE_VOLTAGE_NOMINAL = 230.0


def build_electric_nodes(conn: psycopg.Connection, reg: Registry, only: str | None = None,
                         department_id: str | None = None) -> list[dict[str, object]]:
    tz = reg.timezone
    nodes = [entity_or_404(reg, only, "electric_node")] if only else reg.of_type("electric_node")
    if department_id is not None:
        nodes = [n for n in nodes if reg.spec(str(n["entity_id"])).get("departmentId") == department_id]
    ids = [str(n["entity_id"]) for n in nodes]
    latest = latest_many(conn, "electric_node", ids)
    offline = offline_devices(conn)
    now = now_ms()
    out = []
    for node in nodes:
        entity_id = str(node["entity_id"])
        spec, current = reg.spec(entity_id), latest[entity_id]
        get = getter(current)
        energy = num(get("energy_kwh"), 3)
        today = counter_since(conn, "power_telemetry", "energy_kwh", entity_id, day_start(now, tz), energy, TOTAL_PHASE)
        month = counter_since(conn, "power_telemetry", "energy_kwh", entity_id, month_start(now, tz), energy,
                              TOTAL_PHASE)
        current_a, voltage = num(get("current"), 2), num(get("voltage"), 1)
        limits = reg.threshold(entity_id, "current_amp")
        if is_offline(node, current, offline, reg):
            status = "offline"
        else:
            # ★ แรงดันที่ส่งเป็นแรงดันเฟส (phase-neutral) — ตกเกิน 10% จาก 230 V ถือว่าเตือน
            low_voltage = voltage is not None and voltage < PHASE_VOLTAGE_NOMINAL * 0.9
            status = worst_status([status_from_range(current_a, limits), "warning" if low_voltage else "ok"])
        seen = current.recv_time if current else None
        out.append({
            "id": entity_id, "name": node["name"], "nameEn": node["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "departmentId": spec.get("departmentId"), "phase": spec.get("phase", "single"),
            "electrical": {"voltage": required(voltage, 1), "current": required(current_a, 2),
                           "powerWatt": required(get("power_w"), 0), "energyKwh": required(energy, 3),
                           "powerFactor": required(get("pf"), 3)},
            "todayEnergyKwh": required(today, 3), "monthEnergyKwh": required(month, 3),
            "breakerRatingAmp": spec.get("breakerRatingAmp", 0), "currentThresholds": limits,
            "panelName": spec.get("panelName", ""), "panelNameEn": spec.get("panelNameEn", ""),
            "deviceId": node["device_id"],
        })
    return out


# ─────────────── อุปกรณ์ ───────────────

def build_devices(conn: psycopg.Connection, reg: Registry, only: str | None = None) -> list[dict[str, object]]:
    tz = reg.timezone
    if only is not None and only not in reg.devices:
        entity_or_404(reg, only, "device")
    devices = [reg.devices[only]] if only else sorted(reg.devices.values(), key=lambda d: natural_key(d["device_id"]))
    ids = [str(d["device_id"]) for d in devices]
    latest = latest_many(conn, "device", ids)
    offline = offline_devices(conn)
    errors = {r[0]: r[1] for r in conn.execute("""
        SELECT DISTINCT ON (entity_id) entity_id, time FROM device_status
         WHERE entity_id = ANY(%s) AND last_error IS NOT NULL AND time > now() - interval '30 days'
         ORDER BY entity_id, time DESC""", (ids,)).fetchall()}
    linked: dict[str, list[str]] = {}
    for entity in reg.entities.values():
        if entity["device_id"] and entity["source_type"] != "device" and entity["active"]:
            linked.setdefault(str(entity["device_id"]), []).append(str(entity["entity_id"]))

    # ข้อความล่าสุดจากอุปกรณ์ใดก็ได้ (telemetry ของ entity ที่อุปกรณ์วัด หรือ status ของตัวเอง)
    # ★ อ่านจากค่าล่าสุดใน Redis ไม่ scan hypertable ย้อนหลังทุกครั้งที่เปิดหน้า Devices
    last_seen: dict[str, datetime] = {}
    for source_type in TABLE_OF:
        members = [e for e in reg.of_type(source_type) if e["device_id"] is not None]
        found = latest_many(conn, source_type, [str(e["entity_id"]) for e in members])
        for member in members:
            item, device_key = found[str(member["entity_id"])], str(member["device_id"])
            if item is not None and item.recv_time is not None and \
                    (device_key not in last_seen or item.recv_time > last_seen[device_key]):
                last_seen[device_key] = item.recv_time

    out = []
    for device in devices:
        device_id = str(device["device_id"])
        current = latest[device_id]
        get = getter(current)
        is_esp32 = device["kind"] == "esp32"
        rssi = num(get("rssi"), 0) if is_esp32 else None
        heap = num(get("free_heap"), 0) if is_esp32 else None
        reconnects = int(get("reconnect_count") or 0)  # type: ignore[call-overload]
        seen = last_seen.get(device_id) or (current.recv_time if current else None)
        if device["kind"] == "gateway":
            status, seen = "ok", now_dt()         # API รันอยู่บน gateway เอง — ตอบได้แปลว่ายังเดินอยู่
        elif device_id in offline or seen is None:
            status = "offline"                    # PLC/HMI จะเป็น offline จนกว่าจะเชื่อมสถานะจาก PLC (D-30)
        elif heap is not None and heap < 40_000 or rssi is not None and rssi < -85:
            status = "critical"
        elif rssi is not None and rssi < -78 or reconnects > 40:
            status = "warning"
        else:
            status = "ok"
        out.append({
            "id": device_id, "name": device["name"], "nameEn": device["name_en"], "status": status,
            "lastSeen": iso_required(seen, tz), "updatedAt": iso_required(seen, tz),
            "kind": device["kind"], "role": device["role"], "model": device["model"] or "",
            "expansionModules": list(device["expansion_modules"] or []), "protocol": device["protocol"],
            "fieldbus": device["fieldbus"], "linkType": device["link_type"],
            "ip": str(device["ip"]) if device["ip"] is not None else "", "vlan": device["vlan"],
            "mac": str(device["mac"]).upper() if device["mac"] is not None else "", "port": device["port"],
            "rssi": rssi, "firmware": device["firmware"] or "", "uptimeSeconds": required(get("uptime_s"), 0),
            "freeHeapBytes": heap, "reconnectCount": reconnects, "lastError": get("last_error"),
            "lastErrorAt": iso_dt(errors.get(device_id), tz),
            "linkedEntityIds": sorted(linked.get(device_id, []), key=natural_key),
            "location": device["location"] or "", "locationEn": device["location_en"] or "",
        })
    return out


def device_summary(devices: list[dict[str, object]]) -> dict[str, int]:
    return {"total": len(devices), "online": sum(d["status"] == "ok" for d in devices),
            "warning": sum(d["status"] in ("warning", "critical") for d in devices),
            "offline": sum(d["status"] == "offline" for d in devices)}


# ─────────────── องค์กร ───────────────

def build_departments(reg: Registry) -> list[dict[str, object]]:
    return [{"id": d["department_id"], "name": d["name"], "nameEn": d["name_en"],
             "costCenterCode": d["cost_center_code"] or "", "managerUserId": d["manager_user_id"],
             "active": bool(d["active"])}
            for d in sorted(reg.departments.values(), key=lambda d: natural_key(d["department_id"]))]


def build_users(conn: psycopg.Connection) -> list[dict[str, object]]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT user_id, display_name, role, department_id, active FROM users ORDER BY user_id")
        return [{"id": r["user_id"], "displayName": r["display_name"], "role": r["role"],
                 "departmentId": r["department_id"], "active": bool(r["active"])} for r in cur.fetchall()]


# ─────────────── บริการเบื้องหลัง ───────────────

def _http_json(url: str, timeout: float = 1.5) -> tuple[dict[str, object] | None, float | None]:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read()), round((time.perf_counter() - started) * 1000, 1)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None, None


def ingest_metrics() -> tuple[dict[str, object] | None, float | None]:
    return _http_json(os.environ.get("INGEST_URL", "http://ingest:8080") + "/metrics")


def connection_status(conn: psycopg.Connection, reg: Registry) -> dict[str, object]:
    tz = reg.timezone
    metrics, latency = ingest_metrics()
    last = conn.execute("""
        SELECT max(recv_time) FROM (
          SELECT max(recv_time) AS recv_time FROM meter_telemetry WHERE time > now() - interval '1 hour'
          UNION ALL SELECT max(recv_time) FROM pump_telemetry WHERE time > now() - interval '1 hour'
        ) t""").fetchone()
    offline = offline_devices(conn)
    return {"online": bool(metrics and metrics.get("mqtt_connected")),
            "lastSyncAt": iso_required(last[0] if last else None, tz),
            # ★ เวลาไป-กลับถึงบริการรับข้อมูลบน gateway (ไม่ใช่ flush lag ของ batch writer)
            "latencyMs": round(latency) if latency is not None else 0,
            "offlineDeviceCount": sum(1 for d in reg.devices.values() if d["device_id"] in offline and d["active"])}


def service_health(conn: psycopg.Connection, reg: Registry) -> list[dict[str, object]]:
    tz = reg.timezone
    at = iso(now_ms(), tz)
    network = reg.settings.get("network", {})
    gateway = network.get("gatewayHost", "")
    metrics, ingest_latency = ingest_metrics()

    started = time.perf_counter()
    conn.execute("SELECT 1")
    db_latency = round((time.perf_counter() - started) * 1000, 1)

    mqtt_ok = bool(metrics and metrics.get("mqtt_connected"))
    offline_count = len(offline_devices(conn))
    ai_status, ai_latency = _http_json(os.environ.get("AI_URL", "http://ai:9000") + "/health")
    return [
        {"kind": "mqtt_broker", "name": "MQTT Broker", "nameEn": "MQTT Broker",
         "status": "ok" if mqtt_ok else "critical",
         "endpoint": f"{network.get('mqttHost', '')}:{network.get('mqttPort', '')}", "latencyMs": None,
         "lastCheckedAt": at, "message": None if mqtt_ok else "ingest ติดต่อ broker ไม่ได้",
         "detail": {"topic": str(network.get("mqttBaseTopic", ""))}},
        {"kind": "database", "name": "ฐานข้อมูล", "nameEn": "Database", "status": "ok",
         "endpoint": f"{network.get('databaseHost', gateway)}:{network.get('databasePort', 5432)}",
         "latencyMs": db_latency, "lastCheckedAt": at, "message": None,
         "detail": {"retention": f"{reg.setting('maintenance', 'dataRetentionDays', '')} วัน"}},
        {"kind": "ingest", "name": "บริการรับข้อมูล", "nameEn": "Ingest Service",
         "status": "critical" if metrics is None
         else "warning" if offline_count or metrics.get("spool_bytes") else "ok",
         "endpoint": f"{gateway}:8080", "latencyMs": ingest_latency, "lastCheckedAt": at,
         "message": "ติดต่อบริการรับข้อมูลไม่ได้" if metrics is None
         else f"มีอุปกรณ์ {offline_count} ตัวที่ไม่ส่งข้อมูลเข้ามา" if offline_count else None,
         "detail": None if metrics is None else {
             "rows/s": float(metrics.get("rows_per_second_10s") or 0),  # type: ignore[arg-type]
             "lagMs": float(metrics.get("max_flush_lag_ms_1m") or 0),  # type: ignore[arg-type]
             "spoolBytes": int(metrics.get("spool_bytes") or 0)}},  # type: ignore[call-overload]
        {"kind": "ai", "name": "บริการ AI", "nameEn": "AI Service",
         "status": "ok" if ai_status is not None else "offline",
         "endpoint": f"{gateway}:9000", "latencyMs": ai_latency, "lastCheckedAt": at,
         "message": None if ai_status is not None else "ยังติดต่อบริการ AI ไม่ได้",
         "detail": {"model": str(reg.setting("ai", "anomalyModelName", ""))}},
    ]


def alert_counts(conn: psycopg.Connection) -> tuple[int, int, int]:
    row = conn.execute("""
        SELECT count(*) FILTER (WHERE read_at IS NULL),
               count(*) FILTER (WHERE read_at IS NULL AND severity = 'critical'),
               (SELECT count(*) FROM ai_anomalies WHERE coalesce(status, 'active') = 'active'
                                                  AND detected_at > now() - interval '24 hours')
          FROM alerts WHERE ended_at IS NULL""").fetchone()
    return int(row[0]), int(row[1]), int(row[2])  # type: ignore[index]


def utc_now_iso(reg: Registry) -> str:
    return iso_required(now_dt(), reg.timezone)
