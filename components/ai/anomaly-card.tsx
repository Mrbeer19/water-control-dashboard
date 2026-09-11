'use client';

import Link from 'next/link';
import { ArrowRight, Check, Lightbulb, ThumbsDown } from 'lucide-react';
import type { AlertSeverity, AnomalyEvent, EntityStatus } from '@/lib/types';
import { getAnomalyTypeConfig, isUnknownAnomalyType } from '@/lib/config/anomaly-types';
import { useLocale } from '@/lib/i18n';
import {
  anomalyScorePercent,
  cn,
  formatAnomalyScore,
  formatDateTimeTH,
  formatMinutes,
  formatNumber,
} from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { AnomalyTypeBadge } from './anomaly-type-badge';
import { AnomalyEvidenceChart } from './anomaly-evidence-chart';

const SEVERITY_TONE: Record<AlertSeverity, EntityStatus> = { critical: 'critical', warning: 'warning', info: 'ok' };

/** หน้าที่รายละเอียดของอุปกรณ์แต่ละชนิดอยู่ที่ไหน ใช้ทำลิงก์จากการ์ด */
function targetHref(anomaly: AnomalyEvent): string | null {
  switch (anomaly.sourceType) {
    case 'pump':
    case 'valve':
    case 'pressure_control':
      return '/control';
    case 'device':
      return anomaly.sourceId === undefined ? '/devices' : `/devices?device=${anomaly.sourceId}`;
    case 'zone':
    case 'tank':
    case 'meter':
      return '/overview';
    case 'sensor':
      return '/';
    default:
      return null;
  }
}

/**
 * B — การ์ดความผิดปกติหนึ่งรายการ
 *
 * ★ ทุกส่วนซ่อนได้หมดยกเว้นหัวการ์ด เพราะสัญญากับทีม AI บังคับแค่
 *   id / type / detectedAt / status การ์ดจึงต้องยังอ่านรู้เรื่องแม้ได้มาเท่านั้น
 */
export function AnomalyCard({
  anomaly,
  onFeedback,
  onStatusChange,
}: {
  anomaly: AnomalyEvent;
  onFeedback: (id: string, feedback: 'confirmed' | 'false_positive') => void;
  onStatusChange: (id: string, status: AnomalyEvent['status']) => void;
}): JSX.Element {
  const { t, locale } = useLocale();
  const config = getAnomalyTypeConfig(anomaly.type);
  const scorePercent = anomalyScorePercent(anomaly.score);
  const href = targetHref(anomaly);

  // ใช้ข้อความจากทีม AI ถ้ามี ไม่มีค่อยใช้คำอธิบายกลางของชนิดนั้น
  const summary =
    (locale === 'th' ? anomaly.summaryTh : anomaly.summaryEn) ??
    (locale === 'th' ? config.descriptionTh : config.descriptionEn);

  const durationMinutes =
    anomaly.windowStart === undefined || anomaly.windowStart === null || anomaly.windowEnd === undefined || anomaly.windowEnd === null
      ? null
      : Math.max(0, Math.round((new Date(anomaly.windowEnd).getTime() - new Date(anomaly.windowStart).getTime()) / 60_000));

  return (
    <Card className={cn(anomaly.status !== 'active' && 'opacity-70')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1.5">
            <AnomalyTypeBadge type={anomaly.type} />
            <p className="text-sm font-medium leading-snug">{summary}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {anomaly.sourceName !== undefined && <span>{anomaly.sourceName}</span>}
              {anomaly.sourceName === undefined && anomaly.sourceId !== undefined && <span>{anomaly.sourceId}</span>}
              <span>· {t.ai.detectedAt} {formatDateTimeTH(anomaly.detectedAt, locale)}</span>
              {durationMinutes !== null && <span>· {t.ai.lasted} {formatMinutes(durationMinutes, locale)}</span>}
              {anomaly.detector !== undefined && <span>· {t.ai.detector} {anomaly.detector}</span>}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {anomaly.severity !== undefined && <StatusBadge status={SEVERITY_TONE[anomaly.severity]} />}
            <Badge variant="outline" className="text-[10px]">
              {anomaly.status === 'active'
                ? t.ai.statusActive
                : anomaly.status === 'resolved'
                  ? t.ai.statusResolved
                  : t.ai.statusDismissed}
            </Badge>
          </div>
        </div>

        {isUnknownAnomalyType(anomaly.type) && (
          <p className="text-[10px] text-muted-foreground">{t.ai.unknownTypeNote}</p>
        )}

        {/* คะแนน — ไม่มีก็ไม่ต้องโชว์แถบ */}
        {scorePercent !== null && (
          <div>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-muted-foreground">{t.ai.score}</span>
              <span className="tabular font-semibold">{formatAnomalyScore(anomaly.score, locale)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-700',
                  scorePercent >= 80 ? 'bg-status-critical' : scorePercent >= 50 ? 'bg-status-warning' : 'bg-status-ok',
                )}
                style={{ width: `${Math.max(2, scorePercent)}%` }}
              />
            </div>
          </div>
        )}

        {anomaly.evidence !== undefined && anomaly.evidence.length > 1 && (
          <AnomalyEvidenceChart evidence={anomaly.evidence} expectedBand={anomaly.expectedBand} />
        )}

        {anomaly.features !== undefined && anomaly.features.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">{t.ai.why}</p>
            <ul className="space-y-1">
              {anomaly.features.map((feature) => (
                <li key={feature.key} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{feature.key}</span>
                  <span className="tabular shrink-0">
                    {formatNumber(feature.value, locale, 1)}
                    {feature.expected !== undefined && feature.expected !== null && (
                      <span className="text-muted-foreground"> / {formatNumber(feature.expected, locale, 1)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {anomaly.suggestedAction !== undefined && (
          <p className="flex gap-1.5 rounded-control border px-2.5 py-2 text-xs leading-relaxed text-info">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-medium">{t.ai.suggestedAction}: </span>
              {anomaly.suggestedAction}
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {anomaly.feedback === 'confirmed' || anomaly.feedback === 'false_positive' ? (
            <span className="text-[11px] text-status-ok">
              {t.ai.feedbackThanks} · {anomaly.feedback === 'confirmed' ? t.ai.confirm : t.ai.falsePositiveBtn}
            </span>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={() => {
                  onFeedback(anomaly.id, 'confirmed');
                }}
              >
                <Check className="h-3 w-3" aria-hidden />
                {t.ai.confirm}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-[11px]"
                onClick={() => {
                  onFeedback(anomaly.id, 'false_positive');
                }}
              >
                <ThumbsDown className="h-3 w-3" aria-hidden />
                {t.ai.falsePositiveBtn}
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => {
              onStatusChange(anomaly.id, anomaly.status === 'active' ? 'dismissed' : 'active');
            }}
          >
            {anomaly.status === 'active' ? t.ai.dismiss : t.ai.reopen}
          </Button>

          {href !== null && (
            <Link
              href={href}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-brand-text hover:underline"
            >
              {t.overview.viewAll}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
