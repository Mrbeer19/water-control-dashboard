/**
 * ข้อมูลย้อนหลังสำหรับ chart explorer — สร้างตามสูตร ไม่ได้เก็บเป็นอาร์เรย์
 *
 * ★★ ทำไมไม่เก็บจุดไว้จริง ★★
 *   สเปกต้องการดิบ 48 ชม. · ราย 5 นาที 7 วัน · รายชั่วโมง 90 วัน · รายวัน 2 ปี
 *   ถ้าเก็บจุดดิบทุก 2 วินาทีย้อนหลัง 2 ปี = 31 ล้านจุดต่อหนึ่ง metric ต่อหนึ่งอุปกรณ์
 *   จึงเก็บเป็น "ฟังก์ชันของเวลา" แล้วคำนวณเฉพาะช่วงที่ถูกขอ — ได้ความลึกไม่จำกัด
 *   deterministic เพราะ noise มาจาก hash ของ (id, metric, ช่วงเวลา) ไม่ใช่ Math.random()
 *
 * ★★ ทำไมรวมจากชั้นรายชั่วโมงขึ้นไป ★★
 *   สเปกข้อ 7.3 บังคับว่า ผลรวม 24 bucket รายชั่วโมง ต้องเท่ากับ bucket รายวัน
 *   และค่าเฉลี่ยรายวันต้องเป็นค่าเฉลี่ยถ่วงน้ำหนักด้วย count
 *   ถ้าคำนวณรายวันแยกจากรายชั่วโมง ตัวเลขจะไม่มีทางตรงกันเป๊ะ
 *   จึงคำนวณชั้นรายชั่วโมงเป็นฐาน แล้ว "ม้วนรวม" ขึ้นไปเป็นวัน/สัปดาห์/เดือน/ปี
 *   ซึ่งเป็นวิธีเดียวกับที่หลังบ้านควรทำด้วย rollup table
 */
import type {
  AggregatedSeriesPoint,
  AmountBucket,
  CounterBucket,
  GaugeBucket,
  LevelBucket,
  MetricKind,
  SeriesGranularity,
  StateBucket,
  StateSpan,
} from '@/lib/types';
import { NO_DATA_STATE } from '@/lib/types';
import { MS, bucketStart, bucketStarts, nextBucketStart } from '@/lib/utils/time-buckets';

/** คาบการส่งค่าของเซนเซอร์จริง ใช้คิด expectedCount */
export const SAMPLE_MS = 2_000;

/** จำนวนตัวอย่างที่ประเมินต่อหนึ่งชั่วโมง — 30 จุด = ทุก 2 นาที พอสำหรับหาค่าเฉลี่ย/ต่ำสุด/สูงสุด */
const SAMPLES_PER_HOUR = 30;

/* ───────────────────────── สุ่มแบบคงที่ ───────────────────────── */

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** noise ที่ต่อเนื่อง — สุ่มที่จุดยึดทุก stepMs แล้วไล่ระดับระหว่างจุด ไม่กระโดด */
function smoothNoise(seed: string, t: number, stepMs: number): number {
  const index = Math.floor(t / stepMs);
  const frac = (t - index * stepMs) / stepMs;
  const a = hash32(`${seed}:${index}`);
  const b = hash32(`${seed}:${index + 1}`);
  const eased = frac * frac * (3 - 2 * frac); // smoothstep
  return a + (b - a) * eased;
}

/* ───────────────────────── รูปแบบตามเวลา ───────────────────────── */

/** ชั่วโมงและวันในสัปดาห์ตามเวลาไทย — ใช้ offset คงที่เพราะ Asia/Bangkok ไม่มี DST */
const TH_OFFSET = 7 * MS.hour;

function thHour(t: number): number {
  return ((t + TH_OFFSET) % MS.day) / MS.hour;
}
function thWeekday(t: number): number {
  // 1970-01-01 เป็นวันพฤหัส → +4 ให้ 0 = อาทิตย์
  return Math.floor((t + TH_OFFSET) / MS.day + 4) % 7;
}
function dayOfYear(t: number): number {
  const d = new Date(t + TH_OFFSET);
  return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / MS.day;
}

