/**
 * ข้อมูลกราฟแบบรวมช่วงเวลา — ชั้นเดียวที่ chart explorer เรียกใช้
 *
 * ★ endpoint /history เดิมยังอยู่และไม่ถูกแตะ ใช้กับ "ข้อมูลดิบ" และ sparkline
 *   ไฟล์นี้คือ "ข้อมูลที่รวมช่วงแล้ว" ซึ่งเป็นคนละเส้นกัน (ดู HANDOFF.md หัวข้อ 2.9)
 */
import type {
  AggregatedSeriesPoint,
  MetricKind,
  MetricSeries,
  MetricSeriesQuery,
  StateSpan,
} from '@/lib/types';
import { buildMetricSeries, buildStateSpans } from '@/lib/mock';
import { getMetricConfig } from '@/lib/config/metrics';
import { resolveTimezone } from '@/lib/config/timezone';
import { coerceGranularity, granularityOptions } from '@/lib/utils/time-buckets';
import { respond } from './internal';

function isoWithZone(ms: number): string {
  return new Date(ms).toISOString();
}

/** ช่วงเปรียบเทียบ — "ช่วงก่อนหน้าที่ยาวเท่ากัน" หรือ "ช่วงเดียวกันของปีก่อน" */
function compareRange(query: MetricSeriesQuery): { from: number; to: number } | null {
  if (query.compare === undefined || query.compare === 'none') return null;
  if (query.compare === 'last_year') {
    const shift = (ms: number): number => {
      const d = new Date(ms);
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      return d.getTime();
    };
    return { from: shift(query.from), to: shift(query.to) };
  }
  const span = query.to - query.from;
  return { from: query.from - span, to: query.from };
}

/**
 * ชุดข้อมูลรวมช่วงของหนึ่ง metric
 *
 * ★ หนึ่ง request = หนึ่ง series ถ้าต้องหลายเส้น (โซนซ้อน, อุณหภูมิเทียบการใช้น้ำ)
 *   ให้ผู้เรียกยิงพร้อมกันด้วย Promise.all — ยังไม่ต้องมี batch endpoint
 *
 * TODO(backend): GET /api/metrics/series
 *   ?sourceType=&sourceId=&metric=&from=&to=
 *   &granularity=minute_5|minute_15|hour|day|week|month|year
 *   &compare=none|previous|last_year&monthAnchor=calendar|meter_reading
 *   คืน MetricSeries<K> — ดู shape ของแต่ละ kind ใน lib/types.ts
 *
 *   ★ หลังบ้านต้องรวมข้อมูลที่ฐานข้อมูล (rollup รายชั่วโมง/รายวัน)
 *     ห้ามส่งข้อมูลดิบทั้งปีมาให้หน้าบ้านรวมเอง
 *   ★ ต้องตัดขอบช่วงด้วยเขตเวลาเดียวกับที่ตั้งไว้ใน settings และส่ง timezone กลับมาใน response
 *   ★ granularity ที่เกินกติกาของช่วง ให้ตอบ 400 พร้อมเหตุผล (mock ใช้กติกาเดียวกันจาก
 *     lib/utils/time-buckets.ts ซึ่ง UI ก็ใช้ตัวเดียวกัน)
 */
export async function getMetricSeries(query: MetricSeriesQuery): Promise<MetricSeries> {
  return respond((state) => {
    const timezone = resolveTimezone(state.settings.general.timezone);
    const config = getMetricConfig(query.metric);
    const kind: MetricKind = config.kind;
    const now = Date.now();

    // บังคับกติกาจับคู่ช่วง ↔ ความละเอียดด้วย util ตัวเดียวกับ UI
    const granularity = coerceGranularity(query.granularity, query.from, query.to);
    const option = granularityOptions(query.from, query.to).find((o) => o.value === query.granularity);
    if (option?.disabled === true && process.env.NODE_ENV !== 'production') {
      // ของจริงหลังบ้านจะตอบ 400 — ใน mock แค่เตือนแล้วสลับให้ระดับที่ใช้ได้
      console.warn(
        `[metrics] granularity "${query.granularity}" ใช้กับช่วงนี้ไม่ได้ สลับเป็น "${granularity}"`,
      );
    }

    const build = (from: number, to: number): AggregatedSeriesPoint[] =>
      buildMetricSeries({
        sourceId: query.sourceId,
        metric: query.metric,
        kind,
        from,
        to,
        granularity,
        timezone,
        now,
      });

    const compare = compareRange(query);

    return {
      sourceType: query.sourceType,
      sourceId: query.sourceId,
      metric: query.metric,
      unit: config.unit,
      kind,
      granularity,
      timezone,
      from: isoWithZone(query.from),
      to: isoWithZone(query.to),
      points: build(query.from, query.to),
      compare:
        compare === null
          ? null
          : {
              from: isoWithZone(compare.from),
              to: isoWithZone(compare.to),
              points: build(compare.from, compare.to),
            },
    } as MetricSeries;
  });
}

/**
 * ช่วงสถานะของอุปกรณ์ — ใช้ทั้งสถานะปั๊มและ online/offline
 * ข้อความ "ออฟไลน์ตั้งแต่ …" ใน empty state มาจากตรงนี้
 *
 * TODO(backend): GET /api/metrics/state-spans?sourceType=&sourceId=&from=&to= → StateSpan[]
 *   span ต้องต่อกันไม่มีรู ช่วงที่ไม่มีข้อมูลใช้ state "no_data"
 *   และผลรวม durationMs ต้องเท่ากับความยาวช่วงที่ขอพอดี
 */
export async function getStateSpans(params: {
  sourceId: string;
  from: number;
  to: number;
}): Promise<StateSpan[]> {
  return respond(() => buildStateSpans(params));
}
