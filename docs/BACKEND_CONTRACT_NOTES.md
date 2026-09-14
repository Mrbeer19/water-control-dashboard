# BACKEND_CONTRACT_NOTES.md — ข้อที่ backend ขอแก้/ขอยืนยันสัญญา

เอกสารนี้แนบกับ PR ของ `backend/` · ทุกข้อ **backend ไม่ได้แก้ไฟล์ของทีมอื่นเอง** (`lib/types.ts`, `lib/config/`, `lib/hooks/`)
เหตุผลเต็มของแต่ละข้ออยู่ใน `backend/DECISIONS.md` และ `PROBLEMS.md` (นอก repo)

| สถานะ | ความหมาย |
|---|---|
| 👉 | ทีมที่ระบุต้องลงมือ |
| ❓ | ขอให้ยืนยัน — backend ทำตามที่เขียนไว้แล้ว ถ้าไม่ตรงบอกได้ |
| ℹ️ | แจ้งให้ทราบ ไม่ต้องทำอะไร |

---

## ถึงทีมหน้าบ้าน

### 1. 👉 `CounterBucket.delta` — แก้ JSDoc ใน `lib/types.ts` (PROBLEMS P-01)

JSDoc ปัจจุบันเขียน `delta = last − first ของช่วง` ซึ่งทำให้ผลรวมรายชั่วโมง ≠ รายวันบนตัวนับสะสมจริง
(น้ำ/ไฟที่ไหลระหว่างข้อความสุดท้ายของชั่วโมงหนึ่งกับข้อความแรกของชั่วโมงถัดไปหายทุกรอยต่อ)

backend ใช้ **`delta(N) = last(N) − last(N−1)`** — ผลรวมทุกระดับตรงกันเอง
ค่าลดลง = รีเซ็ต → `resetDetected: true`, `delta = last(N)` ไม่ติดลบ

**ขอแก้คอมเมนต์อย่างเดียว** type signature และ UI ไม่เปลี่ยน
`npm run check:series` ผ่านกับ mock เพราะ mock อินทิเกรตอัตราไหล ไม่ได้เป็นตัวนับสะสม — จึงจับเรื่องนี้ไม่ได้
ฝั่ง backend มี `backend/tests/test_series_parity.py` ที่ใช้ตัวนับสะสมจริงตรวจแทน

### 2. 👉 เพิ่ม 3 คีย์เข้า `MetricKey` + `lib/config/metrics.ts` (P-07 / P-08)

| คีย์ | kind | หน่วยที่ backend ตอบ | ใช้กับ sourceType |
|---|---|---|---|
| `pump_run_state` | `state` | `""` | `pump` |
| `online_state` | `state` | `""` | ทุกชนิด (อ่านจากอุปกรณ์ที่วัดค่า) |
| `volume_cubic_meters` | `counter` | `m³` | `meter`, `zone` |

backend ตอบได้แล้วทั้งสามคีย์ ระหว่างที่หน้าบ้านยังไม่เพิ่ม หน้าจอจะ render ผ่าน `UNKNOWN_METRIC`

> ⚠️ `HANDOFF §2.11` เสนอ `volume_cubic_meters` เป็น `kind: amount` แต่ข้อมูลจริงเป็นเลขหน้าปัดสะสม
> backend จึงตอบเป็น **`counter`** (มี `delta`, `resetDetected`) ❓ ขอยืนยันว่ารับได้

### 3. ❓ `raw` ได้เกิน 1,000 จุด (DECISIONS D-23)

`PAIRING` ใน `time-buckets.ts` ให้ `raw` เป็นค่าเริ่มต้นของช่วง ≤ 1 ชม. = สูงสุด 1,800 จุด
ถ้า backend บังคับเพดาน 1,000 จุดกับ raw ด้วย หน้าจอค่าเริ่มต้นจะได้ 400
→ backend ใช้เพดาน 1,000 กับทุกระดับ **ยกเว้น raw** (ซึ่งถูกคุมด้วย PAIRING อยู่แล้ว)
ถ้าหน้าบ้านอยากให้ raw ไม่เกิน 1,000 จริง ต้องลดช่วง raw ใน `PAIRING` เหลือ ≤ 33 นาที

