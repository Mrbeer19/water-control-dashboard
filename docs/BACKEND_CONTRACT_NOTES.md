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
