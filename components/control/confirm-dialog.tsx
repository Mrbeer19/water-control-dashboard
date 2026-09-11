'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** รายละเอียดว่าคำสั่งนี้จะทำอะไรกับอะไร */
  description: string;
  /** true = ต้องกดยืนยันสองชั้น (โซน VIP หรือคำสั่งระดับระบบ) */
  doubleConfirm?: boolean;
  /** true = แสดงเป็นโทนอันตราย */
  destructive?: boolean;
  /** เปิดช่องกรอกเหตุผลลง audit log */
  askReason?: boolean;
  onConfirm: (reason: string | null) => void;
  onCancel: () => void;
}

/**
 * กล่องยืนยันคำสั่ง
 *
 * ใช้ <dialog> ของเบราว์เซอร์แทนการประกอบเอง เพราะได้ focus trap, ปุ่ม Esc
 * และ backdrop มาให้ครบโดยไม่ต้องเพิ่ม dependency
 */
export function ConfirmDialog({
  open,
  title,
  description,
  doubleConfirm = false,
  destructive = false,
  askReason = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<1 | 2>(1);
  const [reason, setReason] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setStage(1);
      setReason('');
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // ปิดด้วย Esc ต้องแจ้งกลับให้ state ข้างนอกตรงกัน ไม่งั้นเปิดซ้ำไม่ได้
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const handleClose = (): void => {
      onCancel();
    };
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [onCancel]);

  const secondStage = doubleConfirm && stage === 2;

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        'w-[min(30rem,calc(100vw-2rem))] rounded-overlay border bg-card p-0 text-card-foreground shadow-xl',
        'backdrop:bg-black/50 backdrop:backdrop-blur-[1px]',
      )}
      aria-labelledby="confirm-title"
    >
      <div className="p-5">
        <div className="flex gap-3">
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              destructive ? 'bg-status-critical text-status-critical-foreground' : 'border text-info',
            )}
          >
            {secondStage ? <ShieldAlert className="h-4.5 w-4.5" aria-hidden /> : <AlertTriangle className="h-4.5 w-4.5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-semibold leading-tight">
              {secondStage ? t.control.confirmSecond : title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {secondStage ? t.control.confirmSecondHint : description}
            </p>
          </div>
        </div>

        {askReason && !secondStage && (
          <label className="mt-4 block">
            <span className="text-xs font-medium text-muted-foreground">{t.control.reasonLabel}</span>
            <input
              type="text"
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              placeholder={t.control.reasonPlaceholder}
              className="mt-1 h-9 w-full rounded-control border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t.control.cancel}
          </Button>
          <Button
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              if (doubleConfirm && stage === 1) {
                setStage(2);
                return;
              }
              onConfirm(reason.trim() === '' ? null : reason.trim());
            }}
          >
            {doubleConfirm && stage === 1 ? t.control.confirm : secondStage ? t.control.confirmSecond : t.control.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
