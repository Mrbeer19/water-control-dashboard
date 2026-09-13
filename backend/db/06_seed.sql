-- ═════════════════════════════════════════════════════════════
-- 06_seed.sql — ข้อมูลตั้งต้นของโรงงาน
-- ★ id / ชื่อ / IP ตรงกับ lib/mock/hardware.ts · network.ts · organization.ts · settings.ts
--   ถ้าหน้างานเปลี่ยน ให้แก้ที่นี่ ห้าม hardcode จำนวนโซน/มิเตอร์ในโค้ด
-- ═════════════════════════════════════════════════════════════

-- ─────────────── แผนก ───────────────
INSERT INTO departments (department_id, name, name_en, cost_center_code, manager_user_id) VALUES
  ('dept-production', 'ฝ่ายผลิต',           'Production',       'CC-1100', 'user-nid'),
  ('dept-facility',   'ฝ่ายอาคารสถานที่',    'Facility',         'CC-2200', 'user-somchai'),
  ('dept-hr',         'ฝ่ายทรัพยากรบุคคล',   'Human Resources',  'CC-3300', 'user-ploy'),
  ('dept-executive',  'สำนักผู้บริหาร',       'Executive Office', 'CC-9900', 'user-admin');

-- ─────────────── โซน ───────────────
INSERT INTO zones (zone_id, zone_number, name_th, name_en, area_th, area_en, department_id, quota_m3_day, is_vip) VALUES
  ('zone-1', 1, 'โซน 1 — อาคารผลิต A',               'Zone 1 — Production A',       'อาคารผลิต A',                   'Production Building A',        'dept-production', 80,   false),
  ('zone-2', 2, 'โซน 2 — อาคารผลิต B',               'Zone 2 — Production B',       'อาคารผลิต B',                   'Production Building B',        'dept-production', 66,   false),
  ('zone-3', 3, 'โซน 3 — โรงอาหาร',                  'Zone 3 — Canteen',            'โรงอาหารและครัวกลาง',            'Canteen & Central Kitchen',    'dept-facility',   35,   false),
  ('zone-4', 4, 'โซน 4 — อาคารสำนักงาน',             'Zone 4 — Office',             'อาคารสำนักงาน 3 ชั้น',            'Office Building (3F)',         'dept-facility',   23,   false),
  ('zone-5', 5, 'โซน 5 — หอพักพนักงาน',              'Zone 5 — Staff Dormitory',    'หอพักพนักงาน',                  'Staff Dormitory',              'dept-hr',         48,   false),
  ('zone-6', 6, 'โซน 6 — ระบบหล่อเย็น',              'Zone 6 — Cooling System',     'คูลลิ่งทาวเวอร์',                 'Cooling Tower',                'dept-production', 92,   false),
  ('zone-7', 7, 'โซน 7 — พื้นที่ล้างทำความสะอาด',     'Zone 7 — Washdown Area',      'ลานล้างและบ่อบำบัด',             'Washdown & Treatment',         'dept-facility',   28,   false),
  ('zone-8', 8, 'โซน 8 — พื้นที่ VIP',                'Zone 8 — VIP Area',           'บ้านพักผู้บริหารและห้องรับรอง',    'Executive Residence & Lounge', 'dept-executive',  NULL, true);

