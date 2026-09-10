/** Service: เซนเซอร์สภาพแวดล้อม 3 จุด (ห้องปั๊ม, ตู้คอนโทรล, กลางแจ้ง) */

import type { EnvironmentReading, EnvironmentSensor, MetricKey, TimeSeriesPoint } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { respond } from './internal';

/**
 * TODO(backend): GET /api/environment
 */
export async function getEnvironmentSensors(): Promise<EnvironmentSensor[]> {
  return respond((state) => state.sensors);
}

/**
 * TODO(backend): GET /api/environment/:id
 */
export async function getEnvironmentSensor(id: string): Promise<EnvironmentSensor | null> {
  return respond((state) => state.sensors.find((sensor) => sensor.id === id) ?? null);
}

/**
 * ค่าล่าสุดของจุดวัดหนึ่ง
 * TODO(backend): GET /api/environment/:id/latest
 */
export async function getLatestReading(id: string): Promise<EnvironmentReading | null> {
  return respond((state) => state.sensors.find((sensor) => sensor.id === id)?.latest ?? null);
}

/**
 * ประวัติสำหรับกราฟ metric: 'temperature' | 'humidity' | 'rainfall'
 * TODO(backend): GET /api/environment/:id/history?metric=&from=&to=&interval=
 */
export async function getEnvironmentHistory(id: string, metric: MetricKey = 'temperature'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * ฝนที่วัดได้จาก rain gauge กลางแจ้ง — ไม่มีการเรียก weather API ใด ๆ
 * TODO(backend): GET /api/environment/rainfall?from=&to=
 */
export async function getRainfall(): Promise<{ mmPerHour: number; detected: boolean } | null> {
  return respond((state) => {
    const outdoor = state.sensors.find((sensor) => sensor.hasRainGauge);
    if (outdoor === undefined || outdoor.latest.rainfallMmPerHour === null) return null;
    return {
      mmPerHour: outdoor.latest.rainfallMmPerHour,
      detected: outdoor.latest.rainDetected ?? false,
    };
  });
}
