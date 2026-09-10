'use client';

import { Construction } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';

interface PagePlaceholderProps {
  titleTh: string;
  titleEn: string;
  descriptionTh: string;
  descriptionEn: string;
  /** สิ่งที่หน้านี้จะมีในเฟสถัดไป */
  plannedTh: string[];
  plannedEn: string[];
}

/** หน้าโครงชั่วคราวสำหรับ Phase 0 — เนื้อหาจริงจะถูกสร้างในเฟสถัดไป */
export function PagePlaceholder({
  titleTh,
  titleEn,
  descriptionTh,
  descriptionEn,
  plannedTh,
  plannedEn,
}: PagePlaceholderProps): JSX.Element {
  const { locale, t } = useLocale();
  const isThai = locale === 'th';
  const planned = isThai ? plannedTh : plannedEn;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{isThai ? titleTh : titleEn}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{isThai ? descriptionTh : descriptionEn}</p>
      </div>

      <Card>
        <CardContent className="flex gap-4 p-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Construction className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-3">
            <div>
              <p className="font-medium">{t.common.comingSoon}</p>
              <p className="text-sm text-muted-foreground">{t.common.comingSoonHint}</p>
            </div>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {planned.map((entry) => (
                <li key={entry} className="flex gap-2">
                  <span aria-hidden className="text-border">•</span>
                  <span>{entry}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
