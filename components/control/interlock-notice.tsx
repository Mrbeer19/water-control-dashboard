'use client';

import { Ban } from 'lucide-react';
import type { ControlInterlock } from '@/lib/types';
import { useLocale } from '@/lib/i18n';

/**
 * เหตุผลที่ปุ่มถูกล็อก
 * ★ ห้าม disable ปุ่มเฉย ๆ โดยไม่บอกเหตุผล — ช่างที่กดไม่ได้ตอนตีสอง
 *   ต้องรู้ทันทีว่าต้องไปแก้อะไรก่อน ไม่ใช่เดาเอง
 */
export function InterlockNotice({ interlock }: { interlock: ControlInterlock | null }): JSX.Element | null {
  const { locale } = useLocale();
  if (interlock === null || interlock.reasons.length === 0) return null;

  return (
    <ul className="space-y-1 rounded-control bg-muted px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
      {interlock.reasons.map((item) => (
        <li key={item.code} className="flex gap-1.5">
          <Ban className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{locale === 'th' ? item.messageTh : item.messageEn}</span>
        </li>
      ))}
    </ul>
  );
}
