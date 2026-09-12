# AI Contract — ระบบมอนิเตอร์และควบคุมการใช้น้ำ

สัญญาระหว่าง **ทีม AI** (เจ้าของตรรกะการตรวจจับและพยากรณ์) กับ **ทีม Frontend** (แสดงผลอย่างเดียว)

> แก้ type ฝั่ง AI เมื่อไหร่ ต้องอัปเดตไฟล์นี้ด้วยเสมอ

---

## หลักการ

1. **ทีม AI เป็นเจ้าของตรรกะทั้งหมด** ว่าจะตรวจอะไร ใช้โมเดลอะไร เกณฑ์เท่าไร
   Frontend ไม่มีสิทธิ์ตัดสินว่าอะไรผิดปกติ และต้องไม่คำนวณคะแนนเอง
2. **ชนิดความผิดปกติ (`type`) เป็น string เปิด** ทีม AI เพิ่มชนิดใหม่ได้ทันทีโดยไม่ต้องรอ frontend deploy
   Frontend มีตารางแปลชื่อ/ไอคอน/สีอยู่ที่ `lib/config/anomaly-types.ts` และ **ต้องมี fallback เสมอ**
3. **ผลที่ส่งมาไม่ครบถือว่าปกติ** มีเพียง `id`, `type`, `detectedAt` ที่บังคับ
   Frontend ต้อง render ได้โดยไม่ crash และต้องไม่เติมค่าปลอมแทนของที่ขาด
4. **ทางเข้าเดียวคือ `lib/services/ai.ts`** ห้าม component เรียกที่อื่น

---

