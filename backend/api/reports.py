"""รายงาน · ค่าน้ำค่าไฟ · ยอดรายเดือน · การจดมิเตอร์ (PROMPT_06 งานที่ 2–3)

★ ปริมาณทุกตัวมาจาก counter_total() / fetch_buckets + build_points ชุดเดียวกับ /api/metrics/series
  ตัวเลขในรายงานจึงตรงกับกราฟเป๊ะ (เกณฑ์รับงานข้อ 6)
★ อัตราอ่านจาก tariffs ที่มีผล ณ วันเริ่มของช่วงนั้น — รายงานย้อนหลังใช้อัตราเก่าเสมอ (ข้อ 4)
★ ขั้นบันไดคิดจากยอดทั้งช่วง/ทั้งรอบบิล · ค่าน้ำรายวันและรายโซนเป็นการเฉลี่ยตามสัดส่วนของยอดนั้น
  ไม่ใช่คิดขั้นบันไดแยกทีละก้อนแล้วบวกกัน (ซึ่งได้ตัวเลขต่ำกว่าบิลจริง)
★ เงินปัดครึ่งขึ้นแบบ Math.round ของ JS ให้ตรงกับ lib/utils/calculation.ts
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import psycopg

from . import buckets as bk
from .alerts import TH_MONTHS
from .errors import bad_request, not_found
from .metric_registry import AMOUNT, COUNTER, GAUGE, MetricDef
from .registry import Registry
from .series import build_points, calendar_bounds, fetch_buckets, fetch_prior_counter, iso, meter_reading_bounds, now_ms
from .usage import (
    billing_period,
    counter_total,
    electricity_rate,
    split_into_tiers,
    tariff,
    unaccounted_water,
    water_tiers,
)

EN_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
PRESETS = ("1h", "6h", "24h", "7d", "30d", "custom")
REPORT_TYPES = ("daily", "monthly", "zone_comparison", "department_cost", "energy", "leak_audit")
REPORT_NAMES = {"daily": "รายงานการใช้น้ำรายวัน", "monthly": "รายงานการใช้น้ำรายเดือน",
                "zone_comparison": "เปรียบเทียบการใช้น้ำรายโซน", "department_cost": "ค่าใช้จ่ายรายแผนก",
                "energy": "รายงานพลังงานไฟฟ้า", "leak_audit": "ตรวจสอบน้ำสูญหายรายวัน"}
AUDIT_KEYS = ("mainMeterCubicMeters", "zoneTotalCubicMeters", "storageDeltaCubicMeters", "unaccountedCubicMeters",
              "unaccountedPercent", "status")
MAX_REPORT_DAYS = 400
MAX_AUDIT_DAYS = 93


def js_round(value: float, digits: int = 2) -> float:
    """Math.round ของ JS (ครึ่งปัดขึ้น) — ตัวเลขเงินตรงกับหน้าบ้าน"""
    factor = 10 ** digits
    return math.floor(value * factor + 0.5) / factor


def _fsum(rows: list[dict[str, object]], key: str, digits: int = 2) -> float:
    return js_round(sum(float(r[key]) for r in rows), digits)  # type: ignore[arg-type]


def _pct(now: float, before: float) -> float:
    return js_round((now - before) / before * 100, 1) if before else 0.0


def _ymd(ms: int, tz: str) -> str:
    y, m, d, *_ = bk.zoned_parts(ms, tz)
    return f"{y:04d}-{m:02d}-{d:02d}"


# ─────────────── อัตรา · ใบแจ้งหนี้ ───────────────

@dataclass(frozen=True)
class Tariff:
    tiers: list[dict[str, object]]
    service_charge: float
    vat_percent: float


def water_tariff(conn: psycopg.Connection, on_ms: int, tz: str) -> Tariff:
    config = tariff(conn, "water", on_ms, tz) or {}
    return Tariff(water_tiers(config), float(config.get("service_charge", 0)),  # type: ignore[arg-type]
                  float(config.get("vat_percent", 0)))  # type: ignore[arg-type]


def electricity_tariff(conn: psycopg.Connection, on_ms: int, tz: str) -> Tariff:
    """ค่าไฟอัตราเดียว (อัตรา + Ft) ไม่มีค่าบริการ · VAT ใช้อัตราเดียวกับค่าน้ำ"""
    rate = electricity_rate(tariff(conn, "electricity", on_ms, tz))
    tier = {"id": "tier-electric", "name": "ค่าไฟฟ้าเหมาอัตราเดียว", "nameEn": "Flat electricity rate",
            "minCubicMeters": 0, "maxCubicMeters": None, "ratePerCubicMeter": round(rate, 4)}
    return Tariff([tier], 0.0, water_tariff(conn, on_ms, tz).vat_percent)


def bill(amount: float, rates: Tariff) -> dict[str, object]:
    """ตรรกะเดียวกับ calculateBillingEstimate(): ขั้นบันไดสะสม → + ค่าบริการ → + VAT"""
    breakdown = split_into_tiers(amount, rates.tiers)
    subtotal = _fsum(breakdown, "amountBaht")
    vat = js_round((subtotal + rates.service_charge) * rates.vat_percent / 100)
    return {"tierBreakdown": breakdown, "subtotalBaht": subtotal, "serviceChargeBaht": rates.service_charge,
            "vatBaht": vat, "totalBaht": js_round(subtotal + rates.service_charge + vat)}


def subtotal(amount: float, rates: Tariff) -> float:
    return float(bill(amount, rates)["subtotalBaht"])  # type: ignore[arg-type]


# ─────────────── ปริมาณตามช่วง ───────────────

def day_range(reg: Registry, from_ms: int, to_ms: int) -> tuple[int, int]:
    """ขยายช่วงให้ตรงขอบวันตามเวลาโรงงาน — ยอดตัวนับรายชั่วโมง/รายวันจึงตรงกับกราฟ"""
    tz = reg.timezone
    start = bk.bucket_start(from_ms, "day", tz)
    last_day = bk.bucket_start(to_ms, "day", tz)
    end = to_ms if to_ms == last_day else bk.next_bucket_start(last_day, "day", tz)
    if end <= start:
        raise bad_request("INVALID_RANGE", "เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม", "`to` must be after `from`")
    if end - start > MAX_REPORT_DAYS * bk.MS_DAY:
        raise bad_request("RANGE_TOO_LONG", f"ขอรายงานได้ไม่เกิน {MAX_REPORT_DAYS} วัน",
                          f"Reports are limited to {MAX_REPORT_DAYS} days", limit=MAX_REPORT_DAYS)
    return start, end


def zone_volumes(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> dict[str, float]:
    out: dict[str, float] = {}
    for zone_id in reg.zones:
        meter = reg.meter_of_zone(zone_id)
        if meter is not None:
            out[zone_id] = counter_total(conn, reg.timezone, "meter", "volume", str(meter["entity_id"]),
                                         start, end) or 0.0
    return out


def main_volume(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> float:
    main = reg.main_meter()
    if main is None:
        return 0.0
    return counter_total(conn, reg.timezone, "meter", "volume", str(main["entity_id"]), start, end) or 0.0


def energy_of(conn: psycopg.Connection, reg: Registry, source_type: str, start: int, end: int) -> dict[str, float]:
    """kWh ต่อ entity · source_type = electric_node (ตู้ไฟ) หรือ pump"""
    source = "power" if source_type == "electric_node" else "pump"
    return {str(e["entity_id"]): counter_total(conn, reg.timezone, source, "energy", str(e["entity_id"]), start, end)
            or 0.0 for e in reg.of_type(source_type)}


def _range(start: int, end: int, tz: str, preset: str = "custom") -> dict[str, str]:
    return {"preset": preset, "from": iso(start, tz), "to": iso(end, tz)}


# ─────────────── ค่าสาธารณูปโภคของรอบ ───────────────

def billing_estimate(conn: psycopg.Connection, reg: Registry, utility: str, from_ms: int | None,
                     to_ms: int | None) -> dict[str, object]:
    """BillingEstimate — ไม่ระบุช่วง = รอบบิลปัจจุบัน · เทียบรอบก่อนหน้าด้วยอัตราของรอบนั้นเอง"""
    if utility not in ("water", "electricity"):
        raise bad_request("VALIDATION_FAILED", "utility ต้องเป็น water หรือ electricity",
                          "utility must be water or electricity", field="utility")
    tz, now = reg.timezone, now_ms()
    cycle = int(reg.setting("billing", "billingCycleStartDay", 1))  # type: ignore[call-overload]
    if from_ms is None and to_ms is None:
        start, end = billing_period(now, cycle, tz)
        previous = billing_period(start - 1, cycle, tz)
    else:
        start, end = day_range(reg, now if from_ms is None else from_ms, now if to_ms is None else to_ms)
        previous = (start - (end - start), start)

    def amount(a: int, b: int) -> float:
        b = max(a, min(b, now))
        if utility == "water":
            return main_volume(conn, reg, a, b)
        return sum(energy_of(conn, reg, "electric_node", a, b).values())

    rates_for = water_tariff if utility == "water" else electricity_tariff
    consumed = amount(start, end)
    rates = rates_for(conn, start, tz)
    current = bill(consumed, rates)
    progress = 1.0 if end <= now else min(1.0, max(0.01, (now - start) / (end - start)))
    projected = float(bill(consumed / progress, rates)["totalBaht"])  # type: ignore[arg-type]
    previous_total = float(bill(amount(*previous), rates_for(conn, previous[0], tz))["totalBaht"])  # type: ignore[arg-type]
    # ★ เทียบด้วยยอดคาดการณ์สิ้นรอบเหมือน calculateBillingEstimate() — รอบที่จบแล้ว projected = total อยู่แล้ว
    return {"utility": utility, "periodStart": iso(start, tz), "periodEnd": iso(end, tz),
            "consumedCubicMeters": js_round(consumed), **current,
            "currency": str(reg.setting("billing", "currency", "THB")), "projectedTotalBaht": projected,
            "changeFromPreviousPercent": _pct(projected, previous_total), "calculatedAt": iso(now, tz)}


# ─────────────── รายวัน ───────────────

def _outdoor_daily(conn: psycopg.Connection, reg: Registry, bounds: list[tuple[int, int]],
                   now: int) -> tuple[list[object], list[object]]:
    temps: list[object] = [None] * len(bounds)
    rains: list[object] = [None] * len(bounds)
    outdoor = next((s for s in reg.of_type("sensor") if reg.spec(str(s["entity_id"])).get("hasRainGauge")), None)
    if outdoor is not None:
        outdoor_id = str(outdoor["entity_id"])
        temp_rows = fetch_buckets(conn, MetricDef("env", "temp", GAUGE, ""), "1d", outdoor_id, bounds)
        temps = [p["avg"] for p in build_points(GAUGE, temp_rows, bounds, now)]
        rain_rows = fetch_buckets(conn, MetricDef("env", "rain", AMOUNT, ""), "1d", outdoor_id, bounds)
        rains = [p["sum"] for p in build_points(AMOUNT, rain_rows, bounds, now)]
    return temps, rains


def daily_points(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> list[dict[str, object]]:
    """DailyUsagePoint[] = Σ มิเตอร์ทุกโซน · ค่าน้ำรายวันเฉลี่ยตามสัดส่วนจากค่าน้ำทั้งรอบบิล"""
    tz, now = reg.timezone, now_ms()
    bounds = calendar_bounds(start, end, "day", tz)
    per_day = [0.0] * len(bounds)
    volume = MetricDef("meter", "volume", COUNTER, "")
    for meter in reg.of_type("meter"):
        if meter["zone_id"] is None:
            continue
        rows = fetch_buckets(conn, volume, "1d", str(meter["entity_id"]), bounds)
        prior = fetch_prior_counter(conn, volume, "1d", str(meter["entity_id"]), start)
        for index, point in enumerate(build_points(COUNTER, rows, bounds, now, prior)):
            per_day[index] += float(point["delta"] or 0.0)  # type: ignore[arg-type]
    temps, rains = _outdoor_daily(conn, reg, bounds, now)

    cycle = int(reg.setting("billing", "billingCycleStartDay", 1))  # type: ignore[call-overload]
    periods: dict[int, tuple[float, float]] = {}
    out = []
    for index, (day, _stop) in enumerate(bounds):
        period_start, period_end = billing_period(day, cycle, tz)
        if period_start not in periods:
            m3 = sum(zone_volumes(conn, reg, period_start, max(period_start, min(period_end, now))).values())
            periods[period_start] = (subtotal(m3, water_tariff(conn, period_start, tz)), m3)
        period_cost, period_m3 = periods[period_start]
        temp, rain = temps[index], rains[index]
        out.append({"date": _ymd(day, tz), "timestamp": day, "cubicMeters": js_round(per_day[index]),
                    "costBaht": js_round(period_cost * per_day[index] / period_m3) if period_m3 > 0 else 0.0,
                    "avgTemperatureCelsius": None if temp is None else js_round(float(temp), 1),  # type: ignore[arg-type]
                    "rainfallMm": None if rain is None else js_round(float(rain), 2),  # type: ignore[arg-type]
                    "projected": False})
    return out


# ─────────────── รายงานการใช้น้ำ ───────────────

def usage_report(conn: psycopg.Connection, reg: Registry, from_ms: int, to_ms: int,
                 preset: str = "custom") -> dict[str, object]:
    """UsageReport — เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน (ไม่ใช่เดือนที่แล้ว) · ค่าน้ำรายโซนเฉลี่ยตามสัดส่วน"""
    tz, now = reg.timezone, now_ms()
    start, end = day_range(reg, from_ms, to_ms)
    previous = (start - (end - start), start)
    current = zone_volumes(conn, reg, start, end)
    before = zone_volumes(conn, reg, *previous)
    total, previous_total = sum(current.values()), sum(before.values())
    cost = subtotal(total, water_tariff(conn, start, tz))
    previous_cost = subtotal(previous_total, water_tariff(conn, previous[0], tz))
    rows = []
    for zone_id, zone in reg.zones.items():
        if zone_id not in current:
            continue
        m3, previous_m3 = js_round(current[zone_id]), js_round(before.get(zone_id, 0.0))
        share = current[zone_id] / total if total else 0.0
        previous_share = before.get(zone_id, 0.0) / previous_total if previous_total else 0.0
        rows.append({"zoneId": zone_id, "name": zone["name_th"], "nameEn": zone["name_en"],
                     "departmentId": zone["department_id"], "cubicMeters": m3, "costBaht": js_round(cost * share),
                     "previousCubicMeters": previous_m3, "previousCostBaht": js_round(previous_cost * previous_share),
                     "changePercent": _pct(m3, previous_m3), "sharePercent": js_round(share * 100, 1)})
    return {"range": _range(start, end, tz, preset), "previousRange": _range(*previous, tz), "rows": rows,
            "totalCubicMeters": js_round(total), "totalCostBaht": js_round(cost),
            "previousTotalCubicMeters": js_round(previous_total), "previousTotalCostBaht": js_round(previous_cost),
            "changePercent": _pct(total, previous_total),
            "unaccounted": unaccounted_water(conn, reg, start, max(start, min(end, now))),
            "daily": daily_points(conn, reg, start, end), "generatedAt": iso(now, tz)}


# ─────────────── รายเดือน · การจดมิเตอร์ ───────────────

def month_bounds(conn: psycopg.Connection, reg: Registry, months: int, anchor: str,
                 now: int) -> list[tuple[int, int]]:
    """รอบจดล่าสุดยังไม่มีวันจดครั้งถัดไป → ขอบปลายคือ now (ผู้เรียกถือว่า partial)"""
    tz = reg.timezone
    if anchor == "meter_reading":
        main = reg.main_meter()
        if main is None:
            raise not_found("ENTITY_NOT_FOUND", "ไม่พบมิเตอร์หลัก", "Main meter not found")
        return meter_reading_bounds(conn, str(main["entity_id"]), 0, now, tz)[-months:]
    if anchor != "calendar":
        raise bad_request("VALIDATION_FAILED", "anchor ต้องเป็น calendar หรือ meter_reading",
                          "anchor must be calendar or meter_reading", field="anchor")
    starts = [bk.bucket_start(now, "month", tz)]
    while len(starts) < months:
        starts.insert(0, bk.bucket_start(starts[0] - 1, "month", tz))
    return [(s, bk.next_bucket_start(s, "month", tz)) for s in starts]


def monthly_usage(conn: psycopg.Connection, reg: Registry, months: int,
                  anchor: str = "calendar") -> list[dict[str, object]]:
    """MonthlyUsagePoint[] จากมิเตอร์หลัก (ยอดที่การประปาเรียกเก็บ) · เดือนที่ยังไม่จบ partial = true"""
    if not 1 <= months <= 36:
        raise bad_request("VALIDATION_FAILED", "months ต้องอยู่ระหว่าง 1–36", "months must be 1–36", field="months")
    tz, now = reg.timezone, now_ms()
    main = reg.main_meter()
    readings = [] if main is None else conn.execute(
        "SELECT read_on FROM meter_readings WHERE entity_id = %s ORDER BY read_on",
        (str(main["entity_id"]),)).fetchall()
    reading_marks = [bk.zoned_time_to_ms((d.year, d.month, d.day, 0, 0, 0), tz) for (d,) in readings]
    points: list[dict[str, object]] = []
    for start, end in month_bounds(conn, reg, months, anchor, now):
        m3 = js_round(main_volume(conn, reg, start, max(start, min(end, now))))
        y, m, *_ = bk.zoned_parts(start, tz)
        reading = next((mark for mark in reading_marks if start <= mark < end), None)
        previous = float(points[-1]["cubicMeters"]) if points else None  # type: ignore[arg-type]
        points.append({
            "month": f"{y:04d}-{m:02d}", "label": f"{TH_MONTHS[m - 1]} {(y + 543) % 100:02d}",
            "labelEn": f"{EN_MONTHS[m - 1]} {y % 100:02d}", "timestamp": start, "cubicMeters": m3,
            "costBaht": subtotal(m3, water_tariff(conn, start, tz)),
            "changeFromPreviousPercent": js_round((m3 - previous) / previous * 100, 1) if previous else None,
            "readingDate": None if reading is None else iso(reading, tz), "partial": end >= now})
    return points


def meter_readings(conn: psycopg.Connection, reg: Registry, meter_id: str | None,
                   limit: int) -> list[dict[str, object]]:
    """MeterReading[] — ★ หน่วยที่ออกบิล = เลขที่จดครั้งนี้ − ครั้งก่อน ไม่ใช่ยอดสะสมตามปฏิทิน"""
    tz = reg.timezone
    main = reg.main_meter()
    target = meter_id or (str(main["entity_id"]) if main else "")
    entity = reg.entities.get(target)
    if entity is None or entity["source_type"] != "meter":
        raise not_found("ENTITY_NOT_FOUND", f"ไม่พบมิเตอร์ {target}", f"Meter {target} not found", id=target)
    rows = conn.execute("""SELECT r.reading_id, r.read_on, r.meter_value, r.source, r.recorded_by, r.note,
                                  r.created_at, u.display_name
                             FROM meter_readings r LEFT JOIN users u ON u.user_id = r.recorded_by
                            WHERE r.entity_id = %s ORDER BY r.read_on DESC, r.reading_id DESC LIMIT %s""",
                        (target, limit + 1)).fetchall()
    out = []
    for index, (reading_id, read_on, value, source, recorded_by, note, created_at, display) in enumerate(rows[:limit]):
        older = rows[index + 1] if index + 1 < len(rows) else None
        units = float(value) - float(older[2]) if older is not None else 0.0
        units = float(value) if units < 0 else units          # เปลี่ยนมิเตอร์/หน้าปัดวนรอบ นับจากค่าใหม่ (ไม่ติดลบ)
        at = bk.zoned_time_to_ms((read_on.year, read_on.month, read_on.day, 0, 0, 0), tz)
        # ★ อัตราที่มีผล ณ วันเริ่มรอบจด (ครั้งก่อน) — ขึ้นอัตรากลางรอบ รอบนั้นยังคิดอัตราเดิม
        since = at if older is None else bk.zoned_time_to_ms((older[1].year, older[1].month, older[1].day, 0, 0, 0), tz)
        read_by = display or recorded_by or ("เจ้าหน้าที่การประปา" if source == "utility" else "-")
        label = f"จดมิเตอร์ {TH_MONTHS[read_on.month - 1]} {(read_on.year + 543) % 100:02d}"
        out.append({"id": str(reading_id), "name": label, "createdAt": iso(round(created_at.timestamp() * 1000), tz),
                    "updatedAt": iso(at, tz), "meterId": target, "meterName": entity["name"],
                    "readingDate": iso(at, tz), "totalizerCubicMeters": js_round(float(value)),
                    "unitsUsed": js_round(units), "costBaht": subtotal(units, water_tariff(conn, since, tz)),
                    "source": source, "readBy": read_by,
                    "periodDays": (read_on - older[1]).days if older is not None else 0, "note": note})
    return out


# ─────────────── แผนก ───────────────

def department_usage(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> list[dict[str, object]]:
    """DepartmentUsage[] — ★ ผลลัพธ์หลักของโปรเจกต์ คิดจากข้อมูลที่บันทึกจริงตลอดช่วง"""
    tz = reg.timezone
    previous = (start - (end - start), start)

    def totals(a: int, b: int) -> tuple[dict[str, float], dict[str, float]]:
        water: dict[str, float] = {}
        for zone_id, m3 in zone_volumes(conn, reg, a, b).items():
            department = reg.zones[zone_id]["department_id"]
            if department is not None:
                water[str(department)] = water.get(str(department), 0.0) + m3
        energy: dict[str, float] = {}
        for node_id, kwh in energy_of(conn, reg, "electric_node", a, b).items():
            department = str(reg.spec(node_id).get("departmentId"))
            energy[department] = energy.get(department, 0.0) + kwh
        return water, energy

    water, energy = totals(start, end)
    previous_water, previous_energy = totals(*previous)
    water_rates = water_tariff(conn, start, tz)
    rate = float(electricity_tariff(conn, start, tz).tiers[0]["ratePerCubicMeter"])  # type: ignore[arg-type]
    rows = []
    for department_id, department in sorted(reg.departments.items()):
        water_m3, kwh = water.get(department_id, 0.0), energy.get(department_id, 0.0)
        water_cost, power_cost = subtotal(js_round(water_m3), water_rates), js_round(kwh * rate)
        total = js_round(water_cost + power_cost)
        before = subtotal(js_round(previous_water.get(department_id, 0.0)), water_rates) \
            + js_round(previous_energy.get(department_id, 0.0) * rate)
        rows.append({"departmentId": department_id, "departmentName": department["name"],
                     "costCenterCode": department["cost_center_code"] or "", "periodStart": iso(start, tz),
                     "periodEnd": iso(end, tz), "waterCubicMeters": js_round(water_m3), "waterCostBaht": water_cost,
                     "energyKwh": js_round(kwh, 1), "electricityCostBaht": power_cost, "totalCostBaht": total,
                     "sharePercent": 0.0, "changeFromPreviousPercent": _pct(total, before)})
    grand = _fsum(rows, "totalCostBaht")
    for row in rows:
        row["sharePercent"] = js_round(float(row["totalCostBaht"]) / grand * 100, 1) if grand else 0.0  # type: ignore[arg-type]
    return rows


# ─────────────── ReportDefinition ───────────────

def _column(key: str, th: str, en: str, unit: str | None, value_type: str = "number") -> dict[str, object]:
    return {"key": key, "label": th, "labelEn": en, "unit": unit, "valueType": value_type}


def _row(label: str, label_en: str, values: dict[str, object]) -> dict[str, object]:
    return {"label": label, "labelEn": label_en, "values": values}


def _pick(source: dict[str, object], keys: tuple[str, ...]) -> dict[str, object]:
    return {k: source[k] for k in keys}


Table = tuple[list[dict[str, object]], list[dict[str, object]], dict[str, object] | None]


def _daily_table(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> Table:
    points = daily_points(conn, reg, start, end)
    keys = ("cubicMeters", "costBaht", "avgTemperatureCelsius", "rainfallMm")
    columns = [_column("cubicMeters", "ปริมาณน้ำ", "Water", "m³"),
               _column("costBaht", "ค่าน้ำโดยประมาณ", "Estimated cost", "บาท"),
               _column("avgTemperatureCelsius", "อุณหภูมิเฉลี่ย", "Avg temperature", "°C"),
               _column("rainfallMm", "ฝน", "Rainfall", "mm")]
    rows = [_row(str(p["date"]), str(p["date"]), _pick(p, keys)) for p in points]
    totals = _row("รวม", "Total", {"cubicMeters": _fsum(points, "cubicMeters"), "costBaht": _fsum(points, "costBaht"),
                                   "avgTemperatureCelsius": None, "rainfallMm": None})
    return columns, rows, totals


def _monthly_table(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> Table:
    """เดือนตามปฏิทินที่ทับช่วงที่เลือก"""
    months = max(1, min(36, math.ceil((now_ms() - start) / (30 * bk.MS_DAY)) + 1))
    points = [p for p in monthly_usage(conn, reg, months)
              if int(p["timestamp"]) < end and bk.next_bucket_start(int(p["timestamp"]), "month", reg.timezone) > start]  # type: ignore[call-overload]
    keys = ("cubicMeters", "costBaht", "changeFromPreviousPercent")
    columns = [_column("cubicMeters", "ปริมาณน้ำ", "Water", "m³"),
               _column("costBaht", "ค่าน้ำ (ขั้นบันได)", "Tiered cost", "บาท"),
               _column("changeFromPreviousPercent", "เทียบเดือนก่อน", "vs previous month", "%")]
    rows = [_row(str(p["label"]), str(p["labelEn"]), _pick(p, keys)) for p in points]
    totals = _row("รวม", "Total", {"cubicMeters": _fsum(points, "cubicMeters"), "costBaht": _fsum(points, "costBaht"),
                                   "changeFromPreviousPercent": None})
    return columns, rows, totals


def _zone_table(conn: psycopg.Connection, reg: Registry, start: int, end: int, preset: str) -> Table:
    usage = usage_report(conn, reg, start, end, preset)
    keys = ("cubicMeters", "sharePercent", "costBaht", "previousCubicMeters", "changePercent")
    columns = [_column("cubicMeters", "ปริมาณน้ำ", "Water", "m³"), _column("sharePercent", "สัดส่วน", "Share", "%"),
               _column("costBaht", "ค่าน้ำเฉลี่ยตามสัดส่วน", "Prorated cost", "บาท"),
               _column("previousCubicMeters", "ช่วงก่อนหน้า", "Previous period", "m³"),
               _column("changePercent", "เปลี่ยนแปลง", "Change", "%")]
    rows = [_row(str(r["name"]), str(r["nameEn"]), _pick(r, keys)) for r in usage["rows"]]  # type: ignore[attr-defined]
    totals = _row("รวมทุกโซน", "All zones", {
        "cubicMeters": usage["totalCubicMeters"], "sharePercent": 100.0, "costBaht": usage["totalCostBaht"],
        "previousCubicMeters": usage["previousTotalCubicMeters"], "changePercent": usage["changePercent"]})
    return columns, rows, totals


def _department_table(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> Table:
    departments = department_usage(conn, reg, start, max(start, min(end, now_ms())))
    keys = ("waterCubicMeters", "waterCostBaht", "energyKwh", "electricityCostBaht", "totalCostBaht", "sharePercent")
    columns = [_column("costCenterCode", "ศูนย์ต้นทุน", "Cost center", None, "text"),
               _column("waterCubicMeters", "น้ำ", "Water", "m³"),
               _column("waterCostBaht", "ค่าน้ำ", "Water cost", "บาท"),
               _column("energyKwh", "ไฟฟ้า", "Energy", "kWh"),
               _column("electricityCostBaht", "ค่าไฟ", "Electricity cost", "บาท"),
               _column("totalCostBaht", "รวม", "Total", "บาท"),
               _column("sharePercent", "สัดส่วน", "Share", "%")]
    rows = [_row(str(d["departmentName"]), str(reg.departments[str(d["departmentId"])]["name_en"]),
                 {"costCenterCode": d["costCenterCode"], **_pick(d, keys)}) for d in departments]
    sums = {k: _fsum(departments, k, 1 if k == "energyKwh" else 2) for k in keys[:-1]}
    totals = _row("รวมทุกแผนก", "All departments", {"costCenterCode": None, **sums, "sharePercent": 100.0})
    return columns, rows, totals


def _energy_table(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> Table:
    """ตู้ไฟแต่ละแผนก + มิเตอร์ย่อยของปั๊ม

    ★ ยอดรวมและสัดส่วนคิดเฉพาะตู้ไฟ — ปั๊มอาจรับไฟจากตู้ใดตู้หนึ่งอยู่แล้ว รวมเข้าไปจะนับซ้ำ (D-75)
    """
    rate = float(electricity_tariff(conn, start, reg.timezone).tiers[0]["ratePerCubicMeter"])  # type: ignore[arg-type]
    panels = energy_of(conn, reg, "electric_node", start, end)
    pumps = energy_of(conn, reg, "pump", start, end)
    grand = sum(panels.values())
    columns = [_column("energyKwh", "พลังงาน", "Energy", "kWh"),
               _column("costBaht", "ค่าไฟโดยประมาณ", "Estimated cost", "บาท"),
               _column("sharePercent", "สัดส่วน", "Share", "%")]

    def line(entity_id: str, kwh: float, suffix: tuple[str, str] = ("", "")) -> dict[str, object]:
        entity = reg.entities[entity_id]
        return _row(f"{entity['name']}{suffix[0]}", f"{entity['name_en']}{suffix[1]}",
                    {"energyKwh": js_round(kwh, 1), "costBaht": js_round(kwh * rate),
                     "sharePercent": js_round(kwh / grand * 100, 1) if grand else 0.0})

    rows = [line(e, kwh) for e, kwh in panels.items()]
    rows += [line(e, kwh, (" (มิเตอร์ย่อย)", " (sub-meter)")) for e, kwh in pumps.items()]
    totals = _row("รวม", "Total", {"energyKwh": js_round(grand, 1), "costBaht": js_round(grand * rate),
                                   "sharePercent": 100.0})
    return columns, rows, totals


def _leak_table(conn: psycopg.Connection, reg: Registry, start: int, end: int) -> Table:
    if end - start > MAX_AUDIT_DAYS * bk.MS_DAY:
        raise bad_request("RANGE_TOO_LONG", f"ตรวจน้ำสูญหายรายวันได้ครั้งละไม่เกิน {MAX_AUDIT_DAYS} วัน",
                          f"Leak audit is limited to {MAX_AUDIT_DAYS} days", limit=MAX_AUDIT_DAYS)
    tz, now = reg.timezone, now_ms()
    columns = [_column("mainMeterCubicMeters", "มิเตอร์หลัก", "Main meter", "m³"),
               _column("zoneTotalCubicMeters", "รวมทุกโซน", "All zones", "m³"),
               _column("storageDeltaCubicMeters", "Δ น้ำในถัง", "Storage change", "m³"),
               _column("unaccountedCubicMeters", "น้ำสูญหาย", "Unaccounted", "m³"),
               _column("unaccountedPercent", "สัดส่วนสูญหาย", "Unaccounted share", "%"),
               _column("status", "สถานะ", "Status", None, "text")]
    rows = []
    for day, day_end in calendar_bounds(start, end, "day", tz):
        if day >= now:
            break
        audit = unaccounted_water(conn, reg, day, min(day_end, now))
        rows.append(_row(_ymd(day, tz), _ymd(day, tz), _pick(audit, AUDIT_KEYS)))
    whole = unaccounted_water(conn, reg, start, max(start, min(end, now)))
    return columns, rows, _row("ทั้งช่วง", "Whole range", _pick(whole, AUDIT_KEYS))


def report_definition(conn: psycopg.Connection, reg: Registry, report_type: str, from_ms: int, to_ms: int,
                      preset: str = "custom") -> dict[str, object]:
    if report_type not in REPORT_TYPES:
        raise bad_request("VALIDATION_FAILED", f"ไม่รู้จักรายงาน {report_type}", f"Unknown report type {report_type}",
                          field="type")
    tz = reg.timezone
    start, end = day_range(reg, from_ms, to_ms)
    if report_type == "daily":
        columns, rows, totals = _daily_table(conn, reg, start, end)
    elif report_type == "monthly":
        columns, rows, totals = _monthly_table(conn, reg, start, end)
    elif report_type == "zone_comparison":
        columns, rows, totals = _zone_table(conn, reg, start, end, preset)
    elif report_type == "department_cost":
        columns, rows, totals = _department_table(conn, reg, start, end)
    elif report_type == "energy":
        columns, rows, totals = _energy_table(conn, reg, start, end)
    else:
        columns, rows, totals = _leak_table(conn, reg, start, end)

    generated = iso(now_ms(), tz)
    y1, m1, d1, *_ = bk.zoned_parts(start, tz)
    y2, m2, d2, *_ = bk.zoned_parts(end - 1, tz)
    return {"id": f"report-{report_type}-{y1:04d}{m1:02d}{d1:02d}-{y2:04d}{m2:02d}{d2:02d}",
            "name": f"{REPORT_NAMES[report_type]} {d1}/{m1}/{y1 + 543}–{d2}/{m2}/{y2 + 543}",
            "createdAt": generated, "updatedAt": generated, "type": report_type,
            "range": _range(start, end, tz, preset), "columns": columns, "rows": rows, "totals": totals,
            "generatedAt": generated}
