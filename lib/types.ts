/**
 * lib/types.ts — API contract กลางของระบบ
 *
 * ★ ไฟล์นี้จะ export ให้ทีมหลังบ้านใช้เป็นสัญญา (contract) ของ REST API
 *   type ทุกตัวของระบบรวมอยู่ที่นี่ไฟล์เดียว ห้ามประกาศ type ของ domain ที่อื่น
 *
 * ═══ ขอบเขตของ contract นี้ ═══
 *
 * ครอบคลุม  น้ำ:    ถัง ปั๊ม วาล์ว มิเตอร์ 8 โซน มิเตอร์หลัก ระบบควบคุมแรงดัน
 *                   → ทั้ง "มอนิเตอร์" และ "ควบคุม"
 *           ไฟฟ้า:  Electric node รายแผนก และค่าไฟฟ้าของปั๊ม
 *                   → "มอนิเตอร์และแบ่งค่าใช้จ่าย" เท่านั้น ระบบนี้ไม่สั่งตัด/ต่อไฟ
 *           ร่วม:   แผนก ผู้ใช้ การแจ้งเตือน ความผิดปกติ รายงาน และค่าสาธารณูปโภค
 *
 * ไม่ครอบคลุม  ระบบบำบัดน้ำเสีย คุณภาพน้ำ (pH/คลอรีน) และการควบคุมโหลดไฟฟ้า
 *
 * ═══ ข้อตกลงร่วม ═══
 *
 * - เวลาเป็น ISO 8601 (UTC offset +07:00) ยกเว้นจุดข้อมูลกราฟที่ใช้ epoch ms เพื่อความเร็ว
 * - หน่วยกำกับไว้ในชื่อ field เสมอ (Liters, Lpm, CubicMeters, Celsius, Hz, ...)
 * - entity ฮาร์ดแวร์ extends BaseEntity / เรกคอร์ด extends BaseRecord
 * - ค่าที่ยังไม่มี = null เสมอ ไม่ใช้ 0 หรือ '' แทนความว่าง
 * - type ที่เป็นเรื่องหน้าจอล้วน ๆ อยู่ท้ายไฟล์ในหัวข้อ "ส่วนเฉพาะหน้าบ้าน"
 *   หลังบ้านไม่ต้องสนใจส่วนนั้น
 */

// ═════════════════════════════════════════════════════════════
// พื้นฐานร่วม
// ═════════════════════════════════════════════════════════════

/** ISO 8601 เช่น "2026-09-10T14:32:05+07:00" */
export type ISODateTime = string;

/** epoch milliseconds — ใช้กับจุดข้อมูลกราฟ (Recharts จัดการ number เร็วกว่า string) */
export type EpochMs = number;

/** สีสถานะตาม CLAUDE.md: เขียว=ปกติ เหลือง=เตือน แดง=วิกฤต เทา=offline */
export type EntityStatus = 'ok' | 'warning' | 'critical' | 'offline';

/** ฐานของ entity ฮาร์ดแวร์ทุกตัว (ถัง ปั๊ม โซน มิเตอร์ เซนเซอร์ อุปกรณ์ electric node) */
export interface BaseEntity {
  id: string;
  /** ชื่อที่แสดงบน UI (ไทย) */
  name: string;
  /** ชื่ออังกฤษสำหรับ toggle EN และการอ้างอิงในรายงาน */
  nameEn: string;
  status: EntityStatus;
  /** ครั้งล่าสุดที่ได้ยินจากอุปกรณ์จริง — ใช้ตัดสิน offline */
  lastSeen: ISODateTime;
  /** ครั้งล่าสุดที่เรกคอร์ดนี้ถูกอัปเดต */
  updatedAt: ISODateTime;
}

/**
 * ฐานของเรกคอร์ด (alert, command, ack, delivery, anomaly, forecast, report)
 *
 * ไม่มี field `status` โดยตั้งใจ — EntityStatus เป็นสถานะของ "ของที่มีอยู่จริง"
 * ค่าอย่าง 'offline' ไม่มีความหมายกับใบสั่งงานหรือใบรับทราบ
 * เรกคอร์ดแต่ละชนิดจึงถือสถานะของตัวเอง (severity / state / deliveryState)
 */
export interface BaseRecord {
  id: string;
  /** ป้ายกำกับสั้น ๆ สำหรับแสดงในตาราง/log */
  name: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** ค่าที่มีขอบเขตเตือน ใช้ซ้ำหลายที่ */
export interface ThresholdRange {
  criticalLow: number | null;
  warningLow: number | null;
  warningHigh: number | null;
  criticalHigh: number | null;
}

/**
 * ชื่อ metric ที่ query ประวัติได้ — ทำเป็น union เพื่อให้หน้าบ้านกับหลังบ้าน
 * สะกดตรงกันและได้ autocomplete (เดิมเป็น string ลอย)
 */
export type MetricKey =
  // ถัง
  | 'level_percent'
  | 'level_liters'
  | 'net_flow_lpm'
  // น้ำไหล
  | 'flow_lpm'
  | 'pressure_bar'
  // ปั๊ม / ไฟฟ้า
  | 'power_watt'
  | 'current_amp'
  | 'voltage_volt'
  | 'energy_kwh'
  | 'vfd_frequency_hz'
  // สภาพแวดล้อม
  | 'temperature'
  | 'humidity'
  | 'rainfall'
  | 'pressure_hpa'
  | 'illuminance_lux'
  | 'heat_index'
  // สุขภาพอุปกรณ์
  | 'rssi_dbm'
  | 'uptime_seconds'
  | 'free_heap_bytes'
  // ระดับระบบ
  | 'main_inflow_lpm'
  | 'zone_outflow_lpm'
  | 'unaccounted_percent'
  | 'headcount';

/** จุดข้อมูลกราฟมาตรฐาน */
export interface TimeSeriesPoint {
  timestamp: EpochMs;
  value: number;
  /** true เมื่อจุดนี้เป็นข้อมูลที่ระบบเติมแทนช่วงที่เซนเซอร์ขาด */
  imputed?: boolean;
}

/** ชุดข้อมูลกราฟหนึ่งเส้น */
export interface TimeSeriesSeries {
  id: string;
  name: string;
  nameEn: string;
  metric: MetricKey;
  unit: string;
  points: TimeSeriesPoint[];
}

/** ช่วงเวลาที่ผู้ใช้เลือกบนกราฟ/รายงาน */
export type TimeRangePreset = '1h' | '6h' | '24h' | '7d' | '30d' | 'custom';

export interface TimeRange {
  preset: TimeRangePreset;
  from: ISODateTime;
  to: ISODateTime;
}

/** สถานะการเชื่อมต่อที่ Header ใช้ */
export interface ConnectionStatus {
  /** เชื่อมต่อ gateway/broker ในโรงงานได้หรือไม่ */
  online: boolean;
  lastSyncAt: ISODateTime;
  latencyMs: number;
  /** จำนวนอุปกรณ์ที่ขาดการติดต่อ */
  offlineDeviceCount: number;
}

// ─────────────────────────────────────────────────────────────
// รูปแบบการตอบกลับของ API
// ─────────────────────────────────────────────────────────────

/**
 * รูปแบบ error มาตรฐาน — ทุก endpoint ที่ไม่ใช่ 2xx ต้องตอบด้วยรูปนี้
 * หน้าบ้านแสดง messageTh/messageEn ตามภาษาที่เลือก และใช้ code ตัดสินใจเชิงตรรกะ
 */
export interface ApiError {
  /** รหัสคงที่ เช่น "VALIDATION_FAILED", "PLC_TIMEOUT", "FORBIDDEN" */
  code: string;
  messageTh: string;
  messageEn: string;
  /** รายละเอียดเพิ่มเติม เช่น { field: 'setpointBar', reason: 'out_of_range' } */
  details: Record<string, string | number | boolean | null> | null;
  /** ใช้ตามรอยใน log ฝั่งหลังบ้าน */
  traceId: string | null;
}

/** ซองตอบกลับของ endpoint ที่คืนข้อมูลเดี่ยว */
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** ผลลัพธ์แบบแบ่งหน้า */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ═════════════════════════════════════════════════════════════
// องค์กร: แผนกและผู้ใช้
// ═════════════════════════════════════════════════════════════

/**
 * แผนกที่รับผิดชอบค่าใช้จ่าย — เป้าหมายหลักของโปรเจกต์คือแบ่งค่าน้ำ/ค่าไฟตามแผนก
 * หนึ่งแผนกถือได้หลายโซนน้ำและหลาย electric node
 */
export interface Department {
  id: string;
  name: string;
  nameEn: string;
  /** รหัสศูนย์ต้นทุนในระบบบัญชี ใช้กระทบยอดกับฝ่ายการเงิน */
  costCenterCode: string;
  /** หัวหน้าแผนกที่รับ alert ของพื้นที่นี้ */
  managerUserId: string | null;
  active: boolean;
}

/**
 * บทบาทผู้ใช้
 * viewer   ดูอย่างเดียว
 * operator สั่งงานปั๊ม/วาล์ว และรับทราบ alert ได้
 * admin    แก้ตั้งค่าระบบและจัดการผู้ใช้ได้
 */
export type UserRole = 'viewer' | 'operator' | 'admin';

/**
 * ผู้ใช้ระบบ
 *
 * field ที่เดิมเป็น string ลอย (issuedBy, acknowledgedBy, updatedBy) ตอนนี้เก็บเป็น
 * User['id'] ทั้งหมด และมีชื่อสำหรับแสดงผลคู่มาด้วยเพื่อไม่ต้อง join ทุกครั้ง
 */
export interface User {
  id: string;
  displayName: string;
  role: UserRole;
  /** แผนกต้นสังกัด — ใช้กับ row level security ที่แยกข้อมูลตามแผนก */
  departmentId: string | null;
  active: boolean;
}

/** ผู้กระทำที่บันทึกไว้ในเรกคอร์ด — เก็บชื่อคู่มาเพื่อให้ log อ่านได้โดยไม่ต้อง join */
export interface ActorRef {
  userId: string;
  displayName: string;
  role: UserRole;
}

// ═════════════════════════════════════════════════════════════
// ถังน้ำ
// ═════════════════════════════════════════════════════════════

/** Tank 1 ถังใต้ดินหลัก / Tank 2 ถังจ่าย / Tank 3 บ่อสำรอง */
export type TankRole = 'underground_main' | 'service' | 'reserve_pond';

/**
 * รูปทรงถัง — ใช้ตัดสินว่าจะแปลงระดับ (เมตร) เป็นปริมาตร (ลิตร) ด้วยสูตรไหน
 * 'pond' คือบ่อขุดที่หน้าตัดไม่คงที่ตามความลึก จึงต้องใช้ตารางเทียบระดับ–ปริมาตร
 * 'irregular' คือถังรูปทรงอื่นที่ต้องมีตารางเทียบเช่นกัน
 */
export type TankShape = 'rectangular' | 'cylindrical' | 'pond' | 'irregular';

/**
 * ที่มาของค่าระดับน้ำ
 * sensor  อ่านจากเซนเซอร์อัตโนมัติ
 * manual  ให้คนจดแล้วกรอกเข้าระบบ (บ่อสำรองยังไม่มีเซนเซอร์ / เซนเซอร์เสีย)
 */
export type TankLevelSource = 'sensor' | 'manual';

export interface Tank extends BaseEntity {
  role: TankRole;
  shape: TankShape;
  /**
   * ★ บ่อสำรอง (shape = 'pond') หน้าตัดไม่คงที่ percentFull จึงคำนวณจาก
   *   level × area ตรง ๆ ไม่ได้ ต้องเทียบจาก levelToVolumeTable
   */
  levelSource: TankLevelSource;
  /** ตารางเทียบระดับ (เมตร) → ปริมาตร (ลิตร) — จำเป็นเมื่อ shape เป็น pond/irregular */
  levelToVolumeTable: TankLevelPoint[] | null;
  /** ครั้งล่าสุดที่มีคนกรอกค่าเอง — null เมื่อ levelSource เป็น sensor */
  manualReadingAt: ISODateTime | null;
  manualReadingBy: ActorRef | null;

