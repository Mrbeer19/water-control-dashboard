"""ค่าตั้งระบบ (PROMPT_04 งานที่ 4)

ต้นทางความจริง — ไม่เก็บซ้ำสองที่ (D-26):
  general network notifications ai maintenance security · tanks pumps zones environment line → ตาราง settings
  thresholds → ตาราง thresholds (ingest ใช้ตรวจเกณฑ์จริง · อ่านใหม่ทุก 60 วินาที)
  billing.tiers · serviceCharge · vat · ค่าไฟ → ตาราง tariffs (เก็บประวัติ มีผลตั้งแต่วันที่บันทึก)

★ validate_settings() พอร์ตตรงตัวจาก validateSettings() ใน lib/services/settings.ts
  ผลต้องตรงกับค่าอ้างอิงที่สร้างจากไฟล์ .ts จริง (tests/test_settings_parity.py) · กฎเฉพาะเซิร์ฟเวอร์อยู่ใน server_errors()
★ LINE Channel Access Token ไม่เคยถูกส่งกลับ — ส่ง "••••" + 4 ตัวท้าย · ได้ค่า mask หรือค่าว่างกลับมา = ไม่ทับของเดิม
"""

from __future__ import annotations

import copy
import json
import re
import socket
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Jsonb

from .alerts import CHANNELS, SEVERITIES
from .common import iso_required
from .errors import ApiException, not_found
from .registry import EMPTY_RANGE, Registry, invalidate, registry
from .series import iso, now_ms
from .usage import tariff, water_tiers

FIXED_SECTIONS = ("general", "thresholds", "network", "notifications", "billing", "ai", "maintenance", "security")
DEVICE_SECTIONS = ("tanks", "pumps", "zones", "environment")
SECTIONS = (*FIXED_SECTIONS, *DEVICE_SECTIONS, "line")
ROW_SECTIONS = ("general", "network", "notifications", "ai", "maintenance", "security")
ROLES = ("viewer", "operator", "admin")
MASK = "••••"
LINE_TOKEN_KEY = "line.channelAccessToken"
TOKEN_FIELD = "channelAccessTokenMasked"

# field ที่เป็น null ได้ตามสัญญา (ชื่อ field ใบสุดท้ายของเส้นทาง)
NULLABLE_FIELDS = frozenset({"criticalLow", "warningLow", "warningHigh", "criticalHigh", "maxCubicMeters",
                             "secondaryPlcHost", "secondaryPlcPort", "monthlyQuotaCubicMeters", "rainGaugeMmPerTip",
                             "destinationTankId"})
# field ที่เป็น optional ใน lib/types.ts — ไม่ส่งมาก็ได้
OPTIONAL_FIELDS = frozenset({"general.temperatureUnit", "network.databaseHost", "network.databasePort",
                             "ai.nightFlowStartTime", "ai.nightFlowEndTime"})
HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d")
HOST = re.compile(r"[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*")
LINE_GROUP = re.compile(r"C[0-9a-f]{32}", re.IGNORECASE)


def err(path: str, message_th: str, message_en: str) -> dict[str, str]:
    return {"path": path, "messageTh": message_th, "messageEn": message_en}


# ─────────────── กฎชุดเดียวกับหน้าจอ (พอร์ตจาก validateSettings) ───────────────

def is_valid_host(host: str) -> bool:
    trimmed = host.strip()
    return trimmed != "" and HOST.fullmatch(trimmed) is not None


