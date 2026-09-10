/**
 * ตัวช่วยภายในของ service layer — ไม่ export ออกนอก lib/services/
 *
 * ★ นี่คือ "จุดเดียว" ที่ mock layer ถูกแตะ เมื่อต่อ API จริง
 *   ให้แทน respond()/mutate() ด้วย fetch() แล้วส่วนที่เหลือของ service ไม่ต้องแก้
 */

import { getState, startSimulator, subscribe, type MockState } from '@/lib/mock';

/** ดีเลย์จำลองการเดินทางบน LAN ในโรงงาน */
const SIMULATED_LATENCY_MS = 120;

/** คืนสำเนาของข้อมูล เพื่อไม่ให้ component แก้ state กลางโดยบังเอิญ */
export async function respond<T>(produce: (state: MockState) => T): Promise<T> {
  const value = produce(getState());
  await delay(SIMULATED_LATENCY_MS);
  return structuredClone(value);
}

/** เหมือน respond() แต่ใช้กับคำสั่งที่เปลี่ยนแปลง state */
export async function mutate<T>(apply: (state: MockState) => T, latencyMs = SIMULATED_LATENCY_MS): Promise<T> {
  const value = apply(getState());
  await delay(latencyMs);
  return structuredClone(value);
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export { getState, startSimulator, subscribe };
