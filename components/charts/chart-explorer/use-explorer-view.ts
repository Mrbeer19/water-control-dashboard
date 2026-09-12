'use client';

/**
 * state ของมุมมองใน chart explorer + การเจาะลึก + การผูกกับ URL
 *
 * ★ เก็บลง URL query เพื่อให้ copy ลิงก์ไปเปิดแล้วเห็นมุมมองเดียวกัน
 *   ใช้ history.replaceState ตรง ๆ ไม่ผ่าน useSearchParams ของ next/navigation
 *   เพราะ hook ตัวนั้นบังคับให้ทั้งหน้าต้องมี <Suspense> ครอบตอน build
 * ★ ห้ามคิดกติกาช่วง↔ความละเอียดซ้ำที่นี่ ต้องเรียก lib/utils/time-buckets.ts
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MetricKey, SeriesCompareMode, SeriesGranularity } from '@/lib/types';
import { coerceGranularity, nextBucketStart, preferredGranularity } from '@/lib/utils/time-buckets';
import type { ExplorerView, MetricSourceRef, RangePreset } from './explorer-types';
import { RANGE_PRESETS } from './explorer-types';

/** ความละเอียดชั้นลูกเมื่อกดเจาะลงไป — ตัวที่ไม่มีชั้นลูกคือเจาะต่อไม่ได้ */
const CHILD_GRANULARITY: Partial<Record<SeriesGranularity, SeriesGranularity>> = {
  year: 'month',
  month: 'day',
  week: 'day',
  day: 'hour',
  hour: 'minute_5',
  minute_15: 'minute_5',
  minute_5: 'raw',
};

export function childGranularity(granularity: SeriesGranularity): SeriesGranularity | null {
  return CHILD_GRANULARITY[granularity] ?? null;
}

function presetMs(preset: RangePreset): number {
  return RANGE_PRESETS.find((row) => row.value === preset)?.ms ?? 24 * 3_600_000;
}

function viewFromPreset(preset: Exclude<RangePreset, 'custom'>, now: number): ExplorerView {
  const from = now - presetMs(preset);
  return {
    preset,
    from,
    to: now,
    granularity: preferredGranularity(from, now),
    compare: 'none',
    crumb: null,
  };
}

const GRANULARITIES: SeriesGranularity[] = [
  'raw',
  'minute_5',
  'minute_15',
  'hour',
  'day',
  'week',
  'month',
  'year',
];
const COMPARE_MODES: SeriesCompareMode[] = ['none', 'previous', 'last_year'];

/**
 * อ่านมุมมองจาก URL — คืน null เมื่อ query ไม่ได้ชี้มาที่กราฟใบนี้
 * ★ metrics คือค่าวัดทั้งหมดที่กราฟใบนี้สลับดูได้ ลิงก์จึงชี้มาที่ตัวไหนก็ได้ในชุดนั้น
 */
function readUrl(ref: MetricSourceRef, metrics: MetricKey[]): { view: ExplorerView; metric: MetricKey } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const wanted = params.get('metric');
  if (wanted === null || params.get('source') !== ref.sourceId) return null;
  const metric = metrics.find((item) => item === wanted);
  if (metric === undefined) return null;

  const range = params.get('range') ?? '24h';
  const now = Date.now();
  let from: number;
  let to: number;
  let preset: RangePreset;
  const custom = range.split('..');
  if (custom.length === 2) {
    from = Number(custom[0]);
    to = Number(custom[1]);
    preset = 'custom';
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  } else {
    const match = RANGE_PRESETS.find((row) => row.value === range);
    if (match === undefined) return null;
    preset = match.value;
    from = now - match.ms;
    to = now;
  }

  const rawGrain = params.get('granularity');
  const grain: SeriesGranularity =
    rawGrain !== null && GRANULARITIES.includes(rawGrain as SeriesGranularity)
      ? (rawGrain as SeriesGranularity)
      : preferredGranularity(from, to);
  const rawCompare = params.get('compare');
  const compare: SeriesCompareMode =
    rawCompare !== null && COMPARE_MODES.includes(rawCompare as SeriesCompareMode)
      ? (rawCompare as SeriesCompareMode)
      : 'none';

  return {
    view: { preset, from, to, granularity: coerceGranularity(grain, from, to), compare, crumb: null },
    metric,
  };
}

function writeUrl(ref: MetricSourceRef, metric: MetricKey, view: ExplorerView): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('metric', metric);
  params.set('source', ref.sourceId);
  params.set('range', view.preset === 'custom' ? `${view.from}..${view.to}` : view.preset);
  params.set('granularity', view.granularity);
  params.set('compare', view.compare);
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function clearUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  for (const key of ['metric', 'source', 'range', 'granularity', 'compare']) params.delete(key);
  const query = params.toString();
  window.history.replaceState(null, '', query === '' ? window.location.pathname : `${window.location.pathname}?${query}`);
}

/** URL ชี้มาที่กราฟใบนี้อยู่หรือเปล่า — ใช้เปิด modal ให้เองตอนเปิดลิงก์ที่ copy มา */
export function urlPointsAt(ref: MetricSourceRef, metrics?: MetricKey[]): boolean {
  return readUrl(ref, metrics ?? [ref.metric]) !== null;
}

