'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyUsagePoint } from '@/lib/types';
import { useCallback } from 'react';
import { getDailyUsage } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { formatCubicMeters, formatDate } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE } from '@/components/charts/chart-tokens';
import { ChartDetail } from '@/components/charts/chart-detail';

interface Row {
  timestamp: number;
  actual: number | null;
  forecast: number | null;
  /** [ล่าง, บน] ของช่วงความเชื่อมั่น — Recharts วาดแถบจากคู่ค่านี้ */
  band: [number, number] | null;
}

/**
 * การใช้น้ำรายวัน: เส้นทึบคือค่าจริง เส้นประคือช่วงที่ AI พยากรณ์
 * แถบเงาคือช่วงความเชื่อมั่น กว้างขึ้นเมื่อพยากรณ์ไกลออกไป
 *
 * ทั้งสองเส้นเป็นหน่วยเดียวกัน (m³) จึงใช้แกน y เดียว
 */
export function DailyUsageChart({ points }: { points: DailyUsagePoint[] }): JSX.Element {
  const { t, locale } = useLocale();

  // ข้อมูลที่ส่งให้หน้าต่าง "ดูข้อมูลละเอียด" — เอาเฉพาะวันที่เกิดขึ้นจริง ไม่รวมวันที่พยากรณ์
  const detailPoints = points
    .filter((point) => !point.projected)
    .map((point) => ({ timestamp: point.timestamp, value: point.cubicMeters }));
  const loadDeepHistory = useCallback(
    async () =>
      (await getDailyUsage(false, 400))
        .filter((point) => !point.projected)
        .map((point) => ({ timestamp: point.timestamp, value: point.cubicMeters })),
    [],
  );

  const lastActualIndex = points.findLastIndex((point) => !point.projected);
  // หน้ารายงานส่งมาเฉพาะวันที่เกิดขึ้นจริง — ไม่ต้องมีตำนานสีของเส้นที่ไม่ได้วาด
  const hasForecast = points.some((point) => point.projected);
  const rows: Row[] = points.map((point, index) => {
    if (!point.projected) {
      return { timestamp: point.timestamp, actual: point.cubicMeters, forecast: null, band: null };
    }
    // ความไม่แน่นอนโตขึ้นตามระยะที่พยากรณ์ออกไป
    const stepsAhead = index - lastActualIndex;
    const spread = point.cubicMeters * (0.04 + stepsAhead * 0.012);
    return {
      timestamp: point.timestamp,
      actual: null,
      forecast: point.cubicMeters,
      band: [point.cubicMeters - spread, point.cubicMeters + spread],
    };
  });

  // ต่อเส้นให้ชนกันที่จุดสุดท้ายของค่าจริง ไม่งั้นกราฟจะขาดช่วง
  const joint = rows[lastActualIndex];
  if (joint !== undefined && joint.actual !== null) {
    joint.forecast = joint.actual;
    joint.band = [joint.actual, joint.actual];
  }

  return (
    <ChartDetail
      title={t.billing.dailyUsage}
      unit="m³"
      points={detailPoints}
      loadPoints={loadDeepHistory}
      decimals={1}
    >
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.6} />
          <XAxis
            {...AXIS_PROPS}
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) => new Date(value).getDate().toString()}
            minTickGap={18}
          />
          <YAxis {...AXIS_PROPS} width={42} tickFormatter={(value: number) => value.toFixed(0)} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
            labelFormatter={(value) => formatDate(Number(value), locale)}
            formatter={(value, name) => {
              if (value === null || Array.isArray(value)) return [];
              return [
                formatCubicMeters(Number(value), locale),
                name === 'actual' ? t.billing.actualLabel : t.billing.forecastLabel,
              ];
            }}
          />

          <Area
            dataKey="band"
            stroke="none"
            fill={CHART.waterSoft}
            isAnimationActive={false}
            name={t.billing.confidenceBand}
            connectNulls
          />
          <Line
            dataKey="actual"
            stroke={CHART.water}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="actual"
          />
          <Line
            dataKey="forecast"
            stroke={CHART.water}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
            name="forecast"
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ตำนานสี — สองชุดข้อมูลขึ้นไปต้องมีเสมอ และไม่พึ่งสีอย่างเดียว ใช้ลายเส้นแยกด้วย */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden>
            <line x1="0" y1="4" x2="18" y2="4" stroke={CHART.water} strokeWidth="2" />
          </svg>
          {t.billing.actualLabel}
        </span>
        {hasForecast && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="8" aria-hidden>
                <line x1="0" y1="4" x2="18" y2="4" stroke={CHART.water} strokeWidth="2" strokeDasharray="5 4" />
              </svg>
              {t.billing.forecastLabel}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-4 rounded-sm"
                style={{ background: CHART.water, opacity: 0.16 }}
                aria-hidden
              />
              {t.billing.confidenceBand}
            </span>
          </>
        )}
      </div>
    </div>
    </ChartDetail>
  );
}
