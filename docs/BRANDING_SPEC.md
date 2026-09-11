# BRANDING_SPEC.md — Kasetphand CI สำหรับ Water Control Dashboard

> เอกสารอ้างอิงของ **Phase 7 (UI Branding)** — phase ย่อยใน `PROMPTS.md` อ้างอิงไฟล์นี้ด้วยเลขข้อ
> แก้สเปกที่ไฟล์นี้ที่เดียว ไม่คัดลอกเนื้อหาไปไว้ใน PROMPTS.md

---

## 1. ขอบเขต

Frontend ทำครบทุกหน้าแล้ว Phase 7 คือการ**เปลี่ยนหน้าตา**ทั้งแอปให้เป็นไปตาม Corporate Identity ของ Kasetphand Group และใส่โลโก้องค์กร

| อนุญาต | ห้าม |
|---|---|
| แก้สี ฟอนต์ ระยะ radius เงา ใน component เดิม | แตะ `lib/services/`, `lib/mock/`, `lib/types.ts`, `lib/hooks/` |
| ปรับ layout ของ shell (`components/layout/`) และหน้า `/login` | เปลี่ยน route, behavior, state machine ของคำสั่ง, PIN modal, double confirm, interlock |
| เพิ่ม component แสดงผล (`BrandLogo`, status pill) และ `lib/config/theme.ts` | เพิ่มฟีเจอร์ใหม่ (เช่น ช่องค้นหา, ตัวเลือกอาคาร) |
| เพิ่มคีย์ใน `lib/i18n/` สำหรับข้อความใหม่ (th + en) | เพิ่ม dependency (ฟอนต์ให้วางไฟล์ใน `app/fonts/` แทน) |
| | โหลดอะไรจากอินเทอร์เน็ตตอน runtime (on-premise 100%) |

**การตีความกฎ "ของที่มีอยู่ชนะ" ใน Phase 7:** ใช้กับโครงสร้าง ข้อมูล และพฤติกรรม ส่วน**สีและฟอนต์เดิมถูกแทนที่ด้วยสเปกนี้โดยตั้งใจ** ไม่ต้องหยุดถามเรื่องนี้ แต่ถ้าการเปลี่ยนหน้าตาบังคับให้แก้ behavior หรือ type ให้หยุดถามตาม RUNBOOK

## 2. ไฟล์อ้างอิง

อยู่ที่ `docs/design-refs/` (อยู่ใน `.gitignore` — เอกสาร CI ขององค์กรและภาพหน้าจอ KLC ไม่ขึ้น repo)

| ไฟล์ | เอาอะไร | ไม่เอาอะไร |
|---|---|---|
| `Corporate Identity_compressed.pdf` | **แหล่งความจริงเรื่องแบรนด์** — สี, ฟอนต์อังกฤษ, กฎโลโก้, ไฟล์โลโก้ | — |
| `02_Admin_Dashboard_.png` | sidebar + active pill แดง, topbar, KPI card + sparkline, กล่อง "สิ่งที่ต้องติดตาม" | hero banner + mascot, ช่องค้นหา |
| `03_AnnualPlan_Timeline_.png` | page header + stat card พร้อม progress bar, แถบ tabs + filter | Gantt timeline |
| `04_AnnualPlan_CourseDetail_.png` | drawer ด้านขวา (tabs, info grid, action ล่าง drawer) | — |
| `01_Login_.png` | split layout ภาพซ้าย/ฟอร์มขวา, toggle ภาษา + theme มุมขวาบน | mascot, รูปถ่าย, ปุ่ม SSO |
| `water.jpg` | ลักษณะ gauge น้ำ, แท่งแนวตั้ง, toggle | mascot หยดน้ำ, palette ของภาพ |
| `a8d56b58….jpg` | panel ขวาแบบ recent activity, donut | palette ม่วง |

ภาพอ้างอิงใช้เพื่อ layout และลำดับข้อมูลเท่านั้น **ห้ามคัดลอก mascot ภาพประกอบ หรือรูปถ่าย** และห้าม import ไฟล์ใน `docs/design-refs/` เข้า bundle

## 3. สีทั้งระบบ = สี CI ของ Kasetphand เท่านั้น

