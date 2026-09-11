# CHART_EXPLORER_PLAN.md — ผลสำรวจและสัญญาข้อมูลของ Phase 7.0

> ผลของ **Phase 7.0** ใน `PROMPTS.md` (ชุด chart explorer) — **เอกสารอย่างเดียว ยังไม่เขียนโค้ด**
> จัดทำ 2026-09-11

---

## 1. ของที่มีอยู่จริงตอนนี้

### 1.1 modal ขยายกราฟ

**มีอยู่แล้ว 1 ตัว** คือ `components/charts/chart-detail.tsx` (สร้างเมื่อ 2026-09-11)
→ **ต่อยอดจากตัวนี้ ห้ามสร้าง modal ใหม่ซ้ำ** ตามที่สเปกสั่ง

ใช้อยู่ใน 9 จุด (ครอบกราฟไว้ทั้งหมดแล้ว):

| ไฟล์ | ชนิดที่ใช้อยู่ |
|---|---|
| `components/charts/sparkline.tsx` | เวลา — ครอบ sparkline ทุกตัวในแอปพร้อมกัน |
| `components/billing/daily-usage-chart.tsx` | เวลา (โหลดย้อนหลัง 400 วันตอนกด) |
| `components/reports/monthly-chart.tsx` | เวลา (บังคับ month/year) |
| `components/environment/temp-vs-usage-chart.tsx` | เวลา |
| `components/ai/forecast-section.tsx` | เวลา |
| `components/ai/anomaly-timeline.tsx` | เวลา |
| `components/ai/anomaly-evidence-chart.tsx` | เวลา |
| `components/reports/zone-usage-chart.tsx` | หมวดหมู่ |
| `components/billing/zone-cost-chart.tsx` | หมวดหมู่ |

### 1.2 ฟังก์ชัน history ใน `lib/services/`

ทุกตัวหน้าตาเหมือนกันหมด — รับ `id` + `metric` แล้วคืน `TimeSeriesPoint[]` ทั้งชุด
**ไม่มีพารามิเตอร์ from / to / interval เลยสักตัว** ทั้งที่ `HANDOFF.md` ประกาศ endpoint ไว้แล้วว่ามี

| service | ฟังก์ชัน | metric เริ่มต้น |
|---|---|---|
| `pumps.ts` | `getPumpHistory(id, metric)` | `power_watt` |
| `tanks.ts` | `getTankHistory(id, metric)` | `level_percent` |
| `zones.ts` | `getZoneHistory(id, metric)` | `flow_lpm` |
| `meters.ts` | `getMeterHistory(id, metric)` | `flow_lpm` |
| `environment.ts` | `getEnvironmentHistory(id, metric)` | `temperature` |
| `devices.ts` | `getDeviceHistory(id, metric)` | `rssi_dbm` |
| `electric.ts` | `getElectricHistory(id, metric)` | `power_watt` |
| `pressure.ts` | `getPressureHistory(metric)` | `pressure_bar` |
| `meters.ts` | `getDailyUsage(projection, historyDays)` | — (รายวันสำเร็จรูป ย้อนได้ถึง 400 วัน) |

ทั้ง 8 ตัวแรกเรียก `readHistory(entityId, metric)` ใน `lib/mock/store.ts` ตัวเดียวกันหมด

### 1.3 `TimeSeriesPoint` และ endpoint ที่ประกาศไว้

```ts
export interface TimeSeriesPoint {
  timestamp: EpochMs;
  value: number;
  imputed?: boolean;   // true = ระบบเติมแทนช่วงที่เซนเซอร์ขาด
}
```

`HANDOFF.md` ประกาศ endpoint ไว้ 8 เส้นในรูปแบบเดียวกัน:
`GET /api/<กลุ่ม>/:id/history?metric=&from=&to=&interval=` → `TimeSeriesPoint[]`

**พารามิเตอร์ `interval` มีอยู่ในเอกสารแล้ว แต่ยังไม่มีใครส่งและ mock ยังไม่รับ**

