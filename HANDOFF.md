# HANDOFF.md — ส่งต่อให้ทีมหลังบ้าน

Frontend ของระบบมอนิเตอร์และควบคุมการใช้น้ำ ทำเสร็จครบทุกหน้าแล้ว ตอนนี้ทำงานบน mock data
ทั้งหมด เอกสารนี้บอกว่าต้องทำ endpoint อะไรบ้าง หน้าตา JSON เป็นยังไง และต้องแก้ไฟล์ไหน
ตอนสลับจาก mock เป็น API จริง

---

## 1. สิ่งที่ต้องรู้ก่อน

| เรื่อง | รายละเอียด |
|---|---|
| **สัญญาของ type** | `lib/types.ts` ไฟล์เดียว — 153 type ที่ทุกหน้าอ้างอิง ใช้เป็น source of truth |
| **จุดที่ต้องแก้** | `lib/services/` เท่านั้น — component ไม่เคยเรียก `lib/mock/` เลย (ตรวจแล้วเป็น 0) |
| **เวลา** | ISO 8601 พร้อม offset `+07:00` ยกเว้น `timestamp` ในจุดข้อมูลกราฟที่เป็น epoch milliseconds |
| **หน่วย** | ผูกกับชื่อ field เสมอ — `Liters`, `Lpm`, `CubicMeters`, `Celsius`, `Hpa`, `Hz`, `Kwh` |
| **ค่าที่ยังไม่มี** | ใช้ `null` เสมอ ห้ามใช้ `0` หรือ `""` แทนความว่าง |
| **On-premise** | ทุกอย่างต้องอยู่ใน LAN ของโรงงาน ไม่มี route ออกอินเทอร์เน็ต |

### ผังน้ำจริง (สำรวจหน้างาน 12 ก.ย. 2569)

```
การประปา ─► มิเตอร์หลัก ─┬─► ถัง 1 (70,000 L) ─┬─► ปั๊ม 1 ─┐
                         │   + ตู้ควบคุมเดิม    │           ├─► มิเตอร์รายโซน
                         │                     └─► ปั๊ม 2 ─┘   (อยู่รวมกันจุดเดียว)
                         │                     └─► ถัง VIP (3,000 L) ─► ปั๊ม 3 ─► โซน VIP
                         └─► บ่อสำรอง (490,000 L) ─► สูบกลับเข้าถัง 1 เมื่อประปาไม่ไหล
```

**สี่เรื่องที่กระทบการเขียน backend โดยตรง**

1. **ปั๊มหลัก 2 ตัวจ่ายให้ทุกโซนเหมือนกัน แต่สลับเวรกันเดิน** ตัวละ 12 ชม.
   `servesZoneIds` ของทั้งคู่จึงเป็นชุดเดียวกัน ณ เวลาหนึ่งมีตัวที่เดินอยู่ตัวเดียว
   **ห้ามบวกอัตราไหลของปั๊มหลักทั้งสองตัวรวมกัน** จะได้ตัวเลขซ้ำสองเท่า
2. **บ่อสำรองรับน้ำจากประปาโดยตรง** ไม่ได้ต่อจากถัง 1 → น้ำเข้าบ่อก็ผ่านมิเตอร์หลัก
   **`Δstorage` ต้องรวมบ่อสำรองด้วย** ไม่งั้นช่วงเติมบ่อจะคำนวณว่ารั่ว
   ตอนบ่อสูบกลับเข้าถัง 1 ค่า Δ ของสองถังหักล้างกันเอง ไม่นับซ้ำ
3. **จำนวนมิเตอร์ยังไม่สรุป** ห้าม hard-code จำนวนโซนใน query, schema หรือ response
   หน้าบ้านนับจากข้อมูลจริงอยู่แล้ว
4. **ถัง `tank-2` คือถังของโซน VIP** ไม่ใช่ถังจ่ายน้ำทั่วไป

### ข้อตกลงเรื่องสถานะ

`EntityStatus` มีค่าเดียวทั้งระบบ: `'ok' | 'warning' | 'critical' | 'offline'`
ทุก entity ฮาร์ดแวร์ต้องมี `id`, `name`, `nameEn`, `status`, `lastSeen`, `updatedAt` (ดู `BaseEntity`)
ส่วนเรกคอร์ด (alert, command, schedule) ใช้ `BaseRecord` ซึ่ง **ไม่มี** `status`

---

## 2. Endpoint ที่ต้องทำ

รวม 102 จุดจาก `TODO(backend)` ในโค้ด ค้นได้ด้วย `grep -rn "TODO(backend)" lib/services/`

