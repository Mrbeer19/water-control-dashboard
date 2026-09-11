/**
 * ตรวจสีทั้งระบบให้ตรงกับ CI ของ Kasetphand — docs/BRANDING_SPEC.md ข้อ 8 หมวด "สี"
 *
 * รันด้วย: npm run check:colors
 * ★ ใช้เฉพาะ API ของ Node ไม่ได้เพิ่ม dependency ใด ๆ ใน package.json
 *
 * ตรวจ 4 อย่าง
 *   1. hex ที่ hard-code ในโค้ด — ต้องเจอเฉพาะ lib/config/theme.ts
 *   2. class สีสำเร็จรูปของ Tailwind — ต้องไม่มีเลย
 *   3. whitelist: ทุกค่าสีใน globals.css ต้องอยู่ในบันไดสีของ theme.ts (คลาดได้ ±1 ต่อ channel)
 *   4. contrast ของคู่ข้อความ/พื้นที่สเปกกำหนดไว้ในข้อ 3.2–3.5
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let failed = 0;
const pass = (name, msg) => console.log(`  [PASS] ${name}  ${msg}`);
const fail = (name, msg) => {
  failed += 1;
  console.log(`  [FAIL] ${name}  ${msg}`);
};

/* ---------- เก็บไฟล์ซอร์ส ---------- */
function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}
const sources = [...walk('app'), ...walk('components'), ...walk('lib')];

/* ---------- 1. hex ที่ hard-code ---------- */
{
  const HEX = /#[0-9a-fA-F]{3,8}\b/g;
  const offenders = sources
    .filter((f) => f !== 'lib/config/theme.ts')
    .flatMap((f) =>
      (read(f).match(HEX) ?? []).map((hex) => `${f} → ${hex}`),
    );
  if (offenders.length === 0) pass('hex hard-code', 'เจอเฉพาะ lib/config/theme.ts');
  else fail('hex hard-code', `${offenders.length} จุด:\n         ${offenders.join('\n         ')}`);
}

/* ---------- 2. class สีสำเร็จรูปของ Tailwind ---------- */
{
  const STOCK =
    /\b(?:bg|text|border|fill|stroke|ring|from|to|via|divide|outline|accent|caret)-(?:red|green|yellow|amber|blue|sky|slate|gray|zinc|neutral|stone|emerald|orange|rose|indigo|violet|purple|fuchsia|pink|teal|cyan|lime)-[0-9]{2,3}\b/g;
  const offenders = sources.flatMap((f) =>
    (read(f).match(STOCK) ?? []).map((cls) => `${f} → ${cls}`),
  );
  if (offenders.length === 0) pass('class สีของ Tailwind', 'ไม่มีการใช้ palette สำเร็จรูป');
  else fail('class สีของ Tailwind', `${offenders.length} จุด:\n         ${offenders.join('\n         ')}`);
}

/* ---------- แปลงสี ---------- */
const toRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
const toHex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
function relLum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [relLum(toRgb(a)), relLum(toRgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* ---------- 3. whitelist ---------- */
{
  const theme = read('lib/config/theme.ts');
  const allowed = new Map();
  for (const m of theme.matchAll(/'(#[0-9A-Fa-f]{6})'/g)) allowed.set(m[1].toUpperCase(), true);
  // ขาวล้วนเป็นข้อยกเว้นเดียวของข้อ 3 และมีอยู่ใน theme.ts อยู่แล้ว
  const css = read('app/globals.css');
  const bad = [];
  let count = 0;
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    const [, name, raw] = m;
    let hex = null;
    const hsl = raw.trim().match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (hsl) hex = toHex(hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3])));
    else if (/^#[0-9a-fA-F]{6}$/.test(raw.trim())) hex = raw.trim().toUpperCase();
    if (hex === null) continue; // --radius, var(...) ฯลฯ
    count += 1;
    const near = [...allowed.keys()].some((ci) => {
      const [a, b] = [toRgb(hex), toRgb(ci)];
      return a.every((v, i) => Math.abs(v - b[i]) <= 1);
    });
    if (!near) bad.push(`--${name}: ${raw.trim()} → ${hex}`);
  }
  if (bad.length === 0) pass('whitelist สีใน globals.css', `ตรวจ ${count} ค่า อยู่ในบันไดสีทั้งหมด`);
  else fail('whitelist สีใน globals.css', `${bad.length} ค่าไม่อยู่ในบันไดสี:\n         ${bad.join('\n         ')}`);
}

