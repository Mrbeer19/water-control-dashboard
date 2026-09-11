'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Maximize2, X } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber } from '@/lib/utils';
import { AXIS_PROPS, TOOLTIP_STYLE, seriesColor } from './chart-tokens';

/** จุดข้อมูลดิบหนึ่งจุดที่กราฟส่งเข้ามาให้หน้าต่างรายละเอียด */
export interface DetailPoint {
  timestamp: number;
  value: number;
}

type Grain = 'hour' | 'day' | 'month' | 'year';

interface Bucket {
  key: string;
  label: string;
  total: number;
  count: number;
  peak: number;
}

/** ช่วงที่เลือกได้ของแต่ละความละเอียด — จำนวน bucket ย้อนหลัง */
const RANGES: Record<Grain, number[]> = {
  hour: [12, 24, 72],
  day: [7, 30, 90],
  month: [6, 12, 24],
  year: [0], // 0 = ทั้งหมดที่มี
};

/**
 * เลือกระดับความละเอียดที่ "มีความหมาย" จากช่วงเวลาของข้อมูลจริง
 * ★ กราฟจิ๋วในการ์ดมีข้อมูล 24 ชม. ถ้าให้เลือกรายปีจะได้แท่งเดียว ไม่มีประโยชน์
 *   กลับกัน ข้อมูลย้อนหลังเป็นปีถ้าให้ดูรายชั่วโมงก็จะมีเป็นพันแท่ง
 */
function autoGrains(points: DetailPoint[]): Grain[] {
  if (points.length < 2) return ['day'];
  const first = points[0]?.timestamp ?? 0;
  const last = points[points.length - 1]?.timestamp ?? 0;
  const days = Math.abs(last - first) / 86_400_000;
  if (days <= 3) return ['hour'];
  if (days <= 14) return ['hour', 'day'];
  if (days <= 120) return ['day', 'month'];
  return ['day', 'month', 'year'];
}

function bucketKey(grain: Grain, date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  const h = `${date.getHours()}`.padStart(2, '0');
  if (grain === 'year') return `${y}`;
  if (grain === 'month') return `${y}-${m}`;
  if (grain === 'hour') return `${y}-${m}-${d}-${h}`;
  return `${y}-${m}-${d}`;
}

function bucketLabel(grain: Grain, key: string, locale: 'th' | 'en'): string {
  const [y, m, d, h] = key.split('-');
  const year = Number(y);
  // ปี พ.ศ. เฉพาะภาษาไทย ให้ตรงกับที่ formatDateTimeTH ใช้ทั้งแอป
  const shownYear = locale === 'th' ? year + 543 : year;
  if (grain === 'year') return `${shownYear}`;
  const monthName = new Intl.DateTimeFormat(locale === 'th' ? 'th-TH' : 'en-GB', { month: 'short' }).format(
    new Date(year, Number(m) - 1, 1),
  );
  if (grain === 'month') return `${monthName} ${shownYear}`;
  if (grain === 'hour') return `${Number(d)} ${monthName} ${h}:00`;
  return `${Number(d)} ${monthName}`;
}

/**
 * รวมจุดข้อมูลดิบเป็นถังตามความละเอียดที่เลือก
 * ★ รวมฝั่งหน้าจอจากชุดข้อมูลเดิมที่กราฟมีอยู่แล้ว ไม่ได้ยิง endpoint เพิ่ม
 *   ตอนต่อ backend จริงควรย้ายไปรวมที่เซิร์ฟเวอร์ แล้วส่งเฉพาะถังที่ต้องใช้
 */
function aggregate(points: DetailPoint[], grain: Grain, locale: 'th' | 'en'): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const point of points) {
    const key = bucketKey(grain, new Date(point.timestamp));
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, { key, label: bucketLabel(grain, key, locale), total: point.value, count: 1, peak: point.value });
    } else {
      existing.total += point.value;
      existing.count += 1;
      existing.peak = Math.max(existing.peak, point.value);
    }
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

