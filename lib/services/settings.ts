/** Service: การตั้งค่าระบบ */

import type { SystemSettings } from '@/lib/types';
import { toActorRef } from '@/lib/mock';
import { mutate, respond } from './internal';

/**
 * TODO(backend): GET /api/settings
 */
export async function getSettings(): Promise<SystemSettings> {
  return respond((state) => state.settings);
}

/**
 * บันทึกเฉพาะหมวดที่แก้ (ไม่ส่งทั้งก้อน เพื่อลดโอกาสเขียนทับกันเอง)
 * TODO(backend): PATCH /api/settings/:section  body: บางส่วนของหมวดนั้น
 */
export async function updateSettingsSection<K extends keyof Omit<SystemSettings, 'updatedAt' | 'updatedBy'>>(
  section: K,
  patch: Partial<SystemSettings[K]>,
  updatedByUserId: string,
): Promise<SystemSettings> {
  return mutate((state) => {
    state.settings = {
      ...state.settings,
      [section]: { ...state.settings[section], ...patch },
      updatedAt: new Date().toISOString(),
      updatedBy: toActorRef(updatedByUserId),
    };
    return state.settings;
  });
}

/**
 * คืนค่าตั้งต้นจากโรงงาน
 * TODO(backend): POST /api/settings/reset
 */
export async function resetSettings(updatedByUserId: string): Promise<SystemSettings> {
  const { DEFAULT_SETTINGS } = await import('@/lib/mock');
  return mutate((state) => {
    state.settings = { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString(), updatedBy: toActorRef(updatedByUserId) };
    return state.settings;
  });
}

/**
 * ทดสอบการเชื่อมต่อ MQTT/PLC ตามค่าที่กรอกไว้ในหน้า Settings
 * TODO(backend): POST /api/settings/network/test  body: NetworkSettings
 */
export async function testNetworkSettings(): Promise<{ mqtt: boolean; plc: boolean; latencyMs: number }> {
  return respond((state) => ({
    mqtt: state.connection.online,
    plc: state.devices.some((device) => device.kind === 'plc' && device.status !== 'offline'),
    latencyMs: state.connection.latencyMs,
  }));
}