### 4. ℹ️ รายละเอียดของ `/api/metrics/series` ที่ควรรู้

- ขอเกินกติกา → **HTTP 400** รูป `ApiError` · `code` = `GRANULARITY_NOT_ALLOWED` (มี `details.suggested`) หรือ `TOO_MANY_POINTS`
- **ไม่ coerce granularity เงียบ ๆ แบบ mock** — หน้าบ้านควรเรียก `coerceGranularity()` ก่อนยิง (ทำอยู่แล้วใน UI)
- `from`/`to` ใน response เป็น ISO พร้อม offset ของเขตเวลาระบบ (`+07:00`) ส่วน mock ใช้ `Z` — เป็น ISO 8601 ทั้งคู่
- metric ที่ยังคำนวณไม่ได้ (`zone_outflow_lpm`, `unaccounted_percent`, `headcount`) ตอบ **404 `METRIC_NOT_AVAILABLE`** พร้อมเหตุผล ไม่เดาค่า
- เปลี่ยน `settings.general.timezone` แล้ว aggregate ยังเป็นเขตเวลาเดิม → **409 `AGGREGATE_TIMEZONE_MISMATCH`** จนกว่าจะสร้างใหม่
- เขตเวลาที่ offset ไม่ใช่ชั่วโมงเต็ม (เช่น `Asia/Kathmandu`) → **400 `TIMEZONE_NOT_WHOLE_HOUR`** (P-11) · ❓ ขอให้ล็อกตัวเลือกในหน้า Settings ด้วย
- `AmountBucket.max` ของ `rainfall` = **ปริมาณฝนสูงสุดของรายงานครั้งเดียว** (มม. ต่อรอบส่ง) ❓ ถ้าหน้าจอต้องการความหมายอื่นบอกได้

### 5. ℹ️ `/api/metrics/state-spans`

- span ต่อกันไม่มีรู · ผลรวม `durationMs` = `to − from` พอดี · ช่วงที่ไม่มีข้อมูล/อุปกรณ์ offline/อนาคต = `"no_data"`
- **backend ส่ง `to` เป็นตัวเลขเสมอ (ตัดที่ขอบช่วง) ไม่ส่ง `null`** — เพราะถ้าส่ง `null` ผลรวมจะไม่เท่ากับช่วงที่ขอเมื่อ `to` อยู่ในอนาคต
- รับพารามิเตอร์เสริม `metric` (ค่าเริ่มต้น: `pump` → `pump_run_state`, อื่น ๆ → `online_state`)

### 6. 👉 `use-live-data.ts` ต้อง debounce ก่อนต่อ WebSocket จริง (P-02) · ยืนยันรูป payload WS (P-03)

ยังไม่กระทบเฟสที่ส่งใน PR นี้ รายละเอียดอยู่ใน PROBLEMS.md — จะกลับมาคุยตอนทำ `/api/stream`

---

## ถึงทีมฮาร์ดแวร์

### 7. ❓ ชื่อ field ใน payload MQTT (DECISIONS D-13)

PROJECT_BRIEF §7.1 มีตัวอย่างแค่ถัง backend จึงกำหนดชื่อที่เหลือไว้ใน `backend/README.md` หัวข้อ "สัญญา payload"
ถ้า firmware ใช้ชื่ออื่น ingest จะ log `unknown_field` ให้เห็นทันที และแก้ได้ที่ `backend/ingest/normalize.py` ที่เดียว

### 8. ❓ `rainMm` เป็นปริมาณต่อรอบส่ง ไม่ใช่ค่าสะสม (D-09) · `pulseCount` สะสมข้ามการรีบูต (P-10)

ถ้า `pulseCount` นับใหม่ทุกครั้งที่บอร์ดรีบูต ทุกการรีบูตจะกลายเป็น `resetDetected` → ขอให้เก็บลง NVS

### 9. 👉 firmware ต้องเก็บค่าไว้ในบอร์ดตอน broker หลุด แล้วส่งตามเมื่อต่อได้

ทดสอบแล้ว (สถานการณ์ S8): ถ้าบอร์ดเก็บค่าไว้และส่งตาม ข้อมูลช่วงที่ broker ล่ม 60 วินาทีถึง DB ครบ 100%
ถ้าไม่เก็บ ช่วงนั้นหายถาวร — ไลบรารี MQTT ส่วนใหญ่ **ไม่คิวข้อความตอนหลุดให้เอง**

