/**
 * ยอดรวมรายวันย้อนหลัง ใช้กับกราฟบนหน้า Overview
 *
 * simulator เดินแบบวินาทีต่อวินาที จึงสร้างประวัติรายวันย้อนหลังไม่ได้ในตัว
 * ไฟล์นี้จึงสังเคราะห์ย้อนหลังจาก seed คงที่ ให้กราฟมีรูปทรงเหมือนโรงงานจริง
 * (วันหยุดใช้น้ำน้อยลง วันที่ร้อนใช้น้ำมากขึ้น วันฝนตกใช้น้ำน้อยลง)
 */

import type { DailyUsagePoint } from '@/lib/types';
import type { MockState } from './store';
import { createRng, roundTo } from './random';
import { splitIntoTiers } from '@/lib/utils/calculation';

/** จำนวนวันย้อนหลังตั้งต้น */
export const DAILY_HISTORY_DAYS = 30;

/** เพดานที่ยอมสร้างย้อนหลัง กันการขอช่วงยาวจนสร้างข้อมูลเกินจำเป็น */
const MAX_HISTORY_DAYS = 400;

/** เที่ยงคืนของวันที่ห่างจากวันนี้ n วัน */
function midnightOffset(daysAgo: number): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * ยอดใช้น้ำรายวันย้อนหลัง + ส่วนที่พยากรณ์ไปจนสิ้นเดือน
 *
 * @param projectedDays จำนวนวันข้างหน้าที่ให้ AI พยากรณ์ต่อ (0 = เอาแต่ของจริง)
 * @param historyDays  จำนวนวันย้อนหลังที่ต้องการ — รายงานที่เทียบช่วงก่อนหน้าต้องขอ
 *                     ยาวเป็นสองเท่าของช่วงที่เลือก ไม่งั้นช่วงเปรียบเทียบจะไม่มีข้อมูล
 */
export function buildDailyUsage(
  state: MockState,
  projectedDays = 0,
  historyDays: number = DAILY_HISTORY_DAYS,
): DailyUsagePoint[] {
  // seed คงที่ ทำให้กราฟไม่กระโดดใหม่ทุกครั้งที่ re-render
  const rng = createRng(770412);
  const { billing } = state.settings;

  // ฐานรายวันมาจากอัตราไหลจริงของ 8 โซนตอนนี้ คูณ 24 ชม.
  const baselinePerDay = state.zones.reduce((sum, zone) => sum + zone.flowLpm, 0) * 60 * 24 * 0.001;
  const base = baselinePerDay > 0 ? baselinePerDay : 240;

  const points: DailyUsagePoint[] = [];

  const days = Math.min(MAX_HISTORY_DAYS, Math.max(1, Math.round(historyDays)));
  for (let index = days - 1; index >= -projectedDays; index -= 1) {
    const date = midnightOffset(index);
    const projected = index < 0;
    const weekday = date.getDay();

    // เสาร์-อาทิตย์เดินสายการผลิตน้อยลง
    const weekendFactor = weekday === 0 ? 0.52 : weekday === 6 ? 0.71 : 1;
    // คลื่นตามฤดู + สุ่มรายวันเล็กน้อย
    const seasonal = 1 + Math.sin((index / 30) * Math.PI * 1.4) * 0.08;
    const noise = 0.94 + rng() * 0.12;

    // วันฝนตกใช้น้ำล้างพื้นน้อยลง และอุณหภูมิต่ำลง
    const rainy = rng() < 0.22;
    const rainfallMm = rainy ? roundTo(rng() * 26 + 1.5, 1) : 0;
    const avgTemperatureCelsius = roundTo(31.4 - (rainy ? 2.6 : 0) + (seasonal - 1) * 16 + (rng() - 0.5) * 1.8, 1);
    const rainFactor = rainy ? 0.93 : 1;

    // ยิ่งร้อนยิ่งใช้น้ำมาก (หล่อเย็น + ล้างตัว)
    const heatFactor = 1 + (avgTemperatureCelsius - 31) * 0.022;

    const cubicMeters = roundTo(base * weekendFactor * seasonal * noise * rainFactor * heatFactor, 2);
    const costBaht = roundTo(
      splitIntoTiers(cubicMeters, billing.tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
      2,
    );

    points.push({
      date: toDateKey(date),
      timestamp: date.getTime(),
      cubicMeters,
      costBaht,
      // วันที่ยังไม่เกิดไม่มีค่าวัดจากเซนเซอร์
      avgTemperatureCelsius: projected ? null : avgTemperatureCelsius,
      rainfallMm: projected ? null : rainfallMm,
      projected,
    });
  }

  return points;
}

/** จำนวนวันที่เหลือจนสิ้นเดือนปัจจุบัน */
export function daysRemainingInMonth(now: Date = new Date()): number {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(0, lastDay - now.getDate());
}
