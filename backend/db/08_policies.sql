-- ═════════════════════════════════════════════════════════════
-- 08_policies.sql — refresh · compression · retention
-- ═════════════════════════════════════════════════════════════

-- ─────────────── refresh ของ continuous aggregate ───────────────
-- ★ start_offset ต้องสั้นกว่า retention ของชั้นล่าง ไม่งั้นการ refresh ช่วงที่ข้อมูลล่างถูกลบไปแล้ว
--   จะลบ bucket ในชั้นบนทิ้งด้วย · ข้อมูลที่มาช้า (spool replay, ส่งตามหลัง broker ล่ม) อยู่ในหน้าต่างนี้
-- ★ ช่วงล่าสุดที่ยังไม่ materialize ใช้ real-time aggregation (materialized_only = false) จึงเห็นทันที
DO $$
DECLARE
  cagg RECORD;
BEGIN
  FOR cagg IN SELECT view_name FROM timescaledb_information.continuous_aggregates LOOP
    IF cagg.view_name LIKE '%\_5m' THEN
      PERFORM add_continuous_aggregate_policy(cagg.view_name::regclass,
        start_offset => INTERVAL '14 days', end_offset => INTERVAL '10 minutes',
        schedule_interval => INTERVAL '1 minute');
    ELSIF cagg.view_name LIKE '%\_1h' THEN
      PERFORM add_continuous_aggregate_policy(cagg.view_name::regclass,
        start_offset => INTERVAL '60 days', end_offset => INTERVAL '1 hour',
        schedule_interval => INTERVAL '10 minutes');
    ELSIF cagg.view_name LIKE '%\_1d' THEN
      PERFORM add_continuous_aggregate_policy(cagg.view_name::regclass,
        start_offset => INTERVAL '365 days', end_offset => INTERVAL '1 day',
        schedule_interval => INTERVAL '1 hour');
    END IF;
  END LOOP;
END
$$;

-- ─────────────── compression ข้อมูลดิบอายุเกิน 7 วัน ───────────────
-- segmentby entity_id: query ทุกตัวกรองด้วย entity จึงแตกก้อนตามนี้ได้ผลดีที่สุด
ALTER TABLE tank_telemetry  SET (timescaledb.compress, timescaledb.compress_segmentby = 'entity_id', timescaledb.compress_orderby = 'time DESC');
ALTER TABLE pump_telemetry  SET (timescaledb.compress, timescaledb.compress_segmentby = 'entity_id', timescaledb.compress_orderby = 'time DESC');
ALTER TABLE meter_telemetry SET (timescaledb.compress, timescaledb.compress_segmentby = 'entity_id', timescaledb.compress_orderby = 'time DESC');
ALTER TABLE env_telemetry   SET (timescaledb.compress, timescaledb.compress_segmentby = 'entity_id', timescaledb.compress_orderby = 'time DESC');
ALTER TABLE power_telemetry SET (timescaledb.compress, timescaledb.compress_segmentby = 'entity_id, phase', timescaledb.compress_orderby = 'time DESC');
ALTER TABLE device_status   SET (timescaledb.compress, timescaledb.compress_segmentby = 'entity_id', timescaledb.compress_orderby = 'time DESC');

SELECT add_compression_policy(t, INTERVAL '7 days')
  FROM unnest(ARRAY['tank_telemetry', 'pump_telemetry', 'meter_telemetry',
                    'env_telemetry', 'power_telemetry', 'device_status']::regclass[]) AS t;

-- ─────────────── retention ───────────────
-- ★ ข้อมูลดิบไม่ใช้ retention policy — api/worker/archive.py export เป็น Parquet และตรวจจำนวนแถวก่อน แล้วจึงลบ chunk เอง
--   (ทีม AI ใช้ข้อมูลดิบเทรน ลบแล้วเอาคืนไม่ได้) · เก็บตาม maintenance.dataRetentionDays ขั้นต่ำ 30 วัน
-- aggregate: 5 นาที 90 วัน · 1 ชม. 2 ปี · 1 วัน ถาวร — อยู่ใน 09_archive.sql (ต้องสร้างหลังตาราง archive)
