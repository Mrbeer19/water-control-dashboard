/** Service: โซนการใช้น้ำ 8 โซน */

import type { MetricKey, TimeSeriesPoint, Valve, Zone } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { respond } from './internal';

/**
 * TODO(backend): GET /api/zones
 */
export async function getZones(): Promise<Zone[]> {
  return respond((state) => state.zones);
}

/**
 * TODO(backend): GET /api/zones/:id
 */
export async function getZone(id: string): Promise<Zone | null> {
  return respond((state) => state.zones.find((zone) => zone.id === id) ?? null);
}

/**
 * วาล์วไฟฟ้าของทุกโซน
 * TODO(backend): GET /api/valves
 */
export async function getValves(): Promise<Valve[]> {
  return respond((state) => state.valves);
}

/**
 * TODO(backend): GET /api/zones/:id/history?metric=flow_lpm&from=&to=&interval=
 */
export async function getZoneHistory(id: string, metric: MetricKey = 'flow_lpm'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * ปริมาณการใช้รายโซนสำหรับกราฟเปรียบเทียบ
 * TODO(backend): GET /api/zones/consumption?period=today
 */
export async function getZoneConsumption(
  period: 'today' | 'month' = 'today',
): Promise<{ zoneId: string; name: string; cubicMeters: number }[]> {
  return respond((state) =>
    state.zones.map((zone) => ({
      zoneId: zone.id,
      name: zone.name,
      cubicMeters: period === 'today' ? zone.todayCubicMeters : zone.monthCubicMeters,
    })),
  );
}
