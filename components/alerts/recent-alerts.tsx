'use client';

import Link from 'next/link';
import { ArrowRight, BellOff } from 'lucide-react';
import type { Alert, AlertSeverity, EntityStatus, Paginated } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getAlerts } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-badge';

const SEVERITY_TONE: Record<AlertSeverity, EntityStatus> = {
  critical: 'critical',
  warning: 'warning',
  info: 'ok',
};

/** 1.6 — แถบ Alerts ล่าสุด 5 รายการ */
export function RecentAlerts(): JSX.Element {
  const { t, locale } = useLocale();
  const { data, loading } = useLiveData<Paginated<Alert>>(() => getAlerts({ limit: 5 }), []);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-end space-y-0 pb-2">
        <Link
          href="/alerts"
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline"
        >
          {t.overview.viewAll}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && data === null ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-11 rounded-md" />
            ))}
          </div>
        ) : data === null || data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-8 text-center">
            <BellOff className="h-5 w-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{t.header.noUnreadAlerts}</p>
            <p className="text-xs text-muted-foreground">{t.common.emptyHint}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {data.items.map((alert) => (
              <li key={alert.id}>
                <Link
                  href="/alerts"
                  className="flex items-start gap-2.5 py-2.5 transition-colors hover:bg-accent/40"
                >
                  <StatusDot status={SEVERITY_TONE[alert.severity]} title={t.status[SEVERITY_TONE[alert.severity]]} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm', !alert.read && 'font-semibold')}>
                      {locale === 'th' ? alert.messageTh : alert.messageEn}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {alert.sourceName} · {formatRelativeTime(alert.raisedAt, locale)}
                      {alert.occurrenceCount > 1 && ` · ×${alert.occurrenceCount}`}
                    </p>
                  </div>
                  {alert.state === 'resolved' && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">{t.zone.resolved}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
