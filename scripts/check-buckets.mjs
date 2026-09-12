/**
 * ตรวจว่าการตัด bucket ตามเขตเวลาถูกต้องและไม่ขึ้นกับเขตเวลาของเครื่องที่รัน
 *
 * รันด้วย: npm run check:buckets
 * ★ ใช้ Node ล้วน + --experimental-strip-types ไม่ได้เพิ่ม test runner หรือ dependency ใด ๆ
 *
 * สิ่งที่ตรวจ
 *   1. ขอบวัน/เดือน/ปี ตัดตามเวลาไทย ไม่ใช่ UTC
 *   2. สัปดาห์เริ่มวันจันทร์
 *   3. รันด้วย TZ ต่างกัน ต้องได้ timestamp ชุดเดียวกันเป๊ะ
 *   4. กติกาจับคู่ช่วง ↔ ความละเอียด ตรงกับตารางในสเปก
 *   5. bucketStarts คืนครบทุกช่วงรวมช่วงที่ไม่มีข้อมูล
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TZ = 'Asia/Bangkok';

let failed = 0;
const pass = (name, msg) => console.log(`  [PASS] ${name}  ${msg}`);
const fail = (name, msg) => {
  failed += 1;
  console.log(`  [FAIL] ${name}  ${msg}`);
};

const mod = await import(join(ROOT, 'lib/utils/time-buckets.ts'));
const { bucketStart, bucketStarts, nextBucketStart, granularityOptions, preferredGranularity, coerceGranularity, MS } =
  mod;

const iso = (ms) => new Date(ms).toISOString();
const inBangkok = (ms) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(ms));

/* 1. ขอบช่วงตามเวลาไทย */
{
  // 2026-09-11 22:30 เวลาไทย (= 15:30Z) — ถ้าตัดด้วย UTC จะได้วันที่ 11 ตอน 00:00Z ซึ่งผิด
  const t = Date.parse('2026-09-11T15:30:00Z');
  const cases = [
    ['day', '11/09/2026, 00:00'],
    ['hour', '11/09/2026, 22:00'],
    ['month', '01/09/2026, 00:00'],
    ['year', '01/01/2026, 00:00'],
    ['minute_15', '11/09/2026, 22:30'],
    ['minute_5', '11/09/2026, 22:30'],
  ];
  const bad = cases.filter(([g, want]) => inBangkok(bucketStart(t, g, TZ)) !== want);
  if (bad.length === 0) pass('ขอบช่วงตามเวลาไทย', `ถูกทั้ง ${cases.length} ระดับ`);
  else
    fail(
      'ขอบช่วงตามเวลาไทย',
      bad.map(([g, want]) => `${g}: ได้ ${inBangkok(bucketStart(t, g, TZ))} ควรเป็น ${want}`).join(' · '),
    );
}

/* 2. สัปดาห์เริ่มวันจันทร์ */
{
  // 11 ก.ย. 2026 เป็นวันศุกร์ → ต้นสัปดาห์คือจันทร์ที่ 7 ก.ย.
  const t = Date.parse('2026-09-11T15:30:00Z');
  const got = inBangkok(bucketStart(t, 'week', TZ));
  if (got === '07/09/2026, 00:00') pass('สัปดาห์เริ่มวันจันทร์', got);
  else fail('สัปดาห์เริ่มวันจันทร์', `ได้ ${got} ควรเป็น 07/09/2026, 00:00`);

  // วันอาทิตย์ต้องนับเป็นสัปดาห์ก่อนหน้า ไม่ใช่เริ่มสัปดาห์ใหม่
  const sunday = Date.parse('2026-09-13T05:00:00Z'); // อาทิตย์ 13 ก.ย. 12:00 ไทย
  const gotSunday = inBangkok(bucketStart(sunday, 'week', TZ));
  if (gotSunday === '07/09/2026, 00:00') pass('วันอาทิตย์อยู่สัปดาห์เดิม', gotSunday);
  else fail('วันอาทิตย์อยู่สัปดาห์เดิม', `ได้ ${gotSunday} ควรเป็น 07/09/2026, 00:00`);
}

/* 3. ผลไม่ขึ้นกับเขตเวลาของเครื่องที่รัน */
{
  const probe = `
    const m = await import(${JSON.stringify(join(ROOT, 'lib/utils/time-buckets.ts'))});
    const t = Date.parse('2026-09-11T15:30:00Z');
    const out = ['raw','minute_5','minute_15','hour','day','week','month','year']
      .map((g) => m.bucketStart(t, g, 'Asia/Bangkok')).join(',');
    process.stdout.write(out);
  `;
  const run = (tz) =>
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probe], {
      env: { ...process.env, TZ: tz },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  const bangkok = run('Asia/Bangkok');
  const others = { UTC: run('UTC'), 'America/New_York': run('America/New_York') };
  const mismatched = Object.entries(others).filter(([, value]) => value !== bangkok);
  if (mismatched.length === 0) pass('ไม่ขึ้นกับ TZ ของเครื่อง', 'UTC และ America/New_York ให้ผลตรงกับ Asia/Bangkok');
  else fail('ไม่ขึ้นกับ TZ ของเครื่อง', mismatched.map(([tz]) => `${tz} ให้ผลต่าง`).join(' · '));
}

