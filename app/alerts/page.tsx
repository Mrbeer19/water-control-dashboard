'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้าการแจ้งเตือน */
export default function AlertsPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="การแจ้งเตือน"
      titleEn="Alerts"
      descriptionTh="เหตุการณ์ทั้งหมดของระบบ พร้อมการรับทราบและสถานะการส่งแจ้งเตือน"
      descriptionEn="All system events with acknowledgement and notification delivery status"
      plannedTh={[
        'รายการ alert กรองตามความรุนแรง/สถานะ/ต้นทาง',
        'ปุ่มรับทราบ พร้อมบันทึกผู้รับทราบและหมายเหตุ',
        'สถานะการส่งแต่ละช่องทาง (LINE / อีเมล / บัซเซอร์)',
        'ทำเครื่องหมายอ่านแล้วทั้งหมด',
      ]}
      plannedEn={[
        'Alert list filtered by severity, state, and source',
        'Acknowledge with operator name and note',
        'Per-channel delivery status (LINE / email / buzzer)',
        'Mark all as read',
      ]}
    />
  );
}
