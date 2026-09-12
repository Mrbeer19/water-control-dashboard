/**
 * สเปกฮาร์ดแวร์จริงในโรงงาน — ตรงตามที่ระบุใน CLAUDE.md
 * ส่วนนี้เป็นค่าคงที่ ไม่ขยับตอน runtime (simulator จะขยับเฉพาะค่าที่วัดได้)
 */

import type { EnvironmentLocation, PumpRole, TankLevelPoint, TankLevelSource, TankRole, TankShape } from '@/lib/types';

export interface TankSpec {
  id: string;
  name: string;
  nameEn: string;
  role: TankRole;
  capacityLiters: number;
  heightMeters: number;
  shape: TankShape;
  levelSource: TankLevelSource;
  /** ตารางเทียบระดับ→ปริมาตร จำเป็นเมื่อ shape เป็น pond/irregular */
  levelToVolumeTable: TankLevelPoint[] | null;
  location: string;
  locationEn: string;
  /**
   * ESP32 node ที่อ่านเซนเซอร์ระดับน้ำของถังใบนี้
   * null ได้เฉพาะกรณีที่ต้องถอยไปใช้การจดมือ (เช่น เซนเซอร์เสียระหว่างรออะไหล่)
   */
  deviceId: string | null;
  /** เปอร์เซ็นต์ตั้งต้นตอนเปิดหน้าจอ */
  initialPercent: number;
}

export const TANK_SPECS: readonly TankSpec[] = [
  {
    id: 'tank-1',
    name: 'ถังใต้ดินหลัก',
    nameEn: 'Main Underground Tank',
    role: 'underground_main',
    capacityLiters: 70_000,
    heightMeters: 3.5,
    shape: 'rectangular',
    levelSource: 'sensor',
    levelToVolumeTable: null,
    location: 'ลานหน้าห้องปั๊ม',
    locationEn: 'Pump House Yard',
    deviceId: 'esp32-tank-1',
    initialPercent: 68,
  },
  {
    id: 'tank-2',
    // ★ สำรวจหน้างาน 12 ก.ย. 2569: ถังใบนี้เป็นถังของโซน VIP โดยเฉพาะ
    //   รับน้ำต่อจากถัง 1 มาเก็บไว้ แล้วมีปั๊มของตัวเอง (pump-3) จ่ายเข้าโซน VIP
    name: 'ถังโซน VIP',
    nameEn: 'VIP Zone Tank',
    role: 'service',
    capacityLiters: 3_000,
    heightMeters: 2.0,
    shape: 'cylindrical',
    levelSource: 'sensor',
    levelToVolumeTable: null,
    location: 'พื้นที่โซน VIP',
    locationEn: 'VIP Zone Area',
    deviceId: 'esp32-tank-2',
    initialPercent: 74,
  },
  {
    id: 'tank-3',
    /*
     * ★ สำรวจหน้างาน 12 ก.ย. 2569: บ่อนี้ **รับน้ำจากการประปาโดยตรง** ไม่ได้ต่อจากถัง 1
     *   เติมอัตโนมัติเมื่อระดับลดต่ำกว่าเส้นที่ตั้งไว้
     *   ตอนประปาไม่ไหล จะ **สูบกลับเข้าถัง 1** เพื่อจ่ายต่อให้ทั้งโรงงาน
     *
     * ★ ผลต่อสูตรน้ำสูญหาย: น้ำที่เข้าบ่อนี้ผ่านมิเตอร์หลักแล้ว
     *   Δstorage จึงต้องรวมบ่อนี้ด้วย ไม่งั้นช่วงเติมบ่อระบบจะเตือนว่ารั่ว
     */
    name: 'บ่อสำรอง',
    nameEn: 'Reserve Pond',
    role: 'reserve_pond',
    capacityLiters: 490_000,
    heightMeters: 4.0,
    shape: 'pond',
    levelSource: 'sensor',
    // เซนเซอร์ให้ค่า "ความลึก" ไม่ใช่ปริมาตร และบ่อขุดผนังลาดมีหน้าตัดกว้างขึ้นตามความลึก
    // จึงยังต้องเทียบปริมาตรจากตารางนี้ ใช้สูตร level × area ตรง ๆ ไม่ได้
    levelToVolumeTable: [
      { levelMeters: 0.0, volumeLiters: 0 },
      { levelMeters: 0.5, volumeLiters: 42_000 },
      { levelMeters: 1.0, volumeLiters: 92_000 },
      { levelMeters: 1.5, volumeLiters: 148_000 },
      { levelMeters: 2.0, volumeLiters: 209_000 },
      { levelMeters: 2.5, volumeLiters: 275_000 },
      { levelMeters: 3.0, volumeLiters: 345_000 },
      { levelMeters: 3.5, volumeLiters: 416_000 },
      { levelMeters: 4.0, volumeLiters: 490_000 },
    ],
    location: 'ท้ายโรงงาน',
    locationEn: 'Rear Plant Area',
    deviceId: 'esp32-tank-3',
    initialPercent: 82,
  },
];

