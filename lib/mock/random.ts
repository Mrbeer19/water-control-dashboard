/**
 * เครื่องมือสุ่มสำหรับ mock data
 *
 * ใช้ PRNG ที่มี seed คงที่ เพื่อให้ค่าตั้งต้นเหมือนกันทุกครั้งที่โหลด
 * (กัน hydration mismatch ระหว่าง server กับ client) ส่วนการขยับตอน runtime
 * ใช้ random walk แบบ mean-reverting ค่าจึงไหลนุ่ม ไม่กระโดด
 */

/** mulberry32 — PRNG เล็ก เร็ว และให้ผลเดิมเมื่อ seed เดิม */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG กลางของ mock ทั้งระบบ */
export const rng = createRng(20260910);

export function randomBetween(min: number, max: number, generator: () => number = rng): number {
  return min + (max - min) * generator();
}

export function randomInt(min: number, max: number, generator: () => number = rng): number {
  return Math.floor(randomBetween(min, max + 1, generator));
}

export function pick<T>(items: readonly T[], generator: () => number = rng): T {
  const index = Math.min(items.length - 1, Math.floor(generator() * items.length));
  const item = items[index];
  // items ต้องไม่ว่าง — เรียกจาก seed ที่กำหนดรายการไว้แน่นอนแล้ว
  if (item === undefined) {
    throw new Error('pick() ถูกเรียกด้วยรายการว่าง');
  }
  return item;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface WalkOptions {
  /** ค่าที่ค่าปัจจุบันถูกดึงกลับเข้าหา */
  target: number;
  /** แรงดึงกลับเข้าหา target ต่อหนึ่ง tick (0–1) ยิ่งมากยิ่งกลับเร็ว */
  reversion: number;
  /** ขนาดการสั่นแบบสุ่มต่อหนึ่ง tick */
  volatility: number;
  min: number;
  max: number;
}

/**
 * ขยับค่าหนึ่งก้าวแบบ Ornstein–Uhlenbeck
 * ค่าถูกดึงเข้าหา target พร้อมสัญญาณรบกวนเล็ก ๆ — ได้เส้นกราฟที่ไหลต่อเนื่อง
 */
export function walk(current: number, options: WalkOptions, generator: () => number = rng): number {
  const drift = (options.target - current) * options.reversion;
  const noise = (generator() - 0.5) * 2 * options.volatility;
  return clamp(current + drift + noise, options.min, options.max);
}

/** สุ่มค่า 0–1 แล้วบอกว่าเหตุการณ์ความน่าจะเป็น p เกิดขึ้นหรือไม่ */
export function chance(probability: number, generator: () => number = rng): boolean {
  return generator() < probability;
}