/** กะทำงาน: ใช้น้ำเยอะ 08:00–17:00 · กลางคืนต่ำ · วันอาทิตย์เหลือน้อย */
function shiftFactor(t: number): number {
  const h = thHour(t);
  const weekday = thWeekday(t);
  const work = h >= 7.5 && h < 17.5 ? 1 : h >= 5.5 && h < 7.5 ? 0.55 : h >= 17.5 && h < 20 ? 0.5 : 0.14;
  const weekly = weekday === 0 ? 0.25 : weekday === 6 ? 0.6 : 1;
  return work * weekly;
}

/** ฤดูกาล: ร้อน มี.ค.–พ.ค. · ฝน มิ.ย.–ต.ค. */
function seasonFactor(t: number): number {
  const doy = dayOfYear(t);
  return 1 + 0.12 * Math.sin(((doy - 80) / 365) * 2 * Math.PI);
}
function isRainySeason(t: number): boolean {
  const month = new Date(t + TH_OFFSET).getUTCMonth() + 1;
  return month >= 6 && month <= 10;
}

/**
 * ช่วงที่อุปกรณ์ออฟไลน์ — deterministic ประมาณสัปดาห์ละครั้ง
 * ★ ส่วนใหญ่หลุดสั้น 20–70 นาที แต่บางครั้งหลุดยาว 2–6 ชั่วโมง (ไฟดับ, AP ล่ม)
 *   ต้องมีเคสยาวด้วย ไม่งั้นจะไม่มีชั่วโมงไหนว่างทั้งชั่วโมงให้กราฟแสดงช่องว่างเลย
 */
function isOffline(sourceId: string, t: number): boolean {
  const week = Math.floor(t / (7 * MS.day));
  const r = hash32(`offline:${sourceId}:${week}`);
  if (r > 0.55) return false; // ไม่ใช่ทุกสัปดาห์ที่หลุด
  const startOffset = hash32(`offline-start:${sourceId}:${week}`) * 7 * MS.day;
  const longOutage = hash32(`offline-long:${sourceId}:${week}`) < 0.35;
  const duration = longOutage
    ? 2 * MS.hour + hash32(`offline-dur:${sourceId}:${week}`) * 4 * MS.hour
    : 20 * MS.minute + hash32(`offline-dur:${sourceId}:${week}`) * 50 * MS.minute;
  const start = week * 7 * MS.day + startOffset;
  return t >= start && t < start + duration;
}

/* ───────────────────────── ค่าของแต่ละ metric ───────────────────────── */

interface SignalSpec {
  kind: MetricKind;
  /** ค่าทันที ณ เวลา t (สำหรับ gauge/level) หรืออัตราต่อชั่วโมง (สำหรับ counter/amount) */
  at: (t: number, id: string) => number;
}

