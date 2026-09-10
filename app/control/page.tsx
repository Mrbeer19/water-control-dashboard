'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้าควบคุมปั๊มและวาล์ว */
export default function ControlPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="ควบคุมอุปกรณ์"
      titleEn="Device Control"
      descriptionTh="สั่งเดิน/หยุดปั๊ม และเปิด/ปิดวาล์วไฟฟ้าประจำโซน"
      descriptionEn="Start/stop pumps and open/close zone valves"
      plannedTh={[
        'ปุ่มควบคุมปั๊ม 3 ตัว พร้อมสวิตช์โหมด auto/manual',
        'วาล์ว 8 โซน พร้อมยืนยันสองชั้นสำหรับโซน VIP',
        'แสดง state ของคำสั่ง: sending → awaiting_feedback → success/timeout',
        'ปุ่มหยุดฉุกเฉิน และ audit log การสั่งงาน',
      ]}
      plannedEn={[
        'Controls for all three pumps with auto/manual mode switch',
        'Eight zone valves with two-step confirm for the VIP zone',
        'Command state display: sending → awaiting_feedback → success/timeout',
        'Emergency stop button and full command audit log',
      ]}
    />
  );
}
