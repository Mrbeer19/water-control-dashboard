/** Service: ถังน้ำ 3 ใบ */

import type { MetricKey, Tank, TimeSeriesPoint } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { respond } from './internal';

/**
 * รายการถังทั้งหมดพร้อมค่าล่าสุด
 * TODO(backend): GET /api/tanks
 */
export async function getTanks(): Promise<Tank[]> {
  return respond((state) => state.tanks);
}

/**
 * ถังใบเดียวตาม id
 * TODO(backend): GET /api/tanks/:id
 */
export async function getTank(id: string): Promise<Tank | null> {
  return respond((state) => state.tanks.find((tank) => tank.id === id) ?? null);
}

/**
 * ประวัติระดับน้ำสำหรับกราฟ
 * metric: 'level_percent' | 'level_liters' | 'net_flow_lpm'
 * TODO(backend): GET /api/tanks/:id/history?metric=&from=&to=&interval=
 */
export async function getTankHistory(id: string, metric: MetricKey = 'level_percent'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * ระดับน้ำรวมของทุกถัง ใช้กับตัวเลขใหญ่บนหน้า Overview
 * TODO(backend): GET /api/tanks/summary
 */
export async function getTankTotals(): Promise<{ storedLiters: number; capacityLiters: number; percentFull: number }> {
  return respond((state) => {
    const storedLiters = state.tanks.reduce((sum, tank) => sum + tank.currentLiters, 0);
    const capacityLiters = state.tanks.reduce((sum, tank) => sum + tank.capacityLiters, 0);
    return {
      storedLiters: Math.round(storedLiters),
      capacityLiters,
      percentFull: capacityLiters === 0 ? 0 : Math.round((storedLiters / capacityLiters) * 1000) / 10,
    };
  });
}
