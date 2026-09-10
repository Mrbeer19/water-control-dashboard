'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้ารายงาน ค่าน้ำ และการพยากรณ์ */
export default function ReportsPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="รายงาน"
      titleEn="Reports"
      descriptionTh="สรุปการใช้น้ำ ค่าน้ำตามขั้นอัตรา และผลพยากรณ์จากโมเดลบน gateway"
      descriptionEn="Consumption summary, tiered billing, and on-gateway forecast results"
      plannedTh={[
        'รายงานรายวัน/รายเดือน และเปรียบเทียบรายโซน',
        'ประเมินค่าน้ำตามขั้นอัตราของการประปา',
        'กราฟพยากรณ์พร้อมช่วงความเชื่อมั่น',
        'ส่งออก CSV / PDF (เรนเดอร์ที่หลังบ้าน ไม่ใช้บริการออนไลน์)',
      ]}
      plannedEn={[
        'Daily/monthly reports and per-zone comparison',
        'Tiered water bill estimate',
        'Forecast chart with confidence band',
        'CSV / PDF export (rendered on-premise, no online service)',
      ]}
    />
  );
}
