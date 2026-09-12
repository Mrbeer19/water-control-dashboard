'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { setDisplayTimezone } from '@/lib/config/timezone';
import { getSettings } from '@/lib/services';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { PageBanner } from './page-banner';
import { AppFooter } from './app-footer';

/** โครงหน้าจอร่วมของทุกหน้า: sidebar ถาวรบน desktop + drawer บน mobile */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  /*
   * ตั้งเขตเวลาแสดงผลจาก settings ครั้งเดียวตอนเปิดแอป
   * ★ ต้องทำหลัง mount ไม่ใช่ตอน render — ฝั่ง server กับ browser จะได้เริ่มจากค่าเดียวกัน
   *   ไม่งั้น HTML สองฝั่งจะไม่ตรงกันแล้ว React จะเตือน hydration mismatch
   * ★ ค่านี้ต้องเป็นตัวเดียวกับที่ใช้ตัดขอบ bucket ของกราฟ (lib/utils/time-buckets.ts)
   */
  useEffect(() => {
    void getSettings().then((settings) => {
      setDisplayTimezone(settings.general.timezone);
    });
  }, []);

  return (
    <div className="min-h-screen lg:pl-64">
      <Sidebar
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
        }}
      />
      <div className="flex min-h-screen flex-col">
        <Header
          onOpenMenu={() => {
            setMenuOpen(true);
          }}
        />
        {/*
          หน้าหนึ่งแบ่งเป็น 4 ส่วนที่มีผิวและเส้นแบ่งของตัวเอง
          1) header ด้านบน  2) แถบหัวเรื่องของหน้า  3) เนื้อหา  4) ท้ายหน้า
          สองส่วนแรกกับส่วนสุดท้ายใช้ผิว bg-card ส่วนเนื้อหาใช้ผิวพื้นหน้า จึงแยกกันเห็นชัด
        */}
        <PageBanner />
        <main className="flex-1 bg-background p-4 sm:p-6">{children}</main>
        <AppFooter />
      </div>
    </div>
  );
}
