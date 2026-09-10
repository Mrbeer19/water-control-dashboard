'use client';

import type { AnomalyType } from '@/lib/types';
import { getAnomalyTypeConfig, isUnknownAnomalyType } from '@/lib/config/anomaly-types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const TONE_CLASS = {
  ok: 'border-status-ok/30 text-status-ok',
  warning: 'border-status-warning/30 text-status-warning',
  critical: 'border-status-critical/30 text-status-critical',
  offline: 'border-status-offline/30 text-status-offline',
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