### 2.1 น้ำ — ถัง ปั๊ม วาล์ว โซน มิเตอร์

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/tanks` | `Tank[]` |
| GET | `/api/tanks/:id` | `Tank` |
| GET | `/api/tanks/:id/history?metric=&from=&to=&interval=` | `TimeSeriesPoint[]` |
| GET | `/api/tanks/summary` | `{ storedLiters, capacityLiters, percentFull }` |
| GET | `/api/pumps` | `Pump[]` |
| GET | `/api/pumps/:id` | `Pump` |
| GET | `/api/pumps/:id/history?metric=&from=&to=&interval=` | `TimeSeriesPoint[]` |
| GET | `/api/pumps/energy?period=today` | `number` (kWh) |
| GET | `/api/valves` | `Valve[]` |
| GET | `/api/zones` | `Zone[]` |
| GET | `/api/zones/:id` | `Zone` |
| GET | `/api/zones/:id/history?metric=flow_lpm&from=&to=&interval=` | `TimeSeriesPoint[]` |
| GET | `/api/zones/consumption?period=today\|month` | `{ zoneId, name, cubicMeters }[]` |
| GET | `/api/zones/cost?from=&to=` | `ZoneCost[]` |
| GET | `/api/meters` | `WaterMeter[]` (มิเตอร์รายโซน — **จำนวนยังไม่สรุป ห้าม fix ไว้**) |
| GET | `/api/meters/main` | `MainMeter` |
| GET | `/api/meters/:id/history?metric=flow_lpm&from=&to=&interval=` | `TimeSeriesPoint[]` |
| GET | `/api/meters/unaccounted?from=&to=` | `UnaccountedWater` |
| GET | `/api/meters/balance` | `{ inflowLpm, outflowLpm }` |
| GET | `/api/meters/daily?from=&to=&projection=` | `DailyUsagePoint[]` |
| GET | `/api/pressure` | `PressureControl` |
| GET | `/api/pressure/history?metric=pressure_bar&…` | `TimeSeriesPoint[]` |
| GET | `/api/pressure/headcount` | `{ headcount, updatedAt }` |

> **★ `UnaccountedWater` คิดจาก `main − Σzone − Δstorage`**
> ห้ามละ `storageDeltaCubicMeters` ออก ช่วงที่กำลังเติมถัง น้ำที่ผ่านมิเตอร์หลักยังไม่ถูกใช้
> ถ้าใช้แค่ `main − Σzone` ระบบจะเตือนว่ารั่วทุกครั้งที่เติมถัง

### 2.2 ไฟฟ้าและแผนก

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/electric/nodes?departmentId=` | `ElectricNode[]` |
| GET | `/api/electric/nodes/:id` | `ElectricNode` |
| GET | `/api/electric/nodes/:id/history?metric=power_watt&…` | `TimeSeriesPoint[]` |
| GET | `/api/electric/summary?period=today\|month` | `{ departmentId, departmentName, energyKwh }[]` |
| GET | `/api/departments` | `Department[]` |
| GET | `/api/departments/usage?from=&to=` | `DepartmentUsage[]` |
| GET | `/api/users` | `User[]` |
| GET | `/api/auth/me` | `User` — คืนสิทธิ์ที่มีผลจริงหลังคิด `departmentScopedAccess` แล้ว |
| POST | `/api/auth/login` body `{ username, password }` | `AuthSession` |
| POST | `/api/auth/logout` | — |
| GET | `/api/auth/session` | `AuthSession` \| `null` |
| POST | `/api/auth/refresh` | `AuthSession` |

> **★★ หน้า `/login` ตอนนี้เป็น UI อย่างเดียว ไม่ใช่ระบบยืนยันตัวตนจริง ★★**
> รหัสผ่านไม่ถูกตรวจและไม่ถูกเก็บที่ไหนเลย เซสชันอยู่ใน `localStorage` ซึ่งสคริปต์ในหน้าอ่านได้
> การกั้นหน้าใน `components/layout/auth-gate.tsx` ก็เป็นการกั้นฝั่งหน้าจอเท่านั้น เปิด devtools ก็ข้ามได้
>
> **ตอนต่อของจริงต้องเปลี่ยนทั้งหมดนี้:**
> 1. ตรวจรหัสผ่านที่เซิร์ฟเวอร์ ห้ามตรวจที่หน้าจอ
> 2. ออก token จากเซิร์ฟเวอร์แล้วเก็บใน **httpOnly cookie** ห้ามเก็บใน `localStorage`
> 3. กั้นด้วย middleware ที่ตรวจ cookie **ก่อนส่ง HTML ออกมา** ไม่ใช่กั้นหลังโหลดหน้า
> 4. ให้เซิร์ฟเวอร์เป็นคนกำหนดและต่ออายุเซสชัน ไม่ใช่ให้หน้าจอคำนวณวันหมดอายุเอง
> 5. `demoAccounts()` ถูกลบออกไปแล้ว
> 6. **ลบบัญชีสาธิตที่ hardcode ไว้** — `DEMO_USERNAME` / `DEMO_PASSWORD` ที่หัวไฟล์ `lib/services/auth.ts`
>    ตอนนี้หน้าจอเทียบรหัสผ่านเองเพื่อให้สาธิตได้ ซึ่งใครเปิด bundle ก็เห็นรหัส ห้ามใช้แบบนี้ของจริง

### 2.3 สภาพแวดล้อม

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/environment` | `EnvironmentSensor[]` |
| GET | `/api/environment/:id` | `EnvironmentSensor` |
| GET | `/api/environment/:id/latest` | `EnvironmentReading` |
| GET | `/api/environment/:id/history?metric=&…` | `TimeSeriesPoint[]` |
| GET | `/api/environment/rainfall?from=&to=` | `{ mmPerHour, detected }` |

> ค่าอุณหภูมิ/ความชื้น/ฝน/ความกดอากาศ/ความเข้มแสง **ต้องมาจากเซนเซอร์ในพื้นที่เท่านั้น**
> ห้ามเรียก weather API ทุกกรณี จุดในอาคารส่ง `pressureHpa`, `illuminanceLux`, `rainfall*` เป็น `null`

### 2.4 อุปกรณ์และบริการ

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/devices?kind=&role=` | `Device[]` |
| GET | `/api/devices/:id` | `Device` |
| GET | `/api/devices/:id/history?metric=rssi_dbm\|uptime_seconds\|free_heap_bytes&…` | `TimeSeriesPoint[]` |
| GET | `/api/devices/summary` | `{ total, online, warning, offline }` |
| POST | `/api/devices/:id/ping` | `{ reachable, latencyMs }` |
| POST | `/api/devices/:id/reboot` | `DeviceActionResult` |
| POST | `/api/devices/:id/firmware` body `{ toVersion }` | `FirmwareUpdateJob` |
| GET | `/api/devices/firmware-jobs/:jobId` | `FirmwareUpdateJob` (poll ความคืบหน้า) |
| GET | `/api/system/connection` | `ConnectionStatus` |
| GET | `/api/system/summary` | `SystemSummary` |
| GET | `/api/system/services` | `ServiceHealth[]` |

### 2.5 การสั่งงาน

