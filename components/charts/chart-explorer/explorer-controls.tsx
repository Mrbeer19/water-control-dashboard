'use client';

/**
 * แถบควบคุมของ chart explorer — ช่วงเวลา / ความละเอียด / การเทียบช่วง
 *
 * ★ ความละเอียดที่ใช้กับช่วงนี้ไม่ได้ ต้อง "จาง + บอกเหตุผล" ไม่ใช่หายไป
 *   ผู้ใช้จะได้รู้ว่ามีตัวเลือกนั้นอยู่ และรู้ว่าทำไมกดไม่ได้
 * ★ กติกาว่าอันไหนใช้ได้มาจาก lib/utils/time-buckets.ts ตัวเดียวกับที่ mock ใช้
 */
import type { SeriesCompareMode, SeriesGranularity } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { granularityOptions } from '@/lib/utils/time-buckets';
import { zonedTimeToMs } from '@/lib/utils/time-buckets';
import { toDateInputValue } from './explorer-labels';
import type { ExplorerView, RangePreset } from './explorer-types';
import { RANGE_PRESETS } from './explorer-types';
import type { ExplorerViewApi } from './use-explorer-view';

const PRESET_LABEL: Record<Exclude<RangePreset, 'custom'>, 'preset1h' | 'preset12h' | 'preset24h' | 'preset7d' | 'preset30d' | 'preset12mo'> = {
  '1h': 'preset1h',
  '12h': 'preset12h',
  '24h': 'preset24h',
  '7d': 'preset7d',
  '30d': 'preset30d',
  '12mo': 'preset12mo',
};

const GRAIN_LABEL: Record<SeriesGranularity, 'grainRaw' | 'grainMinute5' | 'grainMinute15' | 'grainHour' | 'grainDay' | 'grainWeek' | 'grainMonth' | 'grainYear'> = {
  raw: 'grainRaw',
  minute_5: 'grainMinute5',
  minute_15: 'grainMinute15',
  hour: 'grainHour',
  day: 'grainDay',
  week: 'grainWeek',
  month: 'grainMonth',
  year: 'grainYear',
};

const segment = (active: boolean, disabled: boolean): string =>
  cn(
    'rounded-control px-2.5 py-1.5 text-xs font-medium transition-colors',
    disabled
      ? 'cursor-not-allowed text-muted-foreground opacity-50'
      : active
        ? 'bg-card text-foreground ring-1 ring-border'
        : 'text-muted-foreground hover:text-foreground',
  );

interface ExplorerControlsProps {
  api: ExplorerViewApi;
  view: ExplorerView;
  /** ความละเอียดที่ metric นี้ให้ผลมีความหมาย — undefined = ได้ทุกระดับที่ช่วงเวลาอนุญาต */
  allowed?: SeriesGranularity[];
}

export function ExplorerControls({ api, view, allowed }: ExplorerControlsProps): JSX.Element {
  const { t, locale } = useLocale();
  const options = granularityOptions(view.from, view.to).filter(
    (option) => allowed === undefined || allowed.includes(option.value),
  );
  // "ช่วงเดียวกันของปีก่อน" มีความหมายเฉพาะมุมมองที่ยาวระดับเดือน/ปี
  const canCompareYear = view.granularity === 'month' || view.granularity === 'year';

  const onDateChange = (which: 'from' | 'to', value: string): void => {
    const parts = value.split('-').map(Number);
    const [year, month, day] = parts;
    if (year === undefined || month === undefined || day === undefined) return;
    const atMidnight = zonedTimeToMs({ year, month, day, hour: 0, minute: 0, second: 0 }, api.timeZone);
    // ปลายช่วงต้องครอบทั้งวันที่เลือก ไม่ใช่หยุดที่เที่ยงคืนของวันนั้น
    const next = which === 'from' ? atMidnight : atMidnight + 86_400_000;
    const from = which === 'from' ? next : view.from;
    const to = which === 'to' ? next : view.to;
    if (to <= from) return;
    api.setCustomRange(from, to);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-control border bg-secondary p-0.5" role="group" aria-label={t.chart.period}>
        {RANGE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => {
              api.setPreset(preset.value);
            }}
            aria-pressed={view.preset === preset.value}
            className={segment(view.preset === preset.value, false)}
          >
            {t.chart[PRESET_LABEL[preset.value]]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="sr-only sm:not-sr-only">{t.chart.from}</span>
        <input
          type="date"
          value={toDateInputValue(view.from, api.timeZone)}
          onChange={(event) => {
            onDateChange('from', event.target.value);
          }}
          className="rounded-control border bg-card px-2 py-1 text-xs text-foreground"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="sr-only sm:not-sr-only">{t.chart.to}</span>
        <input
          type="date"
          value={toDateInputValue(view.to - 1, api.timeZone)}
          onChange={(event) => {
            onDateChange('to', event.target.value);
          }}
          className="rounded-control border bg-card px-2 py-1 text-xs text-foreground"
        />
      </label>

      <div className="inline-flex flex-wrap rounded-control border bg-secondary p-0.5" role="group" aria-label={t.chart.resolution}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            onClick={() => {
              api.setGranularity(option.value);
            }}
            aria-pressed={view.granularity === option.value}
            title={
              option.reasonKey === 'tooManyPoints'
                ? t.chart.grainTooManyPoints.replace('{n}', formatNumber(option.approxPoints, locale, 0))
                : option.reasonKey === 'tooLong'
                  ? t.chart.grainTooLong
                  : undefined
            }
            className={segment(view.granularity === option.value, option.disabled)}
          >
            {t.chart[GRAIN_LABEL[option.value]]}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{t.chart.compare}</span>
        <select
          value={view.compare}
          onChange={(event) => {
            api.setCompare(event.target.value as SeriesCompareMode);
          }}
          className="rounded-control border bg-card px-2 py-1 text-xs text-foreground"
        >
          <option value="none">{t.chart.compareOff}</option>
          <option value="previous">{t.chart.comparePrevious}</option>
          {canCompareYear && <option value="last_year">{t.chart.compareLastYear}</option>}
        </select>
      </label>
    </div>
  );
}
