/**
 * mapping ชนิดความผิดปกติ → ชื่อไทย/อังกฤษ ไอคอน และสี
 *
 * ★ AnomalyEvent.type เป็น string เปิด ทีม AI เพิ่มชนิดใหม่ได้โดยไม่ต้องรอหน้าบ้าน
 *   ไฟล์นี้จึงเป็นแค่ "ตารางแปลที่รู้จัก" ไม่ใช่รายการที่อนุญาต
 *   ชนิดที่ยังไม่มีในตารางต้องแสดงได้เสมอผ่าน UNKNOWN_ANOMALY_TYPE
 *
 * เพิ่มชนิดใหม่: เติมคีย์ที่นี่ที่เดียว แล้วอัปเดต docs/AI_CONTRACT.md
 */

import {
  Activity,
  AlertTriangle,
  Droplets,
  Gauge,
  HelpCircle,
  Thermometer,
  TrendingUp,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AlertSeverity, AnomalyType, EntityStatus } from '@/lib/types';

export interface AnomalyTypeConfig {
  labelTh: string;
  labelEn: string;
  icon: LucideIcon;
  /** ใช้เลือกสีจาก token สถานะเดียวกับทั้งระบบ */
  tone: EntityStatus;
  /** ความรุนแรงตั้งต้น ใช้เมื่อทีม AI ไม่ได้ส่ง severity มา */
  defaultSeverity: AlertSeverity;
  descriptionTh: string;
  descriptionEn: string;
}

/** ชนิดที่หน้าบ้านรู้จักแล้ว ณ ตอนนี้ */
export const ANOMALY_TYPES: Record<string, AnomalyTypeConfig> = {
  night_leak: {
    labelTh: 'น้ำรั่วช่วงกลางคืน',
    labelEn: 'Night-time leak',
    icon: Droplets,
    tone: 'critical',
    defaultSeverity: 'critical',
    descriptionTh: 'พบการไหลต่อเนื่องในช่วงที่ไม่ควรมีการใช้น้ำ',
    descriptionEn: 'Continuous flow detected during hours with no expected usage',
  },
  continuous_flow: {
    labelTh: 'ไหลต่อเนื่องผิดปกติ',
    labelEn: 'Continuous flow',
    icon: Waves,
    tone: 'warning',
    defaultSeverity: 'warning',
    descriptionTh: 'อัตราไหลไม่กลับไปที่ศูนย์เลยตลอดช่วงที่ตรวจ',
    descriptionEn: 'Flow never returned to zero across the observed window',
  },
  usage_spike: {
    labelTh: 'การใช้น้ำพุ่งผิดปกติ',
    labelEn: 'Usage spike',
    icon: TrendingUp,
    tone: 'warning',
    defaultSeverity: 'warning',
    descriptionTh: 'ปริมาณการใช้สูงกว่ารูปแบบปกติของจุดวัดนี้มาก',
    descriptionEn: 'Consumption far above this point’s normal pattern',
  },
  pump_degradation: {
    labelTh: 'ประสิทธิภาพปั๊มลดลง',
    labelEn: 'Pump degradation',
    icon: Activity,
    tone: 'warning',
    defaultSeverity: 'warning',
    descriptionTh: 'ปั๊มใช้ไฟเท่าเดิมแต่ได้อัตราไหลน้อยลง',
    descriptionEn: 'Pump draws the same power but delivers less flow',
  },
  pressure_deviation: {
    labelTh: 'แรงดันเบี่ยงจากเป้าหมาย',
    labelEn: 'Pressure deviation',
    icon: Gauge,
    tone: 'warning',
    defaultSeverity: 'warning',
    descriptionTh: 'แรงดันจริงห่างจากค่าที่ลูปควบคุมตั้งไว้',
    descriptionEn: 'Measured pressure drifted away from the control setpoint',
  },
  power_anomaly: {
    labelTh: 'การใช้ไฟผิดปกติ',
    labelEn: 'Power anomaly',
    icon: Zap,
    tone: 'warning',
    defaultSeverity: 'warning',
    descriptionTh: 'รูปแบบการใช้ไฟของตู้นี้ต่างจากปกติ',
    descriptionEn: 'This panel’s power pattern differs from its baseline',
  },
  sensor_drift: {
    labelTh: 'เซนเซอร์อ่านค่าเพี้ยน',
    labelEn: 'Sensor drift',
    icon: Thermometer,
    tone: 'warning',
    defaultSeverity: 'info',
    descriptionTh: 'ค่าที่อ่านได้ค่อย ๆ เลื่อนออกจากช่วงที่ควรเป็น',
    descriptionEn: 'Readings are gradually drifting from the expected range',
  },
  unaccounted_water: {
    labelTh: 'น้ำสูญหายในระบบ',
    labelEn: 'Unaccounted water',
    icon: AlertTriangle,
    tone: 'critical',
    defaultSeverity: 'critical',
    descriptionTh: 'มิเตอร์หลักสูงกว่าผลรวมโซนเกินเกณฑ์หลังหักน้ำที่เก็บในถังแล้ว',
    descriptionEn: 'Main meter exceeds zone total beyond threshold after accounting for storage',
  },
};

/** ใช้กับชนิดที่หน้าบ้านยังไม่รู้จัก — ห้ามโยน error หรือซ่อนรายการทิ้ง */
export const UNKNOWN_ANOMALY_TYPE: AnomalyTypeConfig = {
  labelTh: 'ความผิดปกติที่ยังไม่ระบุชนิด',
  labelEn: 'Unclassified anomaly',
  icon: HelpCircle,
  tone: 'warning',
  defaultSeverity: 'info',
  descriptionTh: 'ทีม AI ส่งชนิดที่หน้าบ้านยังไม่มีคำแปล — แสดงรหัสดิบไว้ก่อน',
  descriptionEn: 'The AI team sent a type this UI has no label for yet — showing the raw code',
};

/**
 * หา config ของชนิดหนึ่ง — คืน fallback เสมอเมื่อไม่รู้จัก
 * ใช้ฟังก์ชันนี้เท่านั้น ห้ามเข้าถึง ANOMALY_TYPES[type] ตรง ๆ
 */
export function getAnomalyTypeConfig(type: AnomalyType | undefined): AnomalyTypeConfig {
  if (type === undefined) return UNKNOWN_ANOMALY_TYPE;
  return ANOMALY_TYPES[type] ?? UNKNOWN_ANOMALY_TYPE;
}

/** true เมื่อหน้าบ้านยังไม่มีคำแปลของชนิดนี้ — ใช้ตัดสินว่าจะโชว์รหัสดิบคู่กันไหม */
export function isUnknownAnomalyType(type: AnomalyType | undefined): boolean {
  return type === undefined || ANOMALY_TYPES[type] === undefined;
}