| Method | Path | คืนค่า |
|---|---|---|
| POST | `/api/control/pump/:id` body `{ action, value, issuedByUserId, reason }` | `CommandLogEntry` |
| POST | `/api/control/valve/:id` body เดียวกัน | `CommandLogEntry` |
| POST | `/api/control/pressure/:id` body `{ action: 'set_setpoint', value, issuedByUserId }` | `CommandLogEntry` |
| POST | `/api/control/system` body `{ action: 'emergency_stop' \| 'open_all' \| 'close_all', … }` | `CommandLogEntry` |
| POST | `/api/control/system/clear-lockout` | `CommandLogEntry` |
| GET | `/api/control/commands/:id` | `CommandResult` |
| GET | `/api/control/commands?limit=&offset=` | `CommandLogEntry[]` |
| GET | `/api/control/interlocks` | `ControlInterlock[]` |
| GET | `/api/control/schedules` | `CommandSchedule[]` |
| POST | `/api/control/schedules` | `CommandSchedule` |
| PATCH | `/api/control/schedules/:id` body `{ enabled }` | `CommandSchedule` |
| DELETE | `/api/control/schedules/:id` | `boolean` |

> **★ คำสั่งต้องตอบ 202 ทันทีพร้อม `commandId` แล้วให้หน้าบ้าน poll ผลต่อ**
> ห้ามค้าง HTTP request ไว้รอ feedback bit จาก PLC เพราะจะ timeout ที่ชั้น HTTP ก่อน
> หน้าจอเดินตาม state machine นี้ตรง ๆ: `sending → awaiting_feedback → success | timeout | failed`
> และ **ห้ามถือว่าส่งสำเร็จ = อุปกรณ์ขยับแล้ว** ต้องรอ feedback ยืนยันว่าขยับจริง
>
> **★ `interlocks` ต้องคำนวณที่หลังบ้าน** เพราะเงื่อนไขจริงอยู่ใน PLC
> หน้าบ้านแค่ disable ปุ่มตามที่ได้มา และต้องมี `reasons` เสมอ — ห้าม disable โดยไม่บอกเหตุผล

### 2.6 การแจ้งเตือน

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/alerts?severity=&state=&sourceType=&codes=&sourceIds=&unreadOnly=&from=&to=&limit=&offset=` | `Paginated<Alert>` |
| GET | `/api/alerts/:id` | `Alert` |
| GET | `/api/alerts/unread-count` | `{ total, critical }` |
| POST | `/api/alerts/:id/read` | `Alert` |
| POST | `/api/alerts/read-all` | `number` |
| POST | `/api/alerts/:id/acknowledge` body `{ acknowledgedByUserId, note, snoozeMinutes }` | `AlertAcknowledgement` |
| GET | `/api/alerts/acknowledgements?alertId=` | `AlertAcknowledgement[]` |
| GET | `/api/alerts/recoveries?from=&to=&limit=` | `RecoveryEvent[]` |
| GET | `/api/alerts/:id/preview?channel=line` | `NotificationPreview` |
| GET | `/api/notifications/deliveries?alertId=` | `NotificationDelivery[]` |
| POST | `/api/notifications/deliveries/:id/retry` | `NotificationDelivery` |

> **★ ข้อความที่ preview ต้องเป็นข้อความเดียวกับที่ส่งจริง**
> ตอนนี้หน้าบ้านประกอบข้อความเองเพราะยังไม่มีหลังบ้าน เมื่อต่อของจริงให้ย้ายการประกอบ
> ไปฝั่งเซิร์ฟเวอร์แล้วให้ endpoint นี้คืนข้อความเดียวกับที่ส่งออก ไม่ใช่คนละเวอร์ชัน
>
> `NotificationChannel` `'line'` คือ **LINE Messaging API** (LINE Notify ปิดบริการแล้ว)
> `recipient` จึงเป็น LINE group id ขึ้นต้นด้วย `C` ตามด้วย 32 ตัวอักษร

### 2.7 รายงานและค่าน้ำ

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/reports/usage?from=&to=` | `UsageReport` |
| GET | `/api/reports/billing?utility=water\|electricity&from=&to=` | `BillingEstimate` |
| GET | `/api/reports/monthly?months=` | `MonthlyUsagePoint[]` |
| GET | `/api/reports/meter-readings?meterId=&limit=` | `MeterReading[]` |
| GET | `/api/reports?type=&from=&to=` | `ReportDefinition` |
| POST | `/api/reports/export` body `{ type, range, format }` | `202` + `{ jobId, status }` |
| GET | `/api/reports/export/:jobId` | ไฟล์เมื่อพร้อม |

> **★ ช่วงเปรียบเทียบคือ "ช่วงก่อนหน้าที่ยาวเท่ากัน" ไม่ใช่ "เดือนที่แล้ว"**
> ผู้ใช้เลือก 10 วัน ต้องเทียบกับ 10 วันก่อนหน้า ไม่งั้นตัวเลข % ไม่มีความหมาย
>
> **★ `MeterReading.unitsUsed` = เลขหน้าปัดครั้งนี้ − ครั้งก่อน** ไม่ใช่ยอดสะสมตามเดือนปฏิทิน
> รอบจดคร่อมเดือนได้ และนี่คือตัวเลขที่ต้องกระทบยอดกับใบแจ้งหนี้ของการประปา
>
> **★ ไฟล์ PDF/CSV ต้องเรนเดอร์บน gateway ในโรงงาน** ห้ามใช้บริการแปลงไฟล์ออนไลน์

### 2.8 AI

