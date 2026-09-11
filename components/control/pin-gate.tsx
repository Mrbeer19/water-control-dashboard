'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, Lock, LockOpen } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * ด่าน PIN ก่อนสั่งงาน — ★ เป็น UI อย่างเดียว ไม่ใช่ระบบยืนยันตัวตนจริง
 *
 * ของจริงต้องให้หลังบ้านตรวจ PIN และผูกกับ session ที่หมดอายุได้
 * ที่นี่แค่รับตัวเลข 4 หลักแล้วปลดล็อกในหน่วยความจำของหน้าจอเท่านั้น
 * ห้ามเอาไปใช้เป็นการควบคุมสิทธิ์จริง
 */
export function PinGate({
  unlocked,
  onUnlock,
  onLock,
}: {
  unlocked: boolean;
  onUnlock: () => void;
  onLock: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !dialog.open) return;
    if (unlocked) dialog.close();
  }, [unlocked]);

  const openDialog = (): void => {
    setPin('');
    setError(false);
    dialogRef.current?.showModal();
  };

  const submit = (): void => {
    if (!/^\d{4}$/.test(pin)) {
      setError(true);
      return;
    }
    onUnlock();
    dialogRef.current?.close();
  };

  return (
    <>
      {unlocked ? (
        <Button variant="outline" size="sm" onClick={onLock} className="gap-1.5">
          <LockOpen className="h-3.5 w-3.5 text-status-ok" aria-hidden />
          {t.control.lock}
        </Button>
      ) : (
        <Button size="sm" onClick={openDialog} className="gap-1.5">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          {t.control.unlock}
        </Button>
      )}

      <dialog
        ref={dialogRef}
        className="w-[min(22rem,calc(100vw-2rem))] rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50"
        aria-labelledby="pin-title"
      >
        <form
          method="dialog"
          className="p-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-info/10 text-info">
              <KeyRound className="h-4 w-4" aria-hidden />
            </span>
            <h2 id="pin-title" className="font-semibold">
              {t.control.pinTitle}
            </h2>
          </div>

          <label className="mt-4 block">
            <span className="text-xs text-muted-foreground">{t.control.pinHint}</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(event) => {
                setPin(event.target.value.replace(/\D/g, ''));
                setError(false);
              }}
              className={cn(
                'tabular mt-1 h-11 w-full rounded-md border bg-background px-3 text-center text-xl tracking-[0.5em]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                error && 'border-status-critical',
              )}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </label>
          {error && <p className="mt-1.5 text-xs text-status-critical">{t.control.pinError}</p>}

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                dialogRef.current?.close();
              }}
            >
              {t.control.cancel}
            </Button>
            <Button type="submit" size="sm">
              {t.control.unlock}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