**กฎเหล็ก:** ทุก hex ในแอปต้องมาจากตาราง 3.1 ห้ามคิดสีเอง ห้ามใช้ palette ของ Tailwind/shadcn (`red-500`, `slate-*` ฯลฯ) ห้ามใช้ opacity ทำสีอ่อน ถ้าต้องการสีอ่อนหรือเข้มกว่านี้ให้เลือกขั้นจากบันไดสีในตาราง ถ้าไม่มีขั้นที่ใช้ได้ ให้หยุดถาม

ข้อยกเว้นเดียว: `#FFFFFF` สำหรับพื้นการ์ด (CI เองวางโลโก้บนหน้าขาว)

### 3.1 ตารางสี

สีหลัก 6 สีเป็นค่า Hex ทางการจาก CI (ค่า CMYK ใน PDF ไม่ตรงกันระหว่างหน้า แต่ Hex ตรงกันทุกหน้า → ใช้ Hex)
ขั้นอื่นในบันไดสี sample จากหน้า **"Color / CMYK System"** (Primary และ Secondary) — คลาดเคลื่อนได้ ±3 ต่อ channel เพราะไฟล์ถูกบีบอัด ใส่คอมเมนต์ `// sampled from CI p.13/p.17 — confirm with brand owner` ไว้ในไฟล์ tokens

| ขั้น | Cinnabar | Argent | Royal Navy Blue | Marigold | Green Revolution |
|---|---|---|---|---|---|
| 900 (เข้มสุด) | `#624D4A` | `#515558` | `#4B4E5F` | `#625B4B` | `#48534B` |
| 800 | `#92584A` | `#6D6C71` | `#536281` | `#937A52` | `#526E57` |
| 700 | `#BC5242` | `#7E7D82` | `#44699D` | `#C29345` | `#428154` |
| **500 (ทางการ)** | **`#E9242B`** | **`#888888`** | **`#026BB5`** | **`#F2A81E`** | **`#009148`** |
| 300 | `#F05D49` | `#9C9C9C` | `#4E80BF` | `#F7B94C` | `#4CA062` |
| 200 | `#F5856D` | `#B4B0B1` | `#8290B5` | `#FBC77B` | `#7BB481` |
| 100 (อ่อนสุด) | `#F7AB94` | `#CBC7C8` | `#A5AECF` | `#FDD8A3` | `#A3C8A7` |

Neutral: Lynx White `#F7F7F7` (พื้นหน้า), `#FFFFFF` (พื้นการ์ด)

ตั้งชื่อ token เป็น `cinnabar-900 … cinnabar-100` ฯลฯ แล้วสร้าง semantic token ทับอีกชั้น (ข้อ 3.3) component ใช้เฉพาะ semantic token

### 3.2 Contrast ที่คำนวณแล้ว (WCAG, บนพื้น `#FFFFFF` / `#F7F7F7`)

| สี | บนขาว | บน Lynx White | ใช้เป็นข้อความได้ไหม |
|---|---|---|---|
| `#515558` Argent-900 | 7.5 | 7.0 | ✓ ข้อความหลัก |
| `#6D6C71` Argent-800 | 5.2 | 4.9 | ✓ ข้อความรอง |
| `#888888` Argent-500 | 3.5 | 3.3 | ✗ ใช้แค่ไอคอน/เส้นขอบ |
| `#026BB5` Blue-500 | 5.6 | 5.2 | ✓ |
| `#E9242B` Cinnabar-500 | 4.4 | 4.1 | ✗ ข้อความเล็ก — ใช้ได้เมื่อ ≥ 18.66px bold |
| `#BC5242` Cinnabar-700 | 4.8 | 4.4 | ✓ เฉพาะบนการ์ดขาว |
| `#92584A` Cinnabar-800 | 5.7 | 5.3 | ✓ ทุกพื้น |
| `#009148` Green-500 | 4.1 | 3.8 | ✗ ใช้แค่ไอคอน/จุด |
| `#526E57` Green-800 | 5.6 | 5.3 | ✓ |
| `#F2A81E` Marigold-500 | 2.0 | 1.9 | ✗ ใช้เป็นพื้น/แถบเท่านั้น |
| `#625B4B` Marigold-900 | 6.7 | 6.3 | ✓ |

### 3.3 Semantic tokens

