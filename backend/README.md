# backend — ระบบมอนิเตอร์และควบคุมการใช้น้ำ

service ฝั่งหลังของ dashboard ใน repo นี้ รันทั้งหมดบน gateway `10.20.10.2` ด้วย docker compose
**ไม่มีทางออกอินเทอร์เน็ต** image ทุกตัวปักด้วย digest

```
ESP32 × 11 + PLC × 2 → MQTT plant/water/… (ทุก 2 วิ, QoS 1)
  → mosquitto → ingest → TimescaleDB → FastAPI → nginx → dashboard
```

> ★ backend เป็น service แยก **ห้ามสร้างไฟล์ใน `app/api/`** ของ Next.js
> เพราะเดโม build ด้วย `output: 'export'` ซึ่งอยู่ร่วมกับ route handler ไม่ได้

## เริ่มใช้งานครั้งแรก

```bash
cd backend
make env        # สร้าง .env แล้วแก้รหัสทุกตัว
make passwd     # สร้าง mosquitto/passwd จาก mosquitto/acl + .env
make up         # ขึ้นทุก service และรอจน healthy
```

| service | พอร์ตบนเครื่อง | หมายเหตุ |
|---|---|---|
| `timescaledb` | `127.0.0.1:5432` | TimescaleDB 2.30.0 / PostgreSQL 17.11 · schema สร้างจาก `db/*.sql` ตอน volume ว่าง |
| `mosquitto` | `1883` | ต้องล็อกอิน · สิทธิ์ต่ออุปกรณ์อยู่ใน `mosquitto/acl` |
| `redis` | ไม่เปิด | ค่าล่าสุด + pub/sub |
| `nginx` | `80` (ตั้ง `NGINX_PORT` ได้) | `/api` → FastAPI · อย่างอื่น → frontend |

> `db/*.sql` ทำงาน**ครั้งเดียวตอน volume ว่าง** แก้ schema แล้วต้อง `make reset` (ลบข้อมูลทิ้ง)
> ใช้ได้เฉพาะช่วงพัฒนา — หลัง deploy จริงต้องทำเป็นไฟล์ migration (ดู `DECISIONS.md` D-06)

## โครงไฟล์

```
backend/
├── docker-compose.yml · .env.example · Makefile
├── README.md · DECISIONS.md          ← ข้อที่ตัดสินเองพร้อมเหตุผล
├── db/        01_schema · 02_telemetry · 05_functions · 06_seed (.sql)
├── mosquitto/ mosquitto.conf · acl   (passwd สร้างเอง ไม่ขึ้น repo)
├── nginx/     nginx.conf
└── scripts/   gen_passwd.sh
```

## ตรวจว่าเฟส 1 ใช้ได้

```bash
make psql
```
```sql
\dt
SELECT hypertable_name FROM timescaledb_information.hypertables;   -- 6 ตาราง
SELECT tank_volume('tank-3', 1.25);      -- 120000 (interpolate ระหว่าง 92,000 กับ 148,000)
SELECT water_cost(45);                   -- 954.98 = (30×17 + 15×19.50 + 90) × 1.07 ไม่ใช่ 45 × 19.50
```

ทดสอบว่าอุปกรณ์ส่งค่าแทนตัวอื่นไม่ได้:
```bash
# บ่อสำรองพยายามส่งค่าในนามถัง 1 → broker ตอบ Not authorized และไม่มีใครได้รับ
mosquitto_pub -V mqttv5 -q 1 -u dev-esp32-pond -P <รหัส> -t plant/water/tank/tank-1/telemetry -m x
```

## ingest — MQTT → TimescaleDB

`ingest` subscribe `plant/water/#` แล้วเขียนเป็นก้อน (200 แถว หรือ 1 วินาที) · เปิด `http://127.0.0.1:8080/health` และ `/metrics`

| ขั้น | ทำอะไร |
|---|---|
| router | แกะ topic → ตาราง (`meter/main` = entity `meter-main`) |
| normalize | ค่าที่ไม่มี = `null` · เกินช่วงทางกายภาพ = `null` แต่ยังเก็บแถว · `at` ไม่มี offset = ทิ้งทั้งข้อความ |
| derive | ถัง: `volume_l = tank_volume()` ใน DB · env: `heat_index_c` |
| rules | เกินเกณฑ์ **3 รอบติด** ถึงเปิด alert · ปกติ 3 รอบติดถึงปิด (`alerts.kind` = `AlertCode`) |
| states | `pump_run_state` · `online_state` ลง `state_spans` |
| liveness | ทาง A: LWT · ทาง B: เงียบเกิน 30 วิ (ตรวจทุก 5 วิ) → `DEVICE_OFFLINE` |
| ทนความล้มเหลว | DB ล่ม → `/data/spool/*.ndjson` แล้ว replay เอง · broker ล่ม → reconnect แบบ backoff |

