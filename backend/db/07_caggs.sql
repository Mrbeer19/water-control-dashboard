-- ═════════════════════════════════════════════════════════════
-- 07_caggs.sql — continuous aggregate 3 ชั้น: raw → 5 นาที → 1 ชม. → 1 วัน
-- ★ สร้างอัตโนมัติด้วย scripts/gen_caggs.py จาก api/metric_registry.py — ห้ามแก้มือ
-- ★ ต้องรันหลัง 06_seed.sql เพราะอ่านเขตเวลาจาก settings.general.timezone
--   เปลี่ยนเขตเวลาภายหลัง = ต้องสร้าง aggregate ใหม่ทั้งหมด (ตรวจได้จาก aggregate_config)
-- ═════════════════════════════════════════════════════════════

SELECT value ->> 'timezone' AS tz FROM settings WHERE section = 'general' \gset

CREATE TABLE aggregate_config (
  id         BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),   -- มีได้แถวเดียว
  timezone   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO aggregate_config (timezone) VALUES (:'tz');

-- ─────────────── pump (pump_telemetry) ───────────────
CREATE MATERIALIZED VIEW pump_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes', time, :'tz') AS bucket, entity_id,
       count(*) AS n_rows,
       sum(power_w) AS power_w_sum,
       count(power_w) AS power_w_n,
       min(power_w) AS power_w_min,
       max(power_w) AS power_w_max,
       first(time, power_w) FILTER (WHERE (power_w) IS NOT NULL) AS power_w_min_at,
       last(time, power_w) FILTER (WHERE (power_w) IS NOT NULL) AS power_w_max_at,
       sum(current) AS current_sum,
       count(current) AS current_n,
       min(current) AS current_min,
       max(current) AS current_max,
       first(time, current) FILTER (WHERE (current) IS NOT NULL) AS current_min_at,
       last(time, current) FILTER (WHERE (current) IS NOT NULL) AS current_max_at,
       sum(voltage) AS voltage_sum,
       count(voltage) AS voltage_n,
       min(voltage) AS voltage_min,
       max(voltage) AS voltage_max,
       first(time, voltage) FILTER (WHERE (voltage) IS NOT NULL) AS voltage_min_at,
       last(time, voltage) FILTER (WHERE (voltage) IS NOT NULL) AS voltage_max_at,
       sum(flow_lpm) AS flow_sum,
       count(flow_lpm) AS flow_n,
       min(flow_lpm) AS flow_min,
       max(flow_lpm) AS flow_max,
       first(time, flow_lpm) FILTER (WHERE (flow_lpm) IS NOT NULL) AS flow_min_at,
       last(time, flow_lpm) FILTER (WHERE (flow_lpm) IS NOT NULL) AS flow_max_at,
       sum(pressure_bar) AS pressure_sum,
       count(pressure_bar) AS pressure_n,
       min(pressure_bar) AS pressure_min,
       max(pressure_bar) AS pressure_max,
       first(time, pressure_bar) FILTER (WHERE (pressure_bar) IS NOT NULL) AS pressure_min_at,
       last(time, pressure_bar) FILTER (WHERE (pressure_bar) IS NOT NULL) AS pressure_max_at,
       sum(vfd_hz) AS vfd_sum,
       count(vfd_hz) AS vfd_n,
       min(vfd_hz) AS vfd_min,
       max(vfd_hz) AS vfd_max,
       first(time, vfd_hz) FILTER (WHERE (vfd_hz) IS NOT NULL) AS vfd_min_at,
       last(time, vfd_hz) FILTER (WHERE (vfd_hz) IS NOT NULL) AS vfd_max_at,
       count(energy_kwh) AS energy_n,
       last(energy_kwh, time) FILTER (WHERE (energy_kwh) IS NOT NULL) AS energy_last,
       first(energy_kwh, time) FILTER (WHERE (energy_kwh) IS NOT NULL) AS energy_first
  FROM pump_telemetry
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW pump_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(power_w_sum) AS power_w_sum,
       sum(power_w_n) AS power_w_n,
       min(power_w_min) AS power_w_min,
       max(power_w_max) AS power_w_max,
       first(power_w_min_at, power_w_min) FILTER (WHERE power_w_min IS NOT NULL) AS power_w_min_at,
       last(power_w_max_at, power_w_max) FILTER (WHERE power_w_max IS NOT NULL) AS power_w_max_at,
       sum(current_sum) AS current_sum,
       sum(current_n) AS current_n,
       min(current_min) AS current_min,
       max(current_max) AS current_max,
       first(current_min_at, current_min) FILTER (WHERE current_min IS NOT NULL) AS current_min_at,
       last(current_max_at, current_max) FILTER (WHERE current_max IS NOT NULL) AS current_max_at,
       sum(voltage_sum) AS voltage_sum,
       sum(voltage_n) AS voltage_n,
       min(voltage_min) AS voltage_min,
       max(voltage_max) AS voltage_max,
       first(voltage_min_at, voltage_min) FILTER (WHERE voltage_min IS NOT NULL) AS voltage_min_at,
       last(voltage_max_at, voltage_max) FILTER (WHERE voltage_max IS NOT NULL) AS voltage_max_at,
       sum(flow_sum) AS flow_sum,
       sum(flow_n) AS flow_n,
       min(flow_min) AS flow_min,
       max(flow_max) AS flow_max,
       first(flow_min_at, flow_min) FILTER (WHERE flow_min IS NOT NULL) AS flow_min_at,
       last(flow_max_at, flow_max) FILTER (WHERE flow_max IS NOT NULL) AS flow_max_at,
       sum(pressure_sum) AS pressure_sum,
       sum(pressure_n) AS pressure_n,
       min(pressure_min) AS pressure_min,
       max(pressure_max) AS pressure_max,
       first(pressure_min_at, pressure_min) FILTER (WHERE pressure_min IS NOT NULL) AS pressure_min_at,
       last(pressure_max_at, pressure_max) FILTER (WHERE pressure_max IS NOT NULL) AS pressure_max_at,
       sum(vfd_sum) AS vfd_sum,
       sum(vfd_n) AS vfd_n,
       min(vfd_min) AS vfd_min,
       max(vfd_max) AS vfd_max,
       first(vfd_min_at, vfd_min) FILTER (WHERE vfd_min IS NOT NULL) AS vfd_min_at,
       last(vfd_max_at, vfd_max) FILTER (WHERE vfd_max IS NOT NULL) AS vfd_max_at,
       sum(energy_n) AS energy_n,
       last(energy_last, bucket) FILTER (WHERE energy_last IS NOT NULL) AS energy_last,
       first(energy_first, bucket) FILTER (WHERE energy_first IS NOT NULL) AS energy_first
  FROM pump_5m
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW pump_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(power_w_sum) AS power_w_sum,
       sum(power_w_n) AS power_w_n,
       min(power_w_min) AS power_w_min,
       max(power_w_max) AS power_w_max,
       first(power_w_min_at, power_w_min) FILTER (WHERE power_w_min IS NOT NULL) AS power_w_min_at,
       last(power_w_max_at, power_w_max) FILTER (WHERE power_w_max IS NOT NULL) AS power_w_max_at,
       sum(current_sum) AS current_sum,
       sum(current_n) AS current_n,
       min(current_min) AS current_min,
       max(current_max) AS current_max,
       first(current_min_at, current_min) FILTER (WHERE current_min IS NOT NULL) AS current_min_at,
       last(current_max_at, current_max) FILTER (WHERE current_max IS NOT NULL) AS current_max_at,
       sum(voltage_sum) AS voltage_sum,
       sum(voltage_n) AS voltage_n,
       min(voltage_min) AS voltage_min,
       max(voltage_max) AS voltage_max,
       first(voltage_min_at, voltage_min) FILTER (WHERE voltage_min IS NOT NULL) AS voltage_min_at,
       last(voltage_max_at, voltage_max) FILTER (WHERE voltage_max IS NOT NULL) AS voltage_max_at,
       sum(flow_sum) AS flow_sum,
       sum(flow_n) AS flow_n,
       min(flow_min) AS flow_min,
       max(flow_max) AS flow_max,
       first(flow_min_at, flow_min) FILTER (WHERE flow_min IS NOT NULL) AS flow_min_at,
       last(flow_max_at, flow_max) FILTER (WHERE flow_max IS NOT NULL) AS flow_max_at,
       sum(pressure_sum) AS pressure_sum,
       sum(pressure_n) AS pressure_n,
       min(pressure_min) AS pressure_min,
       max(pressure_max) AS pressure_max,
       first(pressure_min_at, pressure_min) FILTER (WHERE pressure_min IS NOT NULL) AS pressure_min_at,
       last(pressure_max_at, pressure_max) FILTER (WHERE pressure_max IS NOT NULL) AS pressure_max_at,
       sum(vfd_sum) AS vfd_sum,
       sum(vfd_n) AS vfd_n,
       min(vfd_min) AS vfd_min,
       max(vfd_max) AS vfd_max,
       first(vfd_min_at, vfd_min) FILTER (WHERE vfd_min IS NOT NULL) AS vfd_min_at,
       last(vfd_max_at, vfd_max) FILTER (WHERE vfd_max IS NOT NULL) AS vfd_max_at,
       sum(energy_n) AS energy_n,
       last(energy_last, bucket) FILTER (WHERE energy_last IS NOT NULL) AS energy_last,
       first(energy_first, bucket) FILTER (WHERE energy_first IS NOT NULL) AS energy_first
  FROM pump_1h
 GROUP BY 1, 2