def validate_settings(s: dict) -> list[dict[str, str]]:  # noqa: C901 — ลำดับกฎต้องตรงกับไฟล์ .ts ทีละบรรทัด
    errors: list[dict[str, str]] = []
    general = s["general"]
    if general["siteName"].strip() == "":
        errors.append(err("general.siteName", "ต้องระบุชื่อโรงงาน", "Site name is required"))
    if general["refreshIntervalMs"] < 500:
        errors.append(err("general.refreshIntervalMs", "ความถี่รีเฟรชต้องไม่ต่ำกว่า 500 ms",
                          "Refresh interval must be at least 500 ms"))

    for tank in s.get("tanks") or []:
        tid = tank["tankId"]
        if tank["capacityLiters"] <= 0:
            errors.append(err(f"tanks.{tid}.capacityLiters", "ความจุต้องมากกว่า 0", "Capacity must be greater than 0"))
        if tank["pumpAutoStopPercent"] <= tank["pumpAutoStartPercent"]:
            errors.append(err(f"tanks.{tid}.pumpAutoStopPercent",
                              "ระดับหยุดปั๊มต้องสูงกว่าระดับเริ่มปั๊ม ไม่งั้นปั๊มจะเดิน-หยุดถี่จนไหม้",
                              "Stop level must be above start level, otherwise the pump will short-cycle"))
        if tank["sensorScale"] <= 0:
            errors.append(err(f"tanks.{tid}.sensorScale", "ตัวคูณสเกลต้องมากกว่า 0", "Sensor scale must be greater than 0"))

    for pump in s.get("pumps") or []:
        pid = pump["pumpId"]
        if pump["nameplateKw"] <= 0:
            errors.append(err(f"pumps.{pid}.nameplateKw", "กำลังไฟฟ้าต้องมากกว่า 0", "Rated power must be greater than 0"))
        if pump["overcurrentAmp"] <= 0:
            errors.append(err(f"pumps.{pid}.overcurrentAmp", "เกณฑ์กระแสเกินต้องมากกว่า 0",
                              "Overcurrent limit must be greater than 0"))
        if pump["maxRunMinutes"] < 0:
            errors.append(err(f"pumps.{pid}.maxRunMinutes", "เวลาเดินสูงสุดติดลบไม่ได้",
                              "Maximum run time cannot be negative"))

    for zone in s.get("zones") or []:
        zid = zone["zoneId"]
        if zone["kFactor"] <= 0:
            errors.append(err(f"zones.{zid}.kFactor", "K-factor ต้องมากกว่า 0", "K-factor must be greater than 0"))
        if zone["monthlyQuotaCubicMeters"] is not None and zone["monthlyQuotaCubicMeters"] < 0:
            errors.append(err(f"zones.{zid}.monthlyQuotaCubicMeters", "โควตาติดลบไม่ได้", "Quota cannot be negative"))

    billing = s["billing"]
    tiers = billing["tiers"]
    if len(tiers) == 0:
        errors.append(err("billing.tiers", "ต้องมีขั้นอัตราอย่างน้อย 1 ขั้น", "At least one tariff tier is required"))
    for index, tier in enumerate(tiers):
        if tier["ratePerCubicMeter"] < 0:
            errors.append(err(f"billing.tiers.{index}.rate", "อัตราค่าน้ำติดลบไม่ได้", "Rate cannot be negative"))
        if tier["maxCubicMeters"] is not None and tier["maxCubicMeters"] <= tier["minCubicMeters"]:
            errors.append(err(f"billing.tiers.{index}.max", "ขอบบนต้องมากกว่าขอบล่างของขั้น",
                              "Upper bound must be above the lower bound"))
        previous = tiers[index - 1] if index > 0 else None
        if previous is not None and previous["maxCubicMeters"] is not None \
                and tier["minCubicMeters"] != previous["maxCubicMeters"]:
            errors.append(err(f"billing.tiers.{index}.min", "ขั้นอัตราต้องต่อกันพอดี ไม่เว้นช่องและไม่ทับกัน",
                              "Tiers must meet exactly, with no gap or overlap"))
    if billing["vatPercent"] < 0 or billing["vatPercent"] > 100:
        errors.append(err("billing.vatPercent", "VAT ต้องอยู่ระหว่าง 0–100", "VAT must be between 0 and 100"))
    if billing["billingCycleStartDay"] < 1 or billing["billingCycleStartDay"] > 28:
        errors.append(err("billing.billingCycleStartDay", "วันเริ่มรอบบิลต้องอยู่ระหว่าง 1–28 เพื่อให้มีทุกเดือน",
                          "Cycle start day must be 1–28 so it exists in every month"))
    if billing["meterReadingDay"] < 1 or billing["meterReadingDay"] > 28:
        errors.append(err("billing.meterReadingDay", "วันจดมิเตอร์ต้องอยู่ระหว่าง 1–28", "Reading day must be 1–28"))

    if s["ai"]["anomalySensitivity"] < 0 or s["ai"]["anomalySensitivity"] > 1:
        errors.append(err("ai.anomalySensitivity", "ความไวต้องอยู่ระหว่าง 0–1", "Sensitivity must be between 0 and 1"))

    network = s["network"]
    if not is_valid_host(network["mqttHost"]):
        errors.append(err("network.mqttHost", "รูปแบบ host ไม่ถูกต้อง", "Invalid host format"))
    if network["mqttPort"] < 1 or network["mqttPort"] > 65535:
        errors.append(err("network.mqttPort", "พอร์ตต้องอยู่ระหว่าง 1–65535", "Port must be between 1 and 65535"))
    if network["plcPort"] < 1 or network["plcPort"] > 65535:
        errors.append(err("network.plcPort", "พอร์ตต้องอยู่ระหว่าง 1–65535", "Port must be between 1 and 65535"))

    for sensor in s.get("environment") or []:
        sid = sensor["sensorId"]
        if sensor["locationLabel"].strip() == "":
            errors.append(err(f"environment.{sid}.locationLabel", "ต้องระบุชื่อจุดติดตั้ง", "Location name is required"))
        if sensor["rainGaugeMmPerTip"] is not None and sensor["rainGaugeMmPerTip"] <= 0:
            errors.append(err(f"environment.{sid}.rainGaugeMmPerTip", "ค่าต่อการกระดกต้องมากกว่า 0",
                              "Value per tip must be greater than 0"))

    line = s.get("line")
    if line is not None and line["enabled"]:
        if len([group for group in line["groups"] if group["active"]]) == 0:
            errors.append(err("line.groups", "ต้องมีกลุ่มที่เปิดใช้งานอย่างน้อย 1 กลุ่ม",
                              "At least one active group is required"))
        for group in line["groups"]:
            if LINE_GROUP.fullmatch(group["groupId"]) is None:
                errors.append(err(f"line.groups.{group['id']}.groupId",
                                  "LINE group id ต้องขึ้นต้นด้วย C ตามด้วยตัวอักษร 32 ตัว",
                                  "LINE group id must start with C followed by 32 characters"))
        if line["debounceSeconds"] < 0:
            errors.append(err("line.debounceSeconds", "ช่วงกันส่งซ้ำติดลบไม่ได้", "Debounce cannot be negative"))
        for severity in ("critical", "warning", "info"):
            for group_id in line["severityRouting"][severity]:
                if not any(group["id"] == group_id for group in line["groups"]):
                    errors.append(err(f"line.severityRouting.{severity}", "มีการส่งไปยังกลุ่มที่ถูกลบไปแล้ว",
                                      "Routes to a group that no longer exists"))
    return errors