interface ChartDetailProps {
  /** ชื่อที่จะขึ้นหัวหน้าต่าง */
  title: string;
  /** หน่วยของค่า เช่น m³ · kWh */
  unit: string;
  /** จุดข้อมูลดิบที่กราฟตัวเล็กใช้อยู่ — ใช้เป็นค่าเริ่มต้นระหว่างรอโหลดชุดยาว */
  points: DetailPoint[];
  /**
   * โหลดชุดข้อมูลย้อนหลังยาว ๆ ตอนเปิดหน้าต่างครั้งแรก
   * ★ ไม่โหลดมาตั้งแต่แรกเพราะหน้าแรกไม่ได้ต้องใช้ 400 จุด — โหลดตอนกดดูเท่านั้น
   */
  loadPoints?: () => Promise<DetailPoint[]>;
  /** ทศนิยมที่ใช้แสดงตัวเลข */
  decimals?: number;
  /**
   * ความละเอียดที่เลือกได้ — ค่าตั้งต้นคือครบทั้งสามระดับ
   * ★ ไม่ส่งมา = เลือกให้อัตโนมัติจากช่วงเวลาของข้อมูล (ดู autoGrains)
   *   กราฟที่ข้อมูลดิบเป็นรายเดือนอยู่แล้วต้องส่ง ['month','year'] มาเอง
   *   ไม่งั้นระดับ "รายวัน" จะเอายอดทั้งเดือนไปแปะไว้ที่วันที่ 1 ซึ่งอ่านผิด
   */
  grains?: Grain[];
  /**
   * โหมดหมวดหมู่ — ใช้กับกราฟที่แกนนอนไม่ใช่เวลา เช่น แยกตามโซน
   * ★ ส่งมาแล้วจะไม่มีตัวสลับ วัน/เดือน/ปี เพราะข้อมูลไม่มีมิติเวลาให้รวม
   */
  categories?: { label: string; value: number }[];
  /** กราฟตัวเล็กที่แสดงอยู่บนการ์ด */
  children: ReactNode;
}

/**
 * ครอบกราฟให้กดดูข้อมูลละเอียดได้
 *
 * ★ กดที่กราฟแล้วเปิดหน้าต่างที่สลับดูราย วัน / เดือน / ปี ได้ พร้อมตารางตัวเลขของทุกช่วง
 * ★ ใช้ <dialog> ของเบราว์เซอร์ จะได้ focus trap และปุ่ม Esc มาเลย ไม่ต้องเขียนเอง
 * ★ กราฟตัวเล็กบนการ์ดยังอ่านได้เหมือนเดิม การกดเป็นของแถม ไม่ใช่ทางเดียวที่จะเห็นข้อมูล
 */
