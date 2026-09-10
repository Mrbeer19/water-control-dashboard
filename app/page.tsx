'use client';

import { useLocale } from '@/lib/i18n';
import { Section } from '@/components/layout/section';
import { TankSection } from '@/components/tanks/tank-section';
import { PumpSection } from '@/components/pumps/pump-section';
import { ZoneSection } from '@/components/zones/zone-section';
import { MainMeterSection } from '@/components/zones/main-meter-section';
import { BillingSection } from '@/components/billing/billing-section';
import { RecentAlerts } from '@/components/alerts/recent-alerts';
import { EnvironmentSection } from '@/components/environment/environment-section';

/**
 * หน้า Overview — แดชบอร์ดหลักสำหรับจอแขวนผนังในห้องคอนโทรล
 *
 * ลำดับส่วนเรียงตามสิ่งที่คนในห้องคอนโทรลต้องรู้ก่อน:
 * มีน้ำพอไหม → ปั๊มเดินอยู่ไหม → ใครใช้อยู่ → น้ำเข้าเท่าไรและหายไปไหม → ค่าใช้จ่าย → เหตุการณ์ → สภาพแวดล้อม
 */
export default function OverviewPage(): JSX.Element {
  const { t } = useLocale();

  return (
    <div className="space-y-8">
      <Section title={t.overview.tanks}>
        <TankSection />
      </Section>

      <Section title={t.overview.pumps}>
        <PumpSection />
      </Section>

      <Section title={t.overview.mainMeter}>
        <MainMeterSection />
      </Section>

      <Section title={t.overview.zones}>
        <ZoneSection />
      </Section>

      <Section title={t.overview.billing}>
        <BillingSection />
      </Section>

      <Section title={t.overview.recentAlerts}>
        <RecentAlerts />
      </Section>

      <Section title={t.overview.environment}>
        <EnvironmentSection />
      </Section>
    </div>
  );
}