### สัญญา payload (⚠️ รอทีมฮาร์ดแวร์ยืนยันชื่อ field — ดู `DECISIONS.md` D-13)

ทุก telemetry: `{"deviceId": "...", "at": "2026-09-13T13:45:00+07:00", "seq": 123?, "values": {...}}`

| topic | `values` |
|---|---|
| `tank/<id>/telemetry` | `levelMeters` `flowInLpm` `flowOutLpm` |
| `pump/<id>/telemetry` | `voltage` `currentAmp` `powerWatt` `energyKwh` `flowLpm` `pressureBar` `vfdHz` `runState` |
| `meter/<id>/telemetry` · `meter/main/telemetry` | `pulseCount` `volumeM3` `flowLpm` `inletPressureBar` |
| `env/<id>/telemetry` | `temperatureC` `humidityPct` `pressureHpa` `lux` `rainMm` (ฝนต่อรอบส่ง) |
| `power/<id>/telemetry` | `phases: {"L1": {...}, "L2": {...}, "L3": {...}}` หรือ `{"single": {...}}` แต่ละเฟสมี `voltage` `currentAmp` `powerWatt` `energyKwh` `pf` `frequencyHz` |
| `device/<id>/status` | (ไม่อยู่ใน `values`) `rssi` `uptimeSeconds` `freeHeapBytes` `reconnectCount` `lastError` · LWT = `{"deviceId": "...", "online": false}` retained |

## simulator และสถานการณ์ทดสอบ

```bash
# เดินข้อมูล 28 stream แบบเวลาจริงต่อเนื่อง (ใน docker)
docker compose -f docker-compose.yml -f docker-compose.sim.yml up -d

# เติมข้อมูลย้อนหลังเร็ว ๆ จากเครื่อง (ต้องมี .venv)
set -a; . ./.env; set +a
.venv/bin/python -m simulator.plant --fast --start 2026-09-01T00:00:00+07:00 --duration 86400 \
  [--scenario night_leak] [--scenario pump_degrading]

make test                        # unit test ไม่ต้องมี docker
tests/run_scenarios.sh S9        # สถานการณ์เดียว (ต้อง make up และปิด simulator ก่อน)
tests/run_scenarios.sh all       # S1–S14 ทั้งชุด (~20 นาที) รายงานอยู่ที่ data/scenario-report.xml
```

## ข้อมูลกราฟรวมช่วง — `/api/metrics/series` · `/api/metrics/state-spans`

```
raw hypertable ──► *_5m ──► *_1h ──► *_1d        (continuous aggregate ซ้อนกัน ตัดขอบตาม settings.general.timezone)
                    ▲         ▲         ▲
 raw           minute_5/15   hour   day · week · month · year      ← granularity ที่ขอ
```

| กฎ | ทำที่ไหน |
|---|---|
| ชั้นบนเก็บ `sum` + `count` ไม่เก็บ `avg` → avg ถ่วงน้ำหนักถูกต้องแม้ช่วงที่บอร์ดหลุด | `db/07_caggs.sql` |
| `minAt`/`maxAt` = `first(time, ค่า)` / `last(time, ค่า)` | `db/07_caggs.sql` |
| **`counter.delta = last(N) − last(N−1)`** ข้าม bucket · รีเซ็ต → `resetDetected` ไม่ติดลบ | `api/series.py` `build_points()` |
| กติกาช่วง ↔ ความละเอียด · เพดาน 1,000 จุด (ยกเว้น raw ≤ 1 ชม.) → 400 | `api/buckets.py` = พอร์ตตรงตัวของ `lib/utils/time-buckets.ts` |
| bucket ครบทุกช่วง ช่วงว่างเป็น `null` + `count: 0` | `api/series.py` LEFT JOIN จากโครง bucket |
| span สถานะต่อกันไม่มีรู · อุปกรณ์ offline = `no_data` | `api/series.py` `build_timeline()` |