# ─────────────── กฎเฉพาะเซิร์ฟเวอร์ ───────────────

def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def shape_errors(path: str, value: object, reference: object) -> list[dict[str, str]]:
    """ชนิดข้อมูลต้องตรงกับค่าปัจจุบัน · ห้ามมีฟิลด์ที่ไม่รู้จัก · ห้ามขาดฟิลด์ที่บังคับ"""
    leaf = path.rsplit(".", 1)[-1]
    if reference is None:
        return []
    if value is None:
        return [] if leaf in NULLABLE_FIELDS else [err(path, "ห้ามเว้นว่าง", "Value is required")]
    if isinstance(reference, dict):
        if not isinstance(value, dict):
            return [err(path, "ต้องเป็นกลุ่มค่า (object)", "Must be an object")]
        errors = [err(f"{path}.{key}", "ไม่รู้จักฟิลด์นี้", "Unknown field") for key in value if key not in reference]
        for key, ref in reference.items():
            if key in value:
                errors += shape_errors(f"{path}.{key}", value[key], ref)
            elif f"{path}.{key}" not in OPTIONAL_FIELDS:
                errors.append(err(f"{path}.{key}", "ขาดฟิลด์นี้", "Field is missing"))
        return errors
    if isinstance(reference, list):
        if not isinstance(value, list):
            return [err(path, "ต้องเป็นรายการ (array)", "Must be an array")]
        return [] if not reference else [e for i, item in enumerate(value)
                                          for e in shape_errors(f"{path}.{i}", item, reference[0])]
    if isinstance(reference, bool):
        ok = isinstance(value, bool)
    elif _is_number(reference):
        ok = _is_number(value)
    else:
        ok = isinstance(value, str)
    kind = "true/false" if isinstance(reference, bool) else "ตัวเลข" if _is_number(reference) else "ข้อความ"
    kind_en = "a boolean" if isinstance(reference, bool) else "a number" if _is_number(reference) else "text"
    return [] if ok else [err(path, f"ต้องเป็น{kind}", f"Must be {kind_en}")]


def _ranges(t: dict) -> list[tuple[str, dict]]:
    found = [(f"thresholds.{group}.{key}", rng) for group in ("tankLevelPercent", "zoneFlowLpm", "electricCurrentAmp")
             for key, rng in t[group].items()]
    return found + [(f"thresholds.{key}", t[key])
                    for key in ("pumpPressureBar", "pumpCurrentAmp", "temperatureCelsius", "humidityPercent")]