### 10. ❓ ขอเพิ่ม `seq` (int นับขึ้น ไม่รีเซ็ตข้ามการรีบูต) — ไม่บังคับ (P-09)

ไม่มีก็ทำงานได้ แต่ถ้ามีจะแยก "ข้อความหายระหว่างทาง" ออกจาก "บอร์ดไม่ได้ส่ง" ได้

---

## ถึงทุกทีม

### 11. ℹ️ `alerts.kind` ใช้ `AlertCode` ใน `lib/types.ts` ตรง ๆ (D-15)

`PUMP_OVERCURRENT`, `DEVICE_OFFLINE`, `ZONE_FLOW_HIGH`, … ไม่มีตารางแปลงรหัสอีกชั้น

### 12. ❓ LINE ใช้ไม่ได้บนระบบที่ไม่มีอินเทอร์เน็ต (P-06)

ต้องตัดสิน: ขอเปิดขาออกเฉพาะ `api-data.line.me:443` หรือใช้ SMTP ภายใน + บัซเซอร์อย่างเดียว
(จะทำ notifier เป็น plugin ไว้ให้สลับได้ในเฟส endpoint รายโดเมน)

---

## endpoint รายโดเมน (เฟส 4a) — ถึงทีมหน้าบ้าน

ทุก response ถูกคอมไพล์เทียบ `lib/types.ts` ด้วย tsc แล้ว (`make contract` ใน `backend/`) · path ตรงกับ `TODO(backend)` ทุกตัว

### 13. ℹ️ entity ที่ยังไม่มีข้อมูล: ตัวเลขเป็น 0 · `lastSeen` = 1970 · **`status` เป็น `offline` เสมอ** (D-27)

type บังคับ `number` จึงส่ง null ไม่ได้ → ขอให้ UI ดู `status` ก่อนแสดงตัวเลข (ซึ่งทำอยู่แล้วด้วยสีเทา)
field ที่เป็น `number | null` (เช่น `rssi`, `minutesToFull`, ฝนของจุดในอาคาร) ส่ง null ตามจริง

### 14. ℹ️ `/…/history` รับ `interval` (วินาที) หรือ `intervalSeconds` · `from`/`to` เป็น epoch ms หรือ ISO ที่มี offset (D-33)

ไม่ส่งช่วง = 1 ชั่วโมงล่าสุด · เกิน 2,000 จุด → 400 `TOO_MANY_POINTS` · metric ที่ entity นั้นไม่มี → 400 `METRIC_NOT_SUPPORTED`

### 15. ℹ️ `/api/zones/cost` · `/api/meters/unaccounted` · `/api/departments/usage` ไม่ส่ง `from`/`to` = รอบบิลปัจจุบัน

รอบบิลเริ่มตาม `billing.billingCycleStartDay` · ค่าน้ำรายโซนคิดขั้นบันไดจากปริมาณของโซนเอง (ผลรวมไม่เท่าบิลจริง — ตรงกับคอมเมนต์ใน `getZoneCosts()`)

### 16. ❓ ตำแหน่งวาล์วเป็น `open` จนกว่าจะมีระบบสั่งงาน (D-28) · ค่าระบบควบคุมแรงดันเป็นค่าตอนติดตั้ง (D-29)

ingest ยังไม่รับ feedback วาล์ว และยังไม่ได้อ่าน DB ของ PLC — ทั้งสองอย่างมาพร้อมเฟสระบบควบคุม

### 17. ℹ️ PLC/HMI แสดง `offline` · reboot/firmware ตอบ 501 `NOT_IMPLEMENTED` · ping ตัดสินจากข้อความล่าสุด (D-30)

`pingDevice()` ได้ `latencyMs: null` เสมอ (ไม่ส่ง ICMP จาก container)

### 18. ℹ️ `/api/meters/daily?projection=true` ยังไม่มีจุดอนาคต (D-31) · `/api/pressure/headcount` ตอบ null ทั้งคู่