-- ─────────────── อุปกรณ์ 15 ตัว: ESP32 11 + PLC 2 + HMI 1 + Gateway 1 ───────────────
INSERT INTO devices (device_id, name, name_en, kind, role, model, ip, mac, vlan, port, protocol, fieldbus, link_type, firmware, location, location_en) VALUES
  ('esp32-pump-house',  'ESP32 ห้องปั๊ม',          'ESP32 Pump House',      'esp32', 'pump_node',  'ESP32-WROOM-32E',    '10.20.30.11', '3C:61:05:A2:1F:11', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-node-2.4.1', 'ตู้ควบคุมปั๊มเดิม',    'Existing Pump Control Cabinet'),
  ('esp32-meter-bank',  'ESP32 ชุดมิเตอร์',        'ESP32 Meter Bank',      'esp32', 'meter_node', 'ESP32-WROOM-32E',    '10.20.30.12', '3C:61:05:A2:1F:12', 30, 1883, 'mqtt', NULL,         'wifi', 'wcm-node-2.4.1', 'จุดรวมมิเตอร์',        'Meter Manifold'),
  ('esp32-valve-bank',  'ESP32 ชุดวาล์ว',          'ESP32 Valve Bank',      'esp32', 'valve_node', 'ESP32-WROOM-32E',    '10.20.30.13', '3C:61:05:A2:1F:13', 30, 1883, 'mqtt', NULL,         'wifi', 'wcm-node-2.4.1', 'จุดรวมมิเตอร์',        'Meter Manifold'),
  ('esp32-vip',         'ESP32 โซน VIP',           'ESP32 VIP Zone',        'esp32', 'pump_node',  'ESP32-WROOM-32E',    '10.20.30.14', '3C:61:05:A2:1F:14', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-node-2.4.1', 'พื้นที่โซน VIP',        'VIP Zone Area'),
  ('esp32-pond',        'ESP32 บ่อสำรอง',          'ESP32 Reserve Pond',    'esp32', 'tank_node',  'ESP32-WROOM-32E',    '10.20.30.15', '3C:61:05:A2:1F:15', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-node-2.4.1', 'ท้ายโรงงาน',          'Rear Plant Area'),
  ('esp32-meter-main',  'ESP32 มิเตอร์หลัก',        'ESP32 Main Meter',      'esp32', 'meter_node', 'ESP32-WROOM-32E',    '10.20.30.10', '3C:61:05:A2:1F:10', 30, 1883, 'mqtt', NULL,         'wifi', 'wcm-node-2.4.1', 'ประตูรับน้ำหน้าโรงงาน', 'Plant Water Inlet'),
  ('esp32-env-outdoor', 'ESP32 เซนเซอร์กลางแจ้ง',   'ESP32 Outdoor Sensor',  'esp32', 'env_node',   'ESP32-C3-DevKitM-1', '10.20.30.16', '3C:61:05:A2:1F:16', 30, 1883, 'mqtt', NULL,         'wifi', 'wcm-env-1.8.3',  'กลางแจ้ง',            'Outdoor'),
  ('esp32-elec-1',      'ESP32 ตู้ไฟฝ่ายผลิต',       'ESP32 Production Panel', 'esp32', 'power_node', 'ESP32-WROOM-32E',   '10.20.30.61', '3C:61:05:A2:1F:61', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-power-1.3.0', 'MDB-A อาคารผลิต',     'MDB-A Production'),
  ('esp32-elec-2',      'ESP32 ตู้ไฟอาคารสถานที่',    'ESP32 Facility Panel',  'esp32', 'power_node', 'ESP32-WROOM-32E',    '10.20.30.62', '3C:61:05:A2:1F:62', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-power-1.3.0', 'DB-B ส่วนกลาง',       'DB-B Common Area'),
  ('esp32-elec-3',      'ESP32 ตู้ไฟหอพักพนักงาน',    'ESP32 Dormitory Panel', 'esp32', 'power_node', 'ESP32-WROOM-32E',    '10.20.30.63', '3C:61:05:A2:1F:63', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-power-1.3.0', 'DB-C หอพัก',          'DB-C Dormitory'),
  ('esp32-elec-4',      'ESP32 ตู้ไฟสำนักผู้บริหาร',   'ESP32 Executive Panel', 'esp32', 'power_node', 'ESP32-WROOM-32E',    '10.20.30.64', '3C:61:05:A2:1F:64', 30, 1883, 'mqtt', 'modbus_rtu', 'wifi', 'wcm-power-1.3.0', 'DB-D อาคารรับรอง',    'DB-D Executive'),
  ('plc-1',             'PLC ระบบน้ำ',             'Water System PLC',      'plc',     'plc',     'SIMATIC S7-1200 CPU 1211C DC/DC/RLY', '10.20.20.5', '00:1B:1B:4C:7A:01', 20, 102,  's7comm',      NULL, 'ethernet', 'V4.6.1', 'ตู้คอนโทรลหลัก', 'Main Control Cabinet'),
  ('plc-2',             'PLC ส่วนขยาย',            'Expansion PLC',         'plc',     'plc',     'MITSUBISHI FX3G-24MR',                '10.20.20.6', '00:80:F4:2A:11:C3', 20, 5551, 'mc_protocol', NULL, 'ethernet', 'V2.30',  'ตู้คอนโทรลย่อย อาคารผลิต B', 'Sub Panel — Production B'),
  ('hmi-1',             'HMI ตู้คอนโทรล',          'Control Cabinet HMI',   'hmi',     'hmi',     'SAMKOON SK-070HS',                    '10.20.20.10', '00:0E:C6:33:5B:9A', 20, 502, 'modbus_tcp',  NULL, 'ethernet', 'V2.1.8', 'ตู้คอนโทรลหลัก', 'Main Control Cabinet'),
  ('gw-1',              'IoT Gateway',             'IoT Gateway',           'gateway', 'gateway', 'SIMATIC IOT2000',                     '10.20.10.2', '8C:F3:19:2D:40:7B', 10, 1883, 'mqtt',        NULL, 'ethernet', 'IOT2000-Example-Image-V1.4.1', 'ตู้คอนโทรลหลัก', 'Main Control Cabinet');

-- ─────────────── entity ───────────────
-- ★ device_id ของปั๊ม = ESP32 ที่ "วัด" ค่า (PZEM) ไม่ใช่ PLC ที่ "สั่ง" — ตรงกับ PumpSpec.deviceId

-- ถัง
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec) VALUES
  ('tank-1', 'tank', 'esp32-pump-house', NULL,     'ถังใต้ดินหลัก', 'Main Underground Tank',
   '{"role":"underground_main","capacityLiters":70000,"heightMeters":3.5,"shape":"rectangular","levelSource":"sensor","location":"ลานหน้าห้องปั๊ม","locationEn":"Pump House Yard"}'),
  ('tank-2', 'tank', 'esp32-vip',        'zone-8', 'ถังโซน VIP',    'VIP Zone Tank',
   '{"role":"service","capacityLiters":3000,"heightMeters":2.0,"shape":"cylindrical","levelSource":"sensor","location":"พื้นที่โซน VIP","locationEn":"VIP Zone Area"}'),
  ('tank-3', 'tank', 'esp32-pond',       NULL,     'บ่อสำรอง',      'Reserve Pond',
   '{"role":"reserve_pond","capacityLiters":490000,"heightMeters":4.0,"shape":"pond","levelSource":"sensor","location":"ท้ายโรงงาน","locationEn":"Rear Plant Area"}');

-- ปั๊ม — ★ ปั๊ม 1/2 จ่ายทุกโซนเหมือนกัน สลับเวรกันเดิน ห้ามบวกอัตราไหลรวมกัน
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec) VALUES
  ('pump-1', 'pump', 'esp32-pump-house', NULL,     'ปั๊มหลัก 1',   'Main Pump 1',
   '{"role":"main","sourceTankId":"tank-1","servesZoneIds":["zone-1","zone-2","zone-3","zone-4","zone-5","zone-6","zone-7"],"ratedFlowLpm":220,"ratedPowerWatt":3000,"hasVfd":false,"controlledBy":"plc-1"}'),
  ('pump-2', 'pump', 'esp32-pump-house', NULL,     'ปั๊มหลัก 2',   'Main Pump 2',
   '{"role":"main","sourceTankId":"tank-1","servesZoneIds":["zone-1","zone-2","zone-3","zone-4","zone-5","zone-6","zone-7"],"ratedFlowLpm":220,"ratedPowerWatt":3000,"hasVfd":false,"controlledBy":"plc-1"}'),
  ('pump-3', 'pump', 'esp32-vip',        'zone-8', 'ปั๊มโซน VIP',  'VIP Zone Pump',
   '{"role":"vip","sourceTankId":"tank-2","servesZoneIds":["zone-8"],"ratedFlowLpm":60,"ratedPowerWatt":750,"hasVfd":true,"controlledBy":"plc-1"}');

-- โซน (entity ของโซนเอง ใช้เป็นเป้าของ alert เช่น สงสัยรั่ว)
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en)
SELECT zone_id, 'zone', NULL, zone_id, name_th, name_en FROM zones;

-- มิเตอร์รายโซน — ★ มิเตอร์ทุกโซนอยู่รวมจุดเดียว (ยกเว้น VIP)
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec)
SELECT 'meter-' || zone_id, 'meter',
       CASE WHEN is_vip THEN 'esp32-vip' ELSE 'esp32-meter-bank' END,
       zone_id, 'มิเตอร์โซน ' || zone_number, 'Zone ' || zone_number || ' Meter',
       jsonb_build_object('zoneNumber', zone_number, 'kFactor', 450)
  FROM zones;

INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec) VALUES
  ('meter-main', 'meter', 'esp32-meter-main', NULL, 'มิเตอร์หลัก (การประปา)', 'Main Meter (Utility)',
   '{"isMain":true,"pipeSizeInches":2,"supplierName":"การประปาส่วนภูมิภาค","supplierNameEn":"Provincial Waterworks Authority","supplierMeterNo":"PWA-4471-08822"}');

-- วาล์วรายโซน — ★ สั่งผ่าน ESP32 ไม่ใช่ PLC
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec)
SELECT 'valve-' || zone_id, 'valve',
       CASE WHEN is_vip THEN 'esp32-vip' ELSE 'esp32-valve-bank' END,
       zone_id, 'วาล์วโซน ' || zone_number, 'Zone ' || zone_number || ' Valve',
       jsonb_build_object('zoneNumber', zone_number)
  FROM zones;

