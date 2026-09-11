/**
 * Service: การตั้งค่าระบบ
 *
 * ★ ค่าที่ผู้ใช้บันทึกเก็บลง localStorage ผ่านชั้นนี้เท่านั้น component ไม่แตะ storage เอง
 *   เมื่อต่อ API จริง ให้เปลี่ยนเฉพาะ readOverrides/writeOverrides เป็น fetch()
 *   ส่วนที่เหลือของ service และทุก component ไม่ต้องแก้
 */

import type {
  AlertSeverity,
  EnvironmentConfig,
  LineNotificationSettings,
  NotificationTestResult,
  PumpConfig,
  SettingsFieldError,
  SystemSettings,
  TankConfig,
  ZoneConfig,
} from '@/lib/types';
import {
  DEFAULT_SETTINGS,
  defaultEnvironmentConfigs,
  defaultLineSettings,
  defaultPumpConfigs,
  defaultTankConfigs,
  defaultZoneConfigs,
  toActorRef,
} from '@/lib/mock';
import { mutate, respond } from './internal';

const STORAGE_KEY = 'wcm.settings';

/** อ่านค่าที่ผู้ใช้เคยบันทึกไว้ — คืน null เมื่อยังไม่เคยบันทึกหรือ storage ใช้ไม่ได้ */
function readOverrides(): Partial<SystemSettings> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as Partial<SystemSettings>;
  } catch {
    // ข้อมูลเสียหรือ storage ถูกปิด — ถอยไปใช้ค่าตั้งต้น ดีกว่าทำหน้าพัง
    return null;
  }
}

function writeOverrides(settings: SystemSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // เขียนไม่ได้ก็ยังใช้งานต่อในหน่วยความจำได้
  }
}

/**
 * เติมค่าที่ยังไม่เคยตั้งให้ครบ
 *
 * ★ ต้องเติมที่นี่ ไม่ใช่ใส่ ?? ไว้ในคอมโพเนนต์
 *   ถ้าปล่อยให้หน้าจอ fallback เอง ผู้ใช้จะเห็นค่าหนึ่งแต่ระบบเก็บ undefined อยู่
 *   พอกดบันทึกโดยไม่แตะช่องนั้น ค่าที่เห็นก็หายไปเงียบ ๆ
 */
function withDefaults(settings: SystemSettings): SystemSettings {
  return {
    ...settings,
    general: { temperatureUnit: 'celsius', ...settings.general },
    network: {
      ...settings.network,
      databaseHost: settings.network.databaseHost ?? settings.network.gatewayHost,
      databasePort: settings.network.databasePort ?? 5432,
    },
    ai: {
      ...settings.ai,
      nightFlowStartTime: settings.ai.nightFlowStartTime ?? '23:00',
      nightFlowEndTime: settings.ai.nightFlowEndTime ?? '05:00',
    },
    tanks: settings.tanks ?? defaultTankConfigs(),
    pumps: settings.pumps ?? defaultPumpConfigs(),
    zones: settings.zones ?? defaultZoneConfigs(),
    environment: settings.environment ?? defaultEnvironmentConfigs(),
    line: settings.line ?? defaultLineSettings(),
  };
}

/**
 * ค่าตั้งค่าปัจจุบัน รวมค่าที่ผู้ใช้เคยบันทึกไว้แล้ว
 * TODO(backend): GET /api/settings
 */
export async function getSettings(): Promise<SystemSettings> {
  return respond((state) => {
    const overrides = readOverrides();
    // ค่าที่บันทึกไว้ทับค่าในหน่วยความจำได้ เพราะเป็นสิ่งที่ผู้ใช้ตั้งเองล่าสุด
    const merged = overrides === null ? state.settings : { ...state.settings, ...overrides };
    return withDefaults(merged);
  });
}

/**
 * บันทึกเฉพาะหมวดที่แก้ (ไม่ส่งทั้งก้อน เพื่อลดโอกาสเขียนทับกันเอง)
 * TODO(backend): PATCH /api/settings/:section  body: บางส่วนของหมวดนั้น
 */
