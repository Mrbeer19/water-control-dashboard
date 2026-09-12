/**
 * ยอดรวมรายวันย้อนหลัง ใช้กับกราฟบนหน้า Overview
 *
 * simulator เดินแบบวินาทีต่อวินาที จึงสร้างประวัติรายวันย้อนหลังไม่ได้ในตัว
 * ไฟล์นี้จึงสังเคราะห์ย้อนหลังจาก seed คงที่ ให้กราฟมีรูปทรงเหมือนโรงงานจริง
 * (วันหยุดใช้น้ำน้อยลง วันที่ร้อนใช้น้ำมากขึ้น วันฝนตกใช้น้ำน้อยลง)
 */

import type { DailyUsagePoint, MeterReading, MonthlyUsagePoint } from '@/lib/types';
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

  // ฐานรายวันมาจากอัตราไหลจริงของทุกโซนตอนนี้ คูณ 24 ชม.
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

// ─────────────────────────────────────────────────────────────
// ยอดรายเดือนและการจดมิเตอร์
// ─────────────────────────────────────────────────────────────

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** จำนวนวันในเดือนนั้น */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * ยอดใช้น้ำรายเดือนย้อนหลัง พร้อมเปอร์เซ็นต์เทียบเดือนก่อนหน้า
 *
 * ★ เดือนปัจจุบันยังไม่จบ จึงถูกทำเครื่องหมาย partial ไว้
 *   ถ้าเอาไปเทียบกับเดือนเต็มตรง ๆ จะดูเหมือนใช้น้ำลดลงฮวบทั้งที่แค่ยังไม่ครบเดือน
 */
export function buildMonthlyUsage(state: MockState, months = 12): MonthlyUsagePoint[] {
  const rng = createRng(915237);
  const { billing } = state.settings;

  const baselinePerDay = state.zones.reduce((sum, zone) => sum + zone.flowLpm, 0) * 60 * 24 * 0.001;
  const base = baselinePerDay > 0 ? baselinePerDay : 240;

  const now = new Date();
  const points: MonthlyUsagePoint[] = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = cursor.getFullYear();
    const monthIndex = cursor.getMonth();
    const partial = offset === 0;
    // เดือนที่ยังไม่จบนับเฉพาะวันที่ผ่านมาแล้ว
    const daysCounted = partial ? now.getDate() : daysInMonth(year, monthIndex);

    // ฤดูร้อน (มี.ค.–พ.ค.) ใช้น้ำมากกว่า หน้าฝนใช้น้อยลง
    const seasonal = 1 + Math.sin(((monthIndex - 1) / 12) * Math.PI * 2) * 0.11;
    const noise = 0.95 + rng() * 0.1;
    const cubicMeters = roundTo(base * daysCounted * seasonal * noise, 2);
    const costBaht = roundTo(
      splitIntoTiers(cubicMeters, billing.tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
      2,
    );

    const readingDay = Math.min(billing.meterReadingDay, daysInMonth(year, monthIndex));
    const readingAt = new Date(year, monthIndex, readingDay, 9, 30);
    // ยังไม่ถึงวันจดของเดือนนี้ก็ยังไม่มีวันที่จด
    const readingDate = readingAt.getTime() <= now.getTime() ? readingAt.toISOString() : null;

    const previous = points[points.length - 1];
    points.push({
      month: `${year}-${`${monthIndex + 1}`.padStart(2, '0')}`,
      label: `${TH_MONTHS[monthIndex] ?? ''} ${`${(year + 543) % 100}`.padStart(2, '0')}`,
      labelEn: `${EN_MONTHS[monthIndex] ?? ''} ${`${year % 100}`.padStart(2, '0')}`,
      timestamp: cursor.getTime(),
      cubicMeters,
      costBaht,
      changeFromPreviousPercent:
        previous === undefined || previous.cubicMeters === 0
          ? null
          : roundTo(((cubicMeters - previous.cubicMeters) / previous.cubicMeters) * 100, 1),
      readingDate,
      partial,
    });
  }

  return points;
}

/**
 * ประวัติการจดมิเตอร์ของการประปา
 * เลขหน้าปัดไล่ขึ้นจากอดีตมาจนถึงค่าปัจจุบันของมิเตอร์หลัก
 */
export function buildMeterReadings(state: MockState, months = 12): MeterReading[] {
  const monthly = buildMonthlyUsage(state, months).filter((point) => point.readingDate !== null);

  // ไล่ย้อนจากเลขหน้าปัดปัจจุบัน เพื่อให้ค่าล่าสุดตรงกับมิเตอร์จริง
  const totalUnits = monthly.reduce((sum, point) => sum + point.cubicMeters, 0);
  let running = state.mainMeter.totalizerCubicMeters - totalUnits;

  return monthly
    .map((point, index) => {
      running += point.cubicMeters;
      const readingDate = point.readingDate ?? new Date().toISOString();
      const previousDate = monthly[index - 1]?.readingDate;
      const periodDays =
        previousDate === undefined || previousDate === null
          ? 30
          : Math.max(
              1,
              Math.round((new Date(readingDate).getTime() - new Date(previousDate).getTime()) / 86_400_000),
            );

      const reading: MeterReading = {
        id: `reading-${point.month}`,
        name: `จดมิเตอร์ ${point.label}`,
        createdAt: readingDate,
        updatedAt: readingDate,
        meterId: state.mainMeter.id,
        meterName: state.mainMeter.name,
        readingDate,
        totalizerCubicMeters: roundTo(running, 2),
        unitsUsed: point.cubicMeters,
        costBaht: point.costBaht,
        source: 'utility',
        readBy: 'เจ้าหน้าที่การประปา',
        periodDays,
        note: null,
      };
      return reading;
    })
    .reverse();
}
