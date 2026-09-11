# PROMPTS.md — ลำดับการสั่งงาน Claude Code

วางไฟล์ `CLAUDE.md` ไว้ที่ root ของโปรเจกต์ก่อน แล้วสั่งทีละ Phase ตามลำดับ
อย่ายิงรวดเดียวทั้งหมด — Claude Code จะทำหลวมและ type จะไม่สอดคล้องกัน

---

## Phase 0 — วางรากฐาน (ทำก่อนเสมอ)

```
อ่าน CLAUDE.md ก่อน แล้วทำ Phase 0 เท่านั้น อย่าเพิ่งสร้างหน้าใด ๆ

1. สร้างโปรเจกต์ Next.js 14 App Router + TypeScript strict + Tailwind + shadcn/ui
   ตั้งค่า self-host font (ใช้ next/font/local หรือ IBM Plex Sans Thai ที่ bundle มาในโปรเจกต์)
   ห้ามใช้ Google Fonts CDN

2. สร้าง lib/types.ts รวม TypeScript interface ทั้งหมดของระบบ:
   - Tank, Pump, Zone, WaterMeter, MainMeter
   - EnvironmentSensor, EnvironmentReading
   - Device (ESP32/PLC/gateway) — มี ip, vlan, mac, port, rssi, firmware, uptime, freeHeap, reconnectCount, lastError
   - Alert (severity: 'critical' | 'warning' | 'info'), AlertAcknowledgement, NotificationDelivery
   - ControlCommand, CommandResult (มี state: 'idle' | 'sending' | 'awaiting_feedback' | 'success' | 'timeout' | 'failed')
   - SystemSettings แยก sub-type ตามหมวดใน Setting
   - WaterTariffTier, BillingEstimate, AIForecast
   - TimeSeriesPoint สำหรับข้อมูลกราฟ
   ทุก entity ต้องมี id, name, status, lastSeen/updatedAt

3. สร้าง lib/services/ โดยแยกไฟล์ตาม domain (tanks, pumps, zones, meters, devices,
   environment, alerts, control, settings, reports)
   ทุกฟังก์ชัน return Promise และมีคอมเมนต์ // TODO(backend): ระบุ method + endpoint
   ที่คาดว่าจะใช้ เช่น GET /api/tanks, POST /api/control/pump/:id

4. สร้าง lib/mock/ ที่ generate ข้อมูลตาม hardware จริงใน CLAUDE.md
   พร้อม simulator ที่ทำให้ค่าขยับเองทุก 2 วินาที (ระดับน้ำ, flow rate, V/A/W, temp/humidity)
   ค่าต้องขยับสมจริง ไม่ใช่ random กระโดด

5. สร้าง lib/utils/format.ts และ lib/i18n/ (dictionary th/en)

6. สร้าง layout + Header + Sidebar + ThemeToggle + LangToggle
   Header แสดง: เวลาปัจจุบัน, สถานะการเชื่อมต่อ, badge "Local Mode", จำนวน alert ที่ยังไม่อ่าน
   หน้าอื่นทำเป็น placeholder ไปก่อน

จบแล้วรัน npx tsc --noEmit ให้ผ่าน แล้วสรุป type ทั้งหมดที่สร้างมาให้ดู
```

**สำคัญ:** ตรวจ `lib/types.ts` ให้เรียบร้อยก่อนไป Phase ถัดไป เพราะทุกหน้าจะอ้างอิงจากไฟล์นี้ ถ้าแก้ทีหลังจะต้องรื้อหลายจุด

---

## Phase 1 — หน้า Overview (หน้าแรก)

```
ทำหน้า app/page.tsx (Overview) ตามนี้ ใช้ type จาก lib/types.ts และดึงข้อมูลผ่าน lib/services/ เท่านั้น

1.1 ระดับน้ำ 3 ถัง — การ์ด tank gauge เป็น SVG แสดงระดับน้ำเป็นภาพ มี animation ระดับขยับ
    Tank 1 ถังใต้ดินหลัก 70,000 L / Tank 2 3,000 L / Tank 3 บ่อสำรอง 490,000 L
    แสดง ปริมาณปัจจุบัน (L), %, สถานะ (ปกติ/ต่ำ/วิกฤต), last update
    สีเปลี่ยนตาม threshold

1.2 ปั๊ม 3 ตัว (Pump 1, 2 = main / Pump 3 = VIP zone)
    สถานะ RUN / STOP / FAULT / OFFLINE
    ค่า V, A, W, kWh สะสม, ชั่วโมงทำงานสะสม
    sparkline การใช้พลังงาน 24 ชม.

1.3 มิเตอร์น้ำ 8 โซน สลับดูแบบตาราง/การ์ดได้ ชื่อโซนใช้ placeholder "Zone 1-8"
    Online/Offline (อิง lastSeen), อัตราไหลปัจจุบัน (L/min)
    ปริมาณสะสมวันนี้/เดือนนี้ (L และ m³)
    ค่าน้ำโดยประมาณเดือนนี้ (บาท) + จำนวนยูนิต
    % สัดส่วนการใช้เทียบทั้งโรงงาน

1.4 มิเตอร์หลัก (น้ำเข้าจากการประปา ท่อ 2")
    ตัวเลขใหญ่: ปริมาตรสะสม (m³), ยูนิตเดือนนี้, อัตราไหลปัจจุบัน
    ปริมาณน้ำเข้าวันนี้/เดือนนี้
    Unaccounted water = น้ำเข้า − ผลรวม 8 โซน แสดงตัวเลข + % + สีเตือน

1.5 ค่าน้ำที่ AI พยากรณ์เดือนนี้
    actual ถึงวันนี้ + forecast ถึงสิ้นเดือน + ช่วงความเชื่อมั่นเป็นแถบเงาบนกราฟ
    เทียบเดือนก่อน (% เพิ่ม/ลด)
    กราฟแท่งค่าน้ำแยกโซน + กราฟเส้นการใช้น้ำรายวัน

1.6 แถบ Alerts ล่าสุด 5 รายการ กดไปหน้า /alerts

1.7 สภาพแวดล้อม — จากเซนเซอร์ในพื้นที่เท่านั้น ห้ามเรียก weather API
    จุดติดตั้ง: ห้องปั๊ม, ตู้คอนโทรล, กลางแจ้ง
    ห้องปั๊ม/ตู้คอนโทรล: อุณหภูมิ (°C), ความชื้น (%RH)
    กลางแจ้ง: อุณหภูมิ, ความชื้น, ความกดอากาศ, ฝนสะสมวันนี้/เดือนนี้ (mm), ความเข้มแสง (lux)
    คำนวณและแสดง Heat index, Dew point, แนวโน้มความกดอากาศ 3 ชม. (ขึ้น/ลง/คงที่)
    sparkline 24 ชม., สถานะ Online/Offline ต่อ node
    กราฟซ้อน: อุณหภูมิภายนอก vs การใช้น้ำรายวัน

จัด layout ให้ตัวเลขสำคัญอ่านได้จากจอแขวนผนัง
```

