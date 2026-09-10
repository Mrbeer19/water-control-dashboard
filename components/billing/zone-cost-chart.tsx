'use client';

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ZoneCost } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatBaht, formatCubicMeters, formatNumber } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE } from '@/components/charts/chart-tokens';

/**
 * ค่าน้ำแยกโซน — แท่งนอนเรียงจากมากไปน้อย
 *
 * เป็นการวัด "ขนาด" ของค่าเดียวข้ามหลายหมวด ไม่ใช่การแยก "ตัวตน" ของหลายชุดข้อมูล
 * จึงใช้สีเดียวทั้งกราฟ การไล่สีรุ้งตามโซนจะสื่อความหมายที่ไม่มีอยู่จริง
 * โซนที่มีสถานะผิดปกติเท่านั้นที่เปลี่ยนสีเป็นสีสถานะ
 */
export function ZoneCostChart({ costs }: { costs: ZoneCost[] }): JSX.Element {
  const { locale } = useLocale();
  // ชื่อเต็มอย่าง "โซน 1 — อาคารผลิต A" ยาวเกินกว่าแกนจะรับไหว ตัดเหลือส่วนหน้า
  // แล้วเก็บชื่อเต็มไว้ให้ tooltip แทน
  const rows = [...costs]
    .sort((a, b) => b.costBaht - a.costBaht)
    .map((cost) => ({
      ...cost,
      shortName: (locale === 'th' ? cost.name : cost.nameEn).split('—')[0]?.trim() ?? cost.name,
    }));
  const maxCost = Math.max(...rows.map((row) => row.costBaht), 1);

  return (
    <div style={{ height: rows.length * 32 + 16 }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 52, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={false} opacity={0.6} />
          <XAxis {...AXIS_PROPS} type="number" domain={[0, maxCost * 1.18]} hide />
          <YAxis
            {...AXIS_PROPS}
            type="category"
            dataKey="shortName"
            width={62}
            tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          />
          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'hsl(var(--accent))', opacity: 0.5 }}
            labelFormatter={(_label, payload) => {
              const row = payload[0]?.payload as ZoneCost | undefined;
              return row === undefined ? '' : locale === 'th' ? row.name : row.nameEn;
            }}
            formatter={(value, _name, item) => {
              const row = item.payload as ZoneCost | undefined;
              return [
                `${formatBaht(Number(value), locale, 0)} · ${formatCubicMeters(row?.cubicMeters ?? 0, locale)}`,
                '',
              ];
            }}
          />
          <Bar dataKey="costBaht" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={20}>
            {rows.map((row) => (
              <Cell key={row.zoneId} fill={CHART.sequential} />
            ))}
            {/* ติดตัวเลขที่ปลายแท่งทุกแท่ง เพราะกราฟนี้มีไม่กี่แท่งและตัวเลขคือสิ่งที่คนมาอ่าน */}
            <LabelList
              dataKey="costBaht"
              position="right"
              offset={8}
              formatter={(value: number) => formatNumber(value, locale, 0)}
              style={{ fill: 'hsl(var(--foreground))', fontSize: 11, fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