def timezone_errors(tz: object, aggregate_tz: str | None) -> list[dict[str, str]]:
    path = "general.timezone"
    try:
        zone = ZoneInfo(str(tz))
    except (KeyError, ValueError):
        return [err(path, f"ไม่รู้จักเขตเวลา {tz}", f"Unknown timezone {tz}")]
    year = datetime.now().year
    for month in range(1, 13):
        offset = datetime(year, month, 1, 12, tzinfo=zone).utcoffset()
        if offset is not None and offset.total_seconds() % 3600 != 0:
            return [err(path, f"เขตเวลา {tz} มี offset ไม่ใช่ชั่วโมงเต็ม ขอบช่วงของกราฟสองฝั่งจะไม่ตรงกัน (P-11)",
                        f"Timezone {tz} has a non whole-hour offset; chart bucket edges would disagree (P-11)")]
    if aggregate_tz is not None and tz != aggregate_tz:
        return [err(path, f"ข้อมูลรวมของกราฟสร้างด้วยเขตเวลา {aggregate_tz} — เปลี่ยนเขตเวลาต้องสร้างข้อมูลรวมใหม่ก่อน",
                    f"Chart aggregates were built for {aggregate_tz}; rebuild them before changing the timezone")]
    return []


def server_errors(s: dict, aggregate_tz: str | None) -> list[dict[str, str]]:
    errors = timezone_errors(s["general"]["timezone"], aggregate_tz)
    unit = s["general"].get("temperatureUnit", "celsius")
    if unit not in ("celsius", "fahrenheit"):
        errors.append(err("general.temperatureUnit", "หน่วยอุณหภูมิไม่ถูกต้อง", "Invalid temperature unit"))

    notifications = s["notifications"]
    for path, value in (("notifications.minimumSeverity", notifications["minimumSeverity"]),
                        ("notifications.quietHours.overrideSeverity", notifications["quietHours"]["overrideSeverity"])):
        if value not in SEVERITIES:
            errors.append(err(path, "ระดับความรุนแรงไม่ถูกต้อง", "Invalid severity"))
    for channel in notifications["enabledChannels"]:
        if channel not in CHANNELS:
            errors.append(err("notifications.enabledChannels", f"ไม่รู้จักช่องทาง {channel}", f"Unknown channel {channel}"))
    for key in ("escalationAfterMinutes", "deduplicationWindowMinutes"):
        value = notifications[key]
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            errors.append(err(f"notifications.{key}", "ต้องเป็นจำนวนเต็มนาทีที่ไม่ติดลบ",
                              "Must be a non-negative whole number"))

    times = [("notifications.quietHours.startTime", notifications["quietHours"]["startTime"]),
             ("notifications.quietHours.endTime", notifications["quietHours"]["endTime"]),
             ("maintenance.backupTime", s["maintenance"]["backupTime"])]
    times += [(f"ai.{key}", s["ai"][key]) for key in ("nightFlowStartTime", "nightFlowEndTime") if key in s["ai"]]
    for path, value in times:
        if not isinstance(value, str) or HHMM.fullmatch(value) is None:
            errors.append(err(path, "เวลาต้องอยู่ในรูปแบบ HH:mm", "Time must be HH:mm"))

    security = s["security"]
    if security["minimumRoleForControl"] not in ROLES:
        errors.append(err("security.minimumRoleForControl", "บทบาทไม่ถูกต้อง", "Invalid role"))
    minutes = security["sessionTimeoutMinutes"]
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= 1440:
        errors.append(err("security.sessionTimeoutMinutes", "ต้องเป็นจำนวนเต็ม 1–1440 นาที",
                          "Must be a whole number between 1 and 1440"))

    network = s["network"]
    if network["deviceTimeoutSeconds"] < 1:
        errors.append(err("network.deviceTimeoutSeconds", "ต้องมากกว่า 0 วินาที", "Must be greater than 0"))
    for key in ("secondaryPlcPort", "databasePort"):
        port = network.get(key)
        if port is not None and not 1 <= port <= 65535:
            errors.append(err(f"network.{key}", "พอร์ตต้องอยู่ระหว่าง 1–65535", "Port must be between 1 and 65535"))

    thresholds = s["thresholds"]
    for path, rng in _ranges(thresholds):
        ordered = [rng[k] for k in ("criticalLow", "warningLow", "warningHigh", "criticalHigh") if rng[k] is not None]
        if ordered != sorted(ordered):
            errors.append(err(path, "เกณฑ์ต้องเรียง วิกฤตต่ำ ≤ เตือนต่ำ ≤ เตือนสูง ≤ วิกฤตสูง",
                              "Thresholds must be ordered critical low ≤ warning low ≤ warning high ≤ critical high"))
    if thresholds["unaccountedWarningPercent"] > thresholds["unaccountedCriticalPercent"]:
        errors.append(err("thresholds.unaccountedCriticalPercent", "เกณฑ์วิกฤตต้องไม่ต่ำกว่าเกณฑ์เตือน",
                          "Critical must not be below warning"))
    return errors


