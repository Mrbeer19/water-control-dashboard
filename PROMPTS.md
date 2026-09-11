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
