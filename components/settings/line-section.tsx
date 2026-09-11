'use client';

import { useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import type { AlertSeverity, LineGroup, NotificationDelivery, NotificationTestResult } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getNotificationDeliveries, sendTestNotification } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NumberField, TextField, ToggleField, findError, type SettingsSectionProps } from './field';

const SEVERITIES: AlertSeverity[] = ['critical', 'warning', 'info'];

/** 3.12 — การแจ้งเตือนทาง LINE */
export function LineSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t, locale } = useLocale();
  const [testResult, setTestResult] = useState<NotificationTestResult | null>(null);
  const line = draft.line;

  const { data: deliveries, loading } = useLiveData<NotificationDelivery[]>(() => getNotificationDeliveries(), []);

  if (line === undefined) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t.common.empty}</p>;
  }

  const set = (patch: Partial<typeof line>): void => {
    onChange({ line: { ...line, ...patch } });
  };

  const setGroup = (id: string, patch: Partial<LineGroup>): void => {
    set({ groups: line.groups.map((group) => (group.id === id ? { ...group, ...patch } : group)) });
  };

  const addGroup = (): void => {
    set({
      groups: [
        ...line.groups,
        { id: `line-group-${Date.now()}`, name: '', groupId: '', active: true },
      ],
    });
  };

  const removeGroup = (id: string): void => {
    // ต้องล้าง routing ที่ชี้มาที่กลุ่มนี้ด้วย ไม่งั้นจะเหลือการส่งไปยังกลุ่มที่ไม่มีอยู่
    const routing = { ...line.severityRouting };
    for (const severity of SEVERITIES) {
      routing[severity] = routing[severity].filter((groupId) => groupId !== id);
    }
    set({ groups: line.groups.filter((group) => group.id !== id), severityRouting: routing });
  };

  const toggleRoute = (severity: AlertSeverity, groupId: string): void => {
    const current = line.severityRouting[severity];
    set({
      severityRouting: {
        ...line.severityRouting,
        [severity]: current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId],
      },
    });
  };

  const lineDeliveries = (deliveries ?? []).filter((delivery) => delivery.channel === 'line').slice(0, 50);
  const queued = (deliveries ?? []).filter((d) => d.deliveryState === 'queued' || d.deliveryState === 'sending').length;

  return (
    <div className="space-y-5">
      <div className="rounded-card border p-4">
        <ToggleField
          label={t.settings.lineEnabled}
          checked={line.enabled}
          onChange={(checked) => { set({ enabled: checked }); }}
        />
        <div className="mt-2 max-w-md">
          <TextField
            label={t.settings.accessToken}
            value={line.channelAccessTokenMasked}
            hint={t.settings.accessTokenHint}
            onChange={(value) => { set({ channelAccessTokenMasked: value }); }}
          />
        </div>
      </div>

      {/* กลุ่มปลายทาง */}
      <div className="rounded-card border p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{t.settings.lineGroups}</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t.settings.addGroup}
          </Button>
        </div>
        {findError(errors, 'line.groups') !== undefined && (
          <p className="mb-2 text-[11px] text-form-error">{findError(errors, 'line.groups')?.messageTh}</p>
        )}

        <div className="space-y-2">
          {line.groups.map((group) => (
            <div key={group.id} className="grid items-start gap-2 rounded-control border p-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2 sm:grid-cols-3">
                <TextField label={t.settings.groupName} value={group.name} onChange={(value) => { setGroup(group.id, { name: value }); }} />
                <TextField
                  label={t.settings.groupIdField}
                  value={group.groupId}
                  placeholder="C…"
                  error={findError(errors, `line.groups.${group.id}.groupId`)}
                  onChange={(value) => { setGroup(group.id, { groupId: value }); }}
                />
                <div className="flex items-end">
                  <ToggleField
                    label={t.settings.active}
                    checked={group.active}
                    onChange={(checked) => { setGroup(group.id, { active: checked }); }}
                  />
                </div>
              </div>
              <div className="mt-5 flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t.settings.sendTest}
                  onClick={() => { void sendTestNotification(group.id).then(setTestResult); }}
                >
                  <Send className="h-3.5 w-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t.settings.removeTier}
                  className="text-muted-foreground hover:text-status-critical"
                  onClick={() => { removeGroup(group.id); }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {testResult !== null && (
          <p className={cn('mt-2 text-xs', testResult.ok ? 'text-status-ok' : 'text-status-critical')}>
            {testResult.message} — {testResult.recipient}
          </p>
        )}
      </div>

      {/* ระดับไหนเข้ากลุ่มไหน */}
      <div className="overflow-x-auto rounded-card border p-4">
        <p className="mb-2 text-sm font-semibold">{t.settings.routing}</p>
        {findError(errors, 'line.severityRouting.critical') !== undefined && (
          <p className="mb-2 text-[11px] text-form-error">{findError(errors, 'line.severityRouting.critical')?.messageTh}</p>
        )}
        <table className="w-full min-w-[420px] text-xs">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th scope="col" className="py-2 pr-3 text-left font-medium">{t.alerts.severity}</th>
              {line.groups.map((group) => (
                <th key={group.id} scope="col" className="px-2 py-2 text-center font-medium">{group.name || group.id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SEVERITIES.map((severity) => (
              <tr key={severity} className="border-b last:border-0">
                <td className="py-2 pr-3">{severity === 'info' ? 'INFO' : t.status[severity]}</td>
                {line.groups.map((group) => (
                  <td key={group.id} className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={line.severityRouting[severity].includes(group.id)}
                      aria-label={`${severity} → ${group.name}`}
                      onChange={() => { toggleRoute(severity, group.id); }}
                      className="h-4 w-4 accent-control-checked"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label={t.settings.debounce}
          value={line.debounceSeconds}
          min={0}
          unit={t.settings.seconds}
          error={findError(errors, 'line.debounceSeconds')}
          onChange={(value) => { set({ debounceSeconds: value }); }}
        />
        <NumberField
          label={t.settings.escalation}
          value={line.escalationTimeoutMinutes}
          min={0}
          unit={t.settings.minutes}
          onChange={(value) => { set({ escalationTimeoutMinutes: value }); }}
        />
      </div>

      {/* เปิด/ปิดรายประเภทเหตุการณ์ */}
      <div className="rounded-card border p-4">
        <p className="mb-1 text-sm font-semibold">{t.settings.byCode}</p>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {Object.entries(line.enabledCodes).map(([code, enabled]) => (
            <ToggleField
              key={code}
              label={code}
              checked={enabled}
              onChange={(checked) => { set({ enabledCodes: { ...line.enabledCodes, [code]: checked } }); }}
            />
          ))}
        </div>
      </div>

      {/* ประวัติการส่ง */}
      <div className="rounded-card border p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t.settings.deliveryHistory}</p>
          <p className="tabular text-xs text-muted-foreground">
            {t.settings.queued}: {queued}
          </p>
        </div>
        {loading && deliveries === null ? (
          <Skeleton className="h-32 rounded-control" />
        ) : lineDeliveries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t.common.empty}</p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <ul className="divide-y text-xs">
              {lineDeliveries.map((delivery) => (
                <li key={delivery.id} className="flex items-center gap-2 py-1.5">
                  <span className={cn('shrink-0', delivery.deliveryState === 'delivered' ? 'text-status-ok' : 'text-status-critical')}>
                    ●
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{delivery.recipient}</span>
                  <span className="tabular shrink-0 text-muted-foreground">×{delivery.attempts}</span>
                  {delivery.lastAttemptAt !== null && (
                    <span className="shrink-0 text-muted-foreground">{formatRelativeTime(delivery.lastAttemptAt, locale)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