```bash
# สร้าง db/07_caggs.sql ใหม่หลังแก้ api/metric_registry.py (ห้ามแก้ SQL มือ) แล้ว make reset
.venv/bin/python scripts/gen_caggs.py

# ตรวจว่า api/buckets.py ยังตรงกับ time-buckets.ts (ต้องรันใหม่ทุกครั้งที่ไฟล์ .ts เปลี่ยน)
node scripts/gen_buckets_golden.mjs && .venv/bin/pytest tests/test_buckets_parity.py

# เกณฑ์รับงานเฟส 3 ทั้ง 13 ข้อ (ต้อง make up ก่อน)
.venv/bin/pytest -m integration tests/test_series_parity.py -v
```

> ★ **นำเข้าข้อมูลเก่ากว่าหน้าต่าง refresh** (5 นาที 14 วัน · 1 ชม. 60 วัน · 1 วัน 365 วัน) ต้องสั่งเอง
> ไม่งั้นกราฟช่วงนั้นว่าง — ดู `DECISIONS.md` D-24
> ```sql
> CALL refresh_continuous_aggregate('pump_5m', '2025-01-01', '2025-03-01');  -- แล้วตามด้วย _1h และ _1d
> ```

## endpoint รายโดเมน (อ่านอย่างเดียว) — `/api/tanks` … `/api/system/summary`

path และรูป response ตรงกับ `TODO(backend)` ใน `lib/services/*.ts` และ type ใน `lib/types.ts`

| ชั้น | ไฟล์ | หน้าที่ |
|---|---|---|
| ทะเบียน + ค่าตั้ง (cache 5 วินาที) | `api/registry.py` | entity · อุปกรณ์ · โซน · เกณฑ์ · settings จาก DB — ไม่มีจำนวนตายตัวในโค้ด |
| ค่าล่าสุด | `api/latest.py` | Redis `latest:<id>` ก่อน ถ้าไม่มีถอยไปแถวล่าสุดใน DB |
| ปริมาณสะสม · ค่าน้ำขั้นบันได · รอบบิล · น้ำสูญหาย | `api/usage.py` | ใช้ `fetch_buckets` + `build_points` ชุดเดียวกับกราฟ ตัวเลขรายงานจึงตรงกับกราฟ |
| ประกอบรูปตาม `lib/types.ts` | `api/domain_water.py` · `api/domain_site.py` | สถานะใช้ตรรกะเดียวกับ `statusFromRange()` / `worstStatus()` |
| route | `api/routes_domain.py` | ทุก endpoint อ่านอย่างเดียวตอบ `Cache-Control: max-age=1` |

```bash
make contract   # ยิงทุก endpoint แล้วคอมไพล์ response จริงเทียบ lib/types.ts ด้วย tsc (make up + make sim ก่อน)
```

> field ขาด · field เกิน · null ในที่ห้าม null · string นอก union → tsc ล้ม · ไฟล์ที่สร้างอยู่ `data/contract/generated.ts`
> ข้อตกลงที่หน้าบ้านต้องรู้อยู่ใน `docs/BACKEND_CONTRACT_NOTES.md` ข้อ 13–19 · เหตุผลอยู่ใน `DECISIONS.md` D-26 ถึง D-34

## การแจ้งเตือน — `/api/alerts` · `/api/notifications` · service `notifier`

```
ingest (เกณฑ์ debounce 3 รอบ) ──► alerts ──► notifier (ทุก 2 วินาที) ──► notification_log ──► email · buzzer · webhook
                                     ▲                                                      (line · sms ปิดไว้)
                            /api/alerts/:id/acknowledge ──► alert_acknowledgements + audit_log
```

| เรื่อง | ทำที่ไหน |
|---|---|
| ข้อความตาม `AlertCode` (ครบทุกรหัสใน `lib/types.ts` — มีเทสตรวจ) · preview = ข้อความที่ส่งจริง | `api/alerts.py` |
| ขั้นต่ำ · ช่วงเงียบ · ยกระดับเมื่อไม่มีคนรับทราบ · snooze · ลองซ้ำ 3 ครั้ง | `api/notifier/dispatcher.py` |
| ช่องทางแบบ plugin | `api/notifier/channels.py` |
| เกิดซ้ำภายในหน้าต่างกันสแปม = แถวเดิม นับเพิ่ม | `ingest/writer.py` (`alert_open`) |

```bash
make integration                       # series parity + วงจรชีวิต alert ครบ (เปิด → ส่ง → รับทราบ → ปิด → เกิดซ้ำ)
docker compose logs -f notifier        # ดูผลการส่งแต่ละช่องทาง
```

