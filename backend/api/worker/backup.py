"""สำรองฐานข้อมูลรายวันตาม maintenance.backupTime (PROMPT_06 งานที่ 5)

  pg_dump -Fc → BACKUP_DIR/water-YYYYMMDD-HHMM.dump.part → ตรวจ → rename → เก็บ KEEP ไฟล์ล่าสุด
  ตรวจ: ไฟล์ไม่ว่าง · pg_restore --list อ่านได้และมีตารางหลักครบ
        · สัดส่วนขนาดไฟล์ต่อขนาดฐานข้อมูลไม่ต่ำกว่าครั้งก่อนที่สำเร็จเกินครึ่ง

★ เทียบสัดส่วน ไม่ใช่ขนาดไฟล์ตรง ๆ — หลัง retention ลบ chunk ฐานข้อมูลเล็กลงจริง ไฟล์ก็เล็กลงตาม (เจอตอนทดสอบ: ลบ 120 chunk
  แล้วไฟล์ลดจาก 2.78 เหลือ 1.08 MB ถูกปฏิเสธผิด ๆ)
★ BACKUP_DIR คือโฟลเดอร์ที่ host mount SMB (maintenance.backupPath เช่น \\\\10.20.10.20\\water-backup) ไว้แล้ว bind เข้ามา
  container ไม่ mount SMB เอง — ไม่ต้องมีสิทธิ์พิเศษและไม่ต้องเก็บรหัส SMB ใน container
★ ผลทุกครั้งลง backup_runs · ล้มเหลวไม่ลองซ้ำอัตโนมัติในวันเดียวกัน (กันดิสก์ปลายทางเต็มซ้ำทุกนาที) แต่ log ระดับ error
★ pg_dump 17 จาก Debian ตรงกับเซิร์ฟเวอร์ PostgreSQL 17 · กู้คืนต้องใช้ timescaledb_pre_restore()/post_restore()
"""

from __future__ import annotations

import os
import subprocess
from datetime import date, datetime
from pathlib import Path

import psycopg

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/backup"))
KEEP = 14
MIN_RATIO = 0.5
REQUIRED_TABLES = ("entities", "settings", "alerts", "meter_telemetry", "tariffs")
DUMP_TIMEOUT_S = 3 * 3600


class BackupError(RuntimeError):
    pass


def is_due(now_local: datetime, backup_time: str, last_attempt: date | None, enabled: bool) -> bool:
    if not enabled:
        return False
    hour, minute = (int(part) for part in backup_time.split(":"))
    return (now_local.hour, now_local.minute) >= (hour, minute) and last_attempt != now_local.date()


def size_problem(size: int, db_bytes: int, previous: tuple[int, int] | None) -> str | None:
    """previous = (ขนาดไฟล์, ขนาดฐานข้อมูล) ของครั้งก่อนที่สำเร็จ"""
    if size <= 0:
        return "ไฟล์สำรองว่างเปล่า"
    if previous is None or db_bytes <= 0 or previous[1] <= 0:
        return None
    ratio, before = size / db_bytes, previous[0] / previous[1]
    if ratio < before * MIN_RATIO:
        return (f"ไฟล์สำรอง {size:,} ไบต์ ({ratio:.1%} ของฐานข้อมูล) ต่ำกว่าครั้งก่อน ({before:.1%}) เกินครึ่ง"
                " — อาจ dump ไม่ครบ")
    return None


def missing_tables(listing: str) -> list[str]:
    """ตารางหลักที่ไม่อยู่ในสารบัญของไฟล์ (pg_restore --list)"""
    return [table for table in REQUIRED_TABLES if f" TABLE DATA public {table} " not in listing]


def to_delete(names: list[str], keep: int = KEEP) -> list[str]:
    """ชื่อไฟล์มีเวลาเรียงได้ตามตัวอักษร — เก็บ keep ไฟล์ใหม่สุด"""
    ordered = sorted(names)
    return ordered[:-keep] if len(ordered) > keep else []


def _pg_env() -> dict[str, str]:
    env = os.environ
    return {**env, "PGHOST": env.get("POSTGRES_HOST", "timescaledb"), "PGUSER": env.get("POSTGRES_USER", ""),
            "PGPASSWORD": env.get("POSTGRES_PASSWORD", ""), "PGDATABASE": env.get("POSTGRES_DB", "")}


def last_attempt_day(conn: psycopg.Connection, tz: str) -> date | None:
    row = conn.execute("SELECT (max(started_at) AT TIME ZONE %s)::date FROM backup_runs", (tz,)).fetchone()
    return None if row is None else row[0]


def run_backup(conn: psycopg.Connection, now_local: datetime) -> dict[str, object]:
    target = BACKUP_DIR / f"water-{now_local:%Y%m%d-%H%M}.dump"
    partial = target.with_name(target.name + ".part")
    db_bytes = int(conn.execute("SELECT pg_database_size(current_database())").fetchone()[0])  # type: ignore[index]
    previous = conn.execute("""SELECT size_bytes, db_bytes FROM backup_runs
                                WHERE status = 'ok' AND db_bytes IS NOT NULL ORDER BY id DESC LIMIT 1""").fetchone()
    run_id = conn.execute("INSERT INTO backup_runs (status, db_bytes) VALUES ('running', %s) RETURNING id",
                          (db_bytes,)).fetchone()[0]  # type: ignore[index]
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        subprocess.run(["pg_dump", "--format=custom", "--no-owner", f"--file={partial}"], env=_pg_env(), check=True,
                       capture_output=True, text=True, timeout=DUMP_TIMEOUT_S)
        size = partial.stat().st_size
        problem = size_problem(size, db_bytes, None if previous is None else (int(previous[0]), int(previous[1])))
        if problem is None:
            listing = subprocess.run(["pg_restore", "--list", str(partial)], check=True, capture_output=True,
                                     text=True, timeout=600).stdout
            missing = missing_tables(listing)
            problem = f"ไฟล์สำรองไม่มีตาราง {', '.join(missing)}" if missing else None
        if problem is not None:
            raise BackupError(problem)
        os.replace(partial, target)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, BackupError, OSError) as exc:
        partial.unlink(missing_ok=True)
        detail = exc.stderr.strip()[-500:] if isinstance(exc, subprocess.CalledProcessError) and exc.stderr else ""
        error = f"{exc} {detail}".strip()
        conn.execute("UPDATE backup_runs SET status = 'failed', error = %s, finished_at = now() WHERE id = %s",
                     (error, run_id))
        return {"status": "failed", "error": error}
    conn.execute("""UPDATE backup_runs SET status = 'ok', file_name = %s, size_bytes = %s, finished_at = now()
                     WHERE id = %s""", (target.name, size, run_id))
    removed = to_delete([path.name for path in BACKUP_DIR.glob("water-*.dump")])
    for name in removed:
        (BACKUP_DIR / name).unlink(missing_ok=True)
    return {"status": "ok", "file": target.name, "sizeBytes": size, "databaseBytes": db_bytes, "removed": removed}
