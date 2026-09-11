'use client';

import { useCallback, useMemo, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import type {
  Alert,
  AlertAcknowledgement,
  AlertCode,
  AlertSeverity,
  AlertState,
  EntityStatus,
  NotificationDelivery,
  NotificationPreview,
  Paginated,
  RecoveryEvent,
  Zone,
} from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import {
  acknowledgeAlert,
  getAcknowledgements,
  getAlerts,
  getCurrentUser,
  getNotificationDeliveries,
  getNotificationPreview,
  getRecoveryEvents,
  getZones,
  markAllAlertsRead,
} from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatDateTimeTH, formatRelativeTime } from '@/lib/utils';
import { Section } from '@/components/layout/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-badge';
import { LinePreviewCard } from '@/components/alerts/line-preview-card';
import { RecoveryList } from '@/components/alerts/recovery-list';

const SELECT_CLASS =
  'h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const SEVERITY_TONE: Record<AlertSeverity, EntityStatus> = {
  critical: 'critical',
  warning: 'warning',
  info: 'ok',
};

interface AlertsData {
  page: Paginated<Alert>;
  zones: Zone[];
  acks: AlertAcknowledgement[];
  recoveries: RecoveryEvent[];
  deliveries: NotificationDelivery[];
  preview: NotificationPreview | null;
  userId: string;
}

