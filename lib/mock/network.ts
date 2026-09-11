/**
 * ผังเครือข่ายและอุปกรณ์
 *
 * ESP32 ทุกจุดวัด + Siemens S7-1200 (ระบบน้ำหลัก) + Mitsubishi FX3G (ส่วนขยาย)
 * + Samkoon HMI ที่ตู้คอนโทรล + SIMATIC IOT2000 gateway
 *
 * แผน VLAN ของโรงงาน (on-premise ทั้งหมด ไม่มี route ออกอินเทอร์เน็ต):
 *   VLAN 10  10.20.10.0/24  จัดการระบบ / gateway
 *   VLAN 20  10.20.20.0/24  ควบคุม (PLC, HMI)
 *   VLAN 30  10.20.30.0/24  เซนเซอร์ ESP32 (Wi-Fi)
 */

import type { DeviceKind, DeviceLinkType, DeviceProtocol, DeviceRole } from '@/lib/types';
import { ENVIRONMENT_SPECS, MAIN_METER_SPEC, PUMP_SPECS, TANK_SPECS, ZONE_SPECS } from './hardware';
import { ELECTRIC_NODE_SPECS } from './organization';

export interface DeviceSpec {
  id: string;
  name: string;
  nameEn: string;
  kind: DeviceKind;
  role: DeviceRole;
  model: string;
  expansionModules: string[];
  /** โปรโตคอลทางขึ้น (คุยกับ gateway/ระบบ) */
  protocol: DeviceProtocol;
  /** บัสฝั่งสนามที่อุปกรณ์นี้ไปอ่านค่ามา — null เมื่อไม่มี */
  fieldbus: DeviceProtocol | null;
  linkType: DeviceLinkType;
  ip: string;
  vlan: number;
  mac: string;
  port: number;
  firmware: string;
  location: string;
  locationEn: string;
  linkedEntityIds: string[];
  /** ความแรงสัญญาณตั้งต้น (dBm) — null เมื่อต่อสาย */
  baselineRssi: number | null;
  /** heap ว่างตั้งต้น (bytes) — null สำหรับ PLC/HMI */
  baselineFreeHeapBytes: number | null;
  initialUptimeSeconds: number;
  initialReconnectCount: number;
}

function mac(lastOctet: number, prefix: string): string {
  const hex = lastOctet.toString(16).toUpperCase().padStart(2, '0');
  return `${prefix}:${hex}`;
}

const ESP32_MAC_PREFIX = '3C:61:05:A2:1F';
const ESP32_FIRMWARE = 'wcm-node-2.4.1';

/**
 * ESP32 ประจำถังน้ำทั้ง 3 ใบ
 *
 * เซนเซอร์ระดับน้ำเป็น ES-Y30A แบบหยั่งจุ่ม ช่วงวัด 5 เมตร ใช้รุ่นเดียวกันทุกถัง
 * (ถังลึกสุดคือบ่อสำรองที่ 4 เมตร จึงอยู่ในช่วงของรุ่น 5 เมตรทั้งหมด)
 * อ่านค่าผ่าน RS485/Modbus RTU เข้า ESP32 แล้วส่งขึ้น gateway ด้วย MQTT
 */
const TANK_NODES: DeviceSpec[] = TANK_SPECS.map((tank, index) => ({
  id: tank.deviceId ?? `esp32-tank-${index + 1}`,
  name: `ESP32 ${tank.name}`,
  nameEn: `ESP32 ${tank.nameEn}`,
  kind: 'esp32' as const,
  role: 'tank_node' as const,
  model: 'ESP32-WROOM-32E',
  expansionModules: [`ES-Y30A ${tank.heightMeters <= 5 ? '5 m' : '10 m'} (RS485)`],
  protocol: 'mqtt' as const,
  fieldbus: 'modbus_rtu' as const,
  linkType: 'wifi' as const,
  ip: `10.20.30.${11 + index}`,
  vlan: 30,
  mac: mac(0x11 + index, ESP32_MAC_PREFIX),
  port: 1883,
  firmware: ESP32_FIRMWARE,
  location: tank.location,
  locationEn: tank.locationEn,
  linkedEntityIds: [tank.id],
  // บ่อสำรองอยู่ท้ายโรงงาน ไกลจาก AP ที่สุด สัญญาณจึงอ่อนกว่าอีกสองจุด
  baselineRssi: [-58, -71, -83][index] ?? -68,
  baselineFreeHeapBytes: 178_000,
  initialUptimeSeconds: [612_400, 271_900, 96_300][index] ?? 200_000,
  initialReconnectCount: [3, 11, 47][index] ?? 5,
}));

