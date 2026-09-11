'use client';

import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { SettingsFieldError } from '@/lib/types';
import { exportSettings, importSettings } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** 3.10 — ส่งออก/นำเข้าค่าตั้งค่าเป็น JSON */
export function BackupSection({ userId, onImported }: { userId: string; onImported: () => void }): JSX.Element {
  const { t, locale } = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<SettingsFieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleExport = async (): Promise<void> => {
    const json = await exportSettings();
    setPreview(json);
    setMessage(null);
    setErrors([]);

    // ดาวน์โหลดจาก blob ในเครื่อง ไม่มีการส่งไฟล์ออกไปไหน
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `water-settings-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File): Promise<void> => {
    const text = await file.text();
    const result = await importSettings(text, userId);
    setErrors(result.errors);
    setMessage(result.ok ? t.settings.importSuccess : null);
    if (result.ok) onImported();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void handleExport()}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t.settings.exportJson}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { fileRef.current?.click(); }}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          {t.settings.importJson}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void handleImport(file);
            event.target.value = '';
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground">{t.settings.importHint}</p>

      {message !== null && <p className="text-xs text-status-ok">{message}</p>}
      {errors.map((error) => (
        <p key={error.path} className={cn('text-xs text-form-error')}>
          {locale === 'th' ? error.messageTh : error.messageEn}
        </p>
      ))}

      {preview !== null && (
        <pre className="max-h-72 overflow-auto rounded-card border bg-secondary p-3 text-[11px] leading-relaxed">
          {preview}
        </pre>
      )}
    </div>
  );
}