### 1.4 ★ ปัญหาใหญ่ที่สุด: mock เก็บย้อนหลังได้แค่ 40 นาที

```
lib/mock/store.ts:78   const HISTORY_LIMIT = 1_200;
lib/mock/store.ts:46   export const TICK_MS = 2_000;
```

**1,200 จุด × 2 วินาที = 2,400 วินาที = 40 นาที** และ **ไม่มีการ seed ย้อนหลังตอนเริ่มต้นเลย**
ข้อมูลเริ่มสะสมตอนเปิดหน้าเว็บ ปิดแท็บแล้วหายหมด

นี่คือคำอธิบายของอาการ *"เลือก 12 ชม. แต่ได้แค่ 2 แท่ง (21:00, 22:00)"* ที่สเปกระบุ —
ไม่ใช่บั๊กของการรวมข้อมูล แต่เป็นเพราะ**ข้อมูลมีอยู่จริงแค่ 40 นาที ซึ่งคาบเกี่ยว 2 ชั่วโมงบนนาฬิกา**

ข้อยกเว้นเดียวคือ `buildDailyUsage()` ที่สร้างข้อมูล**รายวัน**ย้อนหลังได้ถึง 400 วันแบบ deterministic
แต่มีเฉพาะ "ยอดใช้น้ำรวมรายวัน" เท่านั้น ไม่มี metric อื่น

---

## 2. Inventory ทุก metric ที่มีกราฟ

ชนิดค่าอ้างอิงตาราง 5 แบบในข้อ 7.1 ของสเปก

| metric key | หน่วย | service ที่ให้ | ชนิด | มีใน mock? | หมายเหตุ |
|---|---|---|---|---|---|
| `level_percent` | % | `getTankHistory` | **level** | ✓ | ถัง 3 ใบ |
| `level_liters` | L | `getTankHistory` | **level** | ✓ | บ่อสำรองผ่าน `levelToVolumeTable` |
| `net_flow_lpm` | L/min | `getTankHistory` | gauge | ✓ | เข้า−ออกสุทธิ ติดลบได้ |
| `flow_lpm` | L/min | `getZoneHistory` / `getMeterHistory` / `getPumpHistory` | gauge | ✓ | ใช้ 3 กลุ่ม |
| `pressure_bar` | bar | `getPressureHistory` | gauge | ✓ | ลูป PID |
| `power_watt` | W | `getPumpHistory` / `getElectricHistory` | gauge | ✓ | |
| `current_amp` | A | `getPumpHistory` / `getElectricHistory` | gauge | ✓ | มีเกณฑ์ overcurrent ใน settings |
| `voltage_volt` | V | `getPumpHistory` | gauge | **✗** | **ไม่ได้เก็บ history** ทั้งที่การ์ดแสดงค่าอยู่ |
| `energy_kwh` | kWh | `getPumpHistory` / `getElectricHistory` | **counter** | **✗** | **ไม่ได้เก็บ history** |
| `vfd_frequency_hz` | Hz | `getPumpHistory` | gauge | ✓ | เฉพาะปั๊มที่มี VFD |
| `temperature` | °C | `getEnvironmentHistory` | gauge | ✓ | **ตัวที่สเปกยกเป็นตัวอย่างปัญหา** |
| `humidity` | %RH | `getEnvironmentHistory` | gauge | ✓ | |
| `heat_index` | °C | `getEnvironmentHistory` | gauge | ✓ | คำนวณจาก util เดิม |
| `rainfall` | mm | `getEnvironmentHistory` | **amount** | ✓ | จุดกลางแจ้งเท่านั้น |
| `pressure_hpa` | hPa | `getEnvironmentHistory` | gauge | ✓ | กลางแจ้งเท่านั้น |
| `illuminance_lux` | lux | `getEnvironmentHistory` | gauge | ✓ | กลางแจ้งเท่านั้น |
| `rssi_dbm` | dBm | `getDeviceHistory` | gauge | ✓ | |
| `uptime_seconds` | s | `getDeviceHistory` | **counter** | ✓ | รีเซ็ตเมื่ออุปกรณ์รีบูต |
| `free_heap_bytes` | bytes | `getDeviceHistory` | gauge | ✓ | |
| `main_inflow_lpm` | L/min | `getMeterHistory` | gauge | ✓ | ระดับระบบ |
| `zone_outflow_lpm` | L/min | — | gauge | ✓ | ระดับระบบ ยังไม่มี service เปิดให้เรียก |
| `unaccounted_percent` | % | — | gauge | **✗** | ประกาศใน type แล้วแต่ไม่ได้เก็บ |
| `headcount` | คน | — | gauge | ✓ | ใช้หารค่าน้ำต่อหัว |
| — (ยอดใช้น้ำรายวัน) | m³ | `getDailyUsage` | **counter** | ✓ 400 วัน | ไม่มี metric key ของตัวเอง |
| — (สถานะปั๊ม) | run/stop/fault | — | **state** | **✗** | ยังไม่มีที่เก็บประวัติสถานะเลย |
| — (online/offline) | — | — | **state** | **✗** | เหมือนกัน |

