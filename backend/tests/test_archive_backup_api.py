"""เกณฑ์รับงานเฟส 6 ข้อ 9–10 — archive ข้อมูลดิบเป็น Parquet · pg_dump → pg_restore ลง DB เปล่า

รัน: .venv/bin/pytest -m integration tests/test_archive_backup_api.py -v   (make up ก่อน · ข้อ 9 ใช้เวลาราว 1–2 นาที)

★ ข้อ 10 ฉีดข้อมูลสังเคราะห์ของวันเมื่อ 3 วันก่อน (seq = MARK) แล้วลบข้อมูล ไฟล์ และ manifest ทิ้งตอนจบ
★ ข้อ 9 กู้คืนลง container TimescaleDB ชั่วคราว (image เดียวกับของจริง · เปิด port เฉพาะ 127.0.0.1) แล้วเทียบ query ชุดเดียวกัน
  ข้อมูลที่ยังไหลเข้าระหว่าง dump เทียบไม่ได้ จึงเทียบเฉพาะแถวที่เกิดก่อนเริ่ม dump 30 วินาที (ingest หน่วงไม่เกิน 2 วินาที)
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import UTC, datetime, timedelta

import pandas as pd
import psycopg
import pytest

from tests.helpers import BACKEND, BKK

pytestmark = pytest.mark.integration
DAY = (datetime.now(BKK) - timedelta(days=3)).date()
DAY_START = datetime(DAY.year, DAY.month, DAY.day, tzinfo=BKK)
MARK = -6010
ARCHIVE = BACKEND / "data" / "archive"
BACKUP = BACKEND / "data" / "backup"
TIMESCALE = "timescale/timescaledb@sha256:3113d12b78392c064aa7475caf7a52b447b29ddd4f9bfd23526733fcb03e3459"
RESTORE_PORT = 55432
SYNTHETIC = ("meter_telemetry", "env_telemetry", "device_status")


def worker(*args: str, timeout: float = 900) -> dict:
    result = subprocess.run(["docker", "compose", "exec", "-T", "worker", "python", "-m", "api.worker", *args],
                            cwd=BACKEND, capture_output=True, text=True, timeout=timeout)
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])


# ─────────────── ข้อ 10 ───────────────

@pytest.fixture
def synthetic_day(db):
    day_end = DAY_START + timedelta(days=1)
    db.rows("""INSERT INTO meter_telemetry (time, entity_id, seq, pulse_count, volume_m3, flow_lpm, inlet_pressure_bar)
               SELECT %s + make_interval(secs => i * 60), 'meter-zone-1', %s, i, 1000 + i * 0.01, 5.5,
                      CASE WHEN i %% 2 = 0 THEN NULL ELSE 2.5 END
                 FROM generate_series(0, 1439) AS i ON CONFLICT DO NOTHING""", DAY_START, MARK)
    # ขอบวัน: 23:59:59.999 อยู่ในวันนั้น · 00:00 ของวันถัดไปไม่อยู่
    db.rows("""INSERT INTO meter_telemetry (time, entity_id, seq, volume_m3) VALUES
               (%s, 'meter-zone-1', %s, 1015), (%s, 'meter-zone-1', %s, 1016) ON CONFLICT DO NOTHING""",
            day_end - timedelta(milliseconds=1), MARK, day_end, MARK)
    db.rows("""INSERT INTO env_telemetry (time, entity_id, seq, temp_c, humidity_pct, lux)
               SELECT %s + make_interval(secs => i * 60), 'env-outdoor', %s, 30 + i %% 5, 70,
                      CASE WHEN i < 720 THEN NULL ELSE i END
                 FROM generate_series(0, 1439) AS i ON CONFLICT DO NOTHING""", DAY_START, MARK)
    db.rows("""INSERT INTO device_status (time, entity_id, seq, rssi, uptime_s, free_heap, reconnect_count, last_error)
               SELECT %s + make_interval(secs => i * 300), 'esp32-vip', %s, -60, i * 300, 150000, 0,
                      CASE WHEN i = 7 THEN 'ทดสอบ: wifi หลุด' END
                 FROM generate_series(0, 287) AS i ON CONFLICT DO NOTHING""", DAY_START, MARK)
    try:
        yield
    finally:
        for table in SYNTHETIC:
            db.rows(f"DELETE FROM {table} WHERE seq = %s AND time >= %s AND time <= %s", MARK, DAY_START, day_end)
        db.rows("DELETE FROM archive_manifest WHERE day = %s", DAY)
        subprocess.run(["docker", "compose", "exec", "-T", "worker", "sh", "-c",
                        f"rm -rf /data/archive/*/date={DAY.isoformat()}"], cwd=BACKEND, check=False, timeout=60)


def test_10_archive_writes_parquet_that_pandas_reads_back_with_the_same_row_counts(db, synthetic_day):
    result = worker("archive", "--day", DAY.isoformat())
    archived = {item["table"]: item for item in result["archived"]}
    day_end = DAY_START + timedelta(days=1)
    for table, item in archived.items():
        in_db = db.value(f"SELECT count(*) FROM {table} WHERE time >= %s AND time < %s", DAY_START, day_end)
        folder = ARCHIVE / table / f"date={DAY.isoformat()}"
        assert item["rows"] == in_db, table
        recorded = db.value("SELECT row_count FROM archive_manifest WHERE table_name = %s AND day = %s", table, DAY)
        assert recorded == in_db, table
        if in_db == 0:
            assert not any(folder.glob("*.parquet")), table
            continue
        frame = pd.read_parquet(folder)
        assert len(frame) == in_db, table
        assert str(frame["time"].dtype) == "datetime64[us, UTC]"

    assert archived["meter_telemetry"]["rows"] >= 1441        # 1,440 นาที + แถว 23:59:59.999 (00:00 วันถัดไปไม่นับ)
    meters = pd.read_parquet(ARCHIVE / "meter_telemetry" / f"date={DAY.isoformat()}")
    ours = meters[meters["seq"] == MARK]
    # null ยังเป็น null ไม่ใช่ 0 — นาทีคู่ 720 แถว + แถวขอบวันที่ไม่ได้ใส่แรงดัน
    assert len(ours) == 1441 and ours["inlet_pressure_bar"].isna().sum() == 721
    assert ours["time"].max() == pd.Timestamp(day_end - timedelta(milliseconds=1)).tz_convert(UTC)
    devices = pd.read_parquet(ARCHIVE / "device_status" / f"date={DAY.isoformat()}")
    assert "ทดสอบ: wifi หลุด" in set(devices["last_error"].dropna())

    nightly = worker("archive", "--dry-run")
    assert nightly["errors"] == [] and all(item["dropped"] == 0 for item in nightly["retention"])


# ─────────────── ข้อ 9 ───────────────

def restored_checks(conn: psycopg.Connection, before: datetime) -> dict[str, object]:
    queries = {
        "entities": ("SELECT count(*) FROM entities", ()),
        "settings": ("SELECT md5(string_agg(section || value::text, '|' ORDER BY section)) FROM settings", ()),
        "users": ("SELECT md5(string_agg(user_id || role || coalesce(password_hash, ''), '|' ORDER BY user_id)) "
                  "FROM users", ()),
        "interlock_rules": ("SELECT md5(string_agg(rule_id || enabled::text || params::text, '|' ORDER BY rule_id)) "
                            "FROM interlock_rules", ()),
        "water_cost": ("SELECT water_cost_at(45, DATE '2026-07-01')", ()),
        "alerts_before": ("SELECT count(*) FROM alerts WHERE started_at < %s", (before,)),
        "meter_rows": ("SELECT count(*), round(sum(volume_m3)::numeric, 3) FROM meter_telemetry WHERE time < %s",
                       (before,)),
        "tank_rows": ("SELECT count(*), round(sum(volume_l)::numeric, 1) FROM tank_telemetry WHERE time < %s",
                      (before,)),
        "power_rows": ("SELECT count(*) FROM power_telemetry WHERE time < %s", (before,)),
        "meter_hourly": ("SELECT count(*) FROM meter_1h WHERE bucket < %s", (before - timedelta(hours=2),)),
    }
    return {name: conn.execute(sql, params).fetchone() for name, (sql, params) in queries.items()}  # type: ignore[arg-type]


def test_9_backup_restores_into_an_empty_database_with_the_same_query_results(db, env):
    before = datetime.now(UTC) - timedelta(seconds=30)
    result = worker("backup", timeout=1800)
    assert result["status"] == "ok" and result["sizeBytes"] > 0, result
    dump = BACKUP / str(result["file"])
    assert dump.exists() and dump.stat().st_size == result["sizeBytes"]

    name = f"water-restore-check-{os.getpid()}"
    user, database = env["POSTGRES_USER"], env["POSTGRES_DB"]
    subprocess.run(["docker", "run", "-d", "--rm", "--name", name, "-e", f"POSTGRES_USER={user}",
                    "-e", f"POSTGRES_PASSWORD={env['POSTGRES_PASSWORD']}", "-e", f"POSTGRES_DB={database}",
                    "-p", f"127.0.0.1:{RESTORE_PORT}:5432", "-v", f"{BACKUP}:/backup:ro", TIMESCALE],
                   check=True, capture_output=True, timeout=300)
    try:
        deadline = time.monotonic() + 120
        # entrypoint รีสตาร์ตเซิร์ฟเวอร์หนึ่งครั้งหลัง init — รอให้ผ่าน TCP ได้ติดกันสองรอบ
        streak = 0
        while streak < 2:
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1", "-U", user,
                                    "-d", database], capture_output=True, timeout=30).returncode == 0
            streak = streak + 1 if ready else 0
            assert time.monotonic() < deadline, "container กู้คืนไม่พร้อมภายใน 2 นาที"
            time.sleep(2)

        def psql(sql: str) -> None:
            subprocess.run(["docker", "exec", name, "psql", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", user,
                            "-d", database, "-c", sql], check=True, capture_output=True, timeout=120,
                           env={**os.environ})

        psql("SELECT timescaledb_pre_restore();")
        restore = subprocess.run(["docker", "exec", "-e", f"PGPASSWORD={env['POSTGRES_PASSWORD']}", name, "pg_restore",
                                  "-h", "127.0.0.1", "-U", user, "-d", database, "--no-owner", f"/backup/{dump.name}"],
                                 capture_output=True, text=True, timeout=1800)
        psql("SELECT timescaledb_post_restore();")
        # extension timescaledb มีอยู่แล้วใน DB เปล่าของ image — ข้อผิดพลาดอื่นนอกจากนี้ถือว่ากู้ไม่สำเร็จ
        errors = [line for line in restore.stderr.splitlines()
                  if "error:" in line and "already exists" not in line and "timescaledb" not in line]
        assert not errors, restore.stderr[-2000:]

        with psycopg.connect(host="127.0.0.1", port=RESTORE_PORT, dbname=database, user=user,
                             password=env["POSTGRES_PASSWORD"], connect_timeout=5) as restored:
            copy = restored_checks(restored, before)
        with psycopg.connect(host="127.0.0.1", port=5432, dbname=database, user=user,
                             password=env["POSTGRES_PASSWORD"], connect_timeout=5) as live:
            original = restored_checks(live, before)
        print(f"\nข้อ 9: ไฟล์ {dump.name} {result['sizeBytes']:,} ไบต์ · meter ก่อนเริ่ม dump {original['meter_rows']}")
        assert original["meter_rows"][0] > 0                   # type: ignore[index]  มีข้อมูลจริงให้เทียบ
        assert copy == original
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=120)
        dump.unlink(missing_ok=True)
