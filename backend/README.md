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

## ข้อตกลงที่ห้ามพลาด

- **`null` คือ null** ห้ามแปลงเป็น `0` ที่ชั้นไหนก็ตาม
- **เขตเวลาอ่านจาก `settings.general.timezone`** ห้าม hardcode · วันเริ่ม 00:00 +07:00 สัปดาห์เริ่มวันจันทร์
- **ห้าม hardcode จำนวนโซนหรือจำนวนมิเตอร์** อ่านจาก DB เสมอ
- **ปริมาตรถังต้องผ่าน `tank_volume()`** ห้ามใช้ `level × area`
- **อัตราค่าน้ำ/ค่าไฟอ่านจาก `tariffs` ตาม `effective_from`** ห้าม hardcode