def check(conn: psycopg.Connection, merged: dict, reference: dict) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    for section in FIXED_SECTIONS:
        errors += shape_errors(section, merged.get(section), reference.get(section))
    if errors:
        return errors            # โครงสร้างผิด ตรวจกฎต่อไม่ได้อย่างมีความหมาย
    row = conn.execute("SELECT timezone FROM aggregate_config").fetchone()
    try:
        return validate_settings(merged) + server_errors(merged, row[0] if row else None)
    except (KeyError, TypeError, AttributeError, IndexError) as exc:
        return [err("file", "โครงสร้างค่าตั้งค่าไม่ถูกต้อง", f"Settings structure is invalid ({type(exc).__name__}: {exc})")]


def invalid(errors: list[dict[str, str]]) -> ApiException:
    """★ details ของ ApiError เป็น map แบนเท่านั้น — เส้นทางฟิลด์ → ข้อความไทย (หลายข้อความในฟิลด์เดียวต่อกันด้วย ·)"""
    details: dict[str, str | int | float | bool | None] = {}
    for item in errors:
        path = item["path"]
        details[path] = f"{details[path]} · {item['messageTh']}" if path in details else item["messageTh"]
    first = errors[0]
    return ApiException(400, "SETTINGS_INVALID", f"ค่าตั้งไม่ผ่านการตรวจ {len(errors)} รายการ — {first['messageTh']}",
                        f"{len(errors)} settings error(s) — {first['messageEn']}", details)


# ─────────────── อ่าน ───────────────

def masked(token: str | None) -> str:
    return "" if not token else MASK + token[-4:]


def compose_thresholds(reg: Registry) -> dict[str, object]:
    def first(source_type: str, metric: str) -> dict[str, float | None]:
        items = reg.of_type(source_type)
        return reg.threshold(str(items[0]["entity_id"]), metric) if items else dict(EMPTY_RANGE)

    zones = {}
    for zone_id in reg.zones:
        meter = reg.meter_of_zone(zone_id)
        if meter is not None:
            zones[zone_id] = reg.threshold(str(meter["entity_id"]), "flow_lpm")
    plant = reg.threshold("plant", "unaccounted_percent")
    return {
        "tankLevelPercent": {str(t["entity_id"]): reg.threshold(str(t["entity_id"]), "level_percent")
                             for t in reg.of_type("tank")},
        "zoneFlowLpm": zones,
        "electricCurrentAmp": {str(n["entity_id"]): reg.threshold(str(n["entity_id"]), "current_amp")
                               for n in reg.of_type("electric_node")},
        "pumpPressureBar": first("pump", "pressure_bar"), "pumpCurrentAmp": first("pump", "current_amp"),
        "temperatureCelsius": first("sensor", "temperature"), "humidityPercent": first("sensor", "humidity"),
        "unaccountedWarningPercent": plant["warningHigh"] or 0,
        "unaccountedCriticalPercent": plant["criticalHigh"] or 0,
    }


def compose_billing(conn: psycopg.Connection, reg: Registry) -> dict[str, object]:
    now = now_ms()
    water = tariff(conn, "water", now, reg.timezone) or {}
    electricity = tariff(conn, "electricity", now, reg.timezone) or {}
    row = reg.settings.get("billing", {})
    return {"currency": row.get("currency", "THB"), "tiers": water_tiers(water),
            "serviceChargeBaht": water.get("service_charge", 0), "vatPercent": water.get("vat_percent", 0),
            "billingCycleStartDay": row.get("billingCycleStartDay", 1),
            "meterReadingDay": row.get("meterReadingDay", 1),
            "electricityRatePerKwh": electricity.get("rate_per_kwh", 0),
            "electricityFtPerKwh": electricity.get("ft_per_kwh", 0)}


