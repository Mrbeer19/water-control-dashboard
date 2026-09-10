/**
 * การคำนวณกลางของระบบ — ใช้ร่วมกันทั้ง service layer และหน้ารายงาน
 * แยกจาก format.ts เพราะที่นี่คืนตัวเลข ไม่ใช่ข้อความ
 */

import type {
  BillingEstimate,
  BillingTierBreakdown,
  EntityStatus,
  MainMeter,
  Tank,
  ThresholdRange,
  UnaccountedWater,
  UtilityKind,
  WaterTariffTier,
  Zone,
} from '@/lib/types';

/** ปัดทศนิยมแบบคงที่ — กันตัวเลขทศนิยมยาวเกินจากการบวกสะสม */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** เปอร์เซ็นต์ของ value เทียบ total — total เป็น 0 คืน 0 แทนการหารด้วยศูนย์ */
export function percentOf(value: number, total: number): number {
  if (total === 0) return 0;
  return round((value / total) * 100, 2);
}

/** ลิตร → ลูกบาศก์เมตร */
export function litersToCubicMeters(liters: number): number {
  return round(liters / 1_000, 4);
}

/** ลูกบาศก์เมตร → ลิตร */
export function cubicMetersToLiters(cubicMeters: number): number {
  return round(cubicMeters * 1_000, 1);
}

/** L/min × นาที → ลูกบาศก์เมตร */
export function flowToCubicMeters(lpm: number, minutes: number): number {
  return round((lpm * minutes) / 1_000, 4);
}

/** Δ ปริมาณน้ำที่เก็บอยู่ในถังทุกใบ เทียบกับต้นรอบ (m³, บวก = เก็บเพิ่ม) */
export function calculateStorageDelta(tanks: readonly Tank[], baselineLiters: number): number {
  const currentLiters = tanks.reduce((sum, tank) => sum + tank.currentLiters, 0);
  return round((currentLiters - baselineLiters) / 1_000, 3);
}

export interface UnaccountedWaterInput {
  mainMeter: MainMeter;
  zones: readonly Zone[];
  /** Δ ปริมาณในถังช่วงเดียวกัน — ได้จาก calculateStorageDelta() */
  storageDeltaCubicMeters: number;
  periodStart: string;
  periodEnd: string;
  warningPercent: number;
  criticalPercent: number;
}

/**
 * Unaccounted water = มิเตอร์หลัก − Σ 8 โซน − Δ ปริมาณน้ำในถัง
 *
 * ★ ห้ามละ Δstorage ออก: ช่วงที่กำลังเติมถัง น้ำที่ผ่านมิเตอร์หลักยังไม่ถูกใช้
 *   (main − Σzone) จะพุ่งขึ้นและระบบจะเตือนว่ารั่วทั้งที่ปกติ ส่วนช่วงที่ดึงน้ำ
 *   จากถังมาใช้ ผลต่างจะติดลบจนกลบการรั่วจริงที่เกิดขึ้นพร้อมกัน
 */
export function calculateUnaccountedWater(input: UnaccountedWaterInput): UnaccountedWater {
  const { mainMeter, zones, storageDeltaCubicMeters, warningPercent, criticalPercent } = input;

  const mainMeterCubicMeters = round(mainMeter.todayCubicMeters, 2);
  const zoneTotalCubicMeters = round(
    zones.reduce((sum, zone) => sum + zone.todayCubicMeters, 0),
    2,
  );
  const unaccountedCubicMeters = round(
    mainMeterCubicMeters - zoneTotalCubicMeters - storageDeltaCubicMeters,
    2,
  );
  const unaccountedPercent = percentOf(unaccountedCubicMeters, mainMeterCubicMeters);

  let status: EntityStatus = 'ok';
  if (unaccountedPercent >= criticalPercent) status = 'critical';
  else if (unaccountedPercent >= warningPercent) status = 'warning';

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    mainMeterCubicMeters,
    zoneTotalCubicMeters,
    storageDeltaCubicMeters: round(storageDeltaCubicMeters, 2),
    unaccountedCubicMeters,
    unaccountedPercent,
    status,
  };
}

