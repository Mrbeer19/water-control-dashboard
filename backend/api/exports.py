"""ส่งออกรายงานเป็นไฟล์ (PROMPT_06 งานที่ 4) — api รับคำขอ · worker เรนเดอร์ · api ส่งไฟล์

  POST /api/reports/export {type, range, format} → report_exports (queued) → 202 {jobId, status}
  worker ทุก 2 วินาที: หยิบงาน (FOR UPDATE SKIP LOCKED) → reports.report_definition() → ไฟล์ใน EXPORT_DIR
  GET  /api/reports/export/:jobId → ไฟล์เมื่อเสร็จ · ยังไม่เสร็จ 202 {jobId, status}

★ ตัวเลขมาจาก report_definition() ตัวเดียวกับ GET /api/reports — ไฟล์ตรงกับหน้าจอ
★ CSV: UTF-8 with BOM (Excel ภาษาไทย) · null = ช่องว่าง ไม่ใช่ 0 · metadata บนสุด · เขียนลงไฟล์ทีละแถว
★ PDF: WeasyPrint + ฟอนต์ Sarabun ที่ติดตั้งใน image ของ worker — import ตอนเรนเดอร์ (image ของ api ไม่มี WeasyPrint)
"""

from __future__ import annotations

import csv
import html
import os
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field

from . import buckets as bk
from .alerts import thai_datetime
from .common import parse_time
from .errors import ApiException, bad_request, not_found
from .registry import Registry
from .reports import MAX_AUDIT_DAYS, PRESETS, REPORT_TYPES, day_range, report_definition
from .series import to_dt, to_ms_required

EXPORT_DIR = Path(os.environ.get("EXPORT_DIR", "/data/exports"))
FORMATS = ("csv", "pdf")
MEDIA_TYPES = {"csv": "text/csv; charset=utf-8", "pdf": "application/pdf"}
STALE_MINUTES = 10        # งานที่ running ค้างนานกว่านี้ = worker ดับกลางงาน หยิบใหม่ได้
MAX_ATTEMPTS = 3
KEEP_DAYS = 7
GRANULARITY_TH = {"daily": "รายวัน", "leak_audit": "รายวัน", "monthly": "รายเดือน"}

CLAIM = """
    UPDATE report_exports SET status = 'running', started_at = now(), attempts = attempts + 1
     WHERE job_id = (SELECT job_id FROM report_exports
                      WHERE (status = 'queued'
                             OR (status = 'running' AND started_at < now() - make_interval(mins => %s)))
                        AND attempts < %s
                      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *"""
GIVE_UP = """
    UPDATE report_exports SET status = 'failed', finished_at = now(), error = 'worker หยุดกลางงานซ้ำหลายครั้ง'
     WHERE status = 'running' AND attempts >= %s AND started_at < now() - make_interval(mins => %s)"""


