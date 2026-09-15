-- ═════════════════════════════════════════════════════════════
-- 02_telemetry.sql — hypertable ของค่าวัด
-- ★ คอลัมน์ค่าวัดทุกตัว NULLABLE: null = อ่านไม่ได้/ไม่มีเซนเซอร์ ไม่ใช่ 0
-- ★ เก็บทั้ง time (นาฬิกาอุปกรณ์) และ recv_time (นาฬิกาเซิร์ฟเวอร์)
--   นาฬิกาบอร์ดเพี้ยนได้ ถ้าเก็บเวลาเดียวข้อมูลจะไปโผล่ผิดที่บนกราฟโดยไม่มีใครรู้
-- ★ PK รวม time ไว้ → QoS 1 ส่งซ้ำแล้ว ON CONFLICT DO NOTHING กันแถวซ้ำให้เอง
-- ═════════════════════════════════════════════════════════════

CREATE TABLE tank_telemetry (
  time            TIMESTAMPTZ NOT NULL,
  recv_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id       TEXT NOT NULL REFERENCES entities(entity_id),
  seq             BIGINT,
  level_m         DOUBLE PRECISION,
  volume_l        DOUBLE PRECISION,
  profile_version INT,
  flow_in_lpm     DOUBLE PRECISION,
  flow_out_lpm    DOUBLE PRECISION,
  PRIMARY KEY (entity_id, time)
);

CREATE TABLE pump_telemetry (
  time         TIMESTAMPTZ NOT NULL,
  recv_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id    TEXT NOT NULL REFERENCES entities(entity_id),
  seq          BIGINT,
  voltage      DOUBLE PRECISION,
  current      DOUBLE PRECISION,
  power_w      DOUBLE PRECISION,
  energy_kwh   DOUBLE PRECISION,                    -- ตัวนับสะสม
  flow_lpm     DOUBLE PRECISION,
  pressure_bar DOUBLE PRECISION,
  vfd_hz       DOUBLE PRECISION,
  run_state    TEXT,
  PRIMARY KEY (entity_id, time)
);

CREATE TABLE meter_telemetry (
  time               TIMESTAMPTZ NOT NULL,
  recv_time          TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id          TEXT NOT NULL REFERENCES entities(entity_id),
  seq                BIGINT,
  pulse_count        BIGINT,                        -- ตัวนับสะสม
  volume_m3          DOUBLE PRECISION,              -- ตัวนับสะสม
  flow_lpm           DOUBLE PRECISION,
  inlet_pressure_bar DOUBLE PRECISION,
  PRIMARY KEY (entity_id, time)
);

CREATE TABLE env_telemetry (
  time         TIMESTAMPTZ NOT NULL,
  recv_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id    TEXT NOT NULL REFERENCES entities(entity_id),
  seq          BIGINT,
  temp_c       DOUBLE PRECISION,
  humidity_pct DOUBLE PRECISION,
  pressure_hpa DOUBLE PRECISION,                    -- ในอาคารไม่มี barometer → null
  lux          DOUBLE PRECISION,                    -- ในอาคารไม่มี light sensor → null
  rain_mm      DOUBLE PRECISION,                    -- ปริมาณฝนต่อรอบส่ง (ไม่ใช่ค่าสะสม)
  heat_index_c DOUBLE PRECISION,                    -- derive ตอน ingest จาก temp + humidity
  PRIMARY KEY (entity_id, time)
);

-- ★ ตู้ 3 เฟสส่ง 3 แถวต่อรอบ จึงต้องมี phase ใน PK
-- ★ ingest เขียนแถว phase='total' (ยอดรวมทั้งตู้ ณ เวลาเดียวกัน) เพิ่มให้ตู้ 3 เฟส
--   ตู้เฟสเดียวใช้แถว 'single' เป็นยอดทั้งตู้ได้เลย · ห้าม SUM ข้ามเฟสเองตอน query (จะนับ total ซ้ำ)
CREATE TABLE power_telemetry (
  time       TIMESTAMPTZ NOT NULL,
  recv_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  phase      TEXT NOT NULL CHECK (phase IN ('L1', 'L2', 'L3', 'single', 'total')),
  seq        BIGINT,
  voltage    DOUBLE PRECISION,
  current    DOUBLE PRECISION,
  power_w    DOUBLE PRECISION,
  energy_kwh DOUBLE PRECISION,                      -- ตัวนับสะสมต่อเฟส
  pf         DOUBLE PRECISION,
  frequency  DOUBLE PRECISION,
  PRIMARY KEY (entity_id, phase, time)
);

CREATE TABLE device_status (
  time            TIMESTAMPTZ NOT NULL,
  recv_time       TIMESTAMPTZ NOT NULL DEFAULT now(),
  entity_id       TEXT NOT NULL REFERENCES entities(entity_id),   -- entity ชนิด device
  seq             BIGINT,
  rssi            DOUBLE PRECISION,
  uptime_s        DOUBLE PRECISION,                 -- ตัวนับ รีเซ็ตทุกครั้งที่บอร์ดรีบูต
  free_heap       DOUBLE PRECISION,
  reconnect_count INT,
  last_error      TEXT,
  PRIMARY KEY (entity_id, time)
);

-- chunk ละ 1 วัน: 1.21 ล้านแถว/วันทั้งระบบ แบ่งเป็นก้อนเล็กพอให้ compression/retention ทำงานเป็นวัน
-- ไม่สร้าง index (entity_id, time DESC) เพิ่ม เพราะ PK (entity_id, time) ครอบการ scan สองทิศทางอยู่แล้ว
SELECT create_hypertable('tank_telemetry',  'time', chunk_time_interval => INTERVAL '1 day');
SELECT create_hypertable('pump_telemetry',  'time', chunk_time_interval => INTERVAL '1 day');
SELECT create_hypertable('meter_telemetry', 'time', chunk_time_interval => INTERVAL '1 day');
SELECT create_hypertable('env_telemetry',   'time', chunk_time_interval => INTERVAL '1 day');
SELECT create_hypertable('power_telemetry', 'time', chunk_time_interval => INTERVAL '1 day');
SELECT create_hypertable('device_status',   'time', chunk_time_interval => INTERVAL '1 day');

-- ค่าระดับทั้งโรงงานที่ worker คำนวณ (เฟส 6) — หนึ่งแถวต่อหนึ่งหน้าต่างที่ประเมิน · time = ปลายหน้าต่าง
-- ★ unaccounted_* เป็น null เมื่อมิเตอร์/ถังตัวใดไม่มีข้อมูลในหน้าต่าง (ไม่ตัดสิน ไม่ใช่ 0)
CREATE TABLE plant_metrics (
  time                TIMESTAMPTZ NOT NULL,
  entity_id           TEXT NOT NULL REFERENCES entities(entity_id),
  window_minutes      INT NOT NULL,
  main_m3             DOUBLE PRECISION,
  zone_m3             DOUBLE PRECISION,
  storage_delta_m3    DOUBLE PRECISION,                  -- Δ ปริมาณน้ำทุกถังรวมบ่อสำรอง
  unaccounted_m3      DOUBLE PRECISION,
  unaccounted_percent DOUBLE PRECISION,
  PRIMARY KEY (entity_id, time)
);
SELECT create_hypertable('plant_metrics', 'time', chunk_time_interval => INTERVAL '30 days');
