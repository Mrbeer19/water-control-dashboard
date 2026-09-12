/** Service: โซนการใช้น้ำ (จำนวนโซนไม่ตายตัว อ่านจากข้อมูลจริง) */

import type { MetricKey, TimeSeriesPoint, Valve, Zone, ZoneCost } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { round, splitIntoTiers } from '@/lib/utils/calculation';
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

/**
 * ค่าน้ำโดยประมาณรายโซนในรอบบิลนี้ + สัดส่วนการใช้เทียบทั้งโรงงาน
 *
 * ★ คิดค่าน้ำจากขั้นอัตราของปริมาณเฉพาะโซนนั้น ไม่ใช่เฉลี่ยจากบิลรวม
 *   ตัวเลขจึงเป็น "ประมาณการเพื่อเปรียบเทียบ" ผลรวมทุกโซนจะไม่เท่าบิลจริงเป๊ะ
 *   เพราะการประปาคิดขั้นบันไดจากยอดรวมของทั้งโรงงานครั้งเดียว
 *
 * TODO(backend): GET /api/zones/cost?from=&to=
 */
export async function getZoneCosts(): Promise<ZoneCost[]> {
  return respond((state) => {
    const { tiers } = state.settings.billing;
    const totalCubicMeters = state.zones.reduce((sum, zone) => sum + zone.monthCubicMeters, 0);

    return state.zones.map((zone) => ({
      zoneId: zone.id,
      name: zone.name,
      nameEn: zone.nameEn,
      departmentId: zone.departmentId,
      cubicMeters: round(zone.monthCubicMeters, 2),
      costBaht: round(
        splitIntoTiers(zone.monthCubicMeters, tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
        2,
      ),
      sharePercent: totalCubicMeters === 0 ? 0 : round((zone.monthCubicMeters / totalCubicMeters) * 100, 1),
    }));
  });
}
