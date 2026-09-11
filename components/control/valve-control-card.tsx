'use client';

import { useEffect, useState } from 'react';
import { Crown, DoorClosed, DoorOpen } from 'lucide-react';
import type { ControlInterlock, Valve, Zone } from '@/lib/types';
import { useCommandRunner } from '@/lib/hooks/use-command-runner';
import { useLocale } from '@/lib/i18n';
import { cn, formatFlow, formatPercent } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CommandStatus } from './command-status';
import { ConfirmDialog } from './confirm-dialog';
import { InterlockNotice } from './interlock-notice';

interface PendingAction {
  action: 'open' | 'close' | 'set_open_percent';
  value?: number;
  title: string;
  description: string;
  destructive: boolean;
}

export function ValveControlCard({
  valve,
  zone,
  interlock,
  userId,
  disabled,
}: {
  valve: Valve;
  zone: Zone | null;
  interlock: ControlInterlock | null;
  userId: string;
  disabled: boolean;
}): JSX.Element {
  const { t, locale } = useLocale();
  const runner = useCommandRunner();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [draftPercent, setDraftPercent] = useState(valve.openPercent);

  // ค่าจากอุปกรณ์เปลี่ยนได้ตลอด — sync เข้าตัวเลื่อนเมื่อผู้ใช้ไม่ได้กำลังลากอยู่
  useEffect(() => {
    setDraftPercent(valve.openPercent);
  }, [valve.openPercent]);

  const name = locale === 'th' ? valve.name : valve.nameEn;
  const zoneName = zone === null ? '' : locale === 'th' ? zone.name : zone.nameEn;
  const moving = valve.position === 'opening' || valve.position === 'closing';
  const isVip = zone?.isVip === true;
  const locked = disabled || (interlock?.blocked ?? false) || runner.pending;

  return (
    <Card className={cn(isVip && 'border-primary')}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{name}</p>
            <p className="truncate text-[11px] text-muted-foreground">{zoneName}</p>
          </div>
          {isVip && (
            <Badge variant="outline" className="h-5 shrink-0 gap-1 px-1.5 text-[10px]">
              <Crown className="h-3 w-3" aria-hidden />
              {t.zone.vip}
            </Badge>
          )}
        </div>

        {/* ภาพวาล์ว — แถบเติมตามเปอร์เซ็นต์การเปิดจริง และวิ่งเป็นลายทางขณะกำลังเคลื่อนที่ */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="tabular text-2xl font-semibold leading-none">
              {formatPercent(valve.openPercent, locale, 0)}
            </span>
            <span className={cn('text-xs font-medium', moving ? 'text-status-warning' : 'text-muted-foreground')}>
              {moving
                ? t.control.valveMoving
                : valve.position === 'open'
                  ? t.control.open
                  : valve.position === 'fault'
                    ? t.status.critical
                    : t.control.close}
            </span>
          </div>
          <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${formatPercent(valve.openPercent, locale, 0)}`}>
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-700',
                valve.position === 'fault' ? 'bg-status-critical' : 'bg-water',
                moving && 'animate-pulse bg-[repeating-linear-gradient(45deg,currentColor,currentColor_6px,transparent_6px,transparent_12px)] text-water',
              )}
              style={{ width: `${Math.max(2, valve.openPercent)}%` }}
            />
          </div>
          {zone !== null && (
            <p className="tabular mt-1 text-[11px] text-muted-foreground">{formatFlow(zone.flowLpm, locale, 1)}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant={valve.position === 'open' ? 'outline' : 'default'}
            disabled={locked || valve.position === 'open'}
            onClick={() => {
              setPendingAction({
                action: 'open',
                title: t.control.open,
                description: `${t.control.open} — ${name}`,
                destructive: false,
              });
            }}
            className="gap-1.5"
          >
            <DoorOpen className="h-3.5 w-3.5" aria-hidden />
            {t.control.open}
          </Button>
          <Button
            size="sm"
            variant={valve.position === 'closed' ? 'outline' : 'destructive'}
            disabled={locked || valve.position === 'closed'}
            onClick={() => {
              setPendingAction({
                action: 'close',
                title: t.control.close,
                description: `${t.control.close} — ${name}${isVip ? ` (${t.zone.vip})` : ''}`,
                destructive: true,
              });
            }}
            className="gap-1.5"
          >
            <DoorClosed className="h-3.5 w-3.5" aria-hidden />
            {t.control.close}
          </Button>
        </div>

        {/* ปรับเปอร์เซ็นต์การเปิด */}
        <div>
          <label className="flex items-baseline justify-between text-[11px] text-muted-foreground">
            {t.control.openPercent}
            <span className="tabular font-medium text-foreground">{draftPercent}%</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={draftPercent}
              disabled={locked}
              onChange={(event) => {
                setDraftPercent(Number(event.target.value));
              }}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-control-checked disabled:opacity-50"
              aria-label={t.control.openPercent}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={locked || draftPercent === valve.openPercent}
              onClick={() => {
                setPendingAction({
                  action: 'set_open_percent',
                  value: draftPercent,
                  title: `${t.control.openPercent} → ${draftPercent}%`,
                  description: `${name} — ${draftPercent}%`,
                  destructive: false,
                });
              }}
            >
              {t.control.apply}
            </Button>
          </div>
        </div>

        <InterlockNotice interlock={interlock} />
        <CommandStatus result={runner.result} />
      </CardContent>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        description={pendingAction?.description ?? ''}
        destructive={pendingAction?.destructive ?? false}
        // โซน VIP ห้ามตัดน้ำพลาด จึงบังคับยืนยันสองชั้นเฉพาะตอนสั่งปิด
        doubleConfirm={isVip && pendingAction?.action !== 'open'}
        askReason
        onCancel={() => {
          setPendingAction(null);
        }}
        onConfirm={(reason) => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === null) return;
          void runner.run({
            targetType: 'valve',
            targetId: valve.id,
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
