"""python -m api.worker — งานเบื้องหลังตามเวลาของโรงงาน (วนจนได้ SIGTERM)

  ทุกขอบ 5 นาที  unaccounted.evaluate() หน้าต่าง 60 นาทีล่าสุด → plant_metrics + alert UNACCOUNTED_WATER_HIGH
  ทุก 2 วินาที   exports.run_next() เรนเดอร์งานส่งออก CSV/PDF ที่รออยู่จนหมดคิว
  ทุกชั่วโมง     exports.purge() ลบงานและไฟล์ส่งออกที่เก่ากว่า 7 วัน
  ทุกคืน 01:30   archive.run_nightly() ข้อมูลดิบ → Parquet แล้วจึงลบ chunk ที่เกิน dataRetentionDays
  ทุกวันตาม maintenance.backupTime  backup.run_backup() → pg_dump ลงโฟลเดอร์สำรอง

  python -m api.worker unaccounted --end 2026-09-13T23:40:00+07:00 --window 30
  python -m api.worker archive [--day 2026-09-11] [--dry-run]
  python -m api.worker backup
      รันงานเดียวแล้วพิมพ์ผลเป็น JSON (ใช้ทดสอบ · สั่งมือหลังนำเข้าข้อมูลเก่า · สำรองก่อนอัปเกรด)

★ ตรรกะอยู่ใน api/worker/*.py และ api/exports.py (ทดสอบได้ไม่ต้องมีลูป) — ไฟล์นี้แค่จับเวลาและต่อ DB
★ archive/backup ใช้เวลานาน จึงรันใน thread แยกพร้อม connection ของตัวเอง — ลูปหลักยังแตะ HEARTBEAT และเรนเดอร์ไฟล์ต่อได้
★ รอ SETTLE_MS หลังขอบ 5 นาที ให้ ingest เขียนก้อนสุดท้ายของหน้าต่างครบก่อนประเมิน
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
import time
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg

from .. import exports
from ..db import conninfo
from ..registry import registry
from ..series import now_ms
from . import archive, backup, unaccounted

POLL_SECONDS = 1.0
EXPORT_EVERY = 2.0
PURGE_EVERY = 3600.0
NIGHTLY_CHECK_EVERY = 60.0
SETTLE_MS = 60_000
ARCHIVE_AT = (1, 30)          # ก่อน backup 02:30 · หลัง archive.SETTLE_HOURS ของวันก่อนหน้า
HEARTBEAT = Path("/tmp/worker.alive")


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now().astimezone().isoformat(timespec="milliseconds"), "service": "worker",
              "entity_id": fields.pop("entity_id", None), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def _print(result: object) -> None:
    print(json.dumps(result, ensure_ascii=False, default=str), flush=True)


def run_once(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m api.worker", description="รันงานของ worker ครั้งเดียว")
    jobs = parser.add_subparsers(dest="job", required=True)
    job = jobs.add_parser("unaccounted", help="ประเมินน้ำสูญหายหนึ่งหน้าต่าง")
    job.add_argument("--end", required=True, help="ปลายหน้าต่าง ISO 8601 พร้อม offset (ตัดลงขอบ 5 นาที)")
    job.add_argument("--window", type=int, default=unaccounted.WINDOW_MINUTES, help="ความยาวหน้าต่าง (นาที)")
    job = jobs.add_parser("archive", help="archive ข้อมูลดิบเป็น Parquet (ไม่ระบุวัน = งานประจำคืนรวมการลบตาม retention)")
    job.add_argument("--day", type=date.fromisoformat, help="archive ทุกตารางของวันนี้ใหม่ (YYYY-MM-DD ตามเวลาโรงงาน)")
    job.add_argument("--dry-run", action="store_true", help="archive ตามปกติแต่ไม่ลบ chunk")
    jobs.add_parser("backup", help="pg_dump ลงโฟลเดอร์สำรองเดี๋ยวนี้")
    args = parser.parse_args(argv)

    with psycopg.connect(conninfo("worker-cli"), autocommit=True, connect_timeout=5) as conn:
        reg = registry(conn)
        if args.job == "unaccounted":
            end = datetime.fromisoformat(args.end)
            if end.tzinfo is None:
                raise SystemExit("--end ต้องมี offset เช่น +07:00")
            end_ms = unaccounted.window_end(int(end.timestamp() * 1000), reg.timezone)
            _print(unaccounted.evaluate(conn, reg, end_ms, args.window))
        elif args.job == "archive" and args.day is not None:
            _print({"archived": [archive.archive_day(conn, table, args.day, reg.timezone) for table in archive.TABLES]})
        elif args.job == "archive":
            _print(archive.run_nightly(conn, reg, now_ms(), dry_run=args.dry_run))
        else:
            result = backup.run_backup(conn, datetime.now(ZoneInfo(reg.timezone)))
            _print(result)
            return 0 if result["status"] == "ok" else 1
    return 0


class Background:
    """งานยาวทีละงานใน thread แยก — งานเดิมยังไม่จบไม่เริ่มซ้ำ"""

    def __init__(self) -> None:
        self._thread: threading.Thread | None = None

    def busy(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, name: str, job: Callable[[psycopg.Connection], None]) -> None:
        def run() -> None:
            try:
                with psycopg.connect(conninfo(f"worker-{name}"), autocommit=True, connect_timeout=5) as conn:
                    job(conn)
            except Exception as exc:  # noqa: BLE001 — งานกลางคืนล้มต้องเห็นใน log ไม่ใช่ thread เงียบหาย
                log(f"{name}_crashed", level="error", error=f"{type(exc).__name__}: {exc}")

        self._thread = threading.Thread(target=run, name=name, daemon=True)
        self._thread.start()


def nightly_archive(conn: psycopg.Connection) -> None:
    summary = archive.run_nightly(conn, registry(conn), now_ms())
    archived: list[dict[str, object]] = summary["archived"]  # type: ignore[assignment]
    retained: list[dict[str, object]] = summary["retention"]  # type: ignore[assignment]
    log("archive", level="error" if summary["errors"] else "info", days=len(archived),
        rows=sum(int(item["rows"]) for item in archived),  # type: ignore[call-overload]
        dropped_chunks=sum(int(item["dropped"]) for item in retained),  # type: ignore[call-overload]
        blocked={item["table"]: item["blocked"] for item in retained if item.get("blocked")} or None,
        errors=summary["errors"] or None)


def nightly_backup(conn: psycopg.Connection) -> None:
    result = backup.run_backup(conn, datetime.now(ZoneInfo(registry(conn).timezone)))
    log("backup", level="error" if result["status"] != "ok" else "info", **result)


def loop() -> None:
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    conn: psycopg.Connection | None = None
    last_end: int | None = None
    last_export = last_purge = last_nightly = 0.0
    archived_on: date | None = None
    long_job = Background()
    log("worker_started")
    while not stopping:
        try:
            if conn is None or conn.closed:
                conn = psycopg.connect(conninfo("worker"), autocommit=True, connect_timeout=3)
            reg = registry(conn)
            end_ms = unaccounted.window_end(now_ms() - SETTLE_MS, reg.timezone)
            if end_ms != last_end:
                result = unaccounted.evaluate(conn, reg, end_ms)
                log("unaccounted", entity_id=unaccounted.PLANT, percent=result["unaccountedPercent"],
                    severity=result["severity"], skipped=result["skipped"], alert=result["alert"],
                    missing=result["missing"] or None)
                last_end = end_ms
            now = time.monotonic()
            if now - last_export >= EXPORT_EVERY:
                while not stopping and (finished := exports.run_next(conn, reg)) is not None:
                    log("export", level="error" if finished["status"] == "failed" else "info", **finished)
                last_export = now
            if now - last_purge >= PURGE_EVERY:
                removed = exports.purge(conn)
                if removed:
                    log("exports_purged", count=removed)
                last_purge = now
            if now - last_nightly >= NIGHTLY_CHECK_EVERY and not long_job.busy():
                local = datetime.now(ZoneInfo(reg.timezone))
                maintenance = reg.settings.get("maintenance", {})
                if (local.hour, local.minute) >= ARCHIVE_AT and archived_on != local.date():
                    long_job.start("archive", nightly_archive)
                    archived_on = local.date()
                elif backup.is_due(local, str(maintenance.get("backupTime", "02:30")),
                                   backup.last_attempt_day(conn, reg.timezone), bool(maintenance.get("backupEnabled"))):
                    long_job.start("backup", nightly_backup)
                last_nightly = now
            HEARTBEAT.touch()
        except psycopg.OperationalError as exc:
            log("database_unavailable", level="error", error=str(exc).strip())
            conn = None
            time.sleep(3)
        time.sleep(POLL_SECONDS)
    log("worker_stopped")


def main() -> None:
    if len(sys.argv) > 1:
        sys.exit(run_once(sys.argv[1:]))
    loop()


if __name__ == "__main__":
    main()
