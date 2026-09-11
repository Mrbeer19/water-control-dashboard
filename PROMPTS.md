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
ถ้าสเปกกับโค้ดจริงขัดกัน ใช้กฎเดิมใน `CLAUDE.md`: **ของที่มีอยู่ในโค้ดชนะ แล้วแก้เอกสารตามโค้ด**

**ขอบเขตร่วมของทุก 7.x**

- restyle เท่านั้น — ห้ามแก้ `lib/services/`, `lib/mock/`, `lib/types.ts`, `lib/hooks/` (§8 อื่น ๆ ข้อ 5)
- ห้ามเพิ่ม dependency, ห้ามเรียก CDN/Google Fonts (ข้อจำกัด on-premise ใน `CLAUDE.md`)
- ข้อความใหม่ทุกคำต้องมีคีย์ th + en ใน `lib/i18n/` (§8 อื่น ๆ ข้อ 3)
- ทำตามลูป 6 ขั้นใน `RUNBOOK.md` ทุกเฟสย่อย และ commit แยกรายเฟส

**ลำดับ:** รากฐาน (7.0–7.2) → component กลาง (7.3) → shell (7.4) → กราฟ/SVG (7.5) → รายหน้า (7.6–7.8) → เก็บกวาด (7.9)

| เฟส | ขอบเขต | ไฟล์โดยประมาณ |
|---|---|---|
| 7.0 | token สี | 3 |
| 7.1 | โลโก้ | 2 + ไฟล์ภาพ |
| 7.2 | ฟอนต์ | 3 + ไฟล์ฟอนต์ |
| 7.3 | primitive กลาง | 6 |
| 7.4 | shell | 11 |
| 7.5a | กราฟ Recharts | 10 |
| 7.5b | SVG เขียนมือ | 3 |
| 7.6a | หน้า `/` | 13 |
| 7.6b | `/control` + `/overview` | 11 |
| 7.7a | `/devices` + `/alerts` | 8 |
| 7.7b | `/reports` | 6 |
| 7.7c | `/ai` | 10 |
| 7.8a | `/settings` | 14 |
| 7.8b | `/login` | 2 |
| 7.9 | sweep + acceptance | — |

---

### Phase 7.0 — token สีทั้งระบบ

```
ไฟล์: lib/config/theme.ts (สร้างใหม่), app/globals.css, tailwind.config.ts

1. สร้าง lib/config/theme.ts เป็น "จุดเดียวในโค้ดที่มี hex" ตามบันไดสีใน §3.1
   ทุกค่าที่ไม่ใช่ CSS class (กราฟ, SVG) ต้องอ่านจากไฟล์นี้ — §3.7
2. map semantic token ตาม §3.3 เข้าตัวแปรเดิมใน app/globals.css
   คงรูปแบบค่าเดิมของไฟล์ไว้ (ตอนนี้เป็น HSL แบบ "H S% L%" ไม่มี hsl() ครอบ)
   และใส่คอมเมนต์ hex ต้นฉบับข้างทุกตัว — §3.7
   ตัวแปรที่มีอยู่และต้องถูก map ครบ: --background --foreground --card --popover
   --primary --secondary --muted --accent --destructive --border --input --ring
   --status-ok --status-warning --status-critical --status-offline (+ -foreground ทุกตัว)
3. --chart-1..8 และ --chart-seq-100/250/400/550 ใน app/globals.css ตอนนี้เป็น hex
   ให้เปลี่ยนเป็นขั้นจากบันได §3.1 แล้วตั้งชื่อตาม §3.3 (data-series-*, data-water)
   ★ ชุดเดิมผ่าน validator ของ dataviz มาแล้ว ชุดใหม่ต้องรัน validator ซ้ำทั้ง light/dark
4. tailwind.config.ts ตอนนี้ไม่มี hex เลย (อ้าง hsl(var(--x)) ทั้งหมด) — คงรูปแบบนี้ไว้
   เพิ่มเฉพาะชื่อ token ใหม่ที่ §3.3 กำหนดและยังไม่มี
5. radius ตาม §6.2 — ตอนนี้ --radius: 0.625rem ค่าเดียว ถ้า §6.2 ต้องการ 4 ระดับ
   ให้เพิ่มเป็นตัวแปรใหม่ อย่าทับ --radius เดิมเพราะ shadcn ใช้อยู่
6. ยังไม่ต้องแตะ component ใด ๆ ในเฟสนี้

§8 ที่ต้องผ่าน: สี ข้อ 1 (hex เหลือเฉพาะ lib/config/theme.ts — ยกเว้น 2 จุดใน
  app/layout.tsx และ 1 จุดใน components/alerts/line-preview-card.tsx ที่ไปจัดการใน 7.9),
  สี ข้อ 3 (test whitelist), สี ข้อ 5 (คู่ contrast ตาม §3.2–3.5)

จุดหยุดถาม:
- §3.6 dark mode ยังเป็น [ ใส่ ก หรือ ข ] — หยุดถามก่อนเขียนบล็อก .dark ทุกครั้ง
  (RUNBOOK จุดหยุดข้อ 7 และตัวสเปกเองสั่งไว้)
- ถ้าชุดสีกราฟใหม่ไม่ผ่าน validator ของ dataviz (CVD ΔE หรือ chroma floor)
  หยุดถาม อย่าเลือกสีเองนอกบันได §3.1
```

