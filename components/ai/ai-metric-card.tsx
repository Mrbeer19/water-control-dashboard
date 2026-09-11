'use client';

import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { AIMetric } from '@/lib/types';
import { getMetricConfig, isUnknownMetric } from '@/lib/config/ai-metrics';
import { useLocale } from '@/lib/i18n';
import { cn, formatBaht, formatMinutes, formatNumber, formatPercent, formatRatio, STATUS_TEXT_CLASS } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkline } from '@/components/charts/sparkline';
import { CHART } from '@/components/charts/chart-tokens';

/**
 * แสดงค่าหนึ่งค่าที่ทีม AI คำนวณมา
 *
 * ★ บังคับแค่ key กับ computedAt ทุกส่วนอื่นซ่อนได้หมด
 *   ตัวชี้วัดที่ยังไม่มีคำแปลต้องแสดงได้ทันทีโดยใช้ key ดิบเป็นชื่อ
 */
export function AiMetricCard({ metric }: { metric: AIMetric }): JSX.Element {
  const { t, locale } = useLocale();
  const config = getMetricConfig(metric.key);
  const Icon = config.icon;
  const unknown = isUnknownMetric(metric.key);

  const label = locale === 'th' ? config.labelTh : config.labelEn;
  const unit = metric.unit ?? config.unit;
  const decimals = metric.decimals ?? config.decimals;
  const format = metric.format ?? config.format;
  // ทีม AI ระบุทิศทางมาเองได้ ถ้าไม่ระบุค่อยใช้ค่าจากตารางแปล
  const higherIsWorse = metric.higherIsWorse ?? config.higherIsWorse;
  const status = metric.status ?? 'ok';

  const display = formatMetricValue(metric, format, decimals, unit, locale);

  const rising = (metric.changePercent ?? 0) > 0;
  const TrendIcon = metric.trend === 'stable' || metric.changePercent === 0 ? Minus : rising ? TrendingUp : TrendingDown;
  const trendIsBad = rising === higherIsWorse;

  return (
    <Card className={cn(status === 'critical' && 'border-status-critical/40')}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{label}</span>
            </p>
            {metric.scopeName !== undefined && (
              <p className="truncate text-[11px] text-muted-foreground">{metric.scopeName}</p>
            )}
          </div>
          {metric.changePercent !== undefined && metric.changePercent !== null && (
            <span
              className={cn(
                'tabular inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium',
                metric.trend === 'stable' ? 'text-muted-foreground' : trendIsBad ? 'text-status-warning' : 'text-status-ok',
              )}
            >
              <TrendIcon className="h-3 w-3" aria-hidden />
              {formatPercent(Math.abs(metric.changePercent), locale, 1)}
            </span>
          )}
        </div>

        <p className={cn('tabular text-2xl font-semibold leading-none', STATUS_TEXT_CLASS[status])}>{display}</p>

        {metric.target !== undefined && metric.target !== null && (
          <p className="tabular text-[11px] text-muted-foreground">
            {t.ai.target} {formatMetricValue({ ...metric, value: metric.target }, format, decimals, unit, locale)}
          </p>
        )}

        {metric.series !== undefined && metric.series.length > 1 && (
          <Sparkline
            points={metric.series}
            color={status === 'critical' ? CHART.critical : CHART.sequential}
            height={32}
            label={`${label} trend`}
          />
        )}

        {(metric.summaryTh !== undefined || metric.summaryEn !== undefined) && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {locale === 'th' ? (metric.summaryTh ?? metric.summaryEn) : (metric.summaryEn ?? metric.summaryTh)}
          </p>
        )}

        {metric.basis !== undefined && metric.basis.length > 0 && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-muted-foreground">{t.ai.basis}</summary>
            <ul className="mt-1 space-y-0.5">
              {metric.basis.map((item) => (
                <li key={item.key} className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-muted-foreground">{item.key}</span>
                  <span className="tabular shrink-0">
                    {formatNumber(item.value, locale, 2)}
                    {item.expected !== undefined && item.expected !== null && (
                      <span className="text-muted-foreground"> / {formatNumber(item.expected, locale, 2)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-x-3 text-[10px] text-muted-foreground">
          {metric.confidence !== undefined && <span>{t.ai.confidence} {formatRatio(metric.confidence, locale)}</span>}
          {unknown && <span className="text-status-warning">{t.ai.unknownMetricNote}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * จัดรูปแบบค่าตามที่ทีม AI บอกมา
 * รูปแบบที่ไม่รู้จักถอยไปเป็นตัวเลขธรรมดา + หน่วย ไม่ใช่แสดงค่าดิบหรือพัง
 */
function formatMetricValue(
  metric: AIMetric,
  format: string,
  decimals: number,
  unit: string,
  locale: 'th' | 'en',
): string {
  if (metric.value === undefined) return metric.text ?? '—';

  switch (format) {
    case 'percent':
    case 'ratio':
      return formatRatio(metric.value, locale, decimals);
    case 'currency':
      return formatBaht(metric.value, locale, decimals);
    case 'duration_minutes':
      return formatMinutes(metric.value, locale);
    default:
      return `${formatNumber(metric.value, locale, decimals)}${unit === '' ? '' : ` ${unit}`}`;
  }
}