**สรุปช่องว่าง:** ต้องเพิ่มการเก็บ `voltage_volt`, `energy_kwh`, `unaccounted_percent`
และ**ต้องออกแบบที่เก็บประวัติ "สถานะ" (state) ใหม่ทั้งหมด** เพราะ `TimeSeriesPoint.value` เป็น `number`
เก็บ `'run' | 'stop' | 'fault'` ตรง ๆ ไม่ได้

---

## 3. รูปแบบข้อมูลที่รวมตามช่วงเวลาที่เสนอ

ตามข้อ 7.0 ของสเปก พร้อมเหตุผลกำกับ

```ts
/** หนึ่งช่วงเวลาที่รวมค่าแล้ว — ใช้กับทุก metric ทุกความละเอียด */
export interface AggregatedSeriesPoint {
  /** epoch ms ของ "ต้นช่วง" ตามข้อตกลงเดิมของจุดกราฟ */
  timestamp: EpochMs;

  /** สถิติที่ไม่มีความหมายกับ metric นั้นให้เป็น null ห้ามใช้ 0 แทน */
  avg: number | null;
  min: number | null;
  max: number | null;
  /** เวลาที่ค่าต่ำสุด/สูงสุดเกิดขึ้นจริงในช่วง — ใช้บอก "ร้อนสุดตอนบ่ายสาม" */
  minAt: EpochMs | null;
  maxAt: EpochMs | null;

  /** gauge/level = null · counter = last−first · amount = ผลบวก */
  sum: number | null;
  first: number | null;
  last: number | null;

  /** จำนวนตัวอย่างจริงที่ตกในช่วงนี้ */
  count: number;
  /** จำนวนที่ควรจะมีถ้าเซนเซอร์ส่งครบ — ใช้คิด % ความครบ */
  expectedCount: number;
  /** true = ช่วงนี้ยังไม่จบ (ชั่วโมง/วัน/เดือนปัจจุบัน) */
  isPartial: boolean;
}
```

**ทำไมต้องมี `minAt` / `maxAt`** — สเปกข้อ 7.1 บอกว่า gauge ต้องแสดง "เฉลี่ย / ต่ำสุด / สูงสุด + เวลาที่เกิด"
ถ้าไม่เก็บเวลาไว้ตอนรวม จะต้องยิงขอข้อมูลดิบซ้ำเพื่อหาว่าเกิดตอนไหน

**ทำไมต้องมีทั้ง `count` และ `expectedCount`** — เกณฑ์ตรวจรับข้อ "count/expectedCount < 80% → ติดป้ายข้อมูลไม่ครบ"
`expectedCount` คำนวณจาก (ความยาวช่วง ÷ คาบการส่งของ metric นั้น) ซึ่งฝั่งหน้าจอไม่รู้ ต้องให้ backend บอกมา

