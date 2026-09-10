'use client';

import type { ReactNode } from 'react';

/** หัวข้อส่วนบนหน้า Overview — ตัวหนังสือใหญ่พอให้ไล่สายตาจากไกลได้ */
export function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {hint !== undefined && <p className="truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