/** แจกแจงปริมาณน้ำลงแต่ละขั้นอัตราแบบขั้นบันได */
export function splitIntoTiers(
  cubicMeters: number,
  tiers: readonly WaterTariffTier[],
): BillingTierBreakdown[] {
  const breakdown: BillingTierBreakdown[] = [];
  let remaining = Math.max(0, cubicMeters);

  for (const tier of tiers) {
    if (remaining <= 0) break;
    // ขั้นบนสุดไม่มีเพดาน — รับส่วนที่เหลือทั้งหมด
    const tierCapacity = tier.maxCubicMeters === null ? remaining : tier.maxCubicMeters - tier.minCubicMeters;
    const consumed = Math.min(remaining, Math.max(0, tierCapacity));
    if (consumed <= 0) continue;

    breakdown.push({
      tierId: tier.id,
      tierName: tier.name,
      cubicMeters: round(consumed, 2),
      ratePerCubicMeter: tier.ratePerCubicMeter,
      amountBaht: round(consumed * tier.ratePerCubicMeter, 2),
    });
    remaining -= consumed;
  }

  return breakdown;
}

export interface BillingEstimateInput {
  utility: UtilityKind;
  consumedCubicMeters: number;
  tiers: readonly WaterTariffTier[];
  serviceChargeBaht: number;
  vatPercent: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  /** สัดส่วนของรอบบิลที่ผ่านไปแล้ว (0–1) ใช้ประมาณยอดสิ้นรอบ */
  periodProgress: number;
  previousPeriodTotalBaht: number;
  calculatedAt: string;
}

/** ประเมินค่าน้ำของรอบบิลปัจจุบัน พร้อมยอดที่คาดว่าจะจบรอบ */
export function calculateBillingEstimate(input: BillingEstimateInput): BillingEstimate {
  const tierBreakdown = splitIntoTiers(input.consumedCubicMeters, input.tiers);
  const subtotalBaht = round(
    tierBreakdown.reduce((sum, tier) => sum + tier.amountBaht, 0),
    2,
  );
  const vatBaht = round(((subtotalBaht + input.serviceChargeBaht) * input.vatPercent) / 100, 2);
  const totalBaht = round(subtotalBaht + input.serviceChargeBaht + vatBaht, 2);

  // ยอดสิ้นรอบ = ปริมาณที่คาดว่าจะใช้ทั้งรอบ คิดผ่านขั้นอัตราอีกครั้ง (ไม่ใช่คูณเชิงเส้นจากยอดปัจจุบัน)
  const progress = Math.min(1, Math.max(0.01, input.periodProgress));
  const projectedCubicMeters = input.consumedCubicMeters / progress;
  const projectedSubtotal = round(
    splitIntoTiers(projectedCubicMeters, input.tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
    2,
  );
  const projectedVat = round(((projectedSubtotal + input.serviceChargeBaht) * input.vatPercent) / 100, 2);
  const projectedTotalBaht = round(projectedSubtotal + input.serviceChargeBaht + projectedVat, 2);

  return {
    utility: input.utility,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    consumedCubicMeters: round(input.consumedCubicMeters, 2),
    tierBreakdown,
    subtotalBaht,
    serviceChargeBaht: input.serviceChargeBaht,
    vatBaht,
    totalBaht,
    currency: input.currency,
    projectedTotalBaht,
    changeFromPreviousPercent:
      input.previousPeriodTotalBaht === 0
        ? 0
        : round(((projectedTotalBaht - input.previousPeriodTotalBaht) / input.previousPeriodTotalBaht) * 100, 1),
    calculatedAt: input.calculatedAt,
  };
}

/** ประเมินสถานะจากค่าวัดและขอบเขตเตือน — ตรรกะเดียวกับที่ simulator ใช้ */
export function evaluateThreshold(value: number, range: ThresholdRange): EntityStatus {
  if (range.criticalLow !== null && value <= range.criticalLow) return 'critical';
  if (range.criticalHigh !== null && value >= range.criticalHigh) return 'critical';
  if (range.warningLow !== null && value <= range.warningLow) return 'warning';
  if (range.warningHigh !== null && value >= range.warningHigh) return 'warning';
  return 'ok';
}

/** สัดส่วนของรอบบิลที่ผ่านไปแล้ว (0–1) นับจากวันเริ่มรอบที่ตั้งไว้ */
export function billingPeriodProgress(now: Date, cycleStartDay: number): number {
  const start = new Date(now.getFullYear(), now.getMonth(), cycleStartDay);
  if (start.getTime() > now.getTime()) {
    start.setMonth(start.getMonth() - 1);
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, cycleStartDay);
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / total));
}

/** ขอบเขตรอบบิลปัจจุบัน */
export function currentBillingPeriod(now: Date, cycleStartDay: number): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), cycleStartDay);
  if (start.getTime() > now.getTime()) {
    start.setMonth(start.getMonth() - 1);
  }
  const end = new Date(start.getFullYear(), start.getMonth() + 1, cycleStartDay);
  return { start, end };
}
