'use client';

import { CheckCircle2 } from 'lucide-react';
import type { AlertSeverity, EntityStatus, RecoveryEvent } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatDateTimeTH, formatMinutes } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-badge';

const TONE: Record<AlertSeverity, EntityStatus> = { critical: 'critical', warning: 'warning', info: 'ok' };

/**
 * เหตุการณ์ที่ปิดไปแล้ว
 * แยก "เกิดนานเท่าไร" ออกจาก "ใช้เวลาเท่าไรกว่าจะมีคนรับทราบ" เพราะสองอย่างนี้
 * วัดคนละเรื่อง — อย่างแรกวัดตัวปัญหา อย่างหลังวัดการตอบสนองของทีม
 */
export function RecoveryList({ events }: { events: RecoveryEvent[] }): JSX.Element {
  const { t, locale } = useLocale();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <CheckCircle2 className="h-4 w-4 text-status-ok" aria-hidden />
          {t.alerts.recoveries}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t.alerts.noRecoveries}</p>
        ) : (
          <ul className="divide-y">
            {events.map((event) => (
              <li key={event.alertId} className="py-2.5">
                <div className="flex items-start gap-2">
                  <StatusDot status={TONE[event.severity]} title={event.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{locale === 'th' ? event.messageTh : event.messageEn}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {event.sourceName} · {formatDateTimeTH(event.raisedAt, locale)} →{' '}
                      {formatDateTimeTH(event.resolvedAt, locale)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm font-semibold">{formatMinutes(event.durationMinutes, locale)}</p>
                    <p className="text-[10px] text-muted-foreground">{t.alerts.duration}</p>
                  </div>
                </div>
                {event.acknowledgedBy !== null && (
                  <p className="mt-1 pl-4 text-[11px] text-muted-foreground">
                    {t.alerts.acknowledgedBy} {event.acknowledgedBy.displayName}
                    {event.minutesToAcknowledge !== null &&
                      ` · ${t.alerts.timeToAck} ${formatMinutes(event.minutesToAcknowledge, locale)}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
