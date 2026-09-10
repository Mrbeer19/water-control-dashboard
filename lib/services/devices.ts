/** Service: อุปกรณ์ ESP32 / PLC / Gateway */

import type { Device, DeviceKind } from '@/lib/types';
import { respond } from './internal';

/**
 * รายการอุปกรณ์ทั้งหมด (กรองตามชนิดได้)
 * TODO(backend): GET /api/devices?kind=esp32|plc|gateway
 */
export async function getDevices(kind?: DeviceKind): Promise<Device[]> {
  return respond((state) => (kind === undefined ? state.devices : state.devices.filter((device) => device.kind === kind)));
}

/**
 * TODO(backend): GET /api/devices/:id
 */
export async function getDevice(id: string): Promise<Device | null> {
  return respond((state) => state.devices.find((device) => device.id === id) ?? null);
}

/**
 * สรุปจำนวนอุปกรณ์ตามสถานะ ใช้กับการ์ดบนหน้า Devices
 * TODO(backend): GET /api/devices/summary
 */
export async function getDeviceSummary(): Promise<{ total: number; online: number; warning: number; offline: number }> {
  return respond((state) => ({
    total: state.devices.length,
    online: state.devices.filter((device) => device.status === 'ok').length,
    warning: state.devices.filter((device) => device.status === 'warning' || device.status === 'critical').length,
    offline: state.devices.filter((device) => device.status === 'offline').length,
  }));
}

/**
 * ทดสอบการเชื่อมต่อไปยังอุปกรณ์หนึ่งตัว
 * TODO(backend): POST /api/devices/:id/ping
 */
export async function pingDevice(id: string): Promise<{ reachable: boolean; latencyMs: number | null }> {
  return respond((state) => {
    const device = state.devices.find((item) => item.id === id);
    if (device === undefined || device.status === 'offline') {
      return { reachable: false, latencyMs: null };
    }
    // อุปกรณ์ Wi-Fi สัญญาณอ่อนตอบช้ากว่าอุปกรณ์ที่ต่อสาย
    const base = device.linkType === 'ethernet' ? 2 : 8;
    const penalty = device.rssi === null ? 0 : Math.max(0, (-device.rssi - 55) / 2);
    return { reachable: true, latencyMs: Math.round(base + penalty) };
  });
}