| Token | ค่า | ใช้ที่ |
|---|---|---|
| `bg-page` | `#F7F7F7` | พื้นหน้า |
| `bg-card` | `#FFFFFF` | การ์ด, sidebar, topbar |
| `border` | Argent-100 `#CBC7C8` | เส้นขอบการ์ด/ตาราง |
| `text-primary` | Argent-900 `#515558` | ข้อความหลัก, ตัวเลข KPI |
| `text-secondary` | Argent-800 `#6D6C71` | label, คำอธิบาย |
| `brand` | Cinnabar-500 `#E9242B` | nav active, ปุ่ม primary, โลโก้ lockup |
| `brand-hover` | Cinnabar-700 `#BC5242` | hover/pressed ของปุ่ม primary |
| `data-water` | Blue-500 `#026BB5` | ตัวเลข/เส้นกราฟข้อมูลน้ำ |
| `data-water-soft` | Blue-100 `#A5AECF` | พื้นที่ใต้กราฟ, ช่วงคาดการณ์ |
| `data-series-2..4` | Blue-800 `#536281`, Green-500 `#009148`, Marigold-500 `#F2A81E` | กราฟหลายชุด (เช่น เทียบแผนก) |
| `focus-ring` | Blue-500 `#026BB5` | keyboard focus |

**กฎการใช้แดง:** แดงใน chrome (โลโก้, nav active, ปุ่ม primary) = แบรนด์ ส่วนแดงในพื้นที่ข้อมูล (การ์ด, กราฟ, ตาราง) = วิกฤตเท่านั้น ห้ามใช้แดงตกแต่งในพื้นที่ข้อมูล

### 3.4 Status pill (ทุกคู่ผ่าน ≥ 4.5:1 ใช้ได้ทั้งบนพื้นขาวและพื้นเข้ม)

น้ำหนักทางสายตาเพิ่มตามความรุนแรง: ปกติ/offline ไม่มีพื้น, เตือนมีพื้นอ่อน, วิกฤตมีพื้นเข้มเต็ม

| สถานะ | พื้น pill | ข้อความ | Contrast | จุด/ไอคอน |
|---|---|---|---|---|
| ปกติ | ไม่มี | Green-800 `#526E57` | 5.6 | จุด Green-500 `#009148` |
| เตือน | Marigold-100 `#FDD8A3` | Marigold-900 `#625B4B` | 5.0 | ไอคอน Marigold-900 |
| วิกฤต | Cinnabar-700 `#BC5242` | `#FFFFFF` | 4.8 | ไอคอนขาว |
| Offline | ไม่มี | Argent-800 `#6D6C71` | 5.2 | จุด Argent-500 `#888888` |

ทุก pill ต้องมี **ไอคอน + ข้อความ** เสมอ ห้ามสื่อสถานะด้วยสีอย่างเดียว

### 3.5 ปุ่ม primary

Cinnabar-500 + ตัวอักษรขาว = 4.42:1 (ขาดเกณฑ์ AA 4.5 อยู่ 0.08) → ตัวอักษรในปุ่ม primary ใช้ **≥ 18.66px bold** (ผ่านเกณฑ์ข้อความใหญ่) ถ้าปุ่มเล็กกว่านั้นให้ใช้พื้น Cinnabar-700 `#BC5242` (4.75:1)

### 3.6 Dark mode

`CLAUDE.md` บังคับให้รองรับ dark mode แต่ CI ไม่มีชุดสีสำหรับพื้นเข้ม ขั้นเข้มสุดในบันไดคือ Argent-900 `#515558` ซึ่งยังไม่มืดพอสำหรับจอห้องควบคุม และ Cinnabar-500 บนพื้นนี้ได้ contrast แค่ 1.7:1

**ทางที่เลือก:** `[ ใส่ ก หรือ ข ]` — ถ้ายังว่างอยู่ Phase 7.0 ต้อง **หยุดถาม** (RUNBOOK จุดหยุดข้อ 7)

- (ก) **CI เคร่งครัด:** dark mode ใช้ Argent-900 เป็นพื้นหน้า, Argent-800 เป็นการ์ด, ข้อความ Lynx White (4.9–7.0:1), สถานะใช้ pill แบบมีพื้นจาก 3.4 เท่านั้น, กราฟใช้ขั้น 100 — ข้อเสีย: พื้นเป็นเทากลางไม่ใช่มืดจริง และกราฟ contrast ต่ำ
- (ข) **ขยายเฉพาะเทา:** เพิ่ม Argent-950 และ Argent-1000 (เทาเข้มกว่า ต่อจากบันไดเดิมโดยไม่เปลี่ยน hue) ใช้เป็นพื้นของ dark mode เท่านั้น ส่วนสีมีโทนทุกสีคงเป็นขั้นจาก CI — ข้อเสีย: มี 2 ค่าที่ไม่อยู่ใน CI ต้องแจ้งเจ้าของแบรนด์