def actor_of(conn: psycopg.Connection, user_id: str | None) -> dict[str, object]:
    row = conn.execute("SELECT display_name, role FROM users WHERE user_id = %s", (user_id,)).fetchone() \
        if user_id else None
    if row is None:
        return {"userId": user_id or "system", "displayName": "ระบบ", "role": "admin"}
    return {"userId": user_id, "displayName": row[0], "role": row[1]}


def load_settings(conn: psycopg.Connection, reg: Registry, export: bool = False) -> dict[str, object]:
    rows = reg.settings
    s: dict[str, object] = {section: copy.deepcopy(rows[section]) for section in ROW_SECTIONS if section in rows}
    s["thresholds"] = compose_thresholds(reg)
    s["billing"] = compose_billing(conn, reg)
    for section in DEVICE_SECTIONS:
        if section in rows:
            s[section] = copy.deepcopy(rows[section])
    # ★ สำเนาเกณฑ์ในหมวดรายอุปกรณ์ต้องตรงกับตาราง thresholds เสมอ (ต้นทางเดียว)
    for tank in s.get("tanks") or []:  # type: ignore[attr-defined]
        tank["thresholdsPercent"] = reg.threshold(tank.get("tankId", ""), "level_percent")
    for sensor in s.get("environment") or []:  # type: ignore[attr-defined]
        sensor["temperatureThresholds"] = reg.threshold(sensor.get("sensorId", ""), "temperature")
        sensor["humidityThresholds"] = reg.threshold(sensor.get("sensorId", ""), "humidity")
    if "line" in rows:
        token = conn.execute("SELECT value FROM settings_secrets WHERE key = %s", (LINE_TOKEN_KEY,)).fetchone()
        s["line"] = {**copy.deepcopy(rows["line"]), TOKEN_FIELD: "" if export else masked(token[0] if token else None)}

    change = conn.execute("""SELECT at, user_id FROM audit_log
                              WHERE action IN ('settings_update', 'settings_reset', 'settings_import')
                              ORDER BY at DESC LIMIT 1""").fetchone()
    if change is None and reg.settings_updated:
        change = max(reg.settings_updated.values(), key=lambda item: item[0])  # type: ignore[arg-type, return-value]
    s["updatedAt"] = iso_required(change[0] if change else None, reg.timezone)  # type: ignore[arg-type]
    s["updatedBy"] = actor_of(conn, change[1] if change else None)  # type: ignore[arg-type]
    return s


# ─────────────── เขียน ───────────────

def _upsert_row(conn: psycopg.Connection, section: str, value: object, user_id: str) -> None:
    conn.execute("""INSERT INTO settings (section, value, updated_at, updated_by) VALUES (%s, %s, now(), %s)
                    ON CONFLICT (section) DO UPDATE
                    SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by""",
                 (section, Jsonb(value), user_id))


def _upsert_threshold(conn: psycopg.Connection, entity_id: str, metric: str, rng: dict) -> None:
    conn.execute("""INSERT INTO thresholds (entity_id, metric, crit_low, warn_low, warn_high, crit_high)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (entity_id, metric) DO UPDATE SET crit_low = EXCLUDED.crit_low,
                        warn_low = EXCLUDED.warn_low, warn_high = EXCLUDED.warn_high, crit_high = EXCLUDED.crit_high""",
                 (entity_id, metric, rng["criticalLow"], rng["warningLow"], rng["warningHigh"], rng["criticalHigh"]))


def _write_thresholds(conn: psycopg.Connection, reg: Registry, t: dict) -> None:
    for tank_id, rng in t["tankLevelPercent"].items():
        _upsert_threshold(conn, tank_id, "level_percent", rng)
    for zone_id, rng in t["zoneFlowLpm"].items():
        meter = reg.meter_of_zone(zone_id)
        if meter is not None:
            _upsert_threshold(conn, str(meter["entity_id"]), "flow_lpm", rng)
    for node_id, rng in t["electricCurrentAmp"].items():
        _upsert_threshold(conn, node_id, "current_amp", rng)
    for pump in reg.of_type("pump"):
        _upsert_threshold(conn, str(pump["entity_id"]), "pressure_bar", t["pumpPressureBar"])
        _upsert_threshold(conn, str(pump["entity_id"]), "current_amp", t["pumpCurrentAmp"])
    for sensor in reg.of_type("sensor"):
        _upsert_threshold(conn, str(sensor["entity_id"]), "temperature", t["temperatureCelsius"])
        _upsert_threshold(conn, str(sensor["entity_id"]), "humidity", t["humidityPercent"])
    _upsert_threshold(conn, "plant", "unaccounted_percent", {
        "criticalLow": None, "warningLow": None,
        "warningHigh": t["unaccountedWarningPercent"], "criticalHigh": t["unaccountedCriticalPercent"]})


