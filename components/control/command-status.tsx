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

  const tone = pending
    ? 'border-info/30 bg-info/10 text-info'
    : result.state === 'success'
      ? 'border-status-ok/30 bg-status-ok/10 text-status-ok'
      : result.state === 'timeout'
        ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
        : 'border-status-critical/40 bg-status-critical/10 text-status-critical';

  const Icon = pending ? Loader2 : result.state === 'success' ? Check : result.state === 'timeout' ? TimerOff : AlertTriangle;

  return (
    <div className={cn('rounded-md border px-2.5 py-1.5 text-xs', tone, className)} role="status" aria-live="polite">
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