  capacityLiters: number;
  currentLiters: number;
  /** 0–100 คำนวณจาก currentLiters / capacityLiters */
  percentFull: number;
  /** ระดับน้ำดิบจากเซนเซอร์หรือที่กรอกเอง (เมตร) */
  levelMeters: number;
  /** ความสูง/ความลึกใช้งานจริง (เมตร) */
  heightMeters: number;

  /** น้ำเข้า/น้ำออก ณ ขณะนี้ */
  inflowLpm: number;
  outflowLpm: number;
  /** inflow − outflow (บวก = กำลังเติม) */
  netFlowLpm: number;

  /**
   * ขอบเขตเตือนคิดเป็นเปอร์เซ็นต์ของความจุ
   * ★ เป็นสำเนา denormalized ของ SystemSettings.thresholds.tankLevelPercent[id]
   *   เพื่อให้หน้าบ้านตัดสินสีได้โดยไม่ต้องดึง settings มาด้วยทุกครั้ง
   *   ต้นทางความจริงคือ settings — หลังบ้านต้องอัปเดตสำเนานี้เมื่อ settings เปลี่ยน
   */
  thresholdsPercent: ThresholdRange;

  /** ประมาณเวลาจนเต็ม/จนหมดที่อัตราไหลปัจจุบัน — null เมื่อ netFlow ≈ 0 */
  minutesToFull: number | null;
  minutesToEmpty: number | null;

  /** ESP32 node ที่วัดถังใบนี้ — null เมื่อ levelSource เป็น manual */
  deviceId: string | null;
  location: string;
  locationEn: string;
}

/** หนึ่งบรรทัดในตารางเทียบระดับ–ปริมาตรของบ่อ */
export interface TankLevelPoint {
  levelMeters: number;
  volumeLiters: number;
}

// ═════════════════════════════════════════════════════════════
// ปั๊มและระบบควบคุมแรงดัน
// ═════════════════════════════════════════════════════════════

/** Pump 1, 2 = main / Pump 3 = VIP zone (ตัวที่ติด VFD) */
export type PumpRole = 'main' | 'vip';

export type PumpRunState = 'running' | 'stopped' | 'starting' | 'stopping' | 'fault';

/**
 * โหมดควบคุมปั๊ม
 * auto        PLC สั่งเดิน/หยุดตามระดับน้ำ
 * manual      คนสั่งจากหน้า Control
 * pid         VFD ปรับรอบอัตโนมัติเพื่อรักษาแรงดันตาม setpoint
 * locked_out  ถูกล็อกไว้ (ซ่อมบำรุง / หลังกดหยุดฉุกเฉิน)
 */
export type PumpControlMode = 'auto' | 'manual' | 'pid' | 'locked_out';

/** ค่าไฟฟ้าที่อ่านจาก power meter (PZEM ที่ปั๊ม หรือมิเตอร์ของ electric node) */
export interface ElectricalReading {
  voltage: number;
  current: number;
  powerWatt: number;
  /** ตัวสะสมพลังงาน (kWh) */
  energyKwh: number;
  powerFactor: number;
}

export interface Pump extends BaseEntity {
  role: PumpRole;
  runState: PumpRunState;
  controlMode: PumpControlMode;
  electrical: ElectricalReading;

  // ── VFD (มีเฉพาะปั๊มที่ติดอินเวอร์เตอร์) ──
  /** true = ปั๊มตัวนี้ขับด้วย VFD และรองรับโหมด 'pid' */
  hasVfd: boolean;
  /** ความถี่ที่ VFD จ่ายอยู่ (Hz) — null เมื่อไม่มี VFD */
  vfdFrequencyHz: number | null;
  /** รอบปั๊มคิดเป็น % ของความถี่พิกัด (50 Hz) — null เมื่อไม่มี VFD */
  speedPercent: number | null;
  /** แรงดันเป้าหมายที่ PID กำลังรักษาอยู่ — null เมื่อไม่ได้อยู่โหมด pid */
  pressureSetpointBar: number | null;

  /** อัตราไหลที่ปั๊มส่งได้ ณ ขณะนี้ */
  flowLpm: number;
  dischargePressureBar: number;
  /** ชั่วโมงเดินสะสมตลอดอายุการใช้งาน */
  runtimeHours: number;
  /** จำนวนครั้งที่สตาร์ตวันนี้ — สตาร์ตถี่เกินคือสัญญาณผิดปกติ */
  startsToday: number;
  lastStartedAt: ISODateTime | null;
  lastStoppedAt: ISODateTime | null;
  /** รหัสความผิดพลาดจาก PLC/VFD เมื่อ runState = 'fault' */
  faultCode: string | null;
  faultMessage: string | null;
  /** ชั่วโมงเดินก่อนถึงกำหนดบำรุงรักษาครั้งถัดไป */
  hoursUntilService: number;

