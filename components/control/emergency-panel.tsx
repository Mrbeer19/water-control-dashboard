'use client';

import { useState } from 'react';
import { DoorClosed, DoorOpen, OctagonX, Unlock } from 'lucide-react';
import { useCommandRunner } from '@/lib/hooks/use-command-runner';
import { useLocale } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CommandStatus } from './command-status';
import { ConfirmDialog } from './confirm-dialog';

interface PendingAction {
  action: 'open_all' | 'close_all' | 'emergency_stop' | 'set_mode';
  title: string;
  description: string;
  destructive: boolean;
}

/** คำสั่งระดับระบบ — ทุกปุ่มต้องยืนยันสองชั้น เพราะกระทบทั้งโรงงานพร้อมกัน */
export function EmergencyPanel({
  userId,
  disabled,
  lockedOut,
  vipZoneName,
}: {
  userId: string;
  disabled: boolean;
  /** true = ระบบถูกล็อกอยู่หลังกดหยุดฉุกเฉิน */
  lockedOut: boolean;
  vipZoneName: string;
}): JSX.Element {
  const { t, locale } = useLocale();
  const runner = useCommandRunner();
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const includesVip =
    locale === 'th'
      ? `รวมโซน VIP (${vipZoneName}) ด้วย`
      : `This includes the VIP zone (${vipZoneName}).`;

  return (
    <Card className="border-status-critical/30">
      <CardContent className="space-y-3 p-4">
        {lockedOut && (
          <p className="rounded-md bg-status-critical/10 px-2.5 py-2 text-xs text-status-critical">
            {t.control.lockedNotice}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            disabled={disabled || runner.pending}
            className="gap-1.5"
            onClick={() => {
              setPendingAction({
                action: 'open_all',
                title: t.control.openAll,
                description: `${t.control.openAll} — 8 ${t.zone.zone}`,
                destructive: false,
              });
            }}
          >
            <DoorOpen className="h-4 w-4" aria-hidden />
            {t.control.openAll}
          </Button>

          <Button
            variant="outline"
            disabled={disabled || runner.pending}
            className="gap-1.5 border-status-warning/40 text-status-warning hover:bg-status-warning/10"
            onClick={() => {
              setPendingAction({
                action: 'close_all',
                title: t.control.closeAll,
                description: `${t.control.closeAll} — 8 ${t.zone.zone}. ${includesVip}`,
                destructive: true,
              });
            }}
          >
            <DoorClosed className="h-4 w-4" aria-hidden />
            {t.control.closeAll}
          </Button>
        </div>

        {lockedOut ? (
          <Button
            variant="outline"
            className="w-full gap-1.5"
            disabled={runner.pending}
            onClick={() => {
              setPendingAction({
                action: 'set_mode',
                title: t.control.clearLockout,
                description:
                  locale === 'th'
                    ? 'คืนปั๊มทุกตัวสู่โหมดอัตโนมัติและปลดล็อกการสั่งงาน'
                    : 'Return every pump to auto mode and release the control lockout',
                destructive: false,
              });
            }}
          >
            <Unlock className="h-4 w-4" aria-hidden />
            {t.control.clearLockout}
          </Button>
        ) : (
          <Button
            variant="destructive"
            className="h-12 w-full gap-2 text-base font-semibold"
            disabled={disabled || runner.pending}
            onClick={() => {
              setPendingAction({
                action: 'emergency_stop',
                title: t.control.emergencyStop,
                description:
                  locale === 'th'
                    ? 'หยุดปั๊มทุกตัวทันทีและล็อกการสั่งงานทั้งระบบ'
                    : 'Stop every pump immediately and lock out all control',
                destructive: true,
              });
            }}
          >
            <OctagonX className="h-5 w-5" aria-hidden />
            {t.control.emergencyStop}
          </Button>
        )}

        <CommandStatus result={runner.result} />
      </CardContent>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        description={pendingAction?.description ?? ''}
        destructive={pendingAction?.destructive ?? false}
        doubleConfirm
        askReason
        onCancel={() => {
          setPendingAction(null);
        }}
        onConfirm={(reason) => {
          const action = pendingAction;
          setPendingAction(null);
          if (action === null) return;
          void runner.run({
            targetType: 'system',
            targetId: 'system',
            action: action.action,
            value: action.action === 'set_mode' ? 'auto' : null,
            issuedByUserId: userId,
            reason,
          });
        }}
      />
    </Card>
  );
}