export interface PumpSpec {
  id: string;
  name: string;
  nameEn: string;
  role: PumpRole;
  sourceTankId: string;
  servesZoneIds: string[];
  deviceId: string;
  /** อัตราไหลที่พิกัด (L/min) */
  ratedFlowLpm: number;
  ratedPowerWatt: number;
  /** ชั่วโมงเดินสะสมตั้งต้น */
  initialRuntimeHours: number;
  /** ตั้งต้นให้เดินอยู่หรือไม่ */
  initiallyRunning: boolean;
  /** ปั๊มตัวนี้ขับด้วย VFD หรือไม่ (รองรับโหมด PID รักษาแรงดัน) */
  hasVfd: boolean;
}

/*
 * ★ สำรวจหน้างาน 12 ก.ย. 2569: ปั๊มหลัก 2 ตัวอยู่ข้างถัง 1 ใช้ตู้ควบคุมเดิมของโรงงานร่วมกัน
 *   **ทั้งคู่จ่ายน้ำให้ทุกโซนเหมือนกัน ไม่ได้แบ่งโซนกัน**
 *   แต่ **สลับเวรกันเดิน** ตัวหนึ่งช่วงกลางวัน อีกตัวช่วงกลางคืน
 *   servesZoneIds ของสองตัวนี้จึงต้องเป็นชุดเดียวกัน
 *   ตัวที่ "เข้าเวร" ตัดสินใน simulator ตาม settings.maintenance.pumpAlternationHours (12 ชม.)
 */
export const PUMP_SPECS: readonly PumpSpec[] = [
  {
    id: 'pump-1',
    name: 'ปั๊มหลัก 1',
    nameEn: 'Main Pump 1',
    role: 'main',
    sourceTankId: 'tank-1',
    servesZoneIds: ['zone-1', 'zone-2', 'zone-3', 'zone-4', 'zone-5', 'zone-6', 'zone-7'],
    deviceId: 'esp32-pump-1',
    ratedFlowLpm: 220,
    ratedPowerWatt: 3_000,
    initialRuntimeHours: 8_412.6,
    initiallyRunning: true,
    hasVfd: false,
  },
  {
    id: 'pump-2',
    name: 'ปั๊มหลัก 2',
    nameEn: 'Main Pump 2',
    role: 'main',
    sourceTankId: 'tank-1',
    servesZoneIds: ['zone-1', 'zone-2', 'zone-3', 'zone-4', 'zone-5', 'zone-6', 'zone-7'],
    deviceId: 'esp32-pump-2',
    ratedFlowLpm: 220,
    ratedPowerWatt: 3_000,
    initialRuntimeHours: 8_106.2,
    initiallyRunning: true,
    hasVfd: false,
  },
  {
    id: 'pump-3',
    name: 'ปั๊มโซน VIP',
    nameEn: 'VIP Zone Pump',
    role: 'vip',
    sourceTankId: 'tank-2',
    servesZoneIds: ['zone-8'],
    deviceId: 'esp32-pump-3',
    ratedFlowLpm: 60,
    ratedPowerWatt: 750,
    initialRuntimeHours: 3_275.9,
    initiallyRunning: false,
    hasVfd: true,
  },
];

