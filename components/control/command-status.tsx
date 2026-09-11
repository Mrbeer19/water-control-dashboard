'use client';

import { AlertTriangle, Check, Loader2, TimerOff } from 'lucide-react';
import type { CommandResult } from '@/lib/types';
import { COMMAND_STATE_LABEL } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * แถบสถานะของคำสั่งล่าสุด
 * แสดง state ดิบจาก CommandResult ตรง ๆ ไม่ตีความใหม่ — คนสั่งต้องเห็นว่า
 * ตอนนี้ยังรอ PLC อยู่ หรือ PLC ยืนยันแล้ว หรือเงียบหายจนหมดเวลา
 */
export function CommandStatus({ result, className }: { result: CommandResult | null; className?: string }): JSX.Element | null {
  const { t, locale } = useLocale();
  if (result === null) return null;

  const label = COMMAND_STATE_LABEL[result.state][locale];
  const pending = result.state === 'sending' || result.state === 'awaiting_feedback';

/*
   * ไล่น้ำหนักทางสายตาแบบเดียวกับ status pill ในข้อ 3.4
   *   กำลังส่ง/สำเร็จ → ไม่มีพื้น    หมดเวลา → พื้นอ่อน    ล้มเหลว → พื้นเข้มเต็ม
   * ★ ห้ามทำพื้น/ขอบจาง ๆ ด้วย opacity เพราะเป็นสีของสถานะ (กฎ opacity ข้อ 3)
   */
  const tone = pending
    ? 'border-border text-info'
    : result.state === 'success'
      ? 'border-border text-status-ok'
      : result.state === 'timeout'
        ? 'border-status-warning bg-status-warning-surface text-status-warning'
        : 'border-status-critical bg-status-critical text-status-critical-foreground';

  const Icon = pending ? Loader2 : result.state === 'success' ? Check : result.state === 'timeout' ? TimerOff : AlertTriangle;

  return (
    <div className={cn('rounded-control border px-2.5 py-1.5 text-xs', tone, className)} role="status" aria-live="polite">
      <p className="flex items-center gap-1.5 font-medium">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', pending && 'animate-spin')} aria-hidden />
        {label}
        {result.state === 'success' && result.latencyMs !== null && (
          <span className="tabular font-normal opacity-80">· {t.control.latency} {result.latencyMs} ms</span>
        )}
      </p>
      {result.errorMessage !== null && <p className="mt-0.5 leading-snug opacity-90">{result.errorMessage}</p>}
    </div>
  );
}
