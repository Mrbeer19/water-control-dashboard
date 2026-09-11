'use client';

import { Minus, TrendingDown, TrendingUp, Wrench } from 'lucide-react';
import type { MaintenancePrediction } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn, formatDate, formatNumber, formatRatio } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * D — สุขภาพอุปกรณ์และการเตือนล่วงหน้า
 *
 * เรียงจากคะแนนสุขภาพน้อยไปมาก ตัวที่น่าห่วงที่สุดจึงอยู่บนสุด
 * ★ แสดง "คาดว่าจะเกิดภายใน X วัน" เฉพาะรายการที่มี estimatedIssueDate จริง
 *   ตัวที่ทีม AI ไม่ได้ประเมินวันไว้ ห้ามเดาวันให้เอง
 */
export function MaintenanceSection({
  predictions,
  loading,
}: {
  predictions: MaintenancePrediction[] | null;
  loading: boolean;
}): JSX.Element {
  const { t, locale } = useLocale();

  if (loading && predictions === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[168px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (predictions === null || predictions.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <p className="text-sm font-medium">{t.ai.noMaintenance}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  // คะแนนน้อย = น่าห่วง ขึ้นก่อน · รายการที่ไม่มีคะแนนไปท้ายสุด
  const sorted = [...predictions].sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101));

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sorted.map((prediction) => {
        const score = prediction.healthScore;
        const tone =
          score === undefined
            ? 'text-muted-foreground'
            : score < 50
              ? 'text-status-critical'
              : score < 75
                ? 'text-status-warning'
                : 'text-status-ok';

        const TrendIcon =
          prediction.trend === 'up' ? TrendingUp : prediction.trend === 'down' ? TrendingDown : Minus;
        const trendLabel =
          prediction.trend === 'up' ? t.ai.trendUp : prediction.trend === 'down' ? t.ai.trendDown : t.ai.trendStable;

        const daysAhead =
          prediction.estimatedIssueDate === undefined || prediction.estimatedIssueDate === null
            ? null
            : Math.max(
                0,
                Math.round((new Date(prediction.estimatedIssueDate).getTime() - Date.now()) / 86_400_000),
              );

        return (
          <Card key={prediction.id} className={cn(score !== undefined && score < 50 && 'border-status-critical')}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-medium">{prediction.targetName ?? prediction.targetId}</p>
                {prediction.trend !== undefined && (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                    <TrendIcon className="h-3 w-3" aria-hidden />
                    {trendLabel}
                  </span>
                )}
              </div>

              {score !== undefined && (
                <div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-muted-foreground">{t.ai.healthScore}</span>
                    <span className={cn('tabular text-2xl font-semibold leading-none', tone)}>{formatNumber(score, locale)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div
                      className={cn(
                        'h-full rounded-full transition-[width] duration-700',
                        score < 50 ? 'bg-status-critical' : score < 75 ? 'bg-status-warning' : 'bg-status-ok',
                      )}
                      style={{ width: `${Math.max(2, score)}%` }}
                    />
                  </div>
                </div>
              )}

              <dl className="space-y-1 text-xs">
                {prediction.failureProbability !== undefined && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t.ai.failureRisk}</dt>
                    <dd className="tabular font-medium">{formatRatio(prediction.failureProbability, locale)}</dd>
                  </div>
                )}
                {daysAhead !== null && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t.ai.expectedIssue}</dt>
                    <dd className="tabular font-medium text-status-warning">
                      {formatNumber(daysAhead, locale)} {t.ai.days}
                      <span className="ml-1 font-normal text-muted-foreground">
                        ({formatDate(prediction.estimatedIssueDate ?? '', locale)})
                      </span>
                    </dd>
                  </div>
                )}
                {prediction.daysUntilService !== undefined && prediction.daysUntilService !== null && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t.pump.serviceDue}</dt>
                    <dd className="tabular font-medium">
                      {formatNumber(prediction.daysUntilService, locale)} {t.ai.days}
                    </dd>
                  </div>
                )}
              </dl>

              {(prediction.recommendationTh !== undefined || prediction.recommendationEn !== undefined) && (
                <p className="flex gap-1.5 border-t pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Wrench className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span>
                    {locale === 'th'
                      ? (prediction.recommendationTh ?? prediction.recommendationEn)
                      : (prediction.recommendationEn ?? prediction.recommendationTh)}
                  </span>
                </p>
              )}

              {prediction.note !== undefined && (
                <p className="rounded-control bg-status-warning-surface px-2 py-1.5 text-[11px] text-status-warning">
                  {prediction.note}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
