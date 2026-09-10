/** Service: รายงาน ค่าน้ำ และการพยากรณ์ */

import type {
  BillingEstimate,
  ReportDefinition,
  ReportFormat,
  ReportRow,
  ReportType,
  TimeRange,
  UtilityKind,
} from '@/lib/types';
import {
  billingPeriodProgress,
  calculateBillingEstimate,
  currentBillingPeriod,
  round,
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
