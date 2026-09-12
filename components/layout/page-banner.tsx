'use client';

import { usePathname } from 'next/navigation';
import type { Dictionary } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n';

/**
 * แถบหัวเรื่องของแต่ละหน้า — เป็น "ส่วน" ของตัวเอง คั่นระหว่าง header กับเนื้อหา
 *
 * ★ ทุกหน้าได้หัวเรื่องจากที่นี่ที่เดียว หน้าไหนไม่ต้องเขียน <h1> ของตัวเองอีก
 *   ถ้าเพิ่ม route ใหม่ต้องมาเติมที่ ROUTE_TITLE ด้วย ไม่งั้นแถบนี้จะไม่ขึ้น
 *
 * ★ ภาพประกอบเป็น SVG ลายเส้นใน public/banners/ ที่โฮสต์เอง — ไม่มีการโหลดจากภายนอก
 *   ตามข้อจำกัด on-premise ใน CLAUDE.md (ตัดสาย WAN แล้วต้องยังขึ้นครบ)
 * ★ ใช้เป็น mask ไม่ใช่ background-image เพื่อให้ระบายด้วยโทเคนสีได้
 *   ภาพจึงเปลี่ยนตามธีมสว่าง/มืดเอง และไม่ต้องมี hex อยู่ในไฟล์ SVG
 */
const ROUTE_TITLE: Record<
  string,
  { title: keyof Dictionary['nav']; desc: keyof Dictionary['nav']; art: string }
> = {
  '/': { title: 'overview', desc: 'descOverview', art: 'overview' },
  '/overview': { title: 'diagram', desc: 'descDiagram', art: 'diagram' },
  '/ai': { title: 'ai', desc: 'descAi', art: 'ai' },
  '/control': { title: 'control', desc: 'descControl', art: 'control' },
  '/devices': { title: 'devices', desc: 'descDevices', art: 'devices' },
  '/alerts': { title: 'alerts', desc: 'descAlerts', art: 'alerts' },
  '/reports': { title: 'reports', desc: 'descReports', art: 'reports' },
  '/settings': { title: 'settings', desc: 'descSettings', art: 'settings' },
};

export function PageBanner(): JSX.Element | null {
  const pathname = usePathname();
  const { t } = useLocale();
  const entry = ROUTE_TITLE[pathname];
  if (entry === undefined) return null;

  const mask = `url(/banners/${entry.art}.svg) right center / contain no-repeat`;

  return (
    <div className="relative shrink-0 overflow-hidden border-b border-border-strong bg-card px-4 py-5 sm:px-6">
      {/*
        ภาพประกอบอยู่ขวาสุดและถอยหลังฉาก — ข้อความต้องอ่านได้ก่อนเสมอ
        ★ ซ่อนบนจอแคบ เพราะพื้นที่ตรงนั้นเป็นของหัวเรื่อง ไม่ใช่ของภาพ
        ★ aria-hidden เพราะเป็นของตกแต่งล้วน ไม่มีข้อมูลอยู่ในภาพ
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-3 right-4 hidden w-[min(38%,380px)] bg-banner-art md:block"
        style={{ mask, WebkitMask: mask }}
      />
      <div className="relative">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{t.nav[entry.title]}</h1>
        <p className="mt-1 max-w-[min(100%,46rem)] text-sm text-muted-foreground">{t.nav[entry.desc]}</p>
      </div>
    </div>
  );
}