## Endpoint

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/ai/anomalies` | `Paginated<AnomalyEvent>` |
| GET | `/api/ai/anomalies/:id` | `AnomalyEvent` |
| GET | `/api/ai/forecast` | `AIForecast` |
| GET | `/api/ai/maintenance` | `MaintenancePrediction[]` |
| GET | `/api/ai/status` | `AIServiceStatus` |
| POST | `/api/ai/anomalies/:id/feedback` | `AnomalyEvent` — body `{ feedback }` |
| POST | `/api/ai/anomalies/:id/status` | `AnomalyEvent` — body `{ status }` |

query ของ `/api/ai/anomalies`: `type` `status` `detector` `severity` `sourceType` `minScore` `from` `to` `limit` `offset`
query ของ `/api/ai/forecast`: `target` `targetId` `horizon`

---

## AnomalyEvent

```ts
{
  id: string            // บังคับ
  type: string          // บังคับ — string เปิด ห้ามทำเป็น enum ปิด
  detectedAt: string    // บังคับ — ISO 8601
  status: 'active' | 'resolved' | 'dismissed'   // บังคับ — ไม่ส่งมาให้ถือเป็น 'active'

  resolvedAt?: string | null
  evidence?: { timestamp: number; value: number }[]     // ค่าจริงช่วงที่เกิดเหตุ
  expectedBand?: {                                       // ช่วงที่โมเดลคาดไว้
    lower: { timestamp: number; value: number }[]
    upper: { timestamp: number; value: number }[]
  }
  suggestedAction?: string
  feedback?: 'confirmed' | 'false_positive' | null       // ผลตรวจจากหน้างาน

  detector?: string     // 'rule' | 'isolation_forest' | 'forecast_deviation' | อื่น ๆ
  score?: number        // 0–1  ★ ไม่ใช่ 0–100
  severity?: 'critical' | 'warning' | 'info'
  sourceType?: 'tank' | 'pump' | 'zone' | 'valve' | 'meter' | 'sensor'
             | 'device' | 'electric_node' | 'pressure_control' | 'system'
  sourceId?: string
  sourceName?: string
  metric?: string
  windowStart?: string | null
  windowEnd?: string | null
  features?: { key: string; value: number; expected?: number | null; contribution?: number }[]
  alertId?: string | null
  modelName?: string | null
  summaryTh?: string
  summaryEn?: string
  extra?: Record<string, string | number | boolean | null>
}
```

> **`sourceType` / `sourceId` ไม่ใช่ `targetType` / `targetId`**
> ใช้คู่ชื่อเดียวกับ `Alert` ทั้งระบบ เพื่อไม่ให้มีสองคู่ชื่อสำหรับเรื่องเดียวกัน

> **`score` อยู่ในสเกล 0–1 เสมอ**
> ถ้าโมเดลคิดเป็น 0–100 ให้หารก่อนส่ง ฝั่งหน้าบ้านแปลงเป็นเปอร์เซ็นต์ที่ชั้นแสดงผล
> ด้วย `formatAnomalyScore()` จุดเดียว

**พฤติกรรมของ Frontend เมื่อ field ขาด**

| ขาด | Frontend ทำอะไร |
|---|---|
| `type` ไม่รู้จัก | ใช้ `UNKNOWN_ANOMALY_TYPE` และแสดงรหัสดิบคู่กัน |
| `severity` | ใช้ `defaultSeverity` จากตารางของชนิดนั้น |
| `summaryTh` / `summaryEn` | ใช้คำอธิบายกลางของชนิดนั้นแทน |
| `score` | ไม่แสดงแถบคะแนน แต่ยังแสดงรายการ (`formatAnomalyScore()` คืน "—") |
| `evidence` | ไม่วาดกราฟประกอบ |
| `expectedBand` | วาดเฉพาะเส้นค่าจริง ไม่มีแถบเงา |
| `suggestedAction` | ซ่อนส่วน "ทำอะไรต่อ" |
| `features` | ซ่อนส่วน "ทำไมถึงถูกจับ" |
| `sourceName` | แสดง `sourceId` แทน |

**ตัวกรองต้องไม่ทิ้งข้อมูลเงียบ ๆ** — ผลที่ไม่ได้ระบุ `severity` หรือ `score` จะไม่ถูกกรองออกด้วยเงื่อนไขที่อ้างอิง field นั้น

---

## ชนิดที่ Frontend แปลได้แล้ว

`night_leak` · `continuous_flow` · `usage_spike` · `pump_degradation` · `pressure_deviation` · `power_anomaly` · `sensor_drift` · `unaccounted_water`

ชนิดอื่นแสดงได้ทันทีแบบไม่มีคำแปล — ถ้าต้องการชื่อไทย/ไอคอนเฉพาะ แจ้งทีม frontend เติมใน `lib/config/anomaly-types.ts`

---

## AIForecast

> ชื่อ type คือ **`AIForecast`** (ไม่ใช่ `Prediction`)

```ts
{
  id: string            // บังคับ
  target: string        // บังคับ — string เปิด เช่น 'tank_level' | 'zone_consumption'
                        //          | 'main_meter' | 'department_energy'
  generatedAt: string   // บังคับ

  targetId?: string | null
  targetName?: string
  metric?: string
  unit?: string
  horizonHours?: number
  horizon?: string      // '1h' | '6h' | '24h' | '7d' | 'month' — string เปิด
  history?: { timestamp: number; value: number }[]
  forecast?: { timestamp: number; value: number; lowerBound?: number; upperBound?: number }[]
  value?: number | null       // ผลพยากรณ์แบบจุดเดียว เช่น "ถังจะแตะระดับต่ำสุดที่เท่าไร"
  expectedAt?: string | null  // เวลาที่คาดว่าเหตุการณ์จะเกิด
  confidence?: number         // 0–1
  modelName?: string | null
  mapePercent?: number
  summaryTh?: string
  summaryEn?: string
}
```

ส่งมาแบบเส้น (`forecast`) หรือแบบจุดเดียว (`value` + `expectedAt`) หรือทั้งคู่ก็ได้

`timestamp` เป็น **epoch milliseconds** (ไม่ใช่ ISO string) เพื่อให้กราฟไม่ต้องแปลงซ้ำทุกจุด
ถ้าไม่มี `lowerBound`/`upperBound` frontend จะวาดเฉพาะเส้นกลางโดยไม่มีแถบความเชื่อมั่น

---

## MaintenancePrediction

> ชื่อ type คือ **`MaintenancePrediction`** (ไม่ใช่ `HealthScore`)
> คะแนนสุขภาพอยู่ใน field `healthScore` ของ type นี้

```ts
{
  id: string            // บังคับ
  targetType: string    // บังคับ — ชนิดอุปกรณ์
  targetId: string      // บังคับ
  generatedAt: string   // บังคับ

  targetName?: string
  failureProbability?: number     // 0–1
  daysUntilService?: number | null
  estimatedIssueDate?: string | null   // วันที่คาดว่าจะเกิดปัญหา
  healthScore?: number            // 0–100 ★ ยิ่งสูงยิ่งดี (กลับทางกับ AnomalyEvent.score)
  trend?: string                  // 'up' | 'down' | 'stable' — string เปิด
  features?: AnomalyFeature[]
  modelName?: string | null
  note?: string
  recommendationTh?: string
  recommendationEn?: string
}
```

## AIServiceStatus

> ชื่อ type คือ **`AIServiceStatus`** (ไม่ใช่ `AIStatus`)

```ts
{
  reachable: boolean        // บังคับ
  lastResultAt: string | null   // บังคับ
  models: string[]          // บังคับ
  message: string | null    // บังคับ

  mode?: string             // 'live' | 'training' | 'degraded' — string เปิด
  lastTrainedAt?: string | null
  trainingDays?: number
  accuracy?: number         // 0–1
  falsePositiveRate?: number // 0–1
  summaryText?: string      // สรุปหนึ่งบรรทัดสำหรับ widget หน้า Overview
}
```

---

## สิ่งที่หน้าต่างดูข้อมูลย้อนหลังต้องการจากทีม AI (Phase 7)

หน้าจอมีหน้าต่าง "ดูข้อมูลย้อนหลัง" ที่เปิดจากกราฟทุกใบ เลือกช่วงเวลาและความละเอียดได้
(รายละเอียดฝั่งหลังบ้านอยู่ใน `HANDOFF.md` ข้อ 2.11) — มีสองจุดที่ต่อกับทีม AI

### 1. หมุดความผิดปกติบนแกนเวลา

หน้าต่างนี้ปักหมุด `AnomalyEvent` ลงบนกราฟ เพื่อให้คนดูแยกออกว่า
"กราฟกระโดดเพราะมีคนสั่งงาน" หรือ "ผิดปกติจริง"

ฟิลด์ที่ **ต้องมี** ถ้าอยากให้หมุดขึ้นถูกกราฟถูกตำแหน่ง

| ฟิลด์ | ทำไมต้องมี |
|---|---|
| `detectedAt` | ตำแหน่งของหมุดบนแกนเวลา |
| `sourceId` | หน้าจอกรองด้วยฟิลด์นี้ — **ถ้าไม่ส่งมา หมุดจะไม่ขึ้นบนกราฟใดเลย** |
| `sourceType` | ใช้จับคู่กับชนิดอุปกรณ์ |
| `severity` | สีของหมุด (ยังคงมีไอคอนกำกับเสมอ ไม่ได้สื่อด้วยสีอย่างเดียว) |
| `windowStart` / `windowEnd` | ถ้าส่งมา หมุดจะกลายเป็น "ช่วง" แทน "จุด" ซึ่งอ่านง่ายกว่ามาก |
| `metric` | ใช้บอกว่าความผิดปกตินี้เกี่ยวกับค่าวัดตัวไหน |

ทุกฟิลด์ข้างบนเป็น optional ในสัญญาเดิมและยังเป็น optional ต่อไป
**หน้าจอ render ได้แม้ส่งมาไม่ครบ** แค่หมุดจะขึ้นน้อยลงตามข้อมูลที่มี

### 2. ★ ค่าที่ AI คำนวณเอง เมื่อต้องเอามาซ้อนบนกราฟ

สเปกกำหนดว่า **หน้าบ้านห้ามคำนวณค่าเชิงวิเคราะห์เอง** เช่น
ประสิทธิภาพปั๊ม (efficiency) หรือพลังงานจำเพาะ (kWh ต่อ m³)
ค่าพวกนี้ต้องมาจาก `AIMetric` เท่านั้น

**ปัญหาที่ยังไม่ได้ตกลงกัน:** `AIMetric.series` เป็น `TimeSeriesPoint[]` ซึ่งเป็น**จุดข้อมูลดิบ**
แต่หน้าต่างดูย้อนหลังทำงานที่ระดับ **bucket ตามความละเอียดที่ผู้ใช้เลือก**
(5 นาที / ชั่วโมง / วัน / เดือน / ปี)

ถ้าจะเอา `AIMetric.series` มาซ้อนบนกราฟที่ผู้ใช้เลือก "รายเดือน"
มีทางเลือกสองทาง — **ต้องเลือกทางใดทางหนึ่งก่อนเริ่มทำ**

| ทาง | ใครทำ | ผล |
|---|---|---|
| **(ก)** ทีม AI รับ `granularity` แล้วส่ง series ที่รวมมาแล้ว | AI | ตรงกับหลักการ "หน้าบ้านไม่คำนวณเอง" มากที่สุด |
| **(ข)** หน้าบ้านรวมเอง | Frontend | **ขัดกับสเปก** และหน้าบ้านไม่รู้ว่าค่านี้ควรรวมแบบเฉลี่ยหรือแบบบวก |

> **ข้อเสนอของหน้าบ้านคือทาง (ก)** โดยเพิ่มพารามิเตอร์ให้ `GET /api/ai/metrics`
> รับ `granularity` `from` `to` แบบเดียวกับ `/api/metrics/series`
> และเพิ่มฟิลด์บอกวิธีรวมลงใน `AIMetric` เช่น `aggregation: 'avg' | 'sum' | 'last'`
> เพื่อให้หน้าจอรู้ว่าจะสรุปช่วงยาว ๆ ยังไง
>
> **ยังไม่ได้แก้ `lib/types.ts` ให้** เพราะเป็นการเปลี่ยนสัญญากับทีม AI ต้องตกลงกันก่อน
> ระหว่างนี้หน้าต่างดูย้อนหลัง**ยังไม่ซ้อนเส้นของ AI** — แสดงเฉพาะค่าที่วัดจากเซนเซอร์

### 3. คำพยากรณ์ในมุมมองรายเดือน

มุมมองรายเดือนของการใช้น้ำจะแสดง `AIForecast` พร้อมแถบความเชื่อมั่น
ใช้ `forecast: ForecastPoint[]` ที่มีอยู่แล้ว — **ไม่ต้องเพิ่มฟิลด์ใหม่**
ขอแค่ `ForecastPoint.timestamp` ตกอยู่บนขอบ bucket รายเดือน (วันที่ 1 เวลา 00:00 `+07:00`)
ไม่งั้นแถบพยากรณ์จะเหลื่อมกับแท่งข้อมูลจริงครึ่งเดือน

---

## ข้อจำกัดจากสภาพแวดล้อม

- ระบบรัน **on-premise 100%** โมเดลต้องรันบน gateway ในโรงงาน
  ห้ามเรียกบริการ inference บนคลาวด์ทุกกรณี
- ผลลัพธ์ต้องไม่ต้องพึ่งการดาวน์โหลด weight ตอน runtime
- เวลาทั้งหมดเป็น ISO 8601 timezone `+07:00` ยกเว้น `timestamp` ในกราฟที่เป็น epoch ms

---

## สถานการณ์สาธิต (mock เท่านั้น)

`lib/services/ai.ts` มี `setScenario()` สำหรับสลับชุดผลตอนสาธิต — **ไม่มีอยู่ใน API จริง**

| scenario | สภาพที่จำลอง | ผล AI ที่ปล่อยออกมา |
|---|---|---|
| `normal` | เดินปกติ | `sensor_drift` คะแนนต่ำ 1 รายการ |
| `night_leak` | โซน 7 มีน้ำไหลตลอดคืน | `night_leak`, `unaccounted_water`, และ `pipe_burst_risk` ที่จงใจส่งมาไม่ครบเพื่อทดสอบ fallback |
| `pump_degrading` | ปั๊มหลัก 1 กินไฟเพิ่ม 35% ที่อัตราไหลเท่าเดิม | `pump_degradation`, `power_anomaly` และ `MaintenancePrediction` ที่ความน่าจะเป็นเสีย 0.63 |
