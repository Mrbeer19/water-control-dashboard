"""สร้าง db/07_caggs.sql จาก api/metric_registry.py

รัน: cd backend && .venv/bin/python scripts/gen_caggs.py
★ ห้ามแก้ db/07_caggs.sql ด้วยมือ — แก้ทะเบียนแล้วรันสคริปต์นี้ใหม่

กฎที่ฝังในทุกชั้น (PROMPT_03):
  1. เก็บ sum + count ไม่เก็บ avg  → ชั้นบนคิด avg = sum(sum) / sum(count) ถ่วงน้ำหนักถูกต้อง
  2. time_bucket ใส่เขตเวลาทุกครั้ง (อ่านจาก settings.general.timezone ตอนสร้าง)
  3. counter เก็บค่าสุดท้ายของช่วง  → API คิด delta = last(N) − last(N−1) ข้าม bucket
  4. min_at/max_at ใช้ first(time, ค่า) / last(time, ค่า) = argmin/argmax ในตัว
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.metric_registry import AMOUNT, COUNTER, GAUGE, LEVEL, LEVELS, SOURCES, Measure, cagg_name  # noqa: E402

TARGET = Path(__file__).resolve().parents[1] / "db" / "07_caggs.sql"


def raw_columns(m: Measure) -> list[str]:
    e, k = m.expr, m.key
    not_null = f"FILTER (WHERE ({e}) IS NOT NULL)"
    cols: list[str] = []
    if m.kind in (GAUGE, LEVEL):
        cols += [f"sum({e}) AS {k}_sum", f"count({e}) AS {k}_n", f"min({e}) AS {k}_min", f"max({e}) AS {k}_max",
                 f"first(time, {e}) {not_null} AS {k}_min_at", f"last(time, {e}) {not_null} AS {k}_max_at"]
    if m.kind == LEVEL:
        cols.append(f"last({e}, time) {not_null} AS {k}_last")
    if m.kind == COUNTER:
        cols += [f"count({e}) AS {k}_n", f"last({e}, time) {not_null} AS {k}_last",
                 f"first({e}, time) {not_null} AS {k}_first"]
    if m.kind == AMOUNT:
        cols += [f"sum({e}) AS {k}_sum", f"max({e}) AS {k}_max", f"count({e}) AS {k}_n"]
    return cols


def rollup_columns(m: Measure) -> list[str]:
    k = m.key
    cols: list[str] = []
    if m.kind in (GAUGE, LEVEL):
        cols += [f"sum({k}_sum) AS {k}_sum", f"sum({k}_n) AS {k}_n", f"min({k}_min) AS {k}_min",
                 f"max({k}_max) AS {k}_max",
                 f"first({k}_min_at, {k}_min) FILTER (WHERE {k}_min IS NOT NULL) AS {k}_min_at",
                 f"last({k}_max_at, {k}_max) FILTER (WHERE {k}_max IS NOT NULL) AS {k}_max_at"]
    if m.kind == LEVEL:
        cols.append(f"last({k}_last, bucket) FILTER (WHERE {k}_last IS NOT NULL) AS {k}_last")
    if m.kind == COUNTER:
        cols += [f"sum({k}_n) AS {k}_n",
                 f"last({k}_last, bucket) FILTER (WHERE {k}_last IS NOT NULL) AS {k}_last",
                 f"first({k}_first, bucket) FILTER (WHERE {k}_first IS NOT NULL) AS {k}_first"]
    if m.kind == AMOUNT:
        cols += [f"sum({k}_sum) AS {k}_sum", f"max({k}_max) AS {k}_max", f"sum({k}_n) AS {k}_n"]
    return cols


def view(name: str, width: str, source_sql: str, time_col: str, columns: list[str], where: str | None) -> str:
    body = ",\n       ".join(columns)
    where_sql = f"\n WHERE {where}" if where else ""
    return (f"CREATE MATERIALIZED VIEW {name}\n"
            f"WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS\n"
            f"SELECT time_bucket('{width}', {time_col}, :'tz') AS bucket, entity_id,\n"
            f"       {body}\n"
            f"  FROM {source_sql}{where_sql}\n"
            f" GROUP BY 1, 2\n"
            f"WITH NO DATA;\n")


def main() -> None:
    parts = [
        "-- ═════════════════════════════════════════════════════════════",
        "-- 07_caggs.sql — continuous aggregate 3 ชั้น: raw → 5 นาที → 1 ชม. → 1 วัน",
        "-- ★ สร้างอัตโนมัติด้วย scripts/gen_caggs.py จาก api/metric_registry.py — ห้ามแก้มือ",
        "-- ★ ต้องรันหลัง 06_seed.sql เพราะอ่านเขตเวลาจาก settings.general.timezone",
        "--   เปลี่ยนเขตเวลาภายหลัง = ต้องสร้าง aggregate ใหม่ทั้งหมด (ตรวจได้จาก aggregate_config)",
        "-- ═════════════════════════════════════════════════════════════",
        "",
        "SELECT value ->> 'timezone' AS tz FROM settings WHERE section = 'general' \\gset",
        "",
        "CREATE TABLE aggregate_config (",
        "  id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- มีได้แถวเดียว",
        "  timezone   TEXT NOT NULL,",
        "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
        ");",
        "INSERT INTO aggregate_config (timezone) VALUES (:'tz');",
        "",
    ]
    for key, source in SOURCES.items():
        parts.append(f"-- ─────────────── {key} ({source.table}) ───────────────")
        raw_cols = ["count(*) AS n_rows"] + [c for m in source.measures for c in raw_columns(m)]
        roll_cols = ["sum(n_rows) AS n_rows"] + [c for m in source.measures for c in rollup_columns(m)]
        (lvl0, width0), *upper = LEVELS
        parts.append(view(cagg_name(key, lvl0), width0, source.table, "time", raw_cols, source.where))
        child = cagg_name(key, lvl0)
        for level, width in upper:
            parts.append(view(cagg_name(key, level), width, child, "bucket", roll_cols, None))
            child = cagg_name(key, level)
    TARGET.write_text("\n".join(parts), encoding="utf-8")
    print(f"เขียน {TARGET} ({len(SOURCES) * len(LEVELS)} view)")


if __name__ == "__main__":
    main()
