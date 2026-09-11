'use client';

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { MockScenario } from '@/lib/types';
import { SCENARIO_OPTIONS, setScenario } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * F — ตัวสลับสถานการณ์สาธิต
 * ★ มีเฉพาะตอนใช้ mock ตอนต่อ API จริงต้องลบทั้งก้อน — ของจริงไม่มีปุ่มสลับสถานการณ์
 */
export function ScenarioSwitcher({
  current,
  onChanged,
}: {
  current: MockScenario | null;
  onChanged: () => void;
}): JSX.Element {
  const { t, locale } = useLocale();
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FlaskConical className="h-3.5 w-3.5" aria-hidden />
        {t.ai.scenario}
      </span>
      <div className="inline-flex rounded-control border bg-background p-0.5" role="group" aria-label={t.ai.scenario}>
        {SCENARIO_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={busy}
            aria-pressed={current === option.value}
            onClick={() => {
              setBusy(true);
              void setScenario(option.value)
                .then(onChanged)
                .finally(() => {
                  setBusy(false);
                });
            }}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {locale === 'th' ? option.labelTh : option.labelEn}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-muted-foreground">{t.ai.scenarioHint}</span>
    </div>
  );
}