export function ChartDetail({
  title,
  unit,
  points,
  loadPoints,
  decimals = 1,
  grains,
  categories,
  children,
}: ChartDetailProps): JSX.Element {
  const { t, locale } = useLocale();
  const resolvedGrains = useMemo(() => grains ?? autoGrains(points), [grains, points]);
  const firstGrain = resolvedGrains[0] ?? 'day';
  const [open, setOpen] = useState(false);
  const [grain, setGrain] = useState<Grain>(firstGrain);
  const [range, setRange] = useState<number>(RANGES[firstGrain][0] ?? 0);
  const [deep, setDeep] = useState<DetailPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // โหลดชุดยาวครั้งเดียวตอนเปิดหน้าต่างครั้งแรก
  useEffect(() => {
    if (!open || loadPoints === undefined || deep !== null || loading) return;
    setLoading(true);
    void loadPoints()
      .then(setDeep)
      .finally(() => {
        setLoading(false);
      });
  }, [open, loadPoints, deep, loading]);

  const source = deep ?? points;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const handleClose = (): void => {
      setOpen(false);
    };
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, []);

  const pickGrain = useCallback((next: Grain) => {
    setGrain(next);
    setRange(RANGES[next][0] ?? 0);
  }, []);

  const buckets = useMemo(() => {
    if (categories !== undefined) {
      return categories.map((item) => ({
        key: item.label,
        label: item.label,
        total: item.value,
        count: 1,
        peak: item.value,
      }));
    }
    const all = aggregate(source, grain, locale);
    return range > 0 ? all.slice(-range) : all;
  }, [categories, source, grain, range, locale]);

  const summary = useMemo(() => {
    const total = buckets.reduce((sum, b) => sum + b.total, 0);
    const peak = buckets.reduce((max, b) => Math.max(max, b.total), 0);
    return { total, peak, average: buckets.length === 0 ? 0 : total / buckets.length };
  }, [buckets]);

  const rangeLabel = (n: number): string => {
    if (grain === 'year') return t.chart.allYears;
    const template =
      grain === 'hour' ? t.chart.lastHours : grain === 'day' ? t.chart.lastDays : t.chart.lastMonths;
    return template.replace('{n}', String(n));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        title={t.chart.detail}
        aria-label={`${t.chart.detail} — ${title}`}
        className={cn(
          'group relative block w-full rounded-control text-left',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        {children}
        <span
          className="pointer-events-none absolute right-1 top-1 hidden rounded-control border bg-card p-1 text-muted-foreground group-hover:block group-focus-visible:block"
          aria-hidden
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className={cn(
          'w-[min(56rem,calc(100vw-2rem))] rounded-overlay border bg-card p-0 text-card-foreground shadow-xl',
          // จอเตี้ยหรือจอมือถือต้องเลื่อนดูในกล่องได้ ไม่ใช่ล้นออกนอกจอ
          'max-h-[calc(100dvh-2rem)] overflow-auto',
          'backdrop:bg-black/50 backdrop:backdrop-blur-[1px]',
        )}
        aria-label={title}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-strong p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-xs text-muted-foreground">
              {t.chart.points} {formatNumber(categories?.length ?? source.length, locale, 0)} · {unit}
              {loading && ` · ${t.common.loading}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
            aria-label={t.chart.close}
            className="shrink-0 rounded-control p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {categories === undefined && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-control border bg-secondary p-0.5" role="group">
              {resolvedGrains.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    pickGrain(option);
                  }}
                  aria-pressed={grain === option}
                  className={cn(
                    'rounded-control px-3 py-1.5 text-xs font-medium transition-colors',
                    grain === option
                      ? 'bg-card text-foreground ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option === 'hour'
                    ? t.chart.byHour
                    : option === 'day'
                      ? t.chart.byDay
                      : option === 'month'
                        ? t.chart.byMonth
                        : t.chart.byYear}
                </button>
              ))}
            </div>

            {grain !== 'year' && (
              <div className="inline-flex rounded-control border bg-secondary p-0.5" role="group">
                {(RANGES[grain] ?? []).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setRange(option);
                    }}
                    aria-pressed={range === option}
                    className={cn(
                      'rounded-control px-3 py-1.5 text-xs font-medium transition-colors',
                      range === option
                        ? 'bg-card text-foreground ring-1 ring-border'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {rangeLabel(option)}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {buckets.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t.common.empty}</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: t.chart.total, value: summary.total },
                  { label: t.chart.average, value: summary.average },
                  { label: t.chart.peak, value: summary.peak },
                ].map((item) => (
                  <div key={item.label} className="rounded-control border p-2.5">
                    <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
                    <dd className="tabular mt-0.5 text-base font-semibold">
                      {formatNumber(item.value, locale, decimals)}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">{unit}</span>
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={buckets} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis {...AXIS_PROPS} dataKey="label" interval="preserveStartEnd" minTickGap={16} />
                    <YAxis {...AXIS_PROPS} width={52} />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      cursor={{ fill: 'hsl(var(--accent))' }}
                      formatter={(value) => [`${formatNumber(Number(value), locale, decimals)} ${unit}`, t.chart.value]}
                    />
                    <Bar dataKey="total" fill={seriesColor(0)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="max-h-64 overflow-auto rounded-control border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-medium">{t.chart.period}</th>
                      <th className="px-3 py-2 text-right font-medium">{t.chart.total}</th>
                      <th className="px-3 py-2 text-right font-medium">{t.chart.average}</th>
                      <th className="px-3 py-2 text-right font-medium">{t.chart.peak}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(categories === undefined ? [...buckets].reverse() : buckets).map((bucket) => (
                      <tr key={bucket.key} className="border-b last:border-0">
                        <td className="px-3 py-1.5">{bucket.label}</td>
                        <td className="tabular px-3 py-1.5 text-right font-medium">
                          {formatNumber(bucket.total, locale, decimals)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                          {formatNumber(bucket.total / bucket.count, locale, decimals)}
                        </td>
                        <td className="tabular px-3 py-1.5 text-right text-muted-foreground">
                          {formatNumber(bucket.peak, locale, decimals)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
