'use client';

import type { AlertSeverity, NotificationChannel } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { NumberField, SelectField, ToggleField, type SettingsSectionProps } from './field';

const CHANNELS: NotificationChannel[] = ['line', 'email', 'sms', 'buzzer', 'webhook'];

/** 3.6 — เกณฑ์การแจ้งเตือนและช่วงเวลาเงียบ */
export function AlertsSection({ draft, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const notifications = draft.notifications;

  const set = (patch: Partial<typeof notifications>): void => {
    onChange({ notifications: { ...notifications, ...patch } });
  };

  const severityOptions = [
    { value: 'critical' as AlertSeverity, label: t.status.critical },
    { value: 'warning' as AlertSeverity, label: t.status.warning },
    { value: 'info' as AlertSeverity, label: 'INFO' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SelectField<AlertSeverity>
          label={t.settings.minSeverity}
          value={notifications.minimumSeverity}
          options={severityOptions}
          onChange={(value) => { set({ minimumSeverity: value }); }}
        />
        <NumberField
          label={t.settings.escalation}
          value={notifications.escalationAfterMinutes}
          min={0}
          unit={t.settings.minutes}
          onChange={(value) => { set({ escalationAfterMinutes: value }); }}
        />
        <NumberField
          label={t.settings.dedup}
          value={notifications.deduplicationWindowMinutes}
          min={0}
          unit={t.settings.minutes}
          onChange={(value) => { set({ deduplicationWindowMinutes: value }); }}
        />
      </div>

      <div className="rounded-section border p-4">
        <p className="mb-2 text-sm font-semibold">{t.settings.quietHours}</p>
        <ToggleField
          label={t.settings.quietHours}
          checked={notifications.quietHours.enabled}
          onChange={(checked) => { set({ quietHours: { ...notifications.quietHours, enabled: checked } }); }}
        />
        {notifications.quietHours.enabled && (
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="block text-xs font-medium">{t.settings.quietFrom}</span>
              <input
                type="time"
                value={notifications.quietHours.startTime}
                onChange={(event) => { set({ quietHours: { ...notifications.quietHours, startTime: event.target.value } }); }}
                className="h-9 w-full rounded-control border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium">{t.settings.quietTo}</span>
              <input
                type="time"
                value={notifications.quietHours.endTime}
                onChange={(event) => { set({ quietHours: { ...notifications.quietHours, endTime: event.target.value } }); }}
                className="h-9 w-full rounded-control border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <SelectField<AlertSeverity>
              label={t.settings.quietOverride}
              value={notifications.quietHours.overrideSeverity}
              options={severityOptions}
              onChange={(value) => { set({ quietHours: { ...notifications.quietHours, overrideSeverity: value } }); }}
            />
          </div>
        )}
      </div>

      <div className="rounded-section border p-4">
        <p className="mb-1 text-sm font-semibold">{t.alerts.delivery}</p>
        {CHANNELS.map((channel) => (
          <ToggleField
            key={channel}
            label={channel.toUpperCase()}
            hint={notifications.recipients[channel].join(', ') || '—'}
            checked={notifications.enabledChannels.includes(channel)}
            onChange={(checked) => {
              set({
                enabledChannels: checked
                  ? [...notifications.enabledChannels, channel]
                  : notifications.enabledChannels.filter((item) => item !== channel),
              });
            }}
          />
        ))}
      </div>

      <div className="rounded-section border p-4">
        <ToggleField
          label={t.alerts.acknowledgedBy}
          hint={draft.notifications.notifyDepartmentManager ? 'ส่งให้หัวหน้าแผนกที่รับผิดชอบด้วย' : 'ส่งเฉพาะช่องทางกลาง'}
          checked={notifications.notifyDepartmentManager}
          onChange={(checked) => { set({ notifyDepartmentManager: checked }); }}
        />
      </div>
    </div>
  );
}