-- เซนเซอร์สภาพแวดล้อม — ★ จุดในอาคารไม่มี barometer/light/rain → ส่ง null
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec) VALUES
  ('env-pump-room',       'sensor', 'esp32-pump-house',  NULL, 'เซนเซอร์ห้องปั๊ม',   'Pump Room Sensor',
   '{"location":"pump_room","locationLabel":"ห้องปั๊ม","locationLabelEn":"Pump Room","hasRainGauge":false,"hasWeatherSensors":false}'),
  ('env-control-cabinet', 'sensor', 'esp32-elec-2',      NULL, 'เซนเซอร์ตู้คอนโทรล', 'Control Cabinet Sensor',
   '{"location":"control_cabinet","locationLabel":"ตู้คอนโทรล","locationLabelEn":"Control Cabinet","hasRainGauge":false,"hasWeatherSensors":false}'),
  ('env-outdoor',         'sensor', 'esp32-env-outdoor', NULL, 'เซนเซอร์กลางแจ้ง',   'Outdoor Sensor',
   '{"location":"outdoor","locationLabel":"กลางแจ้ง","locationLabelEn":"Outdoor","hasRainGauge":true,"hasWeatherSensors":true,"rainGaugeMmPerTip":0.2}');

-- ตู้ไฟรายแผนก — ★ ตู้ 3 เฟสส่ง 3 แถวต่อรอบ (MDB-A, DB-B, DB-C) · DB-D เฟสเดียว
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec) VALUES
  ('elec-production', 'electric_node', 'esp32-elec-1', NULL, 'ตู้ไฟฝ่ายผลิต',       'Production Panel',
   '{"departmentId":"dept-production","panelName":"MDB-A อาคารผลิต","panelNameEn":"MDB-A Production","phase":"three","breakerRatingAmp":250}'),
  ('elec-facility',   'electric_node', 'esp32-elec-2', NULL, 'ตู้ไฟอาคารสถานที่',    'Facility Panel',
   '{"departmentId":"dept-facility","panelName":"DB-B ส่วนกลาง","panelNameEn":"DB-B Common Area","phase":"three","breakerRatingAmp":100}'),
  ('elec-dormitory',  'electric_node', 'esp32-elec-3', NULL, 'ตู้ไฟหอพักพนักงาน',    'Dormitory Panel',
   '{"departmentId":"dept-hr","panelName":"DB-C หอพัก","panelNameEn":"DB-C Dormitory","phase":"three","breakerRatingAmp":100}'),
  ('elec-executive',  'electric_node', 'esp32-elec-4', NULL, 'ตู้ไฟสำนักผู้บริหาร',   'Executive Panel',
   '{"departmentId":"dept-executive","panelName":"DB-D อาคารรับรอง","panelNameEn":"DB-D Executive","phase":"single","breakerRatingAmp":63}');

