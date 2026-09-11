/**
 * การจัดรูปแบบตัวเลขและวันที่ — จุดเดียวของทั้งระบบ
 * ★ component ห้ามเรียก toFixed / toLocaleString เอง ต้องผ่านฟังก์ชันในไฟล์นี้
 *
 * ทุกฟังก์ชันใช้ Intl ที่ติดมากับ runtime ไม่มีการโหลด locale data จากภายนอก
 */

import type { EntityStatus, Locale } from '@/lib/types';

const TH_LOCALE = 'th-TH';
const EN_LOCALE = 'en-GB';

function localeTag(locale: Locale): string {
  return locale === 'th' ? TH_LOCALE : EN_LOCALE;
}

function numberFormat(locale: Locale, minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(localeTag(locale), { minimumFractionDigits, maximumFractionDigits });
}

/** ปริมาตรเป็นลิตร — ค่ามากกว่าแสนย่อเป็น "k L" ให้อ่านได้จากจอแขวนผนัง */
export function formatLiters(liters: number, locale: Locale = 'th', compact = false): string {
  if (compact && Math.abs(liters) >= 100_000) {
    return `${numberFormat(locale, 0, 1).format(liters / 1_000)}k L`;
  }
  return `${numberFormat(locale, 0, 0).format(Math.round(liters))} L`;
}

/** ปริมาตรสะสมเป็นลูกบาศก์เมตร (1 ยูนิตมิเตอร์ = 1 m³) */
export function formatCubicMeters(cubicMeters: number, locale: Locale = 'th', decimals = 2): string {
  return `${numberFormat(locale, decimals, decimals).format(cubicMeters)} m³`;
}

/** จำนวนเงินบาท */
export function formatBaht(amount: number, locale: Locale = 'th', decimals = 2): string {
  const formatted = numberFormat(locale, decimals, decimals).format(amount);
  return locale === 'th' ? `${formatted} บาท` : `฿${formatted}`;
}

/**
 * วันที่และเวลาแบบไทย (พ.ศ.) — ใช้ปฏิทินพุทธเมื่อ locale เป็นไทย
 * รับได้ทั้ง ISO string และ epoch ms
 */
export function formatDateTimeTH(value: string | number, locale: Locale = 'th'): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(locale === 'th' ? `${TH_LOCALE}-u-ca-buddhist` : EN_LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

/** เฉพาะเวลา HH:mm:ss — ใช้กับนาฬิกาบน Header */
export function formatTime(value: string | number, locale: Locale = 'th'): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** เฉพาะวันที่ */
export function formatDate(value: string | number, locale: Locale = 'th'): string {
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale === 'th' ? `${TH_LOCALE}-u-ca-buddhist` : EN_LOCALE, {
    dateStyle: 'medium',
  }).format(date);
}