---

## Phase 2 — หน้า Control

```
ทำหน้า app/control/page.tsx

- ปุ่ม ON/OFF ปั๊มแต่ละตัว + confirm dialog
- แยกสถานะปุ่มที่กด ออกจากสถานะจริงที่ feedback กลับมา
  ใช้ CommandResult state: sending → awaiting_feedback → success/timeout
  แสดง spinner ระหว่างรอ และขึ้น error ชัดเจนเมื่อ timeout
- โหมด Auto/Manual ต่อปั๊ม
- วาล์ว 8 โซน: เปิด/ปิด, % เปิด, animation ตอนกำลังเคลื่อนที่
- ปุ่ม emergency "ปิดวาล์วทุกโซน" และ "เปิดทุกโซน" (มี double confirm)
- Interlock UI: ปุ่ม disable พร้อมแสดงเหตุผล เช่น "ถังต้นทางต่ำกว่า 15%"
- ตั้งเวลาเปิด/ปิดล่วงหน้า (schedule) ต่อวาล์ว/ปั๊ม
- Audit log ด้านล่าง: ใคร/สั่งอะไร/เมื่อไร/ผลลัพธ์
- Modal ใส่ PIN ก่อนสั่งงาน (UI อย่างเดียว ไม่ต้องทำ auth จริง)

คำสั่งทุกอันต้องเรียกผ่าน lib/services/control.ts และมี TODO(backend) กำกับ
```

---

## Phase 3 — หน้า Device Status + Infographic

```
ทำ 2 หน้า

A. app/devices/page.tsx
ตารางทุก node: ชื่อ, ชนิด (water node / pump node / valve node / env node / PLC / gateway),
IP, VLAN, MAC, MQTT port, Online/Offline, last-seen, RSSI (dBm), firmware version,
uptime, free heap, จำนวน reconnect, error ล่าสุด
- กรอง/ค้นหาได้ตามชนิดและสถานะ
- คลิก node → side panel รายละเอียด + กราฟ RSSI/uptime + ปุ่ม Reboot / Ping / OTA
- แถบสถานะ service ด้านบน: MQTT broker, Database, Ingest service, AI service

B. app/overview/page.tsx — Infographic แผนผังการไหลของน้ำ (SVG animated)
- ผัง: การประปา → มิเตอร์หลัก → Tank 1 → ปั๊ม → Tank 2/Tank 3 → วาล์ว 8 โซน → มิเตอร์โซน
- ท่อมี animation การไหล ความเร็ว animation แปรตาม flow rate จริงจาก mock data
- อุปกรณ์แสดงสถานะด้วยสี + ตัวเลขค่าปัจจุบันซ้อนบน node
- ไอคอน temp/humidity ซ้อนที่ห้องปั๊มและตู้คอนโทรล
- เส้นทางข้อมูล ESP32 → MQTT → Server → Dashboard พร้อมไฟกระพริบเมื่อมี message
- ไฮไลต์จุดที่ AI ตรวจพบความผิดปกติ (เรืองแสง/ขอบกระพริบสีแดง)
- คลิก node ใดก็ได้ → ไปหน้ารายละเอียดของอุปกรณ์นั้น

หน้า B ทำเป็น SVG เขียนมือ ไม่ต้องลง library วาดผัง
```

---

## Phase 4 — หน้า Alerts + Reports

```
ทำ 2 หน้า

A. app/alerts/page.tsx
- ตารางกรองตามระดับ (CRITICAL/WARNING/INFO), ประเภท, โซน, ช่วงวันที่
- สถานะ acknowledged, ปุ่ม acknowledge, แสดงว่าใคร ack เมื่อไร
- แสดงสถานะการส่ง LINE ต่อ alert (sent / pending / failed + retry count)
- Recovery event จับคู่กับ alert ต้นทาง แสดงระยะเวลาที่เกิดเหตุ
- ตัวอย่างข้อความ LINE ที่ระบบจะส่ง แสดงเป็น preview card

B. app/reports/page.tsx
- เลือกช่วงวันที่ → ตาราง + กราฟการใช้น้ำแยกโซน, ค่าน้ำ, unaccounted water
- เปรียบเทียบกับช่วงก่อนหน้า
- ปุ่ม export PDF/CSV (ทำ UI + TODO(backend) ไว้ก่อน)
```

---

## Phase 4.5 — หน้า AI Insights (แสดงผลจาก AI ของทีม — ไม่กำหนด logic เอง)

**ก่อนทำ Phase นี้ ให้ขอข้อมูลจากทีม AI ก่อน** (ดูรายการคำถามท้าย phase)
ถ้ายังไม่ได้คำตอบ ให้ทำเป็น generic ไปก่อนตามด้านล่าง แล้วค่อยปรับ type ทีหลัง