> อีเมลใช้ได้เมื่อตั้ง `SMTP_HOST` ใน `.env` · บัซเซอร์ใช้ topic `plant/water/buzzer/cmd` — ดู `docs/BACKEND_CONTRACT_NOTES.md` ข้อ 23

## เข้าสู่ระบบและค่าตั้ง — `/api/auth` · `/api/settings`

```bash
make password NAME=admin      # ★ seed ไม่มีรหัสผ่าน ต้องตั้งก่อนล็อกอินครั้งแรก (argon2 · อย่างน้อย 10 ตัว)
make settings-golden          # สร้างค่าอ้างอิงจาก validateSettings() ของหน้าบ้านใหม่ เมื่อ lib/services/settings.ts เปลี่ยน
```

| เรื่อง | ทำที่ไหน |
|---|---|
| รหัสผ่าน argon2 · cookie httpOnly · หมดอายุตาม `sessionTimeoutMinutes` · ล็อกชื่อผู้ใช้หลังผิด 5 ครั้ง | `api/auth.py` |
| สิทธิ์: อ่านเปิด · เขียน alert = ผู้ที่ล็อกอิน/operator · ค่าตั้ง = admin | `auth.AnyUser` / `Operator` / `Admin` |
| ประกอบ `SystemSettings` จาก settings + thresholds + tariffs · กฎตรวจชุดเดียวกับหน้าจอ | `api/settings.py` |
| ค่าตั้งต้นของ reset = สำเนาที่ seed เก็บไว้ (`*_factory`) | `db/06_seed.sql` ท้ายไฟล์ |

> LINE Channel Access Token อยู่ในตาราง `settings_secrets` และไม่เคยถูกส่งกลับทาง API (ตอบ `••••` + 4 ตัวท้าย)

## ข้อมูลสด — `WS /api/stream`

```
ingest ─PUBLISH─► redis ─► Hub ใน api (ทุก 2 วินาที ประกอบเฉพาะ entity ที่มีข้อความเข้า) ─► client ละไม่เกิน 1 ข้อความ/2 วินาที
```

- หนึ่งข้อความ = `RealtimeEvent[]` entity ทั้งก้อนจากฟังก์ชันชุดเดียวกับ REST · เนื้อหาไม่เปลี่ยนไม่ส่ง
- `?channels=telemetry,alerts,commands,system` · ไม่มีใครเชื่อมต่อ = ไม่แตะ DB
- วัดเกณฑ์ข้อ 5 จริง: `make integration` (ไฟล์ `tests/test_stream_api.py` พิมพ์อัตรา ingest เทียบจำนวนข้อความ)

## ผลจากทีม AI — `/api/ai/*`

```
บริการ AI ─POST (Bearer AI_INGEST_TOKEN)─► ตรวจตาม docs/AI_CONTRACT.md ─► ai_anomalies · ai_forecasts · ai_maintenance · ai_metrics
                                                                         └─► severity ≥ warning ─► alert ANOMALY_DETECTED ─► notifier
หน้าจอ ◄─GET─ เฉพาะ field ที่ทีม AI ส่งมาจริง                          └─► stream event `anomaly`
```

- backend ไม่มีโมเดลใด ๆ — แค่รับ ตรวจสัญญา เก็บ และเสิร์ฟ (`api/ai.py`)
- ตั้ง `AI_INGEST_TOKEN` ใน `.env` แล้วส่งให้ทีม AI · ว่าง = ส่งผลได้เฉพาะ admin ที่ล็อกอิน

## การสั่งงาน — `/api/control/*` · service `dispatcher`

```
POST /api/control/valve/:id ─► สิทธิ์ + PIN ─► ★ interlock (กฎจาก interlock_rules · ทีละคำสั่ง)
        │                                        ├─ ไม่ผ่าน → commands(rejected) + audit_log → 409
        │                                        └─ ผ่าน → commands(pending) + audit_log
        ├─► MQTT  valve → ESP32 · pump/pressure → PLC ─► 202 ทันที
        ▼
dispatcher ◄─ …/feedback ─ อุปกรณ์     ได้ ≤ 10 วินาที → confirmed + latency_ms · ไม่ได้ → timeout (ไม่ทราบผล)
dispatcher ─ ทุก 10 วินาที ─► ตารางเวลา (สั่งในนาม schedule:<id> = ระบบอัตโนมัติ)
```

