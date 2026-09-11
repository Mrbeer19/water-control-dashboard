'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyUsagePoint } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatCubicMeters, formatDate, formatTemperature } from '@/lib/utils';
import { AXIS_PROPS, TOOLTIP_STYLE, seriesColor } from '@/components/charts/chart-tokens';

/**
 * อุณหภูมิภายนอก เทียบ การใช้น้ำรายวัน
 *
 * ★ ตั้งใจไม่ทำเป็นกราฟซ้อนสองแกน y
 *   °C กับ m³ เป็นคนละหน่วยคนละสเกล การเอามาซ้อนบนแกนคู่ทำให้จุดตัดของสองเส้น
 *   ดูเหมือนมีความหมาย ทั้งที่ความจริงเลื่อนสเกลนิดเดียวความสัมพันธ์ก็เปลี่ยนไปเลย
 *   จึงวางเป็นสองชั้นที่ใช้แกนเวลาเดียวกันแทน — เทียบรูปทรงได้ตรง ๆ โดยไม่หลอกตา
 */
export function TempVsUsageChart({ points }: { points: DailyUsagePoint[] }): JSX.Element {
  const { t, locale } = useLocale();

  // เอาเฉพาะวันที่เกิดขึ้นจริง — วันที่พยากรณ์ไว้ยังไม่มีค่าอุณหภูมิให้เทียบ
  const rows = points.filter((point) => !point.projected && point.avgTemperatureCelsius !== null);
  const domain: [number, number] = [rows[0]?.timestamp ?? 0, rows[rows.length - 1]?.timestamp ?? 1];

  const temps = rows.map((row) => row.avgTemperatureCelsius ?? 0);
  const tempMin = Math.floor(Math.min(...temps) - 1);
  const tempMax = Math.ceil(Math.max(...temps) + 1);

  const tickFormatter = (value: number): string => new Date(value).getDate().toString();

  return (
    <div className="space-y-1">
      {/* ชั้นบน: อุณหภูมิ */}
      <div>
        <p className="mb-0.5 text-[11px] font-medium" style={{ color: seriesColor(1) }}>
          {t.env.temperature} · °C
        </p>
        <div className="h-[112px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.6} />
              <XAxis {...AXIS_PROPS} dataKey="timestamp" type="number" scale="time" domain={domain} hide />
              <YAxis {...AXIS_PROPS} width={42} domain={[tempMin, tempMax]} />
              <Tooltip
                {...TOOLTIP_STYLE}
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeDasharray: '3 3' }}
                labelFormatter={(value) => formatDate(Number(value), locale)}
                formatter={(value) => [formatTemperature(Number(value), locale), t.env.temperature]}
              />
              <Line
                dataKey="avgTemperatureCelsius"
                stroke={seriesColor(1)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ชั้นล่าง: การใช้น้ำ — แกนเวลาเดียวกัน ตำแหน่งวันจึงตรงกันในแนวตั้ง */}
      <div>
        <p className="mb-0.5 text-[11px] font-medium" style={{ color: seriesColor(0) }}>
          {t.billing.dailyUsage} · m³
        </p>
        <div className="h-[124px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.6} />
              <XAxis
                {...AXIS_PROPS}
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={domain}
                tickFormatter={tickFormatter}
                minTickGap={18}
              />
              <YAxis {...AXIS_PROPS} width={42} />
              <Tooltip
                {...TOOLTIP_STYLE}
                cursor={{ fill: 'hsl(var(--accent))', opacity: 0.5 }}
                labelFormatter={(value) => formatDate(Number(value), locale)}
                formatter={(value) => [formatCubicMeters(Number(value), locale), t.billing.dailyUsage]}
              />
              <Bar dataKey="cubicMeters" fill={seriesColor(0)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
