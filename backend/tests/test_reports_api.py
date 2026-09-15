"""เกณฑ์รับงานเฟส 6 ข้อ 3–6 — รายงานกับ stack จริง

รัน: .venv/bin/pytest -m integration tests/test_reports_api.py -v   (make up + make sim ก่อน)
★ ทิ้งบันทึกการจดมิเตอร์ไว้ในฐานข้อมูล ให้ make contract ตรวจ anchor=meter_reading ได้ · อัตราทดสอบลบทิ้งเสมอ
★ simulator เดินอยู่ ตัวเลขขยับระหว่างเรียก — เทียบแบบคร่อม (ก่อน ≤ รายงาน ≤ หลัง) ตัวนับสะสมไม่ถอยหลัง
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import httpx
import pytest

from tests.helpers import BKK

pytestmark = pytest.mark.integration
API = "http://127.0.0.1:8000"
NOTE = "integration test: test_reports_api"
# รอบจดจริงคร่อมเดือน (15 → 15) — ต่างจากเดือนปฏิทินโดยเจตนา · ใช้ครั้งละ 45 ลบ.ม. เท่ากันทุกรอบ
READINGS = [(date(2026, 6, 15), 5000), (date(2026, 7, 15), 5045), (date(2026, 8, 15), 5090), (date(2026, 9, 10), 5135)]
RAISED_ON = date(2026, 8, 1)
RAISED = {"tiers": [{"min_m3": 0, "max_m3": None, "rate": 40.0}], "service_charge": 0, "vat_percent": 7}
REPORT_TYPES = ("daily", "monthly", "zone_comparison", "department_cost", "energy", "leak_audit")
SUMMED = {"daily": ("cubicMeters", 2), "monthly": ("cubicMeters", 2), "zone_comparison": ("cubicMeters", 2),
          "department_cost": ("totalCostBaht", 2), "energy": ("energyKwh", 1)}


def ms(at: datetime) -> int:
    return int(at.timestamp() * 1000)


def iso_ms(value: str) -> int:
    return ms(datetime.fromisoformat(value))


@pytest.fixture
def api():
    with httpx.Client(base_url=API, timeout=120) as client:
        yield client


@pytest.fixture
def readings(db):
    main = db.value("SELECT entity_id FROM entities WHERE source_type = 'meter' AND (spec ->> 'isMain')::boolean")
    db.rows("DELETE FROM meter_readings WHERE note = %s", NOTE)
    for day, value in READINGS:
        db.rows("INSERT INTO meter_readings (entity_id, read_on, meter_value, source, note) "
                "VALUES (%s, %s, %s, 'utility', %s)", main, day, value, NOTE)
    return main


@pytest.fixture
def raised_tariff(db):
    """ขึ้นค่าน้ำ 1 ส.ค. เป็น 40 บาท/ลบ.ม. อัตราเดียว — ลบทิ้งเสมอ ไม่งั้นค่าน้ำจริงทั้งระบบเพี้ยน"""
    db.rows("DELETE FROM tariffs WHERE kind = 'water' AND effective_from = %s", RAISED_ON)
    db.rows("INSERT INTO tariffs (kind, effective_from, config) VALUES ('water', %s, %s::jsonb)",
            RAISED_ON, json.dumps(RAISED))
    try:
        yield
    finally:
        db.rows("DELETE FROM tariffs WHERE kind = 'water' AND effective_from = %s", RAISED_ON)


def series_total(api: httpx.Client, source_type: str, source_id: str, start: int, end: int,
                 granularity: str = "hour") -> float:
    response = api.get("/api/metrics/series", params={
        "sourceType": source_type, "sourceId": source_id, "metric": "volume_cubic_meters", "from": start, "to": end,
        "granularity": granularity})
    assert response.status_code == 200, response.text
    return sum(p["delta"] or 0.0 for p in response.json()["points"])


def test_meter_readings_bill_units_between_readings_at_the_rate_of_their_period(api, db, readings, raised_tariff):
    rows = api.get("/api/reports/meter-readings", params={"limit": 10}).json()
    by_date = {r["readingDate"][:10]: r for r in rows}
    assert [by_date[d]["unitsUsed"] for d in ("2026-07-15", "2026-08-15", "2026-09-10")] == [45, 45, 45]
    assert by_date["2026-06-15"]["unitsUsed"] == 0 and by_date["2026-09-10"]["periodDays"] == 26

    # ข้อ 3: 45 ลบ.ม. = 30×17 + 15×19.5 = 802.5 บาท ไม่ใช่ 45 × 19.5
    #   API ตอบค่าขั้นบันได (subtotal) · water_cost_at() ใน SQL ตอบยอดบิลเต็ม (+ ค่าบริการ 90 + VAT 7%)
    assert by_date["2026-07-15"]["costBaht"] == 802.5 != 45 * 19.5
    assert float(db.value("SELECT water_cost_at(45, '2026-07-01')")) == round((802.5 + 90) * 1.07, 2)
    # ข้อ 4: รอบ 15 ก.ค.–15 ส.ค. เริ่มก่อนขึ้นอัตรา → ยังคิดอัตราเดิม · รอบที่เริ่มหลังขึ้นอัตราคิดอัตราใหม่
    assert by_date["2026-08-15"]["costBaht"] == 802.5
    assert by_date["2026-09-10"]["costBaht"] == 45 * 40.0
    assert float(db.value("SELECT water_cost_at(45, '2026-08-20')")) == round(45 * 40.0 * 1.07, 2)


def test_meter_reading_months_start_on_reading_days_not_calendar_days(api, readings):
    """ข้อ 5: เดือนตามรอบจดตัดที่วันจดจริง — ยอดจึงต่างจากเดือนปฏิทิน"""
    calendar = api.get("/api/reports/monthly", params={"months": 3}).json()
    anchored = api.get("/api/reports/monthly", params={"months": 3, "anchor": "meter_reading"}).json()

    def local_day(point: dict) -> date:
        return datetime.fromtimestamp(point["timestamp"] / 1000, BKK).date()

    assert all(local_day(p).day == 1 for p in calendar) and calendar[-1]["partial"]
    assert [local_day(p) for p in anchored] == [date(2026, 7, 15), date(2026, 8, 15), date(2026, 9, 10)]
    assert anchored[-1]["partial"] and not anchored[0]["partial"]
    assert anchored[0]["readingDate"].startswith("2026-07-15")
    assert [p["readingDate"][:10] for p in calendar[-3:]] == ["2026-07-15", "2026-08-15", "2026-09-10"]

    bad = api.get("/api/reports/monthly", params={"anchor": "weekly"})
    assert bad.status_code == 400 and bad.json()["code"] == "VALIDATION_FAILED"


def test_usage_report_equals_sum_of_series_the_graph_draws(api):
    """ข้อ 6: ยอดรายโซนในรายงาน = ผลรวม delta ของ /api/metrics/series ช่วงเดียวกัน"""
    today = datetime.now(BKK).replace(hour=0, minute=0, second=0, microsecond=0)
    start, end = ms(today), ms(today + timedelta(days=1))
    zones = [z["id"] for z in api.get("/api/zones").json()]
    before = {z: series_total(api, "zone", z, start, end) for z in zones}
    report = api.get("/api/reports/usage", params={"from": start, "to": end}).json()
    after = {z: series_total(api, "zone", z, start, end) for z in zones}

    rows = {r["zoneId"]: r for r in report["rows"]}
    assert set(rows) == set(zones)
    for zone in zones:
        assert before[zone] - 0.006 <= rows[zone]["cubicMeters"] <= after[zone] + 0.006, zone
    assert (iso_ms(report["range"]["from"]), iso_ms(report["range"]["to"])) == (start, end)
    previous = report["previousRange"]
    assert iso_ms(previous["to"]) == start and iso_ms(previous["to"]) - iso_ms(previous["from"]) == end - start

    total = report["totalCubicMeters"]
    assert abs(sum(r["cubicMeters"] for r in rows.values()) - total) <= 0.01 * len(rows)
    assert abs(sum(d["cubicMeters"] for d in report["daily"]) - total) <= 0.01
    assert abs(sum(r["costBaht"] for r in rows.values()) - report["totalCostBaht"]) <= 0.01 * len(rows)
    if total > 0:
        assert abs(sum(r["sharePercent"] for r in rows.values()) - 100) <= 0.1 * len(rows)

    backwards = api.get("/api/reports/usage", params={"from": end, "to": start})
    assert backwards.status_code == 400 and backwards.json()["code"] == "INVALID_RANGE"


def test_billing_estimate_reads_main_meter_with_tier_vat_math(api):
    first = api.get("/api/reports/billing").json()
    start, end = iso_ms(first["periodStart"]), iso_ms(first["periodEnd"])
    total = series_total(api, "meter", "meter-main", start, end)   # รอบบิล ≤ 31 วัน → รายงานรวมรายชั่วโมง
    again = api.get("/api/reports/billing").json()
    assert first["consumedCubicMeters"] - 0.006 <= total <= again["consumedCubicMeters"] + 0.006

    subtotal = round(sum(t["amountBaht"] for t in first["tierBreakdown"]), 2)
    assert first["subtotalBaht"] == subtotal
    assert first["totalBaht"] == round(subtotal + first["serviceChargeBaht"] + first["vatBaht"], 2)
    assert first["projectedTotalBaht"] >= first["totalBaht"]

    electricity = api.get("/api/reports/billing", params={"utility": "electricity"}).json()
    assert electricity["utility"] == "electricity" and electricity["serviceChargeBaht"] == 0
    assert api.get("/api/reports/billing", params={"utility": "gas"}).status_code == 400


@pytest.mark.parametrize("report_type", REPORT_TYPES)
def test_every_report_type_has_matching_columns_and_totals_that_add_up(api, report_type):
    week_ago = datetime.now(BKK) - timedelta(days=6)
    body = api.get("/api/reports", params={"type": report_type, "from": ms(week_ago), "preset": "7d"}).json()
    assert body["type"] == report_type and body["range"]["preset"] == "7d"
    keys = {c["key"] for c in body["columns"]}
    assert body["rows"] and all(set(r["values"]) == keys for r in body["rows"])
    assert body["totals"] is not None and set(body["totals"]["values"]) == keys
    if report_type in SUMMED:
        key, digits = SUMMED[report_type]
        counted = [r for r in body["rows"] if not r["labelEn"].endswith("(sub-meter)")]   # มิเตอร์ย่อยไม่นับรวม (D-75)
        total = sum(r["values"][key] for r in counted)
        assert abs(total - body["totals"]["values"][key]) <= 10 ** -digits * (len(counted) + 1)


def test_report_errors_are_readable(api):
    unknown = api.get("/api/reports", params={"type": "nope"})
    assert unknown.status_code == 400 and unknown.json()["code"] == "VALIDATION_FAILED"
    four_months_ago = ms(datetime.now(BKK) - timedelta(days=120))
    long_audit = api.get("/api/reports", params={"type": "leak_audit", "from": four_months_ago})
    assert long_audit.status_code == 400 and long_audit.json()["code"] == "RANGE_TOO_LONG"
    assert api.get("/api/reports/usage", params={"from": "yesterday"}).status_code == 400
