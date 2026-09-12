'use client';

/**
 * การ์ดสรุปของช่วงที่เลือก — ชุดการ์ดเปลี่ยนตาม kind ของข้อมูล
 *
 * ★★ อุณหภูมิจะไม่มีการ์ด "รวม" ให้เห็นเลย ★★
 *   ไม่ได้ซ่อนทีหลัง แต่ชุดการ์ดของ gauge ไม่มีรายการนั้นอยู่ตั้งแต่ต้น (ดู explorer-stats.ts)
 */
import type { Locale, MetricKind, SeriesGranularity } from '@/lib/types';
import type { MetricConfig } from '@/lib/config/metrics';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { bucketRangeLabel, eventTimeLabel } from './explorer-labels';
import type { SummaryStat } from './explorer-stats';

interface ExplorerSummaryProps {
  stats: SummaryStat[];
  config: MetricConfig;
  kind: MetricKind;
  granularity: SeriesGranularity;
  timeZone: string;
  /** % เปลี่ยนแปลงเทียบช่วงก่อนหน้า — null เมื่อไม่ได้เทียบหรือเทียบไม่ได้ */
  change: number | null;
}

function statText(stat: SummaryStat, config: MetricConfig, locale: Locale, hours: string, times: string): string {
  if (stat.value === null) return '—';
  if (stat.unit === 'hours') return `${formatNumber(stat.value, locale, 1)} ${hours}`;
  if (stat.unit === 'count') return `${formatNumber(stat.value, locale, 0)} ${times}`;
  return config.format(stat.value, locale);
}

export function ExplorerSummary({
  stats,
  config,
  kind,
  granularity,
  timeZone,
  change,
}: ExplorerSummaryProps): JSX.Element {
  const { t, locale } = useLocale();

  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.labelKey} className="rounded-control border border-border-strong bg-secondary p-3">
            <dt className="text-[11px] text-muted-foreground">{t.chart[stat.labelKey]}</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold leading-tight">
              {statText(stat, config, locale, t.chart.unitHours, t.chart.unitTimes)}
            </dd>
            {stat.at !== null && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {eventTimeLabel(stat.at, timeZone, locale)}
              </p>
            )}
            {stat.atBucket !== null && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {bucketRangeLabel(stat.atBucket, granularity, timeZone, locale)}
              </p>
            )}
          </div>
        ))}
      </dl>

      {change !== null && (
        <p className="text-xs text-muted-foreground">
          {t.chart.change}{' '}
          <span
            className={cn(
              'tabular font-semibold',
              // ★ ขึ้น/ลง ไม่ได้แปลว่าดี/ร้ายเสมอไป (อุณหภูมิขึ้น ≠ แย่) จึงใช้สีข้อความปกติ
              'text-foreground',
            )}
          >
            {change >= 0 ? '+' : '−'}
            {formatNumber(Math.abs(change), locale, 1)}%
          </span>{' '}
          <span className="text-muted-foreground">
            ({kind === 'gauge' ? t.chart.statAvg : t.chart.statSum})
          </span>
        </p>
      )}
    </div>
  );
}
