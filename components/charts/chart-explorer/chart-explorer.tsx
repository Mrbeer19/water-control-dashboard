'use client';

/**
 * เนื้อในของหน้าต่างดูข้อมูลย้อนหลัง — ตัวเดียวใช้กับทุกกราฟในระบบ
 *
 * ★★ ห้ามสร้างหน้าต่างใหม่ซ้ำ ★★ กรอบ <dialog> อยู่ที่ components/charts/chart-detail.tsx
 *   ไฟล์นี้คือ "เนื้อใน" เท่านั้น จะได้เอาไปวางในหน้าเต็มจอทีหลังได้โดยไม่ต้องรื้อ
 *
 * ★ ทุกอย่างที่แสดงมาจาก state จริง — ช่วงเวลาบนหัวหน้าต่างจึงเปลี่ยนตามที่เลือกเสมอ
 *   ห้าม hardcode "24 ชั่วโมงล่าสุด" (บั๊กเดิมข้อ 3 ใน docs/CHART_EXPLORER_PLAN.md)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MetricKey, SystemSettings } from '@/lib/types';
import { getSettings } from '@/lib/services';
import { getMetricConfig, isKnownMetric, metricLabel } from '@/lib/config/metrics';
import { DEFAULT_TIMEZONE, resolveTimezone } from '@/lib/config/timezone';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ExplorerBreadcrumb } from './explorer-breadcrumb';
import type { SeriesToggle } from './explorer-chart';
import { ExplorerChart } from './explorer-chart';
import { ExplorerControls } from './explorer-controls';
import { ExplorerEvents } from './explorer-events';
import { ExplorerLegend } from './explorer-legend';
import { ExplorerSummary } from './explorer-summary';
import { ExplorerTable } from './explorer-table';
import { bucketLabel, eventTimeLabel, selectionLabel } from './explorer-labels';
import { percentChange, summarize, toRows } from './explorer-stats';
import type { MetricSourceRef, RangePreset } from './explorer-types';
import { useExplorerData } from './use-explorer-data';
import { childGranularity, useExplorerView } from './use-explorer-view';

export interface ChartExplorerProps {
  source: MetricSourceRef;
  open: boolean;
  /** ช่วงเริ่มต้นตอนเปิด — ลิงก์ที่ copy มาจะชนะค่านี้ */
  defaultPreset?: Exclude<RangePreset, 'custom'>;
  /**
   * ค่าวัดอื่นของอุปกรณ์เดียวกันที่สลับดูได้ในหน้าต่างเดียว
   * ★ ปั๊มหนึ่งตัวมี W / A / V / kWh / Hz — ทำเป็นตัวสลับดีกว่าแปะกราฟเล็ก 6 ใบบนการ์ด
   *   ต้องมี source.metric อยู่ในรายการด้วย ไม่งั้นตัวที่เปิดมาจะไม่ถูกไฮไลต์
   */
  metrics?: MetricKey[];
}

