/**
 * ป้ายเวลาของ chart explorer — ทุกป้ายตัดตามเขตเวลาเดียวกับที่ใช้รวม bucket
 *
 * ★ ห้ามใช้ new Date().getHours() ที่ไหนในโฟลเดอร์นี้
 *   เครื่องที่ตั้งเขตเวลาอื่นจะเห็นวันคนละวันกับที่หลังบ้านรวมมาให้
 * ★ ใช้ Intl ล้วน ไม่มี date library (ข้อจำกัด on-premise ใน CLAUDE.md)
 */
import type { Locale, SeriesGranularity } from '@/lib/types';
import { nextBucketStart } from '@/lib/utils/time-buckets';

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // ปฏิทินพุทธเฉพาะภาษาไทย ให้ตรงกับ formatDateTimeTH ที่ใช้ทั้งแอป
  const tag = locale === 'th' ? 'th-TH-u-ca-buddhist' : 'en-GB';
  const made = new Intl.DateTimeFormat(tag, { timeZone, ...options });
  cache.set(key, made);
  return made;
}

const clock = (l: Locale, tz: string): Intl.DateTimeFormat =>
  formatter(l, tz, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonth = (l: Locale, tz: string): Intl.DateTimeFormat =>
  formatter(l, tz, { day: 'numeric', month: 'short' });
const dayMonthYear = (l: Locale, tz: string): Intl.DateTimeFormat =>
  formatter(l, tz, { day: 'numeric', month: 'short', year: 'numeric' });
const monthYear = (l: Locale, tz: string): Intl.DateTimeFormat =>
  formatter(l, tz, { month: 'short', year: 'numeric' });
const yearOnly = (l: Locale, tz: string): Intl.DateTimeFormat =>
  formatter(l, tz, { year: 'numeric' });

/** ป้ายสั้นบนแกน x — ต้องสั้นพอที่จอ 375px จะไม่ทับกัน */
export function bucketLabel(
  start: number,
  granularity: SeriesGranularity,
  timeZone: string,
  locale: Locale,
): string {
  const at = new Date(start);
  switch (granularity) {
    case 'raw':
    case 'minute_5':
    case 'minute_15':
    case 'hour':
      return clock(locale, timeZone).format(at);
    case 'day':
    case 'week':
      return dayMonth(locale, timeZone).format(at);
    case 'month':
      return monthYear(locale, timeZone).format(at);
    case 'year':
      return yearOnly(locale, timeZone).format(at);
  }
}

/**
 * ป้ายช่วงเต็มสำหรับ tooltip เช่น "11 ก.ย. 2569 22:00–23:00"
 * ★ บอกทั้งวันและช่วงชั่วโมง เพราะกราฟรายชั่วโมงข้ามวันได้
 */
export function bucketRangeLabel(
  start: number,
  granularity: SeriesGranularity,
  timeZone: string,
  locale: Locale,
): string {
  const end = nextBucketStart(start, granularity, timeZone);
  const at = new Date(start);
  const until = new Date(end);
  switch (granularity) {
    case 'raw':
    case 'minute_5':
    case 'minute_15':
    case 'hour':
      return `${dayMonthYear(locale, timeZone).format(at)} ${clock(locale, timeZone).format(at)}–${clock(locale, timeZone).format(until)}`;
    case 'day':
      return dayMonthYear(locale, timeZone).format(at);
    case 'week':
      return `${dayMonth(locale, timeZone).format(at)} – ${dayMonthYear(locale, timeZone).format(new Date(end - 1))}`;
    case 'month':
      return monthYear(locale, timeZone).format(at);
    case 'year':
      return yearOnly(locale, timeZone).format(at);
  }
}

/** ป้ายช่วงที่เลือกทั้งช่วง ใช้ขึ้นหัวหน้าต่าง — สร้างจาก state จริงเสมอ */
export function selectionLabel(
  from: number,
  to: number,
  timeZone: string,
  locale: Locale,
): string {
  const sameDay =
    dayMonthYear(locale, timeZone).format(new Date(from)) ===
    dayMonthYear(locale, timeZone).format(new Date(to - 1));
  if (sameDay) {
    return `${dayMonthYear(locale, timeZone).format(new Date(from))} ${clock(locale, timeZone).format(new Date(from))}–${clock(locale, timeZone).format(new Date(to))}`;
  }
  return `${dayMonthYear(locale, timeZone).format(new Date(from))} – ${dayMonthYear(locale, timeZone).format(new Date(to - 1))}`;
}

/** เวลาแบบเต็มของเหตุการณ์ในรายการ marker */
export function eventTimeLabel(at: number, timeZone: string, locale: Locale): string {
  return `${dayMonthYear(locale, timeZone).format(new Date(at))} ${clock(locale, timeZone).format(new Date(at))}`;
}

/**
 * ค่า value ของ <input type="date"> — ต้องเป็น YYYY-MM-DD ตามเขตเวลาที่ใช้
 * ★ toISOString() ใช้ไม่ได้ เพราะมันตัดวันที่ UTC ทำให้ก่อน 07:00 ได้วันก่อนหน้า
 */
export function toDateInputValue(ms: number, timeZone: string): string {
  const parts = formatter('en', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
