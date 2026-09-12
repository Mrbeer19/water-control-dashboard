# CLAUDE.md — Water Control & Monitoring Dashboard

## บริบทโปรเจกต์

Frontend dashboard สำหรับระบบมอนิเตอร์และควบคุมการใช้น้ำในโรงงาน (AIoT capstone project)
ข้อมูลทั้งหมดมาจากเซนเซอร์ที่ติดตั้งจริงในโรงงาน ระบบทำงานแบบ on-premise 100%

## ขอบเขตงาน — อ่านให้ครบก่อนเริ่ม

- **ทำเฉพาะ Frontend เท่านั้น** ไม่ต้องเขียน backend, API route, database, MQTT client จริง
- ใช้ mock data ทั้งหมด เก็บใน `lib/mock/` และเรียกผ่าน service layer ใน `lib/services/`
- Component **ห้ามเรียก mock data ตรง ๆ** ต้องผ่าน service layer เสมอ เพื่อให้ทีมหลังบ้านสลับเป็น API จริงได้ที่จุดเดียว
- ทุกฟังก์ชันใน service layer ต้องมีคอมเมนต์ `// TODO(backend):` ระบุว่าต้องต่อ endpoint อะไร method อะไร
- Mock data ต้องขยับเองแบบ real-time (setInterval) เพื่อให้เห็น animation และกราฟเคลื่อนไหวตอนสาธิต

## Stack

- Next.js 14+ (App Router) + TypeScript (strict mode)
- Tailwind CSS + shadcn/ui
- Recharts สำหรับกราฟ
- lucide-react สำหรับไอคอน
- ห้ามเพิ่ม dependency นอกเหนือจากนี้โดยไม่ถามก่อน

## ข้อจำกัดสำคัญ: On-Premise 100%

ระบบต้องรันบน VM ในโรงงาน ไม่มีอินเทอร์เน็ต

- ห้ามเรียก external API, CDN, Google Fonts, map tile, analytics ใด ๆ
- font / icon / library ทุกตัวต้อง self-host และ bundle มากับ build
- ห้ามใช้ weather API — ข้อมูลอุณหภูมิ/ความชื้น/ฝน มาจากเซนเซอร์ในพื้นที่เท่านั้น
- ทุกหน้าต้องใช้งานได้ปกติเมื่อตัดสาย WAN

## แนวทาง UI

- ภาษาไทยเป็นหลัก มี toggle EN (ใช้ dictionary object ธรรมดา ไม่ต้องลง i18n library)
- Responsive: desktop สำหรับจอในห้องคอนโทรล, mobile สำหรับช่างเทคนิค
- รองรับ dark mode (ห้องคอนโทรลเปิดจอทิ้งไว้ตลอด)
- Header ทุกหน้า: เวลาปัจจุบัน, สถานะการเชื่อมต่อ, badge "Local Mode", จำนวน alert ที่ยังไม่อ่าน
- ตัวเลขสำคัญต้องอ่านได้จากระยะไกล (จอแขวนผนัง) — font size ใหญ่ contrast สูง
- สีสถานะ: เขียว = ปกติ, เหลือง = เตือน, แดง = วิกฤต, เทา = offline

## Hardware จริงที่ระบบนี้มอนิเตอร์

*ปรับตามผลสำรวจหน้างาน 12 ก.ย. 2569 — ผังเต็มอยู่ใน `PROJECT_BRIEF.md` (นอก repo)*

```
การประปา ─► มิเตอร์หลัก ─┬─► ถัง 1 (70,000 L) ─┬─► ปั๊ม 1 ─┐
                         │                     │           ├─► มิเตอร์รายโซน
                         │                     └─► ปั๊ม 2 ─┘
                         │                     └─► ถัง VIP (3,000 L) ─► ปั๊ม 3 ─► โซน VIP
                         └─► บ่อสำรอง (490,000 L) ─► สูบกลับเข้าถัง 1 เมื่อประปาไม่ไหล
```