**ทำไม `sum` ต้องเป็น null ได้** — ป้องกันอาการที่สเปกยกมาเป็นตัวอย่าง คือการ์ดโชว์ "รวม 7,908.5" ของอุณหภูมิ
ถ้า field เป็น `number` เสมอ โค้ดฝั่ง UI จะเผลอหยิบไปแสดงได้ตลอด แต่ถ้าเป็น `null` มันจะหายไปเองตามชนิด metric

**กติกา counter ที่ค่าลดลงกลางช่วง** (ESP32 รีบูต, เปลี่ยนมิเตอร์) — คิดเป็นผลบวกของส่วนต่างที่เป็นบวกเท่านั้น
`sum = Σ max(0, v[i] − v[i−1])` ผลจึงไม่มีทางติดลบ และไม่กระโดดเป็นค่ามหาศาลตอนตัวนับกลับไปศูนย์

---

## 4. ★ จุดที่ต้องหยุดถาม — สัญญากับทีมหลังบ้าน

สเปกข้อ 7.0 สั่งให้หยุดถามถ้ากระทบสัญญา (RUNBOOK จุดหยุดข้อ 1 และ 5) โดยเสนออย่างน้อย 2 ทาง

### (ก) เพิ่ม optional field ใน `TimeSeriesPoint` แล้วใช้ endpoint `history` เดิม

```ts
export interface TimeSeriesPoint {
  timestamp: EpochMs;
  value: number;          // = avg สำหรับ gauge, = ค่ารวมของช่วงสำหรับ counter/amount
  imputed?: boolean;
  // ── เพิ่มใหม่ มีเฉพาะตอนขอแบบรวมช่วง ──
  min?: number; max?: number; minAt?: EpochMs; maxAt?: EpochMs;
  first?: number; last?: number;
  count?: number; expectedCount?: number; isPartial?: boolean;
}
```

- **ข้อดี** — ไม่เพิ่ม endpoint ใหม่ · ทุกจุดที่เรียก history อยู่แล้วใช้ได้ทันทีโดยไม่ต้องแก้ ·
  ทีมหลังบ้านทำงานเพิ่มน้อยที่สุด (เพิ่ม field ตอน `interval` ไม่ว่าง)
- **ข้อเสีย** — `value` มีความหมายไม่เหมือนกันตามชนิด metric ซึ่งเป็นบ่อเกิดของบั๊กแบบ "รวมอุณหภูมิ" อีก ·
  field ทั้งชุดเป็น optional ทำให้ TypeScript ช่วยจับพลาดไม่ได้ ·
  ปนข้อมูลดิบกับข้อมูลรวมไว้ใน type เดียว อ่านแล้วไม่รู้ว่ากำลังถือของแบบไหนอยู่

### (ข) type ใหม่ `AggregatedSeriesPoint` + endpoint ใหม่สำหรับข้อมูลรวม

```
GET /api/metrics/series?sourceType=&sourceId=&metric=&from=&to=&granularity=&compare=
→ { points: AggregatedSeriesPoint[], metric, unit, kind, granularity, expectedCountPerBucket }
```

- **ข้อดี** — แยกชัดระหว่าง "ข้อมูลดิบ" กับ "ข้อมูลรวม" · field ไม่ต้องเป็น optional
  TypeScript บังคับให้จัดการ null ตามชนิด metric · endpoint เดียวคุมทุกกลุ่ม
  ไม่ต้องไล่แก้ 8 เส้นให้พฤติกรรมตรงกัน · backend วาง rollup table ได้ตรงไปตรงมา
- **ข้อเสีย** — เพิ่ม endpoint ใหม่ 1 เส้นใน `HANDOFF.md` · endpoint `history` เดิมยังอยู่สำหรับข้อมูลดิบ
  ทีมหลังบ้านต้องทำ 2 ทาง

### สิ่งที่ผมแนะนำ: **(ข)**