รายละเอียดเต็มอยู่ใน **`docs/AI_CONTRACT.md`** — ไฟล์นั้นส่งให้ทีม AI โดยตรง

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/ai/anomalies?type=&status=&detector=&severity=&minScore=&from=&to=&limit=&offset=` | `Paginated<AnomalyEvent>` |
| GET | `/api/ai/anomalies/:id` | `AnomalyEvent` |
| POST | `/api/ai/anomalies/:id/feedback` body `{ feedback }` | `AnomalyEvent` |
| POST | `/api/ai/anomalies/:id/status` body `{ status }` | `AnomalyEvent` |
| GET | `/api/ai/forecast?target=&targetId=&horizon=` | `AIForecast` |
| GET | `/api/ai/forecast` (ไม่ระบุ target) | `AIForecast[]` |
| GET | `/api/ai/maintenance?targetType=&targetId=` | `MaintenancePrediction[]` |
| GET | `/api/ai/status` | `AIServiceStatus` |

> **★ `AnomalyEvent.score` อยู่ในสเกล 0–1 เสมอ** ถ้าโมเดลคิดเป็น 0–100 ให้หารก่อนส่ง
> หน้าบ้านแปลงเป็นเปอร์เซ็นต์ที่ `formatAnomalyScore()` จุดเดียว
>
> **★ `type` เป็น string เปิด** ทีม AI เพิ่มชนิดใหม่ได้โดยหน้าบ้านไม่ต้อง deploy ตาม
> หน้าจอมี fallback ให้ชนิดที่ยังไม่รู้จักอยู่แล้ว

### 2.9 ตั้งค่า

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/settings` | `SystemSettings` |
| PATCH | `/api/settings/:section` body บางส่วนของหมวดนั้น | `SystemSettings` |
| POST | `/api/settings/reset` | `SystemSettings` |
| GET | `/api/settings/export` | JSON string |
| POST | `/api/settings/import` body `SystemSettings` | `{ ok, errors }` |
| POST | `/api/settings/network/test` body `NetworkSettings` | `{ mqtt, plc, latencyMs }` |
| POST | `/api/settings/line/test` body `{ groupId }` | `NotificationTestResult` |

> **★ Channel Access Token ห้ามส่งค่าจริงกลับมาให้หน้าบ้าน**
> ส่งเป็นรูปแบบปิดบัง เช่น `"••••abcd"` หน้าจอส่งค่าใหม่ขึ้นไปเฉพาะตอนผู้ใช้พิมพ์ทับ
>
> `validateSettings()` ใน `lib/services/settings.ts` คือกฎตรวจที่หน้าจอใช้อยู่
> หลังบ้านควรใช้กฎชุดเดียวกัน ไม่ใช่กฎคนละชุด

### 2.10 Realtime

| Path | รายละเอียด |
|---|---|
| WS `/api/stream` | subscribe topic `plant/water/#` ผ่าน gateway |

payload ใช้ `RealtimeEvent` ใน `lib/types.ts` — เป็น discriminated union บน `type`
**ส่ง entity ทั้งก้อนเสมอ ไม่ส่ง patch บางส่วน** เพื่อไม่ให้สถานะเพี้ยนเมื่อ event หาย

### 2.11 ข้อมูลกราฟแบบรวมช่วงเวลา (Phase 7) — ★ เส้นใหม่ ยังไม่มีใครทำ

> **★★ นี่คือเส้นที่สำคัญที่สุดที่เหลืออยู่ ★★**
> `/history` เดิมในข้อ 2.1–2.4 **ยังอยู่และไม่ถูกแตะ** ใช้กับ**ข้อมูลดิบ**และกราฟจิ๋วในการ์ด
> ส่วนสองเส้นข้างล่างนี้คือ **ข้อมูลที่รวมช่วงแล้ว** ซึ่งเป็นคนละเรื่องกัน

| Method | Path | คืนค่า |
|---|---|---|
| GET | `/api/metrics/series?sourceType=&sourceId=&metric=&from=&to=&granularity=&compare=&monthAnchor=` | `MetricSeries` |
| GET | `/api/metrics/state-spans?sourceType=&sourceId=&from=&to=` | `StateSpan[]` |

โค้ดฝั่งหน้าบ้านอยู่ที่ `lib/services/metrics.ts` · type ทั้งหมดอยู่ใน `lib/types.ts`

#### พารามิเตอร์

| ชื่อ | ค่าที่รับได้ |
|---|---|
| `granularity` | `minute_5` `minute_15` `hour` `day` `week` `month` `year` (และ `raw` = ไม่รวม) |
| `compare` | `none` `previous` `last_year` |
| `monthAnchor` | `calendar` `meter_reading` — ใช้เฉพาะมุมมองรายเดือนของมิเตอร์น้ำ |

> **★ ห้ามใช้ `1m` / `1M` เป็นชื่อความละเอียด** สับสนระหว่างนาทีกับเดือน ใช้ชื่อเต็มตามตาราง
>
> **★ หนึ่ง request = หนึ่ง series** ถ้าหน้าจอต้องการหลายเส้น (โซนซ้อนกัน, อุณหภูมิเทียบการใช้น้ำ)
> หน้าบ้านจะยิงพร้อมกันด้วย `Promise.all` เอง — **ยังไม่ต้องทำ batch endpoint**

#### กติกาจับคู่ "ช่วงที่ขอ ↔ ความละเอียด"

| ช่วงที่ขอ | ความละเอียดที่ยอมให้ |
|---|---|
| ≤ 1 ชม. | `raw` `minute_5` |
| ≤ 24 ชม. | `minute_5` `minute_15` `hour` |
| ≤ 7 วัน | `minute_15` `hour` `day` |
| ≤ 31 วัน | `hour` `day` `week` |
| ≤ 366 วัน | `day` `week` `month` |
| มากกว่านั้น | `month` `year` |

**ขอเกินกติกา → ตอบ `400` พร้อมเหตุผล** ห้ามเงียบแล้วส่งข้อมูลหมื่นจุดมา
กติกาชุดนี้อยู่ใน `lib/utils/time-buckets.ts` ซึ่ง UI กับ mock ใช้ตัวเดียวกัน — ถือเป็นต้นฉบับ
เพดานคือ **1,000 จุดต่อ series**

#### รูปร่างของ bucket — ต่างกันตาม `kind`

