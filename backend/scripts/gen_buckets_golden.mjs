/**
 * สร้างค่าอ้างอิงจาก lib/utils/time-buckets.ts ตัวจริง ให้ tests/test_buckets_parity.py เทียบ
 *
 * รัน: node backend/scripts/gen_buckets_golden.mjs   (จาก root ของ repo หลัง npm ci)
 * ★ แปลง .ts ด้วย typescript ที่มีอยู่ใน node_modules แล้ว ไม่ต้องใช้ --experimental-strip-types
 * ★ แก้ time-buckets.ts เมื่อไหร่ต้องรันใหม่ แล้วให้ parity test ผ่านก่อน push
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ts = createRequire(join(ROOT, 'package.json'))('typescript');

const source = readFileSync(join(ROOT, 'lib/utils/time-buckets.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const compiled = join(mkdtempSync(join(tmpdir(), 'time-buckets-')), 'time-buckets.mjs');
writeFileSync(compiled, outputText);
const m = await import(pathToFileURL(compiled).href);

const GRANULARITIES = ['raw', 'minute_5', 'minute_15', 'hour', 'day', 'week', 'month', 'year'];
const ZONES = ['Asia/Bangkok', 'Asia/Kathmandu', 'America/New_York'];

// จุดยาก: เที่ยงคืน · วันอาทิตย์ · ข้ามปี · ปีอธิกสุรทิน · ช่วง DST ของนิวยอร์ก + สุ่มแบบคงที่
const stamps = [
  '2026-09-11T15:30:00Z', '2026-09-13T05:00:00Z', '2026-09-13T16:59:59.999Z', '2026-09-13T17:00:00Z',
  '2028-02-29T10:00:00Z', '2026-12-31T16:59:59Z', '2026-12-31T17:00:00Z', '2027-01-03T20:00:00Z',
  '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z',
].map((s) => Date.parse(s));
let seed = 20260913;
for (let i = 0; i < 60; i += 1) {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  stamps.push(Date.parse('2025-01-01T00:00:00Z') + Math.floor((seed / 2147483648) * 4 * 365 * m.MS.day) + (i % 7) * 137);
}

const cases = [];
for (const zone of ZONES) {
  for (const ts of stamps) {
    for (const g of GRANULARITIES) {
      const start = m.bucketStart(ts, g, zone);
      cases.push({
        zone, ts, g, start,
        next: m.nextBucketStart(start, g, zone),
        expected: m.expectedSamples(start, g, zone, 2000),
        partial: m.isPartialBucket(start, g, zone, ts),
      });
    }
  }
}

const anchor = Date.parse('2026-09-11T15:30:00Z');
const spans = [30 * m.MS.minute, m.MS.hour, m.MS.hour + 1, 6 * m.MS.hour, 24 * m.MS.hour, 24 * m.MS.hour + 1,
  3 * m.MS.day, 7 * m.MS.day, 7 * m.MS.day + 1, 20 * m.MS.day, 31 * m.MS.day, 31 * m.MS.day + 1, 200 * m.MS.day,
  366 * m.MS.day, 366 * m.MS.day + 1, 800 * m.MS.day, 0];
const ranges = spans.map((span) => ({
  from: anchor - span,
  to: anchor,
  preferred: m.preferredGranularity(anchor - span, anchor),
  options: m.granularityOptions(anchor - span, anchor),
  coerced: Object.fromEntries(GRANULARITIES.map((g) => [g, m.coerceGranularity(g, anchor - span, anchor)])),
}));

const startsCases = [
  ['2026-09-10T17:00:00Z', 3 * m.MS.day, 'day'], ['2026-09-10T17:00:00Z', 12 * m.MS.hour, 'hour'],
  ['2026-07-01T00:00:00Z', 60 * m.MS.day, 'week'], ['2025-08-15T03:00:00Z', 400 * m.MS.day, 'month'],
  ['2026-09-11T15:31:00Z', 24 * m.MS.hour, 'minute_15'], ['2024-09-11T15:31:00Z', 800 * m.MS.day, 'year'],
  ['2026-09-11T15:31:07Z', m.MS.hour, 'minute_5'], ['2026-09-11T15:31:07Z', 10 * m.MS.minute, 'raw'],
].flatMap(([from, span, g]) => ZONES.map((zone) => {
  const f = Date.parse(from);
  return { zone, from: f, to: f + span, g, starts: m.bucketStarts(f, f + span, g, zone) };
}));

const golden = { generatedFrom: 'lib/utils/time-buckets.ts', maxPoints: m.MAX_POINTS_PER_SERIES, cases, ranges, starts: startsCases };
const target = join(HERE, '..', 'tests', 'fixtures', 'buckets_golden.json');
writeFileSync(target, `${JSON.stringify(golden)}\n`);
console.log(`เขียน ${cases.length} กรณี · ${ranges.length} ช่วง · ${startsCases.length} ชุด → ${target}`);
