/** Service: รายงาน ค่าน้ำ และการพยากรณ์ */

import type {
  BillingEstimate,
  DailyUsagePoint,
  ReportDefinition,
  ReportFormat,
  ReportRow,
  ReportType,
  TimeRange,
  UsageReport,
  UsageReportRow,
  UtilityKind,
} from '@/lib/types';
import { buildDailyUsage } from '@/lib/mock';
import {
  billingPeriodProgress,
  calculateBillingEstimate,
  calculateStorageDelta,
  calculateUnaccountedWater,
  currentBillingPeriod,
  round,
  splitIntoTiers,
} from '@/lib/utils/calculation';
import { respond } from './internal';

/**
 * ประเมินค่าสาธารณูปโภคของรอบบิลปัจจุบัน
 *
 * utility = 'water'       คิดตามขั้นอัตราของการประปาจากมิเตอร์หลัก
 * utility = 'electricity' คิดจากหน่วยรวมของตู้ไฟทุกแผนก × (อัตรา + Ft)
 *
 * TODO(backend): GET /api/reports/billing?utility=&from=&to=
 */
export async function getBillingEstimate(utility: UtilityKind = 'water'): Promise<BillingEstimate> {
  return respond((state) => {
    const now = new Date();
    const { billing } = state.settings;
    const { start, end } = currentBillingPeriod(now, billing.billingCycleStartDay);
    const progress = billingPeriodProgress(now, billing.billingCycleStartDay);

    if (utility === 'electricity') {
      const totalKwh = state.electricNodes.reduce((sum, node) => sum + node.monthEnergyKwh, 0);
      // ค่าไฟคิดอัตราเดียวต่อหน่วย (ไม่ใช่ขั้นบันไดแบบค่าน้ำ) จึงใช้ tier เดียวครอบทั้งหมด
      const ratePerKwh = billing.electricityRatePerKwh + billing.electricityFtPerKwh;
      return calculateBillingEstimate({
        utility,
        consumedCubicMeters: totalKwh,
        tiers: [
          {
            id: 'tier-electric',
            name: 'ค่าไฟฟ้าเหมาอัตราเดียว',
            nameEn: 'Flat electricity rate',
            minCubicMeters: 0,
            maxCubicMeters: null,
            ratePerCubicMeter: ratePerKwh,
          },
        ],
        serviceChargeBaht: 0,
        vatPercent: billing.vatPercent,
        currency: billing.currency,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        periodProgress: progress,
        previousPeriodTotalBaht: 528_400,
        calculatedAt: now.toISOString(),
      });
    }

    return calculateBillingEstimate({
      utility,
      consumedCubicMeters: state.mainMeter.monthCubicMeters,
      tiers: billing.tiers,
      serviceChargeBaht: billing.serviceChargeBaht,
      vatPercent: billing.vatPercent,
      currency: billing.currency,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      periodProgress: progress,
      // ยอดรอบก่อนหน้าที่หลังบ้านจะดึงจากฐานข้อมูลจริง
      previousPeriodTotalBaht: 41_820,
      calculatedAt: now.toISOString(),
    });
  });
}

/**
 * สร้างรายงานตามชนิดและช่วงเวลา
 * TODO(backend): GET /api/reports?type=&from=&to=
 */
