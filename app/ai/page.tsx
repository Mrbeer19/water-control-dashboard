'use client';

import { useCallback, useMemo, useState } from 'react';
import type {
  AIForecast,
  AIMetric,
  AIServiceStatus,
  AlertSeverity,
  AnomalyEvent,
  AnomalyStatus,
  DailyUsagePoint,
  MaintenancePrediction,
  Paginated,
} from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import {
  getAIMetrics,
  getAIServiceStatus,
  getAnomalies,
  getDailyUsage,
  getForecasts,
  getMaintenancePredictions,
  getScenario,
  setAnomalyStatus,
  submitAnomalyFeedback,
} from '@/lib/services';
import type { MockScenario } from '@/lib/types';
import { getAnomalyTypeConfig } from '@/lib/config/anomaly-types';
import { useLocale } from '@/lib/i18n';
import { Section } from '@/components/layout/section';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AiSummaryCard } from '@/components/ai/ai-summary-card';
import { AiMetricsSection } from '@/components/ai/ai-metrics-section';
import { AnomalyCard } from '@/components/ai/anomaly-card';
import { AnomalyTimeline } from '@/components/ai/anomaly-timeline';
import { ForecastSection } from '@/components/ai/forecast-section';
import { MaintenanceSection } from '@/components/ai/maintenance-section';
import { ScenarioSwitcher } from '@/components/ai/scenario-switcher';

const SELECT_CLASS =
  'h-9 rounded-control border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface AiData {
  page: Paginated<AnomalyEvent>;
  status: AIServiceStatus;
  forecasts: AIForecast[];
  maintenance: MaintenancePrediction[];
  metrics: AIMetric[];
  daily: DailyUsagePoint[];
  scenario: MockScenario;
}

/**
 * Phase 4.5 — หน้า AI Insights
 *
 * ★ หน้านี้แสดงผลอย่างเดียว ไม่มีตรรกะตรวจจับหรือพยากรณ์อยู่ในฝั่งนี้เลย
 *   ทุกอย่างมาจาก lib/services/ai.ts และต้องทนกับผลที่ส่งมาไม่ครบได้
 */
