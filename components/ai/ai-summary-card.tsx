'use client';

import { Brain, CircleAlert } from 'lucide-react';
import type { AIServiceStatus } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn, formatDateTimeTH, formatNumber, formatRatio, formatRelativeTime } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';

/**
 * A — สรุปสถานะบริการ AI
 *
 * ★ แสดงเฉพาะ field ที่ทีม AI ส่งมาจริง ที่ไม่มีให้ซ่อน ไม่ใช่โชว์ช่องว่างหรือ undefined
 *   เพราะสัญญาระบุว่ามีแค่ 4 field ที่บังคับ ที่เหลืออาจไม่มาเลยก็ได้
 */
export function AiSummaryCard({ status, loading }: { status: AIServiceStatus | null; loading: boolean }): JSX.Element {
  const { t, locale } = useLocale();

  if (loading && status === null) return <Skeleton className="h-[132px] rounded-card" />;

  if (status === null) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <CircleAlert className="h-4 w-4" aria-hidden />
          {t.ai.unreachable}
        </CardContent>
      </Card>
    );
  }

  const fields: { label: string; value: string }[] = [];
  if (status.mode !== undefined) fields.push({ label: t.ai.mode, value: status.mode });
  if (status.models.length > 0) fields.push({ label: t.ai.models, value: status.models.join(' · ') });
  if (status.lastTrainedAt !== undefined && status.lastTrainedAt !== null) {
    fields.push({ label: t.ai.lastTrained, value: formatRelativeTime(status.lastTrainedAt, locale) });
  }
  if (status.trainingDays !== undefined) {
    fields.push({ label: t.ai.trainingDays, value: `${formatNumber(status.trainingDays, locale)} ${t.ai.days}` });
  }
  if (status.accuracy !== undefined) {
    fields.push({ label: t.ai.accuracy, value: formatRatio(status.accuracy, locale) });
  }
  if (status.falsePositiveRate !== undefined) {
    fields.push({ label: t.ai.falsePositive, value: formatRatio(status.falsePositiveRate, locale) });
  }
  if (status.lastResultAt !== null) {
    fields.push({ label: t.ai.lastResult, value: formatDateTimeTH(status.lastResultAt, locale) });
  }

  return (
    <Card className={cn(!status.reachable && 'border-status-warning')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border text-info">
              <Brain className="h-4.5 w-4.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-semibold leading-tight">{t.ai.summary}</p>
              {status.summaryText !== undefined && (
                <p className="mt-0.5 text-sm text-muted-foreground">{status.summaryText}</p>
              )}
              {status.message !== null && <p className="mt-0.5 text-sm text-status-warning">{status.message}</p>}
            </div>
          </div>
          <StatusBadge status={status.reachable ? 'ok' : 'offline'} />
        </div>

        {fields.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs sm:grid-cols-3 xl:grid-cols-4">
            {fields.map((field) => (
              <div key={field.label} className="min-w-0">
                <dt className="truncate text-[10px] text-muted-foreground">{field.label}</dt>
                <dd className="tabular truncate font-medium">{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
