/**
 * แผนก ผู้ใช้ และจุดวัดไฟฟ้ารายแผนก
 * เป้าหมายของโปรเจกต์คือแบ่งค่าน้ำ/ค่าไฟตามการใช้จริงของแต่ละแผนก
 */

import type { ActorRef, Department, ElectricPhase, User } from '@/lib/types';

export const DEPARTMENTS: readonly Department[] = [
  {
    id: 'dept-production',
    name: 'ฝ่ายผลิต',
    nameEn: 'Production',
    costCenterCode: 'CC-1100',
    managerUserId: 'user-nid',
    active: true,
  },
  {
    id: 'dept-facility',
    name: 'ฝ่ายอาคารสถานที่',
    nameEn: 'Facility',
    costCenterCode: 'CC-2200',
    managerUserId: 'user-somchai',
    active: true,
  },
  {
    id: 'dept-hr',
    name: 'ฝ่ายทรัพยากรบุคคล',
    nameEn: 'Human Resources',
    costCenterCode: 'CC-3300',
    managerUserId: 'user-ploy',
    active: true,
  },
  {
    id: 'dept-executive',
    name: 'สำนักผู้บริหาร',
    nameEn: 'Executive Office',
    costCenterCode: 'CC-9900',
    managerUserId: 'user-admin',
    active: true,
  },
];

export const USERS: readonly User[] = [
  { id: 'user-admin', displayName: 'ผู้ดูแลระบบ', role: 'admin', departmentId: null, active: true },
  { id: 'user-somchai', displayName: 'ช่างสมชาย', role: 'operator', departmentId: 'dept-facility', active: true },
  { id: 'user-nid', displayName: 'หัวหน้ากะ นิด', role: 'operator', departmentId: 'dept-production', active: true },
  { id: 'user-ploy', displayName: 'พลอย (บุคคล)', role: 'operator', departmentId: 'dept-hr', active: true },
  { id: 'user-accounting', displayName: 'ฝ่ายบัญชี', role: 'viewer', departmentId: null, active: true },
];

/** ผู้ใช้ที่ระบบสมมติว่ากำลังล็อกอินอยู่ใน Phase 0 (ยังไม่มีระบบล็อกอินจริง) */
export const CURRENT_USER_ID = 'user-somchai';

/** แปลง User เป็น ActorRef ที่ฝังลงเรกคอร์ดได้ */
export function toActorRef(userId: string): ActorRef {
  const user = USERS.find((item) => item.id === userId);
  if (user === undefined) {
    return { userId, displayName: userId, role: 'viewer' };
  }
  return { userId: user.id, displayName: user.displayName, role: user.role };
}

export const SYSTEM_ACTOR: ActorRef = { userId: 'system', displayName: 'ระบบ', role: 'admin' };

export interface ElectricNodeSpec {
  id: string;
  name: string;
  nameEn: string;
  departmentId: string;
  panelName: string;
  panelNameEn: string;
  phase: ElectricPhase;
  breakerRatingAmp: number;
  deviceId: string;
  /** กำลังไฟฟ้าปกติของตู้นี้ (W) ใช้เป็น target ของ random walk */
  baselinePowerWatt: number;
}

/** ตู้ไฟย่อยรายแผนก — ESP32 + PZEM ที่แต่ละตู้ */
export const ELECTRIC_NODE_SPECS: readonly ElectricNodeSpec[] = [
  {
    id: 'elec-production',
    name: 'ตู้ไฟฝ่ายผลิต',
    nameEn: 'Production Panel',
    departmentId: 'dept-production',
    panelName: 'MDB-A อาคารผลิต',
    panelNameEn: 'MDB-A Production',
    phase: 'three',
    breakerRatingAmp: 250,
    deviceId: 'esp32-elec-1',
    baselinePowerWatt: 84_000,
  },
  {
    id: 'elec-facility',
    name: 'ตู้ไฟอาคารสถานที่',
    nameEn: 'Facility Panel',
    departmentId: 'dept-facility',
    panelName: 'DB-B ส่วนกลาง',
    panelNameEn: 'DB-B Common Area',
    phase: 'three',
    breakerRatingAmp: 100,
    deviceId: 'esp32-elec-2',
    baselinePowerWatt: 21_500,
  },
  {
    id: 'elec-dormitory',
    name: 'ตู้ไฟหอพักพนักงาน',
    nameEn: 'Dormitory Panel',
    departmentId: 'dept-hr',
    panelName: 'DB-C หอพัก',
    panelNameEn: 'DB-C Dormitory',
    phase: 'three',
    breakerRatingAmp: 100,
    deviceId: 'esp32-elec-3',
    baselinePowerWatt: 17_200,
  },
  {
    id: 'elec-executive',
    name: 'ตู้ไฟสำนักผู้บริหาร',
    nameEn: 'Executive Panel',
    departmentId: 'dept-executive',
    panelName: 'DB-D อาคารรับรอง',
    panelNameEn: 'DB-D Executive',
    phase: 'single',
    breakerRatingAmp: 63,
    deviceId: 'esp32-elec-4',
    baselinePowerWatt: 6_400,
  },
];
