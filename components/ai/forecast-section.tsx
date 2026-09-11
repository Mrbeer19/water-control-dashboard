'use client';

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AIForecast } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatDateTimeTH, formatNumber, formatPercent, formatRatio, formatTime } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE } from '@/components/charts/chart-tokens';

/**
 * C — ผลพยากรณ์ทั้งหมด จัดกลุ่มตาม target
 * ★ วนแสดงทุกรายการที่ได้มา ไม่ได้ fix จำนวนหรือชนิดไว้ ทีม AI เพิ่ม target ใหม่ได้เอง
 */
export function ForecastSection({
  forecasts,
  loading,
}: {
  forecasts: AIForecast[] | null;
  loading: boolean;
}): JSX.Element {
  const { t } = useLocale();

  if (loading && forecasts === null) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        {[0, 1].map((index) => (
          <Skeleton key={index} className="h-[260px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (forecasts === null || forecasts.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm font-medium">{t.ai.noForecasts}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  // จัดกลุ่มตาม target ตามที่สเปกกำหนด
  const groups = new Map<string, AIForecast[]>();
  for (const forecast of forecasts) {
    const list = groups.get(forecast.target) ?? [];
    list.push(forecast);
    groups.set(forecast.target, list);
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([target, items]) => (
        <div key={target} className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{target}</p>
          <div className="grid gap-4 xl:grid-cols-2">
            {items.map((forecast) => (
              <ForecastCard key={forecast.id} forecast={forecast} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ForecastCard({ forecast }: { forecast: AIForecast }): JSX.Element {
  const { t, locale } = useLocale();

  const history = forecast.history ?? [];
  const future = forecast.forecast ?? [];
  const hasBand = future.some((point) => point.lowerBound !== undefined && point.upperBound !== undefined);

  const rows = [
    ...history.slice(-60).map((point) => ({
      timestamp: point.timestamp,
      actual: point.value,
      predicted: undefined as number | undefined,
      band: undefined as [number, number] | undefined,
    })),
    ...future.map((point) => ({
      timestamp: point.timestamp,
      actual: undefined as number | undefined,
      predicted: point.value,
      band:
        point.lowerBound === undefined || point.upperBound === undefined
          ? undefined
          : ([point.lowerBound, point.upperBound] as [number, number]),
    })),
  ];

  // เชื่อมเส้นจริงกับเส้นพยากรณ์ที่จุดต่อ ไม่ให้กราฟขาดช่วง
  const joint = rows[history.slice(-60).length - 1];
  if (joint !== undefined && joint.actual !== undefined) joint.predicted = joint.actual;

  const meta: string[] = [];
  if (forecast.horizon !== undefined) meta.push(`${t.ai.horizon} ${forecast.horizon}`);
  if (forecast.confidence !== undefined) {
    meta.push(`${t.ai.confidence} ${formatRatio(forecast.confidence, locale)}`);
  }
  if (forecast.mapePercent !== undefined) {
    meta.push(`${t.ai.accuracyNote} ${formatPercent(forecast.mapePercent, locale, 1)}`);
  }
  if (forecast.modelName !== undefined && forecast.modelName !== null) {
    meta.push(`${t.ai.model} ${forecast.modelName}`);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {forecast.targetName ?? forecast.targetId ?? forecast.target}
          {forecast.unit !== undefined && <span className="ml-1.5 font-normal text-muted-foreground">· {forecast.unit}</span>}
        </CardTitle>
        {meta.length > 0 && <p className="tabular text-[11px] text-muted-foreground">{meta.join(' · ')}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length < 2 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">{t.common.empty}</p>
        ) : (
          <div className="h-[180px] w-full">
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
                  minTickGap={30}
                />
                <YAxis {...AXIS_PROPS} width={42} />
                <Tooltip
                  {...TOOLTIP_STYLE}
                  cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                  labelFormatter={(value) => formatDateTimeTH(Number(value), locale)}
                  formatter={(value, name) => {
                    if (Array.isArray(value) || value === undefined) return [];
                    return [
                      formatNumber(Number(value), locale, 1),
                      name === 'actual' ? t.billing.actualLabel : t.billing.forecastLabel,
                    ];
                  }}
                />
                {hasBand && (
                  <Area dataKey="band" stroke="none" fill={CHART.water} fillOpacity={0.16} isAnimationActive={false} connectNulls />
                )}
                <Line dataKey="actual" stroke={CHART.water} strokeWidth={2} dot={false} isAnimationActive={false} name="actual" />
                <Line
                  dataKey="predicted"
                  stroke={CHART.water}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                  name="predicted"
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {(forecast.summaryTh !== undefined || forecast.summaryEn !== undefined) && (
          <p className="text-xs text-muted-foreground">
            {locale === 'th' ? (forecast.summaryTh ?? forecast.summaryEn) : (forecast.summaryEn ?? forecast.summaryTh)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