  /** ถังที่ปั๊มตัวนี้ดูดน้ำมา / โซนที่จ่ายออก */
  sourceTankId: string;
  servesZoneIds: string[];
  deviceId: string;
}

/**
 * ที่มาของค่า setpoint แรงดัน
 * manual         คนตั้งค่าเอง
 * headcount      ปรับตามจำนวนคนในพื้นที่ (people counting)
 * schedule       ปรับตามตารางเวลา/กะ
 */
export type PressureSetpointMode = 'manual' | 'headcount' | 'schedule';

/**
 * ระบบควบคุมแรงดันน้ำระดับระบบ
 * ฮาร์ดแวร์: S7-1200 + SM1231 (AI 4–20 mA) + pressure transmitter + VFD ที่ปั๊ม
 */
export interface PressureControl extends BaseEntity {
  /** แรงดันที่ต้องการรักษา */
  setpointBar: number;
  /** แรงดันที่วัดได้จาก transmitter ตอนนี้ */
  measuredPressureBar: number;
  mode: PressureSetpointMode;
  /** จำนวนคนในพื้นที่จากระบบนับคน — null เมื่อ mode ไม่ใช่ 'headcount' */
  headcount: number | null;
  headcountUpdatedAt: ISODateTime | null;
  /** ผลลัพธ์ของ PID ที่ส่งไป VFD (0–100%) */
  outputPercent: number;
  /** พารามิเตอร์ PID ที่ตั้งไว้ใน PLC */
  gains: PidGains;
  /** ปั๊มที่ลูป PID นี้ควบคุมอยู่ */
  controlledPumpId: string;
  /** ขอบเขตที่ยอมให้ตั้ง setpoint ได้ กันคนตั้งจนท่อแตก */
  setpointLimitsBar: { min: number; max: number };
}

export interface PidGains {
  kp: number;
  ki: number;
  kd: number;
}

// ═════════════════════════════════════════════════════════════
// วาล์ว มิเตอร์ และโซน
// ═════════════════════════════════════════════════════════════

export type ValvePosition = 'open' | 'closed' | 'opening' | 'closing' | 'fault';

/** วาล์วไฟฟ้าประจำโซน (ท่อจ่าย 1") */
export interface Valve extends BaseEntity {
  zoneId: string;
  position: ValvePosition;
  /** เปอร์เซ็นต์การเปิด สำหรับวาล์วปรับได้ — วาล์ว on/off จะเป็น 0 หรือ 100 */
  openPercent: number;
  /** true = เปิด/ปิดได้จากหน้า Control */
  remoteEnabled: boolean;
  lastCommandId: string | null;
  lastActuatedAt: ISODateTime | null;
  cycleCount: number;
  deviceId: string;
}

/** มิเตอร์น้ำแบบ pulse — ใช้ทั้งมิเตอร์โซนและมิเตอร์หลัก */
export interface WaterMeter extends BaseEntity {
  /** ขนาดท่อ: โซน = 1" / มิเตอร์หลัก = 2" */
  pipeSizeInches: number;
  flowLpm: number;
  /** ตัวเลขสะสมบนหน้าปัดมิเตอร์ (m³) — 1 ยูนิต = 1 m³ */
  totalizerCubicMeters: number;
  todayCubicMeters: number;
  monthCubicMeters: number;
  /** ค่าคงที่แปลง pulse → ลิตร ของมิเตอร์รุ่นนี้ */
  pulsesPerLiter: number;
  /** โซนที่มิเตอร์นี้วัด — null สำหรับมิเตอร์หลัก */
  zoneId: string | null;
  deviceId: string;
}

/** มิเตอร์หลักรับน้ำจากการประปา (ท่อ 2") */
export interface MainMeter extends WaterMeter {
  zoneId: null;
  supplierName: string;
  supplierNameEn: string;
  /** เลขมิเตอร์ตามใบแจ้งหนี้การประปา */
  supplierMeterNo: string;
  /** แรงดันน้ำขาเข้าจากท่อเมน */
  inletPressureBar: number;
}

export interface Zone extends BaseEntity {
  /** ลำดับโซน 1–8 */
  zoneNumber: number;
  area: string;
  areaEn: string;
  /** แผนกที่รับผิดชอบค่าน้ำของโซนนี้ — null เมื่อเป็นพื้นที่ส่วนกลาง */
  departmentId: string | null;
  meterId: string;
  valveId: string;
  flowLpm: number;
  todayCubicMeters: number;
  monthCubicMeters: number;
  /** โควตาการใช้น้ำต่อวัน (m³) — null = ไม่จำกัด */
  dailyQuotaCubicMeters: number | null;
  /**
   * ★ สำเนา denormalized ของ SystemSettings.thresholds.zoneFlowLpm[id]
   *   ต้นทางความจริงคือ settings
   */
  thresholdsLpm: ThresholdRange;
  /** โซน VIP จ่ายด้วย Pump 3 และห้ามตัดน้ำอัตโนมัติ */
  isVip: boolean;
  /** true เมื่อพบการไหลต่อเนื่องขณะไม่มีการใช้งาน (สัญญาณรั่ว) */
  leakSuspected: boolean;
}

/**
 * สมดุลน้ำของระบบ
 *
 * ★ สูตร: unaccounted = มิเตอร์หลัก − Σ 8 โซน − Δ ปริมาณน้ำในถัง
 *
 *   ห้ามใช้แค่ (main − Σzone) เพราะช่วงที่กำลังเติมถัง น้ำที่เข้ามายังไม่ถูกใช้
 *   ผลต่างจะพุ่งขึ้นและระบบจะเตือนว่ารั่วทั้งที่ปกติ ตรงข้ามกับช่วงที่ดึงน้ำจากถัง
 *   ผลต่างจะติดลบ Δstorage จึงเป็นตัวหักล้างที่ขาดไม่ได้
 */
export interface UnaccountedWater {
  periodStart: ISODateTime;
  periodEnd: ISODateTime;
  mainMeterCubicMeters: number;
  zoneTotalCubicMeters: number;
  /** Δ ปริมาณน้ำรวมในถังทุกใบช่วงเดียวกัน (บวก = ถังเก็บน้ำเพิ่มขึ้น) */
  storageDeltaCubicMeters: number;
  /** mainMeterCubicMeters − zoneTotalCubicMeters − storageDeltaCubicMeters */
  unaccountedCubicMeters: number;
  unaccountedPercent: number;
  status: EntityStatus;
}

// ═════════════════════════════════════════════════════════════
// ไฟฟ้า (มอนิเตอร์และแบ่งค่าใช้จ่ายเท่านั้น ระบบนี้ไม่สั่งตัด/ต่อไฟ)
// ═════════════════════════════════════════════════════════════

export type ElectricPhase = 'single' | 'three';

/**
 * จุดวัดไฟฟ้าประจำแผนก — ESP32 + PZEM ที่ตู้ย่อยของแต่ละแผนก
 * ใช้แบ่งค่าไฟตามการใช้จริงแทนการเฉลี่ยตามพื้นที่
 */
export interface ElectricNode extends BaseEntity {
  /** แผนกที่รับผิดชอบค่าไฟของจุดวัดนี้ */
  departmentId: string;
  phase: ElectricPhase;
  electrical: ElectricalReading;
  todayEnergyKwh: number;
  monthEnergyKwh: number;
  /** ขนาดเบรกเกอร์ของตู้ย่อย ใช้เตือนเมื่อกระแสเข้าใกล้พิกัด */
  breakerRatingAmp: number;
  currentThresholds: ThresholdRange;
  panelName: string;
  panelNameEn: string;
  deviceId: string;
}

// ═════════════════════════════════════════════════════════════
// เซนเซอร์สภาพแวดล้อม
// ═════════════════════════════════════════════════════════════

/** 3 จุดตาม CLAUDE.md: ห้องปั๊ม, ตู้คอนโทรล, กลางแจ้ง */
export type EnvironmentLocation = 'pump_room' | 'control_cabinet' | 'outdoor';

/**
 * ค่าที่อ่านได้หนึ่งครั้งจากเซนเซอร์
 * ห้ามใช้ weather API — ทุกค่าที่นี่มาจากเซนเซอร์ในพื้นที่เท่านั้น
 */
export interface EnvironmentReading {
  timestamp: EpochMs;
  temperatureCelsius: number;
  humidityPercent: number;
  /** จุดกลั่นตัว — ใช้เตือนไอน้ำเกาะในตู้คอนโทรล */
  dewPointCelsius: number;
  /**
   * ดัชนีความร้อน — อุณหภูมิที่ร่างกายรู้สึกจริงเมื่อรวมความชื้นเข้าไปด้วย
   * ใช้เตือนความปลอดภัยของช่างที่เข้าไปทำงานในห้องปั๊ม
   */
  heatIndexCelsius: number;

  /** เฉพาะจุดกลางแจ้ง: ความกดอากาศ (hPa) — null สำหรับจุดในอาคาร */
  pressureHpa: number | null;
  /** เฉพาะจุดกลางแจ้ง: ความเข้มแสง (lux) — null สำหรับจุดในอาคาร */
  illuminanceLux: number | null;
  /** เฉพาะจุดกลางแจ้ง: ปริมาณฝนจาก rain gauge (มม./ชม.) */
  rainfallMmPerHour: number | null;
  /** เฉพาะจุดกลางแจ้ง: ฝนสะสมตั้งแต่เที่ยงคืน (มม.) */
  rainfallTodayMm: number | null;
  /** เฉพาะจุดกลางแจ้ง: ฝนสะสมเดือนนี้ (มม.) */
  rainfallMonthMm: number | null;
  /** เฉพาะจุดกลางแจ้ง: rain sensor ตรวจพบฝนอยู่หรือไม่ */
  rainDetected: boolean | null;
}

/** แนวโน้มความกดอากาศเทียบกับ 3 ชั่วโมงก่อน — ใช้บอกว่าฝนกำลังจะมาหรือกำลังผ่านไป */
export type PressureTrend = 'rising' | 'falling' | 'steady';

export interface EnvironmentSensor extends BaseEntity {
  location: EnvironmentLocation;
  locationLabel: string;
  locationLabelEn: string;
  latest: EnvironmentReading;
  /** ★ สำเนา denormalized จาก SystemSettings.thresholds */
  temperatureThresholds: ThresholdRange;
  humidityThresholds: ThresholdRange;
  /** true เมื่อจุดนี้มี rain gauge (มีเฉพาะกลางแจ้ง) */
  hasRainGauge: boolean;
  /** true เมื่อจุดนี้มี barometer และ light sensor (มีเฉพาะกลางแจ้ง) */
  hasWeatherSensors: boolean;
  /**
   * แนวโน้มความกดอากาศเทียบ 3 ชั่วโมงก่อน — null เมื่อจุดนี้ไม่มี barometer
   * หรือประวัติยังไม่ยาวพอ 3 ชั่วโมง
   */
  pressureTrend3h: PressureTrend | null;
  /** ผลต่างความกดอากาศจาก 3 ชั่วโมงก่อน (hPa) — null เมื่อคำนวณไม่ได้ */
  pressureChange3hHpa: number | null;
  deviceId: string;
}

// ═════════════════════════════════════════════════════════════
// อุปกรณ์เครือข่าย
// ═════════════════════════════════════════════════════════════

/**
 * ชนิดอุปกรณ์ที่มีจริงในระบบ
 * esp32    node ที่จุดวัด (ถัง ปั๊ม มิเตอร์ เซนเซอร์ ตู้ไฟ)
 * plc      Siemens S7-1200 (ระบบน้ำหลัก) และ Mitsubishi FX3G (ส่วนขยาย)
 * hmi      Samkoon หน้าจอสัมผัสที่ตู้คอนโทรล
 * gateway  SIMATIC IOT2000 ที่รวมข้อมูลขึ้นระบบ
 */
export type DeviceKind = 'esp32' | 'plc' | 'hmi' | 'gateway';

/**
 * หน้าที่ของอุปกรณ์ในระบบ — ละเอียดกว่า DeviceKind
 * ใช้กรองในหน้า Devices ("ขอดูเฉพาะ node ที่คุมวาล์ว") ซึ่ง kind อย่างเดียวตอบไม่ได้
 * เพราะ ESP32 ทุกตัวเป็น kind เดียวกันหมดแต่ทำคนละงาน
 */
export type DeviceRole =
  | 'tank_node'
  | 'pump_node'
  | 'valve_node'
  | 'meter_node'
  | 'env_node'
  | 'power_node'
  | 'plc'
  | 'hmi'
  | 'gateway';

/**
 * โปรโตคอลที่ใช้สื่อสาร
 * s7comm       Siemens S7-1200 (พอร์ต 102)
 * mc_protocol  Mitsubishi FX3G — MC Protocol ไม่ใช่ s7comm คนละตระกูลกัน
 * modbus_tcp   HMI และอุปกรณ์ที่คุยผ่าน Ethernet
 * modbus_rtu   บัสอนุกรมฝั่งสนาม เช่น PZEM ที่ต่อกับ ESP32
 * mqtt         ทางขึ้นจาก node ไป gateway
 */
export type DeviceProtocol = 'mqtt' | 'modbus_tcp' | 'modbus_rtu' | 's7comm' | 'mc_protocol' | 'opcua' | 'http';

export type DeviceLinkType = 'wifi' | 'ethernet' | 'serial';

export interface Device extends BaseEntity {
  kind: DeviceKind;
  role: DeviceRole;
  /**
   * รุ่นจริงที่ติดตั้งในโรงงาน เช่น
   *   "ESP32-WROOM-32E"
   *   "SIMATIC S7-1200 CPU 1211C DC/DC/RLY"  (ต่อโมดูล SM1231 สำหรับ AI 4–20 mA)
   *   "MITSUBISHI FX3G-24MR"
   *   "SAMKOON SK-070HS"
   *   "SIMATIC IOT2000"
   */
  model: string;
  /** โมดูลเสริมที่เสียบอยู่ เช่น ["SM1231 AI 4xAI"] — อาเรย์ว่างเมื่อไม่มี */
  expansionModules: string[];
  /** โปรโตคอลทางขึ้น (คุยกับ gateway/ระบบ) */
  protocol: DeviceProtocol;
  /**
   * โปรโตคอลบัสฝั่งสนามที่อุปกรณ์นี้ไปอ่านค่ามา — null เมื่อไม่มีบัสฝั่งล่าง
   * เช่น ESP32 ที่ปั๊มอ่าน PZEM ผ่าน modbus_rtu แล้วส่งขึ้นด้วย mqtt
   */
  fieldbus: DeviceProtocol | null;
  linkType: DeviceLinkType;

