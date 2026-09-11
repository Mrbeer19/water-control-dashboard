'use client';

import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UsageReportRow } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatCubicMeters, formatNumber } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE, seriesColor } from '@/components/charts/chart-tokens';

/**
 * เปรียบเทียบการใช้น้ำรายโซนกับช่วงก่อนหน้า
 *
 * สองแท่งต่อโซนเป็นหน่วยเดียวกัน (m³) จึงใช้แกนเดียวได้
 * ใช้สอง hue เพราะที่นี่แยก "ตัวตน" ของสองช่วงเวลา ไม่ใช่ไล่ระดับขนาด
 */
export function ZoneUsageChart({ rows }: { rows: UsageReportRow[] }): JSX.Element {
  const { t, locale } = useLocale();

  const data = rows.map((row) => ({
    ...row,
    shortName: (locale === 'th' ? row.name : row.nameEn).split('—')[0]?.trim() ?? row.name,
  }));

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.6} />
          <XAxis {...AXIS_PROPS} dataKey="shortName" interval={0} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
          <YAxis {...AXIS_PROPS} width={46} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.5 }}
            labelFormatter={(_label, payload) => {
              const row = payload[0]?.payload as UsageReportRow | undefined;
              return row === undefined ? '' : locale === 'th' ? row.name : row.nameEn;
            }}
            formatter={(value, name) => [formatCubicMeters(Number(value), locale), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }} />
          <Bar dataKey="previousCubicMeters" name={t.reports.previous} fill={CHART.offline} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={22} />
          <Bar dataKey="cubicMeters" name={t.reports.range} fill={seriesColor(0)} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={22}>
            <LabelList
              dataKey="cubicMeters"
              position="top"
              offset={4}
              formatter={(value: number) => formatNumber(value, locale, 0)}
              style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
