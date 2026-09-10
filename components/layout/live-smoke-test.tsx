'use client';

import { Radio } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getSystemSummary } from '@/lib/services';
import { formatCubicMeters, formatFlow, formatLiters, formatPercent } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * การ์ดตรวจสอบว่า mock → service → UI เดินครบวงจร (ค่าต้องขยับทุก 2 วินาที)
 * ★ ของชั่วคราวสำหรับ Phase 0 — ลบทิ้งได้เมื่อหน้า Overview ตัวจริงเสร็จ
 */
export function LiveSmokeTest(): JSX.Element {
  const { locale } = useLocale();
  const { data, loading } = useLiveData(getSystemSummary, []);
  const isThai = locale === 'th';

  return (
    <Card className="mx-auto max-w-3xl border-dashed">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-status-ok" aria-hidden />
          <p className="text-sm font-medium">
            {isThai ? 'ตรวจการเดินของข้อมูลสด' : 'Live data smoke test'}
          </p>
          <Badge variant="outline" className="ml-auto text-[10px]">
            {isThai ? 'ชั่วคราว — Phase 0' : 'Temporary — Phase 0'}
          </Badge>
        </div>

        {loading && data === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-16 rounded-md" />
            ))}
          </div>
        ) : data === null ? (
          <p className="text-sm text-muted-foreground">{isThai ? 'ยังไม่มีข้อมูล' : 'No data yet'}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label={isThai ? 'น้ำสำรองรวม' : 'Total stored'}
              value={formatLiters(data.totalStoredLiters, locale, true)}
              sub={formatPercent(data.totalStoredPercent, locale)}
            />
            <Metric
              label={isThai ? 'น้ำเข้าจากมิเตอร์หลัก' : 'Main inflow'}
              value={formatFlow(data.mainInflowLpm, locale)}
              sub={`${isThai ? 'ออก' : 'Out'} ${formatFlow(data.zoneOutflowLpm, locale)}`}
            />
            <Metric
              label={isThai ? 'ใช้วันนี้' : 'Used today'}
              value={formatCubicMeters(data.todayConsumptionCubicMeters, locale)}
              sub={`${isThai ? 'สูญหาย' : 'Unaccounted'} ${formatPercent(data.unaccounted.unaccountedPercent, locale)}`}
            />
            <Metric
              label={isThai ? 'ปั๊มที่เดินอยู่' : 'Pumps running'}
              value={`${data.pumpsRunning}/${data.pumpsTotal}`}
              sub={`${isThai ? 'อุปกรณ์ออนไลน์' : 'Devices online'} ${data.devicesOnline}/${data.devicesTotal}`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }): JSX.Element {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 text-lg font-semibold leading-tight">{value}</p>
      <p className="tabular text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