WITH NO DATA;

-- ─────────────── tank (tank_telemetry) ───────────────
CREATE MATERIALIZED VIEW tank_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes', time, :'tz') AS bucket, entity_id,
       count(*) AS n_rows,
       sum(volume_l) AS volume_sum,
       count(volume_l) AS volume_n,
       min(volume_l) AS volume_min,
       max(volume_l) AS volume_max,
       first(time, volume_l) FILTER (WHERE (volume_l) IS NOT NULL) AS volume_min_at,
       last(time, volume_l) FILTER (WHERE (volume_l) IS NOT NULL) AS volume_max_at,
       last(volume_l, time) FILTER (WHERE (volume_l) IS NOT NULL) AS volume_last,
       sum(flow_in_lpm - flow_out_lpm) AS net_flow_sum,
       count(flow_in_lpm - flow_out_lpm) AS net_flow_n,
       min(flow_in_lpm - flow_out_lpm) AS net_flow_min,
       max(flow_in_lpm - flow_out_lpm) AS net_flow_max,
       first(time, flow_in_lpm - flow_out_lpm) FILTER (WHERE (flow_in_lpm - flow_out_lpm) IS NOT NULL) AS net_flow_min_at,
       last(time, flow_in_lpm - flow_out_lpm) FILTER (WHERE (flow_in_lpm - flow_out_lpm) IS NOT NULL) AS net_flow_max_at
  FROM tank_telemetry
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW tank_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(volume_sum) AS volume_sum,
       sum(volume_n) AS volume_n,
       min(volume_min) AS volume_min,
       max(volume_max) AS volume_max,
       first(volume_min_at, volume_min) FILTER (WHERE volume_min IS NOT NULL) AS volume_min_at,
       last(volume_max_at, volume_max) FILTER (WHERE volume_max IS NOT NULL) AS volume_max_at,
       last(volume_last, bucket) FILTER (WHERE volume_last IS NOT NULL) AS volume_last,
       sum(net_flow_sum) AS net_flow_sum,
       sum(net_flow_n) AS net_flow_n,
       min(net_flow_min) AS net_flow_min,
       max(net_flow_max) AS net_flow_max,
       first(net_flow_min_at, net_flow_min) FILTER (WHERE net_flow_min IS NOT NULL) AS net_flow_min_at,
       last(net_flow_max_at, net_flow_max) FILTER (WHERE net_flow_max IS NOT NULL) AS net_flow_max_at
  FROM tank_5m
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW tank_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(volume_sum) AS volume_sum,
       sum(volume_n) AS volume_n,
       min(volume_min) AS volume_min,
       max(volume_max) AS volume_max,
       first(volume_min_at, volume_min) FILTER (WHERE volume_min IS NOT NULL) AS volume_min_at,
       last(volume_max_at, volume_max) FILTER (WHERE volume_max IS NOT NULL) AS volume_max_at,
       last(volume_last, bucket) FILTER (WHERE volume_last IS NOT NULL) AS volume_last,
       sum(net_flow_sum) AS net_flow_sum,
       sum(net_flow_n) AS net_flow_n,
       min(net_flow_min) AS net_flow_min,
       max(net_flow_max) AS net_flow_max,
       first(net_flow_min_at, net_flow_min) FILTER (WHERE net_flow_min IS NOT NULL) AS net_flow_min_at,
       last(net_flow_max_at, net_flow_max) FILTER (WHERE net_flow_max IS NOT NULL) AS net_flow_max_at
  FROM tank_1h
 GROUP BY 1, 2
