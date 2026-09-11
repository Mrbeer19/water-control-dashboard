'use client';

import Link from 'next/link';
import { ArrowRight, Brain, TriangleAlert } from 'lucide-react';
import type { AIServiceStatus, AnomalyEvent, Paginated } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getAIServiceStatus, getAnomalies } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface WidgetData {
  page: Paginated<AnomalyEvent>;
  status: AIServiceStatus;
}

/**
 * E — widget สรุป AI บนหน้า Overview
 * ★ ถ้ามีรายการระดับวิกฤต การ์ดจะเป็นโทนแดงและผู้เรียกต้องวางไว้บนสุดของหน้า
 */
export function AiOverviewWidget(): JSX.Element {
  const { t } = useLocale();
  const { data, loading } = useLiveData<WidgetData>(async () => {
    const [page, status] = await Promise.all([
      getAnomalies({ statuses: ['active'], limit: 50 }),
      getAIServiceStatus(),
    ]);
    return { page, status };
  }, []);

  if (loading && data === null) return <Skeleton className="h-[84px] rounded-lg" />;
  if (data === null) return <></>;

  const active = data.page.total;
  const critical = data.page.items.filter((anomaly) => anomaly.severity === 'critical').length;
  const hasCritical = critical > 0;

  return (
    <Card className={cn(hasCritical && 'border-status-critical/50 bg-status-critical/5')}>
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            hasCritical ? 'bg-status-critical/15 text-status-critical' : 'bg-info/10 text-info',
          )}
        >
          {hasCritical ? <TriangleAlert className="h-4.5 w-4.5" aria-hidden /> : <Brain className="h-4.5 w-4.5" aria-hidden />}
        </span>

        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-semibold leading-tight', hasCritical && 'text-status-critical')}>
            {t.ai.activeCount}: {active}
            {hasCritical && ` · ${t.status.critical} ${critical}`}
          </p>
          {data.status.summaryText !== undefined && (
            <p className="truncate text-xs text-muted-foreground">{data.status.summaryText}</p>
          )}
        </div>

        <Link
          href="/ai"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-text hover:underline"
        >
          {t.overview.viewAll}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
