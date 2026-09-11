'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { MonthlyUsagePoint } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatCubicMeters, formatNumber, formatPercent } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE } from '@/components/charts/chart-tokens';

/**
 * ยอดรายเดือนย้อนหลัง
 *
 * ★ เดือนที่ยังไม่จบวาดด้วยสีจาง เพราะตัวเลขยังไม่ใช่ยอดเต็มเดือน
 *   ถ้าวาดเหมือนเดือนอื่นจะอ่านผิดว่าการใช้น้ำตกฮวบ
 */
export function MonthlyChart({ points }: { points: MonthlyUsagePoint[] }): JSX.Element {
  const { t, locale } = useLocale();
  const rows = points.map((point) => ({ ...point, display: locale === 'th' ? point.label : point.labelEn }));

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.6} />
          <XAxis {...AXIS_PROPS} dataKey="display" interval={0} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
          <YAxis {...AXIS_PROPS} width={46} />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.5 }}
            formatter={(value, _name, item) => {
              const row = item.payload as MonthlyUsagePoint | undefined;
              const change =
                row?.changeFromPreviousPercent === null || row?.changeFromPreviousPercent === undefined
                  ? ''
                  : ` · ${row.changeFromPreviousPercent > 0 ? '+' : ''}${formatPercent(row.changeFromPreviousPercent, locale, 1)} ${t.reports.vsPrevMonth}`;
              const partial = row?.partial === true ? ` · ${t.reports.partialMonth}` : '';
              return [`${formatCubicMeters(Number(value), locale, 0)}${change}${partial}`, ''];
            }}
          />
          <Bar dataKey="cubicMeters" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={38}>
            {rows.map((row) => (
              <Cell
                key={row.month}
                fill={CHART.sequential}
                fillOpacity={row.partial ? 0.38 : 1}
                stroke={row.partial ? CHART.sequential : undefined}
                strokeDasharray={row.partial ? '4 3' : undefined}
              />
            ))}
            <LabelList
              dataKey="cubicMeters"
              position="top"
              offset={5}
              formatter={(value: number) => formatNumber(value, locale, 0)}
              style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