WITH NO DATA;

-- ─────────────── meter (meter_telemetry) ───────────────
CREATE MATERIALIZED VIEW meter_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes', time, :'tz') AS bucket, entity_id,
       count(*) AS n_rows,
       sum(flow_lpm) AS flow_sum,
       count(flow_lpm) AS flow_n,
       min(flow_lpm) AS flow_min,
       max(flow_lpm) AS flow_max,
       first(time, flow_lpm) FILTER (WHERE (flow_lpm) IS NOT NULL) AS flow_min_at,
       last(time, flow_lpm) FILTER (WHERE (flow_lpm) IS NOT NULL) AS flow_max_at,
       sum(inlet_pressure_bar) AS inlet_pressure_sum,
       count(inlet_pressure_bar) AS inlet_pressure_n,
       min(inlet_pressure_bar) AS inlet_pressure_min,
       max(inlet_pressure_bar) AS inlet_pressure_max,
       first(time, inlet_pressure_bar) FILTER (WHERE (inlet_pressure_bar) IS NOT NULL) AS inlet_pressure_min_at,
       last(time, inlet_pressure_bar) FILTER (WHERE (inlet_pressure_bar) IS NOT NULL) AS inlet_pressure_max_at,
       count(volume_m3) AS volume_n,
       last(volume_m3, time) FILTER (WHERE (volume_m3) IS NOT NULL) AS volume_last,
       first(volume_m3, time) FILTER (WHERE (volume_m3) IS NOT NULL) AS volume_first
  FROM meter_telemetry
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW meter_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(flow_sum) AS flow_sum,
       sum(flow_n) AS flow_n,
       min(flow_min) AS flow_min,
       max(flow_max) AS flow_max,
       first(flow_min_at, flow_min) FILTER (WHERE flow_min IS NOT NULL) AS flow_min_at,
       last(flow_max_at, flow_max) FILTER (WHERE flow_max IS NOT NULL) AS flow_max_at,
       sum(inlet_pressure_sum) AS inlet_pressure_sum,
       sum(inlet_pressure_n) AS inlet_pressure_n,
       min(inlet_pressure_min) AS inlet_pressure_min,
       max(inlet_pressure_max) AS inlet_pressure_max,
       first(inlet_pressure_min_at, inlet_pressure_min) FILTER (WHERE inlet_pressure_min IS NOT NULL) AS inlet_pressure_min_at,
       last(inlet_pressure_max_at, inlet_pressure_max) FILTER (WHERE inlet_pressure_max IS NOT NULL) AS inlet_pressure_max_at,
       sum(volume_n) AS volume_n,
       last(volume_last, bucket) FILTER (WHERE volume_last IS NOT NULL) AS volume_last,
       first(volume_first, bucket) FILTER (WHERE volume_first IS NOT NULL) AS volume_first
  FROM meter_5m
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW meter_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(flow_sum) AS flow_sum,
       sum(flow_n) AS flow_n,
       min(flow_min) AS flow_min,
       max(flow_max) AS flow_max,
       first(flow_min_at, flow_min) FILTER (WHERE flow_min IS NOT NULL) AS flow_min_at,
       last(flow_max_at, flow_max) FILTER (WHERE flow_max IS NOT NULL) AS flow_max_at,
       sum(inlet_pressure_sum) AS inlet_pressure_sum,
       sum(inlet_pressure_n) AS inlet_pressure_n,
       min(inlet_pressure_min) AS inlet_pressure_min,
       max(inlet_pressure_max) AS inlet_pressure_max,
       first(inlet_pressure_min_at, inlet_pressure_min) FILTER (WHERE inlet_pressure_min IS NOT NULL) AS inlet_pressure_min_at,
       last(inlet_pressure_max_at, inlet_pressure_max) FILTER (WHERE inlet_pressure_max IS NOT NULL) AS inlet_pressure_max_at,
       sum(volume_n) AS volume_n,
       last(volume_last, bucket) FILTER (WHERE volume_last IS NOT NULL) AS volume_last,
       first(volume_first, bucket) FILTER (WHERE volume_first IS NOT NULL) AS volume_first
  FROM meter_1h
 GROUP BY 1, 2
