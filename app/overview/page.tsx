'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้า Infographic แผนผังการไหลของน้ำทั้งระบบ */
export default function FlowDiagramPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="แผนผังการไหล"
      titleEn="Flow Diagram"
      descriptionTh="ภาพรวมเส้นทางน้ำตั้งแต่มิเตอร์หลักจนถึงโซนปลายทางทั้ง 8 โซน"
      descriptionEn="Water path from the main meter through to all eight zones"
      plannedTh={[
        'ไดอะแกรม SVG: การประปา → มิเตอร์หลัก → ถัง → ปั๊ม → 8 โซน',
        'เส้นท่อเคลื่อนไหวตามอัตราไหลจริง',
        'คลิกที่อุปกรณ์เพื่อดูค่าล่าสุด',
        'ไฮไลต์จุดที่มีการแจ้งเตือน',
      ]}
      plannedEn={[
        'SVG diagram: utility → main meter → tanks → pumps → 8 zones',
        'Pipe animation driven by live flow rate',
        'Click any device for its latest readings',
        'Highlight points with active alerts',
      ]}
    />
  );
}
