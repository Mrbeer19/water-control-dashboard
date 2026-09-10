'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useTheme } from './theme-provider';

const OPTIONS: { mode: ThemeMode; icon: typeof Sun; labelTh: string; labelEn: string }[] = [
  { mode: 'light', icon: Sun, labelTh: 'สว่าง', labelEn: 'Light' },
  { mode: 'dark', icon: Moon, labelTh: 'มืด', labelEn: 'Dark' },
  { mode: 'system', icon: Monitor, labelTh: 'ตามระบบ', labelEn: 'System' },
];

export function ThemeToggle(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const { locale, t } = useLocale();

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border bg-muted/40 p-0.5"
      role="group"
      aria-label={t.header.themeToggle}
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = theme === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => {
              setTheme(option.mode);
            }}
            aria-pressed={active}
            title={locale === 'th' ? option.labelTh : option.labelEn}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{locale === 'th' ? option.labelTh : option.labelEn}</span>
          </button>
        );
      })}
    </div>
  );
}