/** ESP32 ประจำปั๊ม — อ่านค่าไฟฟ้าจาก PZEM ผ่าน Modbus RTU แล้วส่งขึ้นด้วย MQTT */
const PUMP_NODES: DeviceSpec[] = PUMP_SPECS.map((pump, index) => ({
  id: pump.deviceId,
  name: `ESP32 ${pump.name}`,
  nameEn: `ESP32 ${pump.nameEn}`,
  kind: 'esp32' as const,
  role: 'pump_node' as const,
  model: 'ESP32-WROOM-32E',
  expansionModules: ['PZEM-004T v3.0'],
  protocol: 'mqtt' as const,
  fieldbus: 'modbus_rtu' as const,
  linkType: 'wifi' as const,
  ip: `10.20.30.${21 + index}`,
  vlan: 30,
  mac: mac(0x21 + index, ESP32_MAC_PREFIX),
  port: 1883,
  firmware: ESP32_FIRMWARE,
  location: 'ห้องปั๊ม',
  locationEn: 'Pump Room',
  linkedEntityIds: [pump.id],
  baselineRssi: [-52, -55, -61][index] ?? -56,
  baselineFreeHeapBytes: 164_000,
  initialUptimeSeconds: [812_600, 812_400, 445_100][index] ?? 400_000,
  initialReconnectCount: [1, 2, 6][index] ?? 2,
}));

/** ESP32 ประจำมิเตอร์โซน 8 จุด — นับ pulse และคุมวาล์วไฟฟ้า */
const ZONE_METER_NODES: DeviceSpec[] = ZONE_SPECS.map((zone, index) => ({
  id: zone.deviceId,
  name: `ESP32 มิเตอร์โซน ${zone.zoneNumber}`,
  nameEn: `ESP32 Zone ${zone.zoneNumber} Meter`,
  kind: 'esp32' as const,
  role: 'valve_node' as const,
  model: 'ESP32-WROOM-32E',
  expansionModules: [],
  protocol: 'mqtt' as const,
  fieldbus: null,
  linkType: 'wifi' as const,
  ip: `10.20.30.${31 + index}`,
  vlan: 30,
  mac: mac(0x31 + index, ESP32_MAC_PREFIX),
  port: 1883,
  firmware: ESP32_FIRMWARE,
  location: zone.area,
  locationEn: zone.areaEn,
  linkedEntityIds: [zone.id, zone.meterId, zone.valveId],
  baselineRssi: [-64, -67, -73, -59, -81, -70, -76, -62][index] ?? -68,
  baselineFreeHeapBytes: 171_000,
  initialUptimeSeconds: 180_000 + index * 21_400,
  initialReconnectCount: [4, 6, 19, 2, 63, 9, 24, 5][index] ?? 8,
}));