const SIGNALS: Record<string, SignalSpec> = {
  flow_lpm: {
    kind: 'gauge',
    at: (t, id) => {
      const base = 18 + hash32(`base:${id}`) * 26;
      const n = 0.85 + smoothNoise(`flow:${id}`, t, 6 * MS.minute) * 0.3;
      return Math.max(0, base * shiftFactor(t) * seasonFactor(t) * n);
    },
  },
  main_inflow_lpm: {
    kind: 'gauge',
    at: (t) => 210 * shiftFactor(t) * seasonFactor(t) * (0.9 + smoothNoise('main', t, 8 * MS.minute) * 0.2),
  },
  zone_outflow_lpm: {
    kind: 'gauge',
    at: (t) => 196 * shiftFactor(t) * seasonFactor(t) * (0.9 + smoothNoise('zoneout', t, 8 * MS.minute) * 0.2),
  },
  temperature: {
    kind: 'gauge',
    at: (t, id) => {
      const h = thHour(t);
      // ต่ำสุดตี 5 สูงสุดบ่ายสาม
      const daily = -Math.cos(((h - 5) / 24) * 2 * Math.PI) * 4.5;
      const seasonal = isRainySeason(t) ? -1.2 : 1.8;
      const indoor = id.includes('pump') || id.includes('panel') ? 3.5 : 0;
      return 27.5 + daily + seasonal + indoor + smoothNoise(`temp:${id}`, t, 20 * MS.minute) * 1.6;
    },
  },
  humidity: {
    kind: 'gauge',
    at: (t, id) => {
      const h = thHour(t);
      const daily = Math.cos(((h - 5) / 24) * 2 * Math.PI) * 11;
      const seasonal = isRainySeason(t) ? 8 : -4;
      return Math.min(98, Math.max(28, 62 + daily + seasonal + smoothNoise(`hum:${id}`, t, 25 * MS.minute) * 6));
    },
  },
  heat_index: {
    kind: 'gauge',
    at: (t, id) => (SIGNALS.temperature?.at(t, id) ?? 30) + 2.4 + smoothNoise(`hi:${id}`, t, 30 * MS.minute),
  },
  pressure_hpa: {
    kind: 'gauge',
    at: (t, id) => 1009 + smoothNoise(`hpa:${id}`, t, 3 * MS.hour) * 6 - (isRainySeason(t) ? 2 : 0),
  },
  illuminance_lux: {
    kind: 'gauge',
    at: (t, id) => {
      const h = thHour(t);
      if (h < 6 || h > 18.5) return 0;
      const arc = Math.sin(((h - 6) / 12.5) * Math.PI);
      const cloud = isRainySeason(t) ? 0.45 : 0.85;
      return Math.max(0, 95_000 * arc * cloud * (0.6 + smoothNoise(`lux:${id}`, t, 15 * MS.minute) * 0.6));
    },
  },
  power_watt: {
    kind: 'gauge',
    at: (t, id) => {
      if (!pumpRunning(t, id)) return 0;
      const rated = 2_100 + hash32(`rated:${id}`) * 900;
      // pump_degrading: กินไฟเพิ่มขึ้นช้า ๆ ตามเวลา
      const wear = 1 + ((t % (180 * MS.day)) / (180 * MS.day)) * 0.06;
      return rated * wear * (0.94 + smoothNoise(`pw:${id}`, t, 4 * MS.minute) * 0.12);
    },
  },
  current_amp: {
    kind: 'gauge',
    at: (t, id) => (SIGNALS.power_watt?.at(t, id) ?? 0) / 380 / 1.6,
  },
  voltage_volt: {
    kind: 'gauge',
    at: (t, id) => 382 + smoothNoise(`v:${id}`, t, 12 * MS.minute) * 5 - (shiftFactor(t) > 0.8 ? 2.5 : 0),
  },
  vfd_frequency_hz: {
    kind: 'gauge',
    at: (t, id) => (pumpRunning(t, id) ? 34 + smoothNoise(`hz:${id}`, t, 5 * MS.minute) * 14 : 0),
  },
  pressure_bar: {
    kind: 'gauge',
    at: (t, id) => 3.05 + smoothNoise(`bar:${id}`, t, 7 * MS.minute) * 0.5 - shiftFactor(t) * 0.25,
  },
  level_percent: {
    kind: 'level',
    at: (t, id) => {
      const period = 5.5 * MS.hour + hash32(`period:${id}`) * 3 * MS.hour;
      const phase = ((t + hash32(`phase:${id}`) * period) % period) / period;
      const saw = phase < 0.65 ? 0.55 + phase * 0.62 : 0.97 - (phase - 0.65) * 1.3;
      return Math.min(99, Math.max(12, saw * 100 - shiftFactor(t) * 6));
    },
  },
  rssi_dbm: {
    kind: 'gauge',
    at: (t, id) => -52 - hash32(`rssi:${id}`) * 22 + smoothNoise(`r:${id}`, t, 10 * MS.minute) * 7,
  },
  free_heap_bytes: {
    kind: 'gauge',
    at: (t, id) => 148_000 + smoothNoise(`heap:${id}`, t, 30 * MS.minute) * 32_000,
  },
  headcount: {
    kind: 'gauge',
    at: (t) => Math.round(38 * shiftFactor(t) + 6),
  },
  unaccounted_percent: {
    kind: 'gauge',
    at: (t, id) => Math.max(0, 4.5 + smoothNoise(`unacc:${id}`, t, 2 * MS.hour) * 4 + nightLeakBoost(t)),
  },
  // ── counter: ฟังก์ชันเป็น "อัตราต่อชั่วโมง" แล้วค่อยอินทิเกรตตอนรวมช่วง ──
  energy_kwh: {
    kind: 'counter',
    at: (t, id) => (SIGNALS.power_watt?.at(t, id) ?? 0) / 1000,
  },
  uptime_seconds: {
    kind: 'counter',
    at: () => 3600,
  },
  // ── amount ──
  rainfall: {
    kind: 'amount',
    at: (t, id) => {
      if (!isRainySeason(t)) return hash32(`dry:${id}:${Math.floor(t / MS.day)}`) > 0.95 ? 1.2 : 0;
      const h = thHour(t);
      const afternoon = h >= 13 && h <= 19 ? 1 : 0.25;
      const wet = smoothNoise(`rain:${id}`, t, 45 * MS.minute);
      return wet > 0.72 ? (wet - 0.72) * 26 * afternoon : 0;
    },
  },
  net_flow_lpm: {
    kind: 'gauge',
    at: (t, id) => (SIGNALS.main_inflow_lpm?.at(t, id) ?? 0) - (SIGNALS.zone_outflow_lpm?.at(t, id) ?? 0),
  },
};