`kind` เป็น **discriminated union** บนฟิลด์ `kind` ไม่ใช่ object ก้อนเดียวที่มีทุกฟิลด์แล้วปล่อยเป็น null

| `kind` | ใช้กับ | ฟิลด์เฉพาะ | รวมยังไง |
|---|---|---|---|
| `gauge` | อุณหภูมิ ความชื้น แรงดัน อัตราไหล กระแส แรงดันไฟ กำลังไฟ | `avg` `min` `max` `minAt` `maxAt` | เฉลี่ยถ่วงน้ำหนักด้วยจำนวนตัวอย่าง |
| `counter` | `energy_kwh` และค่าสะสมที่วิ่งขึ้นเรื่อย ๆ | `delta` `resetDetected` | ผลต่างหัวท้ายของช่วง |
| `amount` | ปริมาณต่อช่วง เช่น ฝน | `sum` `max` | บวกกัน |
| `level` | ระดับน้ำในถัง | `last` `min` `max` | เอาค่าสุดท้ายของช่วง |
| `state` | สถานะปั๊ม / online-offline | `durationsMs` `entries` | รวมเวลาที่อยู่ในแต่ละสถานะ + นับจำนวนครั้งที่เข้าสู่สถานะนั้น |

ทุก bucket มีร่วมกัน: `timestamp` (ต้นช่วง), `count` (ตัวอย่างที่ได้จริง),
`expectedCount` (ที่ควรได้), `isPartial` (ช่วงยังไม่จบ)

> **★★ `kind` มาจาก response ของหลังบ้าน ไม่ใช่จากทะเบียนฝั่งหน้าบ้าน ★★**
> หลังบ้านเป็นคนรวมข้อมูล จึงเป็นคนรู้ว่ารวมแบบไหน
> ทะเบียน `lib/config/metrics.ts` เก็บแค่ ป้าย / หน่วย / สี / เกณฑ์ / ชนิดกราฟ
> ถ้าสองฝั่งไม่ตรงกัน หน้าบ้านจะ render ตาม response แล้ว `console.warn` ในโหมด dev
>
> **★ เหตุผลที่ต้องเป็น union:** ถ้าใช้ type เดียวที่มี `avg`/`sum` ครบแล้วปล่อย null ตามชนิด
> UI จะยังหยิบ `sum` ของอุณหภูมิมาแสดงได้ ซึ่งไม่มีความหมาย (เป็นบั๊กที่เพิ่งแก้ไป)

#### ตาราง metric → kind ที่หน้าบ้านคาดไว้

สร้างจาก `lib/config/metrics.ts` โดยตรง — ใช้เป็นตัวตั้งต้นว่าแต่ละค่าวัดควรตอบ `kind` อะไรกลับมา
(ถ้าหลังบ้านตัดสินใจเป็นอย่างอื่น ให้ยึดของหลังบ้าน แล้วบอกหน้าบ้านมาแก้ทะเบียนตาม)

| metric | kind | หน่วย | ชื่อที่แสดง |
|---|---|---|---|
| `level_percent` | `level` | % | ระดับน้ำ |
| `level_liters` | `level` | L | ปริมาณน้ำ |
| `net_flow_lpm` | `gauge` | L/min | อัตราไหลสุทธิ |
| `flow_lpm` | `gauge` | L/min | อัตราไหล |
| `pressure_bar` | `gauge` | bar | แรงดันน้ำ |
| `power_watt` | `gauge` | W | กำลังไฟ |
| `current_amp` | `gauge` | A | กระแส |
| `voltage_volt` | `gauge` | V | แรงดันไฟ |
| `energy_kwh` | `counter` | kWh | พลังงาน |
| `vfd_frequency_hz` | `gauge` | Hz | ความถี่ VFD |
| `temperature` | `gauge` | °C | อุณหภูมิ |
| `humidity` | `gauge` | %RH | ความชื้น |
| `heat_index` | `gauge` | °C | ดัชนีความร้อน |
| `rainfall` | `amount` | mm | ปริมาณฝน |
| `pressure_hpa` | `gauge` | hPa | ความกดอากาศ |
| `illuminance_lux` | `gauge` | lux | ความเข้มแสง |
| `rssi_dbm` | `gauge` | dBm | ความแรงสัญญาณ |
| `uptime_seconds` | `counter` | s | เวลาทำงานต่อเนื่อง |
| `free_heap_bytes` | `gauge` | B | หน่วยความจำว่าง |
| `main_inflow_lpm` | `gauge` | L/min | น้ำเข้าจากมิเตอร์หลัก |
| `zone_outflow_lpm` | `gauge` | L/min | น้ำออกรวมทุกโซน |
| `unaccounted_percent` | `gauge` | % | น้ำสูญหาย |
| `headcount` | `gauge` | — | จำนวนคน |
| `pump_run_state` | `state` | — | สถานะปั๊ม |
| `online_state` | `state` | — | สถานะการเชื่อมต่อ |

> **★ metric ที่ไม่มีในตารางนี้ก็ส่งมาได้** หน้าบ้าน render ได้เสมอผ่าน `UNKNOWN_METRIC`
> (แสดงเป็นเส้นค่าเฉลี่ย ไม่มีหน่วย และโชว์คีย์ดิบเป็นชื่อ) ทีมหลังบ้านกับทีม AI
> จึงเพิ่มค่าวัดใหม่ได้โดยไม่ต้องรอหน้าบ้าน deploy

#### กฎที่ห้ามพลาด

1. **ต้องส่ง bucket มาครบทุกช่วงในช่วงที่ขอ** รวมช่วงที่ไม่มีข้อมูล
   ช่วงที่ไม่มีข้อมูลให้ค่าเป็น **`null` ไม่ใช่ `0`** และ `count: 0`
   หน้าจอใช้ตรงนี้เว้นช่องว่างในกราฟ — ถ้าส่ง 0 มา กราฟจะอ่านว่า "ใช้น้ำ 0" ซึ่งคนละเรื่องกับ "เซนเซอร์หลุด"