พยากรณ์รอผลจากทีม AI · จำนวนคนยังไม่มีแหล่งข้อมูล — UI ต้อง render ได้เมื่อไม่มีสองอย่างนี้

### 19. ℹ️ `SystemSummary.todayEnergyKwh` = พลังงานปั๊ม + ตู้ไฟรายแผนก (จากตัวนับจริง ไม่ใช่ `power × ชั่วโมง` แบบ mock)

---

## การแจ้งเตือน (เฟส 4b)

### 20. ℹ️ `messageTh` / `messageEn` / `unit` ของ alert มาจากเซิร์ฟเวอร์ตาม `AlertCode` · id ของ alert/ack/delivery เป็นเลขในรูป string

preview (`/api/alerts/:id/preview`) ประกอบด้วยฟังก์ชันเดียวกับที่ notifier ส่งจริง — ข้อความตรงกันทุกตัวอักษร

### 21. ℹ️ `POST /api/notifications/deliveries/:id/retry` คืน `deliveryState: 'queued'` ทันที ผลจริงมาในรอบถัดไป (≤ 2 วินาที)

ต่างจาก mock ที่คืน `delivered` เลย → UI ควรดึงรายการใหม่หลังกด · รายการที่ส่งถึงแล้วตอบ 409 `ALREADY_DELIVERED`

### 22. ℹ️ `/api/alerts` รับตัวกรองแบบ `?severity=critical,warning` หรือส่งชื่อซ้ำ · มี `departmentIds` · `from`/`to` เทียบกับ `raisedAt`

`occurrenceCount` > 1 = เหตุเดิมกลับมาภายในหน้าต่างกันสแปม (แถวเดิม ไม่แจ้งซ้ำ — D-35)

### 23. 👉 ถึงทีมฮาร์ดแวร์: บัซเซอร์ต้อง subscribe `plant/water/buzzer/cmd`

```json
{ "cabinet": "ตู้คอนโทรลหลัก", "alertId": "12", "code": "ENV_TEMP_HIGH", "severity": "critical",
  "sourceId": "env-control-cabinet", "pattern": "continuous", "at": "2026-09-14T16:54:43.000+07:00" }
```

`pattern` = `continuous` (วิกฤต) หรือ `beep` · ตู้ไหนดังดูจาก `cabinet` · ต้องเพิ่ม `topic read plant/water/buzzer/cmd` ใน ACL ของ ESP32 ที่ติดบัซเซอร์

### 24. ❓ ช่องทาง email ต้องมีเมลเซิร์ฟเวอร์ภายในโรงงาน (`SMTP_HOST`)

ถ้าไม่มี รายการ email จะขึ้น `failed` พร้อมเหตุผล ไม่ลองซ้ำ · LINE และ SMS ขึ้น `failed` พร้อมเหตุผลเช่นกันจนกว่าจะมีคนตัดสิน (P-06)

---

## เข้าสู่ระบบและค่าตั้ง (เฟส 4c)

### 25. ℹ️ เซสชันอยู่ใน cookie httpOnly `wcm_session` (path `/api`) — หน้าบ้านอ่าน token ไม่ได้และไม่ต้องเก็บเอง

login ไม่ผ่านตอบ 200 + `{ ok: false, errorTh, errorEn }` ตามสัญญา `signIn()` · `/api/auth/session` `/refresh` `/me` ตอบ `null` เมื่อไม่มีเซสชัน
วันหมดอายุมาจากเซิร์ฟเวอร์ (`sessionTimeoutMinutes`) ต่ออายุได้ไม่เกิน 12 ชั่วโมงจากตอนล็อกอิน

### 26. 👉 ตอนสลับเป็น API (เฟส 7) ต้องลบบัญชีสาธิตและ session ใน localStorage ของ `lib/services/auth.ts`

fetch ต้องส่ง cookie (`credentials: 'include'` หรือเรียกผ่าน proxy ที่ origin เดียวกัน)

### 27. ℹ️ endpoint ที่เขียนข้อมูลตอบ 401 `UNAUTHENTICATED` / 403 `FORBIDDEN`