  // ── เครือข่าย ──
  ip: string;
  /** VLAN ID ของ segment ที่อุปกรณ์อยู่ */
  vlan: number;
  mac: string;
  /** พอร์ตบริการหลัก เช่น 1883 (MQTT), 502 (Modbus TCP), 102 (S7), 5551 (MC Protocol) */
  port: number;
  /** ความแรงสัญญาณ Wi-Fi (dBm) — null สำหรับอุปกรณ์ที่ต่อสาย */
  rssi: number | null;

  // ── สุขภาพอุปกรณ์ ──
  firmware: string;
  /** เวลาทำงานต่อเนื่องนับจากบูตล่าสุด (วินาที) */
  uptimeSeconds: number;
  /** หน่วยความจำว่าง (bytes) — null สำหรับ PLC/HMI ที่ไม่รายงานค่านี้ */
  freeHeapBytes: number | null;
  /** จำนวนครั้งที่ต้องเชื่อมต่อใหม่นับจากบูต — ค่าสูงคือสัญญาณอ่อน/ไฟตก */
  reconnectCount: number;
  /** ข้อความผิดพลาดล่าสุด — null เมื่อไม่เคยพลาดนับจากบูต */
  lastError: string | null;
  lastErrorAt: ISODateTime | null;

  /** entity ที่อุปกรณ์นี้รับผิดชอบ (tank/pump/zone/meter/sensor id) */
  linkedEntityIds: string[];
  location: string;
  locationEn: string;
}

// ─────────────────────────────────────────────────────────────
// สุขภาพของบริการเบื้องหลัง
// ─────────────────────────────────────────────────────────────

/** บริการที่ต้องเดินอยู่เพื่อให้แดชบอร์ดมีข้อมูล */
export type ServiceKind = 'mqtt_broker' | 'database' | 'ingest' | 'ai';

export interface ServiceHealth {
  kind: ServiceKind;
  name: string;
  nameEn: string;
  status: EntityStatus;
  /** ปลายทางที่ตรวจ เช่น "10.20.10.2:1883" */
  endpoint: string;
  latencyMs: number | null;
  lastCheckedAt: ISODateTime;
  /** ข้อความอธิบายเมื่อไม่ปกติ — null เมื่อทุกอย่างเรียบร้อย */
  message: string | null;
  /** ตัวเลขประกอบเฉพาะบริการนั้น เช่น จำนวน message/วินาที หรือขนาดคิว */
  detail: Record<string, string | number> | null;
}

// ─────────────────────────────────────────────────────────────
// การอัปเดตเฟิร์มแวร์ (OTA)
// ─────────────────────────────────────────────────────────────

export type FirmwareUpdateState = 'queued' | 'downloading' | 'installing' | 'success' | 'failed';

export interface FirmwareUpdateJob extends BaseRecord {
  deviceId: string;
  deviceName: string;
  fromVersion: string;
  toVersion: string;
  state: FirmwareUpdateState;
  /** 0–100 */
  progressPercent: number;
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  errorMessage: string | null;
}

/** ผลของคำสั่งจัดการอุปกรณ์ที่ไม่ใช่การอัปเดตเฟิร์มแวร์ */
export interface DeviceActionResult {
  deviceId: string;
  action: 'reboot' | 'ping';
  ok: boolean;
  latencyMs: number | null;
  message: string;
  at: ISODateTime;
}

// ═════════════════════════════════════════════════════════════
// การแจ้งเตือน
// ═════════════════════════════════════════════════════════════

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type AlertState = 'active' | 'acknowledged' | 'resolved';

/** ประเภทต้นทางของ alert ใช้ทำลิงก์กลับไปหน้าที่เกี่ยวข้อง */
export type AlertSourceType =
  | 'tank'
  | 'pump'
  | 'zone'
  | 'valve'
  | 'meter'
  | 'sensor'
  | 'device'
  | 'electric_node'
  | 'pressure_control'
  | 'system';

/**
 * รหัสเหตุการณ์ทั้งหมดที่ระบบสร้างได้
 * ทำเป็น union เพื่อกันหน้าบ้าน/หลังบ้านสะกดคนละแบบ และให้แปลข้อความได้ครบทุกรหัส
 * เพิ่มรหัสใหม่ต้องแก้ที่นี่ที่เดียว
 */
export type AlertCode =
  // ถัง
  | 'TANK_LEVEL_LOW'
  | 'TANK_LEVEL_HIGH'
  | 'TANK_LEVEL_STALE'
  // ปั๊มและแรงดัน
  | 'PUMP_FAULT'
  | 'PUMP_OVERCURRENT'
  | 'PUMP_DRY_RUN'
  | 'PUMP_ALTERNATION'
  | 'PUMP_SERVICE_DUE'
  | 'PRESSURE_OUT_OF_RANGE'
  | 'VFD_FAULT'
  // น้ำและโซน
  | 'ZONE_LEAK_SUSPECTED'
  | 'ZONE_QUOTA_EXCEEDED'
  | 'ZONE_FLOW_HIGH'
  | 'UNACCOUNTED_WATER_HIGH'
  | 'MAIN_SUPPLY_PRESSURE_LOW'
  // ไฟฟ้า
  | 'ELECTRIC_OVERCURRENT'
  | 'ELECTRIC_PHASE_LOSS'
  // สภาพแวดล้อม
  | 'ENV_TEMP_HIGH'
  | 'ENV_HUMIDITY_HIGH'
  | 'ENV_HEAVY_RAIN'
  // อุปกรณ์
  | 'DEVICE_OFFLINE'
  | 'DEVICE_WEAK_SIGNAL'
  | 'DEVICE_LOW_MEMORY'
  | 'DEVICE_FIRMWARE_MISMATCH'
  // ระบบ
  | 'ANOMALY_DETECTED'
  | 'COMMAND_TIMEOUT'
  | 'BACKUP_FAILED';

export interface Alert extends BaseRecord {
  severity: AlertSeverity;
  state: AlertState;
  code: AlertCode;
  sourceType: AlertSourceType;
  sourceId: string;
  sourceName: string;
  /** แผนกที่ควรได้รับเรื่องนี้ — null เมื่อเป็นเหตุการณ์ระดับระบบ */
  departmentId: string | null;
  messageTh: string;
  messageEn: string;
  /** ค่าที่ทำให้เกิด alert และเกณฑ์ที่ใช้ตัดสิน — null เมื่อไม่ใช่ alert เชิงค่าวัด */
  triggerValue: number | null;
  thresholdValue: number | null;
  unit: string | null;
  raisedAt: ISODateTime;
  resolvedAt: ISODateTime | null;
  /** ใช้นับ badge "alert ที่ยังไม่อ่าน" บน Header */
  read: boolean;
  acknowledgementId: string | null;
  /** anomaly ที่เป็นต้นเหตุ — null เมื่อ alert นี้มาจากกฎเกณฑ์ธรรมดา */
  anomalyEventId: string | null;
  /** จำนวนครั้งที่เหตุการณ์เดิมเกิดซ้ำก่อนถูกเคลียร์ */
  occurrenceCount: number;
}

export interface AlertAcknowledgement extends BaseRecord {
  alertId: string;
  acknowledgedBy: ActorRef;
  acknowledgedAt: ISODateTime;
  note: string | null;
  /** ระงับการแจ้งซ้ำกี่นาที (snooze) — null = ไม่ระงับ */
  snoozeMinutes: number | null;
}

/**
 * ช่องทางแจ้งเตือน
 * ★ 'line' = LINE Messaging API (LINE Notify ปิดบริการแล้ว)
 *   recipient จึงเป็น LINE group id หรือ user id ไม่ใช่ access token แบบเดิม
 */
export type NotificationChannel = 'line' | 'email' | 'sms' | 'buzzer' | 'webhook';

export type NotificationDeliveryState = 'queued' | 'sending' | 'delivered' | 'failed';

export interface NotificationDelivery extends BaseRecord {
  alertId: string;
  channel: NotificationChannel;
  deliveryState: NotificationDeliveryState;
  /**
   * ปลายทางตามชนิดช่องทาง:
   *   line    → LINE group id / user id (ขึ้นต้นด้วย C หรือ U)
   *   email   → อีเมล
   *   sms     → เบอร์โทร
   *   buzzer  → ชื่อตู้ที่บัซเซอร์ติดตั้งอยู่
   *   webhook → URL ภายใน LAN เท่านั้น
   */
  recipient: string;
  attempts: number;
  lastAttemptAt: ISODateTime | null;
  deliveredAt: ISODateTime | null;
  errorMessage: string | null;
}

// ─────────────────────────────────────────────────────────────
// ตัวอย่างข้อความแจ้งเตือน และเหตุการณ์ที่คลี่คลายแล้ว
// ─────────────────────────────────────────────────────────────

/**
 * ข้อความที่ระบบจะส่งออกจริงสำหรับ alert หนึ่ง
 * ให้ผู้ใช้เห็นก่อนว่าคนปลายทางจะได้รับอะไร ก่อนจะไปตั้งค่าช่องทางแจ้งเตือน
 */
export interface NotificationPreview {
  alertId: string;
  channel: NotificationChannel;
  recipient: string;
  /** บรรทัดแรกที่ใช้เป็นหัวข้อ */
  title: string;
  /** เนื้อความเต็มตามที่จะส่งจริง รวมการขึ้นบรรทัดใหม่ */
  body: string;
  /** สถานะการส่งจริงของ alert นี้ — null เมื่อยังไม่เคยส่ง */
  deliveryState: NotificationDeliveryState | null;
}

/**
 * เหตุการณ์ที่คลี่คลายแล้ว จับคู่กับ alert ต้นทาง
 * แสดง "เกิดนานเท่าไรกว่าจะหาย" ซึ่งเป็นตัวเลขที่ใช้ประเมินการตอบสนองของทีม
 */
export interface RecoveryEvent {
  alertId: string;
  code: AlertCode;
  sourceType: AlertSourceType;
  sourceId: string;
  sourceName: string;
  severity: AlertSeverity;
  messageTh: string;
  messageEn: string;
  raisedAt: ISODateTime;
  resolvedAt: ISODateTime;
  /** ระยะเวลาที่เหตุการณ์ดำเนินอยู่ (นาที) */
  durationMinutes: number;
  /** ใครเป็นคนรับทราบ — null เมื่อหายเองโดยไม่มีใคร ack */
  acknowledgedBy: ActorRef | null;
  /** นาทีจากเกิดเหตุจนมีคนรับทราบ — null เมื่อไม่มีใคร ack */
  minutesToAcknowledge: number | null;
}

// ─────────────────────────────────────────────────────────────
// รายงานการใช้น้ำ
// ─────────────────────────────────────────────────────────────

/** หนึ่งโซนในรายงาน พร้อมตัวเลขเทียบช่วงก่อนหน้า */
export interface UsageReportRow {
  zoneId: string;
  name: string;
  nameEn: string;
  departmentId: string | null;
  cubicMeters: number;
  costBaht: number;
  /** ปริมาณของช่วงก่อนหน้าที่ยาวเท่ากัน */
  previousCubicMeters: number;
  previousCostBaht: number;
  /** เปลี่ยนแปลงจากช่วงก่อนหน้า (%) — บวก = ใช้มากขึ้น */
  changePercent: number;
  /** สัดส่วนของทั้งโรงงานในช่วงนี้ (%) */
  sharePercent: number;
}

export interface UsageReport {
  range: TimeRange;
  /** ช่วงก่อนหน้าที่ยาวเท่ากัน ใช้เป็นฐานเปรียบเทียบ */
  previousRange: TimeRange;
  rows: UsageReportRow[];
  totalCubicMeters: number;
  totalCostBaht: number;
  previousTotalCubicMeters: number;
  previousTotalCostBaht: number;
  changePercent: number;
  unaccounted: UnaccountedWater;
  /** ยอดรายวันในช่วงที่เลือก ใช้วาดกราฟเส้น */
  daily: DailyUsagePoint[];
  generatedAt: ISODateTime;
}

// ═════════════════════════════════════════════════════════════
// ผลลัพธ์จากทีม AI
//
// ★ ทีม AI เป็นเจ้าของตรรกะทั้งหมดว่าจะตรวจอะไรและพยากรณ์อะไร
//   หน้าบ้าน "แสดงผล" อย่างเดียว ห้ามคิดเกณฑ์ตรวจจับเอง
//   ทุก field ที่ไม่ใช่ id/type จึงเป็น optional — UI ต้อง render ได้แม้ข้อมูลมาไม่ครบ
//   รายละเอียดสัญญาอยู่ใน docs/AI_CONTRACT.md
// ═════════════════════════════════════════════════════════════

/**
 * ชนิดความผิดปกติ — เป็น string เปิดโดยตั้งใจ ห้ามทำเป็น enum ปิด
 *
 * ทีม AI เพิ่มชนิดใหม่ได้ตลอดโดยไม่ต้องรอหน้าบ้าน deploy ตาม
 * การแปลชื่อไทย/ไอคอน/สี อยู่ใน lib/config/anomaly-types.ts
 * และต้องมี fallback สำหรับชนิดที่ยังไม่รู้จักเสมอ
 */
export type AnomalyType = string;

/**
 * ตัวตรวจจับที่ให้ผลนี้ — string เปิดเช่นกัน
 * ค่าที่ใช้อยู่ตอนนี้: 'rule' | 'isolation_forest' | 'forecast_deviation'
 */
export type AnomalyDetector = string;

/** ฟีเจอร์ที่โมเดลใช้ตัดสิน — แสดงให้ผู้ใช้เห็นว่าทำไมถึงถูกจับว่าผิดปกติ */
export interface AnomalyFeature {
  /** ชื่อฟีเจอร์ เช่น 'flow_lpm', 'hour_of_day', 'pump_power_ratio' */
  key: string;
  value: number;
  /** ค่าปกติที่โมเดลคาดไว้ */
  expected?: number | null;
  /** น้ำหนักที่ฟีเจอร์นี้มีต่อคะแนน (0–1) */
  contribution?: number;
}

/**
 * ความผิดปกติหนึ่งรายการที่ทีม AI ส่งมา
 * มีเพียง id / type / detectedAt ที่รับประกันว่ามาแน่ นอกนั้นอาจขาดได้
 */
export interface AnomalyEvent {
  id: string;
  type: AnomalyType;
  detectedAt: ISODateTime;

