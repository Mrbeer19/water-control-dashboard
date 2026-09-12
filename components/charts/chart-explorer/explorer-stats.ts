/**
 * สถิติของชุดข้อมูล — เลือกตาม kind ที่หลังบ้านส่งมา
 *
 * ★★ ที่เดียวที่ตัดสินว่า "ค่าแบบนี้สรุปยังไง" ★★
 *   ห้ามมี if (metric === 'temperature') ใน component — ถามไฟล์นี้แทน
 * ★ อุณหภูมิ/ความชื้น/แรงดัน เป็น gauge จึงไม่มีคำว่า "รวม" ให้เลือกได้เลย
 *   ไม่ใช่ซ่อนการ์ด แต่ชุดการ์ดของ gauge ไม่มีรายการนั้นอยู่ตั้งแต่แรก
 */
import type { AggregatedSeriesPoint, MetricKind, SeriesGranularity } from '@/lib/types';
import { NO_DATA_STATE } from '@/lib/types';
import type { Dictionary } from '@/lib/i18n';
import { bucketLabel, bucketRangeLabel } from './explorer-labels';
import type { ExplorerRow } from './explorer-types';

/** หน่วยของตัวเลขในการ์ดสรุป — บอกว่าจะจัดรูปแบบด้วยอะไร */
export type StatUnit = 'metric' | 'hours' | 'count';

export interface SummaryStat {
  /** คีย์ใน dictionary หมวด chart */
  labelKey: keyof Dictionary['chart'];
  value: number | null;
  unit: StatUnit;
  /** เวลาที่เกิดค่านี้ — แสดงเป็นบรรทัดรองใต้ตัวเลข (null = ไม่เกี่ยวกับเวลาจุดใดจุดหนึ่ง) */
  at: number | null;
  /** ช่วงที่เกิดค่านี้ ใช้กับ "ช่วงที่มากที่สุด" ซึ่งชี้ไปที่ bucket ไม่ใช่วินาที */
  atBucket: number | null;
}

/** สถานะที่ถือว่าปั๊ม "เดินอยู่" — ชื่อสถานะเป็น string เปิดตามสัญญาใน lib/types.ts */
const RUNNING_STATE = 'running';

function sum(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  return real.length === 0 ? null : real.reduce((a, b) => a + b, 0);
}

/**
 * การ์ดสรุปของช่วงที่เลือก
 * ★ ค่าเฉลี่ยของ gauge ต้องถ่วงน้ำหนักด้วยจำนวนตัวอย่างจริง
 *   ไม่ใช่เฉลี่ยของค่าเฉลี่ยรายชั่วโมง เพราะชั่วโมงที่ข้อมูลขาดจะถูกนับเท่าชั่วโมงเต็ม
 */
export function summarize(points: AggregatedSeriesPoint[], kind: MetricKind): SummaryStat[] {
  if (kind === 'gauge') {
    let weighted = 0;
    let weight = 0;
    let min: number | null = null;
    let minAt: number | null = null;
    let max: number | null = null;
    let maxAt: number | null = null;
    for (const point of points) {
      if (point.kind !== 'gauge') continue;
      if (point.avg !== null && point.count > 0) {
        weighted += point.avg * point.count;
        weight += point.count;
      }
      if (point.min !== null && (min === null || point.min < min)) {
        min = point.min;
        minAt = point.minAt ?? point.timestamp;
      }
      if (point.max !== null && (max === null || point.max > max)) {
        max = point.max;
        maxAt = point.maxAt ?? point.timestamp;
      }
    }
    return [
      { labelKey: 'statAvg', value: weight === 0 ? null : weighted / weight, unit: 'metric', at: null, atBucket: null },
      { labelKey: 'statMin', value: min, unit: 'metric', at: minAt, atBucket: null },
      { labelKey: 'statMax', value: max, unit: 'metric', at: maxAt, atBucket: null },
    ];
  }

  if (kind === 'counter' || kind === 'amount') {
    const values = points.map((p) =>
      p.kind === 'counter' ? p.delta : p.kind === 'amount' ? p.sum : null,
    );
    const total = sum(values);
    const filled = values.filter((v): v is number => v !== null);
    let peak: number | null = null;
    let peakAt: number | null = null;
    points.forEach((point, index) => {
      const value = values[index];
      if (value === undefined || value === null) return;
      if (peak === null || value > peak) {
        peak = value;
        peakAt = point.timestamp;
      }
    });
    return [
      { labelKey: 'statSum', value: total, unit: 'metric', at: null, atBucket: null },
      {
        labelKey: 'statPerBucket',
        value: total === null || filled.length === 0 ? null : total / filled.length,
        unit: 'metric',
        at: null,
        atBucket: null,
      },
      { labelKey: 'statPeak', value: peak, unit: 'metric', at: null, atBucket: peakAt },
    ];
  }

  if (kind === 'level') {
    let last: number | null = null;
    let min: number | null = null;
    let max: number | null = null;
    for (const point of points) {
      if (point.kind !== 'level') continue;
      if (point.last !== null) last = point.last;
      if (point.min !== null && (min === null || point.min < min)) min = point.min;
      if (point.max !== null && (max === null || point.max > max)) max = point.max;
    }
    return [
      { labelKey: 'statLast', value: last, unit: 'metric', at: null, atBucket: null },
      { labelKey: 'statMin', value: min, unit: 'metric', at: null, atBucket: null },
      { labelKey: 'statMax', value: max, unit: 'metric', at: null, atBucket: null },
    ];
  }

  // state — ชั่วโมงเดินเครื่อง / จำนวนครั้งที่สตาร์ท / ชั่วโมงหยุด
  let runMs = 0;
  let otherMs = 0;
  let starts = 0;
  for (const point of points) {
    if (point.kind !== 'state') continue;
    for (const [state, ms] of Object.entries(point.durationsMs)) {
      if (ms === undefined) continue;
      if (state === RUNNING_STATE) runMs += ms;
      else if (state !== NO_DATA_STATE) otherMs += ms;
    }
    starts += point.entries[RUNNING_STATE] ?? 0;
  }
  return [
    { labelKey: 'statRunHours', value: runMs / 3_600_000, unit: 'hours', at: null, atBucket: null },
    { labelKey: 'statStarts', value: starts, unit: 'count', at: null, atBucket: null },
    { labelKey: 'statOffHours', value: otherMs / 3_600_000, unit: 'hours', at: null, atBucket: null },
  ];
}