-- ระบบควบคุมแรงดัน + entity ระดับทั้งโรงงาน (ใช้กับ metric อย่าง unaccounted_percent)
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en, spec) VALUES
  ('pressure-control-1', 'pressure_control', 'plc-1', NULL, 'ระบบควบคุมแรงดันน้ำ', 'Pressure Control Loop', '{}'),
  ('plant',              'system',           NULL,    NULL, 'ระบบน้ำทั้งโรงงาน',   'Plant Water System',    '{}');

-- อุปกรณ์เป็น entity ด้วย — device_status / online_state อ้างถึงได้
INSERT INTO entities (entity_id, source_type, device_id, zone_id, name, name_en)
SELECT device_id, 'device', device_id, NULL, name, name_en FROM devices;

-- ─────────────── ตารางระดับ → ปริมาตร ───────────────
-- ★ ถังทรงเรขาคณิตใส่ 2 จุด (ว่าง, เต็ม) เพื่อให้ทุกถังแปลงผ่าน tank_volume() ทางเดียว
INSERT INTO tank_profiles (entity_id, version, level_m, volume_l) VALUES
  ('tank-1', 1, 0.0, 0), ('tank-1', 1, 3.5, 70000),
  ('tank-2', 1, 0.0, 0), ('tank-2', 1, 2.0, 3000),
  ('tank-3', 1, 0.0, 0),      ('tank-3', 1, 0.5, 42000),  ('tank-3', 1, 1.0, 92000),
  ('tank-3', 1, 1.5, 148000), ('tank-3', 1, 2.0, 209000), ('tank-3', 1, 2.5, 275000),
  ('tank-3', 1, 3.0, 345000), ('tank-3', 1, 3.5, 416000), ('tank-3', 1, 4.0, 490000);