/** night_leak: โซนที่มีรั่วจะเห็นน้ำไหลกลางดึกในข้อมูลย้อนหลังด้วย */
function nightLeakBoost(t: number): number {
  const h = thHour(t);
  return h >= 1 && h <= 4 ? 2.2 : 0;
}

/** ปั๊มเดินเป็นรอบ — deterministic ตาม id และเวลา */
function pumpRunning(t: number, id: string): boolean {
  if (isOffline(id, t)) return false;
  const cycle = 42 * MS.minute + hash32(`cycle:${id}`) * 40 * MS.minute;
  const onRatio = 0.32 + shiftFactor(t) * 0.42;
  const phase = ((t + hash32(`pphase:${id}`) * cycle) % cycle) / cycle;
  return phase < onRatio;
}

function signalFor(metric: string): SignalSpec {
  return (
    SIGNALS[metric] ?? {
      kind: 'gauge',
      at: (t, id) => 50 + smoothNoise(`fallback:${id}:${metric}`, t, 15 * MS.minute) * 20,
    }
  );
}

/* ───────────────────────── ชั้นรายชั่วโมง (ฐานของทุกอย่าง) ───────────────────────── */

interface HourStats {
  timestamp: number;
  count: number;
  expectedCount: number;
  sum: number; // ผลรวมของค่าตัวอย่าง ใช้คิด avg แบบถ่วงน้ำหนัก
  min: number | null;
  max: number | null;
  minAt: number | null;
  maxAt: number | null;
  last: number | null;
  /** counter/amount: ปริมาณที่เกิดขึ้นในชั่วโมงนี้ */
  delta: number;
}

const hourCache = new Map<string, HourStats>();

function hourStats(sourceId: string, metric: string, hourStartMs: number): HourStats {
  const cacheKey = `${sourceId}|${metric}|${hourStartMs}`;
  const cached = hourCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const signal = signalFor(metric);
  const stepMs = MS.hour / SAMPLES_PER_HOUR;
  const expectedCount = Math.round(MS.hour / SAMPLE_MS);

  let count = 0;
  let sum = 0;
  let delta = 0;
  let min: number | null = null;
  let max: number | null = null;
  let minAt: number | null = null;
  let maxAt: number | null = null;
  let last: number | null = null;

  for (let i = 0; i < SAMPLES_PER_HOUR; i += 1) {
    const t = hourStartMs + i * stepMs;
    if (isOffline(sourceId, t)) continue;
    const value = signal.at(t, sourceId);
    count += 1;
    sum += value;
    last = value;
    if (min === null || value < min) {
      min = value;
      minAt = t;
    }
    if (max === null || value > max) {
      max = value;
      maxAt = t;
    }
    // counter/amount: อินทิเกรตอัตราต่อชั่วโมง × สัดส่วนเวลาของตัวอย่างนี้
    delta += value * (stepMs / MS.hour);
  }

  const stats: HourStats = {
    timestamp: hourStartMs,
    // ปรับ count ให้อยู่ในสเกลของตัวอย่างจริงที่เซนเซอร์ส่ง ไม่ใช่จำนวนที่เราประเมิน
    count: Math.round((count / SAMPLES_PER_HOUR) * expectedCount),
    expectedCount,
    sum,
    min,
    max,
    minAt,
    maxAt,
    last,
    delta,
  };
  if (hourCache.size > 40_000) hourCache.clear();
  hourCache.set(cacheKey, stats);
  return stats;
}

/* ───────────────────────── ประกอบเป็น bucket ตามความละเอียด ───────────────────────── */