/* ---------- 4. contrast ตามข้อ 3.2–3.5 ---------- */
{
  // [ข้อความ, พื้น, เกณฑ์ขั้นต่ำ, คำอธิบาย]
  const PAIRS = [
    ['#515558', '#F7F7F7', 4.5, 'ข้อความหลักบนพื้นหน้า (light)'],
    ['#515558', '#FFFFFF', 4.5, 'ข้อความหลักบนการ์ด (light)'],
    ['#6D6C71', '#FFFFFF', 4.5, 'ข้อความรองบนการ์ด (light)'],
    ['#F7F7F7', '#202123', 4.5, 'ข้อความหลักบนพื้นหน้า (dark)'],
    ['#F7F7F7', '#36383A', 4.5, 'ข้อความหลักบนการ์ด (dark)'],
    ['#CBC7C8', '#36383A', 4.5, 'ข้อความรองบนการ์ด (dark)'],
    ['#FFFFFF', '#BC5242', 4.5, 'พื้นแบรนด์สำหรับตัวอักษรเล็ก (ข้อ 3.5)'],
    ['#BC5242', '#FFFFFF', 4.5, 'ลิงก์แบรนด์บนการ์ด (light)'],
    ['#F5856D', '#36383A', 4.5, 'ลิงก์แบรนด์บนการ์ด (dark)'],
    ['#026BB5', '#FFFFFF', 4.5, 'info บนการ์ด (light)'],
    ['#A5AECF', '#36383A', 4.5, 'info บนการ์ด (dark)'],
    ['#526E57', '#FFFFFF', 4.5, 'สถานะปกติ (light) — ข้อ 3.4'],
    ['#625B4B', '#FDD8A3', 4.5, 'สถานะเตือน บนพื้น pill (light) — ข้อ 3.4'],
    ['#FFFFFF', '#BC5242', 4.5, 'สถานะวิกฤต พื้นเต็ม (light) — ข้อ 3.4'],
    ['#6D6C71', '#FFFFFF', 4.5, 'สถานะ offline (light) — ข้อ 3.4'],
    ['#7BB481', '#36383A', 4.5, 'สถานะปกติ (dark)'],
    ['#F7B94C', '#36383A', 4.5, 'สถานะเตือน (dark)'],
    ['#F5856D', '#36383A', 4.5, 'สถานะวิกฤต (dark)'],
    ['#B4B0B1', '#36383A', 4.5, 'สถานะ offline (dark)'],
    ['#92584A', '#FFFFFF', 4.5, 'ข้อความ error ในฟอร์ม (light) — ข้อ 7'],
    ['#F5856D', '#36383A', 4.5, 'ข้อความ error ในฟอร์ม (dark)'],
    ['#F7F7F7', '#536281', 4.5, 'ชิป info-strong'],
    ['#FFFFFF', '#515558', 4.5, 'control-checked (light)'],
    ['#202123', '#F7F7F7', 4.5, 'control-checked (dark)'],
    ['#026BB5', '#FFFFFF', 3.0, 'ชุดข้อมูลที่ 1 บนพื้นกราฟ (light)'],
    ['#009148', '#FFFFFF', 3.0, 'ชุดข้อมูลที่ 2 บนพื้นกราฟ (light)'],
    ['#4E80BF', '#202123', 3.0, 'ชุดข้อมูลที่ 1 บนพื้นกราฟ (dark)'],
    ['#4CA062', '#202123', 3.0, 'ชุดข้อมูลที่ 2 บนพื้นกราฟ (dark)'],
    ['#6D6C71', '#202123', 3.0, 'ชุดอ้างอิงบนพื้นกราฟ (dark)'],
  ];
  const bad = PAIRS.filter(([fg, bg, min]) => contrast(fg, bg) < min);
  if (bad.length === 0) pass('contrast ตามข้อ 3.2–3.5', `ผ่านครบ ${PAIRS.length} คู่`);
  else
    fail(
      'contrast ตามข้อ 3.2–3.5',
      `${bad.length} คู่ไม่ผ่าน:\n         ` +
        bad
          .map(([fg, bg, min, why]) => `${why}: ${fg} บน ${bg} = ${contrast(fg, bg).toFixed(2)} (ต้อง ≥ ${min})`)
          .join('\n         '),
    );

  // ข้อยกเว้นที่รับรู้แล้ว — ต้องยังอยู่ที่ค่าเดิม ถ้าเปลี่ยนแปลว่ามีคนขยับสีโดยไม่อัปเดตเอกสาร
  const known = contrast('#FFFFFF', '#E9242B');
  if (Math.abs(known - 4.42) < 0.02)
    pass('ข้อยกเว้นปุ่ม primary (ข้อ 3.5)', `ขาวบน Cinnabar-500 = ${known.toFixed(2)} : 1 ตามที่บันทึกไว้`);
  else fail('ข้อยกเว้นปุ่ม primary (ข้อ 3.5)', `ได้ ${known.toFixed(2)} : 1 แต่เอกสารบันทึกไว้ 4.42`);
}

