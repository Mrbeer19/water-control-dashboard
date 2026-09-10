/**
 * การรับข้อมูลแบบเรียลไทม์
 *
 * ตอนนี้ต่อกับ simulator ฝั่ง browser ที่ขยับค่าทุก 2 วินาที
 * เมื่อต่อของจริง ให้เปลี่ยนภายในไฟล์นี้เป็น WebSocket / MQTT over WS ที่ gateway
 * โดย signature ของ subscribeToUpdates() ไม่ต้องเปลี่ยน
 */

import { startSimulator, subscribe } from './internal';

/**
 * เริ่มรับข้อมูลสด และเรียก listener ทุกครั้งที่มีค่าใหม่
 * คืนฟังก์ชันสำหรับยกเลิกการรับ (ใช้ใน cleanup ของ useEffect)
 *
 * TODO(backend): WS /api/stream — subscribe topic plant/water/# ผ่าน gateway
 *   payload ที่คาดหวัง: { type: 'snapshot' | 'delta', at: ISODateTime, ... }
 */
export function subscribeToUpdates(listener: () => void): () => void {
  const stopSimulator = startSimulator();
  const unsubscribe = subscribe(listener);
  return () => {
    unsubscribe();
    stopSimulator();
  };
}