function emptyBucket(kind: MetricKind, timestamp: number, expectedCount: number, isPartial: boolean): AggregatedSeriesPoint {
  const base = { timestamp, count: 0, expectedCount, isPartial };
  if (kind === 'counter') return { ...base, kind: 'counter', delta: null, resetDetected: false };
  if (kind === 'amount') return { ...base, kind: 'amount', sum: null, max: null };
  if (kind === 'level') return { ...base, kind: 'level', last: null, min: null, max: null };
  if (kind === 'state') return { ...base, kind: 'state', durationsMs: {}, entries: {} };
  return { ...base, kind: 'gauge', avg: null, min: null, max: null, minAt: null, maxAt: null };
}

function combine(kind: MetricKind, hours: HourStats[], timestamp: number, isPartial: boolean): AggregatedSeriesPoint {
  const count = hours.reduce((acc, h) => acc + h.count, 0);
  const expectedCount = hours.reduce((acc, h) => acc + h.expectedCount, 0);
  if (count === 0) return emptyBucket(kind, timestamp, expectedCount, isPartial);

  const withData = hours.filter((h) => h.count > 0);
  const base = { timestamp, count, expectedCount, isPartial };

  if (kind === 'counter') {
    return { ...base, kind: 'counter', delta: round(hours.reduce((a, h) => a + h.delta, 0), 3), resetDetected: false };
  }
  if (kind === 'amount') {
    return {
      ...base,
      kind: 'amount',
      sum: round(hours.reduce((a, h) => a + h.delta, 0), 3),
      max: round(Math.max(...withData.map((h) => h.max ?? 0)), 3),
    };
  }
  if (kind === 'level') {
    const lastHour = withData[withData.length - 1];
    return {
      ...base,
      kind: 'level',
      last: round(lastHour?.last ?? null, 2),
      min: round(Math.min(...withData.map((h) => h.min ?? 0)), 2),
      max: round(Math.max(...withData.map((h) => h.max ?? 0)), 2),
    };
  }
  if (kind === 'state') return { ...base, kind: 'state', durationsMs: {}, entries: {} };

  // gauge — ค่าเฉลี่ยถ่วงน้ำหนักด้วย count ตามที่สเปกบังคับ
  const weighted = withData.reduce((acc, h) => acc + (h.sum / SAMPLES_PER_HOUR) * h.count, 0);
  const lowest = withData.reduce((best, h) => (best === null || (h.min ?? 0) < (best.min ?? 0) ? h : best), null as HourStats | null);
  const highest = withData.reduce((best, h) => (best === null || (h.max ?? 0) > (best.max ?? 0) ? h : best), null as HourStats | null);
  return {
    ...base,
    kind: 'gauge',
    avg: round(weighted / count, 3),
    min: round(lowest?.min ?? null, 3),
    max: round(highest?.max ?? null, 3),
    minAt: lowest?.minAt ?? null,
    maxAt: highest?.maxAt ?? null,
  };
}

function round(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** ตัวอย่างละเอียดกว่ารายชั่วโมง (raw / 5 นาที / 15 นาที) — คำนวณตรงจากสัญญาณ */
function fineBucket(
  sourceId: string,
  metric: string,
  kind: MetricKind,
  start: number,
  end: number,
  isPartial: boolean,
): AggregatedSeriesPoint {
  const signal = signalFor(metric);
  const span = end - start;
  const steps = Math.max(1, Math.min(30, Math.round(span / SAMPLE_MS)));
  const stepMs = span / steps;
  const expectedCount = Math.max(1, Math.round(span / SAMPLE_MS));

  let count = 0;
  let sum = 0;
  let delta = 0;
  let min: number | null = null;
  let max: number | null = null;
  let minAt: number | null = null;
  let maxAt: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < steps; i += 1) {
    const t = start + i * stepMs;
    if (isOffline(sourceId, t)) continue;
    const value = signal.at(t, sourceId);
    count += 1;
    sum += value;
    last = value;
    if (min === null || value < min) { min = value; minAt = t; }
    if (max === null || value > max) { max = value; maxAt = t; }
    delta += value * (stepMs / MS.hour);
  }
  const scaledCount = Math.round((count / steps) * expectedCount);
  if (count === 0) return emptyBucket(kind, start, expectedCount, isPartial);
  const base = { timestamp: start, count: scaledCount, expectedCount, isPartial };
  if (kind === 'counter') return { ...base, kind: 'counter', delta: round(delta, 4), resetDetected: false };
  if (kind === 'amount') return { ...base, kind: 'amount', sum: round(delta, 4), max: round(max, 3) };
  if (kind === 'level') return { ...base, kind: 'level', last: round(last, 2), min: round(min, 2), max: round(max, 2) };
  if (kind === 'state') return { ...base, kind: 'state', durationsMs: {}, entries: {} };
  return { ...base, kind: 'gauge', avg: round(sum / count, 3), min: round(min, 3), max: round(max, 3), minAt, maxAt };
}

