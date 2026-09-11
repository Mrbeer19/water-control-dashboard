/**
 * เขตเวลาที่ใช้ตัดขอบช่วงเวลาและแสดงผล
 *
 * ★★ ทั้งแอปต้องใช้ค่านี้ที่เดียว ★★
 *   ถ้าปล่อยให้ใช้เวลาท้องถิ่นของเบราว์เซอร์ จะเกิดสองปัญหา
 *   1. เครื่องที่ตั้งเขตเวลาอื่น แท่ง 00:00 จะขึ้นป้ายผิดวัน
 *   2. Next.js จะ hydration mismatch เพราะ server กับ browser คนละเขตเวลา
 *
 * ★ ใช้ชื่อ IANA ("Asia/Bangkok") ไม่ใช่ offset ("+07:00")
 *   offset ตายตัวจะพังทันทีถ้าวันหนึ่งต้องรองรับไซต์ที่มี DST
 *
 * ★ ค่าจริงมาจาก SystemSettings.general.timezone — ค่านี้เป็นแค่ค่าสำรอง
 *   ตอนที่ยังโหลด settings ไม่เสร็จ หรือ settings ส่งค่าว่างมา
 */
export const DEFAULT_TIMEZONE = 'Asia/Bangkok';

/** คืนเขตเวลาที่ใช้ได้จริง — กัน settings ที่ยังโหลดไม่เสร็จหรือส่งค่าเพี้ยนมา */
export function resolveTimezone(fromSettings?: string | null): string {
  if (fromSettings === undefined || fromSettings === null || fromSettings.trim() === '') {
    return DEFAULT_TIMEZONE;
  }
  try {
    // ถ้าชื่อเขตเวลาไม่ถูกต้อง Intl จะโยน RangeError ตรงนี้
    new Intl.DateTimeFormat('en-US', { timeZone: fromSettings }).format(0);
    return fromSettings;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
