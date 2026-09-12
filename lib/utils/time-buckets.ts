/**
 * ตัดช่วงเวลาเป็น bucket ตามเขตเวลาที่กำหนด — ที่เดียวของทั้งแอป
 *
 * ★★ ห้ามเขียนกติกาจับคู่ช่วง/ความละเอียดซ้ำใน component ★★
 *   ทั้ง UI และ mock ต้องเรียก util ชุดนี้ตัวเดียวกัน ไม่งั้นสองฝั่งจะคิดขอบช่วงคนละแบบ
 *
 * ★ ใช้ Intl.DateTimeFormat({ timeZone }) ล้วน ไม่เพิ่ม date library
 *   เหตุผล: ข้อจำกัด on-premise ใน CLAUDE.md ห้ามเพิ่ม dependency โดยไม่ถาม
 *   และ Intl มีข้อมูลเขตเวลาติดมากับ Node/เบราว์เซอร์อยู่แล้ว
 */
import type { SeriesGranularity } from '@/lib/types';

export const MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

/** ความยาวโดยประมาณของแต่ละความละเอียด ใช้ประเมินจำนวนจุด ไม่ใช้ตัดขอบจริง */
const APPROX_MS: Record<SeriesGranularity, number> = {
  raw: 2_000,
  minute_5: 5 * MS.minute,
  minute_15: 15 * MS.minute,
  hour: MS.hour,
  day: MS.day,
  week: 7 * MS.day,
  month: 30 * MS.day,
  year: 365 * MS.day,
};

/** เพดานจำนวนจุดต่อ series — เกินกว่านี้กราฟจะหนืดและอ่านไม่ออก */
export const MAX_POINTS_PER_SERIES = 1_000;

/**
 * กติกาจับคู่ "ช่วงที่เลือก → ความละเอียดที่ใช้ได้"
 * ตามตารางในสเปก Phase 7.2 — เรียงจากช่วงสั้นไปยาว
 */
const PAIRING: { maxMs: number; allowed: SeriesGranularity[]; preferred: SeriesGranularity }[] = [
  { maxMs: MS.hour, allowed: ['raw', 'minute_5'], preferred: 'raw' },
  { maxMs: 24 * MS.hour, allowed: ['minute_5', 'minute_15', 'hour'], preferred: 'minute_15' },
  { maxMs: 7 * MS.day, allowed: ['minute_15', 'hour', 'day'], preferred: 'hour' },
  { maxMs: 31 * MS.day, allowed: ['hour', 'day', 'week'], preferred: 'day' },
  { maxMs: 366 * MS.day, allowed: ['day', 'week', 'month'], preferred: 'month' },
  { maxMs: Number.POSITIVE_INFINITY, allowed: ['month', 'year'], preferred: 'month' },
];

export interface GranularityOption {
  value: SeriesGranularity;
  /** ใช้ไม่ได้กับช่วงนี้ — ต้อง disable ไม่ใช่ซ่อน (สเปก 7.2) */
  disabled: boolean;
  /** เหตุผลที่ใช้ไม่ได้ สำหรับ tooltip */
  reasonKey: 'tooLong' | 'tooManyPoints' | null;
  /** จำนวนจุดโดยประมาณถ้าเลือกอันนี้ */
  approxPoints: number;
}

const ALL_GRANULARITIES: SeriesGranularity[] = [
  'raw',
  'minute_5',
  'minute_15',
  'hour',
  'day',
  'week',
  'month',
  'year',
];

function rowFor(rangeMs: number): (typeof PAIRING)[number] {
  return PAIRING.find((row) => rangeMs <= row.maxMs) ?? PAIRING[PAIRING.length - 1]!;
}

/** ความละเอียดที่ควรใช้เป็นค่าเริ่มต้นของช่วงนี้ */
export function preferredGranularity(fromMs: number, toMs: number): SeriesGranularity {
  return rowFor(Math.max(0, toMs - fromMs)).preferred;
}