/* ---------- 5. กฎ opacity ตามข้อ 3 ---------- */
{
  // ห้าม: พื้น/ขอบของสถานะ · สีที่ใช้แยกชุดข้อมูลในกราฟ · สีข้อความ
  const FORBIDDEN = [
    [/\b(?:bg|border|fill|stroke|ring)-status-(?:ok|warning|critical|offline)(?:-[a-z]+)?\/[0-9]{1,3}\b/g, 'พื้น/ขอบของสถานะ'],
    [/\b(?:bg|border|fill|stroke|ring)-water(?:-soft)?\/[0-9]{1,3}\b/g, 'สีชุดข้อมูลในกราฟ'],
    [/\btext-[a-z][a-z0-9-]*\/[0-9]{1,3}\b/g, 'สีข้อความ'],
  ];
  /*
   * ยอดค้างที่ยังไม่ได้แก้ แยกตามเฟสที่รับผิดชอบ (docs/DESIGN_PLAN.md ข้อ 6)
   * ★ ตัวเลขนี้ต้องลดลงเรื่อย ๆ จนเป็น 0 ตอน Phase 7.8b — ห้ามเพิ่ม
   *   ถ้าไฟล์ไหนเกินยอดค้าง หรือมีไฟล์ใหม่โผล่มา จะถือว่าไม่ผ่านทันที
   */
  const PENDING = {
  };
  const found = {};
  const detail = [];
  for (const f of sources) {
    const body = read(f);
    for (const [re, why] of FORBIDDEN) {
      for (const hit of body.match(re) ?? []) {
        found[f] = (found[f] ?? 0) + 1;
        detail.push(`${f} → ${hit} (${why})`);
      }
    }
  }
  const over = Object.entries(found).filter(([f, n]) => n > (PENDING[f] ?? 0));
  const left = Object.values(found).reduce((a, b) => a + b, 0);
  if (over.length === 0) {
    const done = Object.entries(PENDING).filter(([f]) => (found[f] ?? 0) < PENDING[f]);
    pass(
      'กฎ opacity (ข้อ 3)',
      left === 0
        ? 'ไม่มี opacity ที่สถานะ ชุดข้อมูล หรือข้อความ'
        : `ไม่มีจุดใหม่ · ค้างตามแผน ${left} จุด รอเฟสถัดไป` +
          (done.length ? ` · แก้ไปแล้วเกินแผนใน ${done.length} ไฟล์ (อัปเดต PENDING ได้)` : ''),
    );
  } else {
    fail(
      'กฎ opacity (ข้อ 3)',
      `มีจุดเกินยอดค้างที่วางแผนไว้:\n         ` +
        over.map(([f, n]) => `${f} เจอ ${n} แต่แผนไว้ ${PENDING[f] ?? 0}`).join('\n         ') +
        `\n       รายการทั้งหมด:\n         ${detail.join('\n         ')}`,
    );
  }
}