---

### Phase 7.1 — โลโก้

```
ไฟล์: public/brand/ (ว่างอยู่), components/layout/brand-logo.tsx (สร้างใหม่)
แหล่งภาพ: docs/design-refs/Corporate Identity_compressed.pdf (gitignore ไว้แล้ว)

1. หาไฟล์โลโก้ตามลำดับใน §5.1 — docs/design-refs/ ตอนนี้ไม่มีไฟล์โลโก้แยก
   มีแต่ PDF ดังนั้นจะเข้าขั้นตอนที่ 2/3 (pdfimages, pdftoppm มีในเครื่องแล้ว)
2. เขียน components/layout/brand-logo.tsx เป็นจุดเดียวที่ render โลโก้ — §5.2
3. วางตำแหน่งตาม §5.3 (sidebar, /login, mobile top bar)
   — การเสียบเข้า shell จริงทำใน 7.4 และ 7.8b
4. ไฟล์ภาพต้องอยู่ใน public/brand/ และถูก commit (ต่างจาก docs/design-refs/)

§8 ที่ต้องผ่าน: โลโก้ ข้อ 1–2 ทั้งสองข้อ

จุดหยุดถาม:
- extract จาก PDF แล้วได้ภาพเบลอ/พื้นไม่โปร่งใส — หยุดถาม ห้าม trace เป็น SVG เอง (§5.1 ข้อ 4)
- favicon: §5.3 บันทึกเป็น open question ไว้แล้ว (ตอนนี้ app/layout.tsx ชี้ /favicon.svg)
  หยุดถามก่อนเปลี่ยน
```

---

### Phase 7.2 — Typography (Montserrat + IBM Plex Sans Thai)

```
ไฟล์: app/fonts/ (มี IBM Plex Sans Thai 8 ไฟล์แล้ว), app/fonts.ts,
      tailwind.config.ts, app/globals.css

1. เพิ่ม Montserrat .woff2 น้ำหนัก 400/500/600/800 ลง app/fonts/ แล้วประกาศใน app/fonts.ts
   ด้วย next/font/local ตามแบบ plexThai เดิม — §4 (ห้าม next/font/google, ห้าม @fontsource)
2. tailwind.config.ts: fontFamily.sans ตอนนี้เป็น ['var(--font-plex-thai)', ...]
   เปลี่ยนเป็น stack ตาม §4 โดยให้ Montserrat มาก่อน
3. tabular-nums ตาม §4 — ทำเป็น class กลางใน app/globals.css หรือใน lib/utils/format.ts
   จุดเดียว ห้ามกระจายทีละ component
4. ขนาด KPI ตาม §4 — tailwind.config.ts มี fontSize.metric / metric-lg อยู่แล้ว
   ปรับค่าเดิม อย่าสร้างชื่อใหม่ซ้อน

§8 ที่ต้องผ่าน: อื่น ๆ ข้อ 1 (ตัดเน็ตแล้วฟอนต์ยังขึ้น), อื่น ๆ ข้อ 2 (tabular-nums)

จุดหยุดถาม:
- ต้องดาวน์โหลดไฟล์ Montserrat จากอินเทอร์เน็ตบนเครื่องพัฒนา (ตัว build ยังคง self-host 100%)
  หยุดถามก่อนดาวน์โหลด และแจ้งแหล่งที่มา + license OFL
- ถ้าน้ำหนัก 800 ทำให้หัวข้อไทยดูหนาปลอม ให้ทำตาม §4 (ไทยหยุดที่ 700) ไม่ต้องถาม
```

