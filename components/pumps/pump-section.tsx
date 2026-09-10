'use client';

import type { Pump } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getPumps } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PumpCard } from './pump-card';

/** 1.2 — ปั๊ม 3 ตัว */
export function PumpSection(): JSX.Element {
  const { t } = useLocale();
  const { data, loading } = useLiveData<Pump[]>(getPumps, []);

  if (loading && data === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[268px] rounded-lg" />
        ))}
      </div>
    );
  }

  if (data === null || data.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm font-medium">{t.common.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((pump) => (
        <PumpCard key={pump.id} pump={pump} />
      ))}
    </div>
  );
}
