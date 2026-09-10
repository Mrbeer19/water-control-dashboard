'use client';

import type { EntityStatus } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const DOT_CLASS: Record<EntityStatus, string> = {
  ok: 'bg-status-ok',
  warning: 'bg-status-warning',
  critical: 'bg-status-critical',
  offline: 'bg-status-offline',
};

const TEXT_CLASS: Record<EntityStatus, string> = {
  ok: 'text-status-ok',
  warning: 'text-status-warning',
  critical: 'text-status-critical',
  offline: 'text-status-offline',
};

/**
 * ป้ายสถานะที่ใช้ร่วมกันทุกหน้า
 * ใช้ทั้งสีและข้อความ ไม่พึ่งสีอย่างเดียว เพื่อให้คนตาบอดสีอ่านได้
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: EntityStatus;
  /** ข้อความแทนคำแปลมาตรฐาน เช่น "เดินเครื่อง" ของปั๊ม */
  label?: string;
  className?: string;
}): JSX.Element {
  const { t } = useLocale();

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', TEXT_CLASS[status], className)}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_CLASS[status])} aria-hidden />
      {label ?? t.status[status]}
    </span>
  );
}

/** จุดสถานะเปล่า ๆ ใช้ในตารางที่พื้นที่จำกัด */
export function StatusDot({ status, title }: { status: EntityStatus; title: string }): JSX.Element {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-full', DOT_CLASS[status])}
      title={title}
      role="img"
      aria-label={title}
    />
  );
}