`acknowledgedByUserId` และ `updatedByUserId` ในสัญญาเดิมไม่ใช้ตัดสินแล้ว — เซิร์ฟเวอร์ใช้ผู้ที่ล็อกอิน (ส่ง id คนอื่นมา = 403)
สิทธิ์: อ่านแล้ว = ผู้ที่ล็อกอิน · รับทราบ/ส่งซ้ำ = operator ขึ้นไป · ค่าตั้งทั้งหมด = admin

### 28. ℹ️ `PATCH /api/settings/:section` ไม่ผ่าน → 400 `SETTINGS_INVALID`

`details` = `{ "billing.vatPercent": "VAT ต้องอยู่ระหว่าง 0–100" }` ใช้ path เดียวกับ `SettingsFieldError` จึงผูกกับช่องในฟอร์มได้ตรง
กฎชุดเดียวกับ `validateSettings()` (ตรวจกับไฟล์ .ts จริง) บวกกฎชนิดข้อมูล/เขตเวลาของเซิร์ฟเวอร์ · `/import` ยังคืน `{ ok, errors }` เหมือนเดิม

### 29. ℹ️ เกณฑ์เตือนมาจากตาราง thresholds และขั้นอัตรามาจาก tariffs

แก้อัตรา = เพิ่มอัตราที่มีผลตั้งแต่วันนี้ (รายงานย้อนหลังยังใช้อัตราเดิม) · `id` / `name` ของขั้นอัตราเซิร์ฟเวอร์ตั้งให้
แก้เกณฑ์ในหมวดรายอุปกรณ์ (`tanks[].thresholdsPercent`) ไม่มีผล ต้องแก้ที่หมวด `thresholds` (D-48)

### 30. ❓ endpoint อ่านไม่ต้องล็อกอิน และ `departmentScopedAccess` ยังไม่บังคับ (D-41)

ทำไว้ให้จอแขวนผนังเปิดค้างได้ — ต้องตัดสินร่วมกันว่าจะให้จอแขวนผนังใช้บัญชีแบบไหน

### 31. ℹ️ `/api/settings/line/test` ตอบ `ok: false` + `message` ขึ้นต้น `offline_mode` · `/network/test` เปิด TCP จริงจากเครื่อง API

เขตเวลาที่ offset ไม่ใช่ชั่วโมงเต็ม (เช่น `Asia/Kathmandu`) และเขตที่ไม่ตรงกับข้อมูลรวมของกราฟ ถูกปฏิเสธ

---

## ข้อมูลสด (เฟส 4d)

### 32. ℹ️ `WS /api/stream` หนึ่งข้อความ = อาร์เรย์ `RealtimeEvent[]` ไม่เกิน 1 ข้อความต่อ 2 วินาที

```ts
socket.onmessage = (message) => {
  const events = JSON.parse(message.data) as RealtimeEvent[];   // entity ทั้งก้อน field ตรงกับ REST
};
```

ส่งเฉพาะ entity ที่เนื้อหาเปลี่ยน · ไม่มีอะไรเปลี่ยน = ไม่ส่ง · วัดจริงตอน ingest รับเต็มกำลัง: 10 ข้อความใน 20 วินาที
`subscribeToUpdates(listener)` แบบเดิมใช้ต่อได้ — เรียก listener หนึ่งครั้งต่อข้อความ · หลุดแล้วหน้าจอต้องต่อใหม่เอง (ใส่ backoff)

### 33. ℹ️ เลือก channel ด้วย `?channels=telemetry,alerts` (ไม่ระบุ = ทั้งหมด · ชื่อผิด = ปฏิเสธตอน handshake)

| channel | type ที่ได้ |
|---|---|
| `telemetry` | `tank` `pump` `valve` `zone` `meter` `main_meter` `sensor` `electric_node` `pressure_control` |
| `system` | `device` `connection` |
| `alerts` | `alert` `anomaly` |
| `commands` | `command_result` (มาพร้อมเฟสระบบควบคุม) |

### 34. 👉 ยืนยันรูปข้อความตาม P-03 และยังแนะนำ debounce ใน `use-live-data.ts` (P-02 ทาง ก.)

backend รวบแล้วก็จริง แต่หน้า `/` ยังดึง 17 fetcher ต่อหนึ่งข้อความ — จอเปิดค้างหลายเครื่องจะหนักตอนติดตั้งจริง
