/** Service: มิเตอร์น้ำ 8 โซน + มิเตอร์หลักจากการประปา */

import type { MainMeter, MetricKey, TimeSeriesPoint, UnaccountedWater, WaterMeter } from '@/lib/types';
import { readHistory } from '@/lib/mock';
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
 * Unaccounted water = มิเตอร์หลัก − ผลรวม 8 โซน (ตัวชี้วัดการรั่ว)
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
