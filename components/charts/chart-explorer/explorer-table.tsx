'use client';

/**
 * ตารางตัวเลขใต้กราฟ — เรียงลำดับได้ + ส่งออก CSV
 *
 * ★ คอลัมน์สถิติเปลี่ยนตาม kind เช่นเดียวกับการ์ดสรุป (gauge ไม่มีคอลัมน์ "รวม")
 * ★ จอ 375px เปลี่ยนเป็นการ์ดเรียงลง ห้ามให้ตารางดันจนหน้าเลื่อนแนวนอน
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import type { Locale, MetricKind } from '@/lib/types';
import type { MetricConfig } from '@/lib/config/metrics';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import type { ExplorerRow } from './explorer-types';

type SortKey = 'start' | 'value' | 'completeness';
type SortDirection = 'asc' | 'desc';

interface ExplorerTableProps {
  rows: ExplorerRow[];
  config: MetricConfig;
  kind: MetricKind;
  /** ใช้ตั้งชื่อไฟล์ CSV */
  fileBase: string;
}

function cellValue(row: ExplorerRow, key: SortKey): number {
  if (key === 'start') return row.start;
  if (key === 'completeness') return row.completeness;
  return row.value ?? Number.NEGATIVE_INFINITY;
}

function text(value: number | null, config: MetricConfig, kind: MetricKind, locale: Locale, hours: string): string {
  if (value === null) return '—';
  return kind === 'state' ? `${formatNumber(value, locale, 1)} ${hours}` : config.format(value, locale);
}

/**
 * ส่งออกช่วงที่กำลังดูอยู่เป็น CSV
 * TODO(backend): GET /api/metrics/series/export?…&format=csv
 *   ของจริงควรให้หลังบ้านสร้างไฟล์ เพราะช่วงยาว ๆ หน้าบ้านไม่ได้ถือข้อมูลครบทุกจุด
 *   ตอนนี้ส่งออกเฉพาะ bucket ที่แสดงอยู่บนจอ
 */
function downloadCsv(rows: ExplorerRow[], header: string[], fileBase: string): void {
  const escape = (value: string): string => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [header.map(escape).join(',')];
  for (const row of rows) {
    lines.push(
      [
        escape(row.rangeLabel),
        row.value === null ? '' : String(row.value),
        row.low === null ? '' : String(row.low),
        row.high === null ? '' : String(row.high),
        String(Math.round(row.completeness * 100)),
      ].join(','),
    );
  }
  // BOM ให้ Excel ภาษาไทยอ่านไม่เป็นต่างด้าว
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileBase}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExplorerTable({ rows, config, kind, fileBase }: ExplorerTableProps): JSX.Element {
  const { t, locale } = useLocale();
  const [sortKey, setSortKey] = useState<SortKey>('start');
  const [direction, setDirection] = useState<SortDirection>('desc');

  const hasBand = rows.some((row) => row.low !== null || row.high !== null);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => (cellValue(a, sortKey) - cellValue(b, sortKey)) * (direction === 'asc' ? 1 : -1));
    return copy;
  }, [rows, sortKey, direction]);

  const sort = (key: SortKey): void => {
    if (key === sortKey) setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setDirection('desc');
    }
  };

  const Header = ({ label, keyName, align }: { label: string; keyName: SortKey; align: 'left' | 'right' }): JSX.Element => (
    <th className={cn('px-3 py-2 font-medium', align === 'left' ? 'text-left' : 'text-right')}>
      <button
        type="button"
        onClick={() => {
          sort(keyName);
        }}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {sortKey === keyName &&
          (direction === 'asc' ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ))}
      </button>
    </th>
  );

  const valueHeader = kind === 'gauge' ? t.chart.statAvg : kind === 'level' ? t.chart.statLast : t.chart.value;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            downloadCsv(
              sorted,
              [t.chart.period, valueHeader, t.chart.statMin, t.chart.statMax, t.chart.completeness],
              fileBase,
            );
          }}
          className="inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t.chart.exportCsv}
        </button>
      </div>

      {/* จอกว้าง: ตาราง */}
      <div className="hidden max-h-64 overflow-auto rounded-control border sm:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-secondary text-xs text-muted-foreground">
            <tr className="border-b">
              <Header label={t.chart.period} keyName="start" align="left" />
              <Header label={valueHeader} keyName="value" align="right" />
              {hasBand && <th className="px-3 py-2 text-right font-medium">{t.chart.statMin}</th>}
              {hasBand && <th className="px-3 py-2 text-right font-medium">{t.chart.statMax}</th>}
              <Header label={t.chart.completeness} keyName="completeness" align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.start} className="border-b last:border-0">
                <td className="px-3 py-1.5">
                  {row.rangeLabel}
                  {row.isPartial && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">({t.chart.partial})</span>
                  )}
                </td>
                <td className="tabular px-3 py-1.5 text-right font-medium">
                  {text(row.value, config, kind, locale, t.chart.unitHours)}
                </td>
                {hasBand && (
                  <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                    {text(row.low, config, kind, locale, t.chart.unitHours)}
                  </td>
                )}
                {hasBand && (
                  <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                    {text(row.high, config, kind, locale, t.chart.unitHours)}
                  </td>
                )}
                <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                  {formatNumber(row.completeness * 100, locale, 0)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* จอแคบ: การ์ดเรียงลง */}
      <ul className="max-h-64 space-y-1.5 overflow-auto sm:hidden">
        {sorted.map((row) => (
          <li key={row.start} className="rounded-control border p-2.5">
            <p className="text-xs text-muted-foreground">
              {row.rangeLabel}
              {row.isPartial && <span className="ml-1.5">({t.chart.partial})</span>}
            </p>
            <p className="tabular text-base font-semibold">
              {text(row.value, config, kind, locale, t.chart.unitHours)}
            </p>
            <p className="tabular text-[11px] text-muted-foreground">
              {hasBand && (
                <>
                  {t.chart.statMin} {text(row.low, config, kind, locale, t.chart.unitHours)} · {t.chart.statMax}{' '}
                  {text(row.high, config, kind, locale, t.chart.unitHours)} ·{' '}
                </>
              )}
              {t.chart.completeness} {formatNumber(row.completeness * 100, locale, 0)}%
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
