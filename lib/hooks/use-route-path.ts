'use client';

import { usePathname } from 'next/navigation';

/**
 * เส้นทางปัจจุบันแบบไม่มี "/" ปิดท้าย
 *
 * ★★ ห้ามเทียบเส้นทางด้วย usePathname() ดิบ ๆ ★★
 *   เดโมแบบไฟล์นิ่งเปิด trailingSlash ไว้ เส้นทางจะเป็น "/login/" ไม่ใช่ "/login"
 *   ถ้าเทียบตรง ๆ ตารางเส้นทางจะไม่แมตช์ทั้งกระดาน — หน้า login จะค้างที่ skeleton
 *   และแถบหัวเรื่องจะหายไปทุกหน้า (เจอจริงตอนทดสอบ export ครั้งแรก)
 * ★ รากยังคงเป็น "/" เสมอ ไม่ถูกตัดเป็นค่าว่าง
 */
export function useRoutePath(): string {
  const pathname = usePathname();
  return normalizeRoutePath(pathname);
}

/** ตัด "/" ปิดท้ายออก — ใช้กับค่าที่ไม่ได้มาจาก hook ได้ด้วย */
export function normalizeRoutePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}