```
ทำหน้า app/ai/page.tsx และ widget สรุปในหน้า Overview
Frontend ทำหน้าที่แสดงผลเท่านั้น ไม่รันโมเดล ไม่คำนวณ score ไม่ตัดสินใจว่าอะไรผิดปกติ
ทุกอย่างมาจาก service layer (lib/services/ai.ts) ที่ทีม AI จะมาต่อ

หลักการออกแบบ: ต้อง "ทนต่อ output ที่ยังไม่นิ่ง" ของทีม AI
- ประเภทความผิดปกติ (anomaly type) เป็น string เปิด ไม่ hardcode enum
  UI ต้อง render ได้แม้เจอ type ที่ไม่รู้จัก (ใช้ไอคอน/สี default)
- มี mapping table ใน lib/config/anomaly-types.ts สำหรับ type → ชื่อไทย/ไอคอน/สี
  เพิ่ม type ใหม่ = เพิ่ม 1 บรรทัดในไฟล์นี้ ไม่ต้องแตะ component
- field ที่ไม่บังคับ (optional) ถ้าไม่มีให้ซ่อน ไม่ใช่แสดง undefined

type ที่ใช้จริงใน lib/types.ts (ชื่อเหล่านี้คือของจริงในโค้ด ไม่ใช่ของที่วางแผนไว้):

  AnomalyEvent {
    id, type: string, detectedAt, status: 'active'|'resolved'|'dismissed'   // 4 ตัวนี้บังคับ
    resolvedAt?, evidence?: TimeSeriesPoint[],
    expectedBand?: { lower: TimeSeriesPoint[], upper: TimeSeriesPoint[] },
    suggestedAction?, feedback?: 'confirmed'|'false_positive'|null,
    detector?: string, score?: number (0–1), severity?: 'critical'|'warning'|'info',
    sourceType?, sourceId?, sourceName?,        // ★ ไม่ใช่ targetType/targetId
    metric?, windowStart?, windowEnd?, features?, alertId?, modelName?,
    summaryTh?, summaryEn?, extra?
  }

  AIForecast {                                  // ★ ชื่อนี้ ไม่ใช่ Prediction
    id, target: string, generatedAt             // 3 ตัวนี้บังคับ
    targetId?, targetName?, metric?, unit?, horizonHours?, horizon?: string,
    history?, forecast?: ForecastPoint[],       // ForecastPoint มี lowerBound/upperBound ในตัว
    value?, expectedAt?, confidence?,           // สำหรับผลพยากรณ์แบบจุดเดียว
    modelName?, mapePercent?, summaryTh?, summaryEn?
  }

  MaintenancePrediction {                       // ★ ชื่อนี้ ไม่ใช่ HealthScore
    id, targetType, targetId, generatedAt       // 4 ตัวนี้บังคับ
    targetName?, failureProbability? (0–1), daysUntilService?,
    estimatedIssueDate?, healthScore? (0–100 ยิ่งสูงยิ่งดี), trend?: string,
    features?, modelName?, note?, recommendationTh?, recommendationEn?
  }

  AIServiceStatus {                             // ★ ชื่อนี้ ไม่ใช่ AIStatus
    reachable, lastResultAt, models, message    // 4 ตัวนี้บังคับ
    mode?, lastTrainedAt?, trainingDays?, accuracy?, falsePositiveRate?, summaryText?
  }

★ score เป็น 0–1 เสมอทั้ง type และ AI_CONTRACT.md
  แปลงเป็น % ที่ชั้นแสดงผลด้วย formatAnomalyScore() จาก lib/utils/format.ts เท่านั้น
  ห้ามคูณ 100 กระจายตามคอมโพเนนต์

A. AI Summary card (บนสุด) — แสดง AIStatus ทุก field ที่มี ซ่อน field ที่ไม่มี
B. Anomaly list — card ต่อ event:
   ประเภท (ผ่าน mapping) + severity + เป้าหมาย (คลิกไปหน้าที่เกี่ยวข้อง) + เวลา + ระยะเวลา
   ถ้ามี score → gauge / ถ้ามี evidence → กราฟ / ถ้ามี expectedBand → วาดแถบซ้อน
   ถ้ามี explanation → แสดง / ปุ่ม feedback จริง-false positive ส่งผ่าน service layer
   filter: severity, type, target, status + timeline 7 วันซ้อนกราฟการใช้น้ำรวม
C. Prediction section — วนแสดงทุก Prediction ที่ได้มา จัดกลุ่มตาม targetType
   ถ้ามี lower/upper วาด confidence band ถ้าไม่มีวาดแค่เส้น
D. Health / Early warning — วนแสดง HealthScore เรียงตาม score น้อยไปมาก
   แสดงเป็นรายการ "คาดว่าจะเกิดภายใน X วัน" เฉพาะที่มี estimatedIssueDate
E. Widget ในหน้า Overview: จำนวน anomaly active + summaryText 1 บรรทัด + ลิงก์
   ถ้ามี CRITICAL → card แดงและอยู่บนสุด
F. Mock ใน lib/mock/ai.ts — scenario toggle มุมจอ 3 แบบ:
   normal / night_leak (Zone 3 รั่วตี 2) / pump_degrading (Pump 1 กระแสค่อย ๆ สูง)
   ใช้ type ที่ยังไม่รู้จัก 1 อันใน mock ด้วย เพื่อทดสอบว่า UI ไม่พัง
G. docs/AI_CONTRACT.md อธิบาย type ทั้ง 4 + ตัวอย่าง JSON + อธิบายว่า field ไหนบังคับ
   ไฟล์นี้ส่งให้ทีม AI — แก้ type ในโค้ดเมื่อไร ต้องอัปเดตไฟล์นี้ด้วยเสมอ
```

### คำถามที่ต้องถามทีม AI ก่อน (หรือส่ง AI_CONTRACT.md ไปให้เขาตอบกลับ)

| ถาม | ทำไมต้องรู้ |
|---|---|
| โมเดลตรวจอะไรได้บ้าง ชื่อ type ที่จะส่งมาคืออะไร | ใส่ใน mapping table ให้ชื่อไทย/ไอคอนถูก |
| ให้ score ไหม ช่วง 0–1 หรือ 0–100 | gauge ต้อง scale ให้ถูก |
| มี explanation ภาษาไทยจาก LLM มาด้วยไหม หรือ dashboard ต้องแสดงแค่ตัวเลข | ตัดสินว่า card จะมีข้อความหรือไม่ |
| พยากรณ์อะไรบ้าง horizon ไหน มี confidence interval ไหม | ต้องรู้ว่าจะวาดกราฟกี่แบบ |
| มี health score / predictive maintenance ไหม หรือมีแค่ anomaly + forecast | ถ้าไม่มี ตัด section D ออก |
| ต้องการ feedback (จริง/false positive) กลับไปไหม | ถ้าไม่ใช้ ไม่ต้องทำปุ่ม |
| ผลออกมาเป็น batch (ทุก 5 นาที) หรือ real-time | มีผลต่อการ refresh หน้า |
| ส่งผ่านอะไร: REST endpoint, table ใน DB, หรือ MQTT topic | หลังบ้านต้องรู้เพื่อต่อ service layer |

---

## Phase 5 — หน้า Setting

```
ทำหน้า app/settings/page.tsx เป็น tab แยกหมวด บันทึกลง localStorage ผ่าน service layer
ทุกฟิลด์ต้องมี validation และแสดง error เป็นภาษาไทย

3.1 ทั่วไป: ชื่อโรงงาน, timezone, ภาษา, ธีม
3.2 Tank: ชื่อ, ความจุ (L), ค่า calibration ของ level sensor, threshold ต่ำ/วิกฤต/เต็ม,
    ระดับ auto-start / auto-stop ปั๊ม
3.3 Pump: ชื่อ, กำลัง (kW) nameplate, เกณฑ์ overcurrent (A), run-time สูงสุดต่อครั้ง,
    ผูกกับถังต้นทาง/ปลายทาง
3.4 Zone/Meter: ชื่อโซน, K-factor (pulse per liter), node ID ที่ผูก, วาล์วที่ผูก,
    โควตาน้ำต่อเดือน
3.5 อัตราค่าน้ำ: ราคาต่อยูนิตแบบขั้นบันได (เพิ่ม/ลบขั้นได้), ค่าบริการรายเดือน, VAT,
    วันเริ่มรอบบิล — พร้อม preview คำนวณตัวอย่าง
3.6 Alert: threshold แต่ละประเภท, quiet hours
3.7 AI: เปิด/ปิด anomaly detection, sensitivity slider, ช่วงเวลากลางคืนสำหรับตรวจ night-flow
3.8 การเชื่อมต่อ: broker host/port, DB host/port, NTP server (UI เท่านั้น)
3.9 ผู้ใช้ & สิทธิ์: viewer / operator / admin
3.10 Export/Import config เป็น JSON
3.11 Environment sensor: ชื่อจุดติดตั้ง, ค่า offset calibration, threshold temp/humidity ต่อจุด,
     mm ต่อ 1 tip ของ rain gauge, หน่วย °C/°F
3.12 LINE Notification: Channel Access Token (masked), Group ID หลายกลุ่ม,
     mapping ระดับความรุนแรง → กลุ่มไหน, quiet hours, debounce interval, escalation timeout,
     checkbox เปิด/ปิดรายประเภท, ปุ่มส่งข้อความทดสอบ,
     ตารางประวัติการส่ง 50 รายการล่าสุด + จำนวน queue ค้าง
```

