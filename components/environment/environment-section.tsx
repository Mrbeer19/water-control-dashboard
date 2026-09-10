'use client';

import type { DailyUsagePoint, EnvironmentSensor } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getDailyUsage, getEnvironmentSensors } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EnvironmentCard } from './environment-card';
import { TempVsUsageChart } from './temp-vs-usage-chart';

/** 1.7 — สภาพแวดล้อมจากเซนเซอร์ในพื้นที่ (ไม่มีการเรียก weather API ใด ๆ) */
export function EnvironmentSection(): JSX.Element {
  const { t } = useLocale();
  const { data, loading } = useLiveData<{ sensors: EnvironmentSensor[]; daily: DailyUsagePoint[] }>(async () => {
    const [sensors, daily] = await Promise.all([getEnvironmentSensors(), getDailyUsage(false)]);
    return { sensors, daily };
  }, []);

  if (loading && data === null) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[268px] rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-lg" />
      </div>
    );
  }

  if (data === null || data.sensors.length === 0) {
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
    <div className="space-y-4">
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.sensors.map((sensor) => (
          <EnvironmentCard key={sensor.id} sensor={sensor} />
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t.env.tempVsUsage}</CardTitle>
        </CardHeader>
        <CardContent>
          <TempVsUsageChart points={data.daily} />
        </CardContent>
      </Card>
    </div>
  );
}
