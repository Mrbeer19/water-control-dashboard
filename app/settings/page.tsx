'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save, TriangleAlert } from 'lucide-react';
import type { SettingsFieldError, SystemSettings } from '@/lib/types';
import {
  getCurrentUser,
  getSettings,
  resetSettings,
  updateSettingsSection,
  validateSettings,
} from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatDateTimeTH } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GeneralSection } from '@/components/settings/general-section';
import { TanksSection } from '@/components/settings/tanks-section';
import { PumpsSection } from '@/components/settings/pumps-section';
import { ZonesSection } from '@/components/settings/zones-section';
import { BillingSection } from '@/components/settings/billing-section';
import { AlertsSection } from '@/components/settings/alerts-section';
import { AiSection } from '@/components/settings/ai-section';
import { NetworkSection } from '@/components/settings/network-section';
import { UsersSection } from '@/components/settings/users-section';
import { EnvironmentSection } from '@/components/settings/environment-section';
import { LineSection } from '@/components/settings/line-section';
import { BackupSection } from '@/components/settings/backup-section';

type TabId =
  | 'general' | 'tanks' | 'pumps' | 'zones' | 'billing' | 'alerts'
  | 'ai' | 'network' | 'users' | 'environment' | 'line' | 'backup';

/**
 * Phase 5 — หน้าตั้งค่า
 *
 * ★ แก้ทุกอย่างบน draft ก้อนเดียวแล้วบันทึกทีเดียว ไม่บันทึกอัตโนมัติรายฟิลด์
 *   เพราะค่าหลายตัวสัมพันธ์กัน (เช่น ระดับเริ่ม/หยุดปั๊ม) การบันทึกทีละตัว
 *   จะทำให้ระบบผ่านสถานะที่ไม่ถูกต้องระหว่างทาง
 */
export default function SettingsPage(): JSX.Element {
  const { t } = useLocale();
  const [tab, setTab] = useState<TabId>('general');
  const [draft, setDraft] = useState<SystemSettings | null>(null);
  const [saved, setSaved] = useState<SystemSettings | null>(null);
  const [userId, setUserId] = useState('user-admin');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [settings, user] = await Promise.all([getSettings(), getCurrentUser()]);
    setDraft(settings);
    setSaved(settings);
    setUserId(user?.id ?? 'user-admin');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const errors: SettingsFieldError[] = useMemo(
    () => (draft === null ? [] : validateSettings(draft)),
    [draft],
  );

  const dirty = useMemo(
    () => draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );

  const applyPatch = useCallback((patch: Partial<SystemSettings>) => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const handleSave = useCallback(async () => {
    if (draft === null || errors.length > 0) return;
    // บันทึกทีละหมวดตามรูปแบบ endpoint ที่หลังบ้านจะทำ ไม่ยัดทั้งก้อนไปครั้งเดียว
    const sections = [
      'general', 'thresholds', 'network', 'notifications', 'billing',
      'ai', 'maintenance', 'security', 'tanks', 'pumps', 'zones', 'environment', 'line',
    ] as const;
    let latest = draft;
    for (const section of sections) {
      const value = draft[section];
      if (value === undefined) continue;
      latest = await updateSettingsSection(section, value as never, userId);
    }
    setDraft(latest);
    setSaved(latest);
    setSavedAt(new Date().toISOString());
  }, [draft, errors.length, userId]);

  const handleReset = useCallback(async () => {
    const next = await resetSettings(userId);
    setDraft(next);
    setSaved(next);
    setSavedAt(new Date().toISOString());
  }, [userId]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: t.settings.tabGeneral },
    { id: 'tanks', label: t.settings.tabTanks },
    { id: 'pumps', label: t.settings.tabPumps },
    { id: 'zones', label: t.settings.tabZones },
    { id: 'billing', label: t.settings.tabBilling },
    { id: 'alerts', label: t.settings.tabAlerts },
    { id: 'ai', label: t.settings.tabAi },
    { id: 'environment', label: t.settings.tabEnvironment },
    { id: 'line', label: t.settings.tabLine },
    { id: 'network', label: t.settings.tabNetwork },
    { id: 'users', label: t.settings.tabUsers },
    { id: 'backup', label: t.settings.tabBackup },
  ];

  if (draft === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  const sectionProps = { draft, errors, onChange: applyPatch };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.nav.settings}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t.settings.updatedBy} {draft.updatedBy.displayName}
            {savedAt !== null && ` · ${t.settings.saved} ${formatDateTimeTH(savedAt, 'th')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-status-warning">{t.settings.unsaved}</span>}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void handleReset()}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t.settings.reset}
          </Button>
          <Button size="sm" className="gap-1.5" disabled={!dirty || errors.length > 0} onClick={() => void handleSave()}>
            <Save className="h-3.5 w-3.5" aria-hidden />
            {t.settings.save}
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <p className="flex items-center gap-1.5 rounded-control bg-status-critical px-2.5 py-2 text-xs text-status-critical">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t.settings.fixErrors} ({errors.length})
        </p>
      )}

      {/* แท็บ — เลื่อนแนวนอนได้บนจอแคบ ไม่ยุบเป็นเมนูซ่อน เพราะช่างต้องเห็นว่ามีหมวดอะไรบ้าง */}
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full gap-1 rounded-control border bg-secondary p-1" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => { setTab(item.id); }}
              className={cn(
                'whitespace-nowrap rounded-control px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === item.id ? 'bg-card text-foreground ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-4" role="tabpanel">
          {tab === 'general' && <GeneralSection {...sectionProps} />}
          {tab === 'tanks' && <TanksSection {...sectionProps} />}
          {tab === 'pumps' && <PumpsSection {...sectionProps} />}
          {tab === 'zones' && <ZonesSection {...sectionProps} />}
          {tab === 'billing' && <BillingSection {...sectionProps} />}
          {tab === 'alerts' && <AlertsSection {...sectionProps} />}
          {tab === 'ai' && <AiSection {...sectionProps} />}
          {tab === 'environment' && <EnvironmentSection {...sectionProps} />}
          {tab === 'line' && <LineSection {...sectionProps} />}
          {tab === 'network' && <NetworkSection {...sectionProps} />}
          {tab === 'users' && <UsersSection {...sectionProps} />}
          {tab === 'backup' && <BackupSection userId={userId} onImported={() => void load()} />}
        </CardContent>
      </Card>
    </div>
  );
}