- **ถังน้ำ 3 ใบ** — ถัง 1 ใต้ดินหลัก 70,000 L · ถัง VIP 3,000 L · บ่อสำรอง 490,000 L
  บ่อสำรองเป็นบ่อขุดหน้าตัดไม่คงที่ **ต้องแปลงปริมาตรผ่าน `levelToVolumeTable`** ห้ามใช้ level × area
- **ปั๊ม 3 ตัว** — ปั๊ม 1, 2 = main (ที่ถัง 1 ใช้ตู้ควบคุมเดิมของโรงงาน) · ปั๊ม 3 = VIP (มี VFD)
  ★ **ปั๊ม 1 กับ 2 จ่ายให้ทุกโซนเหมือนกัน ไม่ได้แบ่งโซนกัน** แต่สลับเวรกันเดินตัวละ 12 ชม.
  ณ เวลาหนึ่งมีปั๊มหลักเดินอยู่ตัวเดียว อีกตัวเป็นตัวสำรอง
- **มิเตอร์รายโซน** — **จำนวนยังไม่สรุป** ห้าม fix เลขไว้ในโค้ดหรือข้อความ
  หน้างานจริงมิเตอร์ทุกตัว**อยู่รวมกันจุดเดียว** แบ่งเป็นโซนตามการใช้งาน แต่ละโซนมีวาล์วไฟฟ้าของตัวเอง (ท่อจ่าย 1")
- **มิเตอร์หลัก** รับน้ำจากการประปา (ท่อ 2") — น้ำที่เข้าทั้งถัง 1 และบ่อสำรองผ่านมิเตอร์นี้
- ESP32 node ที่จุดวัด + Siemens S7-1200 PLC + Mitsubishi FX3G + SIMATIC IOT2000 gateway
- **การควบคุม: ปั๊ม → PLC · วาล์ว → ESP32**
  ★ วาล์วไม่ได้อยู่หลัง PLC จึงไม่มี interlock ระดับฮาร์ดแวร์คอยกันคำสั่งอันตราย
  backend ต้องตรวจ `ControlInterlock` ฝั่งเซิร์ฟเวอร์ก่อนส่งทุกครั้ง (ดู `HANDOFF.md` หัวข้อ 3)
- Environment sensor 3 จุด: ห้องปั๊ม, ตู้คอนโทรล, กลางแจ้ง (จุดในอาคารส่ง `null` สำหรับ hPa/lux/ฝน)

## AI ในระบบนี้ (ทีมอื่นทำ — frontend แสดงผลเท่านั้น)

- ทีม AI แยกต่างหากเป็นคนกำหนดว่าตรวจอะไร พยากรณ์อะไร frontend ห้ามคิด logic ตรวจจับเอง
- รับผลลัพธ์ผ่าน lib/services/ai.ts เท่านั้น
- Anomaly type เป็น string เปิด ห้าม hardcode enum — mapping ชื่อไทย/ไอคอน/สี อยู่ใน lib/config/anomaly-types.ts
- UI ต้อง render ได้แม้ field ไม่ครบหรือเจอ type ที่ไม่รู้จัก
- Contract กับทีม AI อยู่ใน docs/AI_CONTRACT.md — ถ้าจะแก้ type ฝั่ง AI ต้องอัปเดตไฟล์นี้ด้วย
- Mock ต้องมี scenario toggle (normal / night_leak / pump_degrading) สำหรับสาธิต

## หน่วยและการคำนวณ

- ระดับน้ำ: ลิตร (L) แสดงคู่กับ %
- อัตราไหล: L/min
- ปริมาตรสะสม: m³ (1 ยูนิต = 1 m³)
- ไฟฟ้า: V, A, W, kWh
- Unaccounted water = มิเตอร์หลัก − ผลรวมทุกโซน − **Δ ปริมาณน้ำในถังทุกใบ** (ตัวชี้วัดการรั่ว)
  ★ **ห้ามละ Δstorage** ช่วงที่กำลังเติมถังหรือเติมบ่อสำรอง น้ำที่ผ่านมิเตอร์หลักยังไม่ถูกใช้
  ถ้าใช้แค่ (main − Σzone) ระบบจะเตือนว่ารั่วทุกครั้งที่เติมถัง
  Δ ต้องรวมบ่อสำรองด้วย เพราะน้ำเข้าบ่อก็ผ่านมิเตอร์หลักเหมือนกัน

## โครงสร้างโปรเจกต์ที่ต้องการ

```
app/
  layout.tsx
  page.tsx                 # Overview
  control/page.tsx
  settings/page.tsx
  devices/page.tsx
  overview/page.tsx        # Infographic แผนผังการไหล
  alerts/page.tsx
  reports/page.tsx
  ai/page.tsx              # AI Insights: anomaly, prediction, predictive maintenance
components/
  layout/                  # Header, Sidebar, ThemeToggle, LangToggle
  tanks/  pumps/  zones/  environment/  control/  devices/  diagram/  alerts/  ai/
  ui/                      # shadcn
lib/
  types.ts                 # ★ API contract ส่งให้ทีมหลังบ้าน
  services/                # ★ จุดเดียวที่หลังบ้านต้องมาแก้
  mock/                    # mock data + simulator
  utils/                   # format, calculation
  i18n/
```

## กฎการเขียนโค้ด

- TypeScript strict — ห้ามใช้ `any`
- type ทุกตัวรวมอยู่ใน `lib/types.ts` ไฟล์เดียว (จะ export ให้ทีมหลังบ้าน)
- ตั้งชื่อ component และ prop เป็นภาษาอังกฤษ ข้อความบน UI เป็นภาษาไทย
- แยกไฟล์ให้ชัด หนึ่ง component หนึ่งไฟล์
- ทุกหน้าต้องมี loading state และ empty state
- ตัวเลขจัดรูปแบบผ่าน util กลาง (`formatLiters`, `formatCubicMeters`, `formatBaht`, `formatDateTimeTH`)

## Brand rules (Phase 7 เป็นต้นไป)

สีและฟอนต์ทั้งระบบยึดตาม Corporate Identity ของ Kasetphand — สเปกเต็มอยู่ที่ `docs/BRANDING_SPEC.md`

- **hex ทุกค่าอยู่ใน `lib/config/theme.ts` ที่เดียว** component ใช้ semantic token ผ่านคลาสของ Tailwind เท่านั้น
- ห้ามใช้ palette สำเร็จรูปของ Tailwind (`red-500`, `slate-*` ฯลฯ) และห้ามคิดสีเอง
- ห้ามใช้ opacity กับ พื้น/ขอบของสถานะ · สีชุดข้อมูลในกราฟ · สีข้อความ (hover/disabled/backdrop ใช้ได้)
- สถานะต้องมีไอคอน + ข้อความเสมอ ใช้ `<StatusBadge>` จุดเดียว ห้ามประกอบสีเอง
- กราฟใช้ได้ 2 สีหลัก + 1 สีอ้างอิง — เกินกว่านั้นให้หยุดถาม
- โลโก้ render ผ่าน `components/layout/brand-logo.tsx` จุดเดียว
- ตรวจก่อน commit เสมอ: `npm run check:colors`

## วิธีทำงาน

อ่าน `RUNBOOK.md` ที่ root — เป็นตัวกำหนดลูปการทำงาน เช็คลิสต์รีวิวตัวเอง
และจุดที่ต้องหยุดถามก่อนตัดสินใจ ใช้กับทุกเฟส

กฎที่สำคัญที่สุด: **ของที่มีอยู่ในโค้ดชนะสเปกใน `PROMPTS.md` เสมอ**
ถ้าสองอย่างไม่ตรงกัน ให้แก้เอกสารตามโค้ด ไม่ใช่รื้อโค้ดตามเอกสาร
