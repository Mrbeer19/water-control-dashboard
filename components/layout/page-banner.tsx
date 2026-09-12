'use client';

import { useRoutePath } from '@/lib/hooks/use-route-path';
import type { Dictionary } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n';
import { assetPath } from '@/lib/config/asset-path';

/**
 * แถบหัวเรื่องของแต่ละหน้า — เป็น "ส่วน" ของตัวเอง คั่นระหว่าง header กับเนื้อหา
 *
 * ★ ทุกหน้าได้หัวเรื่องจากที่นี่ที่เดียว หน้าไหนไม่ต้องเขียน <h1> ของตัวเองอีก
 *   ถ้าเพิ่ม route ใหม่ต้องมาเติมที่ ROUTE_TITLE ด้วย ไม่งั้นแถบนี้จะไม่ขึ้น
 *
 * ★ ภาพพื้นหลังเป็นภาพจากเอกสาร CI ขององค์กร ตัดเป็นแถบแล้ววางไว้ที่ public/brand/banners/
 *   (ข้อยกเว้นในข้อ 2 ของ BRANDING_SPEC — เอกสาร CI เป็นขององค์กรเอง ใช้ภาพประกอบได้)
 *   โฮสต์เองทั้งหมด ไม่มีการโหลดจากภายนอก ตามข้อจำกัด on-premise ใน CLAUDE.md
 *
 * ★ ภาพเต็มกรอบ แต่ต้องมีม่านไล่สีทับเสมอ ไม่งั้นตัวหนังสือไทยจะไปนอนบนภาพแล้วอ่านไม่ออก
 *   ม่านเป็น "backdrop" ซึ่งข้อ 3 อนุญาตให้ใช้ opacity ได้ (ต่างจากพื้นสถานะ/สีชุดข้อมูล/สีข้อความ)
 */
/*
 * ม่านอ่านง่าย — วัดจากของจริงแล้วว่าตัวหนังสือยาวสุดจบที่ราว 422px จากขอบซ้ายของแถบ
 *
 * ★ ใช้จุดหยุดเป็น "พิกเซล" ไม่ใช่เปอร์เซ็นต์ เพราะความยาวตัวหนังสือคงที่เป็นพิกเซล
 *   ถ้าใช้เปอร์เซ็นต์ จอยิ่งแคบม่านยิ่งสั้นลงจนไปไม่ถึงท้ายประโยค
 *   ผลพลอยได้คือจอยิ่งกว้าง ยิ่งเห็นภาพมากขึ้นเอง
 * ★ ข้อความสีเทา Argent-800 ต้องการพื้นสว่างถึง L ≈ 0.79 ถึงจะได้ 4.5 : 1
 *   ช่วงที่มีตัวหนังสือจึงต้องทึบจริง ๆ จะทำจาง ๆ พอสวยไม่ได้
 * ★ ม่านเป็น backdrop ซึ่งข้อ 3 อนุญาตให้ใช้ opacity ได้
 *   (ต่างจากพื้นสถานะ / สีชุดข้อมูล / สีข้อความ ที่ห้าม)
 */
const SCRIM_WIDE =
  'linear-gradient(to right, hsl(var(--card)) 0, hsl(var(--card)) 440px, hsl(var(--card) / 0.72) 570px, hsl(var(--card) / 0.2) 730px, hsl(var(--card) / 0) 880px)';
/* จอแคบตัวหนังสือกินเกือบเต็มแถบ ม่านจึงต้องคลุมทั้งผืน ภาพเหลือเป็นพื้นผิวจาง ๆ */
const SCRIM_NARROW = 'hsl(var(--card) / 0.95)';

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
  const pathname = useRoutePath();
  const { t } = useLocale();
  const entry = ROUTE_TITLE[pathname];
  if (entry === undefined) return null;

  return (
    <div className="relative shrink-0 overflow-hidden border-b border-border-strong bg-card">
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${assetPath(`/brand/banners/${entry.art}.jpg`)})` }}
      />
      {/*
        ม่านไล่สีจากผิวการ์ดด้านซ้ายไปโปร่งด้านขวา
        ★ จอแคบยังต้องทึบเกือบตลอดแถบ เพราะตัวหนังสือกินความกว้างเกือบเต็ม
        ★ จอกว้างค่อยปล่อยให้เห็นภาพเต็ม ๆ ทางขวา ซึ่งเป็นที่ว่างอยู่แล้ว
      */}
      <div aria-hidden className="absolute inset-0 md:hidden" style={{ background: SCRIM_NARROW }} />
      <div aria-hidden className="absolute inset-0 hidden md:block" style={{ background: SCRIM_WIDE }} />
      <div className="relative px-4 py-7 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{t.nav[entry.title]}</h1>
        <p className="mt-1 max-w-[min(100%,42rem)] text-sm text-muted-foreground">{t.nav[entry.desc]}</p>
      </div>
    </div>
  );
}