### 3.7 สีในโค้ดที่ไม่ใช่ CSS class

- **shadcn:** map ค่าจากข้อ 3.3 เข้าตัวแปรเดิมใน `app/globals.css` (`--primary`, `--destructive`, `--border`, `--ring` ฯลฯ) โดย**คงรูปแบบค่าที่ไฟล์ใช้อยู่** (HSL หรือ oklch) และใส่คอมเมนต์ hex ต้นฉบับข้างทุกตัว — component ของ shadcn จะได้สี CI โดยไม่ต้องแก้ทีละตัว
- **Recharts / SVG เขียนมือ** (tank gauge, ผังการไหล): อ่านสีจาก `lib/config/theme.ts` จุดเดียว ห้ามใส่ hex ใน props ของกราฟ
- **`lib/config/anomaly-types.ts`:** สีของแต่ละ type ต้องชี้ไป semantic token ไม่ใช่ hex, และ type ที่ไม่รู้จักใช้สี `text-secondary` + ไอคอน default
- Test whitelist ต้องแปลงค่า HSL/oklch กลับเป็น hex ก่อนเทียบกับตาราง 3.1 (ยอมคลาดจากการปัดเศษ ±1 ต่อ channel)

## 4. Typography

- **ไทย:** IBM Plex Sans Thai ที่ bundle อยู่แล้วใน `app/fonts/` — คงไว้ (CI ฉบับนี้ไม่ระบุฟอนต์ไทย)
- **อังกฤษ + ตัวเลข:** Montserrat ตาม CI — วางไฟล์ `.woff2` (OFL) น้ำหนัก 400/500/600/800 ใน `app/fonts/` แล้วโหลดด้วย `next/font/local` ห้ามใช้ `next/font/google` หรือแพ็กเกจ `@fontsource`
- Font stack: `Montserrat, "IBM Plex Sans Thai", sans-serif` — อักษรละตินและตัวเลขเป็น Montserrat ส่วนไทยตกไปที่ IBM Plex Sans Thai
- Montserrat ExtraBold 800 ใช้เฉพาะชื่อหน้าและตัวเลข KPI ใหญ่, label 500–600, body 400
- IBM Plex Sans Thai หนักสุดที่ 700 → หัวข้อภาษาไทยตั้ง `font-weight: 700` อย่าตั้ง 800 (เบราว์เซอร์จะทำตัวหนาปลอม)
- ตัวเลขที่อัปเดต realtime ใช้ `font-variant-numeric: tabular-nums` (ใส่ใน util/format หรือ class กลาง ไม่กระจายทีละ component)
- ตัวเลข KPI สำหรับจอแขวนผนัง: ≥ 48px ที่ 1920px, ≥ 32px ที่ 375px, สี `text-primary` หรือ `data-water`

## 5. โลโก้

### 5.1 การได้ไฟล์

1. ถ้า `docs/design-refs/` มีไฟล์โลโก้ (png/svg/ai) → ใช้ไฟล์นั้น
2. ไม่มี → `pdfimages -list` ดูว่ามีภาพโลโก้ฝังอยู่ไหม ถ้ามีให้ extract
3. ยังไม่ได้ → render หน้า **"Logo Primary / Primary Color Usage"** (มุมขวาบนเขียน 09, โลโก้บนพื้นขาว — ในไฟล์ compressed คือหน้า PDF ที่ 11) ด้วย `pdftoppm -r 600` crop เฉพาะกล่องแดงมุมโค้ง พื้นรอบกล่องโปร่งใส → `public/brand/kasetphand-logo.png` และ `@2x`
4. **ห้าม** วาด/trace เป็น SVG เอง, ห้ามตัดเอาเฉพาะตัว K, ห้ามพิมพ์คำว่า KASETPHAND ด้วยฟอนต์

### 5.2 Component `components/layout/brand-logo.tsx`

