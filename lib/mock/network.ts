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

/*
 * ═══════════════════════════════════════════════════════════════
 * ESP32 ในระบบ — 11 ตัว (ปรับตามผลสำรวจหน้างาน 12 ก.ย. 2569)
 * ═══════════════════════════════════════════════════════════════
 *
 * แบบเดิมออกแบบไว้จุดวัดละตัว = 22 ตัว แต่หน้างานจริงอุปกรณ์เกาะกลุ่มกัน
 * จึงยุบให้เหลือ 11 — ผังเต็มอยู่ใน PROJECT_BRIEF.md ข้อ 3.8
 *
 * ★ หนึ่ง node ผูกกับหลาย entity ได้ (linkedEntityIds เป็น array อยู่แล้ว)
 * ★ ผลข้างเคียงที่ตั้งใจ: node เดียวตาย = หลาย entity ขึ้น offline พร้อมกัน
 *   เช่น esp32-pump-house ดับ → ปั๊ม 2 ตัว + ถัง 1 + เซนเซอร์ห้องปั๊ม หายพร้อมกัน
 *
 * ★ การควบคุม: ปั๊ม → PLC · วาล์ว → ESP32 (ตัดสิน 12 ก.ย. 2569)
 *   node ที่ปั๊มจึง "อ่านค่าอย่างเดียว" ไม่ได้สั่งงานปั๊ม
 */