export default function AiPage(): JSX.Element {
  const { t, locale } = useLocale();
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all');
  const [status, setStatus] = useState<AnomalyStatus | 'all'>('all');
  const [type, setType] = useState('all');
  const [target, setTarget] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const { data, loading } = useLiveData<AiData>(async () => {
    const [page, serviceStatus, forecasts, maintenance, metrics, daily, scenario] = await Promise.all([
      getAnomalies({ limit: 100 }),
      getAIServiceStatus(),
      getForecasts(),
      getMaintenancePredictions(),
      getAIMetrics(),
      getDailyUsage(false),
      getScenario(),
    ]);
    return { page, status: serviceStatus, forecasts, maintenance, metrics, daily, scenario };
  }, [refreshKey]);

  // ตัวเลือกฟิลเตอร์สร้างจากผลที่ได้มาจริง ไม่ได้ fix ไว้ล่วงหน้า
  // เพราะทีม AI เพิ่มชนิดใหม่ได้ตลอดโดยหน้าบ้านไม่ต้องแก้
  const typeOptions = useMemo(
    () => [...new Set((data?.page.items ?? []).map((anomaly) => anomaly.type))].sort(),
    [data],
  );
  const targetOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const anomaly of data?.page.items ?? []) {
      if (anomaly.sourceId === undefined) continue;
      map.set(anomaly.sourceId, anomaly.sourceName ?? anomaly.sourceId);
    }
    return [...map.entries()];
  }, [data]);

  const filtered = useMemo(() => {
    return (data?.page.items ?? []).filter((anomaly) => {
      // รายการที่ไม่ได้ระบุ severity ต้องไม่ถูกกรองทิ้งเงียบ ๆ ด้วยเงื่อนไขที่อ้าง field นั้น
      if (severity !== 'all' && anomaly.severity !== undefined && anomaly.severity !== severity) return false;
      if (status !== 'all' && anomaly.status !== status) return false;
      if (type !== 'all' && anomaly.type !== type) return false;
      if (target !== 'all' && anomaly.sourceId !== target) return false;
      return true;
    });
  }, [data, severity, status, type, target]);

  const handleFeedback = useCallback(
    (id: string, feedback: 'confirmed' | 'false_positive') => {
      void submitAnomalyFeedback(id, feedback).then(refresh);
    },
    [refresh],
  );

  const handleStatusChange = useCallback(
    (id: string, next: AnomalyStatus) => {
      void setAnomalyStatus(id, next).then(refresh);
    },
    [refresh],
  );

  return (
    <div className="space-y-8">
      <ScenarioSwitcher current={data?.scenario ?? null} onChanged={refresh} />

      {/* A — สรุปสถานะบริการ AI */}
      <AiSummaryCard status={data?.status ?? null} loading={loading} />

      {/* ค่าที่ทีม AI คำนวณมา */}
      <Section title={t.ai.metrics} hint={t.ai.metricsHint}>
        <AiMetricsSection metrics={data?.metrics ?? null} loading={loading} />
      </Section>

      {/* B — รายการความผิดปกติ */}
      <Section
        title={t.ai.anomalies}
        hint={data === null ? undefined : `${t.device.showing} ${filtered.length}/${data.page.total}`}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <select className={SELECT_CLASS} value={severity} aria-label={t.alerts.severity} onChange={(e) => { setSeverity(e.target.value as AlertSeverity | 'all'); }}>
              <option value="all">{t.alerts.allSeverity}</option>
              <option value="critical">{t.status.critical}</option>
              <option value="warning">{t.status.warning}</option>
              <option value="info">INFO</option>
            </select>

            <select className={SELECT_CLASS} value={status} aria-label={t.alerts.state} onChange={(e) => { setStatus(e.target.value as AnomalyStatus | 'all'); }}>
              <option value="all">{t.alerts.allStates}</option>
              <option value="active">{t.ai.statusActive}</option>
              <option value="resolved">{t.ai.statusResolved}</option>
              <option value="dismissed">{t.ai.statusDismissed}</option>
            </select>

            <select className={SELECT_CLASS} value={type} aria-label={t.ai.allTypes} onChange={(e) => { setType(e.target.value); }}>
              <option value="all">{t.ai.allTypes}</option>
              {typeOptions.map((option) => (
                <option key={option} value={option}>
                  {getAnomalyTypeConfig(option)[locale === 'th' ? 'labelTh' : 'labelEn']}
                </option>
              ))}
            </select>

            <select className={SELECT_CLASS} value={target} aria-label={t.ai.allTargets} onChange={(e) => { setTarget(e.target.value); }}>
              <option value="all">{t.ai.allTargets}</option>
              {targetOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>

          {loading && data === null ? (
            <Skeleton className="h-[150px] rounded-card" />
          ) : data !== null && data.page.items.length > 0 ? (
            <Card>
              <CardContent className="p-4">
                <AnomalyTimeline anomalies={filtered} daily={data.daily} />
              </CardContent>
            </Card>
          ) : null}

          {loading && data === null ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-[280px] rounded-card" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm font-medium">{t.ai.noAnomalies}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.ai.noAnomaliesHint}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {filtered.map((anomaly) => (
                <AnomalyCard
                  key={anomaly.id}
                  anomaly={anomaly}
                  onFeedback={handleFeedback}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* C — การพยากรณ์ */}
      <Section title={t.ai.forecasts}>
        <ForecastSection forecasts={data?.forecasts ?? null} loading={loading} />
      </Section>

      {/* D — สุขภาพอุปกรณ์ */}
      <Section title={t.ai.maintenance}>
        <MaintenanceSection predictions={data?.maintenance ?? null} loading={loading} />
      </Section>
    </div>
  );
}