2. **ตัดขอบวันตามเขตเวลาที่ตั้งไว้ใน `SystemSettings.general.timezone`** (ค่าตั้งต้น `Asia/Bangkok`)
   วันเริ่ม `00:00 +07:00` · สัปดาห์เริ่ม**วันจันทร์** · ส่ง `timezone` กลับมาใน response ด้วย
   ห้ามตัดด้วย UTC แล้วให้หน้าบ้านเลื่อนเอง
3. **ผลรวมต้องสอดคล้องกันทุกระดับ** สำหรับ `counter` และ `amount`
   ผลรวมรายชั่วโมงต้องเท่ากับรายวันพอดี และรายวันต้องเท่ากับรายเดือนพอดี
   (มี `npm run check:series` ตรวจฝั่ง mock อยู่ 10 ข้อ ใช้เป็นเกณฑ์เดียวกันได้)
4. **`counter` ที่มิเตอร์ถูกรีเซ็ตหรือเปลี่ยนตัว** ห้ามให้ `delta` ติดลบ
   ให้ตั้ง `resetDetected: true` แล้วคิด `delta` จากค่าหลังรีเซ็ตเท่านั้น
5. **`isPartial: true` สำหรับช่วงที่ยังไม่จบ** (ชั่วโมง/วัน/เดือนปัจจุบัน)
   หน้าจอจะขึ้นป้าย "ยังไม่จบช่วง" ไม่ให้คนอ่านว่าค่าตก
6. **รวมข้อมูลที่ฐานข้อมูล** ทำ rollup รายชั่วโมง/รายวันไว้ล่วงหน้า
   **ห้ามส่งข้อมูลดิบทั้งปีมาให้หน้าบ้านรวมเอง**

#### `StateSpan` — ช่วงสถานะ

```ts
{ from: EpochMs; to: EpochMs | null; state: string; durationMs: number }
```

- span ต้อง **ต่อกันไม่มีรู** ช่วงที่ไม่มีข้อมูลใช้ `state: "no_data"`
- **ตัดขอบที่ขอบช่วงที่ร้องขอ** และผลรวม `durationMs` ต้องเท่ากับความยาวช่วงพอดี
- `to: null` = ยังอยู่ในสถานะนั้นจนถึงตอนนี้
- `state` เป็น **string เปิด** ปัจจุบันหน้าบ้านรู้จัก `running` `stopped` `no_data`
- **หน้าบ้านห้ามรวม span เป็นรายวันเอง** ถ้าต้องการรายวันให้ขอผ่าน `/api/metrics/series` ด้วย `kind: state`

#### ข้อแนะนำเรื่องการเก็บข้อมูล (retention)

| ระดับ | เก็บนานเท่าไร | เหตุผล |
|---|---|---|
| ข้อมูลดิบ | **30 วัน** | ใช้กับ `/history` และกราฟจิ๋ว ไม่มีใครย้อนดูดิบเกินเดือน |
| rollup รายชั่วโมง | **2 ปี** | รองรับมุมมองรายวัน/รายสัปดาห์/รายเดือน และการเทียบปีก่อน |
| rollup รายวัน | **เก็บถาวร** | เล็กมาก และจำเป็นกับรายงานย้อนหลังหลายปี |

#### ★ คำถามที่ยังค้าง ต้องตกลงกันก่อนลงมือ

1. **`pump_run_state` และ `online_state` ยังไม่อยู่ใน union `MetricKey`** ของ `lib/types.ts`
   แต่มีอยู่ในทะเบียนฝั่งหน้าบ้านแล้ว
   ถ้าอยากให้กราฟ "ชั่วโมงเดินเครื่อง / จำนวนครั้งที่สตาร์ท" ใช้งานได้ ต้องเพิ่มสองคีย์นี้เข้า union
   → **หน้าบ้านยังไม่เพิ่มให้ เพราะเป็นการแก้สัญญากับทีมหลังบ้าน ต้องตกลงกันก่อน**
2. **ยังไม่มีคีย์สำหรับ "ปริมาณน้ำเป็น m³ ต่อช่วง"** (`kind: amount`)
   ตอนนี้มีแค่ `flow_lpm` ซึ่งเป็น `gauge`
   ทำให้กราฟ "การใช้น้ำรายวัน" กับ "ค่าน้ำแยกโซน" ยังต่อกับเส้นใหม่นี้ไม่ได้
   → เสนอชื่อ `volume_cubic_meters` แต่**รอทีมหลังบ้านยืนยันก่อน**

---

## 3. MQTT topic ที่หน้าบ้านคาดว่าจะมี

base topic ตั้งค่าได้ใน `SystemSettings.network.mqttBaseTopic` (ค่าตั้งต้น `plant/water`)

| Topic | ทิศทาง | payload |
|---|---|---|
| `plant/water/tank/<tankId>/telemetry` | node → gateway | ระดับน้ำจาก ES-Y30A (RS485), อัตราไหลเข้า/ออก |
| `plant/water/pump/<pumpId>/telemetry` | node → gateway | V, A, W, kWh, flow, pressure, สถานะ VFD |
| `plant/water/meter/<meterId>/telemetry` | node → gateway | pulse count, flow |
| `plant/water/meter/main/telemetry` | node → gateway | มิเตอร์หลัก + แรงดันขาเข้า |
| `plant/water/env/<sensorId>/telemetry` | node → gateway | temp, humidity, pressure, lux, rain |
| `plant/water/power/<nodeId>/telemetry` | node → gateway | V, A, W, kWh ของตู้ไฟรายแผนก |
| `plant/water/device/<deviceId>/status` | node → gateway | rssi, uptime, freeHeap, reconnectCount, lastError |
| `plant/water/<deviceId>/cmd` | gateway → node | คำสั่งรีบูต / OTA |
| `plant/water/valve/<valveId>/cmd` | gateway → **ESP32** | เปิด/ปิด/เปอร์เซ็นต์ |
| `plant/water/valve/<valveId>/feedback` | **ESP32** → gateway | ตำแหน่งจริงหลังสั่ง |
| `plant/water/pump/<pumpId>/cmd` | gateway → PLC | เดิน/หยุด/โหมด |
| `plant/water/pump/<pumpId>/feedback` | PLC → gateway | สถานะจริงหลังสั่ง |