/**
 * สร้างชุดข้อมูลรวมช่วงของหนึ่ง metric
 * ★ คืนครบทุกช่วงรวมช่วงที่ไม่มีข้อมูล (count = 0) เพื่อให้กราฟมีช่องว่างให้เห็น
 */
export function buildMetricSeries(params: {
  sourceId: string;
  metric: string;
  kind: MetricKind;
  from: number;
  to: number;
  granularity: SeriesGranularity;
  timezone: string;
  now: number;
}): AggregatedSeriesPoint[] {
  const { sourceId, metric, kind, from, to, granularity, timezone, now } = params;
  const starts = bucketStarts(from, to, granularity, timezone);

  if (kind === 'state') {
    return starts.map((start) => {
      const end = nextBucketStart(start, granularity, timezone);
      return stateBucket(sourceId, start, Math.min(end, to), end > now);
    });
  }

  const fine = granularity === 'raw' || granularity === 'minute_5' || granularity === 'minute_15';
  return starts.map((start) => {
    const end = nextBucketStart(start, granularity, timezone);
    const isPartial = end > now;
    if (fine) return fineBucket(sourceId, metric, kind, start, end, isPartial);
    const hours: HourStats[] = [];
    for (let t = bucketStart(start, 'hour', timezone); t < end; t = t + MS.hour) {
      if (t > now) break;
      hours.push(hourStats(sourceId, metric, t));
    }
    if (hours.length === 0) return emptyBucket(kind, start, Math.round((end - start) / SAMPLE_MS), isPartial);
    return combine(kind, hours, start, isPartial);
  });
}

/* ───────────────────────── สถานะ ───────────────────────── */

const PUMP_STATES = ['running', 'stopped'] as const;

function stateBucket(sourceId: string, start: number, end: number, isPartial: boolean): StateBucket {
  const spans = buildStateSpans({ sourceId, from: start, to: end });
  const durationsMs: Record<string, number> = {};
  const entries: Record<string, number> = {};
  for (const span of spans) {
    durationsMs[span.state] = (durationsMs[span.state] ?? 0) + span.durationMs;
    entries[span.state] = (entries[span.state] ?? 0) + 1;
  }
  return {
    kind: 'state',
    timestamp: start,
    count: spans.length,
    expectedCount: Math.max(1, Math.round((end - start) / SAMPLE_MS)),
    isPartial,
    durationsMs,
    entries,
  };
}

/**
 * ช่วงสถานะที่ต่อกันไม่มีรู — ช่วงที่ไม่มีข้อมูลใช้ state 'no_data'
 * ★ ผลรวม durationMs ต้องเท่ากับความยาวช่วงที่ขอพอดี (สเปกบังคับ)
 * ★ span ที่คร่อมขอบถูกตัดให้อยู่ใน from–to
 */
export function buildStateSpans(params: { sourceId: string; from: number; to: number }): StateSpan[] {
  const { sourceId, from, to } = params;
  const stepMs = MS.minute; // ความละเอียดที่ใช้ไล่หารอยต่อของสถานะ
  const spans: StateSpan[] = [];
  let cursor = from;
  let currentState = stateAt(sourceId, from);
  let spanStart = from;

  while (cursor < to) {
    const next = Math.min(cursor + stepMs, to);
    const state = stateAt(sourceId, next);
    if (state !== currentState) {
      spans.push({ from: spanStart, to: next, state: currentState, durationMs: next - spanStart });
      spanStart = next;
      currentState = state;
    }
    cursor = next;
  }
  spans.push({ from: spanStart, to, state: currentState, durationMs: to - spanStart });
  return spans;
}

function stateAt(sourceId: string, t: number): string {
  if (isOffline(sourceId, t)) return NO_DATA_STATE;
  return pumpRunning(t, sourceId) ? PUMP_STATES[0] : PUMP_STATES[1];
}