def _write_tariff(conn: psycopg.Connection, reg: Registry, kind: str, config: dict) -> None:
    """★ ไม่ทับอัตราเก่า — เพิ่มแถวที่มีผลตั้งแต่วันนี้ รายงานย้อนหลังยังคิดด้วยอัตรา ณ วันนั้น"""
    if tariff(conn, kind, now_ms(), reg.timezone) == config:
        return
    today = datetime.now(ZoneInfo(reg.timezone)).date()
    conn.execute("""INSERT INTO tariffs (kind, effective_from, config) VALUES (%s, %s, %s)
                    ON CONFLICT (kind, effective_from) DO UPDATE SET config = EXCLUDED.config""",
                 (kind, today, Jsonb(config)))


def _write_billing(conn: psycopg.Connection, reg: Registry, b: dict, user_id: str) -> None:
    _upsert_row(conn, "billing", {"currency": b["currency"], "billingCycleStartDay": b["billingCycleStartDay"],
                                  "meterReadingDay": b["meterReadingDay"]}, user_id)
    _write_tariff(conn, reg, "water", {
        "tiers": [{"min_m3": t["minCubicMeters"], "max_m3": t["maxCubicMeters"], "rate": t["ratePerCubicMeter"]}
                  for t in b["tiers"]],
        "service_charge": b["serviceChargeBaht"], "vat_percent": b["vatPercent"]})
    _write_tariff(conn, reg, "electricity", {"rate_per_kwh": b["electricityRatePerKwh"],
                                             "ft_per_kwh": b["electricityFtPerKwh"]})


def _write_line(conn: psycopg.Connection, line: dict, user_id: str) -> None:
    token = line.get(TOKEN_FIELD)
    _upsert_row(conn, "line", {k: v for k, v in line.items() if k != TOKEN_FIELD}, user_id)
    if isinstance(token, str) and token.strip() and not token.startswith(MASK[0]):
        conn.execute("""INSERT INTO settings_secrets (key, value, updated_by) VALUES (%s, %s, %s)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(),
                                                        updated_by = EXCLUDED.updated_by""",
                     (LINE_TOKEN_KEY, token.strip(), user_id))


def _apply(conn: psycopg.Connection, reg: Registry, merged: dict, sections: list[str], user_id: str) -> None:
    for section in sections:
        if section == "thresholds":
            _write_thresholds(conn, reg, merged[section])
        elif section == "billing":
            _write_billing(conn, reg, merged[section], user_id)
        elif section == "line":
            _write_line(conn, merged[section], user_id)
        else:
            _upsert_row(conn, section, merged[section], user_id)


def _redacted(value: object) -> str:
    if isinstance(value, dict) and TOKEN_FIELD in value:
        value = {**value, TOKEN_FIELD: "(ซ่อน)"}
    return json.dumps(value, ensure_ascii=False, default=str)


def _audit(conn: psycopg.Connection, user_id: str, action: str, target: str, old: object, new: object) -> None:
    conn.execute("""INSERT INTO audit_log (user_id, action, target, old_value, new_value, result)
                    VALUES (%s, %s, %s, %s, %s, 'ok')""", (user_id, action, target, _redacted(old), _redacted(new)))


def patch_section(conn: psycopg.Connection, section: str, patch: object, user_id: str) -> dict[str, object]:
    if section not in SECTIONS:
        raise not_found("SETTINGS_SECTION_NOT_FOUND", f"ไม่มีหมวดค่าตั้ง {section}", f"Unknown settings section {section}",
                        section=section)
    reg = registry(conn, fresh=True)
    current = load_settings(conn, reg)
    existing = current.get(section)
    # อาเรย์และหมวดที่ยังไม่เคยบันทึก = แทนทั้งก้อน · object = รวมเฉพาะ key ที่ส่งมา (เหมือน updateSettingsSection)
    if isinstance(existing, dict) and isinstance(patch, dict):
        value: object = {**existing, **patch}
    else:
        value = patch
    merged = {**current, section: value}
    errors = [e for e in check(conn, merged, current)
              if e["path"] in (section, "file") or e["path"].startswith(f"{section}.")]
    if errors:
        raise invalid(errors)
    with conn.transaction():
        _apply(conn, reg, merged, [section], user_id)
        _audit(conn, user_id, "settings_update", section, existing, value)
    invalidate()
    return load_settings(conn, registry(conn, fresh=True))