/**
 * รายการความละเอียดทั้งหมดพร้อมสถานะว่าเลือกได้ไหม
 * ★ ตัวที่ใช้ไม่ได้ยังต้องอยู่ในรายการ เพื่อให้ UI แสดงแบบจาง ๆ พร้อมเหตุผล
 */
export function granularityOptions(fromMs: number, toMs: number): GranularityOption[] {
  const rangeMs = Math.max(0, toMs - fromMs);
  const allowed = new Set(rowFor(rangeMs).allowed);
  return ALL_GRANULARITIES.map((value) => {
    const approxPoints = Math.ceil(rangeMs / APPROX_MS[value]);
    if (allowed.has(value)) return { value, disabled: false, reasonKey: null, approxPoints };
    return {
      value,
      disabled: true,
      reasonKey: approxPoints > MAX_POINTS_PER_SERIES ? ('tooManyPoints' as const) : ('tooLong' as const),
      approxPoints,
    };
  });
}

/** ถ้าความละเอียดปัจจุบันใช้กับช่วงใหม่ไม่ได้ ให้สลับไปค่าเริ่มต้นของช่วงนั้นเอง */
export function coerceGranularity(
  current: SeriesGranularity,
  fromMs: number,
  toMs: number,
): SeriesGranularity {
  const allowed = rowFor(Math.max(0, toMs - fromMs)).allowed;
  return allowed.includes(current) ? current : (rowFor(Math.max(0, toMs - fromMs)).preferred);
}

/* ───────────────────────── ตัดขอบช่วงตามเขตเวลา ───────────────────────── */

/** ชิ้นส่วนวันเวลาของ timestamp หนึ่ง ตามเขตเวลาที่ระบุ */
export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = partsCache.get(timeZone);
  if (cached !== undefined) return cached;
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  partsCache.set(timeZone, made);
  return made;
}