---

### Phase 7.3 — component กลาง: badge, status pill, ปุ่ม

```
ไฟล์: components/ui/ (6 ไฟล์ รวม badge.tsx, status-badge.tsx)

1. status pill ตาม §3.4 — ต้องมีไอคอน + ข้อความเสมอ ห้ามสื่อสถานะด้วยสีอย่างเดียว
2. ปุ่ม primary ตาม §3.5 (กติกาขนาดตัวอักษร / พื้นสำรองเมื่อปุ่มเล็ก)
3. ผิวและ radius ของ card / dialog / input ตาม §6.2
4. เฟสนี้คือจุดที่ให้ผลมากที่สุด: มี 144 จุดใน 47 ไฟล์ที่ใช้คลาส
   status-ok / status-warning / status-critical / status-offline
   ให้ยุบจุดที่ประกอบสีเองมาใช้ component กลางในเฟสนี้ให้มากที่สุด
   ไฟล์ที่ประกอบสีสถานะเองตอนนี้: app/alerts/page.tsx, components/ui/status-badge.tsx,
   components/pumps/pump-card.tsx, components/diagram/diagram-primitives.tsx,
   components/alerts/recent-alerts.tsx, components/alerts/recovery-list.tsx,
   components/ai/anomaly-card.tsx, components/ai/anomaly-type-badge.tsx,
   components/ai/anomaly-timeline.tsx, components/control/audit-log.tsx,
   components/tanks/tank-gauge.tsx
   (ไฟล์ที่ไม่ใช่ components/ui/ ให้แก้ในเฟสของหน้ามันเอง เฟสนี้แค่เตรียม API ให้พร้อม)
5. lib/config/anomaly-types.ts ใช้ tone: EntityStatus อยู่แล้ว ไม่มี hex — ไม่ต้องแก้
   ตรวจแค่ว่า UNKNOWN_ANOMALY_TYPE ยังได้สีกลางตาม §3.7

§8 ที่ต้องผ่าน: สี ข้อ 5 (status ทุกจุดใช้ pill §3.4), สี ข้อ 6 (แดง = วิกฤตเท่านั้น)

จุดหยุดถาม:
- ถ้า §3.4 ทำให้ pill กว้างขึ้นจนแถวตารางใน /alerts หรือ /devices ล้นที่ 375px
  หยุดถามก่อนเปลี่ยนโครงตาราง (เคยแก้ overflow ที่หน้านี้มาแล้ว)
```

---

### Phase 7.4 — Shell (sidebar + header + drawer)

```
ไฟล์: components/layout/ ทั้ง 11 ไฟล์ —
      app-shell.tsx auth-gate.tsx header.tsx lang-toggle.tsx nav-items.ts
      page-placeholder.tsx section.tsx sidebar.tsx theme-provider.tsx
      theme-toggle.tsx user-menu.tsx
      + components/layout/brand-logo.tsx จาก 7.1

1. จัด shell ตาม wireframe §6.1 — header ต้องคง 4 อย่างที่ CLAUDE.md บังคับไว้ครบ
   (เวลาปัจจุบัน, สถานะเชื่อมต่อ, badge "Local Mode", จำนวน alert ที่ยังไม่อ่าน)
2. ชื่อเมนูใช้คีย์ i18n เดิมใน nav-items.ts — §6.1 สั่งว่าถ้า wireframe ต่างจากของเดิม ใช้ของเดิม
3. กล่องสรุประบบท้าย sidebar ดึงจาก service เดิม ห้ามสร้าง service ใหม่ (§6.1)
4. โลโก้ตาม §5.3 — ห้ามวางด้านล่างของหน้า
5. Mobile 375px: sidebar เป็น drawer ตาม §6.1

§8 ที่ต้องผ่าน: โลโก้ ข้อ 2, อื่น ๆ ข้อ 4 (light/dark ที่ 375px และ 1920px)

จุดหยุดถาม:
- ถ้า §6.1 ต้องการ element ใน header ที่ยังไม่มี service รองรับ — หยุดถาม ห้ามแต่งข้อมูลปลอมเพิ่ม
```

