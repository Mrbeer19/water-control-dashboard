"""endpoint รายงาน (PROMPT_06 งานที่ 3–4) — ตรงกับ lib/services/reports.ts

★ from/to รับทั้ง epoch ms และ ISO ที่มี offset (TimeRange ของหน้าบ้านเป็น ISO) · ช่วงถูกขยายให้ตรงขอบวันตามเวลาโรงงาน
★ ส่งออกไฟล์: api สร้างงาน → worker เรนเดอร์ → api ส่งไฟล์จาก volume ร่วม (api/exports.py)
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response
from fastapi.responses import FileResponse, JSONResponse

from . import exports
from . import reports as rp
from .auth import AnyUser
from .common import parse_time
from .db import pool
from .errors import ApiException, bad_request
from .registry import registry
from .series import now_ms

router = APIRouter(prefix="/api/reports")


def _times(frm: str | None, to: str | None, default_days: int) -> tuple[int, int]:
    now = now_ms()
    end = parse_time(to, now, "to")
    return parse_time(frm, end - default_days * 86_400_000, "from"), end


def _preset(raw: str | None) -> str:
    if raw is None:
        return "custom"
    if raw not in rp.PRESETS:
        raise bad_request("VALIDATION_FAILED", "preset ไม่ถูกต้อง", "Invalid preset", field="preset")
    return raw


@router.get("/billing")
def get_billing(response: Response, utility: str = "water", frm: Annotated[str | None, Query(alias="from")] = None,
                to: str | None = None) -> dict[str, object]:
    """ไม่ระบุช่วง = รอบบิลปัจจุบัน"""
    with pool.connection() as conn:
        body = rp.billing_estimate(conn, registry(conn), utility, parse_time(frm, 0, "from") if frm else None,
                                   parse_time(to, 0, "to") if to else None)
    response.headers["Cache-Control"] = "max-age=5"
    return body


@router.get("/usage")
def get_usage(response: Response, frm: Annotated[str | None, Query(alias="from")] = None, to: str | None = None,
              preset: str | None = None) -> dict[str, object]:
    start, end = _times(frm, to, 30)
    with pool.connection() as conn:
        body = rp.usage_report(conn, registry(conn), start, end, _preset(preset))
    response.headers["Cache-Control"] = "max-age=5"
    return body


@router.get("/monthly")
def get_monthly(response: Response, months: Annotated[int, Query(ge=1, le=36)] = 12,
                anchor: str = "calendar") -> list[dict[str, object]]:
    """anchor = calendar (ตัดวันที่ 1) หรือ meter_reading (ตัดตามวันที่การประปาจดจริง)"""
    with pool.connection() as conn:
        body = rp.monthly_usage(conn, registry(conn), months, anchor)
    response.headers["Cache-Control"] = "max-age=5"
    return body


@router.get("/meter-readings")
def get_meter_readings(meter_id: Annotated[str | None, Query(alias="meterId")] = None,
                       limit: Annotated[int, Query(ge=1, le=120)] = 12) -> list[dict[str, object]]:
    with pool.connection() as conn:
        return rp.meter_readings(conn, registry(conn), meter_id, limit)


@router.post("/export", status_code=202)
def post_export(body: exports.ExportRequest, user: AnyUser) -> dict[str, str]:
    """★ ต้องล็อกอิน — สร้างงานและไฟล์บนเซิร์ฟเวอร์ (D-80) · xlsx ตอบ 400 FORMAT_NOT_SUPPORTED"""
    with pool.connection() as conn:
        return exports.create_job(conn, registry(conn), user.user_id, body)


@router.get("/export/{job_id}", response_model=None)
def get_export(job_id: str, _user: AnyUser) -> FileResponse | JSONResponse:
    """เสร็จ = ไฟล์ · ยังไม่เสร็จ = 202 {jobId, status} · ล้มเหลว = 422 · ไฟล์ถูกลบแล้ว = 410"""
    with pool.connection() as conn:
        job = exports.get_job(conn, job_id)
    if job["status"] == "failed":
        raise ApiException(422, "EXPORT_FAILED", f"สร้างไฟล์ไม่สำเร็จ: {job['error']}", "Export failed",
                           {"jobId": job_id, "reason": str(job["error"])})
    if job["status"] != "done":
        return JSONResponse({"jobId": job_id, "status": job["status"]}, status_code=202)
    path = exports.file_of(job)
    if not path.exists():
        raise ApiException(410, "EXPORT_EXPIRED", f"ไฟล์นี้ถูกลบแล้ว (เก็บไว้ {exports.KEEP_DAYS} วัน) กรุณาส่งออกใหม่",
                           "Export file has expired; request it again", {"jobId": job_id})
    return FileResponse(path, media_type=exports.MEDIA_TYPES[str(job["format"])], filename=str(job["file_name"]))


@router.get("")
def get_report(response: Response, report_type: Annotated[str, Query(alias="type")],
               frm: Annotated[str | None, Query(alias="from")] = None, to: str | None = None,
               preset: str | None = None) -> dict[str, object]:
    start, end = _times(frm, to, 30)
    with pool.connection() as conn:
        body = rp.report_definition(conn, registry(conn), report_type, start, end, _preset(preset))
    response.headers["Cache-Control"] = "max-age=5"
    return body
