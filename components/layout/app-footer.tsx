'use client';

import { ServerCog } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { APP_VERSION } from './nav-items';

/**
 * ท้ายหน้าของทั้งแอป — เป็น "ส่วน" สุดท้ายของหน้า ถัดจากเนื้อหา
 * ย้ำเรื่อง on-premise และบอกเวอร์ชัน เพื่อให้ช่างที่อยู่หน้าจอรู้ว่ากำลังดูรุ่นไหน
 */
export function AppFooter(): JSX.Element {
  const { t, locale } = useLocale();

  return (
    <footer className="mt-auto shrink-0 border-t border-border-strong bg-card px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <p className="inline-flex items-center gap-1.5">
          <ServerCog className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {locale === 'th'
            ? 'ระบบทำงานภายในโรงงาน 100% ไม่เชื่อมต่ออินเทอร์เน็ต'
            : 'Runs fully on-premise. No internet connection.'}
        </p>
        <p className="tabular">
          {t.nav.version} {APP_VERSION}
        </p>
      </div>
    </footer>
  );
}