---

### Phase 7.5a — กราฟ Recharts

```
ไฟล์: components/charts/chart-tokens.ts, components/charts/sparkline.tsx,
      components/ai/forecast-section.tsx, components/ai/anomaly-evidence-chart.tsx,
      components/ai/anomaly-timeline.tsx, components/environment/temp-vs-usage-chart.tsx,
      components/billing/zone-cost-chart.tsx, components/billing/daily-usage-chart.tsx,
      components/reports/monthly-chart.tsx, components/reports/zone-usage-chart.tsx

1. chart-tokens.ts เป็นจุดเดียวที่กราฟอ่านสี — มีอยู่แล้วและไม่มี hex
   แค่ชี้ไป token ใหม่จาก 7.0 (§3.7: ห้ามใส่ hex ใน props ของกราฟ)
2. seriesColor() เดิม throw เมื่อเกิน 8 ชุด — คงพฤติกรรมนี้ไว้ (กฎ dataviz: ห้ามวนสีซ้ำ)
3. รัน validator ของ dataviz กับชุดสีใหม่ทั้ง light และ dark ก่อนปิดเฟส
4. แนวทางรายหน้าเรื่องกราฟดูที่ §7 (เส้นทึบ/เส้นประของ /ai, data-series-* ของ /reports,
   ช่วงความเชื่อมั่นของหน้าแรก)
5. ห้ามทำ dual-axis และห้ามเปลี่ยนชนิดกราฟ — เฟสนี้เปลี่ยนแค่สีกับเส้น

§8 ที่ต้องผ่าน: สี ข้อ 1, สี ข้อ 3, สี ข้อ 4 (ไม่ใช้ opacity ทำสีอ่อน)

จุดหยุดถาม:
- ถ้า §3.1 ให้สีได้ไม่ถึง 8 ชุดที่ผ่าน CVD ΔE — หยุดถาม (ทางเลือกคือยุบชุดข้อมูลหรือแยกกราฟ
  ไม่ใช่หยิบสีนอก CI)
```

---

### Phase 7.5b — SVG ที่เขียนมือเอง

```
ไฟล์: components/tanks/tank-gauge.tsx, components/diagram/flow-diagram.tsx,
      components/diagram/diagram-primitives.tsx

1. tank gauge คือจุดเด่นเดียวของทั้งแอปตาม §6.3 — ปรับหน้าตา ห้ามเขียนใหม่
   animation ระดับน้ำคงเดิมและต้องเคารพ prefers-reduced-motion
2. ผังการไหลตาม §7 แถว /overview (ท่อ, node, จุดที่ AI ตรวจพบ)
3. สีทุกค่าอ่านจาก lib/config/theme.ts ผ่าน chart-tokens.ts — §3.7
4. ตัวเลข L และ % ใช้ขนาด KPI ตาม §4

§8 ที่ต้องผ่าน: สี ข้อ 1, อื่น ๆ ข้อ 2, อื่น ๆ ข้อ 4

จุดหยุดถาม:
- ถ้าต้อง glow/effect บนผังการไหล §7 อนุญาตไว้แล้ว (กฎห้าม effect ใช้กับโลโก้เท่านั้น) ไม่ต้องถาม
- ถ้าการเปลี่ยนสีทำให้เส้น threshold กลืนกับตัวน้ำ — หยุดถาม
```

---

### Phase 7.6a — หน้า `/` ภาพรวม