- จุดเดียวที่ render โลโก้ในทั้งแอป
- สัดส่วนกล่อง **14 : 10** → `aspect-ratio: 14 / 10`, `object-fit: contain`
- Clear space ≥ **ความสูงโลโก้ ÷ 10** (CI: กล่องสูง 10x, D กว้าง x, ระยะขอบ 1D)
- สูงขั้นต่ำ 32px (CI ไม่กำหนด — ค่าที่ตัวอักษร KASETPHAND ยังอ่านออก)
- ห้าม shadow, border, opacity < 1, filter, rotate, animation, hover effect, วางบนพื้นแดงหรือพื้นลาย, วางทับข้อความ
- Dark mode ใช้โลโก้เดิม

### 5.3 ตำแหน่ง

- Sidebar มุมซ้ายบน: `[โลโก้] | Water Control` + บรรทัดรอง "SafeEnergy" สี `text-secondary` (pattern เดียวกับหน้า "KASETPHAND GROUP" ใน CI)
- `/login`: มุมซ้ายบนฝั่งภาพ
- Mobile top bar: ซ้ายบน
- **ห้ามวางด้านล่างของหน้า** (CI ข้อ 1) — footer ของ sidebar แสดงแค่ข้อความเวอร์ชัน
- Favicon: ใช้โลโก้เต็มย่อขนาด (CI ไม่มีเวอร์ชันสัญลักษณ์และห้ามตัดส่วนใด) — บันทึกเป็น open question

## 6. Layout

### 6.1 Shell (desktop)

Header ต้องมีครบตาม `CLAUDE.md`: เวลาปัจจุบัน, สถานะการเชื่อมต่อ, badge "Local Mode", จำนวน alert ที่ยังไม่อ่าน

