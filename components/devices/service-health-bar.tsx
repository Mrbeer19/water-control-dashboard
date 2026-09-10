'use client';

import { Bot, Cpu, Database, Radio } from 'lucide-react';
import type { ServiceHealth, ServiceKind } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getServiceHealth } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';

const ICONS: Record<ServiceKind, typeof Radio> = {
  mqtt_broker: Radio,
  database: Database,
  ingest: Cpu,
  ai: Bot,
};

/** แถบสถานะบริการเบื้องหลัง — ถ้าตัวใดตัวหนึ่งล้ม ข้อมูลบนแดชบอร์ดจะหยุดนิ่งโดยไม่มีใครรู้ */
export function ServiceHealthBar(): JSX.Element {
  const { t, locale } = useLocale();
  const { data, loading } = useLiveData<ServiceHealth[]>(getServiceHealth, []);

  if (loading && data === null) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[86px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (data === null) return <p className="text-sm text-muted-foreground">{t.common.error}</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {data.map((service) => {
        const Icon = ICONS[service.kind];
        return (
          <Card key={service.kind} className={cn(service.status !== 'ok' && 'border-status-warning/40')}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="inline-flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{locale === 'th' ? service.name : service.nameEn}</span>
                </p>
                <StatusBadge status={service.status} />
              </div>
              <p className="tabular mt-1 truncate text-[11px] text-muted-foreground">
                {service.endpoint}
                {service.latencyMs !== null && ` · ${formatNumber(service.latencyMs, locale)} ms`}
              </p>
              {service.detail !== null && (
                <p className="tabular truncate text-[11px] text-muted-foreground">
                  {Object.entries(service.detail)
                    .map(([key, value]) => `${key} ${value}`)
                    .join(' · ')}
                </p>
              )}
              {service.message !== null && (
                <p className="mt-1 text-[11px] leading-snug text-status-warning">{service.message}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