export interface ZoneSpec {
  id: string;
  zoneNumber: number;
  name: string;
  nameEn: string;
  area: string;
  areaEn: string;
  meterId: string;
  valveId: string;
  deviceId: string;
  /** แผนกที่รับผิดชอบค่าน้ำของโซนนี้ — null สำหรับพื้นที่ส่วนกลาง */
  departmentId: string | null;
  isVip: boolean;
  /** อัตราไหลปกติของโซนนี้ (L/min) ใช้เป็น target ของ random walk */
  baselineFlowLpm: number;
  dailyQuotaCubicMeters: number | null;
}

export const ZONE_SPECS: readonly ZoneSpec[] = [
  {
    id: 'zone-1',
    zoneNumber: 1,
    name: 'โซน 1 — อาคารผลิต A',
    nameEn: 'Zone 1 — Production A',
    area: 'อาคารผลิต A',
    areaEn: 'Production Building A',
    meterId: 'meter-zone-1',
    valveId: 'valve-zone-1',
    deviceId: 'esp32-meter-1',
    departmentId: 'dept-production',
    isVip: false,
    baselineFlowLpm: 46,
    dailyQuotaCubicMeters: 80,
  },
  {
    id: 'zone-2',
    zoneNumber: 2,
    name: 'โซน 2 — อาคารผลิต B',
    nameEn: 'Zone 2 — Production B',
    area: 'อาคารผลิต B',
    areaEn: 'Production Building B',
    meterId: 'meter-zone-2',
    valveId: 'valve-zone-2',
    deviceId: 'esp32-meter-2',
    departmentId: 'dept-production',
    isVip: false,
    baselineFlowLpm: 38,
    dailyQuotaCubicMeters: 66,
  },
  {
    id: 'zone-3',
    zoneNumber: 3,
    name: 'โซน 3 — โรงอาหาร',
    nameEn: 'Zone 3 — Canteen',
    area: 'โรงอาหารและครัวกลาง',
    areaEn: 'Canteen & Central Kitchen',
    meterId: 'meter-zone-3',
    valveId: 'valve-zone-3',
    deviceId: 'esp32-meter-3',
    departmentId: 'dept-facility',
    isVip: false,
    baselineFlowLpm: 20,
    dailyQuotaCubicMeters: 35,
  },
  {
    id: 'zone-4',
    zoneNumber: 4,
    name: 'โซน 4 — อาคารสำนักงาน',
    nameEn: 'Zone 4 — Office',
    area: 'อาคารสำนักงาน 3 ชั้น',
    areaEn: 'Office Building (3F)',
    meterId: 'meter-zone-4',
    valveId: 'valve-zone-4',
    deviceId: 'esp32-meter-4',
    departmentId: 'dept-facility',
    isVip: false,
    baselineFlowLpm: 13,
    dailyQuotaCubicMeters: 23,
  },
  {
    id: 'zone-5',
    zoneNumber: 5,
    name: 'โซน 5 — หอพักพนักงาน',
    nameEn: 'Zone 5 — Staff Dormitory',
    area: 'หอพักพนักงาน',
    areaEn: 'Staff Dormitory',
    meterId: 'meter-zone-5',
    valveId: 'valve-zone-5',
    deviceId: 'esp32-meter-5',
    departmentId: 'dept-hr',
    isVip: false,
    baselineFlowLpm: 28,
    dailyQuotaCubicMeters: 48,
  },
  {
    id: 'zone-6',
    zoneNumber: 6,
    name: 'โซน 6 — ระบบหล่อเย็น',
    nameEn: 'Zone 6 — Cooling System',
    area: 'คูลลิ่งทาวเวอร์',
    areaEn: 'Cooling Tower',
    meterId: 'meter-zone-6',
    valveId: 'valve-zone-6',
    deviceId: 'esp32-meter-6',
    departmentId: 'dept-production',
    isVip: false,
    baselineFlowLpm: 54,
    dailyQuotaCubicMeters: 92,
  },
  {
    id: 'zone-7',
    zoneNumber: 7,
    name: 'โซน 7 — พื้นที่ล้างทำความสะอาด',
    nameEn: 'Zone 7 — Washdown Area',
    area: 'ลานล้างและบ่อบำบัด',
    areaEn: 'Washdown & Treatment',
    meterId: 'meter-zone-7',
    valveId: 'valve-zone-7',
    deviceId: 'esp32-meter-7',
    departmentId: 'dept-facility',
    isVip: false,
    baselineFlowLpm: 16,
    dailyQuotaCubicMeters: 28,
  },
  {
    id: 'zone-8',
    zoneNumber: 8,
    name: 'โซน 8 — พื้นที่ VIP',
    nameEn: 'Zone 8 — VIP Area',
    area: 'บ้านพักผู้บริหารและห้องรับรอง',
    areaEn: 'Executive Residence & Lounge',
    meterId: 'meter-zone-8',
    valveId: 'valve-zone-8',
    deviceId: 'esp32-meter-8',
    departmentId: 'dept-executive',
    isVip: true,
    baselineFlowLpm: 9,
    dailyQuotaCubicMeters: null,
  },
];