export async function getReport(type: ReportType, range: TimeRange): Promise<ReportDefinition> {
  return respond((state) => {
    const iso = new Date().toISOString();

    const rows: ReportRow[] = state.zones.map((zone) => ({
      label: zone.name,
      labelEn: zone.nameEn,
      values: {
        today: zone.todayCubicMeters,
        month: zone.monthCubicMeters,
        flow: zone.flowLpm,
        quota: zone.dailyQuotaCubicMeters,
      },
    }));

    const totals: ReportRow = {
      label: 'รวมทุกโซน',
      labelEn: 'All zones',
      values: {
        today: round(
          state.zones.reduce((sum, zone) => sum + zone.todayCubicMeters, 0),
          2,
        ),
        month: round(
          state.zones.reduce((sum, zone) => sum + zone.monthCubicMeters, 0),
          2,
        ),
        flow: round(
          state.zones.reduce((sum, zone) => sum + zone.flowLpm, 0),
          1,
        ),
        quota: null,
      },
    };

    return {
      id: `report-${type}-${range.preset}`,
      name: `รายงาน ${type}`,
      createdAt: iso,
      updatedAt: iso,
      type,
      range,
      columns: [
        { key: 'today', label: 'วันนี้', labelEn: 'Today', unit: 'm³', valueType: 'number' },
        { key: 'month', label: 'เดือนนี้', labelEn: 'This month', unit: 'm³', valueType: 'number' },
        { key: 'flow', label: 'อัตราไหลปัจจุบัน', labelEn: 'Current flow', unit: 'L/min', valueType: 'number' },
        { key: 'quota', label: 'โควตา/วัน', labelEn: 'Daily quota', unit: 'm³', valueType: 'number' },
      ],
      rows,
      totals,
      generatedAt: iso,
    };
  });
}

/**
 * ส่งออกรายงานเป็นไฟล์ — หลังบ้านเป็นผู้เรนเดอร์ไฟล์ (ห้ามใช้บริการออนไลน์)
 * TODO(backend): POST /api/reports/export  body: { type, range, format } → 202 + jobId
 * TODO(backend): GET  /api/reports/export/:jobId → ไฟล์เมื่อพร้อม
 */
export async function requestReportExport(
  type: ReportType,
  range: TimeRange,
  format: ReportFormat,
): Promise<{ jobId: string; status: 'queued' }> {
  return respond(() => ({ jobId: `export-${type}-${range.preset}-${format}`, status: 'queued' as const }));
}

/**
 * รายงานการใช้น้ำตามช่วงวันที่ที่ผู้ใช้เลือก พร้อมเทียบช่วงก่อนหน้าที่ยาวเท่ากัน
 *
 * ★ ช่วงเปรียบเทียบคือ "ช่วงก่อนหน้าที่ยาวเท่ากัน" ไม่ใช่ "เดือนที่แล้ว"
 *   ถ้าผู้ใช้เลือก 10 วัน ก็ต้องเทียบกับ 10 วันก่อนหน้า ไม่งั้นตัวเลข % จะไม่มีความหมาย
 *
 * TODO(backend): GET /api/reports/usage?from=&to=
 *   หลังบ้านควรคิดจากข้อมูลที่บันทึกไว้จริงในช่วงนั้น ไม่ใช่ค่าสะสมล่าสุดเหมือน mock นี้
 */
