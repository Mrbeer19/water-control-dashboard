/**
 * mapping คีย์ของค่าที่ทีม AI คำนวณ → ชื่อไทย/อังกฤษ หน่วย ไอคอน และวิธีจัดรูปแบบ
 *
 * ★ AIMetric.key เป็น string เปิด ทีม AI เพิ่มตัวชี้วัดใหม่ได้โดยหน้าบ้านไม่ต้อง deploy ตาม
 *   ไฟล์นี้จึงเป็นแค่ "ตารางแปลที่รู้จัก" ไม่ใช่รายการที่อนุญาต
 *   คีย์ที่ยังไม่มีในตารางต้องแสดงได้เสมอผ่าน UNKNOWN_METRIC
 *
 * เพิ่มตัวชี้วัดใหม่: เติมคีย์ที่นี่ที่เดียว แล้วอัปเดต docs/AI_CONTRACT.md
 * (รูปแบบเดียวกับ lib/config/anomaly-types.ts)
 */

import {
  Activity,
  Banknote,
  Droplets,
  Gauge,
  HelpCircle,
  Scale,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AIMetricFormat, AIMetricKey } from '@/lib/types';

export interface AIMetricConfig {
  labelTh: string;
  labelEn: string;
  icon: LucideIcon;
  /** หน่วยตั้งต้น ใช้เมื่อทีม AI ไม่ได้ส่ง unit มา */
  unit: string;
  format: AIMetricFormat;
  decimals: number;
  /** true = ค่าสูงขึ้นคือแย่ลง ใช้เลือกสีลูกศรเมื่อทีม AI ไม่ได้ระบุมาเอง */
  higherIsWorse: boolean;
  descriptionTh: string;
  descriptionEn: string;
}

/** ตัวชี้วัดที่หน้าบ้านรู้จักแล้ว ณ ตอนนี้ */
export const AI_METRICS: Record<string, AIMetricConfig> = {
  pump_efficiency: {
    labelTh: 'ประสิทธิภาพปั๊ม',
    labelEn: 'Pump efficiency',
    icon: Activity,
    unit: '%',
    format: 'percent',
    decimals: 0,
    higherIsWorse: false,
    descriptionTh: 'อัตราไหลที่ได้จริงเทียบกับกำลังไฟที่ใช้ เทียบกับตอนปั๊มยังใหม่',
    descriptionEn: 'Delivered flow against power drawn, compared with the pump when new',
  },
  specific_energy: {
    labelTh: 'พลังงานจำเพาะ',
    labelEn: 'Specific energy',
    icon: Zap,
    unit: 'kWh/m³',
    format: 'number',
    decimals: 3,
    higherIsWorse: true,
    descriptionTh: 'ไฟฟ้าที่ใช้ต่อการจ่ายน้ำ 1 ลูกบาศก์เมตร ยิ่งต่ำยิ่งคุ้ม',
    descriptionEn: 'Electricity used to deliver one cubic metre — lower is better',
  },
  leak_index: {
    labelTh: 'ดัชนีการรั่ว',
    labelEn: 'Leak index',
    icon: Droplets,
    unit: '',
    format: 'number',
    decimals: 2,
    higherIsWorse: true,
    descriptionTh: 'ระดับความเสี่ยงการรั่วที่โมเดลประเมินจากรูปแบบการไหลตอนไม่มีการใช้งาน',
    descriptionEn: 'Leak risk the model infers from flow patterns during idle hours',
  },
  water_balance_residual: {
    labelTh: 'ส่วนต่างสมดุลน้ำ',
    labelEn: 'Water balance residual',
    icon: Scale,
    unit: 'm³',
    format: 'number',
    decimals: 2,
    higherIsWorse: true,
    descriptionTh: 'น้ำที่อธิบายไม่ได้หลังหักการใช้งานและปริมาณที่เก็บในถังแล้ว',
    descriptionEn: 'Water left unexplained after usage and storage change are accounted for',
  },
  projected_bill: {
    labelTh: 'ค่าน้ำที่คาดสิ้นเดือน',
    labelEn: 'Projected monthly bill',
    icon: Banknote,
    unit: 'บาท',
    format: 'currency',
    decimals: 0,
    higherIsWorse: true,
    descriptionTh: 'ยอดค่าน้ำที่โมเดลคาดว่าจะจบรอบบิลนี้',
    descriptionEn: 'Bill the model expects at the end of this billing cycle',
  },
  pressure_stability: {
    labelTh: 'ความนิ่งของแรงดัน',
    labelEn: 'Pressure stability',
    icon: Gauge,
    unit: '%',
    format: 'percent',
    decimals: 0,
    higherIsWorse: false,
    descriptionTh: 'สัดส่วนเวลาที่แรงดันอยู่ในช่วงเป้าหมาย',
    descriptionEn: 'Share of time pressure stayed inside the target band',
  },
};

/** ใช้กับคีย์ที่หน้าบ้านยังไม่รู้จัก — ห้ามซ่อนรายการทิ้งหรือโยน error */
export const UNKNOWN_METRIC: AIMetricConfig = {
  labelTh: '',
  labelEn: '',
  icon: HelpCircle,
  unit: '',
  format: 'number',
  decimals: 2,
  higherIsWorse: false,
  descriptionTh: 'ทีม AI ส่งตัวชี้วัดที่หน้าบ้านยังไม่มีคำแปล — แสดงคีย์ดิบไว้ก่อน',
  descriptionEn: 'The AI team sent a metric this UI has no label for yet — showing the raw key',
};

/**
 * หา config ของตัวชี้วัดหนึ่ง — คืน fallback เสมอเมื่อไม่รู้จัก
 * คีย์ที่ไม่รู้จักจะใช้ตัวคีย์เองเป็นชื่อ เพื่อให้ยังอ่านออกว่าเป็นค่าอะไร
 */
export function getMetricConfig(key: AIMetricKey): AIMetricConfig {
  const known = AI_METRICS[key];
  if (known !== undefined) return known;
  return { ...UNKNOWN_METRIC, labelTh: key, labelEn: key };
}

export function isUnknownMetric(key: AIMetricKey): boolean {
  return AI_METRICS[key] === undefined;
}