export function ChartExplorer({ source, open, defaultPreset = '24h', metrics }: ChartExplorerProps): JSX.Element {
  const { t, locale } = useLocale();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [toggles, setToggles] = useState<SeriesToggle>({ value: true, band: true, compare: true, events: true });

  useEffect(() => {
    if (!open || settings !== null) return;
    void getSettings().then(setSettings);
  }, [open, settings]);

  const timeZone = resolveTimezone(settings?.general.timezone ?? DEFAULT_TIMEZONE);
  const api = useExplorerView(source, open, timeZone, defaultPreset, metrics);
  const { view, trail } = api;
  // ค่าวัดที่กำลังดูอยู่อาจไม่ใช่ตัวที่การ์ดส่งมา ถ้าผู้ใช้สลับในหน้าต่างหรือเปิดจากลิงก์
  const active = useMemo<MetricSourceRef>(() => ({ ...source, metric: api.metric }), [source, api.metric]);
  const config = getMetricConfig(active.metric);
  const data = useExplorerData(active, view, open, timeZone, config.kind, locale);

  // kind ที่ใช้จริงมาจาก response ไม่ใช่จากทะเบียน — หลังบ้านเป็นคนรวมข้อมูลจึงเป็นคนรู้
  const kind = data.series?.kind ?? config.kind;

  useEffect(() => {
    if (!data.kindMismatch || process.env.NODE_ENV === 'production') return;
    console.warn(
      `[chart-explorer] metric "${String(active.metric)}" หลังบ้านส่ง kind "${data.series?.kind ?? '?'}" แต่ทะเบียนบอก "${config.kind}" — แสดงตามที่ได้รับ`,
    );
  }, [data.kindMismatch, data.series?.kind, config.kind, active.metric]);

  const canDrill = childGranularity(view.granularity) !== null;
  const rows = useMemo(
    () => toRows(data.points, data.comparePoints, view.granularity, timeZone, locale, canDrill),
    [data.points, data.comparePoints, view.granularity, timeZone, locale, canDrill],
  );
  const stats = useMemo(() => summarize(data.points, kind), [data.points, kind]);
  const change = useMemo(
    () =>
      data.comparePoints === null ? null : percentChange(data.points, data.comparePoints, kind),
    [data.points, data.comparePoints, kind],
  );

  const thresholds = useMemo(
    () => (settings === null ? null : (config.thresholds?.(settings, active.sourceId) ?? null)),
    [settings, config, active.sourceId],
  );

  const onToggle = useCallback((key: keyof SeriesToggle) => {
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const hasData = rows.some((row) => row.value !== null);
  const heading = selectionLabel(data.from, view.to, timeZone, locale);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">{heading}</p>
        <p className="text-xs text-muted-foreground">
          {t.chart[
            view.granularity === 'raw'
              ? 'grainRaw'
              : view.granularity === 'minute_5'
                ? 'grainMinute5'
                : view.granularity === 'minute_15'
                  ? 'grainMinute15'
                  : view.granularity === 'hour'
                    ? 'grainHour'
                    : view.granularity === 'day'
                      ? 'grainDay'
                      : view.granularity === 'week'
                        ? 'grainWeek'
                        : view.granularity === 'month'
                          ? 'grainMonth'
                          : 'grainYear'
          ]}
          {' · '}
          {t.chart.points} {formatNumber(rows.length, locale, 0)}
          {config.unit !== '' && ` · ${config.unit}`}
          {data.loading && ` · ${t.common.loading}`}
        </p>
        {!isKnownMetric(active.metric) && (
          <p className="text-xs text-muted-foreground">{t.ai.unknownMetricNote}</p>
        )}
        {data.kindMismatch && <p className="text-xs text-muted-foreground">{t.chart.unknownKindNote}</p>}
      </div>

      {metrics !== undefined && metrics.length > 1 && (
        <div className="inline-flex flex-wrap rounded-control border bg-secondary p-0.5" role="group">
          {metrics.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                api.setMetric(option);
              }}
              aria-pressed={api.metric === option}
              className={cn(
                'rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors',
                api.metric === option
                  ? 'bg-card text-foreground ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {metricLabel(option, t)}
            </button>
          ))}
        </div>
      )}

      <ExplorerBreadcrumb trail={trail} onBack={api.backTo} />
      <ExplorerControls api={api} view={view} allowed={config.granularities} />

      {data.loading && data.series === null ? (
        <div className="space-y-3">
          <Skeleton className="h-[74px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      ) : !hasData ? (
        <div className="rounded-control border border-border-strong bg-secondary p-8 text-center">
          <p className="text-sm font-medium">
            {data.offlineSince === null
              ? t.chart.noDataInRange
              : t.chart.offlineSince.replace('{time}', eventTimeLabel(data.offlineSince, timeZone, locale))}
          </p>
        </div>
      ) : (
        <>
          <ExplorerSummary
            stats={stats}
            config={config}
            kind={kind}
            granularity={view.granularity}
            timeZone={timeZone}
            change={change}
          />
          <ExplorerLegend
            toggles={toggles}
            onToggle={onToggle}
            seriesIndex={config.seriesIndex}
            showBand={config.chart === 'line_band' || config.chart === 'step_band'}
            showCompare={data.comparePoints !== null}
            showEvents={data.markers.length > 0}
          />
          <ExplorerChart
            rows={rows}
            config={config}
            kind={kind}
            thresholds={thresholds}
            markers={data.markers}
            toggles={toggles}
            {...(canDrill
              ? {
                  onDrill: (row) => {
                    api.drill(row.start, bucketLabel(row.start, view.granularity, timeZone, locale));
                  },
                }
              : {})}
          />
          {canDrill && <p className="text-[11px] text-muted-foreground">{t.chart.drillHint}</p>}

          <ExplorerEvents markers={data.markers} timeZone={timeZone} />
          <ExplorerTable
            rows={rows}
            config={config}
            kind={kind}
            fileBase={`${active.sourceId}-${String(active.metric)}-${view.granularity}`}
          />
        </>
      )}
    </div>
  );
}