export async function getUsageReport(range: TimeRange): Promise<UsageReport> {
  return respond((state) => {
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    const spanMs = Math.max(86_400_000, to - from);
    const previousRange: TimeRange = {
      preset: 'custom',
      from: new Date(from - spanMs).toISOString(),
      to: new Date(from).toISOString(),
    };

    // ต้องสร้างย้อนหลังให้คลุมทั้งช่วงที่เลือกและช่วงเปรียบเทียบ
    // ไม่งั้นตัวเลข "ช่วงก่อนหน้า" จะเป็นศูนย์ทั้งตาราง
    const spanDays = Math.ceil(spanMs / 86_400_000);
    const daysSinceRangeEnd = Math.max(0, Math.ceil((Date.now() - to) / 86_400_000));
    const allDaily = buildDailyUsage(state, 0, spanDays * 2 + daysSinceRangeEnd + 2);
    const inRange = (point: DailyUsagePoint): boolean => point.timestamp >= from && point.timestamp <= to;
    const inPrevious = (point: DailyUsagePoint): boolean =>
      point.timestamp >= from - spanMs && point.timestamp < from;

    const daily = allDaily.filter(inRange);
    const previousDaily = allDaily.filter(inPrevious);

    const totalCubicMeters = round(daily.reduce((sum, point) => sum + point.cubicMeters, 0), 2);
    const previousTotalCubicMeters = round(
      previousDaily.reduce((sum, point) => sum + point.cubicMeters, 0),
      2,
    );
    const totalCostBaht = round(daily.reduce((sum, point) => sum + point.costBaht, 0), 2);
    const previousTotalCostBaht = round(previousDaily.reduce((sum, point) => sum + point.costBaht, 0), 2);

    // แบ่งยอดรวมลงแต่ละโซนตามสัดส่วนการใช้ล่าสุดของโซนนั้น
    const zoneMonthTotal = state.zones.reduce((sum, zone) => sum + zone.monthCubicMeters, 0);

    /**
     * สัดส่วนของช่วงก่อนหน้าไม่เท่ากับช่วงนี้เป๊ะ ๆ
     *
     * ★ ถ้าใช้สัดส่วนเดียวกันทั้งสองช่วง ทุกโซนจะเปลี่ยนแปลงเป็นเปอร์เซ็นต์เท่ากันหมด
     *   เท่ากับยอดรวม ซึ่งทำให้คอลัมน์ "เปลี่ยนแปลง" ไม่มีข้อมูลอะไรเลย
     *   จึงถ่วงน้ำหนักรายโซนด้วยค่าคงที่ต่อโซน แล้ว normalize ให้ผลรวมยังตรงกับยอดจริง
     */
    const previousWeights = state.zones.map((zone, index) => {
      const share = zoneMonthTotal === 0 ? 0 : zone.monthCubicMeters / zoneMonthTotal;
      // ค่าคงที่ต่อโซน — เลือกจากลำดับโซน จึงได้ผลเดิมทุกครั้งที่เปิดรายงาน
      const drift = 0.86 + ((index * 37) % 29) / 100;
      return share * drift;
    });
    const weightSum = previousWeights.reduce((sum, weight) => sum + weight, 0);

    const rows: UsageReportRow[] = state.zones.map((zone, index) => {
      const share = zoneMonthTotal === 0 ? 0 : zone.monthCubicMeters / zoneMonthTotal;
      const previousShare = weightSum === 0 ? 0 : (previousWeights[index] ?? 0) / weightSum;
      const cubicMeters = round(totalCubicMeters * share, 2);
      const previous = round(previousTotalCubicMeters * previousShare, 2);
      const costBaht = round(
        splitIntoTiers(cubicMeters, state.settings.billing.tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
        2,
      );
      const previousCostBaht = round(
        splitIntoTiers(previous, state.settings.billing.tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
        2,
      );
      return {
        zoneId: zone.id,
        name: zone.name,
        nameEn: zone.nameEn,
        departmentId: zone.departmentId,
        cubicMeters,
        costBaht,
        previousCubicMeters: previous,
        previousCostBaht,
        changePercent: previous === 0 ? 0 : round(((cubicMeters - previous) / previous) * 100, 1),
        sharePercent: round(share * 100, 1),
      };
    });

    return {
      range,
      previousRange,
      rows,
      totalCubicMeters,
      totalCostBaht,
      previousTotalCubicMeters,
      previousTotalCostBaht,
      changePercent:
        previousTotalCubicMeters === 0
          ? 0
          : round(((totalCubicMeters - previousTotalCubicMeters) / previousTotalCubicMeters) * 100, 1),
      unaccounted: calculateUnaccountedWater({
        mainMeter: state.mainMeter,
        zones: state.zones,
        storageDeltaCubicMeters: calculateStorageDelta(state.tanks, state.storageBaselineLiters),
        periodStart: range.from,
        periodEnd: range.to,
        warningPercent: state.settings.thresholds.unaccountedWarningPercent,
        criticalPercent: state.settings.thresholds.unaccountedCriticalPercent,
      }),
      daily,
      generatedAt: new Date().toISOString(),
    };
  });
}
