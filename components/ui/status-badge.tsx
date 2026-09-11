'use client';

import { AlertTriangle, CheckCircle2, CircleSlash, OctagonAlert, type LucideIcon } from 'lucide-react';
import type { EntityStatus } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * ป้ายสถานะกลางของทั้งระบบ — docs/BRANDING_SPEC.md ข้อ 3.4
 *
 * ★ ห้าม component อื่นประกอบสีสถานะเอง ให้เรียกไฟล์นี้จุดเดียว
 *   ทุกป้ายมี "ไอคอน/จุด + ข้อความ" เสมอ ไม่สื่อสถานะด้วยสีอย่างเดียว
 *
 * น้ำหนักทางสายตาไล่ตามความรุนแรงตามตารางข้อ 3.4
 *   ปกติ / offline → ไม่มีพื้น    เตือน → พื้นอ่อน    วิกฤต → พื้นเข้มเต็ม
 */

interface ToneSpec {
  /** คลาสของตัว pill ทั้งก้อน */
  pill: string;
  /** จุดสีสำหรับสถานะที่ไม่มีไอคอน (ข้อ 3.4 ระบุจุดไว้เฉพาะ ปกติ กับ offline) */
  dot?: string;
  /** ไอคอนของ pill — ใช้กับสถานะที่มีพื้น */
  icon?: LucideIcon;
  /** ไอคอนของ StatusDot ที่ไม่มีข้อความกำกับ — ต้องต่างกันที่ "รูปทรง" ไม่ใช่แค่สี */
  glyph: LucideIcon;
  /** สีของ StatusDot */
  glyphClass: string;
}

const TONE: Record<EntityStatus, ToneSpec> = {
  ok: {
    pill: 'text-status-ok',
    dot: 'bg-status-ok-dot',
    glyph: CheckCircle2,
    glyphClass: 'text-status-ok',
  },
  warning: {
    pill: 'bg-status-warning-surface px-2 py-0.5 text-status-warning',
    icon: AlertTriangle,
    glyph: AlertTriangle,
    glyphClass: 'text-status-warning',
  },
  critical: {
    pill: 'bg-status-critical px-2 py-0.5 text-status-critical-foreground',
    icon: OctagonAlert,
    glyph: OctagonAlert,
    glyphClass: 'text-status-critical',
  },
  offline: {
    pill: 'text-status-offline',
    dot: 'bg-status-offline-dot',
    glyph: CircleSlash,
    glyphClass: 'text-status-offline',
  },
};

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
  const tone = TONE[status];
  const Icon = tone.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full text-xs font-medium',
        tone.pill,
        className,
      )}
    >
      {Icon !== undefined ? (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : (
        <span className={cn('h-2 w-2 shrink-0 rounded-full', tone.dot)} aria-hidden />
      )}
      {label ?? t.status[status]}
    </span>
  );
}

/**
 * สถานะแบบไม่มีข้อความ ใช้ในตารางที่พื้นที่จำกัด
 *
 * ★ ใช้ไอคอนคนละรูปทรงต่อสถานะ ไม่ใช่วงกลมสีล้วน
 *   เพราะจุดนี้ไม่มีข้อความกำกับ ถ้าต่างกันแค่สีคนตาบอดสีจะแยกไม่ออก (ข้อ 3.4)
 */
export function StatusDot({ status, title }: { status: EntityStatus; title: string }): JSX.Element {
  const { glyph: Glyph, glyphClass } = TONE[status];
  return (
    <Glyph
      className={cn('h-3.5 w-3.5 shrink-0', glyphClass)}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
    </Glyph>
  );
}
