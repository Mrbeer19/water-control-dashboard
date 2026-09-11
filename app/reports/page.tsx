'use client';

import { useMemo, useState } from 'react';
import { Download, FileText, TrendingDown, TrendingUp } from 'lucide-react';
import type { TimeRange, TimeRangePreset, UsageReport } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getUsageReport, requestReportExport } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatBaht, formatCubicMeters, formatDate, formatDateTimeTH, formatPercent } from '@/lib/utils';
import { Section } from '@/components/layout/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { DailyUsageChart } from '@/components/billing/daily-usage-chart';
import { ZoneUsageChart } from '@/components/reports/zone-usage-chart';

const INPUT_CLASS =
  'h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

/** Phase 4B — รายงานการใช้น้ำ */
export default function ReportsPage(): JSX.Element {
  const { t, locale } = useLocale();
  const today = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<TimeRangePreset>('30d');
  const [from, setFrom] = useState(() => {
    const start = new Date();
    start.setDate(start.getDate() - 29);
    return toDateInput(start);
  });
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const range: TimeRange = useMemo(
    () => ({
      preset,
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59`).toISOString(),
    }),
    [preset, from, to],
  );

  const applyPreset = (next: TimeRangePreset): void => {
    setPreset(next);
    const end = new Date();
    const start = new Date();
    if (next === '7d') start.setDate(end.getDate() - 6);
    else if (next === '30d') start.setDate(end.getDate() - 29);
    else start.setDate(1);
    setFrom(toDateInput(start));
    setTo(toDateInput(end));
  };

  const { data, loading } = useLiveData<UsageReport>(() => getUsageReport(range), [range.from, range.to]);

  const rising = (data?.changePercent ?? 0) > 0;

  return (
    <div className="space-y-8">
      <Section title={t.nav.reports} hint={data === null ? undefined : `${t.reports.generatedAt} ${formatDateTimeTH(data.generatedAt, locale)}`}>
        <div className="space-y-4">
          {/* ตัวเลือกช่วงวันที่ */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border bg-muted/40 p-0.5">
              {(['7d', '30d', 'custom'] as TimeRangePreset[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={preset === option}
                  onClick={() => {
                    if (option === 'custom') setPreset('custom');
                    else applyPreset(option);
                  }}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    preset === option ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option === '7d' ? t.reports.preset7 : option === '30d' ? t.reports.preset30 : t.common.all}
                </button>
              ))}
            </div>

            <input
              type="date"
              className={INPUT_CLASS}
              value={from}
              max={to}
              aria-label={t.alerts.from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPreset('custom');
              }}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              className={INPUT_CLASS}
              value={to}
              min={from}
              max={toDateInput(today)}
              aria-label={t.alerts.to}
              onChange={(event) => {
                setTo(event.target.value);
                setPreset('custom');
              }}
            />

            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  void requestReportExport('daily', range, 'csv').then(() => {
                    setExportMessage(t.reports.exportQueued);
                  });
                }}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {t.reports.exportCsv}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  void requestReportExport('daily', range, 'pdf').then(() => {
                    setExportMessage(t.reports.exportQueued);
                  });
                }}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                {t.reports.exportPdf}
              </Button>
            </div>
          </div>

          {exportMessage !== null && (
            <p className="rounded-md bg-primary/10 px-2.5 py-1.5 text-xs text-primary">{exportMessage}</p>
          )}

          {loading && data === null ? (
            <Skeleton className="h-[520px] rounded-lg" />
          ) : data === null || data.rows.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm font-medium">{t.reports.noData}</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* ตัวเลขสรุป */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-muted-foreground">{t.reports.totalUsage}</p>
                    <p className="tabular text-metric leading-none">{formatCubicMeters(data.totalCubicMeters, locale, 0)}</p>
                    <p className="tabular text-[11px] text-muted-foreground">
                      {t.reports.previous} {formatCubicMeters(data.previousTotalCubicMeters, locale, 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-[11px] text-muted-foreground">{t.reports.totalCost}</p>
                    <p className="tabular text-metric leading-none">{formatBaht(data.totalCostBaht, locale, 0)}</p>
                    <p className="tabular text-[11px] text-muted-foreground">
                      {t.reports.previous} {formatBaht(data.previousTotalCostBaht, locale, 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] text-muted-foreground">{t.meter.unaccounted}</p>
                      <StatusBadge status={data.unaccounted.status} />
                    </div>
                    <p className="tabular text-metric leading-none">
                      {formatPercent(data.unaccounted.unaccountedPercent, locale, 1)}
                    </p>
                    <p className="tabular text-[11px] text-muted-foreground">
                      {formatCubicMeters(data.unaccounted.unaccountedCubicMeters, locale)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
                    {t.reports.byZoneTable}
                    <span
                      className={cn(
                        'tabular inline-flex items-center gap-1 text-sm font-medium',
                        rising ? 'text-status-warning' : 'text-status-ok',
                      )}
                    >
                      {rising ? <TrendingUp className="h-4 w-4" aria-hidden /> : <TrendingDown className="h-4 w-4" aria-hidden />}
                      {formatPercent(Math.abs(data.changePercent), locale, 1)} {t.reports.compare}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ZoneUsageChart rows={data.rows} />
                </CardContent>
              </Card>

              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.zone.zone}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.reports.range}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.reports.previous}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.reports.change}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.zone.cost}</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">{t.reports.share}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.zoneId} className="border-b last:border-0 hover:bg-accent/40">
                          <td className="px-4 py-2.5">{locale === 'th' ? row.name : row.nameEn}</td>
                          <td className="tabular px-3 py-2.5 text-right">{formatCubicMeters(row.cubicMeters, locale)}</td>
                          <td className="tabular px-3 py-2.5 text-right text-muted-foreground">
                            {formatCubicMeters(row.previousCubicMeters, locale)}
                          </td>
                          <td
                            className={cn(
                              'tabular px-3 py-2.5 text-right',
                              row.changePercent > 0 ? 'text-status-warning' : 'text-status-ok',
                            )}
                          >
                            {row.changePercent > 0 ? '+' : ''}
                            {formatPercent(row.changePercent, locale, 1)}
                          </td>
                          <td className="tabular px-3 py-2.5 text-right font-medium">{formatBaht(row.costBaht, locale, 0)}</td>
                          <td className="tabular px-4 py-2.5 text-right">{formatPercent(row.sharePercent, locale, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {t.billing.dailyUsage}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {formatDate(data.range.from, locale)} → {formatDate(data.range.to, locale)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DailyUsageChart points={data.daily} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </Section>
    </div>
  );
}
