'use client';

/**
 * กราฟหลักของ chart explorer — รูปทรงมาจากทะเบียน metric ไม่ใช่จากที่เรียกใช้
 *
 * ★★ อุณหภูมิต้องเป็น "เส้นค่าเฉลี่ย + แถบ min–max" ไม่ใช่กราฟแท่ง ★★
 *   ชนิดกราฟอ่านจาก config.chart ของ lib/config/metrics.ts ที่เดียว
 * ★ bucket ที่ไม่มีข้อมูลต้องเว้นช่อง (value = null + connectNulls={false})
 *   ห้ามตกเป็นศูนย์ เพราะ "ไม่มีข้อมูล" กับ "ใช้ 0" คนละเรื่องกัน
 * ★ สีชุดข้อมูลใช้ได้ 2 สีหลัก + 1 สีอ้างอิง ตาม BRANDING_SPEC ข้อ 3.3
 */
import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricKind, ThresholdRange } from '@/lib/types';
import type { MetricConfig } from '@/lib/config/metrics';
import { useLocale } from '@/lib/i18n';
import { formatNumber } from '@/lib/utils';
import { AXIS_PROPS, CHART, TOOLTIP_STYLE, seriesColor } from '../chart-tokens';
import type { EventMarker, ExplorerRow } from './explorer-types';

/** ชุดข้อมูลที่ซ่อน/แสดงได้จาก legend */
export type SeriesToggle = { value: boolean; band: boolean; compare: boolean; events: boolean };

interface ExplorerChartProps {
  rows: ExplorerRow[];
  config: MetricConfig;
  kind: MetricKind;
  thresholds: ThresholdRange | null;
  markers: EventMarker[];
  toggles: SeriesToggle;
  /** กดที่แท่ง/จุดเพื่อเจาะลึก — ไม่ส่งมาแปลว่าชั้นนี้เจาะต่อไม่ได้ */
  onDrill?: (row: ExplorerRow) => void;
}

interface ChartRow extends ExplorerRow {
  /** คู่ [ต่ำสุด, สูงสุด] สำหรับ Area แบบช่วง — null เมื่อชนิดค่านี้ไม่มีแถบ */
  band: [number, number] | null;
}

const MARKER_COLOR: Record<EventMarker['kind'], string> = {
  alert: CHART.critical,
  anomaly: CHART.warning,
  command: CHART.info,
  offline: CHART.offline,
};