```
ไฟล์: app/page.tsx (import ตรง 9 ตัว)
      + components/tanks/ (3) components/pumps/ (2)
        components/zones/ (4) components/environment/ (3)

แนวทางหน้าตาม §7 แถว `/` และผิว/radius ตาม §6.2
KPI ใหญ่ตาม §4 — นี่คือหน้าที่จอแขวนผนังเปิดค้างไว้

§8 ที่ต้องผ่าน: สี ข้อ 2 (ไม่มีคลาสสีสำเร็จรูปของ Tailwind), สี ข้อ 4, อื่น ๆ ข้อ 2, 3, 4

จุดหยุดถาม: ถ้า §7 ทำให้ต้องย้าย/ตัดข้อมูลออกจากหน้า — หยุดถาม (สเปกบอก restyle เท่านั้น
เนื้อหาคงเดิม)
```

---

### Phase 7.6b — `/control` + `/overview`

```
ไฟล์: app/control/page.tsx, app/overview/page.tsx, components/control/ (9 ไฟล์)

แนวทางตาม §7 แถว /control และ /overview
ปุ่ม emergency และปุ่มที่ถูก interlock มีกติกาสีเฉพาะใน §7 — อ่านก่อนแก้
state machine ของคำสั่ง (sending → awaiting_feedback → …) ห้ามแตะ เปลี่ยนแค่หน้าตา

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 6, อื่น ๆ ข้อ 3, 4, 5

จุดหยุดถาม:
- pin-gate.tsx / confirm-dialog.tsx เป็น UI-only ตามที่ตกลงไว้ — ห้ามทำให้ดูเหมือน
  ระบบยืนยันตัวตนจริงกว่าเดิม ถ้าสเปกดูจะสั่งแบบนั้น หยุดถาม
```

---

### Phase 7.7a — `/devices` + `/alerts`

```
ไฟล์: app/devices/page.tsx, app/alerts/page.tsx,
      components/devices/ (3), components/alerts/ (3)

แนวทางตาม §7 แถว /devices และ /alerts (stat card, filter bar, side panel, severity pill)
components/alerts/line-preview-card.tsx มี hex #06C755 อยู่ 1 จุด = สีแบรนด์ LINE
ไม่ใช่สี CI — ตัดสินใจในเฟสนี้ว่าจะย้ายเข้า lib/config/theme.ts เป็นค่า brand ภายนอก
หรือใส่ข้อยกเว้นใน whitelist แล้วบันทึกไว้

§8 ที่ต้องผ่าน: สี ข้อ 1 (พร้อมข้อยกเว้นที่บันทึกแล้ว), สี ข้อ 2, สี ข้อ 5, อื่น ๆ ข้อ 4

จุดหยุดถาม:
- สี LINE เป็นสีแบรนด์ของบริษัทอื่น เปลี่ยนแล้ว preview จะไม่เหมือนของจริง — หยุดถาม
```

---

### Phase 7.7b — `/reports`

```
ไฟล์: app/reports/page.tsx, components/reports/ (2), components/billing/ (3)

แนวทางตาม §7 แถว /reports — stat card เปรียบเทียบช่วงก่อนหน้า
ข้อความ "ช่วงวันที่ / ช่วงก่อนหน้า" ถูกแก้ให้ชัดเจนไปแล้วในเฟสก่อน — ห้ามเปลี่ยนคำกลับ

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 4, อื่น ๆ ข้อ 2, 4
จุดหยุดถาม: ไม่มีจุดเฉพาะ ใช้จุดหยุดกลางของ RUNBOOK
```

---

### Phase 7.7c — `/ai`

```
ไฟล์: app/ai/page.tsx (import ตรง 10 ตัว), components/ai/ (11 ไฟล์
      — anomaly-evidence-chart.tsx และ anomaly-timeline.tsx ทำไปแล้วใน 7.5a)

แนวทางตาม §7 แถว /ai
UI ต้อง render ได้แม้ field ไม่ครบหรือเจอ anomaly type ที่ไม่รู้จัก (CLAUDE.md) — ห้ามทำ
ให้ fallback หายไปตอนจัดสไตล์
formatAnomalyScore() เป็นจุดเดียวที่แปลง 0–1 เป็น % — ห้ามคูณ 100 เพิ่มในเฟสนี้
scenario switcher คงไว้ตาม §7

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 5, สี ข้อ 6, อื่น ๆ ข้อ 3, 4

จุดหยุดถาม:
- ถ้าการจัดสไตล์ทำให้ต้องเพิ่ม field ที่ทีม AI ไม่ได้ส่งมา — หยุดถาม ห้ามแก้ lib/types.ts
```