/** Phase 4A — หน้าการแจ้งเตือน */
export default function AlertsPage(): JSX.Element {
  const { t, locale } = useLocale();
  const [severity, setSeverity] = useState<AlertSeverity | 'all'>('all');
  const [state, setState] = useState<AlertState | 'all'>('all');
  const [zoneId, setZoneId] = useState<string>('all');
  const [code, setCode] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const { data, loading } = useLiveData<AlertsData>(async () => {
    const [page, zones, acks, recoveries, user] = await Promise.all([
      getAlerts({
        severities: severity === 'all' ? undefined : [severity],
        states: state === 'all' ? undefined : [state],
        sourceIds: zoneId === 'all' ? undefined : [zoneId],
        codes: code === 'all' ? undefined : [code as AlertCode],
        range:
          from === '' || to === ''
            ? undefined
            : { preset: 'custom', from: new Date(from).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() },
        limit: 100,
      }),
      getZones(),
      getAcknowledgements(),
      getRecoveryEvents(10),
      getCurrentUser(),
    ]);

    const [deliveries, preview] = await Promise.all([
      selectedId === null ? Promise.resolve([]) : getNotificationDeliveries(selectedId),
      selectedId === null ? Promise.resolve(null) : getNotificationPreview(selectedId, 'line'),
    ]);

    return { page, zones, acks, recoveries, deliveries, preview, userId: user?.id ?? 'user-somchai' };
  }, [severity, state, zoneId, code, from, to, selectedId, refreshKey]);

  // รวมรหัสเหตุการณ์ที่มีอยู่จริงมาทำตัวเลือก แทนการไล่ทุกรหัสในระบบที่ยังไม่เคยเกิด
  const availableCodes = useMemo(() => {
    if (data === null) return [];
    return [...new Set(data.page.items.map((alert) => alert.code))].sort();
  }, [data]);

  const ackOf = (alert: Alert): AlertAcknowledgement | null =>
    alert.acknowledgementId === null
      ? null
      : (data?.acks.find((item) => item.id === alert.acknowledgementId) ?? null);

  return (
    <div className="space-y-8">
      <Section
        title={t.nav.alerts}
        hint={data === null ? undefined : `${t.device.showing} ${data.page.items.length}/${data.page.total}`}
        action={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              void markAllAlertsRead().then(refresh);
            }}
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
            {t.alerts.markAllRead}
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className={SELECT_CLASS} value={severity} aria-label={t.alerts.severity} onChange={(e) => { setSeverity(e.target.value as AlertSeverity | 'all'); }}>
              <option value="all">{t.alerts.allSeverity}</option>
              <option value="critical">{t.status.critical}</option>
              <option value="warning">{t.status.warning}</option>
              <option value="info">INFO</option>
            </select>

            <select className={SELECT_CLASS} value={state} aria-label={t.alerts.state} onChange={(e) => { setState(e.target.value as AlertState | 'all'); }}>
              <option value="all">{t.alerts.allStates}</option>
              <option value="active">{t.alerts.active}</option>
              <option value="acknowledged">{t.alerts.acknowledged}</option>
              <option value="resolved">{t.alerts.resolved}</option>
            </select>

            <select className={SELECT_CLASS} value={code} aria-label={t.alerts.code} onChange={(e) => { setCode(e.target.value); }}>
              <option value="all">{t.alerts.allCodes}</option>
              {availableCodes.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>

            <select className={SELECT_CLASS} value={zoneId} aria-label={t.alerts.source} onChange={(e) => { setZoneId(e.target.value); }}>
              <option value="all">{t.alerts.allZones}</option>
              {data?.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{locale === 'th' ? zone.name : zone.nameEn}</option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t.alerts.from}
              <input type="date" className={SELECT_CLASS} value={from} onChange={(e) => { setFrom(e.target.value); }} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {t.alerts.to}
              <input type="date" className={SELECT_CLASS} value={to} onChange={(e) => { setTo(e.target.value); }} />
            </label>
          </div>

          {loading && data === null ? (
            <Skeleton className="h-80 rounded-lg" />
          ) : data === null || data.page.items.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm font-medium">{t.alerts.noAlerts}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.alerts.message}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.alerts.code}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.alerts.raisedAt}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.alerts.state}</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">{t.alerts.acknowledge}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.page.items.map((alert) => {
                      const ack = ackOf(alert);
                      const selected = alert.id === selectedId;
                      return (
                        <tr
                          key={alert.id}
                          onClick={() => { setSelectedId(alert.id); }}
                          className={cn('cursor-pointer border-b last:border-0 align-top hover:bg-accent/40', selected && 'bg-accent/60')}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-start gap-2">
                              <StatusDot status={SEVERITY_TONE[alert.severity]} title={t.status[SEVERITY_TONE[alert.severity]]} />
                              <div className="min-w-0">
                                <p className={cn('text-sm', !alert.read && 'font-semibold')}>
                                  {locale === 'th' ? alert.messageTh : alert.messageEn}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {alert.sourceName}
                                  {alert.occurrenceCount > 1 && ` · ×${alert.occurrenceCount}`}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{alert.code}</code>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                            {formatRelativeTime(alert.raisedAt, locale)}
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            {alert.state === 'resolved' ? (
                              <span className="text-status-ok">{t.alerts.resolved}</span>
                            ) : alert.state === 'acknowledged' ? (
                              <span className="text-muted-foreground">{t.alerts.acknowledged}</span>
                            ) : (
                              <span className="text-status-warning">{t.alerts.active}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {ack !== null ? (
                              <div className="text-[11px] text-muted-foreground">
                                <p className="font-medium text-foreground">{ack.acknowledgedBy.displayName}</p>
                                <p>{formatDateTimeTH(ack.acknowledgedAt, locale)}</p>
                                {ack.note !== null && <p className="italic">{ack.note}</p>}
                              </div>
                            ) : alert.state === 'resolved' ? (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void acknowledgeAlert(alert.id, data.userId, null, null).then(refresh);
                                }}
                              >
                                {t.alerts.acknowledge}
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </Section>

      {/*
        min-w-0 จำเป็นจริง ๆ ตรงนี้: grid item มี min-width: auto ตามค่าตั้งต้น
        จึงหดต่ำกว่าความกว้างของเนื้อหาไม่ได้ และ LINE group id เป็นสตริงยาวไม่มีช่องว่าง
        ทำให้การ์ดดันจนเกิด horizontal scroll ทั้งหน้าบนจอมือถือ
      */}
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="min-w-0">
          <LinePreviewCard preview={data?.preview ?? null} deliveries={data?.deliveries ?? []} onRetried={refresh} />
        </div>
        <div className="min-w-0">
          <RecoveryList events={data?.recoveries ?? []} />
        </div>
      </div>
    </div>
  );
}