```bash
make password NAME=somchai PIN=1   # PIN 4 หลักสำหรับหน้า Control (seed ไม่มี PIN ตั้งต้น)
make integration                   # รวมเกณฑ์รับงานเฟส 5 ทั้ง 8 ข้อ (ปิด simulator ชั่วคราวแล้วเปิดคืนเอง)
```

| เรื่อง | ทำที่ไหน |
|---|---|
| วิธีตรวจของกฎ (แปลงจาก `lib/mock/control.ts`) · ไม่รู้จักวิธีตรวจ = ระงับคำสั่ง | `api/interlock.py` |
| ลำดับสั่งงาน · โทเคนยืนยันสองชั้น · feedback · timeout · ตารางเวลา | `api/control.py` |
| กฎ ข้อความ และพารามิเตอร์ (เปิด/ปิด/แก้ได้โดยไม่แก้โค้ด) | ตาราง `interlock_rules` (`db/06_seed.sql`) |

## รายงาน — `/api/reports/*`

```
counter_total() / fetch_buckets + build_points ── ชุดเดียวกับ /api/metrics/series ──► ยอดในรายงาน = ผลรวมบนกราฟ
tariffs (อัตรา ณ วันเริ่มช่วง) ─► ขั้นบันไดจากยอดรวมทั้งช่วง ─► เฉลี่ยลงรายวัน/รายโซนตามสัดส่วน
meter_readings ─► รอบจดจริง (anchor=meter_reading) · หน่วยออกบิล = เลขครั้งนี้ − ครั้งก่อน
```

| endpoint | ตอบ | หมายเหตุ |
|---|---|---|
| `GET /api/reports/billing?utility=water\|electricity&from=&to=` | `BillingEstimate` | ไม่ระบุช่วง = รอบบิลปัจจุบัน (`billing.billingCycleStartDay`) |
| `GET /api/reports/usage?from=&to=&preset=` | `UsageReport` | เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน |
| `GET /api/reports/monthly?months=&anchor=calendar\|meter_reading` | `MonthlyUsagePoint[]` | ยอดจากมิเตอร์หลัก |
| `GET /api/reports/meter-readings?meterId=&limit=` | `MeterReading[]` | ไม่ระบุ = มิเตอร์หลัก |
| `GET /api/reports?type=&from=&to=` | `ReportDefinition` | `daily` `monthly` `zone_comparison` `department_cost` `energy` `leak_audit` |

- `from`/`to` รับ epoch ms หรือ ISO ที่มี offset · ขยายเป็นวันเต็มตามเวลาโรงงาน (D-72)
- เกณฑ์รับงานข้อ 3–6: `make integration` (`tests/test_reports_api.py`)

## worker — น้ำสูญหาย (service `worker`)

```
ทุกขอบ 5 นาที ─► หน้าต่าง 60 นาทีล่าสุด: มิเตอร์หลัก − Σโซน − Δถังทุกใบ (รวมบ่อสำรอง)
                 ├─ มิเตอร์/ถังตัวใดไม่มีข้อมูล → ไม่ตัดสิน (% = null)
                 ├─ plant_metrics ─► /api/metrics/series?sourceType=system&metric=unaccounted_percent
                 └─ ≥ 8% เตือน · ≥ 15% วิกฤต ─► alert UNACCOUNTED_WATER_HIGH ─► notifier
```

```bash
docker compose exec worker python -m api.worker unaccounted --end 2026-09-13T23:40:00+07:00 --window 30
make integration   # เกณฑ์ข้อ 1–2: tests/test_worker_api.py เดิน simulator ย้อนหลังเมื่อวาน แล้วลบข้อมูลที่ฉีดทิ้งเอง
```

## ข้อตกลงที่ห้ามพลาด

- **`null` คือ null** ห้ามแปลงเป็น `0` ที่ชั้นไหนก็ตาม
- **เขตเวลาอ่านจาก `settings.general.timezone`** ห้าม hardcode · วันเริ่ม 00:00 +07:00 สัปดาห์เริ่มวันจันทร์
- **ห้าม hardcode จำนวนโซนหรือจำนวนมิเตอร์** อ่านจาก DB เสมอ
- **ปริมาตรถังต้องผ่าน `tank_volume()`** ห้ามใช้ `level × area`
- **อัตราค่าน้ำ/ค่าไฟอ่านจาก `tariffs` ตาม `effective_from`** ห้าม hardcode