---

## Phase 6 — เก็บงาน

```
1. ตรวจทุกหน้าให้มี loading state และ empty state ครบ
2. ตรวจว่าไม่มี component ไหนเรียก lib/mock/ โดยตรง — ต้องผ่าน service layer ทั้งหมด
3. ตรวจว่าไม่มีการเรียก external URL, CDN, font ภายนอกที่ไหนเลย
4. ทดสอบ responsive บน viewport 375px และ 1920px
5. รัน npx tsc --noEmit และ npm run build ให้ผ่าน
6. สร้าง HANDOFF.md สำหรับทีมหลังบ้าน ประกอบด้วย:
   - รายการ endpoint ทั้งหมดที่ต้องทำ (รวบรวมจาก TODO(backend) ทุกจุด)
   - request/response shape ของแต่ละ endpoint อ้างอิงจาก lib/types.ts
   - MQTT topic ที่ frontend คาดว่าจะมี
   - ระบุว่าต้องแก้ไฟล์ไหนบ้างตอนสลับจาก mock เป็น API จริง
```

---

## Phase 7 — UI Branding (Kasetphand CI)

สเปกทั้งหมดอยู่ใน `docs/BRANDING_SPEC.md` — ไฟล์นี้**อ้างอิงด้วยเลขหัวข้อเท่านั้น ไม่คัดลอกเนื้อหา**
คำตัดสินของเจ้าของโปรเจกต์ (2026-09-11) ถูกบันทึกลงในสเปกแล้วที่ข้อ 3.3, 3.5, 3.6, 3.7, 4, 5.1, 5.3, 8

**ขอบเขตร่วมของทุก 7.x**

- restyle เท่านั้น — ห้ามแก้ `lib/services/`, `lib/mock/`, `lib/types.ts`, `lib/hooks/` (§8 อื่น ๆ ข้อ 6)
- ห้ามเพิ่ม dependency ใน `package.json`, ห้ามเรียก CDN/Google Fonts ตอน runtime (`CLAUDE.md`)
- ข้อความใหม่ทุกคำต้องมีคีย์ th + en ใน `lib/i18n/` (§8 อื่น ๆ ข้อ 4)
- ทำตามลูป 6 ขั้นใน `RUNBOOK.md` ทุกเฟสย่อย และ commit แยกรายเฟส
- สีและฟอนต์เดิมถูกแทนที่ด้วยสเปกนี้โดยตั้งใจ (§1) — ไม่ต้องหยุดถามเรื่องนี้

**ลำดับ:** เอกสาร (7.0) → รากฐาน (7.1) → component กลาง (7.2) → shell (7.3) → หน้า (7.4–7.8a) → sweep (7.8b)

| เฟส | งาน | ไฟล์ |
|---|---|---|
| 7.0 | `docs/DESIGN_PLAN.md` + ไฟล์โลโก้ — **ไม่แก้ UI, หยุดรออนุมัติ** | 1 เอกสาร + ภาพ |
| 7.1 | tokens + ฟอนต์ + test | 7 |
| 7.2 | component กลาง (pill + 11 ไฟล์ที่ประกอบสีเอง + โลโก้) | 18 |
| 7.3 | shell + `/login` + favicon | 13 |
| 7.4 | `/` + tank gauge | 13 |
| 7.5 | `/control` + `/devices` | 14 |
| 7.6 | `/alerts` + `/reports` | 10 |
| 7.7a | `/ai` | 12 |
| 7.7b | `/overview` ผังการไหล | 3 |
| 7.8a | `/settings` | 14 |
| 7.8b | sweep ทั้งแอป | — |

---

## Phase 7.0 — DESIGN_PLAN + ไฟล์โลโก้ (เอกสารอย่างเดียว)

```
ไฟล์ที่สร้าง: docs/DESIGN_PLAN.md, public/brand/<ไฟล์โลโก้>
ห้ามแก้ไฟล์ใด ๆ ใน app/ components/ lib/ ในเฟสนี้

1. ยืนยันค่าบันไดสีในตาราง §3.1 เทียบกับ PDF ใน docs/design-refs/
   ค่าที่ sample มาคลาดได้ ±3 ต่อ channel — ระบุว่าค่าไหนยืนยันได้ ค่าไหนต้องถามเจ้าของแบรนด์
2. เสนอค่า hex ของ Argent-950 และ Argent-1000 ตาม §3.6 (ทางเลือก ข)
   ต้องแสดงวิธีคำนวณว่าคง H และ S ของบันได Argent ไว้ เปลี่ยนเฉพาะ L
   พร้อมค่า contrast ของข้อความบนพื้นทั้งสอง
3. ตาราง mapping สีเดิม → token ใหม่ ครอบคลุมทุกตัวแปรใน app/globals.css
   (ตัวแปร semantic + status ทั้งชุด light/dark และ --chart-1..8, --chart-seq-100/250/400/550)
4. หาไฟล์โลโก้ตาม §5.1 แล้ววางที่ public/brand/ — ตัดสินผ่าน/ไม่ผ่านด้วยเกณฑ์ใน §5.1
   ไม่ผ่าน → ใช้ชั่วคราวได้ แต่ต้องขึ้น open question ขอไฟล์ต้นฉบับจากองค์กร
5. บันทึกข้อยกเว้น contrast ของปุ่ม primary (4.42:1) ตาม §3.5 — ขอบเขตที่ยอมรับและที่ห้าม
6. จัดหมวด opacity ทั้งหมด (วัดได้ 89 จุด) ตามตารางห้าม/อนุญาตในข้อ §3
   ผลลัพธ์ต้องมี: จำนวนจุดที่ต้องแก้, จำนวนจุดที่ปล่อยไว้ได้, และ**รายชื่อไฟล์ที่ต้องแก้**
   แล้วเอารายชื่อนั้นไปเติมใส่ phase ที่แตะไฟล์นั้น ๆ ในไฟล์นี้
7. ลิสต์กราฟทุกอันที่มีชุดข้อมูลเกิน 4 ชุด พร้อมระบุว่าแต่ละอันจะใช้ทางออกไหนตาม §3.3
   (สีเดียว + ป้ายชื่อ / เน้น 1 ชุดที่เหลือ Argent-100)
8. ตรวจคลาสสถานะ 144 จุดใน 47 ไฟล์ ว่าอ้างตัวแปร CSS ทั้งหมดหรือมีจุดที่ฝังค่าเอง
   สรุปเป็นตัวเลข: กี่จุดที่เปลี่ยนค่าตัวแปรที่ globals.css แล้วเปลี่ยนตามทันที
   → ผล: 144/144 อ้างตัวแปร แก้ที่ globals.css จุดเดียวพอ (DESIGN_PLAN ข้อ 8)
9. เสนอสีชุดข้อมูลของ dark mode (ขั้นที่สว่างกว่าในบันไดเดียวกัน §3.3)
   แล้วรัน validator ของ skill dataviz กับชุด 4 สีทั้ง light และ dark บันทึกผลลงเอกสาร
   คู่ไหนไม่ผ่าน → รายงาน ห้ามเติมสีนอก CI
10. รวบรวม open questions ทั้งหมดไว้ท้ายเอกสาร

§8 ที่ต้องผ่าน: ยังไม่มี (เฟสนี้ไม่แตะ UI) — ต้องได้ค่าตั้งต้นครบสำหรับ 7.1

จุดหยุดถาม:
- **จบเฟสนี้ต้องหยุดรออนุมัติเสมอ** ห้ามเริ่ม 7.1 เอง
- ถ้าค่าสีที่ sample จาก PDF ต่างจากตาราง §3.1 เกิน ±3 ต่อ channel — หยุดรายงาน
- ถ้า validator ไม่ผ่าน — หยุดรายงาน ห้ามเลือกสีเองนอกบันได §3.1
```

