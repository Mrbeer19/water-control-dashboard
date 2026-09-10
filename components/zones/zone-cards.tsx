'use client';

import { AlertTriangle } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { formatBaht, formatCubicMeters, formatFlow, formatPercent } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ZoneRow } from './zone-section';

/** มุมมองการ์ดของโซน — ใช้บนมือถือหรือจอแขวนที่อยากได้ตัวเลขใหญ่ */
export function ZoneCards({ rows }: { rows: ZoneRow[] }): JSX.Element {
  const { t, locale } = useLocale();

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {rows.map(({ zone, cost, online }) => (
        <Card key={zone.id}>
          <CardContent className="space-y-2.5 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-sm font-semibold">{locale === 'th' ? zone.name : zone.nameEn}</p>
              {zone.isVip && <Badge variant="outline" className="h-4 shrink-0 px-1.5 text-[10px]">{t.zone.vip}</Badge>}
            </div>

            <StatusBadge status={online ? zone.status : 'offline'} />

            <p className="tabular text-2xl font-semibold leading-none">{formatFlow(zone.flowLpm, locale, 1)}</p>

            <dl className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t pt-2.5 text-xs">
              <div>
                <dt className="text-[10px] text-muted-foreground">{t.zone.today}</dt>
                <dd className="tabular font-medium">{formatCubicMeters(zone.todayCubicMeters, locale)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground">{t.zone.month}</dt>
                <dd className="tabular font-medium">{formatCubicMeters(zone.monthCubicMeters, locale)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground">{t.zone.cost}</dt>
                <dd className="tabular font-medium">{cost === null ? '—' : formatBaht(cost.costBaht, locale, 0)}</dd>
              </div>
              <div>
                <dt className="text-[10px] text-muted-foreground">{t.zone.share}</dt>
                <dd className="tabular font-medium">
                  {cost === null ? '—' : formatPercent(cost.sharePercent, locale, 1)}
                </dd>
              </div>
            </dl>

            {zone.leakSuspected && (
              <p className="inline-flex items-center gap-1 text-[11px] text-status-critical">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {t.zone.leakSuspected}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
