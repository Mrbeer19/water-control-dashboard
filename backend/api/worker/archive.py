"""archive ข้อมูลดิบเป็น Parquet ก่อนลบ (PROMPT_06 งานที่ 5)

  ทุกคืนตามเวลาโรงงาน (worker):
    1. ทุกวันที่ chunk ดิบครอบ ซึ่งจบแล้วเกิน SETTLE_HOURS และยังไม่มีใน archive_manifest → Parquet หนึ่งไฟล์ต่อวันต่อตาราง
         /data/archive/<table>/date=YYYY-MM-DD/<table>-YYYY-MM-DD.parquet  (pandas.read_parquet อ่านทั้งโฟลเดอร์ได้)
       อ่านไฟล์กลับนับแถวเทียบกับที่เขียน ตรงแล้วจึงบันทึก manifest
    2. วันย้อนหลังไม่เกิน LATE_DAYS ที่จำนวนแถวใน DB ไม่เท่า manifest (ข้อมูลมาช้า) → เขียนวันนั้นใหม่ทั้งวัน
    3. ลบ chunk ดิบที่เก่ากว่า maintenance.dataRetentionDays (ขั้นต่ำ MIN_RETENTION_DAYS)
       ★ เฉพาะเมื่อทุกวันที่ chunk เหล่านั้นครอบมี manifest และจำนวนแถวยังตรงกับ DB — ขาดแม้วันเดียว = ไม่ลบตารางนั้น

★ ข้อมูลดิบคือสิ่งที่ทีม AI ใช้เทรน ลบแล้วเอาคืนไม่ได้ · ไฟล์เขียนเป็น .part แล้ว rename ถูก kill กลางทางไม่เหลือไฟล์ครึ่ง ๆ
★ ไล่วันตาม chunk ที่มีอยู่จริง ไม่ใช่นับถอยหลังจากวันนี้ — ข้อมูลเก่าแค่ไหนก็ต้องได้ archive ก่อนถูกลบ และช่วงว่างไม่เสียเวลา
★ chunk ตัดที่เที่ยงคืน UTC (07:00 เวลาไทย) หลังลบ วันที่คร่อมเส้นจะเหลือครึ่งวัน — วันก่อน archive_state.dropped_through
  ตรวจไปแล้วตอนลบรอบก่อน จึงไม่ตรวจและไม่เขียนทับด้วยข้อมูลครึ่งวัน
★ pyarrow import ตอนเขียนไฟล์เท่านั้น (มีใน image ของ worker) — ส่วนคำนวณวันทดสอบได้โดยไม่ต้องมี pyarrow
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

import psycopg

from .. import buckets as bk
from ..registry import Registry
from ..series import to_dt, to_ms_required

TABLES = ("tank_telemetry", "pump_telemetry", "meter_telemetry", "env_telemetry", "power_telemetry", "device_status")
ARCHIVE_DIR = Path(os.environ.get("ARCHIVE_DIR", "/data/archive"))
MIN_RETENTION_DAYS = 30
SETTLE_HOURS = 2            # วันที่เพิ่งจบยังไม่ archive — เผื่อ spool ของ ingest ส่งตามหลัง
LATE_DAYS = 14              # เท่ากับหน้าต่าง refresh ของ aggregate 5 นาที (D-24) — เก่ากว่านี้ไม่ควรมีข้อมูลมาช้า
BATCH_ROWS = 50_000
# ชนิดใน PostgreSQL → ชื่อ factory ของ pyarrow · ชนิดอื่น (numeric · jsonb) เก็บเป็นข้อความ ไม่ทิ้งข้อมูล
ARROW_TYPES = {"timestamp with time zone": "timestamp", "double precision": "float64", "real": "float32",
               "bigint": "int64", "integer": "int32", "smallint": "int16", "boolean": "bool_", "text": "string",
               "character varying": "string"}


class ArchiveError(RuntimeError):
    pass


def arrow_type_name(pg_type: str) -> str:
    return ARROW_TYPES.get(pg_type, "string")


def day_bounds(day: date, tz: str) -> tuple[int, int]:
    start = bk.zoned_time_to_ms((day.year, day.month, day.day, 0, 0, 0), tz)
    return start, bk.next_bucket_start(start, "day", tz)


def local_day(moment_ms: int, tz: str) -> date:
    y, m, d, *_ = bk.zoned_parts(moment_ms, tz)
    return date(y, m, d)


def days_between(start_ms: int, end_ms: int, tz: str) -> list[date]:
    """วันตามเวลาโรงงานที่ทับช่วง [start, end)"""
    days: list[date] = []
    day = local_day(start_ms, tz)
    while day_bounds(day, tz)[0] < end_ms:
        days.append(day)
        day += timedelta(days=1)
    return days


def retention_cutoff(now_ms: int, retention_days: int, tz: str) -> int:
    """เที่ยงคืนตามเวลาโรงงานของวันที่ย้อนไป retention วัน (ไม่ต่ำกว่า MIN_RETENTION_DAYS)"""
    keep = max(MIN_RETENTION_DAYS, retention_days)
    return day_bounds(local_day(now_ms, tz) - timedelta(days=keep), tz)[0]


def straddles(day: date, dropped_through: int | None, tz: str) -> bool:
    """วันที่เส้นลบรอบก่อนผ่ากลางวัน — ข้อมูลครึ่งแรกถูกลบไปแล้วหลังตรวจครบทั้งวัน"""
    if dropped_through is None:
        return False
    start, end = day_bounds(day, tz)
    return start < dropped_through < end


def days_to_verify(chunks: list[tuple[int, int]], dropped_through: int | None, tz: str) -> list[date]:
    """วันที่ chunk ครอบ (ข้ามช่วงที่ไม่มี chunk) ยกเว้นวันที่เส้นลบรอบก่อนผ่ากลาง
    ★ วันที่เก่ากว่าเส้นลบแต่มี chunk อยู่ = ข้อมูลที่เพิ่งนำเข้าย้อนหลัง ต้องตรวจ/archive ใหม่ ห้ามปล่อยให้ถูกลบเงียบ ๆ
    """
    days = {day for start, end in chunks for day in days_between(start, end, tz)}
    return sorted(day for day in days if not straddles(day, dropped_through, tz))


def last_complete_day(now_ms: int, tz: str) -> date:
    return local_day(now_ms - SETTLE_HOURS * bk.MS_HOUR, tz) - timedelta(days=1)


def file_path(table: str, day: date) -> Path:
    return ARCHIVE_DIR / table / f"date={day.isoformat()}" / f"{table}-{day.isoformat()}.parquet"


# ─────────────── DB ───────────────

def columns(conn: psycopg.Connection, table: str) -> list[tuple[str, str]]:
    rows = conn.execute("""SELECT column_name, data_type FROM information_schema.columns
                            WHERE table_schema = 'public' AND table_name = %s ORDER BY ordinal_position""",
                        (table,)).fetchall()
    return [(str(name), str(pg_type)) for name, pg_type in rows]


def chunk_ranges(conn: psycopg.Connection, table: str, older_than_ms: int | None = None) -> list[tuple[int, int]]:
    rows = conn.execute("""
        SELECT range_start, range_end FROM timescaledb_information.chunks
         WHERE hypertable_schema = 'public' AND hypertable_name = %s AND (%s::timestamptz IS NULL OR range_end <= %s)
         ORDER BY range_start""", (table, None if older_than_ms is None else to_dt(older_than_ms),
                                   None if older_than_ms is None else to_dt(older_than_ms))).fetchall()
    return [(to_ms_required(start), to_ms_required(end)) for start, end in rows]


def count_day(conn: psycopg.Connection, table: str, day: date, tz: str) -> int:
    start, end = day_bounds(day, tz)
    row = conn.execute(f"SELECT count(*) FROM {table} WHERE time >= %s AND time < %s", (to_dt(start), to_dt(end)))
    return int(row.fetchone()[0])  # type: ignore[index]


def manifest(conn: psycopg.Connection, table: str) -> dict[date, int]:
    rows = conn.execute("SELECT day, row_count FROM archive_manifest WHERE table_name = %s", (table,)).fetchall()
    return {day: int(count) for day, count in rows}


def dropped_through(conn: psycopg.Connection, table: str) -> int | None:
    row = conn.execute("SELECT dropped_through FROM archive_state WHERE table_name = %s", (table,)).fetchone()
    return None if row is None else to_ms_required(row[0])


# ─────────────── เขียน Parquet ───────────────

def write_day(conn: psycopg.Connection, table: str, day: date, tz: str) -> tuple[int, Path | None, int]:
    """เขียนข้อมูลดิบหนึ่งวันทีละ BATCH_ROWS แถว (server-side cursor) · คืน (แถว, ไฟล์, ขนาด) · วันที่ไม่มีข้อมูลไม่สร้างไฟล์"""
    import pyarrow as pa
    import pyarrow.parquet as pq

    fields = []
    select = []
    for name, pg_type in columns(conn, table):
        kind = arrow_type_name(pg_type)
        fields.append((name, pa.timestamp("us", tz="UTC") if kind == "timestamp" else getattr(pa, kind)()))
        select.append(f"{name}::text" if kind == "string" and pg_type not in ("text", "character varying") else name)
    schema = pa.schema(fields)
    start, end = day_bounds(day, tz)
    target = file_path(table, day)
    partial = target.with_name(target.name + ".part")
    rows = 0
    writer = None
    try:
        with conn.transaction(), conn.cursor(name=f"archive_{table}") as cur:
            cur.execute(f"SELECT {', '.join(select)} FROM {table} WHERE time >= %s AND time < %s ORDER BY time",
                        (to_dt(start), to_dt(end)))
            while batch := cur.fetchmany(BATCH_ROWS):
                if writer is None:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    writer = pq.ParquetWriter(partial, schema, compression="zstd")
                arrays = [pa.array(list(values), type=field.type)
                          for values, field in zip(zip(*batch, strict=True), schema, strict=True)]
                writer.write_batch(pa.RecordBatch.from_arrays(arrays, schema=schema))
                rows += len(batch)
    except BaseException:
        if writer is not None:
            writer.close()
        partial.unlink(missing_ok=True)
        raise
    if writer is not None:
        writer.close()
    if rows == 0:
        target.unlink(missing_ok=True)
        return 0, None, 0
    written = pq.ParquetFile(partial).metadata.num_rows
    if written != rows:
        partial.unlink(missing_ok=True)
        raise ArchiveError(f"{table} {day}: อ่านไฟล์กลับได้ {written} แถว แต่เขียนไป {rows} แถว")
    os.replace(partial, target)
    return rows, target, target.stat().st_size


def archive_day(conn: psycopg.Connection, table: str, day: date, tz: str) -> dict[str, object]:
    rows, path, size = write_day(conn, table, day, tz)
    conn.execute("""
        INSERT INTO archive_manifest (table_name, day, row_count, file_path, size_bytes)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (table_name, day) DO UPDATE SET row_count = EXCLUDED.row_count, file_path = EXCLUDED.file_path,
                                                    size_bytes = EXCLUDED.size_bytes, archived_at = now()""",
                 (table, day, rows, None if path is None else str(path.relative_to(ARCHIVE_DIR)), size))
    return {"table": table, "day": day.isoformat(), "rows": rows, "sizeBytes": size}


def archive_table(conn: psycopg.Connection, table: str, tz: str, now_ms: int,
                  cutoff_ms: int) -> list[dict[str, object]]:
    """archive วันที่ยังไม่มี · เขียนใหม่เมื่อจำนวนแถวเปลี่ยนในวันล่าสุด LATE_DAYS วัน หรือวันที่กำลังจะถูกลบ (≤ cutoff)"""
    done = manifest(conn, table)
    recent = local_day(now_ms, tz) - timedelta(days=LATE_DAYS)
    last = last_complete_day(now_ms, tz)
    results = []
    for day in days_to_verify(chunk_ranges(conn, table), dropped_through(conn, table), tz):
        if day > last:
            break
        if day not in done:
            results.append(archive_day(conn, table, day, tz))
        elif (day >= recent or day_bounds(day, tz)[1] <= cutoff_ms) and count_day(conn, table, day, tz) != done[day]:
            results.append({**archive_day(conn, table, day, tz), "reason": "rows_changed"})
    return results


# ─────────────── ลบข้อมูลดิบที่ archive แล้ว ───────────────

def apply_retention(conn: psycopg.Connection, table: str, tz: str, now_ms: int, retention_days: int,
                    dry_run: bool = False) -> dict[str, object]:
    cutoff = retention_cutoff(now_ms, retention_days, tz)
    chunks = chunk_ranges(conn, table, older_than_ms=cutoff)
    result: dict[str, object] = {"table": table, "cutoff": to_dt(cutoff).isoformat(), "chunks": len(chunks)}
    if not chunks:
        return {**result, "dropped": 0}
    done = manifest(conn, table)
    blocked = [day.isoformat() for day in days_to_verify(chunks, dropped_through(conn, table), tz)
               if day not in done or count_day(conn, table, day, tz) != done[day]]
    if blocked:
        return {**result, "dropped": 0, "blocked": blocked}      # ★ archive ไม่ครบ = ไม่ลบ
    if dry_run:
        return {**result, "dropped": 0, "dryRun": True}
    dropped = conn.execute("SELECT count(*) FROM drop_chunks(%s::regclass, older_than => %s::timestamptz)",
                           (table, to_dt(cutoff))).fetchone()[0]  # type: ignore[index]
    conn.execute("""INSERT INTO archive_state (table_name, dropped_through) VALUES (%s, %s)
                    ON CONFLICT (table_name) DO UPDATE SET dropped_through = EXCLUDED.dropped_through,
                                                           updated_at = now()""",
                 (table, to_dt(max(end for _, end in chunks))))
    return {**result, "dropped": int(dropped)}


def run_nightly(conn: psycopg.Connection, reg: Registry, now_ms: int, dry_run: bool = False) -> dict[str, object]:
    """archive ทุกตาราง แล้วจึงลบ · ตารางที่ archive ล้มเหลวจะถูกกันไม่ให้ลบเองเพราะ manifest ไม่ครบ"""
    tz = reg.timezone
    retention = int(reg.setting("maintenance", "dataRetentionDays", 365))  # type: ignore[call-overload]
    cutoff = retention_cutoff(now_ms, retention, tz)
    archived: list[dict[str, object]] = []
    retained: list[dict[str, object]] = []
    errors: list[str] = []
    for table in TABLES:
        try:
            archived += archive_table(conn, table, tz, now_ms, cutoff)
        except (ArchiveError, OSError) as exc:
            errors.append(f"{table}: {exc}")
        retained.append(apply_retention(conn, table, tz, now_ms, retention, dry_run))
    return {"archived": archived, "retention": retained, "errors": errors}