  detector?: AnomalyDetector;
  /** 0–1 ยิ่งสูงยิ่งผิดปกติ */
  score?: number;
  severity?: AlertSeverity;
  sourceType?: AlertSourceType;
  sourceId?: string;
  sourceName?: string;
  metric?: MetricKey | string;
  /** ช่วงเวลาที่พฤติกรรมผิดปกติกินเวลา */
  windowStart?: ISODateTime | null;
  windowEnd?: ISODateTime | null;
  features?: AnomalyFeature[];
  /** alert ที่ถูกสร้างจาก anomaly นี้ */
  alertId?: string | null;
  modelName?: string | null;
  /** ข้อความจากทีม AI — ถ้าไม่มี ให้หน้าบ้านใช้ชื่อจาก anomaly-types.ts แทน */
  summaryTh?: string;
  summaryEn?: string;
  /** ข้อมูลดิบเพิ่มเติมที่ทีม AI แนบมา หน้าบ้านแสดงเป็น key–value ได้โดยไม่ต้องรู้จักล่วงหน้า */
  extra?: Record<string, string | number | boolean | null>;
}

/** ชนิดสิ่งที่พยากรณ์ — string เปิดเช่นกัน */
export type ForecastTarget = string;

/** จุดพยากรณ์ = TimeSeriesPoint + ช่วงความเชื่อมั่น (ช่วงอาจไม่มีมาก็ได้) */
export interface ForecastPoint extends TimeSeriesPoint {
  lowerBound?: number;
  upperBound?: number;
}

/**
 * ผลพยากรณ์จากทีม AI
 * ★ ไม่มี anomalyScore — การตรวจจับความผิดปกติอยู่ที่ AnomalyEvent คนละไปป์ไลน์กัน
 */
export interface AIForecast {
  id: string;
  target: ForecastTarget;
  generatedAt: ISODateTime;

  targetId?: string | null;
  targetName?: string;
  metric?: MetricKey | string;
  unit?: string;
  horizonHours?: number;
  /** ข้อมูลจริงย้อนหลังที่ใช้เป็นบริบทของกราฟ */
  history?: TimeSeriesPoint[];
  forecast?: ForecastPoint[];
  modelName?: string | null;
  /** Mean Absolute Percentage Error จากการ backtest ล่าสุด */
  mapePercent?: number;
  summaryTh?: string;
  summaryEn?: string;
}

/** คำแนะนำการบำรุงรักษาเชิงพยากรณ์ที่ทีม AI ส่งมา */
export interface MaintenancePrediction {
  id: string;
  /** อุปกรณ์ที่ถูกประเมิน */
  targetType: AlertSourceType;
  targetId: string;
  generatedAt: ISODateTime;