/** เวลาแบบสัมพัทธ์ เช่น "3 นาทีที่แล้ว" — ใช้บอกความสดของข้อมูลเซนเซอร์ */
export function formatRelativeTime(value: string | number, locale: Locale = 'th', from: number = Date.now()): string {
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '—';

  const diffSeconds = Math.round((timestamp - from) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(localeTag(locale), { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  let value_ = diffSeconds;
  for (const entry of units) {
    const unit = entry[0];
    const limit = entry[1];
    if (Math.abs(value_) < limit) {
      return formatter.format(Math.round(value_), unit);
    }
    value_ /= limit;
  }
  return formatter.format(Math.round(value_), 'year');
}

/** อัตราไหล L/min */
export function formatFlow(lpm: number, locale: Locale = 'th', decimals = 1): string {
  return `${numberFormat(locale, decimals, decimals).format(lpm)} L/min`;
}

/** เปอร์เซ็นต์ */
export function formatPercent(percent: number, locale: Locale = 'th', decimals = 1): string {
  return `${numberFormat(locale, decimals, decimals).format(percent)}%`;
}

/** แรงดันไฟฟ้า (V) */
export function formatVoltage(volts: number, locale: Locale = 'th'): string {
  return `${numberFormat(locale, 1, 1).format(volts)} V`;
}

/** กระแสไฟฟ้า (A) */
export function formatCurrent(amps: number, locale: Locale = 'th'): string {
  return `${numberFormat(locale, 2, 2).format(amps)} A`;
}

/** กำลังไฟฟ้า — เกิน 1 kW แสดงเป็น kW */
export function formatPower(watts: number, locale: Locale = 'th'): string {
  if (Math.abs(watts) >= 1_000) {
    return `${numberFormat(locale, 2, 2).format(watts / 1_000)} kW`;
  }
  return `${numberFormat(locale, 0, 0).format(watts)} W`;
}

/** พลังงานสะสม (kWh) */
export function formatEnergy(kwh: number, locale: Locale = 'th', decimals = 1): string {
  return `${numberFormat(locale, decimals, decimals).format(kwh)} kWh`;
}

/** แรงดันน้ำ (bar) */
export function formatPressure(bar: number, locale: Locale = 'th'): string {
  return `${numberFormat(locale, 2, 2).format(bar)} bar`;
}

/** อุณหภูมิ (°C) */
export function formatTemperature(celsius: number, locale: Locale = 'th'): string {
  return `${numberFormat(locale, 1, 1).format(celsius)}°C`;
}

/** ปริมาณฝน (มม./ชม.) */
export function formatRainfall(mmPerHour: number, locale: Locale = 'th'): string {
  return `${numberFormat(locale, 1, 1).format(mmPerHour)} มม./ชม.`.replace(
    'มม./ชม.',
    locale === 'th' ? 'มม./ชม.' : 'mm/h',
  );
}

/** ความแรงสัญญาณ Wi-Fi */
export function formatRssi(dbm: number | null, locale: Locale = 'th'): string {
  if (dbm === null) return locale === 'th' ? 'ต่อสาย' : 'Wired';
  return `${dbm} dBm`;
}

/** ขนาดหน่วยความจำ */
export function formatBytes(bytes: number | null, locale: Locale = 'th'): string {
  if (bytes === null) return '—';
  if (bytes >= 1_048_576) return `${numberFormat(locale, 1, 1).format(bytes / 1_048_576)} MB`;
  if (bytes >= 1_024) return `${numberFormat(locale, 1, 1).format(bytes / 1_024)} KB`;
  return `${numberFormat(locale, 0, 0).format(bytes)} B`;
}

/** เวลาทำงานต่อเนื่อง เช่น "7 วัน 3 ชม. 12 น." */
export function formatUptime(seconds: number, locale: Locale = 'th'): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  const unit = locale === 'th' ? { d: 'วัน', h: 'ชม.', m: 'น.' } : { d: 'd', h: 'h', m: 'm' };
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${unit.d}`);
  if (hours > 0 || days > 0) parts.push(`${hours} ${unit.h}`);
  parts.push(`${minutes} ${unit.m}`);
  return parts.join(' ');
}

/** ระยะเวลาเป็นนาที เช่น เวลาจนถังเต็ม — null แสดงเป็นขีด */
export function formatMinutes(minutes: number | null, locale: Locale = 'th'): string {
  if (minutes === null) return '—';
  if (minutes < 60) {
    return locale === 'th' ? `${Math.round(minutes)} นาที` : `${Math.round(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return locale === 'th' ? `${hours} ชม. ${rest} นาที` : `${hours}h ${rest}m`;
}

/** ตัวเลขล้วน ใช้กับตัวนับ เช่น จำนวนครั้งที่เชื่อมต่อใหม่ */
export function formatNumber(value: number, locale: Locale = 'th', decimals = 0): string {
  return numberFormat(locale, decimals, decimals).format(value);
}

/**
 * คะแนนความผิดปกติจากทีม AI
 *
 * ★ ค่าที่ได้มาเป็น 0–1 เสมอ (ดู docs/AI_CONTRACT.md) แต่คนอ่านเข้าใจเปอร์เซ็นต์ง่ายกว่า
 *   การแปลงต้องเกิดที่นี่ที่เดียว — ห้ามคูณ 100 กระจายตามคอมโพเนนต์
 *   ไม่งั้นวันที่ทีม AI เปลี่ยนสเกล จะต้องไล่แก้ทุกจุดและจะมีที่หลุด
 *
 * คืน '—' เมื่อทีม AI ไม่ได้ส่งคะแนนมา ซึ่งเกิดขึ้นได้ตามสัญญา
 */
export function formatAnomalyScore(score: number | undefined, locale: Locale = 'th'): string {
  if (score === undefined || !Number.isFinite(score)) return '—';
  return `${numberFormat(locale, 0, 0).format(clampScore(score) * 100)}%`;
}

/**
 * สัดส่วน 0–1 → ข้อความเปอร์เซ็นต์
 *
 * ใช้กับทุกค่าที่สัญญาระบุว่าเป็น 0–1 (accuracy, falsePositiveRate, confidence,
 * failureProbability) ★ เหตุผลเดียวกับ formatAnomalyScore — การคูณ 100 ต้องอยู่
 * ที่ชั้นแสดงผลจุดเดียว ไม่กระจายตามคอมโพเนนต์
 */
export function formatRatio(ratio: number | undefined, locale: Locale = 'th', decimals = 0): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return '—';
  return formatPercent(clampScore(ratio) * 100, locale, decimals);
}

/** คะแนนดิบในสเกล 0–100 สำหรับ gauge หรือแถบความยาว */
export function anomalyScorePercent(score: number | undefined): number | null {
  if (score === undefined || !Number.isFinite(score)) return null;
  return Math.round(clampScore(score) * 100);
}

/** ตัดค่าให้อยู่ในสเกลที่สัญญากำหนด กันค่าหลุดกรอบจากฝั่งโมเดล */
function clampScore(score: number): number {
  return Math.min(1, Math.max(0, score));
}

/** คลาส Tailwind ของสีสถานะ ใช้ร่วมกันทุกหน้าเพื่อให้สีตรงกัน */
export const STATUS_TEXT_CLASS: Record<EntityStatus, string> = {
  ok: 'text-status-ok',
  warning: 'text-status-warning',
  critical: 'text-status-critical',
  offline: 'text-status-offline',
};

export const STATUS_BG_CLASS: Record<EntityStatus, string> = {
  ok: 'bg-status-ok',
  warning: 'bg-status-warning',
  critical: 'bg-status-critical',
  offline: 'bg-status-offline',
};
