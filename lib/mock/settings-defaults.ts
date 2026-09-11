/**
 * ค่าตั้งต้นของหมวดรายอุปกรณ์
 *
 * ★ สร้างจากสเปกฮาร์ดแวร์จริง ไม่ได้ตั้งตัวเลขลอย ๆ
 *   ระบบที่ยังไม่เคยมีคนเข้าไปตั้งค่าจะไม่มีก้อนนี้ใน SystemSettings เลย
 *   หน้าจอจึงเรียกฟังก์ชันเหล่านี้เพื่อสร้างค่าเริ่มต้นให้ตอนเปิดแท็บครั้งแรก
 */

import type {
  EnvironmentConfig,
  LineNotificationSettings,
  PumpConfig,
  TankConfig,
  ThresholdRange,
  ZoneConfig,
} from '@/lib/types';
import { ENVIRONMENT_SPECS, PUMP_SPECS, TANK_SPECS, ZONE_SPECS } from './hardware';
import { DEFAULT_SETTINGS } from './settings';

function range(
  criticalLow: number | null,
  warningLow: number | null,
  warningHigh: number | null,
  criticalHigh: number | null,
): ThresholdRange {
  return { criticalLow, warningLow, warningHigh, criticalHigh };
}

export function defaultTankConfigs(): TankConfig[] {
  return TANK_SPECS.map((spec) => {
    const thresholds = DEFAULT_SETTINGS.thresholds.tankLevelPercent[spec.id] ?? range(20, 35, 95, 98);
    return {
      tankId: spec.id,
      name: spec.name,
      capacityLiters: spec.capacityLiters,
      sensorOffsetMeters: 0,
      sensorScale: 1,
      thresholdsPercent: thresholds,
      // เริ่มเติมเหนือเกณฑ์เตือนเล็กน้อย และหยุดก่อนถึงเกณฑ์เต็ม กันน้ำล้น
      pumpAutoStartPercent: Math.max(10, (thresholds.warningLow ?? 35) + 5),
      pumpAutoStopPercent: Math.min(98, (thresholds.warningHigh ?? 95) - 5),
    };
  });
}

export function defaultPumpConfigs(): PumpConfig[] {
  return PUMP_SPECS.map((spec) => ({
    pumpId: spec.id,
    name: spec.name,
    nameplateKw: Number((spec.ratedPowerWatt / 1000).toFixed(2)),
    // เกณฑ์กระแสเกินตั้งที่ราว 1.25 เท่าของกระแสพิกัดที่ 380 V สามเฟส
    overcurrentAmp: Number(((spec.ratedPowerWatt / (Math.sqrt(3) * 380 * 0.86)) * 1.25).toFixed(1)),
    maxRunMinutes: spec.role === 'vip' ? 90 : 240,
    sourceTankId: spec.sourceTankId,
    destinationTankId: spec.sourceTankId === 'tank-1' && spec.role === 'main' ? null : null,
  }));
}

export function defaultZoneConfigs(): ZoneConfig[] {
  return ZONE_SPECS.map((spec) => ({
    zoneId: spec.id,
    name: spec.name,
    kFactor: 450,
    deviceId: spec.deviceId,
    valveId: spec.valveId,
    monthlyQuotaCubicMeters:
      spec.dailyQuotaCubicMeters === null ? null : Math.round(spec.dailyQuotaCubicMeters * 30),
  }));
}

export function defaultEnvironmentConfigs(): EnvironmentConfig[] {
  return ENVIRONMENT_SPECS.map((spec) => ({
    sensorId: spec.id,
    locationLabel: spec.locationLabel,
    temperatureOffsetCelsius: 0,
    humidityOffsetPercent: 0,
    temperatureThresholds: DEFAULT_SETTINGS.thresholds.temperatureCelsius,
    humidityThresholds: DEFAULT_SETTINGS.thresholds.humidityPercent,
    // rain gauge แบบกระดกมาตรฐานคือ 0.2 มม. ต่อครั้ง
    rainGaugeMmPerTip: spec.hasRainGauge ? 0.2 : null,
  }));
}

export function defaultLineSettings(): LineNotificationSettings {
  const maintenanceGroup = 'line-group-maintenance';
  const managerGroup = 'line-group-manager';

  return {
    enabled: true,
    // ค่าจริงไม่เคยถูกส่งกลับมาให้หน้าบ้าน แสดงเป็นรูปแบบปิดบังเท่านั้น
    channelAccessTokenMasked: '••••••••••••••••••••7f3a',
    groups: [
      { id: maintenanceGroup, name: 'ทีมซ่อมบำรุง', groupId: 'Cd41f9a2b6e7c8901234567890abcdef1', active: true },
      { id: managerGroup, name: 'หัวหน้าฝ่าย', groupId: 'C9b2e4f6a8c0d2e4f6a8c0d2e4f6a8c0d', active: true },
    ],
    severityRouting: {
      critical: [maintenanceGroup, managerGroup],
      warning: [maintenanceGroup],
      info: [],
    },
    quietHours: DEFAULT_SETTINGS.notifications.quietHours,
    debounceSeconds: 300,
    escalationTimeoutMinutes: DEFAULT_SETTINGS.notifications.escalationAfterMinutes,
    enabledCodes: {
      TANK_LEVEL_LOW: true,
      PUMP_FAULT: true,
      PUMP_OVERCURRENT: true,
      ZONE_LEAK_SUSPECTED: true,
      UNACCOUNTED_WATER_HIGH: true,
      ENV_TEMP_HIGH: true,
      DEVICE_OFFLINE: true,
      DEVICE_WEAK_SIGNAL: false,
      ANOMALY_DETECTED: true,
      PUMP_ALTERNATION: false,
    },
  };
}
