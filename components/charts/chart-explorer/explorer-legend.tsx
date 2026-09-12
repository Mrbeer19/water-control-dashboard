'use client';

/**
 * legend ที่กดซ่อน/แสดงชุดข้อมูลได้
 * ★ ต้องมี legend เสมอเมื่อมีตั้งแต่ 2 ชุดขึ้นไป — ห้ามให้สีเป็นตัวบอกตัวตนอย่างเดียว
 */
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CHART, seriesColor } from '../chart-tokens';
import type { SeriesToggle } from './explorer-chart';

interface ExplorerLegendProps {
  toggles: SeriesToggle;
  onToggle: (key: keyof SeriesToggle) => void;
  seriesIndex: 0 | 1;
  showBand: boolean;
  showCompare: boolean;
  showEvents: boolean;
}

export function ExplorerLegend({
  toggles,
  onToggle,
  seriesIndex,
  showBand,
  showCompare,
  showEvents,
}: ExplorerLegendProps): JSX.Element {
  const { t } = useLocale();

  const items: { key: keyof SeriesToggle; label: string; color: string; visible: boolean }[] = [
    { key: 'value', label: t.chart.current, color: seriesColor(seriesIndex), visible: true },
    { key: 'band', label: `${t.chart.statMin}–${t.chart.statMax}`, color: CHART.waterSoft, visible: showBand },
    { key: 'compare', label: t.chart.compareSeries, color: CHART.reference, visible: showCompare },
    { key: 'events', label: t.chart.showEvents, color: CHART.warning, visible: showEvents },
  ];

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items
        .filter((item) => item.visible)
        .map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => {
                onToggle(item.key);
              }}
              aria-pressed={toggles[item.key]}
              className={cn(
                'flex items-center gap-1.5 rounded-control px-1 py-0.5 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                toggles[item.key] ? 'text-foreground' : 'text-muted-foreground line-through',
              )}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-[2px]"
                style={{ background: toggles[item.key] ? item.color : 'hsl(var(--muted-foreground))' }}
              />
              {item.label}
            </button>
          </li>
        ))}
    </ul>
  );
}
