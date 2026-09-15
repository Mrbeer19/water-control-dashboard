"""เกณฑ์รับงานเฟส 6 ข้อ 7–8 — ส่งออก CSV/PDF ผ่าน API จริง (api สร้างงาน · worker เรนเดอร์ · api ส่งไฟล์)

รัน: .venv/bin/pytest -m integration tests/test_exports_api.py -v   (make up ก่อน)
★ ไฟล์ PDF ล่าสุดถูกเขียนไว้ที่ data/exports-check/ ให้เปิดดูด้วยตาได้ว่าเป็นอักษรไทยจริง
"""

from __future__ import annotations

import contextlib
import csv
import io
import re
import time
import zlib
from datetime import datetime, timedelta

import httpx
import pytest

from tests.helpers import BACKEND, BKK

pytestmark = pytest.mark.integration
API = "http://127.0.0.1:8000"


def week() -> dict[str, str]:
    today = datetime.now(BKK).replace(hour=0, minute=0, second=0, microsecond=0)
    return {"preset": "7d", "from": (today - timedelta(days=6)).isoformat(), "to": datetime.now(BKK).isoformat()}


def export(client: httpx.Client, fmt: str, report_type: str = "daily") -> httpx.Response:
    started = client.post("/api/reports/export", json={"type": report_type, "range": week(), "format": fmt})
    assert started.status_code == 202, started.text
    job = started.json()
    assert job["status"] == "queued" and len(job["jobId"]) == 32
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        result = client.get(f"/api/reports/export/{job['jobId']}")
        if result.status_code != 202:
            return result
        time.sleep(0.5)
    raise AssertionError(f"worker ไม่เรนเดอร์งาน {job['jobId']} ภายใน 90 วินาที")


def test_7_csv_opens_in_excel_as_thai_with_blank_cells_for_missing_data(signed_in):
    client = signed_in("accounting")
    response = export(client, "csv")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert re.search(r'filename="report-daily-\d{8}-\d{8}\.csv"', response.headers["content-disposition"])
    raw = response.content
    assert raw.startswith(b"\xef\xbb\xbf")                      # BOM → Excel อ่านเป็น UTF-8

    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    assert rows[0][0] == "รายงาน" and rows[0][1].startswith("รายงานการใช้น้ำรายวัน")
    assert ["เขตเวลา", "Asia/Bangkok"] in rows and ["ความละเอียด", "รายวัน"] in rows
    header = rows.index(["รายการ", "ปริมาณน้ำ (m³)", "ค่าน้ำโดยประมาณ (บาท)", "อุณหภูมิเฉลี่ย (°C)", "ฝน (mm)"])
    days = rows[header + 1:-1]
    assert len(days) == 7 and rows[-1][0] == "รวม"

    report = client.get("/api/reports", params={"type": "daily", **{k: v for k, v in week().items()}}).json()
    first = report["rows"][0]["values"]
    # วันแรกของสัปดาห์จบไปแล้ว ตัวเลขไม่ขยับ — ไฟล์ต้องตรงกับ API
    assert days[0][1] == str(first["cubicMeters"])
    for index, key in ((3, "avgTemperatureCelsius"), (4, "rainfallMm")):
        assert days[0][index] == ("" if first[key] is None else str(first[key]))
    assert rows[-1][3] == "" and rows[-1][4] == ""              # ยอดรวมของอุณหภูมิ/ฝน = null → ช่องว่าง ไม่ใช่ 0


def test_8_pdf_embeds_only_the_thai_sarabun_font(signed_in):
    client = signed_in("accounting")
    response = export(client, "pdf", "department_cost")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    pdf = response.content
    assert pdf.startswith(b"%PDF-") and len(pdf) > 5_000
    # WeasyPrint เก็บ dict ของฟอนต์ใน object stream ที่บีบอัด — ต้องคลายก่อนถึงจะเห็นชื่อฟอนต์
    objects = [pdf]
    for match in re.finditer(rb"stream\r?\n", pdf):
        with contextlib.suppress(zlib.error):
            objects.append(zlib.decompress(pdf[match.end():pdf.find(b"endstream", match.end())]))
    fonts = set(re.findall(rb"/BaseFont\s*/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)", b"\n".join(objects)))
    assert fonts and all(name.startswith(b"Sarabun") for name in fonts), fonts   # ไม่มีฟอนต์สำรองที่ไม่มีอักษรไทย
    assert b"\n".join(objects).count(b"/FontFile2") == len(fonts)                 # ฝังตัวฟอนต์จริงทุกตัว

    out = BACKEND / "data" / "exports-check" / "department_cost.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(pdf)


def test_export_errors_are_readable(signed_in):
    client = signed_in("accounting")
    xlsx = client.post("/api/reports/export", json={"type": "daily", "range": week(), "format": "xlsx"})
    assert xlsx.status_code == 400 and xlsx.json()["code"] == "FORMAT_NOT_SUPPORTED"
    assert "CSV" in xlsx.json()["messageTh"]
    unknown = client.get("/api/reports/export/0123456789abcdef0123456789abcdef")
    assert unknown.status_code == 404 and unknown.json()["code"] == "EXPORT_NOT_FOUND"
    with httpx.Client(base_url=API, timeout=10) as anonymous:
        assert anonymous.post("/api/reports/export", json={"type": "daily", "range": week(),
                                                            "format": "csv"}).status_code == 401