**`feedback` topic คือหัวใจของหน้า Control** — ถ้าไม่มี คำสั่งจะค้างที่ `awaiting_feedback`
จนหมดเวลาแล้วขึ้น timeout ซึ่งเป็นพฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก

> ### 🔴 การแบ่งหน้าที่ควบคุม (ตัดสิน 12 ก.ย. 2569)
>
> | อุปกรณ์ | ใครคุม |
> |---|---|
> | **ปั๊ม** | **PLC** (S7-1200) |
> | **วาล์ว** | **ESP32** |
>
> **ผลที่ตามมาซึ่ง backend ต้องรับผิดชอบแทน PLC**
>
> วาล์วไม่ได้อยู่หลัง PLC แล้ว จึง **ไม่มีชั้น interlock ระดับฮาร์ดแวร์คอยกันคำสั่งอันตราย**
> เดิม PLC เป็นด่านสุดท้ายที่ปฏิเสธคำสั่งที่ไม่ปลอดภัยได้เองแม้ซอฟต์แวร์พลาด
>
> **backend ต้องบังคับกฎเหล่านี้ก่อนส่งคำสั่งลง MQTT ทุกครั้ง — ห้ามเชื่อว่าหน้าจอกรองมาแล้ว**
>
> 1. **ห้ามปิดวาล์วโซน VIP อัตโนมัติ** ไม่ว่าเงื่อนไขใด (`Zone.isVip`)
> 2. ตรวจ `ControlInterlock` ฝั่งเซิร์ฟเวอร์ก่อนส่งเสมอ
>    (หน้าจอตรวจให้แล้วก็จริง แต่ใครยิง API ตรงก็ข้ามหน้าจอได้)
> 3. ปิดวาล์วหลายโซนพร้อมกันต้องมีเพดาน ไม่งั้นแรงดันในท่อจะกระชาก
> 4. firmware ของ ESP32 valve node ควรมี **fail-safe**: ขาด MQTT เกิน N วินาที
>    ให้**คงตำแหน่งเดิม** ห้ามปิดเองหรือเปิดเอง
>
> ที่หน้าบ้านตรวจอยู่แล้วดูได้ที่ `lib/mock/control.ts` ฟังก์ชัน `valveInterlock()` และ `pumpInterlock()`
> — ใช้กฎชุดเดียวกัน ไม่ใช่เขียนใหม่คนละชุด

---

## 4. ต้องแก้ไฟล์ไหนตอนสลับจาก mock เป็น API จริง

### 4.1 จุดเดียวที่ต้องแก้จริง ๆ

**`lib/services/internal.ts`** — มีแค่ 2 ฟังก์ชัน

```ts
export async function respond<T>(produce: (state: MockState) => T): Promise<T>
export async function mutate<T>(apply: (state: MockState) => T): Promise<T>
```

ทุกฟังก์ชันใน `lib/services/` เรียกผ่านสองตัวนี้ เปลี่ยนให้เป็น `fetch()` แล้วไล่แก้แต่ละ
service ให้ยิง endpoint ตามตารางข้างบน **โดยไม่ต้องแตะ component แม้แต่ไฟล์เดียว**

### 4.2 ไฟล์ที่ต้องแก้ตามลำดับ

| ลำดับ | ไฟล์ | ทำอะไร |
|---|---|---|
| 1 | `lib/services/internal.ts` | เปลี่ยน `respond`/`mutate` เป็น fetch wrapper + จัดการ `ApiError` |
| 2 | `lib/services/subscription.ts` | เปลี่ยนจาก simulator เป็น WebSocket — `subscribeToUpdates()` signature ไม่ต้องเปลี่ยน |
| 3 | `lib/services/*.ts` (14 ไฟล์โดเมน) | เปลี่ยน body ของแต่ละฟังก์ชันให้ยิง endpoint จริง |
| 4 | `lib/services/settings.ts` | `readOverrides`/`writeOverrides` → GET/PATCH `/api/settings` |
| 5 | `lib/services/ai.ts` | **ลบ `getScenario` / `setScenario` / `SCENARIO_OPTIONS` ทิ้ง** — ของจริงไม่มีปุ่มสลับสถานการณ์ |
| 6 | `lib/services/auth.ts` | **เขียนใหม่ทั้งไฟล์** — ดูข้อควรระวังในหัวข้อ 2.2 และลบบัญชีสาธิตที่ hardcode ไว้ |
| 7 | `lib/services/metrics.ts` | ต่อ `/api/metrics/series` และ `/api/metrics/state-spans` ตามข้อ 2.11 — **เส้นใหม่ที่ยังไม่มีใครทำ** |

### 4.3 ไฟล์ที่ลบได้ทั้งหมดเมื่อต่อของจริงแล้ว

```
lib/mock/                          ทั้งโฟลเดอร์ (13 ไฟล์)
components/ai/scenario-switcher.tsx
```

ส่วนการ์ด "บัญชีสำหรับทดลอง" ในหน้า `/login` ต้องเอาออกด้วยเมื่อมี auth จริง

ตอนลบ `lib/mock/` ต้องเอา import ที่เหลือออกด้วย — ค้นด้วย `grep -rn "lib/mock" lib/`
(ตอนนี้ `components/` และ `app/` ไม่มี import จาก `lib/mock` เลย ตรวจแล้วเป็น 0)

### 4.4 สิ่งที่ไม่ต้องแตะ