export async function updateSettingsSection<K extends keyof Omit<SystemSettings, 'updatedAt' | 'updatedBy'>>(
  section: K,
  patch: SystemSettings[K] extends object ? Partial<SystemSettings[K]> : SystemSettings[K],
  updatedByUserId: string,
): Promise<SystemSettings> {
  return mutate((state) => {
    const current = withDefaults(readOverrides() === null ? state.settings : { ...state.settings, ...readOverrides() });
    const existing = current[section];
    // อาเรย์ต้องแทนทั้งก้อน การ spread จะได้ object ที่มี key เป็นตัวเลขแทน
    const nextSection = Array.isArray(patch) || typeof existing !== 'object' || existing === null
      ? (patch as SystemSettings[K])
      : ({ ...existing, ...patch } as SystemSettings[K]);

    const next: SystemSettings = {
      ...current,
      [section]: nextSection,
      updatedAt: new Date().toISOString(),
      updatedBy: toActorRef(updatedByUserId),
    };
    state.settings = next;
    writeOverrides(next);
    return next;
  });
}

/**
 * คืนค่าตั้งต้นจากโรงงาน (ล้างค่าที่ผู้ใช้เคยบันทึก)
 * TODO(backend): POST /api/settings/reset
 */
export async function resetSettings(updatedByUserId: string): Promise<SystemSettings> {
  return mutate((state) => {
    const next = withDefaults({
      ...DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString(),
      updatedBy: toActorRef(updatedByUserId),
    });
    state.settings = next;
    writeOverrides(next);
    return next;
  });
}

/**
 * ทดสอบการเชื่อมต่อ MQTT/PLC ตามค่าที่กรอกไว้
 * TODO(backend): POST /api/settings/network/test  body: NetworkSettings
 */
export async function testNetworkSettings(): Promise<{ mqtt: boolean; plc: boolean; latencyMs: number }> {
  return respond((state) => ({
    mqtt: state.connection.online,
    plc: state.devices.some((device) => device.kind === 'plc' && device.status !== 'offline'),
    latencyMs: state.connection.latencyMs,
  }));
}

/**
 * ส่งข้อความทดสอบไปยังกลุ่ม LINE ที่เลือก
 * TODO(backend): POST /api/settings/line/test  body: { groupId }
 *   หลังบ้านเป็นผู้ถือ Channel Access Token หน้าบ้านไม่เคยเห็นค่าจริง
 */
export async function sendTestNotification(groupId: string): Promise<NotificationTestResult> {
  return respond((state) => {
    const group = state.settings.line?.groups.find((item) => item.id === groupId);
    return {
      ok: group !== undefined && group.active,
      channel: 'line' as const,
      recipient: group?.name ?? groupId,
      message:
        group === undefined
          ? 'ไม่พบกลุ่มที่เลือก'
          : group.active
            ? 'ส่งข้อความทดสอบเรียบร้อย ตรวจสอบในกลุ่มปลายทาง'
            : 'กลุ่มนี้ถูกปิดใช้งานอยู่',
      at: new Date().toISOString(),
    };
  }, );
}

/**
 * ส่งออกค่าตั้งค่าเป็น JSON
 * ★ ไม่รวม token หรือความลับใด ๆ เพราะไฟล์นี้ถูกส่งต่อกันได้
 * TODO(backend): GET /api/settings/export
 */
export async function exportSettings(): Promise<string> {
  const settings = await getSettings();
  const safe: SystemSettings = {
    ...settings,
    line: settings.line === undefined ? undefined : { ...settings.line, channelAccessTokenMasked: '' },
  };
  return JSON.stringify(safe, null, 2);
}

/**
 * นำเข้าค่าตั้งค่าจาก JSON
 * ตรวจโครงสร้างก่อนเขียนทับเสมอ ไฟล์ที่ผิดรูปต้องไม่ทำให้ระบบพัง
 * TODO(backend): POST /api/settings/import  body: SystemSettings
 */
export async function importSettings(
  json: string,
  updatedByUserId: string,
): Promise<{ ok: boolean; errors: SettingsFieldError[] }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      errors: [{ path: 'file', messageTh: 'ไฟล์ไม่ใช่ JSON ที่ถูกต้อง', messageEn: 'File is not valid JSON' }],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || !('general' in parsed) || !('billing' in parsed)) {
    return {
      ok: false,
      errors: [
        {
          path: 'file',
          messageTh: 'โครงสร้างไฟล์ไม่ตรงกับค่าตั้งค่าของระบบนี้',
          messageEn: 'File structure does not match this system’s settings',
        },
      ],
    };
  }

  return mutate((state) => {
    const incoming = parsed as SystemSettings;
    const next = withDefaults({
      ...state.settings,
      ...incoming,
      updatedAt: new Date().toISOString(),
      updatedBy: toActorRef(updatedByUserId),
    });
    state.settings = next;
    writeOverrides(next);
    return { ok: true, errors: [] as SettingsFieldError[] };
  });
}