/** ESP32 ที่มิเตอร์หลัก — จุดวัดสำคัญที่สุดสำหรับคำนวณ unaccounted water */
const MAIN_METER_NODE: DeviceSpec = {
  id: MAIN_METER_SPEC.deviceId,
  name: 'ESP32 มิเตอร์หลัก',
  nameEn: 'ESP32 Main Meter',
  kind: 'esp32',
  role: 'meter_node',
  model: 'ESP32-WROOM-32E',
  expansionModules: [],
  protocol: 'mqtt',
  fieldbus: null,
  linkType: 'wifi',
  ip: '10.20.30.10',
  vlan: 30,
  mac: mac(0x10, ESP32_MAC_PREFIX),
  port: 1883,
  firmware: ESP32_FIRMWARE,
  location: 'ประตูรับน้ำหน้าโรงงาน',
  locationEn: 'Plant Water Inlet',
  linkedEntityIds: [MAIN_METER_SPEC.id],
  baselineRssi: -74,
  baselineFreeHeapBytes: 175_000,
  initialUptimeSeconds: 344_800,
  initialReconnectCount: 15,
};

/** ESP32 เซนเซอร์สภาพแวดล้อม 3 จุด */
const ENV_NODES: DeviceSpec[] = ENVIRONMENT_SPECS.map((sensor, index) => ({
  id: sensor.deviceId,
  name: `ESP32 ${sensor.name}`,
  nameEn: `ESP32 ${sensor.nameEn}`,
  kind: 'esp32' as const,
  role: 'env_node' as const,
  model: 'ESP32-C3-DevKitM-1',
  expansionModules: [],
  protocol: 'mqtt' as const,
  fieldbus: null,
  linkType: 'wifi' as const,
  ip: `10.20.30.${51 + index}`,
  vlan: 30,
  mac: mac(0x51 + index, ESP32_MAC_PREFIX),
  port: 1883,
  firmware: 'wcm-env-1.8.3',
  location: sensor.locationLabel,
  locationEn: sensor.locationLabelEn,
  linkedEntityIds: [sensor.id],
  baselineRssi: [-49, -53, -77][index] ?? -60,
  baselineFreeHeapBytes: 132_000,
  initialUptimeSeconds: [702_100, 702_050, 58_900][index] ?? 300_000,
  initialReconnectCount: [2, 2, 38][index] ?? 4,
}));

/** ESP32 ที่ตู้ไฟรายแผนก — อ่าน PZEM ผ่าน Modbus RTU เช่นเดียวกับ node ที่ปั๊ม */
const ELECTRIC_NODES: DeviceSpec[] = ELECTRIC_NODE_SPECS.map((node, index) => ({
  id: node.deviceId,
  name: `ESP32 ${node.name}`,
  nameEn: `ESP32 ${node.nameEn}`,
  kind: 'esp32' as const,
  role: 'power_node' as const,
  model: 'ESP32-WROOM-32E',
  expansionModules: [node.phase === 'three' ? 'PZEM-004T v3.0 ×3' : 'PZEM-004T v3.0'],
  protocol: 'mqtt' as const,
  fieldbus: 'modbus_rtu' as const,
  linkType: 'wifi' as const,
  ip: `10.20.30.${61 + index}`,
  vlan: 30,
  mac: mac(0x61 + index, ESP32_MAC_PREFIX),
  port: 1883,
  firmware: 'wcm-power-1.3.0',
  location: node.panelName,
  locationEn: node.panelNameEn,
  linkedEntityIds: [node.id],
  baselineRssi: [-57, -63, -80, -66][index] ?? -65,
  baselineFreeHeapBytes: 168_000,
  initialUptimeSeconds: 420_000 + index * 33_100,
  initialReconnectCount: [5, 8, 44, 7][index] ?? 6,
}));

