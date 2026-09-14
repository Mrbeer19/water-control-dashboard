"""python -m api.worker — งานเบื้องหลังตามเวลาของโรงงาน (วนจนได้ SIGTERM)

  ทุกขอบ 5 นาที  unaccounted.evaluate() หน้าต่าง 60 นาทีล่าสุด → plant_metrics + alert UNACCOUNTED_WATER_HIGH

  python -m api.worker unaccounted --end 2026-09-13T23:40:00+07:00 --window 30
      ประเมินหน้าต่างเดียวแล้วพิมพ์ผลเป็น JSON (ใช้ทดสอบ และคำนวณย้อนหลังหลังนำเข้าข้อมูลเก่า)

★ ตรรกะอยู่ใน api/worker/*.py (ทดสอบได้ไม่ต้องมีลูป) — ไฟล์นี้แค่จับเวลาและต่อ DB
★ รอ SETTLE_MS หลังขอบ 5 นาที ให้ ingest เขียนก้อนสุดท้ายของหน้าต่างครบก่อนประเมิน
★ healthcheck: ไฟล์ HEARTBEAT ถูกแตะทุกรอบที่คุย DB สำเร็จ
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from datetime import datetime
from pathlib import Path

import psycopg

from ..db import conninfo
from ..registry import registry
from ..series import now_ms
from . import unaccounted

POLL_SECONDS = 5.0
SETTLE_MS = 60_000
HEARTBEAT = Path("/tmp/worker.alive")


def log(event: str, **fields: object) -> None:
    record = {"ts": datetime.now().astimezone().isoformat(timespec="milliseconds"), "service": "worker",
              "entity_id": fields.pop("entity_id", None), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, default=str), flush=True)


def run_once(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(prog="python -m api.worker", description="รันงานของ worker ครั้งเดียว")
    jobs = parser.add_subparsers(dest="job", required=True)
    job = jobs.add_parser("unaccounted", help="ประเมินน้ำสูญหายหนึ่งหน้าต่าง")
    job.add_argument("--end", required=True, help="ปลายหน้าต่าง ISO 8601 พร้อม offset (ตัดลงขอบ 5 นาที)")
    job.add_argument("--window", type=int, default=unaccounted.WINDOW_MINUTES, help="ความยาวหน้าต่าง (นาที)")
    args = parser.parse_args(argv)
    end = datetime.fromisoformat(args.end)
    if end.tzinfo is None:
        raise SystemExit("--end ต้องมี offset เช่น +07:00")
    with psycopg.connect(conninfo("worker"), autocommit=True, connect_timeout=5) as conn:
        reg = registry(conn)
        end_ms = unaccounted.window_end(int(end.timestamp() * 1000), reg.timezone)
        result = unaccounted.evaluate(conn, reg, end_ms, args.window)
    print(json.dumps(result, ensure_ascii=False, default=str), flush=True)


def loop() -> None:
    stopping = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    conn: psycopg.Connection | None = None
    last_end: int | None = None
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
            HEARTBEAT.touch()
        except psycopg.OperationalError as exc:
            log("database_unavailable", level="error", error=str(exc).strip())
            conn = None
            time.sleep(3)
        time.sleep(POLL_SECONDS)
    log("worker_stopped")


def main() -> None:
    if len(sys.argv) > 1:
        run_once(sys.argv[1:])
    else:
        loop()


if __name__ == "__main__":
    main()
