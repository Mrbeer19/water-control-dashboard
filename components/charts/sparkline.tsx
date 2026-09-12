'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import type { MetricKey, TimeSeriesPoint } from '@/lib/types';
import { CHART } from './chart-tokens';
import { ChartDetail } from './chart-detail';
import type { MetricSourceRef } from './chart-explorer';

/**
 * จำนวนจุดสูงสุดที่วาด — กราฟกว้างราว 150 px การอัดพันจุดลงไปได้แค่กลุ่มเส้นหยึกหยัก
 * ที่อ่านแนวโน้มไม่ออก จึงสุ่มตัวอย่างให้ห่างเท่า ๆ กันแทน
 */
const MAX_POINTS = 90;

interface SparklineProps {
  points: TimeSeriesPoint[];
  /** สีเส้น — ใส่ค่าจาก CHART หรือ token สถานะ */
  color?: string;
  height?: number;
  /** ป้ายกำกับสำหรับ screen reader — กราฟจิ๋วไม่มีแกนให้อ่าน */
  label: string;
  /** หน่วยของค่า ใช้ในหน้าต่างดูข้อมูลละเอียด */
  unit?: string;
  /** ทศนิยมในหน้าต่างดูข้อมูลละเอียด */
  decimals?: number;
  /**
   * ผูกกราฟจิ๋วนี้กับค่าวัดจริง — ส่งมาแล้วหน้าต่างรายละเอียดจะเป็น chart explorer เต็มรูปแบบ
   * ★ ไม่ส่ง = ได้หน้าต่างแบบเดิมที่รวมจาก points ซึ่งย้อนหลังได้แค่เท่าที่การ์ดถืออยู่
   */
  series?: MetricSourceRef;
  /** ค่าวัดอื่นของอุปกรณ์เดียวกันที่สลับดูได้ในหน้าต่างรายละเอียด */
  seriesMetrics?: MetricKey[];
}

/**
 * กราฟเส้นจิ๋วไม่มีแกน ใช้บอกแนวโน้มในการ์ด
 * ต้องมีจุดอย่างน้อย 2 จุดจึงจะวาด ไม่งั้นแสดงเส้นประแทนเพื่อไม่ให้การ์ดยุบ
 */
export function Sparkline({
  points,
  color = CHART.water,
  height = 40,
  label,
  unit = '',
  decimals = 1,
  series,
  seriesMetrics,
}: SparklineProps): JSX.Element {
  if (points.length < 2) {
    return (
      <div
        className="flex w-full items-center justify-center rounded border border-dashed text-[10px] text-muted-foreground"
        style={{ height }}
        role="img"
        aria-label={label}
      >
        —
      </div>
    );
  }

  const step = Math.max(1, Math.ceil(points.length / MAX_POINTS));
  // เก็บจุดสุดท้ายไว้เสมอ เพื่อให้ปลายเส้นตรงกับตัวเลขที่แสดงคู่กัน
  const sampled = step === 1 ? points : points.filter((_, index) => index % step === 0 || index === points.length - 1);

  const values = sampled.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // เผื่อขอบบน-ล่างเล็กน้อย ไม่ให้เส้นแตะขอบกล่องพอดี
  const padding = (max - min) * 0.12 || 1;
  const gradientId = `spark-${label.replace(/\W/g, '')}`;

  return (
    <ChartDetail
      title={label}
      unit={unit}
      decimals={decimals}
      points={points.map((point) => ({ timestamp: point.timestamp, value: point.value }))}
      {...(series === undefined ? {} : { series })}
      {...(seriesMetrics === undefined ? {} : { seriesMetrics })}
    >
    <div className="w-full min-w-0 overflow-hidden" style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={sampled} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[min - padding, max + padding]} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    </ChartDetail>
  );
}
