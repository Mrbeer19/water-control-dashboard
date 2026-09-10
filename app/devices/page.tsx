'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้าสถานะอุปกรณ์ ESP32 / PLC / Gateway */
export default function DevicesPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="อุปกรณ์"
      titleEn="Devices"
      descriptionTh="สถานะ ESP32 ทุกจุดวัด, PLC S7-1200 และ IoT Gateway"
      descriptionEn="Status of every ESP32 node, the S7-1200 PLC, and the IoT gateway"
      plannedTh={[
        'ตารางอุปกรณ์: IP, VLAN, MAC, port, RSSI, firmware',
        'สุขภาพอุปกรณ์: uptime, free heap, จำนวนครั้งที่เชื่อมต่อใหม่',
        'ข้อความผิดพลาดล่าสุดของแต่ละตัว',
        'ปุ่มทดสอบการเชื่อมต่อ (ping) รายอุปกรณ์',
      ]}
      plannedEn={[
        'Device table: IP, VLAN, MAC, port, RSSI, firmware',
        'Device health: uptime, free heap, reconnect count',
        'Latest error message per device',
        'Per-device connectivity test (ping)',
      ]}
    />
  );
}
