'use client';

import { useState } from 'react';
import { Play, RotateCcw, Square } from 'lucide-react';
import type { ControlInterlock, Pump, PumpControlMode } from '@/lib/types';
import { useCommandRunner } from '@/lib/hooks/use-command-runner';
import { useLocale } from '@/lib/i18n';
import { cn, formatCurrent, formatFlow, formatPower } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { CommandStatus } from './command-status';
import { ConfirmDialog } from './confirm-dialog';
import { InterlockNotice } from './interlock-notice';

const MODE_ORDER: PumpControlMode[] = ['auto', 'manual', 'pid'];

interface PendingAction {
  action: 'start' | 'stop' | 'reset_fault' | 'set_mode';
  value?: string;
  title: string;
  description: string;
  destructive: boolean;
}

export function PumpControlCard({
  pump,
  interlock,
  userId,
  disabled,
}: {
  pump: Pump;
  interlock: ControlInterlock | null;
  userId: string;
  /** ล็อกจากด่าน PIN หรือ lockout ระดับระบบ */
  disabled: boolean;
}): JSX.Element {
  const { t, locale } = useLocale();
  const runner = useCommandRunner();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const name = locale === 'th' ? pump.name : pump.nameEn;
  const blocked = (action: string): boolean => interlock?.blockedActions.includes(action as never) ?? false;
  const running = pump.runState === 'running';

  const modeLabel: Record<PumpControlMode, string> = {
    auto: t.control.modeAuto,
    manual: t.control.modeManual,
    pid: t.control.modePid,
    locked_out: t.pump.offline,
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{name}</p>
            <p className="tabular text-xs text-muted-foreground">
              {formatPower(pump.electrical.powerWatt, locale)} · {formatCurrent(pump.electrical.current, locale)} ·{' '}
              {formatFlow(pump.flowLpm, locale, 0)}
            </p>
          </div>
          <StatusBadge
            status={pump.runState === 'fault' ? 'critical' : running ? 'ok' : 'offline'}
            label={pump.runState === 'fault' ? t.pump.fault : running ? t.pump.run : t.pump.stop}
          />
        </div>

        {/* เดิน/หยุด */}
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={running ? 'outline' : 'default'}
            disabled={disabled || running || blocked('start') || runner.pending}
            onClick={() => {
              setPendingAction({
                action: 'start',
                title: t.control.start,
                description: `${t.control.start} — ${name}`,
                destructive: false,
              });
            }}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {t.control.start}
          </Button>
          <Button
            size="sm"
            variant={running ? 'destructive' : 'outline'}
            disabled={disabled || !running || blocked('stop') || runner.pending}
            onClick={() => {
              setPendingAction({
                action: 'stop',
                title: t.control.stop,
                description: `${t.control.stop} — ${name}`,
                destructive: true,
              });
            }}
            className="gap-1.5"
          >
            <Square className="h-3.5 w-3.5" aria-hidden />
            {t.control.stop}
          </Button>
        </div>

        {/* โหมดควบคุม */}
        <div>
          <p className="mb-1 text-[11px] text-muted-foreground">{t.pump.mode}</p>
          <div className="inline-flex w-full rounded-control border bg-secondary p-0.5" role="group">
            {MODE_ORDER.filter((mode) => mode !== 'pid' || pump.hasVfd).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={pump.controlMode === mode}
                disabled={disabled || runner.pending}
                onClick={() => {
                  setPendingAction({
                    action: 'set_mode',
                    value: mode,
                    title: `${t.pump.mode} → ${modeLabel[mode]}`,
                    description: `${name} — ${modeLabel[mode]}`,
                    destructive: false,
                  });
                }}
                className={cn(
                  'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  pump.controlMode === mode
                    ? 'bg-card text-foreground ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {modeLabel[mode]}
              </button>
            ))}
          </div>
        </div>

        {pump.runState === 'fault' && (
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5"
            disabled={disabled || runner.pending}
            onClick={() => {
              setPendingAction({
                action: 'reset_fault',
                title: t.control.resetFault,
                description: `${name} — ${pump.faultCode ?? ''}`,
                destructive: false,
              });
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t.control.resetFault}
          </Button>
        )}

        <InterlockNotice interlock={interlock} />
        <CommandStatus result={runner.result} />
      </CardContent>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        description={pendingAction?.description ?? ''}
        destructive={pendingAction?.destructive ?? false}
        askReason
        onCancel={() => {
          setPendingAction(null);
        }}
        onConfirm={(reason) => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === null) return;
          void runner.run({
            targetType: 'pump',
            targetId: pump.id,
            action: action.action,
            value: action.value ?? null,
            issuedByUserId: userId,
            reason,
          });
        }}
      />
    </Card>
  );
}
