'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';
import type { BillingEstimate, DailyUsagePoint, ZoneCost } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getBillingEstimate, getDailyUsage, getZoneCosts } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatBaht, formatCubicMeters, formatPercent } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DailyUsageChart } from './daily-usage-chart';
import { ZoneCostChart } from './zone-cost-chart';

interface BillingData {
  estimate: BillingEstimate;
  costs: ZoneCost[];
  daily: DailyUsagePoint[];
}

/** 1.5 — ค่าน้ำที่ AI พยากรณ์เดือนนี้ */
export function BillingSection(): JSX.Element {
  const { t, locale } = useLocale();
  const { data, loading } = useLiveData<BillingData>(async () => {
    const [estimate, costs, daily] = await Promise.all([
      getBillingEstimate('water'),
      getZoneCosts(),
      getDailyUsage(true),
    ]);
    return { estimate, costs, daily };
  }, []);

  if (loading && data === null) {
    return (
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-[340px] rounded-card xl:col-span-2" />
        <Skeleton className="h-[340px] rounded-card" />
      </div>
    );
  }

  if (data === null) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm font-medium">{t.common.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  const { estimate, costs, daily } = data;
  const change = estimate.changeFromPreviousPercent;
  const rising = change > 0;

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t.billing.dailyUsage}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* ตัวเลขสรุปอยู่เหนือกราฟ — คนที่มองจากไกลอ่านตรงนี้ก่อน */}
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] text-muted-foreground">{t.billing.actualToDate}</p>
              <p className="tabular text-metric leading-none">{formatBaht(estimate.totalBaht, locale, 0)}</p>
              <p className="tabular text-[11px] text-muted-foreground">
                {formatCubicMeters(estimate.consumedCubicMeters, locale)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{t.billing.forecastToMonthEnd}</p>
              <p className="tabular text-metric leading-none text-water">
                {formatBaht(estimate.projectedTotalBaht, locale, 0)}
              </p>
              <p className="text-[11px] text-muted-foreground">{t.billing.forecastLabel}</p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">{t.billing.vsLastMonth}</p>
              <p
                className={cn(
                  'tabular inline-flex items-center gap-1 text-metric leading-none',
                  rising ? 'text-status-warning' : 'text-status-ok',
                )}
              >
                {rising ? (
                  <TrendingUp className="h-6 w-6 shrink-0" aria-hidden />
                ) : (
                  <TrendingDown className="h-6 w-6 shrink-0" aria-hidden />
                )}
                {formatPercent(Math.abs(change), locale, 1)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {rising ? (locale === 'th' ? 'ใช้มากขึ้น' : 'higher') : locale === 'th' ? 'ใช้น้อยลง' : 'lower'}
              </p>
            </div>
          </div>

          <DailyUsageChart points={daily} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t.billing.byZone} <span className="font-normal text-muted-foreground">· {t.units.baht}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ZoneCostChart costs={costs} />
        </CardContent>
      </Card>
    </div>
  );
}
