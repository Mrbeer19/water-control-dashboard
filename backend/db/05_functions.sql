-- ═════════════════════════════════════════════════════════════
-- 05_functions.sql — ฟังก์ชันคำนวณที่ต้องตรงกันทุกที่
-- ═════════════════════════════════════════════════════════════

-- ปริมาตรถังจากระดับน้ำ — interpolate เชิงเส้นจาก tank_profiles
-- ★ บ่อสำรองผนังลาด ใช้ level × area ไม่ได้ · นอกช่วงตาราง clamp ที่ขอบ
-- p_version = NULL → ใช้ตารางเวอร์ชันล่าสุด
CREATE OR REPLACE FUNCTION tank_volume(p_entity TEXT, p_level NUMERIC, p_version INT DEFAULT NULL)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_version INT;
  lo RECORD;
  hi RECORD;
BEGIN
  IF p_level IS NULL THEN
    RETURN NULL;
  END IF;

  v_version := COALESCE(p_version, (SELECT max(version) FROM tank_profiles WHERE entity_id = p_entity));
  IF v_version IS NULL THEN
    RETURN NULL;                                    -- ไม่มีตาราง = แปลงไม่ได้ ห้ามเดา
  END IF;

  SELECT level_m, volume_l INTO lo FROM tank_profiles
   WHERE entity_id = p_entity AND version = v_version AND level_m <= p_level
   ORDER BY level_m DESC LIMIT 1;
  SELECT level_m, volume_l INTO hi FROM tank_profiles
   WHERE entity_id = p_entity AND version = v_version AND level_m >= p_level
   ORDER BY level_m ASC LIMIT 1;

  IF lo IS NULL THEN RETURN hi.volume_l; END IF;    -- ต่ำกว่าจุดแรก → clamp ล่าง
  IF hi IS NULL THEN RETURN lo.volume_l; END IF;    -- สูงกว่าจุดสุดท้าย → clamp บน
  IF hi.level_m = lo.level_m THEN RETURN lo.volume_l; END IF;

  RETURN lo.volume_l + (p_level - lo.level_m) * (hi.volume_l - lo.volume_l) / (hi.level_m - lo.level_m);
END
$$;

-- ค่าน้ำขั้นบันได — คิดสะสมทีละขั้น ไม่ใช่เอาอัตราขั้นสูงสุดคูณทั้งก้อน
-- config: {"tiers":[{"min_m3":0,"max_m3":30,"rate":17.0},…,{"min_m3":100,"max_m3":null,"rate":25.6}],
--          "service_charge":90,"vat_percent":7}
-- ★ ต้องเรียกกับยอดทั้งรอบบิล คิดรายวันแยกแล้วบวก ≠ คิดจากยอดรวม
CREATE OR REPLACE FUNCTION water_cost(p_m3 NUMERIC, p_config JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  tier     JSONB;
  lo       NUMERIC;
  hi       NUMERIC;
  subtotal NUMERIC := 0;
BEGIN
  -- ไม่มีอัตรา (เช่น ข้อมูลก่อน effective_from แรก) = คิดไม่ได้ → null ไม่ใช่ 0
  IF p_m3 IS NULL OR p_config IS NULL THEN
    RETURN NULL;
  END IF;

  FOR tier IN SELECT value FROM jsonb_array_elements(p_config -> 'tiers') LOOP
    lo := (tier ->> 'min_m3')::numeric;
    hi := (tier ->> 'max_m3')::numeric;             -- JSON null → SQL NULL = ไม่มีเพดาน
    IF p_m3 > lo THEN
      subtotal := subtotal + (LEAST(p_m3, COALESCE(hi, p_m3)) - lo) * (tier ->> 'rate')::numeric;
    END IF;
  END LOOP;

  RETURN round(
    (subtotal + COALESCE((p_config ->> 'service_charge')::numeric, 0))
      * (1 + COALESCE((p_config ->> 'vat_percent')::numeric, 0) / 100),
    2);
END
$$;

-- อัตราที่มีผล ณ วันที่หนึ่ง — เลือกแถวล่าสุดที่ effective_from <= วันนั้น
-- ★ ห้าม hardcode อัตรา ไม่งั้นรายงานย้อนหลังจะคิดด้วยอัตราใหม่ทั้งหมด
CREATE OR REPLACE FUNCTION tariff_config(p_kind TEXT, p_on DATE)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT config FROM tariffs
   WHERE kind = p_kind AND effective_from <= p_on
   ORDER BY effective_from DESC
   LIMIT 1
$$;

-- ทางลัด: ค่าน้ำตามอัตราที่มีผล ณ วันที่ระบุ (ค่าเริ่มต้น = วันนี้)
CREATE OR REPLACE FUNCTION water_cost_at(p_m3 NUMERIC, p_on DATE DEFAULT current_date)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT water_cost(p_m3, tariff_config('water', p_on))
$$;

CREATE OR REPLACE FUNCTION water_cost(p_m3 NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
  SELECT water_cost_at(p_m3, current_date)
$$;