export const MAIN_METER_SPEC = {
  id: 'meter-main',
  name: 'มิเตอร์หลัก (การประปา)',
  nameEn: 'Main Meter (Utility)',
  pipeSizeInches: 2,
  supplierName: 'การประปาส่วนภูมิภาค',
  supplierNameEn: 'Provincial Waterworks Authority',
  supplierMeterNo: 'PWA-4471-08822',
  deviceId: 'esp32-meter-main',
  /** อัตราไหลขาเข้าปกติ (L/min) */
  baselineFlowLpm: 380,
} as const;

export interface EnvironmentSpec {
  id: string;
  name: string;
  nameEn: string;
  location: EnvironmentLocation;
  locationLabel: string;
  locationLabelEn: string;
  deviceId: string;
  hasRainGauge: boolean;
  /** จุดนี้มี barometer + light sensor หรือไม่ (มีเฉพาะกลางแจ้ง) */
  hasWeatherSensors: boolean;
  baselineTemperatureCelsius: number;
  baselineHumidityPercent: number;
  /** ความกดอากาศเฉลี่ยที่ระดับพื้นที่โรงงาน (hPa) — null เมื่อไม่มี barometer */
  baselinePressureHpa: number | null;
  /** ความเข้มแสงกลางแดดจัด (lux) — null เมื่อไม่มี light sensor */
  peakIlluminanceLux: number | null;
}

export const ENVIRONMENT_SPECS: readonly EnvironmentSpec[] = [
  {
    id: 'env-pump-room',
    name: 'เซนเซอร์ห้องปั๊ม',
    nameEn: 'Pump Room Sensor',
    location: 'pump_room',
    locationLabel: 'ห้องปั๊ม',
    locationLabelEn: 'Pump Room',
    deviceId: 'esp32-env-1',
    hasRainGauge: false,
    hasWeatherSensors: false,
    baselineTemperatureCelsius: 34.5,
    baselineHumidityPercent: 68,
    baselinePressureHpa: null,
    peakIlluminanceLux: null,
  },
  {
    id: 'env-control-cabinet',
    name: 'เซนเซอร์ตู้คอนโทรล',
    nameEn: 'Control Cabinet Sensor',
    location: 'control_cabinet',
    locationLabel: 'ตู้คอนโทรล',
    locationLabelEn: 'Control Cabinet',
    deviceId: 'esp32-env-2',
    hasRainGauge: false,
    hasWeatherSensors: false,
    baselineTemperatureCelsius: 38.2,
    baselineHumidityPercent: 52,
    baselinePressureHpa: null,
    peakIlluminanceLux: null,
  },
  {
    id: 'env-outdoor',
    name: 'เซนเซอร์กลางแจ้ง',
    nameEn: 'Outdoor Sensor',
    location: 'outdoor',
    locationLabel: 'กลางแจ้ง',
    locationLabelEn: 'Outdoor',
    deviceId: 'esp32-env-3',
    hasRainGauge: true,
    hasWeatherSensors: true,
    baselineTemperatureCelsius: 31.8,
    baselineHumidityPercent: 74,
    // ปทุมธานีอยู่เกือบระดับน้ำทะเล ความกดอากาศจึงใกล้ 1013 hPa
    baselinePressureHpa: 1009.4,
    peakIlluminanceLux: 92_000,
  },
];
