'use client';

import { Info } from 'lucide-react';
import type { AnomalyEvent, EnvironmentSensor, MainMeter, Paginated, Pump, Tank, Valve, Zone } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getAnomalies, getEnvironmentSensors, getMainMeter, getPumps, getTanks, getValves, getZones } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FlowDiagram, type FlowDiagramData } from '@/components/diagram/flow-diagram';

/** Phase 3B — Infographic แผนผังการไหลของน้ำ */
export default function FlowDiagramPage(): JSX.Element {
  const { t } = useLocale();

  const { data, loading } = useLiveData<FlowDiagramData>(async () => {
    const [tanks, pumps, zones, valves, mainMeter, sensors, anomalies] = await Promise.all([
      getTanks(),
      getPumps(),
      getZones(),
      getValves(),
      getMainMeter(),
      getEnvironmentSensors(),
      getAnomalies({ limit: 50 }),
    ]);
    return { tanks, pumps, zones, valves, mainMeter, sensors, anomalies: anomalies.items };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.diagram.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.diagram.clickHint}</p>
      </div>

      {loading && data === null ? (
        <Skeleton className="h-[520px] rounded-card" />
      ) : data === null ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm font-medium">{t.common.empty}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          {/* ผังกว้างกว่าจอมือถือ ให้เลื่อนแนวนอนเฉพาะในกล่องนี้ ไม่ให้ทั้งหน้าเลื่อน */}
          <CardContent className="overflow-x-auto p-4">
            <FlowDiagram data={data} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Info className="h-3.5 w-3.5" aria-hidden />
            {t.diagram.legend}
          </span>
          <Legend className="bg-status-ok" label={t.status.ok} />
          <Legend className="bg-status-warning" label={t.status.warning} />
          <Legend className="bg-status-critical" label={t.status.critical} />
          <Legend className="bg-status-offline" label={t.status.offline} />
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-6 rounded-full border-2 border-dashed border-primary" aria-hidden />
            {t.diagram.anomalyHere}
          </span>
          <span>{t.diagram.flowSpeed}</span>
        </CardContent>
      </Card>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}
