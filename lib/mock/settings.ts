/** ค่าตั้งต้นของ SystemSettings — ค่าที่ใช้จริงในโรงงานตอนติดตั้ง */

import type { SystemSettings, ThresholdRange } from '@/lib/types';
import { TANK_SPECS, ZONE_SPECS } from './hardware';
import { ELECTRIC_NODE_SPECS, toActorRef } from './organization';

function range(
  criticalLow: number | null,
  warningLow: number | null,
  warningHigh: number | null,
  criticalHigh: number | null,
): ThresholdRange {
  return { criticalLow, warningLow, warningHigh, criticalHigh };
}

/** เกณฑ์ระดับน้ำต่อถัง — บ่อสำรองยอมให้ต่ำกว่าได้เพราะเป็นน้ำสำรอง */
const TANK_LEVEL_THRESHOLDS: Record<string, ThresholdRange> = Object.fromEntries(
  TANK_SPECS.map((tank) => [
    tank.id,
    tank.role === 'reserve_pond' ? range(15, 30, 97, null) : range(20, 35, 95, 98),
  ]),
);

/** เกณฑ์อัตราไหลต่อโซน — ตั้งจาก baseline ±  */
const ZONE_FLOW_THRESHOLDS: Record<string, ThresholdRange> = Object.fromEntries(
  ZONE_SPECS.map((zone) => [
    zone.id,
    range(null, null, Math.round(zone.baselineFlowLpm * 1.6), Math.round(zone.baselineFlowLpm * 2.1)),
  ]),
);

/** เกณฑ์กระแสไฟต่อตู้ — เตือนที่ 80% ของพิกัดเบรกเกอร์ วิกฤตที่ 95% */
const ELECTRIC_CURRENT_THRESHOLDS: Record<string, ThresholdRange> = Object.fromEntries(
  ELECTRIC_NODE_SPECS.map((node) => [
    node.id,
    range(null, null, Math.round(node.breakerRatingAmp * 0.8), Math.round(node.breakerRatingAmp * 0.95)),
  ]),
);

export const DEFAULT_SETTINGS: SystemSettings = {
  general: {
    siteName: 'โรงงานสาขาธัญบุรี',
    siteNameEn: 'Thanyaburi Plant',
    timezone: 'Asia/Bangkok',
    defaultLocale: 'th',
    defaultTheme: 'system',
    refreshIntervalMs: 2_000,
    wallDisplayMode: false,
  },
  thresholds: {
    tankLevelPercent: TANK_LEVEL_THRESHOLDS,
    zoneFlowLpm: ZONE_FLOW_THRESHOLDS,
    electricCurrentAmp: ELECTRIC_CURRENT_THRESHOLDS,
    pumpPressureBar: range(1.2, 1.8, 4.5, 5.2),
    pumpCurrentAmp: range(null, null, 11.5, 13.0),
    temperatureCelsius: range(null, null, 40, 45),
    humidityPercent: range(null, 25, 80, 90),
    unaccountedWarningPercent: 8,
    unaccountedCriticalPercent: 15,
  },
  network: {
    mqttHost: '10.20.10.2',
    mqttPort: 1883,
    mqttBaseTopic: 'plant/water',
    plcHost: '10.20.20.5',
    plcPort: 102,
    // Mitsubishi FX3G ส่วนขยาย — MC Protocol
    secondaryPlcHost: '10.20.20.6',
    secondaryPlcPort: 5551,
    gatewayHost: '10.20.10.2',
    // NTP ต้องเป็นเครื่องใน LAN — ระบบไม่มีทางออกอินเทอร์เน็ต
    ntpServer: '10.20.10.1',
    pollIntervalMs: 2_000,
    deviceTimeoutSeconds: 30,
  },
  notifications: {
    enabledChannels: ['line', 'email', 'buzzer'],
    recipients: {
      // LINE Messaging API — recipient คือ group id (ขึ้นต้นด้วย C) ไม่ใช่ token แบบ LINE Notify เดิม
      line: ['Cd41f9a2b6e7c8901234567890abcdef1'],
      email: ['maintenance@plant.local', 'facility@plant.local'],
      sms: [],
      buzzer: ['ตู้คอนโทรลหลัก'],
      webhook: [],
    },
    minimumSeverity: 'warning',
    quietHours: {
      enabled: true,
      startTime: '22:00',
      endTime: '06:00',
      overrideSeverity: 'critical',
    },
    escalationAfterMinutes: 15,
    deduplicationWindowMinutes: 10,
    notifyDepartmentManager: true,
  },
  billing: {
    currency: 'THB',
    // อัตราขั้นบันไดของ กปภ. ประเภทกิจการขนาดกลาง (ตัวอย่างสำหรับสาธิต)
    tiers: [
      { id: 'tier-1', name: '0–30 ลบ.ม.', nameEn: '0–30 m³', minCubicMeters: 0, maxCubicMeters: 30, ratePerCubicMeter: 17.0 },
      { id: 'tier-2', name: '31–50 ลบ.ม.', nameEn: '31–50 m³', minCubicMeters: 30, maxCubicMeters: 50, ratePerCubicMeter: 19.5 },
      { id: 'tier-3', name: '51–80 ลบ.ม.', nameEn: '51–80 m³', minCubicMeters: 50, maxCubicMeters: 80, ratePerCubicMeter: 21.8 },
      { id: 'tier-4', name: '81–100 ลบ.ม.', nameEn: '81–100 m³', minCubicMeters: 80, maxCubicMeters: 100, ratePerCubicMeter: 23.4 },
      { id: 'tier-5', name: '101 ลบ.ม. ขึ้นไป', nameEn: '101+ m³', minCubicMeters: 100, maxCubicMeters: null, ratePerCubicMeter: 25.6 },
    ],
    serviceChargeBaht: 90,
    vatPercent: 7,
    billingCycleStartDay: 1,
    // เจ้าหน้าที่การประปาเข้ามาจดมิเตอร์ราววันที่ 18 ของทุกเดือน
    meterReadingDay: 18,
    // อัตราค่าไฟเฉลี่ยที่ใช้แบ่งต้นทุนรายแผนก (กิจการขนาดกลาง แรงดันต่ำ)
    electricityRatePerKwh: 4.18,
    electricityFtPerKwh: 0.3972,
  },
  ai: {
    forecastEnabled: true,
    forecastHorizonHours: 24,
    forecastModelName: 'prophet-water-v2 (on-gateway)',
    anomalyDetectionEnabled: true,
    anomalyModelName: 'isolation-forest-v1 (on-gateway)',
    anomalySensitivity: 0.65,
    ruleBasedDetectionEnabled: true,
    leakDetectionEnabled: true,
    retrainIntervalHours: 168,
  },
  maintenance: {
    pumpAlternationEnabled: true,
    pumpAlternationHours: 12,
    serviceIntervalHours: 2_000,
    dataRetentionDays: 365,
    backupEnabled: true,
    backupTime: '02:30',
    backupPath: '\\\\10.20.10.20\\water-backup',
  },
  security: {
    requirePinForControl: true,
    minimumRoleForControl: 'operator',
    sessionTimeoutMinutes: 30,
    controlLockout: false,
    departmentScopedAccess: true,
    auditLogRetentionDays: 730,
  },
  updatedAt: '2026-09-01T09:15:00+07:00',
  updatedBy: toActorRef('user-admin'),
};