/* 4. กติกาจับคู่ช่วง ↔ ความละเอียด */
{
  const now = Date.parse('2026-09-11T15:30:00Z');
  const cases = [
    [MS.hour, 'raw', ['raw', 'minute_5']],
    [24 * MS.hour, 'minute_15', ['minute_5', 'minute_15', 'hour']],
    [7 * MS.day, 'hour', ['minute_15', 'hour', 'day']],
    [31 * MS.day, 'day', ['hour', 'day', 'week']],
    [365 * MS.day, 'month', ['day', 'week', 'month']],
    [800 * MS.day, 'month', ['month', 'year']],
  ];
  const bad = [];
  for (const [span, wantPreferred, wantAllowed] of cases) {
    const from = now - span;
    if (preferredGranularity(from, now) !== wantPreferred) {
      bad.push(`ช่วง ${span / MS.day} วัน: ค่าเริ่มต้นได้ ${preferredGranularity(from, now)} ควรเป็น ${wantPreferred}`);
    }
    const enabled = granularityOptions(from, now).filter((o) => !o.disabled).map((o) => o.value);
    if (enabled.join(',') !== wantAllowed.join(',')) {
      bad.push(`ช่วง ${span / MS.day} วัน: เลือกได้ [${enabled}] ควรเป็น [${wantAllowed}]`);
    }
  }
  // เปลี่ยนช่วงแล้วความละเอียดเดิมใช้ไม่ได้ ต้องสลับให้เอง
  if (coerceGranularity('raw', now - 31 * MS.day, now) !== 'day') bad.push('coerceGranularity ไม่สลับค่าให้');
  if (coerceGranularity('day', now - 31 * MS.day, now) !== 'day') bad.push('coerceGranularity เปลี่ยนค่าที่ยังใช้ได้');
  if (bad.length === 0) pass('กติกาจับคู่ช่วง ↔ ความละเอียด', `ถูกทั้ง ${cases.length} ช่วง`);
  else fail('กติกาจับคู่ช่วง ↔ ความละเอียด', bad.join('\n         '));
}

/* 5. bucketStarts ครบทุกช่วง */
{
  const from = Date.parse('2026-09-10T17:00:00Z'); // 11 ก.ย. 00:00 ไทย
  const to = from + 3 * MS.day;
  const days = bucketStarts(from, to, 'day', TZ);
  const hours = bucketStarts(from, from + 12 * MS.hour, 'hour', TZ);
  const ok = days.length === 3 && hours.length === 12;
  // ทุกช่วงต้องต่อกันพอดี ไม่มีรูไม่ทับกัน
  const contiguous = days.every((start, i) => i === 0 || nextBucketStart(days[i - 1], 'day', TZ) === start);
  if (ok && contiguous) pass('bucketStarts ครบและต่อเนื่อง', `3 วัน = ${days.length} ช่วง · 12 ชม. = ${hours.length} ช่วง`);
  else fail('bucketStarts ครบและต่อเนื่อง', `วัน ${days.length} (ควร 3) · ชั่วโมง ${hours.length} (ควร 12) · ต่อเนื่อง ${contiguous}`);
}

/* 6. เดือนที่มีจำนวนวันต่างกัน และรอยต่อปี */
{
  const feb = Date.parse('2028-02-15T05:00:00Z'); // ปีอธิกสุรทิน
  const febStart = bucketStart(feb, 'month', TZ);
  const marStart = nextBucketStart(febStart, 'month', TZ);
  const febDays = Math.round((marStart - febStart) / MS.day);
  const dec = Date.parse('2026-12-20T05:00:00Z');
  const decStart = bucketStart(dec, 'month', TZ);
  const janStart = nextBucketStart(decStart, 'month', TZ);
  const crossesYear = inBangkok(janStart).startsWith('01/01/2027');
  if (febDays === 29 && crossesYear) pass('เดือนยาวไม่เท่ากันและข้ามปี', `ก.พ. 2571 = ${febDays} วัน · ธ.ค. → ${inBangkok(janStart)}`);
  else fail('เดือนยาวไม่เท่ากันและข้ามปี', `ก.พ. ได้ ${febDays} วัน (ควร 29) · ข้ามปี ${crossesYear}`);
}

/* 7. ข้อความวันเวลาที่ผู้ใช้เห็น ต้องไม่ขึ้นกับ TZ ของเครื่องเช่นกัน */
{
  const probe = `
    const f = await import(${JSON.stringify(join(ROOT, 'lib/utils/format.ts'))});
    const t = Date.parse('2026-09-11T17:30:00Z'); // 12 ก.ย. 00:30 ตามเวลาไทย
    process.stdout.write([f.formatDateTimeTH(t, 'th'), f.formatDate(t, 'th'), f.formatTime(t, 'th')].join('|'));
  `;
  // format.ts import ค่าจริงจาก @/lib/config/timezone จึงต้องใช้ hook แปลง alias ให้ด้วย
  const run = (tz) =>
    execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--import',
        join(ROOT, 'scripts/alias-hook.mjs'),
        '--input-type=module',
        '-e',
        probe,
      ],
      { env: { ...process.env, TZ: tz }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  const bangkok = run('Asia/Bangkok');
  const others = { UTC: run('UTC'), 'America/New_York': run('America/New_York') };
  const mismatched = Object.entries(others).filter(([, value]) => value !== bangkok);
  // ต้องตัดเป็นวันที่ 12 ตามเวลาไทย ไม่ใช่วันที่ 11 ตาม UTC
  const isThaiDay = bangkok.includes('12 ก.ย.');
  if (mismatched.length === 0 && isThaiDay) pass('ข้อความวันเวลาไม่ขึ้นกับ TZ ของเครื่อง', bangkok.split('|')[0]);
  else fail('ข้อความวันเวลาไม่ขึ้นกับ TZ ของเครื่อง', mismatched.map(([tz]) => `${tz} ต่าง`).join(' · ') || `ได้ ${bangkok}`);
}

console.log(failed === 0 ? '\nตัดช่วงเวลาผ่านทุกข้อ\n' : `\nไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