---

## Phase 7.1 — Tokens + ฟอนต์

```
ไฟล์: lib/config/theme.ts (สร้างใหม่), app/globals.css, tailwind.config.ts,
      app/layout.tsx (เฉพาะ themeColor), app/fonts.ts, app/fonts/ (เพิ่มไฟล์ Montserrat + OFL.txt),
      components/charts/chart-tokens.ts
      + ไฟล์ test ใหม่สำหรับ whitelist hex และ contrast

1. lib/config/theme.ts = จุดเดียวในโค้ดที่มี hex ตาม §3.1 + §3.6 (Argent-950/1000)
   + คีย์ thirdParty.line ตาม §3.7 + คอมเมนต์ที่มา (`sampled from CI p.13/p.17`) ตาม §3.1
2. app/globals.css: map semantic token ตาม §3.3 เข้าตัวแปรเดิมทั้งหมด
   คงรูปแบบค่าเดิมของไฟล์ (HSL แบบ "H S% L%" ไม่มี hsl() ครอบ) และใส่คอมเมนต์ hex ข้างทุกตัว (§3.7)
   ตัวแปรที่ต้อง map ครบ: --background --foreground --card --popover --primary --secondary
   --muted --accent --destructive --border --input --ring --status-ok --status-warning
   --status-critical --status-offline (+ -foreground ทุกตัว) ทั้ง :root และ .dark
3. --chart-1..8 → เหลือ 3 ค่าตาม §3.3: data-series-1, data-series-2, data-reference
   (light #026BB5 / #009148 / #CBC7C8 · dark #4E80BF / #4CA062 / #6D6C71)
   --chart-seq-* → บันได Blue ตาม §3.3 (data-water / data-water-soft)
   ★ ต้องแก้ chart-tokens.ts ให้ CHART_SERIES เหลือ 2 และ seriesColor() throw ที่ 2 ไม่ใช่ 8
   ★ เพิ่ม token ใหม่ 3 ตัวตาม §3.3:
     --control-checked  Argent-900 #515558  / dark Lynx White #F7F7F7
     --info             Blue-500  #026BB5   / dark Blue-100   #A5AECF
     --info-strong      Blue-800  #536281   (ข้อความ Lynx White) ใช้เฉพาะชิปที่ต้องมีพื้น
   ★ แยก --ring ออกจาก --primary: --ring = Blue-500 (light) / Blue-300 (dark)
4. ไล่ทุกจุดที่ใช้ *-primary (51 token ใน 34 บรรทัด / 23 ไฟล์) เข้ากลุ่มตามตารางใน §3.3
   ปลายทางของทุกบรรทัดระบุไว้แล้วใน DESIGN_PLAN ข้อ 11:
     brand 18 · info 19 · data-water 7 · Argent-900 (progress งาน) 4 · control-checked 3 · status-ok 1
   ชิป info ไม่มีพื้นเป็นค่าตั้งต้น (§3.3) — ห้ามทำพื้นอ่อนจาก opacity
5. tailwind.config.ts: คงรูปแบบ hsl(var(--x)) ไว้ ห้ามใส่ hex เพิ่มชื่อ token ใหม่ที่ §3.3 ต้องการ
   radius ตาม §6.2 — เพิ่มเป็นตัวแปรใหม่ อย่าทับ --radius ที่ shadcn ใช้อยู่
6. app/layout.tsx: themeColor 2 ค่า import จาก theme.ts ตาม §3.7 (นี่คือจุดเดียวที่แตะไฟล์นี้)
7. ฟอนต์ Montserrat ตาม §4 — วิธีได้ไฟล์และ flag subset อยู่ใน §4
   app/fonts.ts เพิ่ม localFont ตัวที่สอง, tailwind.config.ts fontFamily.sans เป็น stack ตาม §4
   ตัวเลข realtime tabular-nums ทำเป็น class กลางที่ globals.css หรือ lib/utils/format.ts จุดเดียว
   ขนาด KPI ตาม §4 — แก้ค่า fontSize.metric / metric-lg เดิม อย่าสร้างชื่อใหม่ซ้อน
8. เขียน test 2 ตัว: whitelist hex (§8 สี ข้อ 3) และ contrast (§3.2–3.5)
   whitelist ต้องแปลง HSL กลับเป็น hex ก่อนเทียบ ยอมคลาด ±1 ต่อ channel (§3.7)
9. จบเฟสนี้ทุกหน้าต้องยังทำงานได้ สีอาจยังผสมกันอยู่ได้ (component ยังไม่ถูกแก้)

§8 ที่ต้องผ่าน: สี ข้อ 1 (hex เหลือเฉพาะ theme.ts), สี ข้อ 3 (whitelist),
  สี ข้อ 5 (จานสีกราฟ), สี ข้อ 6 (validator dataviz), สี ข้อ 8 (ไม่เหลือ *-primary กำกวม), อื่น ๆ ข้อ 1 (ฟอนต์ทำงานตอนตัด network), อื่น ๆ ข้อ 2 (tabular-nums)

จุดหยุดถาม:
- ต้องรัน pip install fonttools บนเครื่องพัฒนา — แจ้งก่อนทำ (ไม่ได้เพิ่มใน package.json)
- ถ้าการลด --chart-1..8 เหลือ 3 ทำให้กราฟที่มีอยู่พัง — ดูลิสต์ผลกระทบท้ายข้อ 9 ของ DESIGN_PLAN
- ถ้าเจอจุดที่ใช้ *-primary นอกเหนือจาก 34 บรรทัดที่ลิสต์ไว้ และจัดเข้ากลุ่มใน §3.3 ไม่ได้ ให้หยุดถาม ห้ามเดา
```

---

## Phase 7.2 — Component กลาง (status pill + โลโก้)