WITH NO DATA;

-- ─────────────── env (env_telemetry) ───────────────
CREATE MATERIALIZED VIEW env_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes', time, :'tz') AS bucket, entity_id,
       count(*) AS n_rows,
       sum(temp_c) AS temp_sum,
       count(temp_c) AS temp_n,
       min(temp_c) AS temp_min,
       max(temp_c) AS temp_max,
       first(time, temp_c) FILTER (WHERE (temp_c) IS NOT NULL) AS temp_min_at,
       last(time, temp_c) FILTER (WHERE (temp_c) IS NOT NULL) AS temp_max_at,
       sum(humidity_pct) AS humidity_sum,
       count(humidity_pct) AS humidity_n,
       min(humidity_pct) AS humidity_min,
       max(humidity_pct) AS humidity_max,
       first(time, humidity_pct) FILTER (WHERE (humidity_pct) IS NOT NULL) AS humidity_min_at,
       last(time, humidity_pct) FILTER (WHERE (humidity_pct) IS NOT NULL) AS humidity_max_at,
       sum(heat_index_c) AS heat_index_sum,
       count(heat_index_c) AS heat_index_n,
       min(heat_index_c) AS heat_index_min,
       max(heat_index_c) AS heat_index_max,
       first(time, heat_index_c) FILTER (WHERE (heat_index_c) IS NOT NULL) AS heat_index_min_at,
       last(time, heat_index_c) FILTER (WHERE (heat_index_c) IS NOT NULL) AS heat_index_max_at,
       sum(pressure_hpa) AS pressure_sum,
       count(pressure_hpa) AS pressure_n,
       min(pressure_hpa) AS pressure_min,
       max(pressure_hpa) AS pressure_max,
       first(time, pressure_hpa) FILTER (WHERE (pressure_hpa) IS NOT NULL) AS pressure_min_at,
       last(time, pressure_hpa) FILTER (WHERE (pressure_hpa) IS NOT NULL) AS pressure_max_at,
       sum(lux) AS lux_sum,
       count(lux) AS lux_n,
       min(lux) AS lux_min,
       max(lux) AS lux_max,
       first(time, lux) FILTER (WHERE (lux) IS NOT NULL) AS lux_min_at,
       last(time, lux) FILTER (WHERE (lux) IS NOT NULL) AS lux_max_at,
       sum(rain_mm) AS rain_sum,
       max(rain_mm) AS rain_max,
       count(rain_mm) AS rain_n
  FROM env_telemetry
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW env_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(temp_sum) AS temp_sum,
       sum(temp_n) AS temp_n,
       min(temp_min) AS temp_min,
       max(temp_max) AS temp_max,
       first(temp_min_at, temp_min) FILTER (WHERE temp_min IS NOT NULL) AS temp_min_at,
       last(temp_max_at, temp_max) FILTER (WHERE temp_max IS NOT NULL) AS temp_max_at,
       sum(humidity_sum) AS humidity_sum,
       sum(humidity_n) AS humidity_n,
       min(humidity_min) AS humidity_min,
       max(humidity_max) AS humidity_max,
       first(humidity_min_at, humidity_min) FILTER (WHERE humidity_min IS NOT NULL) AS humidity_min_at,
       last(humidity_max_at, humidity_max) FILTER (WHERE humidity_max IS NOT NULL) AS humidity_max_at,
       sum(heat_index_sum) AS heat_index_sum,
       sum(heat_index_n) AS heat_index_n,
       min(heat_index_min) AS heat_index_min,
       max(heat_index_max) AS heat_index_max,
       first(heat_index_min_at, heat_index_min) FILTER (WHERE heat_index_min IS NOT NULL) AS heat_index_min_at,
       last(heat_index_max_at, heat_index_max) FILTER (WHERE heat_index_max IS NOT NULL) AS heat_index_max_at,
       sum(pressure_sum) AS pressure_sum,
       sum(pressure_n) AS pressure_n,
       min(pressure_min) AS pressure_min,
       max(pressure_max) AS pressure_max,
       first(pressure_min_at, pressure_min) FILTER (WHERE pressure_min IS NOT NULL) AS pressure_min_at,
       last(pressure_max_at, pressure_max) FILTER (WHERE pressure_max IS NOT NULL) AS pressure_max_at,
       sum(lux_sum) AS lux_sum,
       sum(lux_n) AS lux_n,
       min(lux_min) AS lux_min,
       max(lux_max) AS lux_max,
       first(lux_min_at, lux_min) FILTER (WHERE lux_min IS NOT NULL) AS lux_min_at,
       last(lux_max_at, lux_max) FILTER (WHERE lux_max IS NOT NULL) AS lux_max_at,
       sum(rain_sum) AS rain_sum,
       max(rain_max) AS rain_max,
       sum(rain_n) AS rain_n
  FROM env_5m
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW env_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(temp_sum) AS temp_sum,
       sum(temp_n) AS temp_n,
       min(temp_min) AS temp_min,
       max(temp_max) AS temp_max,
       first(temp_min_at, temp_min) FILTER (WHERE temp_min IS NOT NULL) AS temp_min_at,
       last(temp_max_at, temp_max) FILTER (WHERE temp_max IS NOT NULL) AS temp_max_at,
       sum(humidity_sum) AS humidity_sum,
       sum(humidity_n) AS humidity_n,
       min(humidity_min) AS humidity_min,
       max(humidity_max) AS humidity_max,
       first(humidity_min_at, humidity_min) FILTER (WHERE humidity_min IS NOT NULL) AS humidity_min_at,
       last(humidity_max_at, humidity_max) FILTER (WHERE humidity_max IS NOT NULL) AS humidity_max_at,
       sum(heat_index_sum) AS heat_index_sum,
       sum(heat_index_n) AS heat_index_n,
       min(heat_index_min) AS heat_index_min,
       max(heat_index_max) AS heat_index_max,
       first(heat_index_min_at, heat_index_min) FILTER (WHERE heat_index_min IS NOT NULL) AS heat_index_min_at,
       last(heat_index_max_at, heat_index_max) FILTER (WHERE heat_index_max IS NOT NULL) AS heat_index_max_at,
       sum(pressure_sum) AS pressure_sum,
       sum(pressure_n) AS pressure_n,
       min(pressure_min) AS pressure_min,
       max(pressure_max) AS pressure_max,
       first(pressure_min_at, pressure_min) FILTER (WHERE pressure_min IS NOT NULL) AS pressure_min_at,
       last(pressure_max_at, pressure_max) FILTER (WHERE pressure_max IS NOT NULL) AS pressure_max_at,
       sum(lux_sum) AS lux_sum,
       sum(lux_n) AS lux_n,
       min(lux_min) AS lux_min,
       max(lux_max) AS lux_max,
       first(lux_min_at, lux_min) FILTER (WHERE lux_min IS NOT NULL) AS lux_min_at,
       last(lux_max_at, lux_max) FILTER (WHERE lux_max IS NOT NULL) AS lux_max_at,
       sum(rain_sum) AS rain_sum,
       max(rain_max) AS rain_max,
       sum(rain_n) AS rain_n
  FROM env_1h
 GROUP BY 1, 2