/** PLC, HMI และ gateway — ต่อสาย ไม่มี RSSI */
const CONTROL_NODES: DeviceSpec[] = [
  {
    id: 'plc-1',
    name: 'PLC ระบบน้ำ',
    nameEn: 'Water System PLC',
    kind: 'plc',
    role: 'plc',
    // ตัวจริงที่ติดตั้ง: CPU 1211C แบบ relay output ต่อโมดูล SM1231 สำหรับรับ 4–20 mA
    model: 'SIMATIC S7-1200 CPU 1211C DC/DC/RLY',
    expansionModules: ['SM1231 AI 4×13-bit (4–20 mA)'],
    protocol: 's7comm',
    fieldbus: null,
    linkType: 'ethernet',
    ip: '10.20.20.5',
    vlan: 20,
    mac: '00:1B:1B:4C:7A:01',
    port: 102,
    firmware: 'V4.6.1',
    location: 'ตู้คอนโทรลหลัก',
    locationEn: 'Main Control Cabinet',
    linkedEntityIds: [
      ...PUMP_SPECS.map((pump) => pump.id),
      ...ZONE_SPECS.map((zone) => zone.valveId),
      'pressure-control-1',
    ],
    baselineRssi: null,
    baselineFreeHeapBytes: null,
    initialUptimeSeconds: 4_982_300,
    initialReconnectCount: 0,
  },
  {
    id: 'plc-2',
    name: 'PLC ส่วนขยาย',
    nameEn: 'Expansion PLC',
    kind: 'plc',
    role: 'plc',
    // คนละตระกูลกับ S7 — คุยด้วย MC Protocol ไม่ใช่ s7comm
    model: 'MITSUBISHI FX3G-24MR',
    expansionModules: ['FX3U-4AD'],
    protocol: 'mc_protocol',
    fieldbus: null,
    linkType: 'ethernet',
    ip: '10.20.20.6',
    vlan: 20,
    mac: '00:80:F4:2A:11:C3',
    port: 5551,
    firmware: 'V2.30',
    location: 'ตู้คอนโทรลย่อย อาคารผลิต B',
    locationEn: 'Sub Panel — Production B',
    linkedEntityIds: ['zone-2', 'zone-6'],
    baselineRssi: null,
    baselineFreeHeapBytes: null,
    initialUptimeSeconds: 1_204_600,
    initialReconnectCount: 2,
  },
  {
    id: 'hmi-1',
    name: 'HMI ตู้คอนโทรล',
    nameEn: 'Control Cabinet HMI',
    kind: 'hmi',
    role: 'hmi',
    model: 'SAMKOON SK-070HS',
    expansionModules: [],
    protocol: 'modbus_tcp',
    fieldbus: null,
    linkType: 'ethernet',
    ip: '10.20.20.10',
    vlan: 20,
    mac: '00:0E:C6:33:5B:9A',
    port: 502,
    firmware: 'V2.1.8',
    location: 'ตู้คอนโทรลหลัก',
    locationEn: 'Main Control Cabinet',
    linkedEntityIds: [...PUMP_SPECS.map((pump) => pump.id)],
    baselineRssi: null,
    baselineFreeHeapBytes: null,
    initialUptimeSeconds: 986_400,
    initialReconnectCount: 1,
  },
  {
    id: 'gw-1',
    name: 'IoT Gateway',
    nameEn: 'IoT Gateway',
    kind: 'gateway',
    role: 'gateway',
    model: 'SIMATIC IOT2000',
    expansionModules: [],
    protocol: 'mqtt',
    fieldbus: null,
    linkType: 'ethernet',
    ip: '10.20.10.2',
    vlan: 10,
    mac: '8C:F3:19:2D:40:7B',
    port: 1883,
    firmware: 'IOT2000-Example-Image-V1.4.1',
    location: 'ตู้คอนโทรลหลัก',
    locationEn: 'Main Control Cabinet',
    linkedEntityIds: ['plc-1', 'plc-2', 'hmi-1'],
    baselineRssi: null,
    baselineFreeHeapBytes: null,
    initialUptimeSeconds: 2_104_700,
    initialReconnectCount: 1,
  },
];

/** อุปกรณ์ทั้งหมดในระบบ */
export const DEVICE_SPECS: readonly DeviceSpec[] = [
  ...TANK_NODES,
  ...PUMP_NODES,
  ...ZONE_METER_NODES,
  MAIN_METER_NODE,
  ...ENV_NODES,
  ...ELECTRIC_NODES,
  ...CONTROL_NODES,
];