```
ไฟล์:
  สร้างใหม่: components/layout/brand-logo.tsx
  primitive: components/ui/badge.tsx button.tsx card.tsx separator.tsx skeleton.tsx status-badge.tsx
  11 ไฟล์ที่ประกอบสีสถานะเอง (ต้องเลิกประกอบเอง หันมาใช้ pill กลาง):
    app/alerts/page.tsx
    components/ui/status-badge.tsx
    components/pumps/pump-card.tsx
    components/diagram/diagram-primitives.tsx
    components/alerts/recent-alerts.tsx
    components/alerts/recovery-list.tsx
    components/ai/anomaly-card.tsx
    components/ai/anomaly-type-badge.tsx
    components/ai/anomaly-timeline.tsx
    components/control/audit-log.tsx
    components/tanks/tank-gauge.tsx
  lib/config/anomaly-types.ts

1. status pill กลางตาม §3.4 — ต้องมีไอคอน + ข้อความเสมอ ห้ามสื่อสถานะด้วยสีอย่างเดียว
   น้ำหนักทางสายตาไล่ตามความรุนแรงตามตารางใน §3.4
2. ปุ่มตาม §3.5 (Cinnabar-500 + ขาว ≥16px/600, ปุ่มเล็กใช้ Cinnabar-700)
3. ผิวและ radius ของ card / dialog / input ตาม §6.2
4. brand-logo.tsx = จุดเดียวที่ render โลโก้ ตาม §5.2 (ยังไม่เสียบเข้า shell — ทำใน 7.3)
5. เลิกประกอบสีสถานะเองใน 11 ไฟล์ข้างบน ให้เหลือ pill กลางตัวเดียว
   ★ ผลตรวจข้อ 8 ของ DESIGN_PLAN บอกว่ากี่จุดในทั้งหมด 144 จุดที่เปลี่ยนตามตัวแปรไปแล้วตั้งแต่ 7.1
     เฟสนี้แก้เฉพาะจุดที่ยังประกอบสีเอง
6. lib/config/anomaly-types.ts: tone ต้องชี้ semantic token (ตอนนี้ใช้ tone: EntityStatus อยู่แล้ว
   และไม่มี hex) — ตรวจว่า UNKNOWN_ANOMALY_TYPE ได้ text-secondary + ไอคอน default ตาม §3.7
6.1 สวิตช์ที่ใช้ bg-status-ok เป็นสถานะ "เปิด" (components/settings/field.tsx:209,
   components/control/schedule-panel.tsx:216) ย้ายมาใช้ control-checked ตาม §3.3 — ตัดสินแล้ว
   ไม่งั้นสวิตช์จะสื่อว่า "สถานะปกติ" แทน "ติ๊กแล้ว" — ดู DESIGN_PLAN ข้อ 11
7. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: components/ai/anomaly-type-badge.tsx (4), components/diagram/diagram-primitives.tsx (4),
   components/pumps/pump-card.tsx (1) — รวม 9 จุด

§8 ที่ต้องผ่าน: โลโก้ ข้อ 1–2, สี ข้อ 4 (opacity), สี ข้อ 7 (status ใช้ pill §3.4),
  สี ข้อ 9 (แดง = วิกฤตเท่านั้น)

จุดหยุดถาม:
- ถ้า pill ตาม §3.4 กว้างขึ้นจนตารางใน /alerts หรือ /devices ล้นที่ 375px
  หยุดถามก่อนเปลี่ยนโครงตาราง (เคยแก้ overflow ที่หน้านี้มาแล้ว)
- ถ้าการยุบสีสถานะทำให้ต้องแก้ lib/types.ts (เช่น EntityStatus) — หยุดถาม
```

---

## Phase 7.3 — Shell + `/login` + favicon

```
ไฟล์: components/layout/ ทั้ง 11 ไฟล์ —
        app-shell.tsx auth-gate.tsx header.tsx lang-toggle.tsx nav-items.ts
        page-placeholder.tsx section.tsx sidebar.tsx theme-provider.tsx
        theme-toggle.tsx user-menu.tsx
      + components/layout/brand-logo.tsx (จาก 7.2)
      + app/login/page.tsx
      + public/favicon.svg

1. จัด shell ตาม wireframe §6.1 — header ต้องคง 4 อย่างที่ CLAUDE.md บังคับครบ
   (เวลาปัจจุบัน, สถานะเชื่อมต่อ, badge "Local Mode", จำนวน alert ที่ยังไม่อ่าน)
2. ชื่อเมนูใช้คีย์ i18n เดิมใน nav-items.ts — §6.1 สั่งว่าถ้า wireframe ต่างจากของเดิม ใช้ของเดิม
3. กล่องสรุประบบท้าย sidebar ดึงจาก service เดิม ห้ามสร้าง service ใหม่ (§6.1)
4. โลโก้ตาม §5.3 — ห้ามวางด้านล่างของหน้า
5. nav active pill ใช้กติกาเดียวกับปุ่ม primary ใน §3.5 (≥16px / weight 600)
6. Mobile 375px: sidebar เป็น drawer ตาม §6.1
6.1 ★ header ล้นจอ 29px ที่ 375px ทุกหน้า (วัดจริงได้ scrollWidth 404)
   ต้นเหตุคือแถวควบคุมมุมขวาบนกว้าง 328px — ย่อ header ตาม §6.1 ให้เหลือ
   โลโก้ + สถานะเชื่อมต่อ + กระดิ่ง บนมือถือ แล้ววัดซ้ำให้ scrollWidth ≤ 375
   รายละเอียดการวัดอยู่ใน DESIGN_PLAN ข้อ 12.1
7. /login ตาม §7 แถว /login — split layout, ฝั่งซ้ายพื้นบันไดสี ไม่ใช้ภาพจาก template,
   การ์ดบัญชีทดลองคงไว้, โลโก้มุมซ้ายบนฝั่งภาพ (§5.3)
8. favicon ตาม §5.3 — คงรูปทรงเดิมของ public/favicon.svg เปลี่ยนเฉพาะสีเป็นสี CI
9. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: app/login/page.tsx (2), components/layout/header.tsx (2) — รวม 4 จุด

§8 ที่ต้องผ่าน: โลโก้ ข้อ 1–2, สี ข้อ 2, สี ข้อ 4, อื่น ๆ ข้อ 3 (≥16px บน Cinnabar-500),
  อื่น ๆ ข้อ 5 (light/dark ที่ 375px และ 1920px)

จุดหยุดถาม:
- ถ้า §6.1 ต้องการ element ใน header ที่ยังไม่มี service รองรับ — หยุดถาม ห้ามแต่งข้อมูลปลอม
- /login เป็น UI อย่างเดียว ไม่ใช่ระบบยืนยันตัวตนจริง ห้ามจัดสไตล์ให้ดูเหมือนของจริงกว่าเดิม
  หรือเพิ่มช่องที่สื่อว่าเก็บรหัสผ่านจริง — ถ้าสเปกดูจะสั่งแบบนั้น หยุดถาม
```

---

## Phase 7.4 — หน้า `/` ภาพรวม + tank gauge

