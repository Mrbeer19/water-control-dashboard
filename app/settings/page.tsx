'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้าตั้งค่าระบบ */
export default function SettingsPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="ตั้งค่าระบบ"
      titleEn="System Settings"
      descriptionTh="ค่าทั่วไป เกณฑ์เตือน เครือข่าย การแจ้งเตือน ค่าน้ำ AI ซ่อมบำรุง และความปลอดภัย"
      descriptionEn="General, thresholds, network, notifications, billing, AI, maintenance, and security"
      plannedTh={[
        'แท็บตามหมวด 8 หมวดของ SystemSettings',
        'แก้เกณฑ์เตือนรายถัง/รายโซนได้โดยตรง',
        'ทดสอบการเชื่อมต่อ MQTT และ PLC',
        'ตั้งค่าขั้นอัตราค่าน้ำและรอบบิล',
      ]}
      plannedEn={[
        'One tab per SystemSettings section (eight in total)',
        'Edit per-tank and per-zone thresholds directly',
        'Test MQTT and PLC connectivity',
        'Configure water tariff tiers and billing cycle',
      ]}
    />
  );
}