WITH NO DATA;

-- ─────────────── power (power_telemetry) ───────────────
CREATE MATERIALIZED VIEW power_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes', time, :'tz') AS bucket, entity_id,
       count(*) AS n_rows,
       sum(power_w) AS power_w_sum,
       count(power_w) AS power_w_n,
       min(power_w) AS power_w_min,
       max(power_w) AS power_w_max,
       first(time, power_w) FILTER (WHERE (power_w) IS NOT NULL) AS power_w_min_at,
       last(time, power_w) FILTER (WHERE (power_w) IS NOT NULL) AS power_w_max_at,
       sum(current) AS current_sum,
       count(current) AS current_n,
       min(current) AS current_min,
       max(current) AS current_max,
       first(time, current) FILTER (WHERE (current) IS NOT NULL) AS current_min_at,
       last(time, current) FILTER (WHERE (current) IS NOT NULL) AS current_max_at,
       sum(voltage) AS voltage_sum,
       count(voltage) AS voltage_n,
       min(voltage) AS voltage_min,
       max(voltage) AS voltage_max,
       first(time, voltage) FILTER (WHERE (voltage) IS NOT NULL) AS voltage_min_at,
       last(time, voltage) FILTER (WHERE (voltage) IS NOT NULL) AS voltage_max_at,
       count(energy_kwh) AS energy_n,
       last(energy_kwh, time) FILTER (WHERE (energy_kwh) IS NOT NULL) AS energy_last,
       first(energy_kwh, time) FILTER (WHERE (energy_kwh) IS NOT NULL) AS energy_first
  FROM power_telemetry
 WHERE phase IN ('total', 'single')
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW power_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(power_w_sum) AS power_w_sum,
       sum(power_w_n) AS power_w_n,
       min(power_w_min) AS power_w_min,
       max(power_w_max) AS power_w_max,
       first(power_w_min_at, power_w_min) FILTER (WHERE power_w_min IS NOT NULL) AS power_w_min_at,
       last(power_w_max_at, power_w_max) FILTER (WHERE power_w_max IS NOT NULL) AS power_w_max_at,
       sum(current_sum) AS current_sum,
       sum(current_n) AS current_n,
       min(current_min) AS current_min,
       max(current_max) AS current_max,
       first(current_min_at, current_min) FILTER (WHERE current_min IS NOT NULL) AS current_min_at,
       last(current_max_at, current_max) FILTER (WHERE current_max IS NOT NULL) AS current_max_at,
       sum(voltage_sum) AS voltage_sum,
       sum(voltage_n) AS voltage_n,
       min(voltage_min) AS voltage_min,
       max(voltage_max) AS voltage_max,
       first(voltage_min_at, voltage_min) FILTER (WHERE voltage_min IS NOT NULL) AS voltage_min_at,
       last(voltage_max_at, voltage_max) FILTER (WHERE voltage_max IS NOT NULL) AS voltage_max_at,
       sum(energy_n) AS energy_n,
       last(energy_last, bucket) FILTER (WHERE energy_last IS NOT NULL) AS energy_last,
       first(energy_first, bucket) FILTER (WHERE energy_first IS NOT NULL) AS energy_first
  FROM power_5m
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW power_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(power_w_sum) AS power_w_sum,
       sum(power_w_n) AS power_w_n,
       min(power_w_min) AS power_w_min,
       max(power_w_max) AS power_w_max,
       first(power_w_min_at, power_w_min) FILTER (WHERE power_w_min IS NOT NULL) AS power_w_min_at,
       last(power_w_max_at, power_w_max) FILTER (WHERE power_w_max IS NOT NULL) AS power_w_max_at,
       sum(current_sum) AS current_sum,
       sum(current_n) AS current_n,
       min(current_min) AS current_min,
       max(current_max) AS current_max,
       first(current_min_at, current_min) FILTER (WHERE current_min IS NOT NULL) AS current_min_at,
       last(current_max_at, current_max) FILTER (WHERE current_max IS NOT NULL) AS current_max_at,
       sum(voltage_sum) AS voltage_sum,
       sum(voltage_n) AS voltage_n,
       min(voltage_min) AS voltage_min,
       max(voltage_max) AS voltage_max,
       first(voltage_min_at, voltage_min) FILTER (WHERE voltage_min IS NOT NULL) AS voltage_min_at,
       last(voltage_max_at, voltage_max) FILTER (WHERE voltage_max IS NOT NULL) AS voltage_max_at,
       sum(energy_n) AS energy_n,
       last(energy_last, bucket) FILTER (WHERE energy_last IS NOT NULL) AS energy_last,
       first(energy_first, bucket) FILTER (WHERE energy_first IS NOT NULL) AS energy_first
  FROM power_1h
 GROUP BY 1, 2
