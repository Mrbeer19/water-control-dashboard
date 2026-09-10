'use client';

import { PagePlaceholder } from '@/components/layout/page-placeholder';
import { LiveSmokeTest } from '@/components/layout/live-smoke-test';

/** หน้า Overview — แดชบอร์ดหลักสำหรับจอแขวนผนังในห้องคอนโทรล */
export default function OverviewPage(): JSX.Element {
  return (
    <div className="space-y-6">
      <PagePlaceholder
        titleTh="ภาพรวมระบบ"
        titleEn="System Overview"
        descriptionTh="ตัวเลขหลักของทั้งระบบสำหรับจอแขวนผนังในห้องคอนโทรล"
        descriptionEn="Headline figures for the control room wall display"
        plannedTh={[
          'การ์ดถังน้ำ 3 ใบ พร้อมภาพระดับน้ำเคลื่อนไหว',
          'สถานะปั๊ม 3 ตัว พร้อมค่าไฟฟ้า V/A/W',
          'อัตราไหลรวมเข้า–ออก และ unaccounted water',
          'กราฟการใช้น้ำย้อนหลัง และการ์ดสภาพแวดล้อม 3 จุด',
        ]}
        plannedEn={[
          'Three tank cards with animated water level',
          'Three pump cards with V/A/W readings',
          'Total inflow vs outflow and unaccounted water',
          'Consumption history chart and three environment cards',
        ]}
      />
      <LiveSmokeTest />
    </div>
  );
}
