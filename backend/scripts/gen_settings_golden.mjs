/**
 * ค่าอ้างอิงของ validateSettings() ตัวจริงใน lib/services/settings.ts ให้ tests/test_settings_parity.py เทียบ
 *
 * รัน: make settings-golden   (Node 22 ใน container · เขียน tests/fixtures/settings_golden.json)
 * ★ PROMPT_04 งานที่ 4: เซิร์ฟเวอร์ต้องใช้กฎชุดเดียวกับหน้าจอ — แก้ settings.ts เมื่อไหร่ต้องรันใหม่แล้วให้ parity ผ่าน
 * ★ settings.ts import แบบไม่มีนามสกุล ('./internal') ซึ่ง Node ESM ไม่รู้จัก จึงมี resolve hook ของตัวเอง
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function withExtension(base) {
  return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base].find((c) => existsSync(c) && statSync(c).isFile());
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith('@/')) base = join(ROOT, specifier.slice(2));
    else if (/^\.\.?\//.test(specifier) && context.parentURL?.startsWith('file:')) {
      base = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    }
    const found = base === null ? undefined : withExtension(base);
    return found ? { url: pathToFileURL(found).href, shortCircuit: true } : nextResolve(specifier, context);
  },
});

const { validateSettings } = await import(join(ROOT, 'lib/services/settings.ts'));
const mock = await import(join(ROOT, 'lib/mock/index.ts'));

const base = () => ({
  ...structuredClone(mock.DEFAULT_SETTINGS),
  tanks: mock.defaultTankConfigs(),
  pumps: mock.defaultPumpConfigs(),
  zones: mock.defaultZoneConfigs(),
  environment: mock.defaultEnvironmentConfigs(),
  line: mock.defaultLineSettings(),
});

const cases = [
  ['ค่าตั้งต้นผ่านทุกข้อ', () => {}],
  ['ไม่มีหมวดรายอุปกรณ์และ LINE', (s) => { for (const k of ['tanks', 'pumps', 'zones', 'environment', 'line']) delete s[k]; }],
  ['ชื่อโรงงานว่างและรีเฟรชถี่เกิน', (s) => { s.general.siteName = '   '; s.general.refreshIntervalMs = 499; }],
  ['รีเฟรช 500 ms พอดีผ่าน', (s) => { s.general.refreshIntervalMs = 500; }],
  ['ถังผิดทุกช่อง', (s) => {
    Object.assign(s.tanks[0], { capacityLiters: 0, pumpAutoStartPercent: 60, pumpAutoStopPercent: 60, sensorScale: -1 });
  }],
  ['ปั๊มผิดทุกช่อง', (s) => { Object.assign(s.pumps[1], { nameplateKw: 0, overcurrentAmp: -2, maxRunMinutes: -1 }); }],
  ['ปั๊มเดินไม่จำกัดเวลาผ่าน', (s) => { s.pumps[0].maxRunMinutes = 0; }],
  ['โซน kFactor 0 และโควตาติดลบ', (s) => { Object.assign(s.zones[2], { kFactor: 0, monthlyQuotaCubicMeters: -5 }); }],
  ['โซนไม่จำกัดโควตาผ่าน', (s) => { s.zones[0].monthlyQuotaCubicMeters = null; }],
  ['ไม่มีขั้นอัตรา', (s) => { s.billing.tiers = []; }],
  ['ขั้นอัตราติดลบ ขอบกลับด้าน และเว้นช่อง', (s) => {
    s.billing.tiers[0].ratePerCubicMeter = -1;
    s.billing.tiers[1].maxCubicMeters = 30;
    s.billing.tiers[2].minCubicMeters = 51;
  }],
  ['ขั้นกลางไม่จำกัดขอบบน', (s) => { s.billing.tiers[1].maxCubicMeters = null; }],
  ['VAT และวันรอบบิลนอกช่วง', (s) => {
    s.billing.vatPercent = 101; s.billing.billingCycleStartDay = 29; s.billing.meterReadingDay = 0;
  }],
  ['ขอบช่วงที่ยังผ่าน', (s) => {
    s.billing.vatPercent = 0; s.billing.billingCycleStartDay = 28; s.billing.meterReadingDay = 1;
    s.ai.anomalySensitivity = 1; s.network.mqttPort = 65535; s.network.plcPort = 1;
  }],
  ['ความไว AI เกิน 1', (s) => { s.ai.anomalySensitivity = 1.01; }],
  ['เครือข่ายผิด', (s) => { s.network.mqttHost = 'bad host!'; s.network.mqttPort = 0; s.network.plcPort = 65536; }],
  ['host ขึ้นต้นด้วยขีด', (s) => { s.network.mqttHost = '-gateway.local'; }],
  ['host ว่าง', (s) => { s.network.mqttHost = '  '; }],
  ['host ชื่อเครื่องผ่าน', (s) => { s.network.mqttHost = ' gateway-01.plant.local '; }],
  ['เซนเซอร์ผิด', (s) => { s.environment[0].locationLabel = ' '; s.environment[2].rainGaugeMmPerTip = 0; }],
  ['LINE เปิดแต่ตั้งผิดทุกข้อ', (s) => {
    for (const group of s.line.groups) group.active = false;
    s.line.groups[0].groupId = 'U1234';
    s.line.debounceSeconds = -1;
    s.line.severityRouting.warning = ['missing-group', 'another-missing'];
  }],
  ['LINE group id ตัวพิมพ์ใหญ่ผ่าน', (s) => { s.line.groups[0].groupId = 'CD41F9A2B6E7C8901234567890ABCDEF1'; }],
  ['LINE ปิดอยู่ไม่ตรวจ', (s) => { s.line.enabled = false; s.line.groups[0].groupId = 'bad'; }],
];

const golden = cases.map(([name, mutate]) => {
  const settings = base();
  mutate(settings);
  return { name, settings, errors: validateSettings(settings) };
});
// ★ ออกหลังเขียน stdout เสร็จเท่านั้น — stdout ที่ต่อ pipe เขียนแบบ async ถ้า exit ทันทีไฟล์จะขาดกลางทาง
process.stdout.write(`${JSON.stringify(golden, null, 1)}\n`, () => process.exit(0));
