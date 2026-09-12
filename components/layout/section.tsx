'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * โทนของชิปไอคอนหัวหมวด — BRANDING_SPEC ข้อ 3.8
 *
 * ★★ ไม่ใช่สีสถานะ ★★ ชิปบอกแค่ว่า "หมวดนี้เรื่องอะไร" ไม่ได้บอกว่าปกติหรือผิดปกติ
 *   สถานะจริงต้องมาจาก <StatusBadge> ที่มีไอคอน + ข้อความเสมอ (ข้อ 3.4)
 */
export type SectionTone = 'water' | 'ok' | 'warning' | 'brand';

const CHIP: Record<SectionTone, string> = {
  water: 'bg-chip-water text-chip-water-foreground',
  ok: 'bg-chip-ok text-chip-ok-foreground',
  warning: 'bg-chip-warning text-chip-warning-foreground',
  brand: 'bg-chip-brand text-chip-brand-foreground',
};

/**
 * หัวข้อส่วนย่อยภายในหน้า — ตัวหนังสือใหญ่พอให้ไล่สายตาจากไกลได้
 *
 * ★ ชื่อหน้าอยู่ที่ `page-banner.tsx` แล้ว ส่วนนี้จึงไม่ต้องใส่ชื่อหน้าซ้ำ
 *   ถ้าไม่ส่ง title มา จะเหลือแค่แถวของ hint กับ action
 * ★ ชิปไอคอนเป็นตัวให้สีของหน้า — พื้นหน้าเป็นเทาอ่อน การ์ดเป็นขาว
 *   ถ้าไม่มีจุดสีเลยทั้งหน้าจะอ่านเหมือนกระดาษเปล่า (ที่มาของข้อ 3.8)
 */
export function Section({
  title,
  hint,
  action,
  icon: Icon,
  tone = 'water',
  children,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  /** ไอคอนประจำหมวด — ไม่ส่งมาก็ไม่มีชิป */
  icon?: LucideIcon;
  tone?: SectionTone;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-3">
      {(title !== undefined || hint !== undefined || action !== undefined) && (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon !== undefined && (
              <span
                className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-control', CHIP[tone])}
                aria-hidden
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
            )}
            <div className="min-w-0">
              {title !== undefined && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
              {hint !== undefined && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
