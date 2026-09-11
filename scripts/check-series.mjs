/**
 * ตรวจความสอดคล้องข้ามระดับของข้อมูลกราฟ — สเปก Phase 7.3 ข้อ 3
 *
 * รันด้วย: npm run check:series
 * ★ Node ล้วน + --experimental-strip-types ไม่ได้เพิ่ม test runner
 *
 * ที่ตรวจ
 *   1. counter/amount: ผลรวม 24 bucket รายชั่วโมง = bucket รายวันของวันนั้น
 *   2. gauge: avg รายวัน = ค่าเฉลี่ยถ่วงน้ำหนักด้วย count ไม่ใช่เฉลี่ยของ avg รายชั่วโมง
 *   3. gauge: min/max รายวัน = min/max ของรายชั่วโมง
 *   4. ได้ bucket ครบตามช่วงที่ขอ รวมช่วงที่ไม่มีข้อมูล
 *   5. ช่วงที่ไม่มีข้อมูลเป็น null ไม่ใช่ 0
 *   6. StateSpan ต่อกันไม่มีรู และผลรวมเวลาเท่ากับช่วงที่ขอพอดี
 *   7. ความเร็ว: ขอ 2 ปีรายเดือน ต้องเสร็จเร็วพอ
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TZ = 'Asia/Bangkok';
const { buildMetricSeries, buildStateSpans } = await import(join(ROOT, 'lib/mock/metric-series.ts'));
const { bucketStart, MS } = await import(join(ROOT, 'lib/utils/time-buckets.ts'));

let failed = 0;
const pass = (n, m) => console.log(`  [PASS] ${n}  ${m}`);
const fail = (n, m) => { failed += 1; console.log(`  [FAIL] ${n}  ${m}`); };

// ตรึงเวลาอ้างอิงให้ผลซ้ำได้ — เอาเมื่อวานเพื่อให้ทุก bucket จบแล้ว
const NOW = Date.parse('2026-09-11T15:00:00Z');
const dayStart = bucketStart(NOW - MS.day, 'day', TZ);
const dayEnd = dayStart + MS.day;

const series = (metric, kind, from, to, granularity, sourceId = 'pump-1') =>
  buildMetricSeries({ sourceId, metric, kind, from, to, granularity, timezone: TZ, now: NOW });

/* 1. counter / amount — รายชั่วโมงรวมกันต้องเท่ากับรายวัน */
for (const [metric, kind, field] of [['energy_kwh', 'counter', 'delta'], ['rainfall', 'amount', 'sum']]) {
  const hours = series(metric, kind, dayStart, dayEnd, 'hour');
  const days = series(metric, kind, dayStart, dayEnd, 'day');
  const hourly = hours.reduce((a, b) => a + (b[field] ?? 0), 0);
  const daily = days[0]?.[field] ?? 0;
  const diff = Math.abs(hourly - daily);
  const tolerance = Math.max(0.01, Math.abs(daily) * 1e-6);
  if (hours.length === 24 && diff <= tolerance) {
    pass(`${metric} รายชั่วโมงรวม = รายวัน`, `${hourly.toFixed(3)} ≈ ${daily.toFixed(3)} (24 ช่วง)`);
  } else {
    fail(`${metric} รายชั่วโมงรวม = รายวัน`, `รายชั่วโมง ${hourly.toFixed(4)} · รายวัน ${daily.toFixed(4)} · ต่าง ${diff.toFixed(4)} · ${hours.length} ช่วง`);
  }
}

/* 2–3. gauge — avg ถ่วงน้ำหนัก และ min/max */
{
  const hours = series('temperature', 'gauge', dayStart, dayEnd, 'hour', 'sensor-outdoor');
  const day = series('temperature', 'gauge', dayStart, dayEnd, 'day', 'sensor-outdoor')[0];
  const withData = hours.filter((h) => h.count > 0);
  const weighted = withData.reduce((a, h) => a + h.avg * h.count, 0) / withData.reduce((a, h) => a + h.count, 0);
  const plainMean = withData.reduce((a, h) => a + h.avg, 0) / withData.length;

  const diff = Math.abs(weighted - day.avg);
  if (diff < 0.01) pass('gauge avg รายวัน = ถ่วงน้ำหนักด้วย count', `${day.avg.toFixed(3)} ≈ ${weighted.toFixed(3)}`);
  else fail('gauge avg รายวัน = ถ่วงน้ำหนักด้วย count', `รายวัน ${day.avg} · ถ่วงน้ำหนัก ${weighted.toFixed(4)} · เฉลี่ยธรรมดา ${plainMean.toFixed(4)}`);

  const minOfMin = Math.min(...withData.map((h) => h.min));
  const maxOfMax = Math.max(...withData.map((h) => h.max));
  if (Math.abs(minOfMin - day.min) < 0.001 && Math.abs(maxOfMax - day.max) < 0.001) {
    pass('gauge min/max รายวัน = ของรายชั่วโมง', `${day.min.toFixed(2)} … ${day.max.toFixed(2)}`);
  } else {
    fail('gauge min/max รายวัน = ของรายชั่วโมง', `วัน ${day.min}/${day.max} · ชั่วโมง ${minOfMin}/${maxOfMax}`);
  }

  if (day.minAt !== null && day.maxAt !== null && day.minAt >= dayStart && day.maxAt < dayEnd) {
    pass('gauge มีเวลาที่เกิดค่าต่ำ/สูงสุด', new Date(day.maxAt).toISOString());
  } else {
    fail('gauge มีเวลาที่เกิดค่าต่ำ/สูงสุด', `minAt ${day.minAt} maxAt ${day.maxAt}`);
  }

  if (!('sum' in day)) pass('gauge ไม่มี field รวม', 'discriminated union กันไม่ให้หยิบ sum ของอุณหภูมิได้');
  else fail('gauge ไม่มี field รวม', 'ยังมี sum อยู่ใน gauge bucket');
}

