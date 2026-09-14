-- ═════════════════════════════════════════════════════════════
-- 01_schema.sql — ทะเบียน + ตารางที่ไม่ใช่ time-series
-- ★ id ทุกตัวใช้สตริงชุดเดียวกับหน้าบ้าน ('zone-1', 'pump-1', …)
--   เพราะ lib/types.ts ใช้ id เป็น string และ service layer ส่ง id นี้มาตรง ๆ
-- ═════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─────────────── ทะเบียน ───────────────

CREATE TABLE departments (
  department_id    TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  name_en          TEXT NOT NULL,
  cost_center_code TEXT,
  manager_user_id  TEXT,
  active           BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE zones (
  zone_id       TEXT PRIMARY KEY,
  zone_number   INT NOT NULL,
  name_th       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  area_th       TEXT,
  area_en       TEXT,
  department_id TEXT REFERENCES departments(department_id),
  quota_m3_day  NUMERIC,
  is_vip        BOOLEAN NOT NULL DEFAULT false      -- ★ ห้ามตัดน้ำอัตโนมัติ
);

CREATE TABLE devices (
  device_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  kind        TEXT NOT NULL,                        -- esp32 | plc | hmi | gateway
  role        TEXT NOT NULL,
  model       TEXT,
  ip          INET,
  mac         MACADDR,
  vlan        INT,
  port        INT,
  protocol    TEXT NOT NULL,                        -- ทางขึ้น: mqtt | s7comm | mc_protocol | modbus_tcp
  fieldbus    TEXT,                                 -- ★ คนละเรื่องกับ protocol: modbus_rtu | NULL
  link_type   TEXT,                                 -- wifi | ethernet | serial
  firmware    TEXT,
  location    TEXT,
  location_en TEXT,
  expansion_modules TEXT[] NOT NULL DEFAULT '{}',   -- โมดูลที่เสียบอยู่ เช่น PZEM, SM1231
  active      BOOLEAN NOT NULL DEFAULT true
);

-- ★ สิ่งที่ถูกวัด/ถูกสั่ง · node 1 ตัวอ่านได้หลาย entity
CREATE TABLE entities (
  entity_id   TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,                        -- ตรงกับ MetricSourceType ใน lib/types.ts
  device_id   TEXT REFERENCES devices(device_id),   -- ★ nullable: Tank.deviceId เป็น null ได้
  zone_id     TEXT REFERENCES zones(zone_id),
  name        TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  spec        JSONB NOT NULL DEFAULT '{}'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX entities_source_type_idx ON entities (source_type);
CREATE INDEX entities_zone_idx ON entities (zone_id);

-- ตารางเทียบระดับ → ปริมาตร (บ่อสำรองผนังลาด ใช้ level × area ไม่ได้)
CREATE TABLE tank_profiles (
  entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  version   INT NOT NULL DEFAULT 1,
  level_m   NUMERIC NOT NULL,
  volume_l  NUMERIC NOT NULL,
  PRIMARY KEY (entity_id, version, level_m)
);

CREATE TABLE thresholds (
  entity_id TEXT NOT NULL REFERENCES entities(entity_id),
  metric    TEXT NOT NULL,
  warn_low  NUMERIC,
  warn_high NUMERIC,
  crit_low  NUMERIC,
  crit_high NUMERIC,
  PRIMARY KEY (entity_id, metric)
);

-- ★ เก็บประวัติอัตรา ไม่ทับของเก่า — รายงานย้อนหลังต้องคิดด้วยอัตรา ณ วันนั้น
CREATE TABLE tariffs (
  tariff_id      SERIAL PRIMARY KEY,
  kind           TEXT NOT NULL,                     -- water | electricity (ตรงกับ UtilityKind)
  effective_from DATE NOT NULL,
  config         JSONB NOT NULL,
  UNIQUE (kind, effective_from)
);

CREATE TABLE meter_readings (
  reading_id  BIGSERIAL PRIMARY KEY,
  entity_id   TEXT NOT NULL REFERENCES entities(entity_id),
  read_on     DATE NOT NULL,
  meter_value NUMERIC NOT NULL,
  source      TEXT NOT NULL DEFAULT 'utility',      -- utility | staff | auto (MeterReadingSource)
  recorded_by TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX meter_readings_entity_idx ON meter_readings (entity_id, read_on DESC);

-- ด่านตรวจคำสั่ง — ★ เปิด/ปิด พารามิเตอร์ และข้อความอยู่ที่นี่ · โค้ด (api/interlock.py) มีแค่วิธีตรวจตาม check_name
CREATE TABLE interlock_rules (
  rule_id       TEXT PRIMARY KEY,                   -- รหัสที่หน้าจอเห็น เช่น SOURCE_TANK_LOW
  target_kind   TEXT NOT NULL,                      -- pump | valve | pressure_control | system | any
  check_name    TEXT NOT NULL,                      -- ไม่รู้จักชื่อ = ระงับคำสั่ง (fail-closed)
  actions       TEXT[] NOT NULL DEFAULT '{}',       -- คำสั่งที่กฎนี้คุม · ว่าง = ทุกคำสั่ง
  params        JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_th    TEXT NOT NULL,                      -- {ตัวแปร} เติมจากผลการตรวจ
  message_en    TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 100,
  blocks_auto   BOOLEAN NOT NULL DEFAULT true,      -- ใช้กับคำสั่งจากตารางเวลา
  blocks_manual BOOLEAN NOT NULL DEFAULT false      -- ใช้กับคนสั่ง
);

CREATE TABLE settings (
  section    TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE users (
  user_id       TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  pin_hash      TEXT,                               -- PIN 4 หลักก่อนสั่งงาน (argon2) · make password NAME=… PIN=1
  role          TEXT NOT NULL,                      -- viewer | operator | admin
  display_name  TEXT NOT NULL,
  department_id TEXT REFERENCES departments(department_id),
  active        BOOLEAN NOT NULL DEFAULT true
);

-- ─────────────── ตารางเหตุการณ์ (ไม่ใช่ time-series) ───────────────

-- ★ หัวใจของ kind:'state' · span ที่ยังไม่จบมีได้แค่ตัวเดียวต่อ (entity, metric)
-- เซสชันผู้ใช้ — ★ เก็บเฉพาะ sha256 ของ token ใน cookie · DB หลุดก็ใช้สวมรอยไม่ได้
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  ip           TEXT,
  control_unlocked_until TIMESTAMPTZ                -- ใส่ PIN ผ่านแล้ว สั่งงานได้ถึงเวลานี้
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ล็อกอินไม่ผ่าน — นับต่อชื่อผู้ใช้ (รวมชื่อที่ไม่มีจริง) ไว้ล็อกชั่วคราว
CREATE TABLE login_failures (
  id       BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip       TEXT
);
CREATE INDEX login_failures_user_idx ON login_failures (username, at DESC);

-- ความลับของค่าตั้ง เช่น LINE Channel Access Token — ★ API ห้ามส่งค่ากลับไม่ว่ากรณีใด
CREATE TABLE settings_secrets (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

-- ค่าตั้งต้นจากโรงงาน — 06_seed.sql คัดลอกไว้ตอนติดตั้ง · POST /api/settings/reset คืนค่าชุดนี้
CREATE TABLE settings_factory (section TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE thresholds_factory (LIKE thresholds INCLUDING DEFAULTS);
CREATE TABLE tariffs_factory (kind TEXT PRIMARY KEY, config JSONB NOT NULL);

CREATE TABLE state_spans (
  span_id    BIGSERIAL PRIMARY KEY,
  entity_id  TEXT NOT NULL REFERENCES entities(entity_id),
  metric     TEXT NOT NULL,                         -- pump_run_state | online_state | valve_position
  state      TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX state_spans_open_uq ON state_spans (entity_id, metric) WHERE ended_at IS NULL;
CREATE INDEX state_spans_lookup_idx ON state_spans (entity_id, metric, started_at DESC);

CREATE TABLE counter_resets (
  id           BIGSERIAL PRIMARY KEY,
  entity_id    TEXT NOT NULL REFERENCES entities(entity_id),
  metric       TEXT NOT NULL,
  phase        TEXT,                                -- เฉพาะตู้ไฟ (ตัวนับแยกต่อเฟส)
  at           TIMESTAMPTZ NOT NULL,
  value_before DOUBLE PRECISION,
  value_after  DOUBLE PRECISION
);
-- ★ unique เพื่อให้ ingest replay spool ซ้ำได้โดยไม่เกิดแถวซ้ำ
CREATE UNIQUE INDEX counter_resets_uq ON counter_resets (entity_id, metric, COALESCE(phase, ''), at);

CREATE TABLE commands (
  command_id    UUID PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  target_kind   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  payload       JSONB,
  issued_by     TEXT NOT NULL,                      -- user id หรือ 'schedule:<id>' (นับเป็นระบบอัตโนมัติ)
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'awaiting_feedback', 'confirmed', 'timeout', 'rejected')),
  reject_reason TEXT,
  confirmed_at  TIMESTAMPTZ,
  latency_ms    INT,                                -- ตั้งแต่กดจนอุปกรณ์ยืนยัน
  reject_code   TEXT,                               -- rule_id ของด่านที่ปฏิเสธ · CONFIRMATION_REQUIRED · BROKER_UNAVAILABLE
  reason        TEXT,                               -- เหตุผลที่ผู้สั่งกรอก
  requires_confirmation BOOLEAN NOT NULL DEFAULT false,
  timeout_ms    INT NOT NULL DEFAULT 10000,
  sent_at       TIMESTAMPTZ,
  feedback_value JSONB,
  parent_id     UUID REFERENCES commands(command_id), -- คำสั่งย่อยของคำสั่งทั้งระบบ (หยุดฉุกเฉิน · เปิด/ปิดทุกโซน)
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX commands_created_idx ON commands (created_at DESC);

CREATE INDEX commands_target_idx ON commands (target_kind, target_id, created_at DESC);
CREATE INDEX commands_open_idx ON commands (created_at) WHERE status IN ('pending', 'awaiting_feedback');

-- โทเคนยืนยันชั้นที่สองจากเซิร์ฟเวอร์ (โซน VIP · เปิด/ปิดทุกโซน) — ใช้ได้ครั้งเดียว ผูกกับผู้ใช้ + เป้าหมาย + คำสั่ง
CREATE TABLE control_confirmations (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  action      TEXT NOT NULL,
  value       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- ตารางสั่งงานล่วงหน้า — ★ dispatcher สั่งในนาม schedule:<id> ซึ่งนับเป็นระบบอัตโนมัติ
CREATE TABLE command_schedules (
  schedule_id     BIGSERIAL PRIMARY KEY,
  target_kind     TEXT NOT NULL,
  target_id       TEXT NOT NULL,
  action          TEXT NOT NULL,
  value           JSONB,
  run_time        TEXT NOT NULL CHECK (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),   -- เวลาโรงงาน
  repeat          TEXT NOT NULL CHECK (repeat IN ('once', 'daily', 'weekdays', 'weekly')),
  days_of_week    INT[] NOT NULL DEFAULT '{}',        -- 0 = อาทิตย์ … 6 = เสาร์
  enabled         BOOLEAN NOT NULL DEFAULT true,
  next_run_at     TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  last_command_id UUID REFERENCES commands(command_id) ON DELETE SET NULL,
  created_by      TEXT NOT NULL REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX command_schedules_due_idx ON command_schedules (next_run_at) WHERE enabled;

CREATE TABLE audit_log (
  log_id     BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    TEXT,
  action     TEXT,
  target     TEXT,
  old_value  TEXT,
  new_value  TEXT,
  result     TEXT,
  latency_ms INT,
  command_id UUID REFERENCES commands(command_id)
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

CREATE TABLE alerts (
  alert_id          BIGSERIAL PRIMARY KEY,
  entity_id         TEXT REFERENCES entities(entity_id),
  kind              TEXT NOT NULL,                  -- AlertCode ใน lib/types.ts
  severity          TEXT NOT NULL,                  -- info | warning | critical
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  peak_value        NUMERIC,
  threshold         NUMERIC,
  read_at           TIMESTAMPTZ,
  -- ★ เกิดซ้ำภายใน notifications.deduplicationWindowMinutes = เปิดแถวเดิมแล้วนับเพิ่ม ไม่สร้างแถวใหม่
  occurrence_count  INT NOT NULL DEFAULT 1,
  anomaly_id        BIGINT,                         -- ai_anomalies.id เมื่อ alert มาจากผลของทีม AI
  notified_severity TEXT                            -- ระดับที่ notifier ประเมินแล้ว · null = ยังไม่ส่ง/เลื่อนเพราะช่วงเงียบ
);
-- ★ กันสแปม: เหตุชนิดเดียวกันของ entity เดียวกันเปิดค้างได้แค่แถวเดียว
CREATE UNIQUE INDEX alerts_open_uq ON alerts (entity_id, kind) WHERE ended_at IS NULL;
CREATE INDEX alerts_started_idx ON alerts (started_at DESC);

-- การรับทราบ — ★ รับทราบ ≠ ปัญหาหาย (alert ยังเปิดจนกว่า ingest จะปิด) · snooze = เลื่อนการเตือนซ้ำ
CREATE TABLE alert_acknowledgements (
  id              BIGSERIAL PRIMARY KEY,
  alert_id        BIGINT NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note            TEXT,
  snooze_minutes  INT CHECK (snooze_minutes BETWEEN 1 AND 1440)
);
CREATE INDEX alert_ack_alert_idx ON alert_acknowledgements (alert_id, acknowledged_at DESC);

-- การส่งแจ้งเตือน หนึ่งแถว = หนึ่งช่องทาง × หนึ่งผู้รับ (api/notifier เป็นคนเขียน)
CREATE TABLE notification_log (
  id              BIGSERIAL PRIMARY KEY,
  alert_id        BIGINT NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
  channel         TEXT NOT NULL,                    -- line | email | sms | buzzer | webhook
  recipient       TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT 'raised',   -- raised | escalated | unacknowledged | snooze_ended
  state           TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'sending', 'delivered', 'failed')),
  attempts        INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  error           TEXT
);
CREATE INDEX notification_log_alert_idx ON notification_log (alert_id, created_at DESC);
CREATE INDEX notification_log_due_idx ON notification_log (next_attempt_at) WHERE state = 'queued';

-- ─────────────── ตารางของทีม AI (backend แค่เสิร์ฟ ไม่เขียนโมเดล) ───────────────

-- ★ ทุกตารางรับตามสัญญา docs/AI_CONTRACT.md · external_id = id ของทีม AI (ส่งซ้ำ = อัปเดตแถวเดิม)
CREATE TABLE ai_anomalies (
  id               BIGSERIAL PRIMARY KEY,
  external_id      TEXT UNIQUE,
  detected_at      TIMESTAMPTZ NOT NULL,
  source_id        TEXT NOT NULL REFERENCES entities(entity_id),   -- ★ ไม่มีแล้วหมุดไม่ขึ้นบนกราฟ
  source_type      TEXT NOT NULL,
  anomaly_type     TEXT NOT NULL,                   -- ★ string เปิด ห้ามทำ enum ปิด
  detector         TEXT,
  severity         TEXT CHECK (severity IN ('critical', 'warning', 'info')),
  score            NUMERIC CHECK (score BETWEEN 0 AND 1),          -- ★ 0–1 สูง = แย่
  metric           TEXT,
  window_start     TIMESTAMPTZ,
  window_end       TIMESTAMPTZ,
  evidence         JSONB,
  expected_band    JSONB,
  features         JSONB,
  suggested_action TEXT,
  summary_th       TEXT,
  summary_en       TEXT,
  model_name       TEXT,
  extra            JSONB,
  -- ★ สถานะ/ผลตรวจจากหน้างานเป็นของคน — ทีม AI ส่งซ้ำไม่ทับ
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'dismissed')),
  resolved_at      TIMESTAMPTZ,
  feedback         TEXT CHECK (feedback IN ('confirmed', 'false_positive')),
  alert_id         BIGINT REFERENCES alerts(alert_id) ON DELETE SET NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_anomalies_detected_idx ON ai_anomalies (detected_at DESC);
CREATE INDEX ai_anomalies_source_idx ON ai_anomalies (source_id, detected_at DESC);
ALTER TABLE alerts ADD FOREIGN KEY (anomaly_id) REFERENCES ai_anomalies(id) ON DELETE SET NULL;

CREATE TABLE ai_forecasts (
  id            BIGSERIAL PRIMARY KEY,
  external_id   TEXT UNIQUE,
  target        TEXT NOT NULL,                      -- string เปิด
  target_id     TEXT,
  target_name   TEXT,
  metric        TEXT,
  unit          TEXT,
  horizon       TEXT,
  horizon_hours NUMERIC,
  generated_at  TIMESTAMPTZ NOT NULL,
  history       JSONB,
  forecast      JSONB,
  value         NUMERIC,
  expected_at   TIMESTAMPTZ,
  confidence    NUMERIC CHECK (confidence BETWEEN 0 AND 1),
  mape_percent  NUMERIC,
  model_name    TEXT,
  summary_th    TEXT,
  summary_en    TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_forecasts_target_idx ON ai_forecasts (target, target_id, generated_at DESC);

CREATE TABLE ai_maintenance (
  id                   BIGSERIAL PRIMARY KEY,
  external_id          TEXT UNIQUE,
  target_type          TEXT NOT NULL,
  target_id            TEXT NOT NULL REFERENCES entities(entity_id),
  generated_at         TIMESTAMPTZ NOT NULL,
  target_name          TEXT,
  failure_probability  NUMERIC CHECK (failure_probability BETWEEN 0 AND 1),
  days_until_service   NUMERIC,
  estimated_issue_date TIMESTAMPTZ,
  health_score         NUMERIC CHECK (health_score BETWEEN 0 AND 100),  -- ★ 0–100 สูง = ดี (กลับทางกับ score)
  trend                TEXT,
  features             JSONB,
  model_name           TEXT,
  note                 TEXT,
  recommendation_th    TEXT,
  recommendation_en    TEXT,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_maintenance_target_idx ON ai_maintenance (target_type, target_id, generated_at DESC);

CREATE TABLE ai_metrics (
  id              BIGSERIAL PRIMARY KEY,
  key             TEXT NOT NULL,                     -- string เปิด
  computed_at     TIMESTAMPTZ NOT NULL,
  value           NUMERIC,
  text            TEXT,
  unit            TEXT,
  format          TEXT,
  decimals        INT,
  scope_type      TEXT,
  scope_id        TEXT,
  scope_name      TEXT,
  target          NUMERIC,
  thresholds      JSONB,
  status          TEXT CHECK (status IN ('ok', 'warning', 'critical', 'offline')),
  previous_value  NUMERIC,
  change_percent  NUMERIC,
  trend           TEXT,
  higher_is_worse BOOLEAN,
  confidence      NUMERIC CHECK (confidence BETWEEN 0 AND 1),
  basis           JSONB,
  series          JSONB,
  model_name      TEXT,
  summary_th      TEXT,
  summary_en      TEXT,
  extra           JSONB,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_metrics_key_idx ON ai_metrics (key, scope_type, scope_id, computed_at DESC);

-- สัญญาณชีพจากบริการ AI — มีได้แถวเดียว
CREATE TABLE ai_status (
  id                  BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  reported_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  models              JSONB NOT NULL DEFAULT '[]',
  message             TEXT,
  mode                TEXT,
  last_trained_at     TIMESTAMPTZ,
  training_days       NUMERIC,
  accuracy            NUMERIC CHECK (accuracy BETWEEN 0 AND 1),
  false_positive_rate NUMERIC CHECK (false_positive_rate BETWEEN 0 AND 1),
  summary_text        TEXT
);
