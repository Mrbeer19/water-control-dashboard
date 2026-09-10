/** Service: อุปกรณ์ ESP32 / PLC / Gateway */

import type {
  Device,
  DeviceActionResult,
  DeviceKind,
  DeviceRole,
  FirmwareUpdateJob,
  MetricKey,
  ServiceHealth,
  TimeSeriesPoint,
} from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { mutate, respond } from './internal';

/**
 * รายการอุปกรณ์ทั้งหมด (กรองตามชนิดได้)
 * TODO(backend): GET /api/devices?kind=esp32|plc|hmi|gateway&role=
 */
export async function getDevices(filter?: { kind?: DeviceKind; role?: DeviceRole }): Promise<Device[]> {
  return respond((state) =>
    state.devices.filter((device) => {
      if (filter?.kind !== undefined && device.kind !== filter.kind) return false;
      if (filter?.role !== undefined && device.role !== filter.role) return false;
      return true;
    }),
  );
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

/**
 * ประวัติสุขภาพอุปกรณ์สำหรับกราฟใน side panel
 * metric: 'rssi_dbm' | 'uptime_seconds' | 'free_heap_bytes'
 * TODO(backend): GET /api/devices/:id/history?metric=&from=&to=&interval=
 */
export async function getDeviceHistory(id: string, metric: MetricKey = 'rssi_dbm'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * สั่งรีบูตอุปกรณ์
 * TODO(backend): POST /api/devices/:id/reboot
 *   ของจริงส่งผ่าน MQTT topic plant/water/<id>/cmd แล้วรอ node กลับมา online
 */
export async function rebootDevice(id: string): Promise<DeviceActionResult> {
  return mutate((state) => {
    const at = new Date().toISOString();
    const device = state.devices.find((item) => item.id === id);
    if (device === undefined) {
      return { deviceId: id, action: 'reboot' as const, ok: false, latencyMs: null, message: 'ไม่พบอุปกรณ์', at };
    }
    // รีบูตจริงคือ uptime กลับไปศูนย์ ไม่ใช่แค่ข้อความตอบกลับ
    device.uptimeSeconds = 0;
    device.lastError = null;
    device.lastErrorAt = null;
    device.updatedAt = at;
    return {
      deviceId: id,
      action: 'reboot' as const,
      ok: true,
      latencyMs: 1_800,
      message: 'สั่งรีบูตแล้ว อุปกรณ์จะกลับมาออนไลน์ภายในไม่กี่วินาที',
      at,
    };
  }, 900);
}

/**
 * เริ่มอัปเดตเฟิร์มแวร์
 * TODO(backend): POST /api/devices/:id/firmware  body: { toVersion }
 * TODO(backend): GET  /api/devices/firmware-jobs/:jobId  (poll ความคืบหน้า)
 *   ★ ไฟล์เฟิร์มแวร์ต้องอยู่บน gateway ในโรงงาน ห้ามดึงจากอินเทอร์เน็ต
 */
export async function startFirmwareUpdate(id: string, toVersion: string): Promise<FirmwareUpdateJob | null> {
  return mutate((state) => {
    const device = state.devices.find((item) => item.id === id);
    if (device === undefined) return null;
    const at = new Date().toISOString();
    const job: FirmwareUpdateJob = {
      id: `ota-${id}-${Date.now()}`,
      name: `OTA ${device.name}`,
      createdAt: at,
      updatedAt: at,
      deviceId: id,
      deviceName: device.name,
      fromVersion: device.firmware,
      toVersion,
      state: 'queued',
      progressPercent: 0,
      startedAt: at,
      finishedAt: null,
      errorMessage: null,
    };
    state.firmwareJobs.unshift(job);
    return job;
  });
}

/**
 * ความคืบหน้าของงานอัปเดตเฟิร์มแวร์
 * TODO(backend): GET /api/devices/firmware-jobs/:jobId
 */
export async function getFirmwareJob(jobId: string): Promise<FirmwareUpdateJob | null> {
  return respond((state) => state.firmwareJobs.find((job) => job.id === jobId) ?? null);
}

/**
 * สถานะบริการเบื้องหลังที่ต้องเดินอยู่ ระบบถึงจะมีข้อมูล
 * TODO(backend): GET /api/system/services
 */
export async function getServiceHealth(): Promise<ServiceHealth[]> {
  return respond((state) => {
    const at = new Date().toISOString();
    const gateway = state.devices.find((device) => device.kind === 'gateway');
    const online = state.connection.online && gateway?.status !== 'offline';
    const messagesPerSecond = Math.round(state.devices.filter((device) => device.kind === 'esp32').length / 2);

    const services: ServiceHealth[] = [
      {
        kind: 'mqtt_broker',
        name: 'MQTT Broker',
        nameEn: 'MQTT Broker',
        status: online ? 'ok' : 'critical',
        endpoint: `${state.settings.network.mqttHost}:${state.settings.network.mqttPort}`,
        latencyMs: state.connection.latencyMs,
        lastCheckedAt: at,
        message: online ? null : 'ติดต่อ broker ไม่ได้',
        detail: { topic: state.settings.network.mqttBaseTopic, 'msg/s': messagesPerSecond },
      },
      {
        kind: 'database',
        name: 'ฐานข้อมูล',
        nameEn: 'Database',
        status: 'ok',
        endpoint: `${state.settings.network.gatewayHost}:5432`,
        latencyMs: 4,
        lastCheckedAt: at,
        message: null,
        detail: { retention: `${state.settings.maintenance.dataRetentionDays} วัน` },
      },
      {
        kind: 'ingest',
        name: 'บริการรับข้อมูล',
        nameEn: 'Ingest Service',
        status: state.connection.offlineDeviceCount > 0 ? 'warning' : 'ok',
        endpoint: `${state.settings.network.gatewayHost}:8080`,
        latencyMs: 7,
        lastCheckedAt: at,
        message:
          state.connection.offlineDeviceCount > 0
            ? `มีอุปกรณ์ ${state.connection.offlineDeviceCount} ตัวที่ไม่ส่งข้อมูลเข้ามา`
            : null,
        detail: { 'msg/s': messagesPerSecond },
      },
      {
        kind: 'ai',
        name: 'บริการ AI',
        nameEn: 'AI Service',
        status: state.settings.ai.anomalyDetectionEnabled ? 'ok' : 'offline',
        endpoint: `${state.settings.network.gatewayHost}:9000`,
        latencyMs: state.settings.ai.anomalyDetectionEnabled ? 42 : null,
        lastCheckedAt: at,
        message: state.settings.ai.anomalyDetectionEnabled ? null : 'ปิดการตรวจจับความผิดปกติอยู่',
        detail: { model: state.settings.ai.anomalyModelName },
      },
    ];
    return services;
  });
}