  targetName?: string;
  /** 0–1 โอกาสที่จะเสียภายในหน้าต่างที่ประเมิน */
  failureProbability?: number;
  /** ประมาณจำนวนวันก่อนถึงกำหนดที่ควรเข้าซ่อม */
  daysUntilService?: number | null;
  /** ตัวชี้วัดที่ทำให้โมเดลคิดแบบนี้ */
  features?: AnomalyFeature[];
  modelName?: string | null;
  recommendationTh?: string;
  recommendationEn?: string;
}

/** สถานะของบริการ AI ที่รันบน gateway — ใช้บอกผู้ใช้เมื่อผลยังไม่มา */
export interface AIServiceStatus {
  reachable: boolean;
  lastResultAt: ISODateTime | null;
  /** ชื่อโมเดลที่ทีม AI แจ้งว่ากำลังใช้อยู่ */
  models: string[];
  message: string | null;
}

// ─────────────────────────────────────────────────────────────
// Phase 4.5 — ผลลัพธ์ชุดเพิ่มเติมจากทีม AI
//
// ยึดข้อตกลงเดียวกับส่วนบน: ชนิดเป็น string เปิด และมีเพียง field ที่ระบุตัวตน
// กับเวลาที่บังคับ นอกนั้น optional ทั้งหมด เพื่อให้ UI render ได้แม้ผลมาไม่ครบ
// ─────────────────────────────────────────────────────────────

/**
 * ชนิดการพยากรณ์ — string เปิด ห้ามทำเป็น enum ปิด
 * ค่าที่คาดว่าจะใช้: 'tank_depletion' | 'demand_forecast' | 'failure_risk' | 'cost_projection'
 */
export type PredictionKind = string;

/**
 * ผลพยากรณ์หนึ่งรายการจากทีม AI
 *
 * รองรับทั้งแบบจุดเดียว (เช่น "ถังจะแตะระดับต่ำสุดในอีก 6 ชั่วโมง" → ใช้ value/expectedAt)
 * และแบบเป็นเส้น (ใช้ points) ทีม AI ส่งมาแบบไหนก็ได้ หรือส่งทั้งคู่ก็ได้
 */
export interface Prediction {
  id: string;
  kind: PredictionKind;
  generatedAt: ISODateTime;

  /** ชนิดสิ่งที่พยากรณ์ — string เปิด เช่น 'tank' | 'pump' | 'zone' | 'department' | 'system' */
  targetType?: string;
  targetId?: string | null;
  targetName?: string;
  metric?: MetricKey | string;
  unit?: string;
  horizonHours?: number;

  /** ค่าที่พยากรณ์ได้ สำหรับผลแบบจุดเดียว */
  value?: number | null;
  /** เวลาที่คาดว่าเหตุการณ์จะเกิด สำหรับผลเชิงเวลา */
  expectedAt?: ISODateTime | null;
  /** 0–1 ความมั่นใจของโมเดล */
  confidence?: number;

  /** ผลแบบเป็นเส้น พร้อมช่วงความเชื่อมั่นที่อาจไม่มีมาก็ได้ */
  points?: ForecastPoint[];
  /** ข้อมูลจริงย้อนหลังที่ใช้เป็นบริบทของกราฟ */
  history?: TimeSeriesPoint[];

  modelName?: string | null;
  summaryTh?: string;
  summaryEn?: string;
  /** ข้อมูลเพิ่มเติมที่ทีม AI แนบมา แสดงเป็น key–value ได้โดยไม่ต้องรู้จักล่วงหน้า */
  extra?: Record<string, string | number | boolean | null>;
}

/** องค์ประกอบย่อยที่ประกอบกันเป็นคะแนนสุขภาพ ใช้อธิบายว่าคะแนนมาจากไหน */
export interface HealthScoreComponent {
  /** ชื่อองค์ประกอบ เช่น 'vibration', 'specific_power', 'runtime_since_service' */
  key: string;
  /** 0–100 เฉพาะองค์ประกอบนี้ */
  score?: number;
  /** น้ำหนักที่มีต่อคะแนนรวม (0–1) */
  weight?: number;
  value?: number;
  labelTh?: string;
  labelEn?: string;
}

/**
 * คะแนนสุขภาพของอุปกรณ์หนึ่งตัว
 * score เป็น 0–100 โดยยิ่งสูงยิ่งดี (ตรงข้ามกับ AnomalyEvent.score ที่ยิ่งสูงยิ่งแย่)
 */
export interface HealthScore {
  id: string;
  targetId: string;
  computedAt: ISODateTime;

  /** string เปิด เช่น 'pump' | 'valve' | 'device' | 'tank' */
  targetType?: string;
  targetName?: string;
  /** 0–100 ยิ่งสูงยิ่งดี */
  score?: number;
  /** ระดับที่ทีม AI จัดให้ — string เปิด เช่น 'good' | 'fair' | 'poor' | 'critical' */
  grade?: string;
  /** ทิศทางการเปลี่ยนแปลง — string เปิด เช่น 'improving' | 'stable' | 'declining' */
  trend?: string;
  /** คะแนนเทียบกับครั้งก่อน (บวก = ดีขึ้น) */
  changeFromPrevious?: number;
  components?: HealthScoreComponent[];
  /** ประมาณจำนวนวันก่อนคะแนนตกถึงเกณฑ์ที่ควรเข้าซ่อม */
  daysUntilAttention?: number | null;
  modelName?: string | null;
  summaryTh?: string;
  summaryEn?: string;
  extra?: Record<string, string | number | boolean | null>;
}

/** สถานะของโมดูล AI หนึ่งตัวบน gateway */
export interface AIModuleStatus {
  enabled?: boolean;
  healthy?: boolean;
  modelName?: string | null;
  lastResultAt?: ISODateTime | null;
  /** เวลาที่ใช้ประมวลผลรอบล่าสุด (ms) */
  lastRunMs?: number | null;
  message?: string | null;
}

/**
 * สถานะรวมของบริการ AI ที่รันบน gateway
 * ใช้บอกผู้ใช้ว่า "ผลยังไม่มา" ต่างจาก "ไม่มีอะไรผิดปกติ" ซึ่งคนละความหมายกัน
 */
export interface AIStatus {
  online: boolean;
  checkedAt: ISODateTime;

