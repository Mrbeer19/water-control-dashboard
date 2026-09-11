'use client';

import { usePathname } from 'next/navigation';
import type { Dictionary } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n';

/**
 * แถบหัวเรื่องของแต่ละหน้า — เป็น "ส่วน" ของตัวเอง คั่นระหว่าง header กับเนื้อหา
 *
 * ★ ทุกหน้าได้หัวเรื่องจากที่นี่ที่เดียว หน้าไหนไม่ต้องเขียน <h1> ของตัวเองอีก
 *   ถ้าเพิ่ม route ใหม่ต้องมาเติมที่ ROUTE_TITLE ด้วย ไม่งั้นแถบนี้จะไม่ขึ้น
 */
const ROUTE_TITLE: Record<string, { title: keyof Dictionary['nav']; desc: keyof Dictionary['nav'] }> = {
  '/': { title: 'overview', desc: 'descOverview' },
  '/overview': { title: 'diagram', desc: 'descDiagram' },
  '/ai': { title: 'ai', desc: 'descAi' },
  '/control': { title: 'control', desc: 'descControl' },
  '/devices': { title: 'devices', desc: 'descDevices' },
  '/alerts': { title: 'alerts', desc: 'descAlerts' },
  '/reports': { title: 'reports', desc: 'descReports' },
  '/settings': { title: 'settings', desc: 'descSettings' },
};

export function PageBanner(): JSX.Element | null {
  const pathname = usePathname();
  const { t } = useLocale();
  const entry = ROUTE_TITLE[pathname];
  if (entry === undefined) return null;

  return (
    <div className="shrink-0 border-b border-border-strong bg-card px-4 py-5 sm:px-6">
      <h1 className="text-2xl font-semibold leading-tight tracking-tight">{t.nav[entry.title]}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t.nav[entry.desc]}</p>
    </div>
  );
}