/* 4–5. ครบทุกช่วง และช่วงที่ไม่มีข้อมูลเป็น null */
{
  const hours = series('flow_lpm', 'gauge', dayStart, dayEnd, 'hour', 'zone-7');
  const empties = hours.filter((h) => h.count === 0);
  const zeroInsteadOfNull = empties.filter((h) => h.avg === 0);
  const allHavePartialFlag = hours.every((h) => typeof h.isPartial === 'boolean');
  if (hours.length === 24 && zeroInsteadOfNull.length === 0 && allHavePartialFlag) {
    pass('ครบทุกช่วง + ช่วงว่างเป็น null', `24 ช่วง · ว่าง ${empties.length} ช่วง ไม่มีตัวไหนเป็น 0`);
  } else {
    fail('ครบทุกช่วง + ช่วงว่างเป็น null', `${hours.length} ช่วง · ว่างที่เป็น 0 = ${zeroInsteadOfNull.length}`);
  }
}

/* 5a. ต้องมีช่วงที่เซนเซอร์ออฟไลน์แล้วกลายเป็นช่องว่างจริง */
{
  // ไล่หาวันที่มีช่วงออฟไลน์ของอุปกรณ์ตัวหนึ่ง แล้วดูว่า bucket ชั่วโมงนั้นเป็น null ไหม
  let found = null;
  let partialHours = 0;
  const sources = ['esp32-tank-1', 'pump-1', 'zone-7', 'sensor-outdoor', 'sensor-pumproom'];
  for (const id of sources) {
    for (let d = 1; d <= 60; d += 1) {
      const from = bucketStart(NOW - d * MS.day, 'day', TZ);
      const hours = series('flow_lpm', 'gauge', from, from + MS.day, 'hour', id);
      partialHours += hours.filter((h) => h.count > 0 && h.count < h.expectedCount * 0.8).length;
      const gap = hours.find((h) => h.count === 0);
      if (gap !== undefined && found === null) found = { id, gap };
    }
  }
  if (found === null) {
    fail('ช่วงออฟไลน์กลายเป็นช่องว่าง', 'ไล่ 5 อุปกรณ์ × 60 วันแล้วไม่เจอช่วงออฟไลน์เลย — ข้อมูลจำลองไม่มีรูให้ทดสอบ');
  } else if (found.gap.avg === null && found.gap.min === null && found.gap.max === null) {
    pass(
      'ช่วงออฟไลน์กลายเป็นช่องว่าง',
      `${found.id} ${new Date(found.gap.timestamp).toISOString()} → avg/min/max เป็น null ไม่ใช่ 0 · ชั่วโมงที่ข้อมูลไม่ครบ ${partialHours} ช่วง`,
    );
  } else {
    fail('ช่วงออฟไลน์กลายเป็นช่องว่าง', `avg=${found.gap.avg} min=${found.gap.min} max=${found.gap.max}`);
  }
}

/* 5b. bucket ปัจจุบันต้องเป็น partial */
{
  const thisHour = bucketStart(NOW, 'hour', TZ);
  const points = series('flow_lpm', 'gauge', thisHour, thisHour + MS.hour, 'hour');
  if (points[0]?.isPartial === true) pass('bucket ปัจจุบันเป็น partial', new Date(thisHour).toISOString());
  else fail('bucket ปัจจุบันเป็น partial', `isPartial = ${points[0]?.isPartial}`);
}

/* 6. StateSpan ต่อกันไม่มีรู */
{
  const from = dayStart;
  const to = dayStart + 6 * MS.hour;
  const spans = buildStateSpans({ sourceId: 'pump-1', from, to });
  const total = spans.reduce((a, s) => a + s.durationMs, 0);
  const contiguous = spans.every((s, i) => (i === 0 ? s.from === from : s.from === spans[i - 1].to));
  const clipped = spans[0]?.from === from && spans[spans.length - 1]?.to === to;
  if (total === to - from && contiguous && clipped) {
    pass('StateSpan ต่อเนื่องและตัดขอบถูก', `${spans.length} ช่วง รวม ${(total / MS.hour).toFixed(1)} ชม. พอดี`);
  } else {
    fail('StateSpan ต่อเนื่องและตัดขอบถูก', `รวม ${total} ควร ${to - from} · ต่อเนื่อง ${contiguous} · ตัดขอบ ${clipped}`);
  }
}

/* 7. ความเร็ว */
{
  const from = NOW - 730 * MS.day;
  const t0 = performance.now();
  const months = series('energy_kwh', 'counter', from, NOW, 'month');
  const elapsed = performance.now() - t0;
  if (months.length >= 24 && elapsed < 1500) {
    pass('ความเร็ว 2 ปีรายเดือน', `${months.length} ช่วง ใน ${elapsed.toFixed(0)} ms`);
  } else {
    fail('ความเร็ว 2 ปีรายเดือน', `${months.length} ช่วง ใน ${elapsed.toFixed(0)} ms`);
  }
}

console.log(failed === 0 ? '\nข้อมูลกราฟสอดคล้องกันทุกระดับ\n' : `\nไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