/* ---------- 6. ชื่อ token สีที่ใช้จริงต้องมีอยู่จริง ---------- */
{
  /*
   * ★ กันคลาสพิมพ์เพี้ยน เช่น "text-infary" หรือ "bg-status-oky" ที่ Tailwind ไม่รู้จัก
   *   แล้วเงียบ ๆ ไม่ให้สีอะไรเลย — เคยเกิดจริงตอนแทนที่ด้วย sed ใน Phase 7.1
   */
  const KNOWN = new Set([
    'brand-text', 'brand-strong', 'brand-strong-foreground', 'form-error',
    'info', 'info-strong', 'info-strong-foreground',
    'control-checked', 'control-checked-foreground',
    'water', 'water-soft',
    'status-ok', 'status-ok-foreground', 'status-ok-dot',
    'status-warning', 'status-warning-foreground', 'status-warning-surface',
    'status-critical', 'status-critical-foreground',
    'status-offline', 'status-offline-foreground', 'status-offline-dot',
  ]);
  const TOKEN = /\b(?:bg|text|border|fill|stroke|ring|accent|divide|outline|caret|shadow)-((?:brand|info|water|control-checked|form-error|status)[a-z0-9-]*)/g;
  const bad = [];
  for (const f of sources) {
    for (const m of read(f).matchAll(TOKEN)) {
      const name = m[1].replace(/\/[0-9]{1,3}$/, '');
      if (!KNOWN.has(name)) bad.push(`${f} → ${m[0]}`);
    }
  }
  if (bad.length === 0) pass('ชื่อ token สี', `ใช้ชื่อที่ประกาศไว้ทั้งหมด (${KNOWN.size} ชื่อ)`);
  else fail('ชื่อ token สี', `ไม่มีชื่อนี้ใน tailwind.config.ts:\n         ${[...new Set(bad)].join('\n         ')}`);
}

/* ---------- 7. Cinnabar-500 ใช้เป็นพื้นได้เฉพาะปุ่มขนาด lg ---------- */
{
  /*
   * ข้อ 3.5: ตัวอักษรบนพื้น Cinnabar-500 (`bg-primary`) ต้อง ≥ 16px / weight 600
   * ที่เดียวที่การันตีขนาดนั้นได้คือ compoundVariant ของปุ่มขนาด lg
   * ที่อื่นให้ใช้ `bg-brand-strong` (Cinnabar-700) ซึ่งผ่าน 4.8:1 ทุกขนาด
   */
  const ALLOWED = 'components/ui/button.tsx';
  const offenders = sources
    .filter((f) => f !== ALLOWED)
    .flatMap((f) => ((read(f).match(/\bbg-primary\b(?!\/)/g) ?? []).map(() => f)));
  if (offenders.length === 0) pass('พื้น Cinnabar-500 (ข้อ 3.5)', `ใช้เฉพาะใน ${ALLOWED}`);
  else fail('พื้น Cinnabar-500 (ข้อ 3.5)', `ใช้นอกปุ่มขนาด lg — ตัวอักษรอาจเล็กกว่า 16px:\n         ${[...new Set(offenders)].join('\n         ')}`);
}

console.log(failed === 0 ? '\nสีผ่านทุกข้อ\n' : `\nไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
