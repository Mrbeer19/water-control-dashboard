/**
 * Service: ระบบควบคุมแรงดันน้ำ
 * ฮาร์ดแวร์: S7-1200 + SM1231 (AI 4–20 mA) + pressure transmitter + VFD ที่ปั๊ม
 */

import type { MetricKey, PressureControl, TimeSeriesPoint } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { respond } from './internal';

/**
 * TODO(backend): GET /api/pressure
 */
export async function getPressureControl(): Promise<PressureControl> {
  return respond((state) => state.pressureControl);
}

/**
 * TODO(backend): GET /api/pressure/history?metric=pressure_bar&from=&to=&interval=
 */
export async function getPressureHistory(metric: MetricKey = 'pressure_bar'): Promise<TimeSeriesPoint[]> {
  return respond((state) => readHistory(state.pressureControl.id, metric));
}

/**
 * จำนวนคนในพื้นที่ล่าสุดจากระบบนับคน ใช้ปรับ setpoint อัตโนมัติ
 * TODO(backend): GET /api/pressure/headcount
 */
export async function getHeadcount(): Promise<{ headcount: number | null; updatedAt: string | null }> {
  return respond((state) => ({
    headcount: state.pressureControl.headcount,
    updatedAt: state.pressureControl.headcountUpdatedAt,
  }));
}
