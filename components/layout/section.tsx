'use client';

import type { ReactNode } from 'react';

/**
 * หัวข้อส่วนย่อยภายในหน้า — ตัวหนังสือใหญ่พอให้ไล่สายตาจากไกลได้
 *
 * ★ ชื่อหน้าอยู่ที่ `page-banner.tsx` แล้ว ส่วนนี้จึงไม่ต้องใส่ชื่อหน้าซ้ำ
 *   ถ้าไม่ส่ง title มา จะเหลือแค่แถวของ hint กับ action
 */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-3">
      {(title !== undefined || hint !== undefined || action !== undefined) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
            {hint !== undefined && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