```
┌───────────────┬──────────────────────────────────────────────────────────────┐
│ [LOGO] Water  │ ☰   14:32:05 ศ. 11 ก.ย.   ● เชื่อมต่อแล้ว  [Local Mode]  TH|EN ☀ 🔔3 │
│       Control │──────────────────────────────────────────────────────────────│
│    SafeEnergy │ ชื่อหน้า (700)                                  [action หลัก]  │
│               │ คำอธิบาย 1 บรรทัด                                             │
│ ▣ ภาพรวม      │                                                              │
│ ◇ ผังการไหล    │  content grid                                ┌───────────┐  │
│ ◈ ควบคุม      │                                              │ drawer    │  │
│ ◉ อุปกรณ์      │                                              │ รายละเอียด │  │
│ ⚠ การแจ้งเตือน │                                              └───────────┘  │
│ ▤ รายงาน      │                                                              │
│ ✦ AI Insights │                                                              │
│ ⚙ ตั้งค่า      │                                                              │
│ ┌ สรุประบบ ──┐│                                                              │
│ │ ● 46/48    ││                                                              │
│ └───────────┘│                                                              │
│ v1.0.0        │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- ชื่อเมนูใช้คีย์ i18n ที่มีอยู่ ถ้าข้อความใน wireframe ต่างจากของเดิม **ใช้ของเดิม**
- Sidebar และ header พื้น `bg-card` (ไม่ใช่แดง), nav active = pill `brand` ตัวอักษรขาว
- กล่องสรุประบบในจุดล่าง sidebar ดึงจาก service ที่มีอยู่ (`SystemSummary`) ห้ามสร้าง service ใหม่
- Mobile (375px): sidebar เป็น drawer, header ย่อเหลือ โลโก้ + สถานะเชื่อมต่อ + กระดิ่ง

### 6.2 ลำดับชั้นของผิว

| ชั้น | พื้น | radius | ขอบ/เงา |
|---|---|---|---|
| Page | `bg-page` | — | — |
| Section container | `bg-card` | 24px | `border` |
| Card ข้อมูล | `bg-card` | 16px | `border`, ไม่มีเงา |
| Drawer / dialog / popover | `bg-card` | 20px | เงาเดียวของระบบ |
| Input / button | — | 12px | — |
| Status pill | ตามข้อ 3.4 | full | — |

### 6.3 จุดเด่นเดียวของทั้งแอป

**Tank gauge SVG 3 ถังในหน้าภาพรวม** (มีอยู่แล้ว — ปรับหน้าตา ไม่เขียนใหม่): น้ำใช้บันได Royal Navy Blue (ขั้น 500 ตัวน้ำ, ขั้น 100 ผิวน้ำ/คลื่น), เส้น threshold ใช้สีสถานะ, ตัวเลข L และ % ขนาด KPI ตามข้อ 4 — animation ระดับน้ำคงเดิมและเคารพ `prefers-reduced-motion`
ส่วนอื่นทั้งแอปเงียบ ไม่เพิ่ม fade-in ราย section ไม่เพิ่ม hover effect บนการ์ดทุกใบ

## 7. แนวทางรายหน้า (restyle เท่านั้น เนื้อหาคงเดิม)

| Route | แนวทาง | อ้างอิง |
|---|---|---|
| `/` ภาพรวม | tank gauge เป็นจุดเด่น, แถว KPI แบบภาพ 02, แถบ alert ล่าสุดแบบกล่อง "สิ่งที่ต้องติดตาม", กราฟพยากรณ์ใช้ `data-water` + ช่วงความเชื่อมั่น `data-water-soft` | 02 |
| `/overview` ผังการไหล | SVG: ท่อ Blue ladder, node ใช้สีสถานะ, จุด AI ตรวจพบใช้ Cinnabar-500 (glow บนผังได้ — กฎห้าม effect ใช้กับโลโก้เท่านั้น) | — |
| `/control` | การ์ดปั๊ม/วาล์ว, ปุ่ม emergency ใช้ Cinnabar-700 พื้นเต็ม, ปุ่มที่ถูก interlock ใช้ Argent + เหตุผลอ่านออก | water.jpg |
| `/devices` | stat card + progress แบบภาพ 03, tabs/filter, side panel แบบภาพ 04 | 03, 04 |
| `/alerts` | filter bar แบบภาพ 03, severity ใช้ pill ข้อ 3.4, preview LINE คงเดิม | 03, 04 |
| `/reports` | stat card เปรียบเทียบช่วงก่อนหน้า, กราฟหลายชุดใช้ `data-series-*` | 03 |
| `/ai` | ค่าจริงเส้นทึบ / ค่าคาดการณ์เส้นประ, scenario switcher คงไว้ (จะถูกลบตอนต่อ backend) | a8d56b58 |
| `/settings` | tab + ฟอร์ม, error ภาษาไทยใช้ Cinnabar-800 | — |
| `/login` | split layout, ฝั่งซ้ายพื้นบันได Blue หรือ Argent ไม่ใช้ภาพจาก template, การ์ดบัญชีทดลองคงไว้ | 01 |

## 8. Acceptance checklist (ใช้ร่วมกับเช็คลิสต์ใน RUNBOOK ขั้น 3)

**โลโก้**
- [ ] มาจากไฟล์ต้นฉบับหรือภาพจาก PDF ไม่ได้วาดใหม่, สัดส่วน 14:10, clear space ≥ h/10, สูง ≥ 32px
- [ ] ไม่มี shadow / border / opacity / filter / rotate, ไม่อยู่บนพื้นแดง, ไม่อยู่ด้านล่างของหน้า, render ผ่าน `brand-logo.tsx` จุดเดียว

**สี**
- [ ] `grep -rnE "#[0-9a-fA-F]{3,8}\b" app/ components/ lib/ --include=*.tsx --include=*.ts` เจอเฉพาะ `lib/config/theme.ts`
- [ ] `grep -rnE "\b(bg|text|border|fill|stroke|ring|from|to|via)-(red|green|yellow|amber|blue|sky|slate|gray|zinc|neutral|stone|emerald|orange|rose)-[0-9]{2,3}" app/ components/` ว่าง
- [ ] test whitelist: ทุกค่าสีใน `globals.css`, `tailwind.config.*`, `lib/config/theme.ts` อยู่ในตาราง 3.1
- [ ] ไม่มีสีอ่อนจาก opacity (`/10`, `rgba(`) ในส่วนที่เป็นสี
- [ ] คู่ข้อความ/พื้นทุกคู่ตรงตาราง 3.2–3.5, status ทุกจุดใช้ pill ข้อ 3.4 (ไอคอน + ข้อความ)
- [ ] แดงในพื้นที่ข้อมูลหมายถึงวิกฤตเท่านั้น

**อื่น ๆ**
- [ ] Montserrat + IBM Plex Sans Thai โหลดจาก `app/fonts/`, เปิด devtools ตัด network แล้วฟอนต์ยังขึ้น
- [ ] ตัวเลข realtime ใช้ tabular-nums
- [ ] ข้อความใหม่มีคีย์ th + en
- [ ] light และ dark อ่านออกทุกจุด ที่ 375px และ 1920px
- [ ] `git diff --stat` ไม่มีไฟล์ใน `lib/services/`, `lib/mock/`, `lib/types.ts`, `lib/hooks/`
