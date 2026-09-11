'use client';

import { AlertTriangle } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn, formatBaht, formatCubicMeters, formatFlow, formatLiters, formatPercent } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-badge';
import type { ZoneRow } from './zone-section';

/** ตารางโซน — ตัวเลขชิดขวาและใช้ tabular figures เพื่อให้เทียบคอลัมน์ได้ด้วยตา */
export function ZoneTable({ rows }: { rows: ZoneRow[] }): JSX.Element {
  const { t, locale } = useLocale();

  return (
    <Card className="overflow-hidden">
      {/* ตารางกว้างกว่าจอมือถือ ให้เลื่อนแนวนอนในกล่องนี้เท่านั้น ไม่ให้ทั้งหน้าเลื่อน */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b bg-secondary text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.zone.zone}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.zone.flowNow}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.zone.today}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.zone.month}</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.zone.cost}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">{t.zone.share}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ zone, cost, online }) => (
              <tr key={zone.id} className="border-b last:border-0 hover:bg-accent">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusDot
                      status={online ? zone.status : 'offline'}
                      title={online ? t.status[zone.status] : t.status.offline}
                    />
                    <span className="truncate font-medium">{locale === 'th' ? zone.name : zone.nameEn}</span>
                    {zone.isVip && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{t.zone.vip}</Badge>}
                    {zone.leakSuspected && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-status-critical">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        {t.zone.leakSuspected}
                      </span>
                    )}
                  </div>
                </td>
                <td className="tabular px-3 py-2.5 text-right">{formatFlow(zone.flowLpm, locale, 1)}</td>
                <td className="tabular px-3 py-2.5 text-right">
                  <span className="block">{formatCubicMeters(zone.todayCubicMeters, locale)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {formatLiters(zone.todayCubicMeters * 1000, locale, true)}
                  </span>
                </td>
                <td className="tabular px-3 py-2.5 text-right">
                  <span className="block">{formatCubicMeters(zone.monthCubicMeters, locale)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {cost === null ? '—' : `${cost.cubicMeters.toFixed(0)} ${t.zone.units}`}
                  </span>
                </td>
                <td className="tabular px-3 py-2.5 text-right font-medium">
                  {cost === null ? '—' : formatBaht(cost.costBaht, locale, 0)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className={cn('h-full rounded-full bg-water transition-[width] duration-700')}
                        style={{ width: `${Math.min(100, cost?.sharePercent ?? 0)}%` }}
                      />
                    </div>
                    <span className="tabular w-12 text-right text-xs">
                      {cost === null ? '—' : formatPercent(cost.sharePercent, locale, 1)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