WITH NO DATA;

-- ─────────────── device (device_status) ───────────────
CREATE MATERIALIZED VIEW device_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('5 minutes', time, :'tz') AS bucket, entity_id,
       count(*) AS n_rows,
       sum(rssi) AS rssi_sum,
       count(rssi) AS rssi_n,
       min(rssi) AS rssi_min,
       max(rssi) AS rssi_max,
       first(time, rssi) FILTER (WHERE (rssi) IS NOT NULL) AS rssi_min_at,
       last(time, rssi) FILTER (WHERE (rssi) IS NOT NULL) AS rssi_max_at,
       sum(free_heap) AS free_heap_sum,
       count(free_heap) AS free_heap_n,
       min(free_heap) AS free_heap_min,
       max(free_heap) AS free_heap_max,
       first(time, free_heap) FILTER (WHERE (free_heap) IS NOT NULL) AS free_heap_min_at,
       last(time, free_heap) FILTER (WHERE (free_heap) IS NOT NULL) AS free_heap_max_at,
       count(uptime_s) AS uptime_n,
       last(uptime_s, time) FILTER (WHERE (uptime_s) IS NOT NULL) AS uptime_last,
       first(uptime_s, time) FILTER (WHERE (uptime_s) IS NOT NULL) AS uptime_first
  FROM device_status
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW device_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 hour', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(rssi_sum) AS rssi_sum,
       sum(rssi_n) AS rssi_n,
       min(rssi_min) AS rssi_min,
       max(rssi_max) AS rssi_max,
       first(rssi_min_at, rssi_min) FILTER (WHERE rssi_min IS NOT NULL) AS rssi_min_at,
       last(rssi_max_at, rssi_max) FILTER (WHERE rssi_max IS NOT NULL) AS rssi_max_at,
       sum(free_heap_sum) AS free_heap_sum,
       sum(free_heap_n) AS free_heap_n,
       min(free_heap_min) AS free_heap_min,
       max(free_heap_max) AS free_heap_max,
       first(free_heap_min_at, free_heap_min) FILTER (WHERE free_heap_min IS NOT NULL) AS free_heap_min_at,
       last(free_heap_max_at, free_heap_max) FILTER (WHERE free_heap_max IS NOT NULL) AS free_heap_max_at,
       sum(uptime_n) AS uptime_n,
       last(uptime_last, bucket) FILTER (WHERE uptime_last IS NOT NULL) AS uptime_last,
       first(uptime_first, bucket) FILTER (WHERE uptime_first IS NOT NULL) AS uptime_first
  FROM device_5m
 GROUP BY 1, 2
