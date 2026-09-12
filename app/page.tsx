'use client';

import { Bell, Coins, Droplets, Gauge, LayoutGrid, Thermometer, Waves } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { Section } from '@/components/layout/section';
import { TankSection } from '@/components/tanks/tank-section';
import { PumpSection } from '@/components/pumps/pump-section';
import { ZoneSection } from '@/components/zones/zone-section';
import { MainMeterSection } from '@/components/zones/main-meter-section';
import { BillingSection } from '@/components/billing/billing-section';
import { RecentAlerts } from '@/components/alerts/recent-alerts';
import { EnvironmentSection } from '@/components/environment/environment-section';
import { AiOverviewWidget } from '@/components/ai/ai-overview-widget';

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
      <AiOverviewWidget />

      <Section title={t.overview.tanks} icon={Droplets} tone="water">
        <TankSection />
      </Section>

      <Section title={t.overview.pumps} icon={Gauge} tone="ok">
        <PumpSection />
      </Section>

      <Section title={t.overview.mainMeter} icon={Waves} tone="water">
        <MainMeterSection />
      </Section>

      <Section title={t.overview.zones} icon={LayoutGrid} tone="warning">
        <ZoneSection />
      </Section>

      <Section title={t.overview.billing} icon={Coins} tone="brand">
        <BillingSection />
      </Section>

      <Section title={t.overview.recentAlerts} icon={Bell} tone="brand">
        <RecentAlerts />
      </Section>

      <Section title={t.overview.environment} icon={Thermometer} tone="ok">
        <EnvironmentSection />
      </Section>
    </div>
  );
}
