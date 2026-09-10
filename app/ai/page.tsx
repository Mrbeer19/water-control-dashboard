'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';

/** หน้า AI Insights — แสดงผลจากทีม AI เท่านั้น ไม่มีตรรกะตรวจจับฝั่งหน้าบ้าน */
export default function AiPage(): JSX.Element {
  return (
    <PagePlaceholder
      titleTh="AI Insights"
      titleEn="AI Insights"
      descriptionTh="ความผิดปกติ การพยากรณ์ และการบำรุงรักษาเชิงพยากรณ์จากทีม AI"
      descriptionEn="Anomalies, forecasts, and predictive maintenance from the AI team"
      plannedTh={[
        'รายการความผิดปกติ พร้อมป้ายชนิดที่รองรับชนิดใหม่ที่ยังไม่รู้จัก',
        'กราฟพยากรณ์พร้อมแถบความเชื่อมั่น (ซ่อนแถบเมื่อข้อมูลไม่มีมา)',
        'การบำรุงรักษาเชิงพยากรณ์รายปั๊ม พร้อมเหตุผลที่โมเดลใช้ตัดสิน',
        'ตัวสลับสถานการณ์สาธิต: ปกติ / น้ำรั่วกลางคืน / ปั๊มเสื่อม',
      ]}
      plannedEn={[
        'Anomaly list with type badges that tolerate unknown types',
        'Forecast chart with confidence band (hidden when bounds are absent)',
        'Per-pump predictive maintenance with the model’s reasoning',
        'Demo scenario switch: normal / night leak / pump degrading',
      ]}
    />
  );
}