/** ค่าหลักที่ใช้วาดกราฟและใช้เทียบช่วง — null เมื่อ bucket นั้นไม่มีข้อมูล */
export function primaryValue(point: AggregatedSeriesPoint): number | null {
  switch (point.kind) {
    case 'gauge':
      return point.avg;
    case 'counter':
      return point.delta;
    case 'amount':
      return point.sum;
    case 'level':
      return point.last;
    case 'state':
      return (point.durationsMs[RUNNING_STATE] ?? 0) / 3_600_000;
  }
}

function band(point: AggregatedSeriesPoint): { low: number | null; high: number | null } {
  if (point.kind === 'gauge' || point.kind === 'level') {
    return { low: point.min, high: point.max };
  }
  return { low: null, high: null };
}

/**
 * แปลง bucket จากหลังบ้านเป็นแถวสำหรับกราฟและตาราง
 * ★ bucket ที่ไม่มีข้อมูลต้องคง value เป็น null ไม่ใช่ 0
 *   กราฟจะได้เว้นช่องว่างให้เห็นว่าเซนเซอร์ขาด ไม่ใช่แสดงเป็น "ใช้น้ำ 0"
 */
export function toRows(
  points: AggregatedSeriesPoint[],
  comparePoints: AggregatedSeriesPoint[] | null,
  granularity: SeriesGranularity,
  timeZone: string,
  locale: 'th' | 'en',
  canDrill: boolean,
): ExplorerRow[] {
  return points.map((point, index) => {
    const { low, high } = band(point);
    const comparePoint = comparePoints?.[index];
    return {
      start: point.timestamp,
      label: bucketLabel(point.timestamp, granularity, timeZone, locale),
      rangeLabel: bucketRangeLabel(point.timestamp, granularity, timeZone, locale),
      value: primaryValue(point),
      low,
      high,
      compareValue: comparePoint === undefined ? null : primaryValue(comparePoint),
      completeness:
        point.expectedCount <= 0 ? 1 : Math.min(1, point.count / point.expectedCount),
      isPartial: point.isPartial,
      canDrill,
    };
  });
}

/**
 * ตัวเลขที่ใช้เทียบสองช่วง — counter/amount เทียบยอดรวม ที่เหลือเทียบค่าเฉลี่ย
 * คืน null เมื่อฝั่งใดฝั่งหนึ่งไม่มีข้อมูล หรือฐานเป็นศูนย์ (หารไม่ได้)
 */
export function percentChange(
  points: AggregatedSeriesPoint[],
  comparePoints: AggregatedSeriesPoint[],
  kind: MetricKind,
): number | null {
  const reduce = (list: AggregatedSeriesPoint[]): number | null => {
    const values = list.map(primaryValue).filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    const total = values.reduce((a, b) => a + b, 0);
    if (kind === 'counter' || kind === 'amount' || kind === 'state') return total;
    return total / values.length;
  };
  const now = reduce(points);
  const before = reduce(comparePoints);
  if (now === null || before === null || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}