-- ─────────────── อัตราค่าน้ำ/ค่าไฟ ───────────────
INSERT INTO tariffs (kind, effective_from, config) VALUES
  ('water', '2026-01-01', '{
     "tiers": [
       {"min_m3": 0,   "max_m3": 30,   "rate": 17.00},
       {"min_m3": 30,  "max_m3": 50,   "rate": 19.50},
       {"min_m3": 50,  "max_m3": 80,   "rate": 21.80},
       {"min_m3": 80,  "max_m3": 100,  "rate": 23.40},
       {"min_m3": 100, "max_m3": null, "rate": 25.60}
     ],
     "service_charge": 90,
     "vat_percent": 7
   }'),
  ('electricity', '2026-01-01', '{"rate_per_kwh": 4.18, "ft_per_kwh": 0.3972}');

-- ─────────────── เกณฑ์เตือนตั้งต้น (ตรงกับ DEFAULT_SETTINGS.thresholds) ───────────────
INSERT INTO thresholds (entity_id, metric, crit_low, warn_low, warn_high, crit_high) VALUES
  -- กระแสปั๊ม เตือน 11.5 A วิกฤต 13.0 A · แรงดันน้ำ
  ('pump-1', 'current_amp', NULL, NULL, 11.5, 13.0),
  ('pump-2', 'current_amp', NULL, NULL, 11.5, 13.0),
  ('pump-3', 'current_amp', NULL, NULL, 11.5, 13.0),
  ('pump-1', 'pressure_bar', 1.2, 1.8, 4.5, 5.2),
  ('pump-2', 'pressure_bar', 1.2, 1.8, 4.5, 5.2),
  ('pump-3', 'pressure_bar', 1.2, 1.8, 4.5, 5.2),
  -- ระดับน้ำ (%) — บ่อสำรองยอมให้ต่ำกว่าได้เพราะเป็นน้ำสำรอง
  ('tank-1', 'level_percent', 20, 35, 95, 98),
  ('tank-2', 'level_percent', 20, 35, 95, 98),
  ('tank-3', 'level_percent', 15, 30, 97, NULL),
  -- อุณหภูมิ เตือน 40 วิกฤต 45 · ความชื้น ปกติ 25–80 วิกฤต > 90
  ('env-pump-room',       'temperature', NULL, NULL, 40, 45),
  ('env-control-cabinet', 'temperature', NULL, NULL, 40, 45),
  ('env-outdoor',         'temperature', NULL, NULL, 40, 45),
  ('env-pump-room',       'humidity', NULL, 25, 80, 90),
  ('env-control-cabinet', 'humidity', NULL, 25, 80, 90),
  ('env-outdoor',         'humidity', NULL, 25, 80, 90),
  -- กระแสตู้ไฟ เตือน 80% วิกฤต 95% ของพิกัดเบรกเกอร์
  ('elec-production', 'current_amp', NULL, NULL, 200, 238),
  ('elec-facility',   'current_amp', NULL, NULL, 80, 95),
  ('elec-dormitory',  'current_amp', NULL, NULL, 80, 95),
  ('elec-executive',  'current_amp', NULL, NULL, 50, 60),
  -- น้ำสูญหาย เตือน 8% วิกฤต 15%
  ('plant', 'unaccounted_percent', NULL, NULL, 8, 15);

-- อัตราไหลต่อโซน เตือน 1.6× วิกฤต 2.1× ของ baseline (ใช้จับท่อแตก)
INSERT INTO thresholds (entity_id, metric, crit_low, warn_low, warn_high, crit_high)
SELECT 'meter-' || z.zone_id, 'flow_lpm', NULL, NULL, round(b.lpm * 1.6), round(b.lpm * 2.1)
  FROM zones z
  JOIN (VALUES ('zone-1', 46), ('zone-2', 38), ('zone-3', 20), ('zone-4', 13),
               ('zone-5', 28), ('zone-6', 54), ('zone-7', 16), ('zone-8', 9)) AS b(zone_id, lpm)
    ON b.zone_id = z.zone_id;

-- ─────────────── ค่าตั้งระบบ ───────────────
-- ★ เขตเวลาอ่านจากแถวนี้ ห้าม hardcode ในโค้ด
INSERT INTO settings (section, value, updated_by) VALUES
  ('general', '{
     "siteName": "โรงงานสาขาธัญบุรี",
     "siteNameEn": "Thanyaburi Plant",
     "timezone": "Asia/Bangkok",
     "defaultLocale": "th",
     "defaultTheme": "system",
     "refreshIntervalMs": 2000,
     "wallDisplayMode": false
   }', 'user-admin');