---

### Phase 7.8a — `/settings`

```
ไฟล์: app/settings/page.tsx (import ตรง 15 ตัว), components/settings/ (13 ไฟล์)

แนวทางตาม §7 แถว /settings — tab + ฟอร์ม, ข้อความ error ภาษาไทยมีกติกาสีเฉพาะใน §7
ค่าตั้งต้นทั้งหมดอยู่ใน withDefaults() ตอนโหลดแล้ว — ห้ามย้ายกลับไปใส่ ?? ใน component

§8 ที่ต้องผ่าน: สี ข้อ 2, สี ข้อ 5, อื่น ๆ ข้อ 3, 4, 5
จุดหยุดถาม: ไม่มีจุดเฉพาะ ใช้จุดหยุดกลางของ RUNBOOK
```

---

### Phase 7.8b — `/login`

```
ไฟล์: app/login/page.tsx (import ตรง 5 ตัว), components/layout/auth-gate.tsx

แนวทางตาม §7 แถว /login — split layout, ฝั่งซ้ายใช้พื้นบันไดสี ไม่ใช้ภาพจาก template
โลโก้มุมซ้ายบนฝั่งภาพตาม §5.3
การ์ดบัญชีทดลองคงไว้ตาม §7

§8 ที่ต้องผ่าน: โลโก้ ข้อ 1–2, สี ข้อ 2, สี ข้อ 5, อื่น ๆ ข้อ 3, 4

จุดหยุดถาม:
- หน้านี้เป็น UI อย่างเดียว ไม่ใช่ระบบยืนยันตัวตนจริง ห้ามจัดสไตล์ให้ดูเหมือนของจริงกว่าเดิม
  หรือเพิ่มช่องกรอกที่สื่อว่าเก็บรหัสผ่านจริง — ถ้าสเปกดูจะสั่งแบบนั้น หยุดถาม
```

---

### Phase 7.9 — sweep + acceptance

```
1. รัน grep 2 บรรทัดใน §8 หมวด "สี" ข้อ 1 และ 2 ให้ได้ผลตามเกณฑ์
   ค่าตั้งต้นก่อนเริ่ม Phase 7: hex 3 จุด (app/layout.tsx 2, line-preview-card.tsx 1)
   คลาสสีสำเร็จรูปของ Tailwind 0 จุด (ต้องคง 0 ไว้)
   app/layout.tsx: themeColor 2 ค่า ต้องอ่านจาก lib/config/theme.ts หรือย้ายเข้า whitelist
2. เขียน test whitelist ตาม §8 สี ข้อ 3 — แปลง HSL กลับเป็น hex แล้วเทียบตาราง §3.1
   (ยอมคลาด ±1 ต่อ channel ตาม §3.7)
3. ตรวจ opacity ที่ใช้ทำสีอ่อน (§8 สี ข้อ 4) — ตอนนี้มี 76 จุดใน 41 ไฟล์ที่ใช้รูปแบบ /10 /20
   ต้องแยกให้ได้ว่าจุดไหนเป็น "สีอ่อน" (ต้องแก้) จุดไหนเป็น overlay/เงา (ไม่ต้องแก้)
4. ตรวจ light + dark ที่ 375px และ 1920px ทุก 9 หน้า (§8 อื่น ๆ ข้อ 4)
   วัด scrollWidth เทียบ viewport ด้วย — เคยเจอ overflow ที่ /alerts มาแล้ว
5. ตัด network ใน devtools แล้วเช็คว่าฟอนต์ยังขึ้น (§8 อื่น ๆ ข้อ 1)
6. ตรวจ i18n th/en ครบคู่ (§8 อื่น ๆ ข้อ 3)
7. git diff --stat ต้องไม่มีไฟล์ใน lib/services/, lib/mock/, lib/types.ts, lib/hooks/
   (§8 อื่น ๆ ข้อ 5)
8. npx tsc --noEmit และ npm run build ผ่าน
9. อัปเดต docs/BRANDING_SPEC.md ตรงจุดที่โค้ดจริงต่างจากสเปก (กฎ CLAUDE.md: แก้เอกสารตามโค้ด)

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
