'use client';

import { ArrowDown, ArrowUp, Hand, Minus } from 'lucide-react';
import type { Tank } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import {
  cn,
  formatFlow,
  formatLiters,
  formatMinutes,
  formatPercent,
  formatRelativeTime,
  STATUS_TEXT_CLASS,
} from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { TankGauge } from './tank-gauge';

/** การ์ดถังน้ำหนึ่งใบ — ตัวเลขใหญ่พอสำหรับจอแขวนผนัง */
export function TankCard({ tank }: { tank: Tank }): JSX.Element {
  const { t, locale } = useLocale();

  const markers = [
    tank.thresholdsPercent.warningLow === null
      ? null
      : { percent: tank.thresholdsPercent.warningLow, tone: 'warning' as const },
    tank.thresholdsPercent.criticalLow === null
      ? null
      : { percent: tank.thresholdsPercent.criticalLow, tone: 'critical' as const },
  ].filter((marker): marker is { percent: number; tone: 'warning' | 'critical' } => marker !== null);

  // แสดงเวลาที่จะเต็มหรือจะหมด อันใดอันหนึ่งตามทิศทางการไหลจริง
  const eta =
    tank.minutesToEmpty !== null
      ? { label: t.tank.toEmpty, value: formatMinutes(tank.minutesToEmpty, locale), tone: 'text-status-warning' }
      : tank.minutesToFull !== null
        ? { label: t.tank.toFull, value: formatMinutes(tank.minutesToFull, locale), tone: 'text-status-ok' }
        : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 p-4">
        <div className="h-[150px] w-[110px] shrink-0">
          <TankGauge percentFull={tank.percentFull} status={tank.status} shape={tank.shape} markers={markers} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{locale === 'th' ? tank.name : tank.nameEn}</p>
              <p className="truncate text-xs text-muted-foreground">
                {locale === 'th' ? tank.location : tank.locationEn}
              </p>
            </div>
            <StatusBadge status={tank.status} />
          </div>

          <div className="mt-2">
            <p className={cn('tabular text-metric leading-none', STATUS_TEXT_CLASS[tank.status])}>
              {formatPercent(tank.percentFull, locale, 1)}
            </p>
            <p className="tabular mt-1 text-sm font-medium">
              {formatLiters(tank.currentLiters, locale, true)}
              <span className="text-muted-foreground"> / {formatLiters(tank.capacityLiters, locale, true)}</span>
            </p>
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1 pt-3 text-xs">
            <div className="flex items-center gap-1">
              <ArrowDown className="h-3 w-3 text-status-ok" aria-hidden />
              <dt className="sr-only">{t.tank.inflow}</dt>
              <dd className="tabular">{formatFlow(tank.inflowLpm, locale, 0)}</dd>
            </div>
            <div className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-status-warning" aria-hidden />
              <dt className="sr-only">{t.tank.outflow}</dt>
              <dd className="tabular">{formatFlow(tank.outflowLpm, locale, 0)}</dd>
            </div>

            {eta !== null && (
              <div className="col-span-2 flex items-center gap-1">
                <Minus className="h-3 w-3 text-muted-foreground" aria-hidden />
                <dt className="text-muted-foreground">{eta.label}</dt>
                <dd className={cn('tabular font-medium', eta.tone)}>{eta.value}</dd>
              </div>
            )}

            <div className="col-span-2 flex items-center gap-1 text-muted-foreground">
              {tank.levelSource === 'manual' ? (
                <>
                  <Hand className="h-3 w-3" aria-hidden />
                  <span>
                    {t.tank.manualReading}
                    {tank.manualReadingAt !== null && ` · ${formatRelativeTime(tank.manualReadingAt, locale)}`}
                  </span>
                </>
              ) : (
                <span>
                  {t.common.updatedAt} {formatRelativeTime(tank.lastSeen, locale)}
                </span>
              )}
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
