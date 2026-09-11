'use client';

import { useState, type ReactNode } from 'react';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { PageBanner } from './page-banner';
import { AppFooter } from './app-footer';

/** โครงหน้าจอร่วมของทุกหน้า: sidebar ถาวรบน desktop + drawer บน mobile */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

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
