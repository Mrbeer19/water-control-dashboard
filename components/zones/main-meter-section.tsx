'use client';

import { Droplets, Info, TrendingDown } from 'lucide-react';
import type { Locale, MainMeter, TimeSeriesPoint, UnaccountedWater } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getMainMeter, getMeterHistory, getUnaccountedWater } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatCubicMeters, formatFlow, formatNumber, formatPercent, formatPressure, STATUS_TEXT_CLASS } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sparkline } from '@/components/charts/sparkline';
import { CHART } from '@/components/charts/chart-tokens';

interface MainMeterData {
  meter: MainMeter;
  unaccounted: UnaccountedWater;
  history: TimeSeriesPoint[];
}

/** 1.4 — มิเตอร์หลักและน้ำสูญหาย */
export function MainMeterSection(): JSX.Element {
  const { t, locale } = useLocale();
  const { data, loading } = useLiveData<MainMeterData>(async () => {
    const [meter, unaccounted] = await Promise.all([getMainMeter(), getUnaccountedWater()]);
    const history = await getMeterHistory(meter.id, 'flow_lpm');
    return { meter, unaccounted, history };
  }, []);

  if (loading && data === null) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[188px] rounded-lg lg:col-span-2" />
        <Skeleton className="h-[188px] rounded-lg" />
      </div>
    );
  }

  if (data === null) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm font-medium">{t.common.empty}</p>
        </CardContent>
      </Card>
    );
  }

  const { meter, unaccounted, history } = data;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{locale === 'th' ? meter.name : meter.nameEn}</p>
              <p className="truncate text-xs text-muted-foreground">
                {locale === 'th' ? meter.supplierName : meter.supplierNameEn} · {meter.supplierMeterNo} · {meter.pipeSizeInches}&quot;
              </p>
            </div>
            <StatusBadge status={meter.status} />
          </div>

          {/* ตัวเลขใหญ่ชุดหลัก — ต้องอ่านได้จากกลางห้องคอนโทรล */}
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] text-muted-foreground">{t.meter.totalizer}</p>
              <p className="tabular text-metric leading-none">{formatNumber(meter.totalizerCubicMeters, locale, 0)}</p>
              <p className="text-[11px] text-muted-foreground">m³</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{t.meter.unitsThisMonth}</p>
              <p className="tabular text-metric leading-none">{formatNumber(meter.monthCubicMeters, locale, 0)}</p>
              <p className="text-[11px] text-muted-foreground">{t.zone.units}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{t.meter.flowNow}</p>
              <p className="tabular text-metric leading-none text-water">{formatNumber(meter.flowLpm, locale, 0)}</p>
              <p className="text-[11px] text-muted-foreground">L/min</p>
            </div>
          </div>

          <div className="mt-3 border-t pt-3">
            <Sparkline points={history} color={CHART.water} height={44} label={t.meter.flowNow} />
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-[10px] text-muted-foreground">{t.meter.inToday}</dt>
              <dd className="tabular font-medium">{formatCubicMeters(meter.todayCubicMeters, locale)}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-muted-foreground">{t.meter.inMonth}</dt>
              <dd className="tabular font-medium">{formatCubicMeters(meter.monthCubicMeters, locale)}</dd>
            </div>
            <div>
              <dt className="text-[10px] text-muted-foreground">{t.meter.inletPressure}</dt>
              <dd className="tabular font-medium">{formatPressure(meter.inletPressureBar, locale)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* น้ำสูญหาย — ตัวชี้วัดการรั่วหลักของระบบ */}
      <Card className={cn(unaccounted.status !== 'ok' && 'border-status-warning/40')}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 font-semibold leading-tight">
              <TrendingDown className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t.meter.unaccounted}
            </p>
            <StatusBadge status={unaccounted.status} />
          </div>

          <p className={cn('tabular mt-3 text-metric leading-none', STATUS_TEXT_CLASS[unaccounted.status])}>
            {formatPercent(unaccounted.unaccountedPercent, locale, 1)}
          </p>
          <p className="tabular mt-1 text-sm font-medium">
            {formatCubicMeters(unaccounted.unaccountedCubicMeters, locale)}
          </p>

          <dl className="mt-3 space-y-1 border-t pt-3 text-xs">
            <Line label={t.overview.mainMeter} value={formatCubicMeters(unaccounted.mainMeterCubicMeters, locale)} />
            <Line label={t.meter.zoneTotal} value={signed(-unaccounted.zoneTotalCubicMeters, locale)} />
            <Line label={t.meter.storageDelta} value={signed(-unaccounted.storageDeltaCubicMeters, locale)} />
          </dl>

          <p className="mt-2.5 flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {t.meter.unaccountedHint}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * แสดงพจน์ที่ถูกหักออกจากมิเตอร์หลัก พร้อมเครื่องหมายที่ถูกต้อง
 * Δstorage ติดลบได้ (ถังพร่องลง) ซึ่งกลายเป็นการ "บวกกลับ" — ต้องขึ้น + ไม่ใช่ −
 */
function signed(value: number, locale: Locale): string {
  const sign = value < 0 ? '−' : '+';
  return `${sign} ${formatCubicMeters(Math.abs(value), locale)}`;
}

function Line({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="tabular shrink-0 font-medium">{value}</dd>
    </div>
  );
}
