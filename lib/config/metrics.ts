/**
 * ทะเบียน metric — ไฟล์เดียวที่บอกว่าแต่ละค่าวัด "รวมยังไง แสดงยังไง"
 *
 * ★★ ห้ามมี if (metric === 'temperature') กระจายอยู่ใน component ★★
 *   ถ้าต้องรู้ว่า metric ไหนรวมได้ไม่ได้ ให้ถามไฟล์นี้
 *
 * ★ ชนิดค่า (kind) ที่ใช้จริงมาจาก response ของหลังบ้าน ไม่ใช่จากไฟล์นี้
 *   เพราะหลังบ้านเป็นคนรวมข้อมูล จึงเป็นคนรู้ว่ารวมแบบไหน
 *   ไฟล์นี้เก็บ kind ไว้เพื่อ (1) ใช้ตอน mock (2) เตือนเมื่อ response ไม่ตรงกับที่คาด
 *
 * ★ metric ที่ไม่มีในทะเบียน ต้อง render ได้เสมอ — ใช้ UNKNOWN_METRIC เป็นค่าสำรอง
 *   ทีมหลังบ้านหรือทีม AI เพิ่ม metric ใหม่ได้โดยไม่ต้องรอหน้าบ้าน deploy
 */
import type { Dictionary } from '@/lib/i18n';
import type {
  Locale,
  MetricKey,
  MetricKind,
  SeriesGranularity,
  SystemSettings,
  ThresholdRange,
} from '@/lib/types';
import {
  formatBytes,
  formatCurrent,
  formatEnergy,
  formatFlow,
  formatLiters,
  formatNumber,
  formatPercent,
  formatPower,
  formatPressure,
  formatRainfall,
  formatRssi,
  formatTemperature,
  formatUptime,
  formatVoltage,
} from '@/lib/utils/format';

/** ชนิดกราฟที่เหมาะกับค่าแต่ละแบบ — ตามตารางในสเปก Phase 7.1 */
export type MetricChartShape =
  | 'line_band' // เส้นค่าเฉลี่ย + แถบ min–max (gauge)
  | 'bar' // แท่ง (counter, amount)
  | 'step_band' // เส้นขั้นบันได + แถบ min–max (level)
  | 'state_bar'; // แถบสีตามเวลา (state)

export interface MetricConfig {
  kind: MetricKind;
  /** หน่วยที่แสดงข้าง ๆ ตัวเลข — ค่าว่างแปลว่าไม่มีหน่วย */
  unit: string;
  /** คีย์ใน dictionary หมวด metric */
  labelKey: keyof Dictionary['metric'];
  chart: MetricChartShape;
  /** ลำดับสีใน CHART_SERIES — ห้ามใส่ hex ที่นี่ (BRANDING_SPEC ข้อ 3.7) */
  seriesIndex: 0 | 1;
  /** จัดรูปแบบตัวเลขผ่าน util กลางเท่านั้น */
  format: (value: number, locale: Locale) => string;
  /** ความละเอียดที่ metric นี้ให้ผลมีความหมาย — undefined = ได้ทุกระดับที่ช่วงเวลาอนุญาต */
  granularities?: SeriesGranularity[];
  /** ดึงเกณฑ์จาก settings มาวาดเป็นเส้นอ้างอิง — คืน null เมื่อ metric นี้ไม่มีเกณฑ์ */
  thresholds?: (settings: SystemSettings, sourceId: string) => ThresholdRange | null;
}

const pick = (range: ThresholdRange | undefined): ThresholdRange | null => range ?? null;

