'use client';

/**
 * โหลดชุดข้อมูลรวมช่วง + เหตุการณ์ ให้ chart explorer
 *
 * ★ เรียกผ่าน service layer เท่านั้น (lib/services/metrics.ts) — หนึ่ง request = หนึ่ง series
 * ★ ข้อมูลสด: ต่อ subscribeToUpdates แล้วโหลด "เฉพาะช่วงท้าย" มาแทนที่ bucket สุดท้าย
 *   ห้ามยิงขอทั้งช่วงใหม่ทุก 2 วินาที — ช่วง 12 เดือนรายวันคือ 365 จุดต่อรอบ
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AggregatedSeriesPoint,
  Locale,
  MetricKind,
  MetricSeries,
  SeriesGranularity,
} from '@/lib/types';
import { getMetricSeries, subscribeToUpdates } from '@/lib/services';
import { bucketStart, coerceGranularity, nextBucketStart } from '@/lib/utils/time-buckets';
import { loadMarkers } from './explorer-markers';
import type { EventMarker, ExplorerView, MetricSourceRef } from './explorer-types';

/** ช่วงท้ายที่โหลดซ้ำต้องยาวพอที่กติกาจับคู่จะยอมให้ใช้ความละเอียดเดิม */
const MAX_TAIL_BUCKETS = 8;
/** ถี่สุดที่ยอมให้โหลดช่วงท้ายซ้ำ — ข้อมูลสดขยับทุก 2 วินาที แต่ bucket ไม่ได้เปลี่ยนเร็วขนาดนั้น */
const TAIL_THROTTLE_MS = 10_000;
/** ถือว่าช่วงที่เลือก "จบที่ตอนนี้" เมื่อปลายช่วงห่างจากเวลาจริงไม่เกินเท่านี้ */
const LIVE_EDGE_MS = 120_000;

export interface ExplorerData {
  /** ต้นช่วงที่ขอจริงหลังขยับให้ตรงขอบ bucket — ใช้เขียนหัวหน้าต่างให้ตรงกับที่วาด */
  from: number;
  series: MetricSeries | null;
  points: AggregatedSeriesPoint[];
  comparePoints: AggregatedSeriesPoint[] | null;
  markers: EventMarker[];
  offlineSince: number | null;
  loading: boolean;
  /** kind ที่ได้จากหลังบ้านไม่ตรงกับทะเบียน — แสดงตามที่ได้รับ แต่เตือนไว้ */
  kindMismatch: boolean;
}

function tailWindow(view: ExplorerView, timeZone: string, now: number): { from: number; to: number } | null {
  let start = bucketStart(now, view.granularity, timeZone);
  for (let i = 0; i < MAX_TAIL_BUCKETS; i += 1) {
    if (coerceGranularity(view.granularity, start, now) === view.granularity) return { from: start, to: now };
    const previous = stepBack(start, view, timeZone);
    if (previous >= start) return null;
    start = previous;
  }
  return null;
}

/** ต้นช่วงก่อนหน้าหนึ่งช่วง — เดินถอยด้วย nextBucketStart เพื่อให้ปฏิทินตรงทุกเดือน/ปี */
function stepBack(start: number, view: ExplorerView, timeZone: string): number {
  const span = nextBucketStart(start, view.granularity, timeZone) - start;
  return bucketStart(start - Math.max(1, span), view.granularity, timeZone);
}

/**
 * ขยับต้นช่วงขึ้นให้ตรงขอบ bucket
 * ★ ช่วงแบบ "ย้อนหลัง 12 ชม." เริ่มที่ 00:39 ซึ่งคาบเกี่ยว 13 ชั่วโมงบนนาฬิกา
 *   แท่งแรกจะมีข้อมูลแค่ 21 นาทีแล้วดูเตี้ยผิดความจริง — ตัดทิ้งให้เหลือ 12 แท่งเต็มดีกว่า
 * ★ ช่วงที่ตรงขอบอยู่แล้ว (เจาะลึก / เลือกวันเอง) ฟังก์ชันนี้ไม่ทำอะไร
 */
function alignFrom(from: number, granularity: SeriesGranularity, timeZone: string): number {
  const start = bucketStart(from, granularity, timeZone);
  return start === from ? from : nextBucketStart(start, granularity, timeZone);
}

export function useExplorerData(
  ref: MetricSourceRef,
  view: ExplorerView,
  open: boolean,
  timeZone: string,
  registryKind: MetricKind,
  locale: Locale,
): ExplorerData {
  const [series, setSeries] = useState<MetricSeries | null>(null);
  const [markers, setMarkers] = useState<EventMarker[]>([]);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const token = useRef(0);

  const from = alignFrom(view.from, view.granularity, timeZone);
  const key = `${ref.sourceType}|${ref.sourceId}|${String(ref.metric)}|${from}|${view.to}|${view.granularity}|${view.compare}`;

  useEffect(() => {
    if (!open) return undefined;
    const mine = (token.current += 1);
    setLoading(true);
    let cancelled = false;

    void Promise.all([
      getMetricSeries({
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        metric: ref.metric,
        from,
        to: view.to,
        granularity: view.granularity,
        compare: view.compare,
      }),
      loadMarkers(ref, view.from, view.to, locale),
    ])
      .then(([loaded, bundle]) => {
        if (cancelled || token.current !== mine) return;
        setSeries(loaded);
        setMarkers(bundle.markers);
        setOfflineSince(bundle.offlineSince);
      })
      .finally(() => {
        if (!cancelled && token.current === mine) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // key ห่อค่าที่ใช้จริงทั้งหมดไว้แล้ว — แตกเป็นรายตัวจะยิงซ้ำตอน ref object เปลี่ยนอ้างอิงเปล่า ๆ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open, locale]);

  // ข้อมูลสดของ bucket ท้ายสุด
  useEffect(() => {
    if (!open || series === null) return undefined;
    if (Math.abs(Date.now() - view.to) > LIVE_EDGE_MS) return undefined;

    let last = 0;
    let cancelled = false;
    const stop = subscribeToUpdates(() => {
      const now = Date.now();
      if (now - last < TAIL_THROTTLE_MS) return;
      last = now;
      const tail = tailWindow(view, timeZone, now);
      if (tail === null) return;
      void getMetricSeries({
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        metric: ref.metric,
        from: tail.from,
        to: tail.to,
        granularity: view.granularity,
      }).then((fresh) => {
        if (cancelled) return;
        setSeries((current) => {
          if (current === null) return current;
          const kept = current.points.filter((point) => point.timestamp < tail.from);
          return { ...current, points: [...kept, ...fresh.points] } as MetricSeries;
        });
      });
    });

    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, series === null, timeZone]);

  const kindMismatch = series !== null && series.kind !== registryKind;

  return useMemo(
    () => ({
      from,
      series,
      points: series?.points ?? [],
      comparePoints: series?.compare?.points ?? null,
      markers,
      offlineSince,
      loading,
      kindMismatch,
    }),
    [from, series, markers, offlineSince, loading, kindMismatch],
  );
}
