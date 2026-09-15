"""ไฟล์ส่งออกรายงาน — CSV (BOM · null เป็นช่องว่าง) และ HTML ของ PDF · ไม่ต้องมี docker และไม่ต้องมี WeasyPrint"""

from __future__ import annotations

import csv
import io

from api.exports import report_html, write_csv

DEFINITION = {
    "id": "report-daily-20260901-20260902", "name": "รายงานการใช้น้ำรายวัน 1/9/2569–2/9/2569", "type": "daily",
    "range": {"preset": "custom", "from": "2026-09-01T00:00:00.000+07:00", "to": "2026-09-03T00:00:00.000+07:00"},
    "generatedAt": "2026-09-14T10:00:00.000+07:00",
    "columns": [
        {"key": "cubicMeters", "label": "ปริมาณน้ำ", "labelEn": "Water", "unit": "m³", "valueType": "number"},
        {"key": "rainfallMm", "label": "ฝน", "labelEn": "Rainfall", "unit": "mm", "valueType": "number"},
        {"key": "note", "label": "หมายเหตุ", "labelEn": "Note", "unit": None, "valueType": "text"},
    ],
    "rows": [
        {"label": "2026-09-01", "labelEn": "2026-09-01",
         "values": {"cubicMeters": 12.5, "rainfallMm": 0.0, "note": "<ท่อ & วาล์ว>"}},
        {"label": "2026-09-02", "labelEn": "2026-09-02", "values": {"cubicMeters": 1234.0, "rainfallMm": None,
                                                                    "note": None}},
    ],
    "totals": {"label": "รวม", "labelEn": "Total", "values": {"cubicMeters": 1246.5, "rainfallMm": None, "note": None}},
}


def test_csv_starts_with_bom_keeps_thai_and_leaves_null_blank_not_zero(tmp_path):
    path = tmp_path / "report.csv"
    write_csv(DEFINITION, "Asia/Bangkok", path)
    raw = path.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")

    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    assert rows[0] == ["รายงาน", DEFINITION["name"]]
    assert ["ช่วงเวลา", "1 ก.ย. 2569 ถึง 2 ก.ย. 2569"] in rows and ["เขตเวลา", "Asia/Bangkok"] in rows
    assert ["ความละเอียด", "รายวัน"] in rows
    header = rows.index(["รายการ", "ปริมาณน้ำ (m³)", "ฝน (mm)", "หมายเหตุ"])
    assert rows[header + 1] == ["2026-09-01", "12.5", "0.0", "<ท่อ & วาล์ว>"]
    assert rows[header + 2] == ["2026-09-02", "1234.0", "", ""]
    assert rows[header + 3] == ["รวม", "1246.5", "", ""]


def test_pdf_html_is_thai_escapes_text_and_marks_missing_values():
    page = report_html(DEFINITION, "Asia/Bangkok")
    assert '<html lang="th">' in page and '"Sarabun"' in page
    assert "&lt;ท่อ &amp; วาล์ว&gt;" in page and "<ท่อ" not in page
    assert "1,234.00" in page and "12.50" in page and "–" in page     # ทศนิยมเท่ากันทั้งคอลัมน์
    assert page.count('class="total"') == 1 and "1 ก.ย. 2569 ถึง 2 ก.ย. 2569" in page