```
ไฟล์: app/page.tsx
      components/tanks/ tank-card.tsx tank-gauge.tsx tank-section.tsx
      components/pumps/ pump-card.tsx pump-section.tsx
      components/zones/ main-meter-section.tsx zone-cards.tsx zone-section.tsx zone-table.tsx
      components/environment/ environment-card.tsx environment-section.tsx temp-vs-usage-chart.tsx

1. tank gauge คือจุดเด่นเดียวของทั้งแอปตาม §6.3 — ปรับหน้าตา ห้ามเขียนใหม่
   animation ระดับน้ำคงเดิมและต้องเคารพ prefers-reduced-motion
2. แนวทางหน้าตาม §7 แถว `/` (แถว KPI, กล่อง alert ล่าสุด, กราฟพยากรณ์ + ช่วงความเชื่อมั่น)
3. ผิวและ radius ตาม §6.2, KPI ใหญ่ตาม §4 — นี่คือหน้าที่จอแขวนผนังเปิดค้างไว้
4. สีใน SVG และกราฟอ่านผ่าน chart-tokens.ts เท่านั้น ห้ามใส่ hex ใน props (§3.7)
4.1 components/environment/temp-vs-usage-chart.tsx — ทำสีไปแล้วใน 7.1
   ไฟล์นี้เป็น small multiples 2 ชั้นที่แชร์แกนเวลาอยู่แล้ว ไม่ใช่กราฟแกนคู่ (DESIGN_PLAN ข้อ 10)
   usage = Blue · temp = Green · ป้ายชั้นมีหน่วยและใช้สีตรงกับเส้นของตัวเอง — เฟสนี้แค่ตรวจซ้ำ
5. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: components/zones/main-meter-section.tsx (1) — 1 จุด
   (components/pumps/pump-card.tsx แก้ไปแล้วใน 7.2)

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 4, สี ข้อ 5 (จานสีกราฟ), อื่น ๆ ข้อ 2, 4, 5

จุดหยุดถาม:
- ถ้า §7 ทำให้ต้องย้าย/ตัดข้อมูลออกจากหน้า — หยุดถาม (restyle เท่านั้น เนื้อหาคงเดิม)
- ถ้าเปลี่ยนสีแล้วเส้น threshold กลืนกับตัวน้ำใน gauge — หยุดถาม
```

---

## Phase 7.5 — `/control` + `/devices`

```
ไฟล์: app/control/page.tsx, app/devices/page.tsx
      components/control/ audit-log.tsx command-status.tsx confirm-dialog.tsx
        emergency-panel.tsx interlock-notice.tsx pin-gate.tsx pump-control-card.tsx
        schedule-panel.tsx valve-control-card.tsx
      components/devices/ device-detail-panel.tsx device-labels.ts service-health-bar.tsx

1. แนวทางตาม §7 แถว /control และ /devices
   ปุ่ม emergency และปุ่มที่ถูก interlock มีกติกาสีเฉพาะใน §7 — อ่านก่อนแก้
2. state machine ของคำสั่ง (sending → awaiting_feedback → …), PIN modal, double confirm,
   interlock — ห้ามแตะ behavior (§1) เปลี่ยนแค่หน้าตา
3. side panel ของ /devices ตาม §6.2 (drawer = เงาเดียวของระบบ)
4. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: components/control/command-status.tsx (6), components/control/emergency-panel.tsx (4),
   components/devices/device-detail-panel.tsx (3), components/control/confirm-dialog.tsx (1),
   components/devices/service-health-bar.tsx (1) — รวม 15 จุด

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 4, สี ข้อ 9, อื่น ๆ ข้อ 3, 4, 5, 6

จุดหยุดถาม:
- pin-gate.tsx / confirm-dialog.tsx เป็น UI-only ตามที่ตกลงไว้ — ห้ามทำให้ดูเหมือนระบบ
  ยืนยันตัวตนจริงกว่าเดิม ถ้าสเปกดูจะสั่งแบบนั้น หยุดถาม
```

---

## Phase 7.6 — `/alerts` + `/reports`

```
ไฟล์: app/alerts/page.tsx, app/reports/page.tsx
      components/alerts/ line-preview-card.tsx recent-alerts.tsx recovery-list.tsx
      components/reports/ monthly-chart.tsx zone-usage-chart.tsx
      components/billing/ billing-section.tsx daily-usage-chart.tsx zone-cost-chart.tsx

1. แนวทางตาม §7 แถว /alerts และ /reports (filter bar, severity pill, stat card เทียบช่วงก่อนหน้า)
2. line-preview-card.tsx ต้องอ่าน #06C755 จาก theme.ts คีย์ thirdParty.line ตาม §3.7
   ห้ามเขียน hex ในไฟล์นี้ และห้ามใช้คีย์นี้ที่อื่น
3. ข้อความ "ช่วงวันที่ / ช่วงก่อนหน้า" ถูกแก้ให้ชัดเจนไปแล้วในเฟสก่อน — ห้ามเปลี่ยนคำกลับ
4. กราฟหลายชุดใช้ลำดับ 4 สีตาม §3.3 ถ้าเกิน 4 ชุดให้ทำตามทางออกที่ DESIGN_PLAN ข้อ 7 เลือกไว้
5. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: ไม่มี — ไฟล์กลุ่มนี้ไม่มี opacity หมวดห้าม

§8 ที่ต้องผ่าน: สี ข้อ 1 (พร้อมข้อยกเว้น thirdParty.line), สี ข้อ 2, สี ข้อ 4, สี ข้อ 5,
  สี ข้อ 7, อื่น ๆ ข้อ 2, 5

จุดหยุดถาม:
- ไม่มีจุดเฉพาะเพิ่ม ใช้จุดหยุดกลางของ RUNBOOK
```

---

## Phase 7.7a — `/ai`

```
ไฟล์: app/ai/page.tsx
      components/ai/ ai-metric-card.tsx ai-metrics-section.tsx ai-overview-widget.tsx
        ai-summary-card.tsx anomaly-card.tsx anomaly-evidence-chart.tsx anomaly-timeline.tsx
        anomaly-type-badge.tsx forecast-section.tsx maintenance-section.tsx scenario-switcher.tsx

1. แนวทางตาม §7 แถว /ai — ค่าจริงเส้นทึบ / ค่าคาดการณ์เส้นประ, scenario switcher คงไว้
2. UI ต้อง render ได้แม้ field ไม่ครบหรือเจอ anomaly type ที่ไม่รู้จัก (CLAUDE.md)
   ห้ามทำให้ fallback หายไปตอนจัดสไตล์
3. formatAnomalyScore() เป็นจุดเดียวที่แปลง 0–1 เป็น % — ห้ามคูณ 100 เพิ่มในเฟสนี้
4. กราฟใช้ลำดับ 4 สีตาม §3.3 — anomaly timeline เคยมีปัญหาแกนเวลา ห้ามแตะ domain/ticks
5. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: components/ai/ai-overview-widget.tsx (3), components/ai/maintenance-section.tsx (2),
   components/ai/ai-summary-card.tsx (1), components/ai/ai-metric-card.tsx (1) — รวม 7 จุด

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 4, สี ข้อ 5, สี ข้อ 7, สี ข้อ 9, อื่น ๆ ข้อ 4, 5

จุดหยุดถาม:
- ถ้าการจัดสไตล์ทำให้ต้องเพิ่ม field ที่ทีม AI ไม่ได้ส่งมา — หยุดถาม ห้ามแก้ lib/types.ts
```