def import_settings(conn: psycopg.Connection, incoming: object, user_id: str) -> dict[str, object]:
    if not isinstance(incoming, dict) or "general" not in incoming or "billing" not in incoming:
        return {"ok": False, "errors": [err("file", "โครงสร้างไฟล์ไม่ตรงกับค่าตั้งค่าของระบบนี้",
                                            "File structure does not match this system’s settings")]}
    reg = registry(conn, fresh=True)
    current = load_settings(conn, reg)
    sections = [key for key in incoming if key in SECTIONS]
    errors = [err(key, "ไม่รู้จักหมวดค่าตั้งนี้", "Unknown settings section")
              for key in incoming if key not in SECTIONS and key not in ("updatedAt", "updatedBy")]
    merged = {**current, **{key: incoming[key] for key in sections}}
    errors += check(conn, merged, current)
    if errors:
        return {"ok": False, "errors": errors}
    with conn.transaction():
        _apply(conn, reg, merged, sections, user_id)
        _audit(conn, user_id, "settings_import", ",".join(sections), None, {"sections": sections})
    invalidate()
    return {"ok": True, "errors": []}


def reset_settings(conn: psycopg.Connection, user_id: str) -> dict[str, object]:
    """คืนค่าตั้งต้นที่ 06_seed.sql บันทึกไว้ · ★ ไม่ลบ LINE token (เป็นกุญแจ ไม่ใช่ค่าตั้ง)"""
    reg = registry(conn, fresh=True)
    with conn.transaction():
        conn.execute("DELETE FROM settings")
        conn.execute("""INSERT INTO settings (section, value, updated_at, updated_by)
                        SELECT section, value, now(), %s FROM settings_factory""", (user_id,))
        conn.execute("DELETE FROM thresholds")
        conn.execute("INSERT INTO thresholds SELECT * FROM thresholds_factory")
        for kind, config in conn.execute("SELECT kind, config FROM tariffs_factory").fetchall():
            _write_tariff(conn, reg, kind, config)
        _audit(conn, user_id, "settings_reset", "all", None, None)
    invalidate()
    return load_settings(conn, registry(conn, fresh=True))


# ─────────────── ทดสอบการเชื่อมต่อ ───────────────

def tcp_check(host: object, port: object, timeout: float = 2.0) -> float | None:
    """เวลาเปิด TCP สำเร็จ (ms) · None = ต่อไม่ได้"""
    if not isinstance(host, str) or not is_valid_host(host) or not isinstance(port, int) or not 1 <= port <= 65535:
        return None
    started = time.perf_counter()
    try:
        with socket.create_connection((host.strip(), port), timeout=timeout):
            pass
    except OSError:
        return None
    return (time.perf_counter() - started) * 1000


def network_test(reg: Registry, body: dict | None) -> dict[str, object]:
    """ทดสอบจากเครื่องที่รัน API ด้วยค่าที่กรอก (ยังไม่บันทึก) — TCP ถึง broker และ PLC"""
    network = {**reg.settings.get("network", {}), **(body or {})}
    mqtt_ms = tcp_check(network.get("mqttHost"), network.get("mqttPort"))
    plc_ms = tcp_check(network.get("plcHost"), network.get("plcPort"))
    return {"mqtt": mqtt_ms is not None, "plc": plc_ms is not None,
            "latencyMs": round(mqtt_ms) if mqtt_ms is not None else 0}


def line_test(reg: Registry, group_id: str) -> dict[str, object]:
    """★ PROMPT_04: LINE ปิดไว้ (offline_mode) จนกว่าจะอนุมัติเปิดขาออก — ตอบตามรูป NotificationTestResult"""
    groups = (reg.settings.get("line") or {}).get("groups") or []
    group = next((g for g in groups if g.get("id") == group_id), None)
    message = ("offline_mode — ระบบไม่มีอินเทอร์เน็ต ยังส่งข้อความ LINE ไม่ได้จนกว่าจะอนุมัติเปิดขาออก api.line.me"
               if group is not None else "ไม่พบกลุ่มที่เลือก")
    return {"ok": False, "channel": "line", "recipient": group["name"] if group else group_id, "message": message,
            "at": iso(now_ms(), reg.timezone)}
