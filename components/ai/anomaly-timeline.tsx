'use client';

import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import type { AlertSeverity, AnomalyEvent, DailyUsagePoint } from '@/lib/types';
import { getAnomalyTypeConfig } from '@/lib/config/anomaly-types';
import { useLocale } from '@/lib/i18n';
import { formatCubicMeters, formatDate, formatNumber } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE } from '@/components/charts/chart-tokens';
import { ChartDetail } from '@/components/charts/chart-detail';

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: CHART.critical,
  warning: CHART.warning,
  info: CHART.info,
};

/**
 * B — ไทม์ไลน์ 7 วัน: จุดที่ตรวจพบความผิดปกติ ซ้อนบนกราฟการใช้น้ำรวมรายวัน
 *
 * ทั้งสองชุดใช้แกนเวลาเดียวกัน ส่วนจุด anomaly วางที่ความสูงคงที่เหนือแท่ง
 * ไม่ได้ผูกกับค่าแกน y จึงไม่ใช่กราฟสองแกน — จุดบอกแค่ "เกิดเมื่อไร" ไม่ได้บอกขนาด
 */
export function AnomalyTimeline({
  anomalies,
  daily,
}: {
  anomalies: AnomalyEvent[];
  daily: DailyUsagePoint[];
}): JSX.Element | null {
  const { t, locale } = useLocale();

  const cutoff = Date.now() - 7 * 86_400_000;
  const days = daily.filter((point) => point.timestamp >= cutoff);
  if (days.length === 0) return null;

  const maxUsage = Math.max(...days.map((point) => point.cubicMeters), 1);
  // วางจุด anomaly เหนือยอดแท่งเล็กน้อย แล้วปัดเพดานแกนให้เป็นเลขกลม
  const markerY = maxUsage * 1.12;
  const axisMax = Math.ceil((markerY * 1.06) / 50) * 50;

  // โดเมนแกนเวลาต้องเป็นตัวเลขจริง — เขียนเป็นสตริงแบบ 'dataMin - x' ทำให้แท่งกองซ้อนกัน
  const timestamps = days.map((point) => point.timestamp);
  const halfDay = 43_200_000;
  const xDomain: [number, number] = [
    Math.min(...timestamps) - halfDay,
    Math.max(...timestamps) + halfDay,
  ];

  // จับ anomaly ลงวันของมัน เพื่อให้จุดตรงกับแท่งในแนวตั้ง
  const markers = anomalies
    .filter((anomaly) => new Date(anomaly.detectedAt).getTime() >= cutoff)
    .map((anomaly) => {
      const at = new Date(anomaly.detectedAt);
      at.setHours(12, 0, 0, 0);
      return {
        timestamp: at.getTime(),
        marker: markerY,
        severity: anomaly.severity ?? 'info',
        label: getAnomalyTypeConfig(anomaly.type)[locale === 'th' ? 'labelTh' : 'labelEn'],
      };
    });

  const rows = days.map((point) => ({ timestamp: point.timestamp, cubicMeters: point.cubicMeters }));

  return (
    <ChartDetail
      title={t.ai.timeline}
      unit="m³"
      points={rows.map((row) => ({ timestamp: row.timestamp, value: row.cubicMeters }))}
      decimals={1}
    >
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{t.ai.timelineHint}</p>
      <div className="h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.5} />
            <XAxis
              {...AXIS_PROPS}
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={xDomain}
              ticks={timestamps}
              tickFormatter={(value: number) => formatDate(value, locale).replace(/\s?\d{4}$/, '')}
              interval={0}
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
            />
            <YAxis
              {...AXIS_PROPS}
              width={42}
              domain={[0, axisMax]}
              tickFormatter={(value: number) => formatNumber(value, locale)}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              cursor={{ fill: 'hsl(var(--accent))', opacity: 0.4 }}
              labelFormatter={(value) => formatDate(Number(value), locale)}
              formatter={(value, name) => {
                if (name === 'marker') return [];
                return [formatCubicMeters(Number(value), locale), t.billing.dailyUsage];
              }}
            />
            <Bar dataKey="cubicMeters" fill={CHART.water} fillOpacity={0.45} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={30} />
            <Scatter data={markers} dataKey="marker" isAnimationActive={false} shape="circle">
              {markers.map((marker, index) => (
                <Cell key={`${marker.timestamp}-${index}`} fill={SEVERITY_COLOR[marker.severity]} />
              ))}
            </Scatter>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
    </ChartDetail>
  );
}