export interface ExplorerViewApi {
  view: ExplorerView;
  /** ค่าวัดที่กำลังดูอยู่ — เปลี่ยนได้เมื่อกราฟใบนี้มีหลายค่าวัดของอุปกรณ์เดียวกัน */
  metric: MetricKey;
  setMetric: (metric: MetricKey) => void;
  /** ชั้นที่เจาะผ่านมา ชั้นแรกคือราก — ใช้ทำ breadcrumb */
  trail: ExplorerView[];
  timeZone: string;
  setPreset: (preset: Exclude<RangePreset, 'custom'>) => void;
  setCustomRange: (from: number, to: number) => void;
  setGranularity: (granularity: SeriesGranularity) => void;
  setCompare: (compare: SeriesCompareMode) => void;
  /** เจาะเข้าไปใน bucket หนึ่ง — คืน false เมื่อชั้นนั้นเจาะต่อไม่ได้ */
  drill: (bucketStartMs: number, crumb: string) => boolean;
  /** ย้อนกลับไปชั้นที่ index (0 = ราก) */
  backTo: (index: number) => void;
}

export function useExplorerView(
  ref: MetricSourceRef,
  open: boolean,
  timeZone: string,
  defaultPreset: Exclude<RangePreset, 'custom'> = '24h',
  metrics?: MetricKey[],
): ExplorerViewApi {
  const [trail, setTrail] = useState<ExplorerView[]>(() => [viewFromPreset(defaultPreset, Date.now())]);
  const [metric, setMetric] = useState<MetricKey>(ref.metric);
  const restored = useRef(false);
  const choices = metrics ?? [ref.metric];
  const choiceKey = choices.join(',');

  // เปิดครั้งแรก: ถ้า URL ชี้มาที่กราฟใบนี้ ให้ใช้มุมมองจากลิงก์แทนค่าเริ่มต้น
  useEffect(() => {
    if (!open || restored.current) return;
    restored.current = true;
    const fromUrl = readUrl(ref, choiceKey.split(',') as MetricKey[]);
    if (fromUrl !== null) {
      setTrail([fromUrl.view]);
      setMetric(fromUrl.metric);
    }
  }, [open, ref, choiceKey]);

  const view = trail[trail.length - 1] ?? viewFromPreset(defaultPreset, Date.now());

  // เขียน URL เฉพาะตอนเปิดอยู่ ปิดแล้วเก็บกวาดให้ลิงก์กลับไปเป็นของหน้าเดิม
  useEffect(() => {
    if (open) writeUrl(ref, metric, view);
    else if (restored.current) clearUrl();
  }, [open, ref, metric, view]);

  const replaceTop = useCallback((next: (current: ExplorerView) => ExplorerView) => {
    setTrail((current) => {
      const top = current[current.length - 1];
      if (top === undefined) return current;
      return [...current.slice(0, -1), next(top)];
    });
  }, []);

  const setPreset = useCallback(
    (preset: Exclude<RangePreset, 'custom'>) => {
      setTrail((current) => {
        const top = current[current.length - 1];
        const made = viewFromPreset(preset, Date.now());
        // เปลี่ยนช่วงเวลา = ออกจากการเจาะลึก กลับไปชั้นเดียว
        return [{ ...made, compare: top?.compare ?? 'none' }];
      });
    },
    [],
  );

  const setCustomRange = useCallback((from: number, to: number) => {
    setTrail((current) => {
      const top = current[current.length - 1];
      return [
        {
          preset: 'custom',
          from,
          to,
          granularity: coerceGranularity(top?.granularity ?? 'hour', from, to),
          compare: top?.compare ?? 'none',
          crumb: null,
        },
      ];
    });
  }, []);

  const setGranularity = useCallback(
    (granularity: SeriesGranularity) => {
      replaceTop((top) => ({ ...top, granularity: coerceGranularity(granularity, top.from, top.to) }));
    },
    [replaceTop],
  );

  const setCompare = useCallback(
    (compare: SeriesCompareMode) => {
      replaceTop((top) => ({ ...top, compare }));
    },
    [replaceTop],
  );

  const drill = useCallback(
    (bucketStartMs: number, crumb: string): boolean => {
      const top = trail[trail.length - 1];
      if (top === undefined) return false;
      const child = childGranularity(top.granularity);
      if (child === null) return false;
      const from = bucketStartMs;
      const to = nextBucketStart(bucketStartMs, top.granularity, timeZone);
      setTrail((current) => [
        ...current,
        {
          preset: 'custom',
          from,
          to,
          granularity: coerceGranularity(child, from, to),
          compare: top.compare,
          crumb,
        },
      ]);
      return true;
    },
    [trail, timeZone],
  );

  const backTo = useCallback((index: number) => {
    setTrail((current) => current.slice(0, Math.max(1, index + 1)));
  }, []);

  return useMemo(
    () => ({ view, metric, setMetric, trail, timeZone, setPreset, setCustomRange, setGranularity, setCompare, drill, backTo }),
    [view, metric, trail, timeZone, setPreset, setCustomRange, setGranularity, setCompare, drill, backTo],
  );
}