- `components/` ทั้งหมด (73 ไฟล์)
- `app/` ทุกหน้า
- `lib/types.ts`, `lib/utils/`, `lib/i18n/`, `lib/config/`, `lib/hooks/`

---

## 4.5 ไฟล์ที่เกี่ยวกับหน้าตา — ทีมหลังบ้านไม่ต้องแตะ

Phase 7 เปลี่ยนสีและฟอนต์ทั้งระบบให้เป็น Corporate Identity ของ Kasetphand
ทุกอย่างอยู่ในชั้นการแสดงผลล้วน **ไม่กระทบ contract ของ API แม้แต่ field เดียว**

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/config/theme.ts` | **จุดเดียวในโค้ดที่เก็บค่า hex** — บันไดสี CI, ขั้นต่อขยายสำหรับ dark mode, สีแบรนด์ของ LINE |
| `app/globals.css` | semantic token ทั้งหมดในรูป HSL พร้อมคอมเมนต์ hex กำกับทุกตัว (มี 2 ชุด: `:root` และ `.dark`) |
| `tailwind.config.ts` | ผูกชื่อคลาสเข้ากับตัวแปร CSS ข้างบน |
| `app/fonts/` | Montserrat (ละติน/ตัวเลข) + IBM Plex Sans Thai — self-host ทั้งคู่ พร้อม `OFL.txt` |
| `components/ui/status-badge.tsx` | ป้ายสถานะกลาง — ห้าม component อื่นประกอบสีสถานะเอง |
| `components/layout/brand-logo.tsx` | จุดเดียวที่ render โลโก้องค์กร |
| `scripts/check-colors.mjs` | ตัวตรวจสีอัตโนมัติ รันด้วย `npm run check:colors` (ใช้ Node ล้วน ไม่มี dependency) |

สเปกเต็มอยู่ที่ `docs/BRANDING_SPEC.md` และบันทึกการตัดสินใจอยู่ที่ `docs/DESIGN_PLAN.md`

## 5. ข้อควรระวังที่พบระหว่างทำ

| เรื่อง | รายละเอียด |
|---|---|
| **หน่วยของ score** | `AnomalyEvent.score` 0–1 แต่ `MaintenancePrediction.healthScore` 0–100 และ**ทิศทางกลับกัน** (score สูง = แย่, healthScore สูง = ดี) |
| **`Tank.deviceId` เป็น null ได้** | ปกติทุกถังมีเซนเซอร์ `levelSource: 'sensor'` — `null` + `'manual'` เป็นทางถอยตอนเซนเซอร์เสีย UI รองรับทั้งสองแบบแล้ว |
| **บ่อสำรองแปลงหน่วยด้วยตาราง** | เซนเซอร์ให้ค่าความลึกเท่านั้น และ `shape: 'pond'` มีหน้าตัดไม่คงที่ ต้องแปลงผ่าน `levelToVolumeTable` ไม่ใช่ `level × area` |
| **PLC มี 2 ตัว คนละโปรโตคอล** | S7-1200 ใช้ `s7comm` พอร์ต 102 / FX3G ใช้ `mc_protocol` พอร์ต 5551 |
| **`Device.fieldbus`** | แยกจาก `protocol` — ESP32 ที่ปั๊มอ่าน PZEM ผ่าน `modbus_rtu` แล้วส่งขึ้นด้วย `mqtt` |
| **วันจดมิเตอร์ ≠ วันเริ่มรอบบิล** | `meterReadingDay` กับ `billingCycleStartDay` เป็นคนละวัน |
| **โซน VIP** | `Zone.isVip` — ห้ามตัดน้ำอัตโนมัติ หน้าจอบังคับยืนยันสองชั้นก่อนสั่งปิด |
| **ปั๊มหลักสลับเวร ไม่ได้แบ่งโซน** | ปั๊ม 1 กับ 2 จ่ายทุกโซนเหมือนกัน ผลัดกันเดินตัวละ 12 ชม. ห้ามบวกอัตราไหลรวมกัน |
| **Δstorage ต้องรวมบ่อสำรอง** | บ่อสำรองรับน้ำจากประปาโดยตรง ไม่ได้ต่อจากถัง 1 |
| **จำนวนมิเตอร์ยังไม่สรุป** | ห้าม hard-code จำนวนโซนที่ไหนทั้งสิ้น |
| **เขตเวลาต้องเป็นตัวเดียวกันทั้งระบบ** | ตัด bucket และพิมพ์วันที่ต้องใช้ `SystemSettings.general.timezone` ค่าเดียวกัน ถ้าตัดด้วย UTC แต่พิมพ์ด้วยเวลาเครื่อง แท่ง "1 ก.ย." จะขึ้นป้ายว่า 31 ส.ค. บนเครื่องที่ตั้งเขตเวลาอื่น |
| **`/history` กับ `/metrics/series` คนละเรื่องกัน** | `/history` = ข้อมูล**ดิบ** ใช้กับกราฟจิ๋ว · `/metrics/series` = ข้อมูล**ที่รวมช่วงแล้ว** ใช้กับหน้าต่างดูย้อนหลัง ห้ามยุบสองเส้นนี้เข้าด้วยกัน |
| **ไม่มีข้อมูล ≠ ค่าเป็นศูนย์** | bucket ที่ไม่มีข้อมูลต้องส่ง `null` ห้ามส่ง `0` ไม่งั้นกราฟจะอ่านว่า "ใช้น้ำ 0" แทนที่จะเป็น "เซนเซอร์หลุด" |

---

## 6. วิธีรันโปรเจกต์

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # ตรวจว่า build ผ่าน
npx tsc --noEmit     # ตรวจ type
npm run lint
```

ระบบรันได้โดยไม่มีอินเทอร์เน็ต — ฟอนต์ IBM Plex Sans Thai bundle มาในโปรเจกต์แล้ว
(`app/fonts/`) และไม่มีการเรียก external URL ที่ไหนเลย