export function ExplorerChart({
  rows,
  config,
  kind,
  thresholds,
  markers,
  toggles,
  onDrill,
}: ExplorerChartProps): JSX.Element {
  const { t, locale } = useLocale();

  const data = useMemo<ChartRow[]>(
    () =>
      rows.map((row) => ({
        ...row,
        band: row.low === null || row.high === null ? null : [row.low, row.high],
      })),
    [rows],
  );

  const color = seriesColor(config.seriesIndex);
  const shape = config.chart;
  const showBand = toggles.band && (shape === 'line_band' || shape === 'step_band');
  const partial = rows.filter((row) => row.isPartial);

  /** หา label ของ bucket ที่ครอบเวลานั้น — แกน x เป็นหมวดหมู่ จึงอ้างด้วย label ไม่ใช่ตัวเลข */
  const labelAt = (at: number): string | null => {
    let found: ExplorerRow | null = null;
    for (const row of rows) {
      if (row.start <= at) found = row;
      else break;
    }
    return found?.label ?? null;
  };

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onClick={(state) => {
            if (onDrill === undefined) return;
            const index = typeof state.activeTooltipIndex === 'number' ? state.activeTooltipIndex : -1;
            const row = rows[index];
            if (row !== undefined && row.canDrill) onDrill(row);
          }}
        >
          <CartesianGrid stroke={CHART.border} strokeDasharray="3 3" vertical={false} />
          <XAxis {...AXIS_PROPS} dataKey="label" interval="preserveStartEnd" minTickGap={20} />
          {/* ★ กราฟแท่งต้องเริ่มที่ศูนย์เสมอ ไม่งั้นความสูงของแท่งจะโกหก
                 ส่วนค่าที่ไม่ได้เริ่มจากศูนย์โดยธรรมชาติ (อุณหภูมิ, แรงดันไฟ) ให้ปล่อยอัตโนมัติ
                 ไม่งั้นช่วง 25–36°C จะถูกบีบจนอ่านการเปลี่ยนแปลงไม่ออก */}
          <YAxis {...AXIS_PROPS} width={56} domain={shape === 'bar' || shape === 'state_bar' ? [0, 'auto'] : ['auto', 'auto']} />

          {/* ช่วงที่ยังไม่จบ — ขีดเส้นกำกับไว้ จะได้ไม่อ่านว่าค่าตกจริง */}
          {partial.map((row) => (
            <ReferenceLine
              key={`partial:${row.start}`}
              x={row.label}
              stroke={CHART.muted}
              strokeDasharray="2 4"
              label={{ value: t.chart.partial, position: 'insideTopLeft', fontSize: 10, fill: CHART.muted }}
            />
          ))}

          {/* ช่วง offline + หมุดเหตุการณ์ */}
          {toggles.events &&
            markers.map((marker) => {
              const x = labelAt(marker.at);
              if (x === null) return null;
              if (marker.kind === 'offline' && marker.until !== null) {
                const x2 = labelAt(marker.until) ?? x;
                return (
                  // ★ พื้นเป็นสีกลาง ขอบเป็นสีสถานะแบบทึบ — ข้อ 3 ห้ามใช้ opacity กับพื้น/ขอบของสถานะ
                  <ReferenceArea
                    key={marker.id}
                    x1={x}
                    x2={x2}
                    fill="hsl(var(--secondary))"
                    stroke={CHART.offline}
                    strokeDasharray="3 3"
                  />
                );
              }
              return (
                <ReferenceLine
                  key={marker.id}
                  x={x}
                  stroke={MARKER_COLOR[marker.kind]}
                  strokeDasharray="2 2"
                  strokeWidth={1.5}
                />
              );
            })}

          {/* เส้นเกณฑ์จากหน้าตั้งค่า */}
          {thresholds !== null &&
            (
              [
                ['criticalLow', CHART.critical],
                ['warningLow', CHART.warning],
                ['warningHigh', CHART.warning],
                ['criticalHigh', CHART.critical],
              ] as const
            ).map(([field, stroke]) => {
              const value = thresholds[field];
              if (value === null) return null;
              return (
                <ReferenceLine
                  key={field}
                  y={value}
                  stroke={stroke}
                  strokeDasharray="4 3"
                  label={{ value: t.chart.threshold, position: 'insideTopRight', fontSize: 10, fill: CHART.muted }}
                />
              );
            })}

          {showBand && (
            <Area
              dataKey="band"
              stroke="none"
              fill={CHART.waterSoft}
              isAnimationActive={false}
              connectNulls={false}
              name={`${t.chart.statMin}–${t.chart.statMax}`}
            />
          )}

          {toggles.compare && (
            <Line
              dataKey="compareValue"
              stroke={CHART.reference}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
              name={t.chart.compareSeries}
            />
          )}

          {toggles.value &&
            (shape === 'bar' || shape === 'state_bar' ? (
              <Bar
                dataKey="value"
                fill={color}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
                name={t.chart.current}
                cursor={onDrill === undefined ? undefined : 'pointer'}
              />
            ) : (
              <Line
                dataKey="value"
                type={shape === 'step_band' ? 'stepAfter' : 'monotone'}
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
                name={t.chart.current}
              />
            ))}

          <Tooltip
            {...TOOLTIP_STYLE}
            cursor={{ fill: 'hsl(var(--accent))' }}
            content={({ active, payload }) => {
              if (active !== true || payload === undefined || payload.length === 0) return null;
              const row = payload[0]?.payload as ChartRow | undefined;
              if (row === undefined) return null;
              const text = (value: number | null): string =>
                value === null
                  ? t.chart.noDataInRange
                  : kind === 'state'
                    ? `${formatNumber(value, locale, 1)} ${t.chart.unitHours}`
                    : config.format(value, locale);
              return (
                <div style={TOOLTIP_STYLE.contentStyle}>
                  <p style={TOOLTIP_STYLE.labelStyle}>{row.rangeLabel}</p>
                  <p className="tabular font-semibold">{text(row.value)}</p>
                  {row.band !== null && (
                    <p className="tabular text-[11px] text-muted-foreground">
                      {t.chart.statMin} {config.format(row.band[0], locale)} · {t.chart.statMax}{' '}
                      {config.format(row.band[1], locale)}
                    </p>
                  )}
                  {row.compareValue !== null && (
                    <p className="tabular text-[11px] text-muted-foreground">
                      {t.chart.compareSeries} {text(row.compareValue)}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {t.chart.completeness} {formatNumber(row.completeness * 100, locale, 0)}%
                    {row.isPartial ? ` · ${t.chart.partial}` : ''}
                  </p>
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
