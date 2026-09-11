'use client';

import { useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import type { CommandAction, CommandSchedule, CommandTargetType, ScheduleRepeat, Valve, Pump } from '@/lib/types';
import { createSchedule, deleteSchedule, setScheduleEnabled } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatDateTimeTH } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const SELECT_CLASS =
  'h-9 rounded-control border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * ตั้งเวลาสั่งงานล่วงหน้า
 * ★ ตารางเดินที่หลังบ้าน (cron บน gateway) ไม่ใช่ที่หน้าจอนี้
 *   จอในห้องคอนโทรลถูกปิดหรือรีเฟรชเมื่อไรก็ได้ ถ้าผูกไว้กับหน้าจอ ตารางจะไม่ทำงาน
 */
export function SchedulePanel({
  schedules,
  loading,
  pumps,
  valves,
  userId,
  disabled,
  onChanged,
}: {
  schedules: CommandSchedule[] | null;
  loading: boolean;
  pumps: Pump[];
  valves: Valve[];
  userId: string;
  disabled: boolean;
  onChanged: () => void;
}): JSX.Element {
  const { t, locale } = useLocale();
  const [adding, setAdding] = useState(false);
  const [targetId, setTargetId] = useState(valves[0]?.id ?? '');
  const [action, setAction] = useState<CommandAction>('close');
  const [time, setTime] = useState('22:00');
  const [repeat, setRepeat] = useState<ScheduleRepeat>('daily');
  const [saving, setSaving] = useState(false);

  const repeatLabel: Record<ScheduleRepeat, string> = {
    once: t.control.repeatOnce,
    daily: t.control.repeatDaily,
    weekdays: t.control.repeatWeekdays,
    weekly: t.control.repeatWeekly,
  };

  const targetType: CommandTargetType = pumps.some((pump) => pump.id === targetId) ? 'pump' : 'valve';
  const actionOptions: CommandAction[] = targetType === 'pump' ? ['start', 'stop'] : ['open', 'close'];

  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      await createSchedule({ targetType, targetId, action, time, repeat, createdByUserId: userId });
      setAdding(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t.control.schedule}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={disabled}
            onClick={() => {
              setAdding((current) => !current);
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t.control.addSchedule}
          </Button>
        </div>

        {adding && (
          <div className="grid gap-2 rounded-control border bg-secondary p-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1 lg:col-span-2">
              <span className="text-[11px] text-muted-foreground">{t.control.target}</span>
              <select
                className={SELECT_CLASS}
                value={targetId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  setTargetId(nextId);
                  // ปั๊มกับวาล์วรับคำสั่งคนละชุด — รีเซ็ตให้ตรงกับปลายทางใหม่
                  setAction(pumps.some((pump) => pump.id === nextId) ? 'start' : 'open');
                }}
              >
                <optgroup label={t.control.valves}>
                  {valves.map((valve) => (
                    <option key={valve.id} value={valve.id}>
                      {locale === 'th' ? valve.name : valve.nameEn}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t.control.pumps}>
                  {pumps.map((pump) => (
                    <option key={pump.id} value={pump.id}>
                      {locale === 'th' ? pump.name : pump.nameEn}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{t.control.action}</span>
              <select
                className={SELECT_CLASS}
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as CommandAction);
                }}
              >
                {actionOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{t.control.time}</span>
              <input
                type="time"
                className={SELECT_CLASS}
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{t.control.repeat}</span>
              <select
                className={SELECT_CLASS}
                value={repeat}
                onChange={(event) => {
                  setRepeat(event.target.value as ScheduleRepeat);
                }}
              >
                {(['daily', 'weekdays', 'weekly', 'once'] as ScheduleRepeat[]).map((option) => (
                  <option key={option} value={option}>
                    {repeatLabel[option]}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
              <Button size="sm" disabled={saving} onClick={() => void submit()}>
                {t.control.addSchedule}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(false);
                }}
              >
                {t.control.cancel}
              </Button>
            </div>
          </div>
        )}

        {loading && schedules === null ? (
          <Skeleton className="h-24 rounded-control" />
        ) : schedules === null || schedules.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t.control.noSchedules}</p>
        ) : (
          <ul className="divide-y">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="flex items-center gap-3 py-2.5">
                <span className="tabular w-12 shrink-0 text-sm font-semibold">{schedule.time}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {schedule.targetName} · <code className="text-xs">{schedule.action}</code>
                    {schedule.value !== null && <span className="tabular text-xs"> {String(schedule.value)}</span>}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {repeatLabel[schedule.repeat]}
                    {schedule.nextRunAt !== null && ` · ${t.control.nextRun} ${formatDateTimeTH(schedule.nextRunAt, locale)}`}
                    {` · ${schedule.createdBy.displayName}`}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={schedule.enabled}
                  aria-label={schedule.enabled ? t.control.enabled : t.control.disabled}
                  disabled={disabled}
                  onClick={() => {
                    void setScheduleEnabled(schedule.id, !schedule.enabled).then(onChanged);
                  }}
                  className={cn(
                    'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    schedule.enabled ? 'bg-control-checked' : 'bg-muted',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-background transition-[left]',
                      schedule.enabled ? 'left-[1.125rem]' : 'left-0.5',
                    )}
                  />
                </button>

                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t.control.delete}
                  onClick={() => {
                    void deleteSchedule(schedule.id).then(onChanged);
                  }}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:text-status-critical disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
