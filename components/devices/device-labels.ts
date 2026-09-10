import type { DeviceKind, DeviceRole } from '@/lib/types';
import type { Dictionary } from '@/lib/i18n';

/** คำแปลของชนิดและหน้าที่อุปกรณ์ รวมไว้ที่เดียวเพื่อให้ตารางกับ side panel ใช้ตรงกัน */
export function kindLabel(kind: DeviceKind, t: Dictionary): string {
  const map: Record<DeviceKind, string> = {
    esp32: t.device.kindEsp32,
    plc: t.device.kindPlc,
    hmi: t.device.kindHmi,
    gateway: t.device.kindGateway,
  };
  return map[kind];
}

export function roleLabel(role: DeviceRole, t: Dictionary): string {
  const map: Record<DeviceRole, string> = {
    tank_node: t.device.roleTankNode,
    pump_node: t.device.rolePumpNode,
    valve_node: t.device.roleValveNode,
    meter_node: t.device.roleMeterNode,
    env_node: t.device.roleEnvNode,
    power_node: t.device.rolePowerNode,
    plc: t.device.rolePlc,
    hmi: t.device.roleHmi,
    gateway: t.device.roleGateway,
  };
  return map[role];
}

export const DEVICE_ROLES: DeviceRole[] = [
  'tank_node',
  'pump_node',
  'valve_node',
  'meter_node',
  'env_node',
  'power_node',
  'plc',
  'hmi',
  'gateway',
];