export const METRICS: Record<string, MetricConfig> = {
  /* ── ถัง ── */
  level_percent: {
    kind: 'level',
    unit: '%',
    labelKey: 'levelPercent',
    chart: 'step_band',
    seriesIndex: 0,
    format: (v, l) => formatPercent(v, l, 1),
    thresholds: (s, id) => pick(s.thresholds.tankLevelPercent[id]),
  },
  level_liters: {
    kind: 'level',
    unit: 'L',
    labelKey: 'levelLiters',
    chart: 'step_band',
    seriesIndex: 0,
    format: (v, l) => formatLiters(v, l, true),
  },
  net_flow_lpm: {
    kind: 'gauge',
    unit: 'L/min',
    labelKey: 'netFlow',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => formatFlow(v, l, 1),
  },

  /* ── น้ำไหล ── */
  flow_lpm: {
    kind: 'gauge',
    unit: 'L/min',
    labelKey: 'flow',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => formatFlow(v, l, 1),
    thresholds: (s, id) => pick(s.thresholds.zoneFlowLpm[id]),
  },
  pressure_bar: {
    kind: 'gauge',
    unit: 'bar',
    labelKey: 'pressure',
    chart: 'line_band',
    seriesIndex: 0,
    format: formatPressure,
    thresholds: (s) => s.thresholds.pumpPressureBar,
  },

  /* ── ปั๊ม / ไฟฟ้า ── */
  power_watt: {
    kind: 'gauge',
    unit: 'W',
    labelKey: 'power',
    chart: 'line_band',
    seriesIndex: 0,
    format: formatPower,
  },
  current_amp: {
    kind: 'gauge',
    unit: 'A',
    labelKey: 'current',
    chart: 'line_band',
    seriesIndex: 0,
    format: formatCurrent,
    thresholds: (s, id) => pick(s.thresholds.electricCurrentAmp[id]) ?? s.thresholds.pumpCurrentAmp,
  },
  voltage_volt: {
    kind: 'gauge',
    unit: 'V',
    labelKey: 'voltage',
    chart: 'line_band',
    seriesIndex: 0,
    format: formatVoltage,
  },
  energy_kwh: {
    kind: 'counter',
    unit: 'kWh',
    labelKey: 'energy',
    chart: 'bar',
    seriesIndex: 0,
    format: (v, l) => formatEnergy(v, l, 2),
  },
  vfd_frequency_hz: {
    kind: 'gauge',
    unit: 'Hz',
    labelKey: 'vfdFrequency',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => `${formatNumber(v, l, 1)} Hz`,
  },

  /* ── สภาพแวดล้อม ── */
  temperature: {
    kind: 'gauge',
    unit: '°C',
    labelKey: 'temperature',
    chart: 'line_band',
    seriesIndex: 1,
    format: formatTemperature,
    thresholds: (s) => s.thresholds.temperatureCelsius,
  },
  humidity: {
    kind: 'gauge',
    unit: '%RH',
    labelKey: 'humidity',
    chart: 'line_band',
    seriesIndex: 1,
    format: (v, l) => formatPercent(v, l, 0),
    thresholds: (s) => s.thresholds.humidityPercent,
  },
  heat_index: {
    kind: 'gauge',
    unit: '°C',
    labelKey: 'heatIndex',
    chart: 'line_band',
    seriesIndex: 1,
    format: formatTemperature,
  },
  rainfall: {
    kind: 'amount',
    unit: 'mm',
    labelKey: 'rainfall',
    chart: 'bar',
    seriesIndex: 0,
    format: formatRainfall,
  },
  pressure_hpa: {
    kind: 'gauge',
    unit: 'hPa',
    labelKey: 'pressureHpa',
    chart: 'line_band',
    seriesIndex: 1,
    format: (v, l) => `${formatNumber(v, l, 1)} hPa`,
  },
  illuminance_lux: {
    kind: 'gauge',
    unit: 'lux',
    labelKey: 'illuminance',
    chart: 'line_band',
    seriesIndex: 1,
    format: (v, l) => `${formatNumber(v, l, 0)} lux`,
  },

  /* ── สุขภาพอุปกรณ์ ── */
  rssi_dbm: {
    kind: 'gauge',
    unit: 'dBm',
    labelKey: 'rssi',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => formatRssi(v, l),
  },
  uptime_seconds: {
    kind: 'counter',
    unit: 's',
    labelKey: 'uptime',
    chart: 'bar',
    seriesIndex: 0,
    format: (v, l) => formatUptime(v, l),
  },
  free_heap_bytes: {
    kind: 'gauge',
    unit: 'B',
    labelKey: 'freeHeap',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => formatBytes(v, l),
  },

  /* ── ระดับระบบ ── */
  main_inflow_lpm: {
    kind: 'gauge',
    unit: 'L/min',
    labelKey: 'mainInflow',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => formatFlow(v, l, 1),
  },
  zone_outflow_lpm: {
    kind: 'gauge',
    unit: 'L/min',
    labelKey: 'zoneOutflow',
    chart: 'line_band',
    seriesIndex: 1,
    format: (v, l) => formatFlow(v, l, 1),
  },
  unaccounted_percent: {
    kind: 'gauge',
    unit: '%',
    labelKey: 'unaccounted',
    chart: 'line_band',
    seriesIndex: 0,
    format: (v, l) => formatPercent(v, l, 1),
  },
  headcount: {
    kind: 'gauge',
    unit: '',
    labelKey: 'headcount',
    chart: 'line_band',
    seriesIndex: 1,
    format: (v, l) => formatNumber(v, l, 0),
    granularities: ['day', 'week', 'month'],
  },

  /* ── สถานะ ── */
  pump_run_state: {
    kind: 'state',
    unit: '',
    labelKey: 'pumpState',
    chart: 'state_bar',
    seriesIndex: 0,
    format: (v, l) => formatNumber(v, l, 0),
  },
  online_state: {
    kind: 'state',
    unit: '',
    labelKey: 'onlineState',
    chart: 'state_bar',
    seriesIndex: 0,
    format: (v, l) => formatNumber(v, l, 0),
  },
};

/**
 * ค่าสำรองสำหรับ metric ที่ยังไม่มีในทะเบียน
 * ★ ต้อง render ได้เสมอ ห้ามโยน error — หลังบ้าน/ทีม AI เพิ่ม metric ใหม่ได้ตลอด
 */
export const UNKNOWN_METRIC: MetricConfig = {
  kind: 'gauge',
  unit: '',
  labelKey: 'unknown',
  chart: 'line_band',
  seriesIndex: 0,
  format: (v, l) => formatNumber(v, l, 2),
};

export function getMetricConfig(metric: MetricKey | string | undefined): MetricConfig {
  if (metric === undefined) return UNKNOWN_METRIC;
  return METRICS[metric] ?? UNKNOWN_METRIC;
}

export function isKnownMetric(metric: MetricKey | string | undefined): boolean {
  return metric !== undefined && metric in METRICS;
}

/** ป้ายที่จะแสดง — metric ที่ไม่รู้จักให้โชว์คีย์ดิบไปเลย จะได้รู้ว่าต้องไปเติมที่ไหน */
export function metricLabel(
  metric: MetricKey | string | undefined,
  dict: Dictionary,
): string {
  if (metric === undefined) return dict.metric.unknown;
  const config = METRICS[metric];
  if (config === undefined) return metric;
  return dict.metric[config.labelKey];
}
