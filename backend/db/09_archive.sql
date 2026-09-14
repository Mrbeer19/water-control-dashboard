-- ═════════════════════════════════════════════════════════════
-- 09_archive.sql — archive ข้อมูลดิบ · สำรองฐานข้อมูล · retention (เฟส 6)
-- ═════════════════════════════════════════════════════════════

-- ข้อมูลดิบที่ archive เป็น Parquet แล้ว — หนึ่งแถวต่อ (ตาราง, วันตามเวลาโรงงาน)
-- ★ worker ลบ chunk ดิบได้ก็ต่อเมื่อทุกวันที่ chunk ครอบมีแถวที่นี่และจำนวนแถวยังตรงกับ DB
CREATE TABLE archive_manifest (
  table_name  TEXT NOT NULL,
  day         DATE NOT NULL,
  row_count   BIGINT NOT NULL,
  file_path   TEXT,                                   -- สัมพัทธ์กับ ARCHIVE_DIR · null = วันนั้นไม่มีข้อมูล
  size_bytes  BIGINT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, day)
);

-- เส้นที่ลบ chunk ดิบไปแล้ว — วันก่อนเส้นนี้ถูกตรวจไปแล้วตอนลบ ไม่ตรวจซ้ำ
CREATE TABLE archive_state (
  table_name      TEXT PRIMARY KEY,
  dropped_through TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE backup_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL,                          -- running | ok | failed
  file_name   TEXT,
  size_bytes  BIGINT,
  db_bytes    BIGINT,                                 -- ขนาดฐานข้อมูลตอนเริ่ม ใช้เทียบสัดส่วนกับครั้งก่อน
  error       TEXT
);

-- ─────────────── retention ของ aggregate ───────────────
-- ★ ข้อมูลดิบไม่ใช้ policy — worker ลบเองหลังตรวจ archive (api/worker/archive.py)
-- ★ retention ของชั้นล่างต้องยาวกว่า start_offset ของ refresh ชั้นบน (1 ชม. refresh 60 วัน < 5 นาทีเก็บ 90 วัน)
--   ไม่งั้นการ refresh ชั้นบนจะลบ bucket ที่ชั้นล่างถูกลบไปแล้วทิ้ง · ชั้น 1 วันเก็บถาวร
SELECT add_retention_policy(view_name::regclass, INTERVAL '90 days')
  FROM timescaledb_information.continuous_aggregates WHERE view_name LIKE '%\_5m';
SELECT add_retention_policy(view_name::regclass, INTERVAL '730 days')
  FROM timescaledb_information.continuous_aggregates WHERE view_name LIKE '%\_1h';
