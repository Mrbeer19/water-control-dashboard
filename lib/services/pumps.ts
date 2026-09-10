/** Service: ปั๊ม 3 ตัว (2 main + 1 VIP) */

import type { MetricKey, Pump, TimeSeriesPoint } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { respond } from './internal';

/**
 * TODO(backend): GET /api/pumps
 */
export async function getPumps(): Promise<Pump[]> {
  return respond((state) => state.pumps);
}

/**
 * TODO(backend): GET /api/pumps/:id
 */
export async function getPump(id: string): Promise<Pump | null> {
  return respond((state) => state.pumps.find((pump) => pump.id === id) ?? null);
}

/**
 * ประวัติค่าไฟฟ้า/อัตราไหลของปั๊ม
 * metric: 'flow_lpm' | 'power_watt' | 'current_amp'
 * TODO(backend): GET /api/pumps/:id/history?metric=&from=&to=&interval=
 */
export async function getPumpHistory(id: string, metric: MetricKey = 'power_watt'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * พลังงานรวมที่ปั๊มทุกตัวใช้วันนี้ (kWh)
 * TODO(backend): GET /api/pumps/energy?period=today
 */
export async function getPumpEnergyToday(): Promise<number> {
  return respond((state) => {
    // mock เก็บ energyKwh เป็นค่าสะสมตลอดอายุ — ประมาณส่วนของวันนี้จากชั่วโมงเดินวันนี้
    const total = state.pumps.reduce((sum, pump) => sum + pump.electrical.powerWatt / 1_000, 0);
    return Math.round(total * 8.4 * 10) / 10;
  });
}