---

## Phase 7.7b — `/overview` ผังการไหล

```
ไฟล์: app/overview/page.tsx
      components/diagram/ diagram-primitives.tsx flow-diagram.tsx

1. แนวทางตาม §7 แถว /overview — ท่อใช้บันได Blue (ตอนนี้ยังเป็นสีสถานะอยู่),
   node ใช้สีสถานะ (พื้นกล่องทำไปแล้วใน 7.2 เหลือเส้นท่อ),
   จุดที่ AI ตรวจพบใช้ Cinnabar-500 (glow บนผังอนุญาต — กฎห้าม effect ใช้กับโลโก้เท่านั้น)
   ★ ตอนนี้ขอบเรืองแสงใช้ stroke-status-critical (Cinnabar-700) ต้องเปลี่ยนเป็น Cinnabar-500
2. สีทุกค่าอ่านผ่าน chart-tokens.ts / theme.ts ห้ามใส่ hex ใน SVG (§3.7)
3. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: components/diagram/diagram-primitives.tsx (4) — แก้ไปแล้วใน 7.2 เฟสนี้แค่ตรวจซ้ำ

§8 ที่ต้องผ่าน: สี ข้อ 1, สี ข้อ 2, สี ข้อ 4, สี ข้อ 7, อื่น ๆ ข้อ 5

จุดหยุดถาม:
- ถ้าผังที่ 375px อ่านไม่ออกหลังเปลี่ยนสี — หยุดถามก่อนเปลี่ยนโครงผัง
```

---

## Phase 7.8a — `/settings`

```
ไฟล์: app/settings/page.tsx
      components/settings/ ทั้ง 13 ไฟล์

1. แนวทางตาม §7 แถว /settings — tab + ฟอร์ม, ข้อความ error ภาษาไทยใช้ Cinnabar-800
2. ค่าตั้งต้นทั้งหมดอยู่ใน withDefaults() ตอนโหลดแล้ว — ห้ามย้ายกลับไปใส่ ?? ใน component
3. input / button radius ตาม §6.2
4. opacity ในไฟล์กลุ่มนี้ที่อยู่ในหมวด "ห้าม" ของ §3: app/settings/page.tsx (1) — 1 จุด

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 4, สี ข้อ 7, อื่น ๆ ข้อ 4, 5, 6

จุดหยุดถาม:
- ไม่มีจุดเฉพาะเพิ่ม ใช้จุดหยุดกลางของ RUNBOOK
```

---

## Phase 7.8b — Sweep ทั้งแอป

```
1. รัน grep 2 บรรทัดใน §8 หมวด "สี" ข้อ 1 และ 2
   ค่าตั้งต้นก่อนเริ่ม Phase 7: hex 3 จุด (app/layout.tsx 2 = themeColor,
   components/alerts/line-preview-card.tsx 1 = #06C755)
   คลาสสีสำเร็จรูปของ Tailwind 0 จุด — ต้องคง 0 ไว้
   เป้าหมาย: เหลือเฉพาะ lib/config/theme.ts
2. รัน test whitelist hex + test contrast ที่เขียนไว้ใน 7.1 ให้ผ่าน (§8 สี ข้อ 3)
3. ตรวจ opacity ตามตารางห้าม/อนุญาตใน §3 — เทียบกับจำนวนที่จัดหมวดไว้ใน DESIGN_PLAN ข้อ 6
   ตั้งต้น 89 จุด: ห้าม 37 · ควรแก้ 44 · อนุญาต 8 (DESIGN_PLAN ข้อ 6)
4. รัน validator ของ skill dataviz ทั้ง light และ dark (§8 สี ข้อ 6)
5. ตรวจ light + dark ที่ 375px และ 1920px ครบทั้ง 9 หน้า วัด scrollWidth เทียบ viewport
   (เคยเจอ overflow ที่ /alerts มาแล้ว) — §8 อื่น ๆ ข้อ 5
6. ตัด network ใน devtools แล้วเช็คว่าฟอนต์ยังขึ้น (§8 อื่น ๆ ข้อ 1)
7. ตรวจ i18n th/en ครบคู่ (§8 อื่น ๆ ข้อ 4)
8. git diff --stat ต้องไม่มีไฟล์ใน lib/services/, lib/mock/, lib/types.ts, lib/hooks/
   (§8 อื่น ๆ ข้อ 6)
9. npx tsc --noEmit และ npm run build ผ่าน
10. เพิ่มหัวข้อ "Brand rules" สั้น ๆ ใน CLAUDE.md ที่ชี้ไป docs/BRANDING_SPEC.md
11. ปรับ HANDOFF.md ถ้ามีจุดที่เปลี่ยน (เช่น ไฟล์ lib/config/theme.ts ใหม่)
12. อัปเดต docs/BRANDING_SPEC.md ตรงจุดที่โค้ดจริงต่างจากสเปก (กฎ CLAUDE.md: แก้เอกสารตามโค้ด)

§8 ที่ต้องผ่าน: ทุกข้อ

จุดหยุดถาม:
- ถ้า §8 ข้อไหนไม่ผ่านและการทำให้ผ่านต้องแตะไฟล์ในรายการห้ามแก้ — หยุดถาม
```

---

## เคล็ดลับการใช้ Claude Code กับงานนี้

| ปัญหาที่มักเจอ | วิธีแก้ |
|---|---|
| สั่งรวดเดียวทั้ง 7 หน้า → โค้ดหลวม type ไม่ตรงกัน | สั่งทีละ Phase และเช็ค `types.ts` ให้นิ่งก่อน |
| Claude Code แก้ type เดิมตอนทำหน้าใหม่ | สั่งเพิ่มว่า "ห้ามแก้ lib/types.ts ถ้าจำเป็นต้องแก้ ให้ถามก่อน" |
| ลืมข้อจำกัด on-premise แล้วดึง Google Fonts | `CLAUDE.md` จะช่วยกันไว้ ถ้ายังหลุดให้สั่ง `/clear` แล้วเริ่ม phase ใหม่ |
| Context เต็มกลาง phase | ใช้ `/compact` หรือจบ phase แล้ว `/clear` เริ่มใหม่ — `CLAUDE.md` จะโหลดกลับมาเอง |
| อยากเห็นผลก่อนสั่งต่อ | จบทุก phase ให้รัน `npm run dev` ดูจริงก่อนไป phase ถัดไป |

ใช้ plan mode (`Shift+Tab` สองครั้ง) กับ Phase 0 และ Phase 3B (หน้า infographic)
สองอันนี้มีการตัดสินใจโครงสร้างเยอะ ให้มันวางแผนให้ดูก่อนลงมือจะคุมง่ายกว่า
