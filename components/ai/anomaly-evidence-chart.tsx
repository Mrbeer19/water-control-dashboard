'use client';

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AnomalyExpectedBand, TimeSeriesPoint } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatNumber, formatTime } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE } from '@/components/charts/chart-tokens';

/**
 * ค่าจริงช่วงที่เกิดเหตุ พร้อมแถบช่วงที่โมเดลคาดไว้
 * ★ ถ้าทีม AI ไม่ส่ง expectedBand มา จะวาดเฉพาะเส้นค่าจริง ไม่ใช่ไม่วาดอะไรเลย
 */
export function AnomalyEvidenceChart({
  evidence,
  expectedBand,
  unit,
}: {
  evidence: TimeSeriesPoint[];
  expectedBand?: AnomalyExpectedBand;
  unit?: string;
}): JSX.Element | null {
  const { t, locale } = useLocale();
  if (evidence.length < 2) return null;

  const rows = evidence.map((point, index) => {
    const lower = expectedBand?.lower[index]?.value;
    const upper = expectedBand?.upper[index]?.value;
    return {
      timestamp: point.timestamp,
      value: point.value,
      band: lower === undefined || upper === undefined ? undefined : ([lower, upper] as [number, number]),
    };
  });

  const hasBand = rows.some((row) => row.band !== undefined);

  return (
    <div>
      <div className="h-[124px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.5} />
            <XAxis
              {...AXIS_PROPS}
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => formatTime(value, locale).slice(0, 5)}
              minTickGap={28}
            />
            <YAxis {...AXIS_PROPS} width={42} />
            <Tooltip
              {...TOOLTIP_STYLE}
              cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
              labelFormatter={(value) => formatTime(Number(value), locale)}
              formatter={(value, name) => {
                if (Array.isArray(value)) {
                  const [low, high] = value as (number | undefined)[];
                  if (low === undefined || high === undefined) return [];
                  return [`${formatNumber(low, locale, 1)} – ${formatNumber(high, locale, 1)}`, t.ai.expectedBand];
                }
                return [`${formatNumber(Number(value), locale, 1)}${unit === undefined ? '' : ` ${unit}`}`, String(name)];
              }}
            />
            {hasBand && (
              <Area
                dataKey="band"
                stroke="none"
                fill={CHART.muted}
                fillOpacity={0.18}
                isAnimationActive={false}
                name={t.ai.expectedBand}
                connectNulls
              />
            )}
            <Line
              dataKey="value"
              stroke={CHART.critical}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name={t.ai.evidence}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden>
            <line x1="0" y1="4" x2="16" y2="4" stroke={CHART.critical} strokeWidth="2" />
          </svg>
          {t.ai.evidence}
        </span>
        {hasBand && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: CHART.muted, opacity: 0.18 }} aria-hidden />
            {t.ai.expectedBand}
          </span>
        )}
      </div>
    </div>
  );
}
