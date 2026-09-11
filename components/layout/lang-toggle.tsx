'use client';

import { Languages } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** สลับ ไทย ⇄ EN — ใช้ dictionary object ไม่มี i18n library */
export function LangToggle(): JSX.Element {
  const { locale, toggleLocale, t } = useLocale();

  return (
    <button
      type="button"
      onClick={toggleLocale}
      title={t.header.langToggle}
      aria-label={t.header.langToggle}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full border bg-secondary px-2.5 text-xs font-semibold',
        'text-muted-foreground transition-colors hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <Languages className="h-3.5 w-3.5" aria-hidden />
      <span className={cn(locale === 'th' && 'text-foreground')}>ไทย</span>
      <span aria-hidden className="text-border">|</span>
      <span className={cn(locale === 'en' && 'text-foreground')}>EN</span>
    </button>
  );
}
