'use client';

/**
 * เส้นทางการเจาะลึก เช่น 2569 › ก.ย. › 11 ก.ย.
 * ★ ทุกชั้นกดย้อนกลับได้ ไม่ใช่แค่ปุ่ม "ย้อนกลับ" ทีละขั้น
 */
import { ChevronRight } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ExplorerView } from './explorer-types';

interface ExplorerBreadcrumbProps {
  trail: ExplorerView[];
  onBack: (index: number) => void;
}

export function ExplorerBreadcrumb({ trail, onBack }: ExplorerBreadcrumbProps): JSX.Element | null {
  const { t } = useLocale();
  if (trail.length < 2) return null;

  return (
    <nav aria-label={t.chart.drillRoot}>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {trail.map((view, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${view.from}-${index}`} className="flex items-center gap-1">
              {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />}
              <button
                type="button"
                disabled={last}
                onClick={() => {
                  onBack(index);
                }}
                aria-current={last ? 'page' : undefined}
                className={cn(
                  'rounded-control px-1.5 py-0.5 transition-colors',
                  last
                    ? 'font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {view.crumb ?? t.chart.drillRoot}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