WITH NO DATA;

CREATE MATERIALIZED VIEW device_1d
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT time_bucket('1 day', bucket, :'tz') AS bucket, entity_id,
       sum(n_rows) AS n_rows,
       sum(rssi_sum) AS rssi_sum,
       sum(rssi_n) AS rssi_n,
       min(rssi_min) AS rssi_min,
       max(rssi_max) AS rssi_max,
       first(rssi_min_at, rssi_min) FILTER (WHERE rssi_min IS NOT NULL) AS rssi_min_at,
       last(rssi_max_at, rssi_max) FILTER (WHERE rssi_max IS NOT NULL) AS rssi_max_at,
       sum(free_heap_sum) AS free_heap_sum,
       sum(free_heap_n) AS free_heap_n,
       min(free_heap_min) AS free_heap_min,
       max(free_heap_max) AS free_heap_max,
       first(free_heap_min_at, free_heap_min) FILTER (WHERE free_heap_min IS NOT NULL) AS free_heap_min_at,
       last(free_heap_max_at, free_heap_max) FILTER (WHERE free_heap_max IS NOT NULL) AS free_heap_max_at,
       sum(uptime_n) AS uptime_n,
       last(uptime_last, bucket) FILTER (WHERE uptime_last IS NOT NULL) AS uptime_last,
       first(uptime_first, bucket) FILTER (WHERE uptime_first IS NOT NULL) AS uptime_first
  FROM device_1h
 GROUP BY 1, 2
WITH NO DATA;
