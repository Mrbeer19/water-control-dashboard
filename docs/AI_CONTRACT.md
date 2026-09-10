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

query ของ `/api/ai/anomalies`: `type` `detector` `severity` `sourceType` `minScore` `from` `to` `limit` `offset`
query ของ `/api/ai/forecast`: `target` `targetId` `horizon`

---

## AnomalyEvent

```ts
{
  id: string            // บังคับ
  type: string          // บังคับ — string เปิด ห้ามทำเป็น enum ปิด
  detectedAt: string    // บังคับ — ISO 8601

  detector?: string     // 'rule' | 'isolation_forest' | 'forecast_deviation' | อื่น ๆ
  score?: number        // 0–1
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

**พฤติกรรมของ Frontend เมื่อ field ขาด**

| ขาด | Frontend ทำอะไร |
|---|---|
| `type` ไม่รู้จัก | ใช้ `UNKNOWN_ANOMALY_TYPE` และแสดงรหัสดิบคู่กัน |
| `severity` | ใช้ `defaultSeverity` จากตารางของชนิดนั้น |
| `summaryTh` / `summaryEn` | ใช้คำอธิบายกลางของชนิดนั้นแทน |
| `score` | ไม่แสดงแถบคะแนน แต่ยังแสดงรายการ |
| `features` | ซ่อนส่วน "ทำไมถึงถูกจับ" |
| `sourceName` | แสดง `sourceId` แทน |

**ตัวกรองต้องไม่ทิ้งข้อมูลเงียบ ๆ** — ผลที่ไม่ได้ระบุ `severity` หรือ `score` จะไม่ถูกกรองออกด้วยเงื่อนไขที่อ้างอิง field นั้น

---

## ชนิดที่ Frontend แปลได้แล้ว

`night_leak` · `continuous_flow` · `usage_spike` · `pump_degradation` · `pressure_deviation` · `power_anomaly` · `sensor_drift` · `unaccounted_water`

ชนิดอื่นแสดงได้ทันทีแบบไม่มีคำแปล — ถ้าต้องการชื่อไทย/ไอคอนเฉพาะ แจ้งทีม frontend เติมใน `lib/config/anomaly-types.ts`

---

## AIForecast

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
  history?: { timestamp: number; value: number }[]
  forecast?: { timestamp: number; value: number; lowerBound?: number; upperBound?: number }[]
  modelName?: string | null
  mapePercent?: number
  summaryTh?: string
  summaryEn?: string
}
```

`timestamp` เป็น **epoch milliseconds** (ไม่ใช่ ISO string) เพื่อให้กราฟไม่ต้องแปลงซ้ำทุกจุด
ถ้าไม่มี `lowerBound`/`upperBound` frontend จะวาดเฉพาะเส้นกลางโดยไม่มีแถบความเชื่อมั่น

---

## MaintenancePrediction

```ts
{
  id: string            // บังคับ
  targetType: string    // บังคับ — ชนิดอุปกรณ์
  targetId: string      // บังคับ
  generatedAt: string   // บังคับ

  targetName?: string
  failureProbability?: number     // 0–1
  daysUntilService?: number | null
  features?: AnomalyFeature[]
  modelName?: string | null
  recommendationTh?: string
  recommendationEn?: string
}
```

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