export function zonedParts(timestamp: number, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(new Date(timestamp));
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
  // hour12:false ให้ 24 ตอนเที่ยงคืนในบาง runtime — ปรับกลับเป็น 0
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** ระยะห่างจาก UTC ของเขตเวลานั้น ณ เวลานั้น (ms) — บวกคือเร็วกว่า UTC */
function offsetMs(timestamp: number, timeZone: string): number {
  const p = zonedParts(timestamp, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // ตัดเศษวินาทีทิ้งก่อนเทียบ เพราะ formatToParts ไม่คืนมิลลิวินาที
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/**
 * แปลง "เวลาหน้าปัดในเขตเวลานั้น" กลับเป็น epoch ms
 * ★ ต้องคำนวณ offset สองรอบ เพราะรอบแรกใช้ค่า offset ของเวลาที่เดายังไม่ตรง
 *   (สำคัญกับไซต์ที่มี DST — Asia/Bangkok ไม่มี แต่เขียนให้ถูกไว้ก่อน)
 */
export function zonedTimeToMs(parts: ZonedParts, timeZone: string): number {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const guess = naive - offsetMs(naive, timeZone);
  return naive - offsetMs(guess, timeZone);
}

/**
 * หา "ต้นช่วง" ของ timestamp ตามความละเอียดและเขตเวลา
 * สัปดาห์เริ่มวันจันทร์ · วันเริ่ม 00:00 ตามเขตเวลา · ปีแสดงเป็น ค.ศ. ในระดับข้อมูล (แปลง พ.ศ. ตอนแสดงผล)
 */
export function bucketStart(timestamp: number, granularity: SeriesGranularity, timeZone: string): number {
  if (granularity === 'raw') return timestamp;

  const p = zonedParts(timestamp, timeZone);

  if (granularity === 'minute_5' || granularity === 'minute_15') {
    const size = granularity === 'minute_5' ? 5 : 15;
    return zonedTimeToMs({ ...p, minute: Math.floor(p.minute / size) * size, second: 0 }, timeZone);
  }
  if (granularity === 'hour') return zonedTimeToMs({ ...p, minute: 0, second: 0 }, timeZone);
  if (granularity === 'day') return zonedTimeToMs({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
  if (granularity === 'month') {
    return zonedTimeToMs({ ...p, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
  }
  if (granularity === 'year') {
    return zonedTimeToMs({ ...p, month: 1, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
  }

  // week — ถอยกลับไปวันจันทร์ของสัปดาห์นั้น
  const midnight = zonedTimeToMs({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
  const backDays = (weekdayInZone(midnight, timeZone) + 6) % 7; // อาทิตย์(0) → 6, จันทร์(1) → 0
  return stepBack(midnight, backDays, timeZone);
}

/** วันในสัปดาห์ตามเขตเวลา 0 = อาทิตย์ */
function weekdayInZone(timestamp: number, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(timestamp));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** ถอยหลังทีละวันโดยยังยึดเที่ยงคืนตามเขตเวลา (กัน DST เลื่อน) */
function stepBack(midnightMs: number, days: number, timeZone: string): number {
  let cursor = midnightMs;
  for (let i = 0; i < days; i += 1) {
    const p = zonedParts(cursor - 12 * MS.hour, timeZone);
    cursor = zonedTimeToMs({ ...p, hour: 0, minute: 0, second: 0 }, timeZone);
  }
  return cursor;
}

/** ต้นช่วงถัดไป — ใช้เดินไล่ bucket ให้ครบทุกช่วงรวมช่วงที่ไม่มีข้อมูล */
export function nextBucketStart(
  start: number,
  granularity: SeriesGranularity,
  timeZone: string,
): number {
  if (granularity === 'raw') return start + APPROX_MS.raw;
  if (granularity === 'minute_5') return start + 5 * MS.minute;
  if (granularity === 'minute_15') return start + 15 * MS.minute;
  if (granularity === 'hour') return start + MS.hour;

  const p = zonedParts(start, timeZone);
  if (granularity === 'day') {
    return zonedTimeToMs({ ...p, day: p.day + 1, hour: 0, minute: 0, second: 0 }, timeZone);
  }
  if (granularity === 'week') {
    return zonedTimeToMs({ ...p, day: p.day + 7, hour: 0, minute: 0, second: 0 }, timeZone);
  }
  if (granularity === 'month') {
    const nextMonth = p.month === 12 ? 1 : p.month + 1;
    const nextYear = p.month === 12 ? p.year + 1 : p.year;
    return zonedTimeToMs(
      { year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 },
      timeZone,
    );
  }
  return zonedTimeToMs(
    { year: p.year + 1, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  );
}

/**
 * รายการต้นช่วงทั้งหมดในช่วง from–to (รวมช่วงที่ไม่มีข้อมูล)
 * ★ ต้องคืนครบทุกช่วง ไม่ใช่เฉพาะช่วงที่มีข้อมูล ไม่งั้นกราฟจะไม่มีช่องว่างให้เห็น
 */
export function bucketStarts(
  fromMs: number,
  toMs: number,
  granularity: SeriesGranularity,
  timeZone: string,
): number[] {
  const out: number[] = [];
  let cursor = bucketStart(fromMs, granularity, timeZone);
  let guard = 0;
  while (cursor < toMs && guard < MAX_POINTS_PER_SERIES * 4) {
    out.push(cursor);
    const next = nextBucketStart(cursor, granularity, timeZone);
    if (next <= cursor) break; // กันวนไม่รู้จบถ้าคำนวณพลาด
    cursor = next;
    guard += 1;
  }
  return out;
}

/** จำนวนตัวอย่างที่ควรมีใน bucket หนึ่ง ถ้าเซนเซอร์ส่งทุก sampleMs */
export function expectedSamples(
  start: number,
  granularity: SeriesGranularity,
  timeZone: string,
  sampleMs: number,
): number {
  const end = nextBucketStart(start, granularity, timeZone);
  return Math.max(1, Math.round((end - start) / sampleMs));
}

/** ช่วงนี้ยังไม่จบหรือยัง */
export function isPartialBucket(
  start: number,
  granularity: SeriesGranularity,
  timeZone: string,
  now: number,
): boolean {
  return nextBucketStart(start, granularity, timeZone) > now;
}