เหตุผลหลักคืออาการที่สเปกยกมาเอง — "การ์ดสรุปแสดงรวม 7,908.5 ของอุณหภูมิ"
เกิดเพราะตอนนี้ทุก metric ถือข้อมูลหน้าตาเดียวกันหมด (`{timestamp, value}`) แล้ว UI เดาความหมายเอง
ทาง (ก) ยังทิ้งช่องให้เกิดซ้ำได้ ส่วนทาง (ข) ทำให้ "ไม่มี sum ให้หยิบ" ตั้งแต่ระดับ type

และสเปกข้อ 7.3 สั่งว่า *"ห้ามส่งข้อมูลดิบทั้งปีมาให้หน้าบ้านรวมเอง"* ซึ่งแปลว่าต้องมีทางเรียกข้อมูลรวมโดยตรงอยู่แล้ว

**ทั้งสองทางไม่ต้องแก้ field เดิมของ `TimeSeriesPoint` และไม่เปลี่ยน shape ที่ `history` เดิมคืน**

---

## 5. เรื่องที่ต้องตัดสินพร้อมกัน

1. **ประวัติ "สถานะ" (state)** — `TimeSeriesPoint.value` เป็น `number` เก็บ run/stop/fault ไม่ได้
   เสนอ: type แยก `StateSpanPoint { from, to, state, durationMs }` เพราะสถานะเป็น "ช่วงเวลา" ไม่ใช่ "จุด"
2. **ความลึกของ mock** — ต้องเขียน `lib/mock/history.ts` ใหม่ให้ seed ย้อนหลังแบบ deterministic
   (ดิบ 48 ชม. · 5 นาที 7 วัน · ชั่วโมง 90 วัน · วัน 2 ปี) ตามข้อ 7.3
   ของเดิมเก็บได้ 40 นาทีและหายเมื่อรีเฟรช
3. **3 metric ที่ยังไม่ได้เก็บ** — `voltage_volt`, `energy_kwh`, `unaccounted_percent`
4. **เขตเวลา** — สเปกสั่งตัดวัน/เดือน/ปีตาม Asia/Bangkok (+07:00)
   ตอนนี้โค้ดทั้งหมดใช้เวลาท้องถิ่นของเบราว์เซอร์ ถ้าเครื่องในห้องคอนโทรลตั้งเป็น +07:00 อยู่แล้วผลจะตรงกัน
   แต่ต้องบังคับให้ชัดในโค้ด ไม่ใช่ฝากความหวังไว้กับการตั้งค่าเครื่อง

---

## 6. บั๊กที่สเปกระบุ — ยืนยันในโค้ดแล้วทั้ง 6 ข้อ

| อาการที่สเปกระบุ | ยืนยันแล้วว่าเกิดจาก |
|---|---|
| การ์ดสรุปแสดง "รวม" ของอุณหภูมิ | `chart-detail.tsx` แสดง รวม/เฉลี่ย/สูงสุด เหมือนกันหมดทุก metric ไม่ได้ดูชนิดค่า |
| ใช้กราฟแท่งกับอุณหภูมิ | `chart-detail.tsx` ใช้ `<BarChart>` ตัวเดียวทุกกรณี |
| หัว modal เขียน "24 ชั่วโมงล่าสุด" แต่เลือก 12 ชม. | หัว modal เอามาจาก prop `label` ของ sparkline (`t.env.last24h`) ไม่ได้สร้างจาก state ที่เลือก |
| เลือก 12 ชม. ได้ 2 แท่ง | `HISTORY_LIMIT` 1,200 จุด × 2 วินาที = **40 นาที** และไม่มีการ seed ย้อนหลัง |
| แท่งไม่ครบชั่วโมงแสดงเหมือนแท่งปกติ | ยังไม่มีแนวคิด `isPartial` / `expectedCount` ในโค้ดเลย |
| "จำนวนจุดข้อมูล 227 ·" มีจุดคั่นค้างท้าย | `chart-detail.tsx` เขียน `· {unit}` ตายตัว พอ `unit` เป็นค่าว่างเลยเหลือจุดลอย |

ข้อ 1, 2, 3, 5, 6 แก้ได้ในชั้น component — ข้อ 4 แก้ไม่ได้ถ้าไม่รื้อชั้นข้อมูลก่อน