  /**
   * สถานะรายโมดูล — key เป็น string เปิด เช่น 'anomaly' | 'prediction' | 'health'
   * ทีม AI เพิ่มโมดูลใหม่ได้โดยไม่ต้องแก้หน้าบ้าน
   */
  modules?: Record<string, AIModuleStatus>;
  models?: string[];
  lastResultAt?: ISODateTime | null;
  /** จำนวนงานที่รอประมวลผลอยู่ */
  queueDepth?: number;
  /** เวอร์ชันของบริการ AI ที่ติดตั้งอยู่ */
  serviceVersion?: string | null;
  messageTh?: string;
  messageEn?: string;
  extra?: Record<string, string | number | boolean | null>;
}

// ═════════════════════════════════════════════════════════════
// การสั่งงาน (Control)
// ═════════════════════════════════════════════════════════════

export type CommandTargetType = 'pump' | 'valve' | 'pressure_control' | 'system';

export type CommandAction =
  | 'start'
  | 'stop'
  | 'open'
  | 'close'
  | 'set_mode'
  | 'set_open_percent'
  /** ตั้งแรงดันเป้าหมายของลูป PID (bar) */
  | 'set_setpoint'
  | 'reset_fault'
  /** เปิด/ปิดวาล์วทุกโซนพร้อมกัน — ใช้กับปุ่มฉุกเฉินเท่านั้น */
  | 'open_all'
  | 'close_all'
  | 'emergency_stop';

/**
 * state ของคำสั่งหนึ่งครั้ง
 * awaiting_feedback = ส่งถึง PLC แล้ว กำลังรอ feedback ยืนยันว่าอุปกรณ์ขยับจริง
 */
export type CommandState = 'idle' | 'sending' | 'awaiting_feedback' | 'success' | 'timeout' | 'failed';

export interface ControlCommand extends BaseRecord {
  targetType: CommandTargetType;
  targetId: string;
  targetName: string;
  action: CommandAction;
  /** ค่าประกอบคำสั่ง เช่น set_mode → 'pid' | set_setpoint → 3.2 | set_open_percent → 0–100 */
  value: string | number | null;
  issuedBy: ActorRef;
  issuedAt: ISODateTime;
  /** คำสั่งที่กระทบโซน VIP หรือ emergency_stop ต้องยืนยันสองชั้น */
  requiresConfirmation: boolean;
  /** เวลารอ feedback ก่อนตัดเป็น timeout */
  timeoutMs: number;
  /** เหตุผลที่สั่ง — บันทึกลง audit log */
  reason: string | null;
}

export interface CommandResult {
  commandId: string;
  state: CommandState;
  sentAt: ISODateTime | null;
  /** เวลาที่ได้รับ feedback จาก PLC */
  feedbackAt: ISODateTime | null;
  /** สวิงไป-กลับตั้งแต่กดจนอุปกรณ์ยืนยัน */
  latencyMs: number | null;
  /** สถานะจริงของอุปกรณ์หลังคำสั่ง ใช้เทียบกับที่สั่ง */
  feedbackValue: string | number | null;
  errorCode: string | null;
  errorMessage: string | null;
  /** ครั้งที่ลองส่ง (นับจาก 1) */
  attempt: number;
}

/** รายการเดียวใน audit log ของหน้า Control */
export interface CommandLogEntry {
  command: ControlCommand;
  result: CommandResult;
}

// ─────────────────────────────────────────────────────────────
// Interlock — เงื่อนไขที่ทำให้สั่งงานไม่ได้
// ─────────────────────────────────────────────────────────────

/**
 * เหตุผลที่คำสั่งถูกล็อก
 * ★ หน้าบ้านต้องแสดงเหตุผลเสมอ ห้าม disable ปุ่มเฉย ๆ โดยไม่บอกว่าทำไม
 *   คนที่กดไม่ได้ตอนตีสองต้องรู้ทันทีว่าต้องแก้อะไรก่อน
 */
export interface InterlockReason {
  /** รหัสคงที่ เช่น "SOURCE_TANK_LOW", "CONTROL_LOCKED", "PUMP_IN_FAULT" */
  code: string;
  messageTh: string;
  messageEn: string;
}

export interface ControlInterlock {
  targetType: CommandTargetType;
  targetId: string;
  /** true = ถูกล็อกอย่างน้อยหนึ่งคำสั่ง */
  blocked: boolean;
  /** คำสั่งที่ถูกล็อก — อาเรย์ว่างพร้อม blocked = true หมายถึงล็อกทุกคำสั่ง */
  blockedActions: CommandAction[];
  reasons: InterlockReason[];
}

// ─────────────────────────────────────────────────────────────
// ตั้งเวลาสั่งงานล่วงหน้า
// ─────────────────────────────────────────────────────────────

export type ScheduleRepeat = 'once' | 'daily' | 'weekdays' | 'weekly';

export interface CommandSchedule extends BaseRecord {
  targetType: CommandTargetType;
  targetId: string;
  targetName: string;
  action: CommandAction;
  value: string | number | null;
  /** เวลาที่จะสั่ง รูปแบบ "HH:mm" ตามเวลาโรงงาน */
  time: string;
  repeat: ScheduleRepeat;
  /** 0=อาทิตย์ ถึง 6=เสาร์ ใช้เมื่อ repeat = 'weekly' */
  daysOfWeek: number[];
  enabled: boolean;
  nextRunAt: ISODateTime | null;
  lastRunAt: ISODateTime | null;
  /** ผลของการทำงานครั้งล่าสุด — null เมื่อยังไม่เคยทำงาน */
  lastResultState: CommandState | null;
  createdBy: ActorRef;
}

// ═════════════════════════════════════════════════════════════
// การตั้งค่าระบบ (แยก sub-type ตามหมวดในหน้า Settings)
// ═════════════════════════════════════════════════════════════

export interface GeneralSettings {
  siteName: string;
  siteNameEn: string;
  timezone: string;
  /** ค่าตั้งต้นของหน้าจอ — เก็บฝั่งเซิร์ฟเวอร์แต่มีผลเฉพาะกับหน้าบ้าน */
  defaultLocale: Locale;
  defaultTheme: ThemeMode;
  /** ความถี่ที่ UI ดึงข้อมูลใหม่ (ms) */
  refreshIntervalMs: number;
  /** โหมดจอแขวนผนัง: ซ่อน sidebar และขยายตัวเลข */
  wallDisplayMode: boolean;
}

/** ★ ต้นทางความจริงของทุกเกณฑ์เตือน — ค่าที่ฝังใน entity เป็นเพียงสำเนา */
export interface ThresholdSettings {
  /** key = tank id */
  tankLevelPercent: Record<string, ThresholdRange>;
  /** key = zone id */
  zoneFlowLpm: Record<string, ThresholdRange>;
  /** key = electric node id */
  electricCurrentAmp: Record<string, ThresholdRange>;
  pumpPressureBar: ThresholdRange;
  pumpCurrentAmp: ThresholdRange;
  temperatureCelsius: ThresholdRange;
  humidityPercent: ThresholdRange;
  /** เกินกี่ % ของมิเตอร์หลักถือว่าน่าสงสัยว่ารั่ว (หลังหัก Δstorage แล้ว) */
  unaccountedWarningPercent: number;
  unaccountedCriticalPercent: number;
}

export interface NetworkSettings {
  mqttHost: string;
  mqttPort: number;
  mqttBaseTopic: string;
  /** Siemens S7-1200 — ระบบน้ำหลัก */
  plcHost: string;
  plcPort: number;
  /** Mitsubishi FX3G — ส่วนขยาย (MC Protocol) — null เมื่อยังไม่ติดตั้ง */
  secondaryPlcHost: string | null;
  secondaryPlcPort: number | null;
  gatewayHost: string;
  /** NTP ในเครือข่ายโรงงาน — ห้ามชี้ออกอินเทอร์เน็ต */
  ntpServer: string;
  pollIntervalMs: number;
  /** ไม่ได้ยินจากอุปกรณ์เกินกี่วินาทีถือว่า offline */
  deviceTimeoutSeconds: number;
}

export interface QuietHours {
  enabled: boolean;
  /** "HH:mm" */
  startTime: string;
  endTime: string;
  /** ถึงจะเงียบอยู่ก็ยังส่ง severity นี้ขึ้นไป */
  overrideSeverity: AlertSeverity;
}

export interface NotificationSettings {
  enabledChannels: NotificationChannel[];
  /** key = channel, value = รายชื่อผู้รับ (ดูรูปแบบที่ NotificationDelivery.recipient) */
  recipients: Record<NotificationChannel, string[]>;
  /** ส่งเมื่อ severity ถึงระดับนี้ขึ้นไป */
  minimumSeverity: AlertSeverity;
  quietHours: QuietHours;
  /** ไม่มีคน ack ภายในกี่นาที ให้ยกระดับส่งซ้ำ */
  escalationAfterMinutes: number;
  /** กัน alert เดิมสแปมซ้ำ */
  deduplicationWindowMinutes: number;
  /** ส่ง alert ของโซน/ตู้ไฟไปหาหัวหน้าแผนกที่รับผิดชอบด้วย */
  notifyDepartmentManager: boolean;
}

/** ขั้นอัตราแบบขั้นบันได ใช้ได้ทั้งค่าน้ำและค่าไฟ */
export interface WaterTariffTier {
  id: string;
  name: string;
  nameEn: string;
  /** ขอบล่างของขั้น (m³ สำหรับน้ำ / kWh สำหรับไฟ) */
  minCubicMeters: number;
  /** ขอบบนของขั้น — null = ขั้นบนสุดไม่จำกัด */
  maxCubicMeters: number | null;
  ratePerCubicMeter: number;
}

export interface BillingSettings {
  currency: string;
  /** ขั้นอัตราค่าน้ำของการประปา */
  tiers: WaterTariffTier[];
  /** ค่าบริการรายเดือนคงที่ */
  serviceChargeBaht: number;
  vatPercent: number;
  /** วันที่ของเดือนที่รอบบิลเริ่ม */
  billingCycleStartDay: number;
  /** อัตราค่าไฟเฉลี่ยต่อหน่วย ใช้แบ่งค่าไฟตามแผนก */
  electricityRatePerKwh: number;
  /** ค่า Ft ต่อหน่วย (บวก/ลบได้) */
  electricityFtPerKwh: number;
}

export interface AISettings {
  forecastEnabled: boolean;
  /** พยากรณ์ล่วงหน้ากี่ชั่วโมง */
  forecastHorizonHours: number;
  /** โมเดลพยากรณ์ที่รันบน gateway เช่น "prophet-water-v2" */
  forecastModelName: string;
  anomalyDetectionEnabled: boolean;
  /** โมเดลตรวจจับความผิดปกติ เช่น "isolation-forest-v1" — คนละตัวกับโมเดลพยากรณ์ */
  anomalyModelName: string;
  /** 0–1 ยิ่งสูงยิ่งไวต่อความผิดปกติ */
  anomalySensitivity: number;
  /** เปิดกฎเกณฑ์ตายตัวควบคู่กับโมเดล (detector = 'rule') */
  ruleBasedDetectionEnabled: boolean;
  leakDetectionEnabled: boolean;
  /** ฝึกโมเดลใหม่ทุกกี่ชั่วโมง */
  retrainIntervalHours: number;
}

export interface MaintenanceSettings {
  /** สลับปั๊มหลักอัตโนมัติเพื่อให้ชั่วโมงเดินใกล้เคียงกัน */
  pumpAlternationEnabled: boolean;
  pumpAlternationHours: number;
  serviceIntervalHours: number;
  /** เก็บข้อมูลย้อนหลังกี่วันก่อนลบ */
  dataRetentionDays: number;
  backupEnabled: boolean;
  /** "HH:mm" เวลาสำรองข้อมูลรายวัน */
  backupTime: string;
  /** ปลายทางสำรองข้อมูลใน LAN เท่านั้น */
  backupPath: string;
}

export interface SecuritySettings {
  /** ต้องใส่ PIN ก่อนสั่งงานจากหน้า Control */
  requirePinForControl: boolean;
  /** บทบาทขั้นต่ำที่สั่งงานอุปกรณ์ได้ */
  minimumRoleForControl: UserRole;
  /** ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน */
  sessionTimeoutMinutes: number;
  /** ล็อกการสั่งงานทั้งหมด (โหมดซ่อมบำรุง) */
  controlLockout: boolean;
  /** จำกัดให้ผู้ใช้เห็นเฉพาะข้อมูลแผนกตัวเอง (row level security) */
  departmentScopedAccess: boolean;
  auditLogRetentionDays: number;
}

/** รวมทุกหมวดที่หน้า Settings แก้ได้ */
export interface SystemSettings {
  general: GeneralSettings;
  thresholds: ThresholdSettings;
  network: NetworkSettings;
  notifications: NotificationSettings;
  billing: BillingSettings;
  ai: AISettings;
  maintenance: MaintenanceSettings;
  security: SecuritySettings;
  updatedAt: ISODateTime;
  updatedBy: ActorRef;
}

/** ชื่อหมวดสำหรับ tab ในหน้า Settings */
export type SettingsSection = keyof Omit<SystemSettings, 'updatedAt' | 'updatedBy'>;

// ═════════════════════════════════════════════════════════════
// ค่าสาธารณูปโภคและการพยากรณ์
// ═════════════════════════════════════════════════════════════

export type UtilityKind = 'water' | 'electricity';

/** ปริมาณที่ตกในแต่ละขั้นอัตรา พร้อมค่าใช้จ่ายของขั้นนั้น */
export interface BillingTierBreakdown {
  tierId: string;
  tierName: string;
  cubicMeters: number;
  ratePerCubicMeter: number;
  amountBaht: number;
}

export interface BillingEstimate {
  utility: UtilityKind;
  periodStart: ISODateTime;
  periodEnd: ISODateTime;
  consumedCubicMeters: number;
  tierBreakdown: BillingTierBreakdown[];
  subtotalBaht: number;
  serviceChargeBaht: number;
  vatBaht: number;
  totalBaht: number;
  currency: string;
  /** ประมาณยอดสิ้นรอบบิลจากอัตราการใช้ปัจจุบัน */
  projectedTotalBaht: number;
  /** เทียบกับรอบบิลก่อนหน้า (%) — บวก = ใช้มากขึ้น */
  changeFromPreviousPercent: number;
  calculatedAt: ISODateTime;
}

/** ค่าใช้จ่ายที่แบ่งให้แผนกหนึ่งในรอบบิล — ผลลัพธ์หลักที่โปรเจกต์ต้องการ */
export interface DepartmentUsage {
  departmentId: string;
  departmentName: string;
  costCenterCode: string;
  periodStart: ISODateTime;
  periodEnd: ISODateTime;
  /** น้ำ */
  waterCubicMeters: number;
  waterCostBaht: number;
  /** ไฟฟ้า */
  energyKwh: number;
  electricityCostBaht: number;
  totalCostBaht: number;
  /** สัดส่วนของค่าใช้จ่ายรวมทั้งโรงงาน (%) */
  sharePercent: number;
  /** เทียบกับรอบก่อนหน้า (%) */
  changeFromPreviousPercent: number;
}


// ═════════════════════════════════════════════════════════════
// สรุปภาพรวมและรายงาน
// ═════════════════════════════════════════════════════════════

/** ตัวเลขหลักบนหน้า Overview (จอแขวนผนัง) */
export interface SystemSummary {
  totalStoredLiters: number;
  totalCapacityLiters: number;
  totalStoredPercent: number;
  /** อัตราไหลรวมจากมิเตอร์หลัก ณ ขณะนี้ */
  mainInflowLpm: number;
  /** ผลรวมอัตราไหลของ 8 โซน */
  zoneOutflowLpm: number;
  todayConsumptionCubicMeters: number;
  monthConsumptionCubicMeters: number;
  /** พลังงานรวมวันนี้ ทั้งปั๊มและตู้ไฟรายแผนก */
  todayEnergyKwh: number;
  /** แรงดันที่ระบบควบคุมรักษาอยู่ — null เมื่อไม่ได้เปิดลูป PID */
  systemPressureBar: number | null;
  pumpsRunning: number;
  pumpsTotal: number;
  zonesActive: number;
  zonesTotal: number;
  devicesOnline: number;
  devicesTotal: number;
  unreadAlerts: number;
  criticalAlerts: number;
  /** anomaly ที่ยังไม่ถูกปิดในช่วง 24 ชม. */
  openAnomalies: number;
  unaccounted: UnaccountedWater;
  overallStatus: EntityStatus;
  updatedAt: ISODateTime;
}

export type ReportType =
  | 'daily'
  | 'monthly'
  | 'zone_comparison'
  | 'department_cost'
  | 'energy'
  | 'leak_audit';

export type ReportFormat = 'csv' | 'pdf' | 'xlsx';

export interface ReportColumn {
  key: string;
  label: string;
  labelEn: string;
  unit: string | null;
  /** ชนิดค่าใช้ตัดสินการจัดรูปแบบและการชิดขอบ */
  valueType: 'number' | 'text' | 'datetime';
}

/** หนึ่งแถวในตารางรายงาน */
export interface ReportRow {
  label: string;
  labelEn: string;
  values: Record<string, number | string | null>;
}

export interface ReportDefinition extends BaseRecord {
  type: ReportType;
  range: TimeRange;
  /** หัวคอลัมน์เรียงตามลำดับที่แสดง */
  columns: ReportColumn[];
  rows: ReportRow[];
  /** แถวสรุปท้ายตาราง — null เมื่อรายงานนี้ไม่มีผลรวม */
  totals: ReportRow | null;
  generatedAt: ISODateTime;
}

/** ค่าใช้น้ำและค่าน้ำรายโซนในรอบบิล ใช้กับกราฟแท่งเปรียบเทียบหน้า Overview */
export interface ZoneCost {
  zoneId: string;
  name: string;
  nameEn: string;
  departmentId: string | null;
  cubicMeters: number;
  costBaht: number;
  /** สัดส่วนการใช้เทียบทั้งโรงงาน (%) */
  sharePercent: number;
}

/**
 * ยอดรวมรายวัน ใช้กับกราฟเส้นการใช้น้ำรายวัน
 * และกราฟซ้อนอุณหภูมิภายนอก vs การใช้น้ำ
 */
export interface DailyUsagePoint {
  /** วันที่แบบ "YYYY-MM-DD" ตามเวลาท้องถิ่น */
  date: string;
  timestamp: EpochMs;
  cubicMeters: number;
  costBaht: number;
  /** อุณหภูมิเฉลี่ยกลางแจ้งของวันนั้น — null เมื่อไม่มีข้อมูลเซนเซอร์ */
  avgTemperatureCelsius: number | null;
  /** ฝนสะสมของวันนั้น (มม.) — null เมื่อไม่มีข้อมูล */
  rainfallMm: number | null;
  /** true = วันในอนาคตที่ยังไม่เกิด (ส่วนที่ AI พยากรณ์) */
  projected: boolean;
}

// ═════════════════════════════════════════════════════════════
// พารามิเตอร์ query
// ═════════════════════════════════════════════════════════════

/** พารามิเตอร์ query ข้อมูลกราฟย้อนหลัง */
export interface HistoryQuery {
  entityId: string;
  metric: MetricKey;
  range: TimeRange;
  /** ความละเอียดที่ต้องการ (วินาที) — หลังบ้าน downsample ให้ */
  intervalSeconds: number;
}

/** ตัวกรองรายการ alert ในหน้า Alerts */
export interface AlertQuery {
  severities?: AlertSeverity[];
  states?: AlertState[];
  sourceTypes?: AlertSourceType[];
  codes?: AlertCode[];
  departmentIds?: string[];
  /** กรองตาม entity ต้นทาง เช่น เอาเฉพาะ alert ของโซน 3 */
  sourceIds?: string[];
  unreadOnly?: boolean;
  range?: TimeRange;
  limit?: number;
  offset?: number;
}

/** ตัวกรองรายการ anomaly — ค่ากรองเป็น string เปิดตามชนิดที่ทีม AI ส่งมา */
export interface AnomalyQuery {
  types?: AnomalyType[];
  detectors?: AnomalyDetector[];
  severities?: AlertSeverity[];
  sourceTypes?: AlertSourceType[];
  /** คะแนนขั้นต่ำที่สนใจ (0–1) */
  minScore?: number;
  range?: TimeRange;
  limit?: number;
  offset?: number;
}

// ═════════════════════════════════════════════════════════════
// Realtime — สัญญาระหว่างหน้าบ้านกับช่องทาง realtime ของหลังบ้าน
// ═════════════════════════════════════════════════════════════

/**
 * เหตุการณ์ที่ push มาทาง realtime channel
 *
 * discriminated union บน `type` — หน้าบ้าน switch ได้โดยไม่ต้อง cast
 * ทุกเหตุการณ์ส่ง entity ทั้งก้อน ไม่ส่ง patch บางส่วน เพื่อกันสถานะเพี้ยนเมื่อ event หาย
 */
export type RealtimeEvent =
  | { type: 'tank'; at: ISODateTime; payload: Tank }
  | { type: 'pump'; at: ISODateTime; payload: Pump }
  | { type: 'valve'; at: ISODateTime; payload: Valve }
  | { type: 'zone'; at: ISODateTime; payload: Zone }
  | { type: 'meter'; at: ISODateTime; payload: WaterMeter }
  | { type: 'main_meter'; at: ISODateTime; payload: MainMeter }
  | { type: 'sensor'; at: ISODateTime; payload: EnvironmentSensor }
  | { type: 'electric_node'; at: ISODateTime; payload: ElectricNode }
  | { type: 'pressure_control'; at: ISODateTime; payload: PressureControl }
  | { type: 'device'; at: ISODateTime; payload: Device }
  | { type: 'alert'; at: ISODateTime; payload: Alert }
  | { type: 'anomaly'; at: ISODateTime; payload: AnomalyEvent }
  | { type: 'command_result'; at: ISODateTime; payload: CommandResult }
  | { type: 'connection'; at: ISODateTime; payload: ConnectionStatus };

/** ชื่อ channel ที่ subscribe ได้ — ใช้กรองฝั่งเซิร์ฟเวอร์ไม่ให้ส่งเกินจำเป็น */
export type RealtimeChannel = 'telemetry' | 'alerts' | 'commands' | 'system';

// ═════════════════════════════════════════════════════════════
// ส่วนเฉพาะหน้าบ้าน — ไม่ใช่ส่วนหนึ่งของ REST contract
// ทีมหลังบ้านข้ามส่วนนี้ได้ ยกเว้น Locale/ThemeMode ที่ถูกอ้างใน GeneralSettings
// เพราะเป็นค่าตั้งต้นของหน้าจอที่เก็บไว้ฝั่งเซิร์ฟเวอร์
// ═════════════════════════════════════════════════════════════

export type Locale = 'th' | 'en';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * สถานการณ์จำลองสำหรับสาธิต — มีเฉพาะตอนใช้ mock ไม่ใช่ส่วนหนึ่งของ API จริง
 *
 * normal          เดินปกติ
 * night_leak      มีน้ำรั่วช่วงที่ไม่ควรมีการใช้งาน
 * pump_degrading  ปั๊มเสื่อม กินไฟเท่าเดิมแต่ได้น้ำน้อยลงเรื่อย ๆ
 */
export type MockScenario = 'normal' | 'night_leak' | 'pump_degrading';
