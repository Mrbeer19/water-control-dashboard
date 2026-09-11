'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { AuthSession } from '@/lib/types';
import { getSession } from '@/lib/services';
import { Skeleton } from '@/components/ui/skeleton';
import { AppShell } from './app-shell';

/** หน้าที่เข้าได้โดยไม่ต้องล็อกอิน */
const PUBLIC_PATHS = ['/login'];

/**
 * กั้นหน้าแดชบอร์ดไว้หลังการล็อกอิน
 *
 * ★ เป็นการกั้นที่ฝั่งหน้าจอเท่านั้น ไม่ใช่ความปลอดภัยจริง
 *   ใครก็ตามที่เปิด devtools ก็ข้ามได้ ของจริงต้องกั้นที่เซิร์ฟเวอร์
 *   ด้วย middleware ที่ตรวจ cookie ก่อนส่ง HTML ออกมา
 */
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    let active = true;
    void getSession().then((result) => {
      if (!active) return;
      setSession(result);
      setChecked(true);
      if (result === null && !PUBLIC_PATHS.includes(pathname)) {
        router.replace('/login');
      }
    });
    return () => {
      active = false;
    };
  }, [pathname, router]);

  // หน้าล็อกอินไม่ต้องมีเมนูข้างและ header ของแดชบอร์ด
  if (isPublic) return <>{children}</>;

  // ระหว่างยังไม่รู้ว่าล็อกอินอยู่ไหม แสดงโครงหน้าไว้ก่อน
  // ไม่แสดงเนื้อหาจริง เพราะถ้ายังไม่ล็อกอินจะเห็นข้อมูลแวบหนึ่งก่อนถูกเด้งออก
  if (!checked || session === null) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