class ExportRange(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    preset: str = "custom"
    from_: str | int = Field(alias="from")
    to: str | int


class ExportRequest(BaseModel):
    type: str
    range: ExportRange
    format: str


# ─────────────── คำขอ (api) ───────────────

def create_job(conn: psycopg.Connection, reg: Registry, user_id: str, request: ExportRequest) -> dict[str, str]:
    if request.format == "xlsx":
        raise bad_request("FORMAT_NOT_SUPPORTED", "ยังส่งออกเป็น xlsx ไม่ได้ — ใช้ CSV (เปิดใน Excel ได้) หรือ PDF",
                          "xlsx export is not supported — use CSV (opens in Excel) or PDF", field="format")
    if request.format not in FORMATS:
        raise bad_request("VALIDATION_FAILED", "format ต้องเป็น csv หรือ pdf", "format must be csv or pdf",
                          field="format")
    if request.type not in REPORT_TYPES:
        raise bad_request("VALIDATION_FAILED", f"ไม่รู้จักรายงาน {request.type}", f"Unknown report type {request.type}",
                          field="type")
    if request.range.preset not in PRESETS:
        raise bad_request("VALIDATION_FAILED", "preset ไม่ถูกต้อง", "Invalid preset", field="range.preset")
    start, end = day_range(reg, parse_time(str(request.range.from_), 0, "from"),
                           parse_time(str(request.range.to), 0, "to"))
    if request.type == "leak_audit" and end - start > MAX_AUDIT_DAYS * bk.MS_DAY:
        raise bad_request("RANGE_TOO_LONG", f"ตรวจน้ำสูญหายรายวันได้ครั้งละไม่เกิน {MAX_AUDIT_DAYS} วัน",
                          f"Leak audit is limited to {MAX_AUDIT_DAYS} days", limit=MAX_AUDIT_DAYS)
    job_id = uuid.uuid4().hex
    conn.execute("""INSERT INTO report_exports (job_id, report_type, range_from, range_to, preset, format, requested_by)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                 (job_id, request.type, to_dt(start), to_dt(end), request.range.preset, request.format, user_id))
    return {"jobId": job_id, "status": "queued"}


def get_job(conn: psycopg.Connection, job_id: str) -> dict[str, object]:
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT * FROM report_exports WHERE job_id = %s", (job_id,))
        job = cur.fetchone()
    if job is None:
        raise not_found("EXPORT_NOT_FOUND", "ไม่พบงานส่งออกนี้", "Export job not found", jobId=job_id)
    return job


def file_of(job: dict[str, object]) -> Path:
    return EXPORT_DIR / f"{job['job_id']}.{job['format']}"


# ─────────────── เรนเดอร์ (worker) ───────────────

def run_next(conn: psycopg.Connection, reg: Registry) -> dict[str, object] | None:
    """หยิบงานถัดไปหนึ่งงาน · คืนสรุปผล หรือ None เมื่อไม่มีงาน"""
    conn.execute(GIVE_UP, (MAX_ATTEMPTS, STALE_MINUTES))
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(CLAIM, (STALE_MINUTES, MAX_ATTEMPTS))
        job = cur.fetchone()
    if job is None:
        return None
    target = file_of(job)
    try:
        definition = report_definition(conn, reg, str(job["report_type"]), to_ms_required(job["range_from"]),
                                       to_ms_required(job["range_to"]), str(job["preset"]))
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".part")
        (write_csv if job["format"] == "csv" else write_pdf)(definition, reg.timezone, partial)
        os.replace(partial, target)
    except ApiException as exc:
        error = str(exc.body(None)["messageTh"])
    except Exception as exc:  # noqa: BLE001 — งานพังต้องบันทึกให้ผู้ขอเห็น ไม่ใช่ทำ worker ล้มทั้งตัว
        error = f"{type(exc).__name__}: {exc}"
    else:
        file_name = f"{definition['id']}.{job['format']}"
        size = target.stat().st_size
        conn.execute("""UPDATE report_exports SET status = 'done', file_name = %s, size_bytes = %s, error = NULL,
                               finished_at = now() WHERE job_id = %s""", (file_name, size, job["job_id"]))
        return {"jobId": job["job_id"], "status": "done", "file": file_name, "sizeBytes": size}
    conn.execute("UPDATE report_exports SET status = 'failed', error = %s, finished_at = now() WHERE job_id = %s",
                 (error, job["job_id"]))
    return {"jobId": job["job_id"], "status": "failed", "error": error}


def purge(conn: psycopg.Connection, keep_days: int = KEEP_DAYS) -> int:
    """ลบงานและไฟล์ที่เก่ากว่า keep_days — ไฟล์ส่งออกเป็นของชั่วคราว ข้อมูลจริงอยู่ใน DB"""
    rows = conn.execute("DELETE FROM report_exports WHERE created_at < now() - make_interval(days => %s) "
                        "RETURNING job_id, format", (keep_days,)).fetchall()
    for job_id, fmt in rows:
        (EXPORT_DIR / f"{job_id}.{fmt}").unlink(missing_ok=True)
    return len(rows)


# ─────────────── CSV ───────────────

def _heading(column: dict[str, object]) -> str:
    return f"{column['label']} ({column['unit']})" if column["unit"] else str(column["label"])


def _day(iso_value: str, tz: str, exclusive: bool = False) -> str:
    moment = datetime.fromisoformat(iso_value) - (timedelta(milliseconds=1) if exclusive else timedelta(0))
    return thai_datetime(moment, tz).rsplit(" ", 1)[0]


def metadata(definition: dict[str, object], tz: str) -> list[list[str]]:
    span = definition["range"]
    return [["รายงาน", str(definition["name"])],
            ["ช่วงเวลา", f"{_day(span['from'], tz)} ถึง {_day(span['to'], tz, exclusive=True)}"],  # type: ignore[index]
            ["ความละเอียด", GRANULARITY_TH.get(str(definition["type"]), "รวมทั้งช่วง")],
            ["เขตเวลา", tz],
            ["ออกรายงานเมื่อ", thai_datetime(datetime.fromisoformat(str(definition["generatedAt"])), tz)]]


def _rows(definition: dict[str, object]) -> list[dict[str, object]]:
    totals = definition["totals"]
    return [*definition["rows"], *([totals] if totals else [])]  # type: ignore[list-item]


def csv_rows(definition: dict[str, object], tz: str) -> Iterator[list[object]]:
    columns: list[dict[str, object]] = definition["columns"]  # type: ignore[assignment]
    yield from metadata(definition, tz)
    yield []
    yield ["รายการ", *[_heading(c) for c in columns]]
    for row in _rows(definition):
        values: dict[str, object] = row["values"]  # type: ignore[assignment]
        # ★ null = ช่องว่าง ไม่ใช่ 0 — "ไม่มีข้อมูล" กับ "วัดได้ศูนย์" ต้องแยกกันได้ใน Excel
        yield [row["label"], *["" if values.get(str(c["key"])) is None else values[str(c["key"])] for c in columns]]


def write_csv(definition: dict[str, object], tz: str, path: Path) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:   # utf-8-sig = ขึ้นต้นด้วย BOM
        writer = csv.writer(handle)
        for row in csv_rows(definition, tz):
            writer.writerow(row)


# ─────────────── PDF ───────────────

CSS = """
@page { size: A4 landscape; margin: 14mm 12mm 16mm;
        @bottom-right { content: "หน้า " counter(page) " / " counter(pages); font-size: 8pt; color: #555; } }
body { font-family: "Sarabun", sans-serif; font-size: 10pt; color: #1a1a1a; }
h1 { font-size: 16pt; font-weight: 700; margin: 0 0 4pt; }
.meta { color: #444; margin: 0 0 10pt; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #ececec; font-weight: 700; text-align: left; }
th, td { border-bottom: 0.5pt solid #bdbdbd; padding: 3pt 5pt; }
td.num { text-align: right; }
tr.total td { font-weight: 700; border-top: 1pt solid #333; }
"""


def _decimals(rows: list[dict[str, object]], key: str) -> int:
    """ทศนิยมเท่ากันทั้งคอลัมน์ — ในคอลัมน์เงินเดียวกัน 73 ต้องแสดงเป็น 73.00 ข้าง 4.66"""
    for row in rows:
        value = row["values"].get(key)  # type: ignore[attr-defined]
        if isinstance(value, int | float) and not float(value).is_integer():
            return 2
    return 0


def _display(value: object, value_type: object, decimals: int) -> str:
    if value is None:
        return "–"
    if value_type == "text" or isinstance(value, str):
        return html.escape(str(value))
    return f"{float(value):,.{decimals}f}"  # type: ignore[arg-type]


def report_html(definition: dict[str, object], tz: str) -> str:
    columns: list[dict[str, object]] = definition["columns"]  # type: ignore[assignment]
    head = "".join(f"<th>{html.escape(_heading(c))}</th>" for c in columns)
    rows = _rows(definition)
    decimals = {str(c["key"]): _decimals(rows, str(c["key"])) for c in columns}
    lines = []
    totals = definition["totals"]
    for row in rows:
        values: dict[str, object] = row["values"]  # type: ignore[assignment]
        cells = []
        for column in columns:
            key, css = str(column["key"]), "text" if column["valueType"] == "text" else "num"
            cells.append(f'<td class="{css}">{_display(values.get(key), column["valueType"], decimals[key])}</td>')
        marker = ' class="total"' if row is totals else ""
        lines.append(f"<tr{marker}><td>{html.escape(str(row['label']))}</td>{''.join(cells)}</tr>")
    meta = " · ".join(f"{html.escape(k)} {html.escape(v)}" for k, v in metadata(definition, tz)[1:])
    return (f'<!doctype html><html lang="th"><head><meta charset="utf-8"><style>{CSS}</style></head><body>'
            f"<h1>{html.escape(str(definition['name']))}</h1><p class=\"meta\">{meta}</p>"
            f"<table><thead><tr><th>รายการ</th>{head}</tr></thead><tbody>{''.join(lines)}</tbody></table>"
            "</body></html>")


def write_pdf(definition: dict[str, object], tz: str, path: Path) -> None:
    from weasyprint import HTML  # มีเฉพาะใน image ของ worker (docker/worker.Dockerfile)

    HTML(string=report_html(definition, tz)).write_pdf(str(path))
