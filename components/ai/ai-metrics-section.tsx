'use client';

import type { AIMetric } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AiMetricCard } from './ai-metric-card';

/** ค่าที่ทีม AI คำนวณมา — เรียงตัวที่ผิดปกติขึ้นก่อน */
export function AiMetricsSection({
  metrics,
  loading,
}: {
  metrics: AIMetric[] | null;
  loading: boolean;
}): JSX.Element {
  const { t } = useLocale();

  if (loading && metrics === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[168px] rounded-card" />
        ))}
      </div>
    );
  }

  if (metrics === null || metrics.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm font-medium">{t.ai.noMetrics}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  // วิกฤตขึ้นก่อน แล้วเตือน แล้วที่เหลือ — ตัวที่ไม่ระบุสถานะไปท้ายสุดแต่ไม่ถูกซ่อน
  const order = { critical: 0, warning: 1, offline: 2, ok: 3 } as const;
  const sorted = [...metrics].sort((a, b) => (order[a.status ?? 'ok'] ?? 3) - (order[b.status ?? 'ok'] ?? 3));

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {sorted.map((metric) => (
        <AiMetricCard key={`${metric.key}-${metric.scopeId ?? 'system'}`} metric={metric} />
      ))}
    </div>
  );
}
