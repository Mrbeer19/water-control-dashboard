'use client';

import type { Tank } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getTanks } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TankCard } from './tank-card';

/** 1.1 — ระดับน้ำ 3 ถัง */
export function TankSection(): JSX.Element {
  const { t } = useLocale();
  const { data, loading } = useLiveData<Tank[]>(getTanks, []);

  if (loading && data === null) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-[198px] rounded-lg" />
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
      {data.map((tank) => (
        <TankCard key={tank.id} tank={tank} />
      ))}
    </div>
  );
}