// ─────────────────────────────────────────────────────────────
// การตรวจความถูกต้องของฟอร์ม
// ─────────────────────────────────────────────────────────────

function error(path: string, messageTh: string, messageEn: string): SettingsFieldError {
  return { path, messageTh, messageEn };
}

/**
 * ตรวจค่าตั้งค่าทั้งก้อน คืนรายการข้อผิดพลาดพร้อมเส้นทางของฟิลด์
 * ★ ตรวจที่ service layer เพื่อให้หลังบ้านใช้กฎชุดเดียวกันได้ ไม่ใช่กฎคนละชุดกับหน้าจอ
 */
export function validateSettings(settings: SystemSettings): SettingsFieldError[] {
  const errors: SettingsFieldError[] = [];

  if (settings.general.siteName.trim() === '') {
    errors.push(error('general.siteName', 'ต้องระบุชื่อโรงงาน', 'Site name is required'));
  }
  if (settings.general.refreshIntervalMs < 500) {
    errors.push(
      error('general.refreshIntervalMs', 'ความถี่รีเฟรชต้องไม่ต่ำกว่า 500 ms', 'Refresh interval must be at least 500 ms'),
    );
  }

  for (const tank of settings.tanks ?? []) {
    if (tank.capacityLiters <= 0) {
      errors.push(error(`tanks.${tank.tankId}.capacityLiters`, 'ความจุต้องมากกว่า 0', 'Capacity must be greater than 0'));
    }
    if (tank.pumpAutoStopPercent <= tank.pumpAutoStartPercent) {
      errors.push(
        error(
          `tanks.${tank.tankId}.pumpAutoStopPercent`,
          'ระดับหยุดปั๊มต้องสูงกว่าระดับเริ่มปั๊ม ไม่งั้นปั๊มจะเดิน-หยุดถี่จนไหม้',
          'Stop level must be above start level, otherwise the pump will short-cycle',
        ),
      );
    }
    if (tank.sensorScale <= 0) {
      errors.push(error(`tanks.${tank.tankId}.sensorScale`, 'ตัวคูณสเกลต้องมากกว่า 0', 'Sensor scale must be greater than 0'));
    }
  }

  for (const pump of settings.pumps ?? []) {
    if (pump.nameplateKw <= 0) {
      errors.push(error(`pumps.${pump.pumpId}.nameplateKw`, 'กำลังไฟฟ้าต้องมากกว่า 0', 'Rated power must be greater than 0'));
    }
    if (pump.overcurrentAmp <= 0) {
      errors.push(error(`pumps.${pump.pumpId}.overcurrentAmp`, 'เกณฑ์กระแสเกินต้องมากกว่า 0', 'Overcurrent limit must be greater than 0'));
    }
    if (pump.maxRunMinutes < 0) {
      errors.push(error(`pumps.${pump.pumpId}.maxRunMinutes`, 'เวลาเดินสูงสุดติดลบไม่ได้', 'Maximum run time cannot be negative'));
    }
  }

  for (const zone of settings.zones ?? []) {
    if (zone.kFactor <= 0) {
      errors.push(error(`zones.${zone.zoneId}.kFactor`, 'K-factor ต้องมากกว่า 0', 'K-factor must be greater than 0'));
    }
    if (zone.monthlyQuotaCubicMeters !== null && zone.monthlyQuotaCubicMeters < 0) {
      errors.push(error(`zones.${zone.zoneId}.monthlyQuotaCubicMeters`, 'โควตาติดลบไม่ได้', 'Quota cannot be negative'));
    }
  }

  const tiers = settings.billing.tiers;
  if (tiers.length === 0) {
    errors.push(error('billing.tiers', 'ต้องมีขั้นอัตราอย่างน้อย 1 ขั้น', 'At least one tariff tier is required'));
  }
  tiers.forEach((tier, index) => {
    if (tier.ratePerCubicMeter < 0) {
      errors.push(error(`billing.tiers.${index}.rate`, 'อัตราค่าน้ำติดลบไม่ได้', 'Rate cannot be negative'));
    }
    if (tier.maxCubicMeters !== null && tier.maxCubicMeters <= tier.minCubicMeters) {
      errors.push(
        error(`billing.tiers.${index}.max`, 'ขอบบนต้องมากกว่าขอบล่างของขั้น', 'Upper bound must be above the lower bound'),
      );
    }
    const previous = tiers[index - 1];
    if (previous !== undefined && previous.maxCubicMeters !== null && tier.minCubicMeters !== previous.maxCubicMeters) {
      errors.push(
        error(
          `billing.tiers.${index}.min`,
          'ขั้นอัตราต้องต่อกันพอดี ไม่เว้นช่องและไม่ทับกัน',
          'Tiers must meet exactly, with no gap or overlap',
        ),
      );
    }
  });
  if (settings.billing.vatPercent < 0 || settings.billing.vatPercent > 100) {
    errors.push(error('billing.vatPercent', 'VAT ต้องอยู่ระหว่าง 0–100', 'VAT must be between 0 and 100'));
  }
  if (settings.billing.billingCycleStartDay < 1 || settings.billing.billingCycleStartDay > 28) {
    errors.push(
      error(
        'billing.billingCycleStartDay',
        'วันเริ่มรอบบิลต้องอยู่ระหว่าง 1–28 เพื่อให้มีทุกเดือน',
        'Cycle start day must be 1–28 so it exists in every month',
      ),
    );
  }
  if (settings.billing.meterReadingDay < 1 || settings.billing.meterReadingDay > 28) {
    errors.push(error('billing.meterReadingDay', 'วันจดมิเตอร์ต้องอยู่ระหว่าง 1–28', 'Reading day must be 1–28'));
  }

  if (settings.ai.anomalySensitivity < 0 || settings.ai.anomalySensitivity > 1) {
    errors.push(error('ai.anomalySensitivity', 'ความไวต้องอยู่ระหว่าง 0–1', 'Sensitivity must be between 0 and 1'));
  }

  if (!isValidHost(settings.network.mqttHost)) {
    errors.push(error('network.mqttHost', 'รูปแบบ host ไม่ถูกต้อง', 'Invalid host format'));
  }
  if (settings.network.mqttPort < 1 || settings.network.mqttPort > 65535) {
    errors.push(error('network.mqttPort', 'พอร์ตต้องอยู่ระหว่าง 1–65535', 'Port must be between 1 and 65535'));
  }
  if (settings.network.plcPort < 1 || settings.network.plcPort > 65535) {
    errors.push(error('network.plcPort', 'พอร์ตต้องอยู่ระหว่าง 1–65535', 'Port must be between 1 and 65535'));
  }

  for (const sensor of settings.environment ?? []) {
    if (sensor.locationLabel.trim() === '') {
      errors.push(error(`environment.${sensor.sensorId}.locationLabel`, 'ต้องระบุชื่อจุดติดตั้ง', 'Location name is required'));
    }
    if (sensor.rainGaugeMmPerTip !== null && sensor.rainGaugeMmPerTip <= 0) {
      errors.push(
        error(`environment.${sensor.sensorId}.rainGaugeMmPerTip`, 'ค่าต่อการกระดกต้องมากกว่า 0', 'Value per tip must be greater than 0'),
      );
    }
  }

  const line = settings.line;
  if (line !== undefined && line.enabled) {
    if (line.groups.filter((group) => group.active).length === 0) {
      errors.push(error('line.groups', 'ต้องมีกลุ่มที่เปิดใช้งานอย่างน้อย 1 กลุ่ม', 'At least one active group is required'));
    }
    for (const group of line.groups) {
      if (!/^C[0-9a-f]{32}$/i.test(group.groupId)) {
        errors.push(
          error(
            `line.groups.${group.id}.groupId`,
            'LINE group id ต้องขึ้นต้นด้วย C ตามด้วยตัวอักษร 32 ตัว',
            'LINE group id must start with C followed by 32 characters',
          ),
        );
      }
    }
    if (line.debounceSeconds < 0) {
      errors.push(error('line.debounceSeconds', 'ช่วงกันส่งซ้ำติดลบไม่ได้', 'Debounce cannot be negative'));
    }
    const severities: AlertSeverity[] = ['critical', 'warning', 'info'];
    for (const severity of severities) {
      const routed = line.severityRouting[severity];
      for (const groupId of routed) {
        if (!line.groups.some((group) => group.id === groupId)) {
          errors.push(
            error(`line.severityRouting.${severity}`, 'มีการส่งไปยังกลุ่มที่ถูกลบไปแล้ว', 'Routes to a group that no longer exists'),
          );
        }
      }
    }
  }

  return errors;
}

/** ยอมรับทั้ง IP, hostname และ localhost — ห้ามชี้ออกอินเทอร์เน็ตเป็นเรื่องของนโยบาย ไม่ใช่รูปแบบ */
function isValidHost(host: string): boolean {
  const trimmed = host.trim();
  if (trimmed === '') return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(trimmed);
}

export type { EnvironmentConfig, LineNotificationSettings, PumpConfig, TankConfig, ZoneConfig };