const ESP32_NODES: DeviceSpec[] = [
  {
    id: 'esp32-pump-house',
    name: 'ESP32 ห้องปั๊ม',
    nameEn: 'ESP32 Pump House',
    kind: 'esp32',
    role: 'pump_node',
    model: 'ESP32-WROOM-32E',
    // ★ PZEM กับ ES-Y30A ใช้ frame คนละแบบ (8N2 กับ 8N1) ต้องแยก UART กัน
    expansionModules: ['PZEM-004T v3.0 ×2 (UART1)', 'ES-Y30A 5 m (UART2)', 'SHT31'],
    protocol: 'mqtt',
    fieldbus: 'modbus_rtu',
    linkType: 'wifi',
    ip: '10.20.30.11',
    vlan: 30,
    mac: mac(0x11, ESP32_MAC_PREFIX),
    port: 1883,
    firmware: ESP32_FIRMWARE,
    location: 'ตู้ควบคุมปั๊มเดิม',
    locationEn: 'Existing Pump Control Cabinet',
    linkedEntityIds: ['pump-1', 'pump-2', 'tank-1', 'env-pump-room'],
    baselineRssi: -52,
    baselineFreeHeapBytes: 158_000,
    initialUptimeSeconds: 812_600,
    initialReconnectCount: 1,
  },
  {
    id: 'esp32-meter-bank',
    name: 'ESP32 ชุดมิเตอร์',
    nameEn: 'ESP32 Meter Bank',
    kind: 'esp32',
    role: 'meter_node',
    model: 'ESP32-WROOM-32E',
    // ★ PCNT ของ ESP32 มี 8 ช่อง — เกิน 8 มิเตอร์ต้องเพิ่ม node ตัวที่สอง
    expansionModules: ['pulse input ×8 (PCNT)'],
    protocol: 'mqtt',
    fieldbus: null,
    linkType: 'wifi',
    ip: '10.20.30.12',
    vlan: 30,
    mac: mac(0x12, ESP32_MAC_PREFIX),
    port: 1883,
    firmware: ESP32_FIRMWARE,
    location: 'จุดรวมมิเตอร์',
    locationEn: 'Meter Manifold',
    linkedEntityIds: ZONE_SPECS.filter((zone) => !zone.isVip).map((zone) => zone.meterId),
    baselineRssi: -58,
    baselineFreeHeapBytes: 166_000,
    initialUptimeSeconds: 640_200,
    initialReconnectCount: 3,
  },
  {
    id: 'esp32-valve-bank',
    name: 'ESP32 ชุดวาล์ว',
    nameEn: 'ESP32 Valve Bank',
    kind: 'esp32',
    role: 'valve_node',
    model: 'ESP32-WROOM-32E',
    expansionModules: ['relay board ×8'],
    protocol: 'mqtt',
    fieldbus: null,
    linkType: 'wifi',
    ip: '10.20.30.13',
    vlan: 30,
    mac: mac(0x13, ESP32_MAC_PREFIX),
    port: 1883,
    firmware: ESP32_FIRMWARE,
    location: 'จุดรวมมิเตอร์',
    locationEn: 'Meter Manifold',
    linkedEntityIds: ZONE_SPECS.filter((zone) => !zone.isVip).map((zone) => zone.valveId),
    baselineRssi: -60,
    baselineFreeHeapBytes: 172_000,
    initialUptimeSeconds: 640_100,
    initialReconnectCount: 3,
  },
  {
    id: 'esp32-vip',
    name: 'ESP32 โซน VIP',
    nameEn: 'ESP32 VIP Zone',
    kind: 'esp32',
    role: 'pump_node',
    model: 'ESP32-WROOM-32E',
    expansionModules: ['PZEM-004T v3.0 (UART1)', 'ES-Y30A 5 m (UART2)', 'pulse input', 'relay'],
    protocol: 'mqtt',
    fieldbus: 'modbus_rtu',
    linkType: 'wifi',
    ip: '10.20.30.14',
    vlan: 30,
    mac: mac(0x14, ESP32_MAC_PREFIX),
    port: 1883,
    firmware: ESP32_FIRMWARE,
    location: 'พื้นที่โซน VIP',
    locationEn: 'VIP Zone Area',
    linkedEntityIds: [
      'pump-3',
      'tank-2',
      ...ZONE_SPECS.filter((zone) => zone.isVip).flatMap((zone) => [zone.meterId, zone.valveId]),
    ],
    baselineRssi: -61,
    baselineFreeHeapBytes: 160_000,
    initialUptimeSeconds: 445_100,
    initialReconnectCount: 6,
  },
  {
    id: 'esp32-pond',
    name: 'ESP32 บ่อสำรอง',
    nameEn: 'ESP32 Reserve Pond',
    kind: 'esp32',
    role: 'tank_node',
    model: 'ESP32-WROOM-32E',
    expansionModules: ['ES-Y30A 5 m (RS485)', 'relay (วาล์วเติมจากประปา)'],
    protocol: 'mqtt',
    fieldbus: 'modbus_rtu',
    linkType: 'wifi',
    ip: '10.20.30.15',
    vlan: 30,
    mac: mac(0x15, ESP32_MAC_PREFIX),
    port: 1883,
    firmware: ESP32_FIRMWARE,
    location: 'ท้ายโรงงาน',
    locationEn: 'Rear Plant Area',
    linkedEntityIds: ['tank-3'],
    baselineRssi: -79,
    baselineFreeHeapBytes: 174_000,
    initialUptimeSeconds: 210_400,
    initialReconnectCount: 21,
  },
  {
    id: 'esp32-meter-main',
    name: 'ESP32 มิเตอร์หลัก',
    nameEn: 'ESP32 Main Meter',
    kind: 'esp32',
    role: 'meter_node',
    model: 'ESP32-WROOM-32E',
    expansionModules: ['pulse input', 'pressure transmitter 4–20 mA'],
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
    initialUptimeSeconds: 702_100,
    initialReconnectCount: 9,
  },
  {
    id: 'esp32-env-outdoor',
    name: 'ESP32 เซนเซอร์กลางแจ้ง',
    nameEn: 'ESP32 Outdoor Sensor',
    kind: 'esp32',
    role: 'env_node',
    model: 'ESP32-C3-DevKitM-1',
    expansionModules: ['BME280', 'BH1750', 'tipping-bucket rain gauge'],
    protocol: 'mqtt',
    fieldbus: null,
    linkType: 'wifi',
    ip: '10.20.30.16',
    vlan: 30,
    mac: mac(0x16, ESP32_MAC_PREFIX),
    port: 1883,
    firmware: 'wcm-env-1.8.3',
    location: 'กลางแจ้ง',
    locationEn: 'Outdoor',
    linkedEntityIds: ['env-outdoor'],
    baselineRssi: -77,
    baselineFreeHeapBytes: 132_000,
    initialUptimeSeconds: 58_900,
    initialReconnectCount: 38,
  },
];

/**
 * ESP32 ที่ตู้ไฟรายแผนก — อ่าน PZEM ผ่าน Modbus RTU
 * ★ ตัวที่อยู่ตู้คอนโทรล (esp32-elec-2) พ่วงเซนเซอร์ตู้คอนโทรลไปด้วย
 */
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
  linkedEntityIds:
    node.deviceId === 'esp32-elec-2' ? [node.id, 'env-control-cabinet'] : [node.id],
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
  ...ESP32_NODES,
  ...ELECTRIC_NODES,
  ...CONTROL_NODES,
];
