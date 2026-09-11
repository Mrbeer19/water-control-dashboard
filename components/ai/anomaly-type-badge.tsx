'use client';

import type { AnomalyType } from '@/lib/types';
import { getAnomalyTypeConfig, isUnknownAnomalyType } from '@/lib/config/anomaly-types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * ★ ห้ามทำขอบจาง ๆ ด้วย opacity เพราะเป็นขอบของสถานะ (กฎ opacity ในข้อ 3)
 *   ใช้เส้นขอบกลาง (Argent-100) แล้วให้ "สี" อยู่ที่ตัวอักษรกับไอคอนแทน
 *   ตัวป้ายมีทั้งไอคอนและข้อความอยู่แล้ว จึงไม่ได้สื่อความหมายด้วยสีอย่างเดียว
 */
const TONE_CLASS = {
  neutral: 'border-border text-muted-foreground',
  ok: 'border-border text-status-ok',
  warning: 'border-border text-status-warning',
  critical: 'border-border text-status-critical',
  offline: 'border-border text-status-offline',
} as const;

/**
 * ป้ายชนิดความผิดปกติ
 *
 * ★ ชนิดที่หน้าบ้านยังไม่รู้จักต้องแสดงได้เสมอ — แสดงป้ายกลางพร้อมรหัสดิบ
 *   ห้ามซ่อนรายการหรือโยน error เพราะทีม AI เพิ่มชนิดใหม่ได้ตลอด
 */
export function AnomalyTypeBadge({ type }: { type: AnomalyType | undefined }): JSX.Element {
  const { locale } = useLocale();
  const config = getAnomalyTypeConfig(type);
  const unknown = isUnknownAnomalyType(type);
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE_CLASS[config.tone],
      )}
      title={locale === 'th' ? config.descriptionTh : config.descriptionEn}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {locale === 'th' ? config.labelTh : config.labelEn}
      {unknown && type !== undefined && (
        <code className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{type}</code>
      )}
    </span>
  );
}
