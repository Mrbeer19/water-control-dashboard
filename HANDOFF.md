# HANDOFF.md — ส่งต่อให้ทีมหลังบ้าน

Frontend ของระบบมอนิเตอร์และควบคุมการใช้น้ำ ทำเสร็จครบทุกหน้าแล้ว ตอนนี้ทำงานบน mock data
ทั้งหมด เอกสารนี้บอกว่าต้องทำ endpoint อะไรบ้าง หน้าตา JSON เป็นยังไง และต้องแก้ไฟล์ไหน
ตอนสลับจาก mock เป็น API จริง

---

## 1. สิ่งที่ต้องรู้ก่อน

| เรื่อง | รายละเอียด |
|---|---|
| **สัญญาของ type** | `lib/types.ts` ไฟล์เดียว — 133 type ที่ทุกหน้าอ้างอิง ใช้เป็น source of truth |
| **จุดที่ต้องแก้** | `lib/services/` เท่านั้น — component ไม่เคยเรียก `lib/mock/` เลย (ตรวจแล้วเป็น 0) |
| **เวลา** | ISO 8601 พร้อม offset `+07:00` ยกเว้น `timestamp` ในจุดข้อมูลกราฟที่เป็น epoch milliseconds |
| **หน่วย** | ผูกกับชื่อ field เสมอ — `Liters`, `Lpm`, `CubicMeters`, `Celsius`, `Hpa`, `Hz`, `Kwh` |
| **ค่าที่ยังไม่มี** | ใช้ `null` เสมอ ห้ามใช้ `0` หรือ `""` แทนความว่าง |
| **On-premise** | ทุกอย่างต้องอยู่ใน LAN ของโรงงาน ไม่มี route ออกอินเทอร์เน็ต |

### ข้อตกลงเรื่องสถานะ

`EntityStatus` มีค่าเดียวทั้งระบบ: `'ok' | 'warning' | 'critical' | 'offline'`
ทุก entity ฮาร์ดแวร์ต้องมี `id`, `name`, `nameEn`, `status`, `lastSeen`, `updatedAt` (ดู `BaseEntity`)
ส่วนเรกคอร์ด (alert, command, schedule) ใช้ `BaseRecord` ซึ่ง **ไม่มี** `status`

---

## 2. Endpoint ที่ต้องทำ

รวม 95 จุดจาก `TODO(backend)` ในโค้ด ค้นได้ด้วย `grep -rn "TODO(backend)" lib/services/`

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
| GET | `/api/meters` | `WaterMeter[]` (มิเตอร์ 8 โซน) |
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
> 5. `demoAccounts()` ใน `lib/services/auth.ts` ต้องลบทิ้ง

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
| `plant/water/valve/<valveId>/cmd` | gateway → PLC | เปิด/ปิด/เปอร์เซ็นต์ |
| `plant/water/valve/<valveId>/feedback` | PLC → gateway | ตำแหน่งจริงหลังสั่ง |
| `plant/water/pump/<pumpId>/cmd` | gateway → PLC | เดิน/หยุด/โหมด |
| `plant/water/pump/<pumpId>/feedback` | PLC → gateway | สถานะจริงหลังสั่ง |

**`feedback` topic คือหัวใจของหน้า Control** — ถ้าไม่มี คำสั่งจะค้างที่ `awaiting_feedback`
จนหมดเวลาแล้วขึ้น timeout ซึ่งเป็นพฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก

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
| 6 | `lib/services/auth.ts` | **เขียนใหม่ทั้งไฟล์** — ดูข้อควรระวังในหัวข้อ 2.2 และลบ `demoAccounts()` ทิ้ง |

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
