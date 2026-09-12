/**
 * ชนิดข้อมูลภายในของ chart explorer — ไม่ใช่สัญญากับหลังบ้าน
 * ★ สัญญากับหลังบ้านอยู่ใน lib/types.ts เท่านั้น ไฟล์นี้เก็บแค่ state ของหน้าจอ
 */
import type {
  AlertSeverity,
  MetricKey,
  MetricSourceType,
  SeriesCompareMode,
  SeriesGranularity,
} from '@/lib/types';

/** กราฟหนึ่งใบผูกกับค่าวัดตัวไหนของอุปกรณ์ไหน */
export interface MetricSourceRef {
  sourceType: MetricSourceType;
  sourceId: string;
  /** คีย์ตามสัญญาใน lib/types.ts — metric ที่ไม่มีในทะเบียนยัง render ได้ผ่าน UNKNOWN_METRIC */
  metric: MetricKey;
  /** ชื่ออุปกรณ์ที่จะขึ้นหัวหน้าต่าง — ไม่ส่งมาก็ใช้ sourceId */
  sourceName?: string;
}

/** ปุ่มช่วงเวลาสำเร็จรูป — 'custom' คือผู้ใช้เลือกวันเอง */
export type RangePreset = '1h' | '12h' | '24h' | '7d' | '30d' | '12mo' | 'custom';

export const RANGE_PRESETS: { value: Exclude<RangePreset, 'custom'>; ms: number }[] = [
  { value: '1h', ms: 3_600_000 },
  { value: '12h', ms: 12 * 3_600_000 },
  { value: '24h', ms: 24 * 3_600_000 },
  { value: '7d', ms: 7 * 86_400_000 },
  { value: '30d', ms: 30 * 86_400_000 },
  { value: '12mo', ms: 365 * 86_400_000 },
];

/** มุมมองหนึ่งชั้น — drill-down คือการซ้อนมุมมองใหม่ทับของเดิม */
export interface ExplorerView {
  preset: RangePreset;
  from: number;
  to: number;
  granularity: SeriesGranularity;
  compare: SeriesCompareMode;
  /** ป้ายบน breadcrumb ของชั้นนี้ — null = ชั้นราก */
  crumb: string | null;
}

export type EventMarkerKind = 'alert' | 'anomaly' | 'command' | 'offline';

/**
 * หมุดเหตุการณ์บนแกนเวลา
 * ★ ช่วยแยกว่ากราฟกระโดดเพราะมีคนสั่งงาน หรือเพราะผิดปกติจริง
 */
export interface EventMarker {
  id: string;
  kind: EventMarkerKind;
  at: number;
  /** ช่วงที่กินเวลา เช่น ช่วง offline — null = เหตุการณ์จุดเดียว */
  until: number | null;
  label: string;
  detail: string | null;
  severity: AlertSeverity | null;
}

/** แถวหนึ่งของกราฟและตาราง — สถิติเลือกตาม kind แล้ว */
export interface ExplorerRow {
  /** ต้นช่วง */
  start: number;
  label: string;
  /** ข้อความช่วงเต็มสำหรับ tooltip เช่น "11 ก.ย. 2569 22:00–23:00" */
  rangeLabel: string;
  /** ค่าหลักที่ใช้วาด — null = ไม่มีข้อมูล ต้องเว้นช่อง ห้ามตกศูนย์ */
  value: number | null;
  /** ขอบล่าง/บนของแถบ min–max — null เมื่อชนิดค่าไม่มีแถบ */
  low: number | null;
  high: number | null;
  /** ค่าของช่วงเทียบที่ตำแหน่งเดียวกัน */
  compareValue: number | null;
  /** 0–1 สัดส่วนตัวอย่างที่ได้จริงเทียบกับที่ควรได้ */
  completeness: number;
  isPartial: boolean;
  /** เจาะลึกลงไปอีกชั้นได้ไหม */
  canDrill: boolean;
}
