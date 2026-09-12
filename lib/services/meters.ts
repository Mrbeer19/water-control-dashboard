/** Service: มิเตอร์น้ำรายโซน + มิเตอร์หลักจากการประปา */

import type { DailyUsagePoint, MainMeter, MetricKey, TimeSeriesPoint, UnaccountedWater, WaterMeter } from '@/lib/types';
import { buildDailyUsage, DAILY_HISTORY_DAYS, daysRemainingInMonth, readHistory } from '@/lib/mock';
import { calculateStorageDelta, calculateUnaccountedWater, currentBillingPeriod } from '@/lib/utils/calculation';
import { respond } from './internal';

/**
 * มิเตอร์ประจำโซนทั้ง 8 ตัว
 * TODO(backend): GET /api/meters
 */
export async function getZoneMeters(): Promise<WaterMeter[]> {
  return respond((state) => state.zoneMeters);
}

/**
 * มิเตอร์หลักที่รับน้ำจากการประปา (ท่อ 2")
 * TODO(backend): GET /api/meters/main
 */
export async function getMainMeter(): Promise<MainMeter> {
  return respond((state) => state.mainMeter);
}

/**
 * TODO(backend): GET /api/meters/:id/history?metric=flow_lpm&from=&to=&interval=
 */
export async function getMeterHistory(id: string, metric: MetricKey = 'flow_lpm'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * Unaccounted water = มิเตอร์หลัก − ผลรวมทุกโซน − Δ ถัง (ตัวชี้วัดการรั่ว)
 * TODO(backend): GET /api/meters/unaccounted?from=&to=
 */
export async function getUnaccountedWater(): Promise<UnaccountedWater> {
  return respond((state) => {
    const { start, end } = currentBillingPeriod(new Date(), state.settings.billing.billingCycleStartDay);
    return calculateUnaccountedWater({
      mainMeter: state.mainMeter,
      zones: state.zones,
      // หัก Δ ปริมาณในถังออก ไม่งั้นช่วงเติมถังจะขึ้นแดงว่ารั่วทั้งที่ปกติ
      storageDeltaCubicMeters: calculateStorageDelta(state.tanks, state.storageBaselineLiters),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      warningPercent: state.settings.thresholds.unaccountedWarningPercent,
      criticalPercent: state.settings.thresholds.unaccountedCriticalPercent,
    });
  });
}

/**
 * อัตราไหลเข้า/ออกรวม ใช้กับ infographic หน้าแผนผังการไหล
 * TODO(backend): GET /api/meters/balance
 */
export async function getFlowBalance(): Promise<{ inflowLpm: number; outflowLpm: number }> {
  return respond((state) => ({
    inflowLpm: state.mainMeter.flowLpm,
    outflowLpm: Math.round(state.zones.reduce((sum, zone) => sum + zone.flowLpm, 0) * 10) / 10,
  }));
}

/**
 * ยอดใช้น้ำรายวันย้อนหลัง (ค่าตั้งต้น 30 วัน)
 * ส่ง includeProjection = true เพื่อต่อส่วนที่ AI พยากรณ์ไปจนสิ้นเดือน
 * (จุดที่พยากรณ์จะมี projected = true และไม่มีค่าอุณหภูมิ/ฝน)
 *
 * @param historyDays จำนวนวันย้อนหลังที่ต้องการ — หน้าต่าง "ดูข้อมูลละเอียด" ขอยาวถึง 400 วัน
 *                    เพื่อให้สรุปรายเดือนและรายปีมีข้อมูลพอ
 *
 * TODO(backend): GET /api/meters/daily?from=&to=&projection=
 *   `historyDays` ควรกลายเป็น from/to และให้เซิร์ฟเวอร์เป็นคนรวมยอดรายเดือน/รายปีให้
 *   ไม่ใช่ส่งรายวัน 400 จุดมาให้หน้าจอรวมเอง
 */
export async function getDailyUsage(
  includeProjection = false,
  historyDays: number = DAILY_HISTORY_DAYS,
): Promise<DailyUsagePoint[]> {
  return respond((state) =>
    buildDailyUsage(state, includeProjection ? daysRemainingInMonth() : 0, historyDays),
  );
}
