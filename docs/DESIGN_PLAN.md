# DESIGN_PLAN.md — ผลสำรวจและค่าที่เสนอสำหรับ Phase 7

> ผลของ **Phase 7.0** ตาม `PROMPTS.md` — เอกสารอย่างเดียว ยังไม่แก้ UI
> สเปกอยู่ที่ `docs/BRANDING_SPEC.md` ไฟล์นี้อ้างอิงด้วยเลขข้อ ไม่คัดลอกเนื้อหา
> จัดทำ 2026-09-11 · แก้รอบสอง–สาม 2026-09-11 หลังได้คำตอบ open question ข้อ 1, 2, 3, 4, 8
> **เหลือ open question ที่ยังค้าง 3 ข้อ (5, 6, 7) ซึ่งเป็นเรื่องที่ต้องถามองค์กร ไม่บล็อก Phase 7.1**

---

## 1. ยืนยันบันไดสีเทียบ PDF (§3.1)

แหล่ง: `docs/design-refs/Corporate Identity_compressed.pdf`
หน้าที่ใช้จริง — **PDF p.13** = "Color / CMYK System / Primary Color" (Cinnabar, Argent)
และ **PDF p.17** = "Color / CMYK System / Secondary Color" (Royal Navy Blue, Marigold, Green Revolution)
(เลขหน้าบนสไลด์ไม่ตรงกับเลขหน้า PDF — p.13 พิมพ์ว่า 60, p.17 พิมพ์ว่า 61)

วิธีวัด: `pdftoppm -r 100` แล้วหาค่ามัธยฐานของพิกเซลในแต่ละแถบสี (เลี่ยงบริเวณตัวหนังสือ)

| ผลลัพธ์ | จำนวน |
|---|---|
| ขั้นที่ sample จากพิกเซล ตรงกับตาราง §3.1 แบบ **Δ = 0 ทุก channel** | **30 / 30** |
| ขั้น "500 (ทางการ)" ที่เทียบกับ**ข้อความ**ในสไลด์แทน | 5 / 5 ตรงทั้งหมด |

ค่าทางการที่อ่านจากข้อความในสไลด์ (ไม่ใช่จากพิกเซล):
`E9242B` Cinnabar · `888888` Argent · `026BB5` Royal Navy Blue · `F2A81E` Marigold · `009148` Green Revolution
— ตรงกับ §3.1 ทุกค่า และ PDF p.12 ยืนยัน Lynx White = `F7F7F7`

**พิกเซลของขั้น 500 ต่างจากค่าทางการ** เพราะสไลด์ถูกบีบอัดแบบ JPEG (chroma subsampling กินสีอิ่มสูงที่สุด)

| สี | ค่าทางการ | วัดจากพิกเซล | Δ สูงสุด |
|---|---|---|---|
| Royal Navy Blue-500 | `#026BB5` | `#106CB7` | 14 |
| Green-500 | `#009148` | `#05934B` | 5 |
| Cinnabar-500 | `#E9242B` | `#EC232B` | 3 |
| Argent-500 | `#888888` | `#8A8A8A` | 2 |
| Marigold-500 | `#F2A81E` | `#F4A81E` | 2 |

**สรุป: ตาราง §3.1 ใช้ได้ตามที่เขียนไว้ ไม่ต้องแก้** คอมเมนต์ `sampled from CI p.13/p.17 — confirm with brand owner`
ยังควรใส่ไว้ตาม §3.1 แต่ระดับความเชื่อมั่นสูงกว่าที่สเปกคาด (30 ขั้นตรงเป๊ะ)
CMYK ในสไลด์ไม่ตรงกันระหว่างหน้าจริง (Cinnabar: p.12 = C1/M98/Y94/K0, p.15 = C0/M85/Y82/K9) — ยืนยันว่าต้องใช้ Hex

---

## 2. ค่าที่เสนอ: Argent-950 / Argent-1000 (§3.6 ทางเลือก ข)

บันได Argent เดิมไม่ได้คุม hue ให้คงที่ (วัดได้ 205.7° → 252° → 252° → 0° → 0° → 345° → 345°)
จึงยึด **hue ของขั้นที่เข้มที่สุด** คือ Argent-900 แล้วไล่ L ลงต่อโดยคง H และ S เดิม

| ขั้น | H | S | L | hex ที่เสนอ |
|---|---|---|---|---|
| Argent-900 (เดิม) | 205.7° | 4.1% | 33.1% | `#515558` |
| **Argent-950** | 205.7° | 4.1% | **22.0%** | **`#36383A`** |
| **Argent-1000** | 205.7° | 4.1% | **13.0%** | **`#202123`** |

ระยะ L ของบันไดเดิมอยู่ที่ 3.3–10.2 จุด ค่าที่เสนอเว้น 11.1 และ 9.0 จุด — อยู่ในช่วงเดียวกัน
หลังปัดเป็น 8-bit ค่า H/S เพี้ยนไปเล็กน้อย (950 → H 210° S 3.6%, 1000 → H 220° S 4.5%) เพราะ chroma ต่ำมาก เลี่ยงไม่ได้

**การใช้งาน:** `bg-page` ของ dark mode = Argent-1000 · `bg-card` ของ dark mode = Argent-950
ห้ามใช้กับข้อความ ไอคอน เส้นขอบ หรือสีชุดข้อมูล (§3.6)

Contrast ที่คำนวณแล้ว:

| ข้อความ/มาร์ก | บน Argent-950 | บน Argent-1000 |
|---|---|---|
| Lynx White `#F7F7F7` | 10.99 : 1 | 15.04 : 1 |
| Argent-100 `#CBC7C8` | 7.03 : 1 | 9.62 : 1 |
| Argent-200 `#B4B0B1` | 5.49 : 1 | 7.51 : 1 |
| Blue-100 `#A5AECF` | 5.36 : 1 | 7.33 : 1 |
| Marigold-300 `#F7B94C` | 6.73 : 1 | 9.21 : 1 |
| Green-300 `#4CA062` | 3.65 : 1 | 5.00 : 1 |
| Cinnabar-300 `#F05D49` | 3.57 : 1 | 4.89 : 1 |

→ ข้อความหลักใน dark mode ใช้ Lynx White, ข้อความรองใช้ Argent-100 หรือ Argent-200 ผ่านเกณฑ์ AA ทั้งคู่

---

## 3. ตาราง mapping สีเดิม → token ใหม่

`app/globals.css` ปัจจุบัน: **216 บรรทัด**, ตัวแปรสี **24 ค่าเป็น hex** (เฉพาะกราฟ) ที่เหลือเป็น HSL รูปแบบ `H S% L%`
`tailwind.config.ts` ไม่มี hex เลย อ้าง `hsl(var(--x))` ทั้งหมด → **ไม่ต้องแตะรูปแบบ แค่เปลี่ยนค่า**

### 3.1 Light (`:root`)

| ตัวแปร | ค่าเดิม | → token ใหม่ (§3.3) | hex ใหม่ |
|---|---|---|---|
| `--background` | `0 0% 100%` | `bg-page` | `#F7F7F7` Lynx White |
| `--foreground` | `222 47% 11%` | `text-primary` | `#515558` Argent-900 |
| `--card` / `--popover` | `0 0% 100%` | `bg-card` | `#FFFFFF` |
| `--card-foreground` / `--popover-foreground` | `222 47% 11%` | `text-primary` | `#515558` |
| `--primary` | `201 96% 32%` | `brand` | `#E9242B` Cinnabar-500 — **ความหมายเปลี่ยน ดูข้อ 11** |
| `--primary-foreground` | `0 0% 100%` | — | `#FFFFFF` |
| `--secondary` / `--muted` / `--accent` | `210 40% 96%` / `94%` | ผิวรอง | `#CBC7C8` Argent-100 (หรือ `#F7F7F7`) |
| `--secondary-foreground` / `--accent-foreground` | `222 47% 11%` | `text-primary` | `#515558` |
| `--muted-foreground` | `215 16% 42%` | `text-secondary` | `#6D6C71` Argent-800 |
| `--destructive` | `0 72% 45%` | สถานะวิกฤต | `#BC5242` Cinnabar-700 |
| `--border` / `--input` | `214 32% 88%` | `border` | `#CBC7C8` Argent-100 |
| `--ring` | `201 96% 32%` | `focus-ring` | `#026BB5` Blue-500 (แยกออกจาก `--primary` แล้ว) |
| `--status-ok` | `142 71% 33%` | §3.4 ปกติ | `#526E57` Green-800 (จุด `#009148`) |
| `--status-warning` | `38 92% 42%` | §3.4 เตือน | `#625B4B` Marigold-900 (พื้น `#FDD8A3`) |
| `--status-critical` | `0 72% 45%` | §3.4 วิกฤต | `#BC5242` Cinnabar-700 |
| `--status-offline` | `215 14% 46%` | §3.4 offline | `#6D6C71` Argent-800 (จุด `#888888`) |
| `--chart-1..8` (8 ค่า hex) | `#2a78d6 …` | `--data-water`, `--chart-series-2`, `--chart-reference` | เหลือ **3 ค่า** (`--chart-series-1` เป็น alias ของ `--data-water`) ดูข้อ 9 |
| `--chart-seq-100/250/400/550` | `#cde2fb …` | `--data-water`, `--data-water-soft` | เหลือ 2 ค่า — โค้ดจริงเรียกใช้แค่ `seq-400` กับ `seq-250` บันไดไล่เฉด 4 ขั้นไม่มีใครใช้ |
| *(ใหม่)* | — | `--control-checked` | `#515558` Argent-900 (dark: `#F7F7F7`) ดูข้อ 11 |
| *(ใหม่)* | — | `--info`, `--info-strong` | `#026BB5` Blue-500 (dark: `#A5AECF`) / `#536281` Blue-800 ดูข้อ 11 |
| *(ใหม่)* | — | `--brand-text` | `#BC5242` Cinnabar-700 (dark: `#F5856D` Cinnabar-200) — แบรนด์ตอนเป็น **ข้อความ** |
| *(ใหม่)* | — | `--brand-strong` | `#BC5242` Cinnabar-700 ทั้งสองโหมด — พื้นแบรนด์สำหรับตัวอักษร < 16px (ข้อ 3.5) |
| `--chart-seq-100/250/400/550` | `#cde2fb …` | `data-water*` | บันได Blue: `#A5AECF` `#4E80BF` `#026BB5` `#44699D` |

**หมายเหตุ `--primary` เปลี่ยนความหมาย:** เดิมเป็นสีน้ำเงินและถูกใช้ปนกัน 5 ความหมาย ใหม่เป็นสีแบรนด์แดงอย่างเดียว
ทุกจุดที่ไม่ใช่ "แบรนด์" ต้องย้ายออกไปยัง token ที่ถูกต้อง ไม่งั้นจะกลายเป็นแดงในพื้นที่ข้อมูลซึ่งผิดกฎ §3.3
**ผลการไล่ทุกจุดพร้อมจำนวนอยู่ในข้อ 11** — เป็นงานหลักของ 7.1 และต้องไล่ตรวจซ้ำใน 7.4–7.8a

### 3.2 Dark (`.dark`)

| ตัวแปร | ค่าเดิม | hex ใหม่ |
|---|---|---|
| `--background` | `222 47% 7%` | `#202123` Argent-1000 (ข้อ 2) |
| `--card` / `--popover` | `222 44% 10%` | `#36383A` Argent-950 |
| `--foreground` / `*-foreground` | `210 40% 96%` | `#F7F7F7` Lynx White |
| `--muted-foreground` | `215 20% 68%` | `#CBC7C8` Argent-100 |
| `--border` / `--input` | `217 33% 20%` / `22%` | `#515558` Argent-900 |
| `--primary` | `199 89% 55%` | `#E9242B` Cinnabar-500 (แบรนด์คงเดิมทั้งสองโหมด) |
| `--ring` | `199 89% 55%` | `#4E80BF` Blue-300 |
| *(ใหม่)* `--control-checked` | — | `#F7F7F7` Lynx White |
| `--status-*` | — | ใช้ขั้นที่สว่างกว่าในบันไดเดียวกัน เลือกตอน 7.1 แล้วตรวจ contrast กับ Argent-950 |

---

## 4. ไฟล์โลโก้ (§5.1)

**แหล่งเดียวคือหน้า PDF ที่ 11** ("Logo Primary / Primary Color Usage")

```
pdfimages -png -f 11 -l 11 "docs/design-refs/Corporate Identity_compressed.pdf" <out>
```

ได้ภาพสไลด์ **2433 × 1369** แล้ว crop เฉพาะกล่องแดง

| ขั้นตอน | ค่าที่วัดได้ |
|---|---|
| กรอบกล่องแดงในสไลด์ | x 1140–2130, y 363–1069 → **991 × 707** |
| สัดส่วน | **1.4017** (เกณฑ์ 1.40 ± 0.01 ✓ ตรงกับ 14 : 10 ในหน้า PDF p.12) |
| รัศมีมุม (fit จากเส้นโค้งจริง 38 จุดตัวอย่าง) | **38.7 px** = 5.47% ของความสูงกล่อง |
| ขอบกล่อง | พิกเซล −1 เป็นรอยเบลนด์กับพื้นขาว → mask ถูก inset 1.5 px เพื่อตัดทิ้ง |
| mask | rounded rect r = 37.2 px สร้างที่ 4× แล้วย่อด้วย LANCZOS (ขอบ anti-alias) |

ไฟล์ที่วางแล้ว (เขียนทับเวอร์ชัน 1.5056 เดิมจนหมด — ในโฟลเดอร์เหลือแค่ 2 ไฟล์นี้)

| ไฟล์ | ขนาด | สัดส่วน |
|---|---|---|
| `public/brand/kasetphand-logo@2x.png` | **991 × 707** RGBA | 1.4017 |
| `public/brand/kasetphand-logo.png` | **496 × 354** RGBA | 1.4011 |

### ผลตรวจ

| เกณฑ์ | ผล |
|---|---|
| สัดส่วน 1.40 ± 0.01 | **ผ่าน** 1.4017 |
| กว้าง ≥ 2 เท่าของขนาดแสดงใหญ่สุด | **ผ่าน** — 991 px ต่อขนาดแสดงสูงสุดที่คาดราว 200–220 px |
| ขอบตัว K ไม่มี JPEG artifact ที่ซูม 400% | **ผ่าน** — เส้นโค้งเรียบ ไม่มี blocking/ringing |
| มุมโค้งโปร่งใส | **ผ่าน** — alpha ทั้ง 4 มุม = 0, กลางภาพ = 255 |
| ไม่มีขอบขาวบนพื้นเข้ม | **ผ่าน** — ประกอบบนพื้น `#202123` แล้วสแกนขอบ 4 px รอบด้าน พบพิกเซลสว่าง (>120 ทุก channel) **0 จุด** |

**`brand-logo.tsx` ใช้สัดส่วนจริงของไฟล์ ไม่ใช้กล่อง 14:10 + `object-fit: contain`** (แก้ §5.2 แล้ว)

### ค้างอยู่

สีพื้นกล่องในไฟล์ = `#EB1C24` ต่างจาก Cinnabar-500 `#E9242B` (Δ = 2/8/7) เพราะต้นฉบับในสไลด์เป็น JPEG
ทั้งหน้า 1 และหน้า 11 ให้ค่าเดียวกัน → เป็นคุณสมบัติของไฟล์ ไม่ใช่ของการ crop
ไม่กระทบ test whitelist (ตรวจเฉพาะไฟล์ CSS/token) และ §5 ห้ามแก้ไขโลโก้ — ยังควรขอไฟล์ต้นฉบับจากองค์กร

---

## 5. ข้อยกเว้น contrast ของปุ่ม primary (§3.5)

- คู่ที่เลือก: พื้น Cinnabar-500 `#E9242B` + ตัวอักษร `#FFFFFF` = **4.42 : 1**
- เกณฑ์ AA ข้อความปกติคือ 4.5 : 1 → **ต่ำกว่า 0.08**
- เกณฑ์ AA ข้อความใหญ่ (18.66px bold ขึ้นไป) คือ 3.0 : 1 → ผ่านสบาย แต่กติกาที่เลือกคือ **16px / weight 600**
  ซึ่ง **ยังไม่นับเป็นข้อความใหญ่ตาม WCAG** จึงถือเป็น "ยอมรับความเสี่ยงเชิงแบรนด์" ไม่ใช่ "ผ่านเกณฑ์"
- ขอบเขตที่อนุญาต: ปุ่ม primary, nav active pill — เฉพาะตัวอักษร ≥ 16px weight 600
- ขอบเขตที่ห้ามเด็ดขาด: ตัวอักษร < 16px บนพื้น Cinnabar-500 ทุกกรณี → ใช้ Cinnabar-700 `#BC5242` (4.8 : 1) แทน
- ผู้ที่ได้รับผลกระทบคือผู้ใช้สายตาเลือนราง ไม่ใช่ตาบอดสี — secondary encoding ช่วยไม่ได้ ต้องพึ่งขนาดตัวอักษรอย่างเดียว

---

## 6. จัดหมวด opacity (§3 กฎ opacity ใหม่)

นับด้วย `grep -rnoE "\b(bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow)-[a-z][a-z0-9-]*/[0-9]{1,3}\b" app components --include='*.tsx'`
→ **89 จุด** (ตัวเลข 76 ที่รายงานไว้ตอนวางแผนใช้ regex แคบกว่า ตัวเลขที่ถูกต้องคือ 89)

### ห้าม — ต้องแก้ (พื้น/ขอบ/fill ของสถานะ) : **37 จุด ใน 16 ไฟล์**

| รูปแบบ | จำนวน |
|---|---|
| `bg-status-*/5,10,15` | 16 |
| `border-status-*/30,40,50` | 17 |
| `fill-status-*/10,15` | 4 |

| ไฟล์ | จุด | ไปแก้ที่เฟส |
|---|---|---|
| `components/control/command-status.tsx` | 6 | 7.5 |
| `components/ai/anomaly-type-badge.tsx` | 4 | 7.2 |
| `components/control/emergency-panel.tsx` | 4 | 7.5 |
| `components/diagram/diagram-primitives.tsx` | 4 | 7.2 (สีสถานะ) / 7.7b (ผัง) |
| `components/ai/ai-overview-widget.tsx` | 3 | 7.7a |
| `components/devices/device-detail-panel.tsx` | 3 | 7.5 |
| `app/login/page.tsx` | 2 | 7.3 |
| `components/layout/header.tsx` | 2 | 7.3 |
| `components/ai/maintenance-section.tsx` | 2 | 7.7a |
| `app/settings/page.tsx` | 1 | 7.8a |
| `components/zones/main-meter-section.tsx` | 1 | 7.4 |
| `components/pumps/pump-card.tsx` | 1 | 7.2 (สีสถานะ) / 7.4 |
| `components/ai/ai-summary-card.tsx` | 1 | 7.7a |
| `components/ai/ai-metric-card.tsx` | 1 | 7.7a |
| `components/control/confirm-dialog.tsx` | 1 | 7.5 |
| `components/devices/service-health-bar.tsx` | 1 | 7.5 |

วิธีแก้: แทนด้วยขั้นจริงจากบันไดสี — พื้น pill เตือน `#FDD8A3` Marigold-100, พื้น pill วิกฤต `#BC5242` Cinnabar-700,
ขอบใช้ `border` (Argent-100) หรือขั้น 100/200 ของสีนั้น ตามตาราง §3.4

### ควรแก้ — ไม่ใช่หมวดห้าม แต่เป็น "สีอ่อนที่ทำจาก opacity" ซึ่ง §3 ให้ใช้ขั้นจากบันไดแทน : **44 จุด**

| รูปแบบ | จำนวน | ใช้ทำอะไร | ขั้นที่ควรใช้แทน |
|---|---|---|---|
| `bg-muted/30,40,60` | 18 | พื้นรองของแถว/กล่อง | Argent-100 |
| `bg-info/10` *(เดิม `bg-primary/10` — เปลี่ยนชื่อตอน 7.1)* | 8 | ชิปข้อความเชิงแจ้งให้ทราบ | ไม่มีพื้น + ขอบ ตามข้อ 3.3 |
| `bg-accent/40,60` | 8 | พื้น hover ของแถว | Argent-100 |
| `fill-muted/40` | 3 | พื้นถังเปล่าใน tank gauge, กล่อง node ในผัง | Argent-100 |
| `bg-muted-foreground/40` | 2 | รางสวิตช์สถานะ "ปิด" | Argent-200 |
| `border-info/30` *(เดิม `border-primary/30`)*, `border-primary/40` | 2 | ขอบไฮไลต์ / ขอบการ์ด VIP | ขั้นจากบันไดสี |
| `bg-secondary/80` | 1 | พื้นรอง | Argent-100 |

### อนุญาต — ไม่ต้องแตะ : **8 จุด**

| รูปแบบ | จำนวน | เหตุผล |
|---|---|---|
| `bg-black/50` | 4 | backdrop ของ dialog / drawer |
| `hover:bg-primary/90` | 1 | สถานะ hover ของปุ่ม |
| `hover:bg-destructive/90` | 1 | สถานะ hover ของปุ่ม |
| `bg-background/95`, `bg-background/80` | 2 | header ที่ sticky + `backdrop-blur` |

**สรุป: ต้องแก้ 37 (บังคับ) + 44 (ควรแก้) = 81 จุด · ปล่อยไว้ได้ 8 จุด**

---

## 7. กราฟที่มีชุดข้อมูลเกิน 4 ชุด

**ไม่มีเลย** — กราฟทั้ง 9 ไฟล์มีชุดข้อมูลสูงสุด 3 ชุด

| ไฟล์ | ชุดข้อมูล | หมายเหตุ |
|---|---|---|
| `components/ai/forecast-section.tsx` | 3 (Area + Line×2) | ค่าจริง / คาดการณ์ / ช่วงความเชื่อมั่น |
| `components/billing/daily-usage-chart.tsx` | 3 (Area + Line×2) | |
| `components/environment/temp-vs-usage-chart.tsx` | 2 (Bar + Line) | เป็น small multiples 2 กราฟ ไม่ใช่แกนคู่ — ดูข้อ 10 |
| `components/ai/anomaly-timeline.tsx` | 2 (Bar + Scatter) | `<Cell>` 1 จุด ใช้สีสถานะ |
| `components/ai/anomaly-evidence-chart.tsx` | 2 (Area + Line) | |
| `components/reports/zone-usage-chart.tsx` | 2 (Bar×2) | ช่วงก่อนหน้าใช้ `CHART.offline` = เทา |
| `components/billing/zone-cost-chart.tsx` | 1 (Bar + Cell) | สีเดียวเชิงปริมาณ ไม่ใช่ categorical |
| `components/reports/monthly-chart.tsx` | 1 (Bar + Cell) | เหมือนกัน |
| `components/charts/sparkline.tsx` | 1 (Area) | |

→ **ไม่ต้องใช้ทางออก ">4 ชุด" ใน §3.3 เลย** และต้องการสีชุดข้อมูลจริงแค่ 2–3 สี ไม่ใช่ 4

**ข้อตีความที่ขอยืนยัน:** `zone-usage-chart.tsx` ใช้สีเทากับแท่ง "ช่วงก่อนหน้า" โดยเจตนาให้ถอยหลังฉาก
กฎใหม่ห้ามเทาเป็น "สีชุดข้อมูล" แต่ §3.3 เองอนุญาต Argent-100 สำหรับชุดที่ถูกลดความสำคัญ
→ ตีความว่าแท่งอ้างอิงแบบนี้ใช้ Argent-100/200 ได้ เพราะไม่ได้ทำหน้าที่แยก identity

---

## 8. คลาสสถานะ 144 จุด — อ้างตัวแปร CSS หรือไม่

**อ้างตัวแปร CSS ทั้งหมด 144/144 จุด ไม่มีจุดไหนฝังสีเอง**

- ทุกจุดเป็นคลาส Tailwind ตระกูล `*-status-{ok|warning|critical|offline}` ซึ่ง `tailwind.config.ts`
  ผูกไว้กับ `hsl(var(--status-*))` อยู่แล้ว
- อีก 4 จุดใน `components/charts/chart-tokens.ts` อ้าง `hsl(var(--status-*))` ตรง ๆ สำหรับ SVG/Recharts
- ค้นหา hex ใน 47 ไฟล์นั้น: **0 จุด**

**ผลที่ตามมา: แก้ค่าตัวแปร 8 ตัว (`--status-*` และ `-foreground` ทั้ง light/dark) ใน `app/globals.css` จุดเดียว
แล้วทั้ง 144 จุดเปลี่ยนสีตามทันที** — งานที่เหลือใน 7.2 คือรูปทรงของ pill (ไอคอน + ข้อความ + พื้น)
และ 37 จุดที่ใช้ opacity ตามข้อ 6 ไม่ใช่การไล่แก้สีทีละไฟล์

---

## 9. สีชุดข้อมูลของกราฟ + ผล validator — ★ ตัดสินแล้ว

รัน `scripts/validate_palette.js` ของ skill `dataviz` กับพื้น `#FFFFFF` (light) และ `#202123` (dark)

### ทำไมชุด 4 สีตามที่ตัดสินไว้ใช้ไม่ได้

ชุดที่สั่งไว้คือ Blue-500 / Marigold-500 / Green-500 / Blue-900 — ผล light:

```
[FAIL] Lightness band   นอกช่วง: Marigold-500 L 0.784 (เพดาน 0.77), Blue-900 L 0.428 (พื้น 0.43)
[FAIL] Chroma floor     ต่ำกว่าเกณฑ์ อ่านเป็นสีเทา: Blue-900 C 0.028 (เกณฑ์ 0.10)
[WARN] Contrast         Marigold-500 = 1.97 : 1 กับพื้นขาว
```

Blue-900 `#4B4E5F` มี chroma 0.028 = **อ่านเป็นเทา** ซึ่งขัดกับกฎ "ห้ามใช้เทาเป็นสีชุดข้อมูล" ในตัวมันเอง
Marigold-500 สว่างเกินไปสำหรับพื้นขาว — ตรงกับ §3.2 ที่ระบุไว้แล้วว่า "ใช้เป็นพื้น/แถบเท่านั้น"

### ขั้นใน CI ที่ผ่านเกณฑ์พื้นฐาน (lightness band + chroma floor)

| | ผ่าน light | ผ่าน dark |
|---|---|---|
| Royal Navy Blue | 500 `#026BB5`, 300 `#4E80BF` | 500, 300 |
| Green Revolution | 500 `#009148`, 300 `#4CA062` | 500, 300 |
| Marigold | **700 `#C29345` ขั้นเดียว** | **ไม่มีขั้นใดผ่าน** |

Marigold ขั้น 500/300/200/100 สว่างเกินช่วง, ขั้น 800/900 chroma ต่ำกว่าเกณฑ์ (อ่านเป็นน้ำตาลเทา)
ขั้น 700 อยู่ในช่วง light แต่ L 0.693 เกินเพดาน dark (0.67) ไป 0.023

### ผลการทดสอบทุกชุดที่เป็นไปได้

| ชุด | โหมด | ผล |
|---|---|---|
| Blue-500 + Green-500 | light | **ผ่านทุกข้อ** (CVD ΔE 21.7) |
| Blue-300 + Green-300 | dark | **ผ่านทุกข้อ** (CVD ΔE 17.6) |
| Blue-500 + Marigold-700 | light | ผ่าน CVD 25.7 · WARN contrast 2.78 |
| Blue-300 + Marigold-300 | dark | FAIL lightness (0.824) · CVD ผ่าน 29.5 |
| Blue-500 + Marigold-500 + Green-500 | light | FAIL lightness (Marigold 0.784 เกิน 0.014) · **CVD ผ่าน 14.7** · WARN contrast 2.02 |
| Blue-500 + Marigold-700 + Green-500 | light | **FAIL CVD 5.9 (protan)** — Marigold-700 ↔ Green-500 แยกไม่ออก |
| Blue-300 + Marigold-700 + Green-300 | dark | FAIL lightness · **FAIL CVD 3.4** · FAIL normal-vision 15.0 |
| ชุด 4 สีทุกแบบที่ประกอบจาก CI | ทั้งสอง | **FAIL ทุกชุด** |

### สาเหตุราก

CI เหลือเพียง 3 hue ที่ไม่ใช่แดงและไม่ใช่เทา — Blue ~250°, Green ~151°, Marigold ~77° (OKLCH)
Green กับ Marigold ห่างกันแค่ ~74° ซึ่ง**ยุบรวมกันภายใต้ protanopia** ชุดสีเดิมของแอปที่ผ่าน validator
ใช้ 8 hue กระจายรอบวงล้อ จึงไม่เจอปัญหานี้ นี่เป็นข้อจำกัดของ palette ไม่ใช่ของการเลือกขั้น

### ★ ข้อสรุป — เลือก (ก) ใช้ 2 สีหลัก + 1 สีอ้างอิง

| | light (พื้น `#FFFFFF`) | dark (พื้น Argent-1000 `#202123`) |
|---|---|---|
| ชุดหลักที่ 1 | Blue-500 `#026BB5` | Blue-300 `#4E80BF` |
| ชุดหลักที่ 2 | Green-500 `#009148` | Green-300 `#4CA062` |
| ชุดอ้างอิง | Argent-100 `#CBC7C8` | **Argent-800 `#6D6C71`** (เสนอใหม่) |

กติกาการเลือกสีตามรูปแบบกราฟ และกฎ "ห้ามเทาเป็นชุดข้อมูลหลัก ใช้ได้เฉพาะชุดอ้างอิง"
ถูกย้ายไปเป็นสเปกถาวรใน §3.3 แล้ว

### ผล validator ของชุดอ้างอิง

ทดสอบขั้นเทาที่เป็นไปได้ทุกขั้นกับพื้นของแต่ละโหมด

| ขั้น | contrast บนพื้นขาว | contrast บนพื้น `#202123` |
|---|---|---|
| Argent-100 `#CBC7C8` | 1.67 : 1 | 9.62 : 1 |
| Argent-200 `#B4B0B1` | 2.15 : 1 | 7.51 : 1 |
| Argent-300 `#9C9C9C` | 2.75 : 1 | 5.87 : 1 |
| Argent-500 `#888888` | 3.54 : 1 | 4.55 : 1 |
| Argent-700 `#7E7D82` | 4.08 : 1 | 3.95 : 1 |
| **Argent-800 `#6D6C71`** | 5.21 : 1 | **3.10 : 1** |

รันชุดเต็ม 3 สีกับพื้นของโหมดตัวเอง:

```
dark  #4E80BF, #4CA062, #6D6C71  (Argent-800)
  [PASS] Lightness band      ครบทั้ง 3 อยู่ใน L 0.48–0.67
  [FAIL] Chroma floor        #6D6C71 C 0.008  ← ตั้งใจ: ชุดอ้างอิงต้องเป็นเทา
  [PASS] CVD separation      คู่แย่สุด #6D6C71↔#4CA062 ΔE 12.2 (deutan)
  [PASS] Normal-vision floor คู่แย่สุด ΔE 16.6
  [PASS] Contrast vs surface ครบทั้ง 3 ≥ 3:1

dark  #4E80BF, #4CA062, #7E7D82  (Argent-700 — ตัวเทียบ ตกรอบ)
  [FAIL] Normal-vision floor #7E7D82↔#4CA062 ΔE 13.8 — ต่ำกว่า 15 แยกยากแม้ตาปกติ

light #026BB5, #009148, #CBC7C8  (Argent-100)
  [FAIL] Lightness band      #CBC7C8 L 0.833  ← ตั้งใจ
  [FAIL] Chroma floor        #CBC7C8 C 0.005  ← ตั้งใจ
  [PASS] CVD separation      #009148↔#026BB5 ΔE 21.7 (protan)
  [PASS] Normal-vision floor ΔE 22.8
  [WARN] Contrast vs surface #CBC7C8 = 1.67 : 1 → ต้องมี legend หรือ direct label
```

**การตีความ:** `Chroma floor` และ `Lightness band` ที่ FAIL เกิดกับ**สีอ้างอิงเท่านั้น** ซึ่ง validator ออกแบบมาตรวจ
จานสี *categorical* ที่ทุกสีต้องแยก identity ได้เท่ากัน — แต่ชุดอ้างอิงตั้งใจให้เป็นเทาและถอยหลังฉาก
**คู่ที่ทำหน้าที่แยก identity จริง (Blue ↔ Green) ผ่านทุกข้อทั้งสองโหมด**

**สิ่งที่ต้องบังคับจากผล WARN:** Argent-100 บนพื้นขาวได้แค่ 1.67 : 1 → ทุกกราฟที่ใช้ชุดอ้างอิงใน light mode
**ต้องมี legend** (ซึ่ง §3.3 บังคับอยู่แล้ว) ถ้าตอน 7.4–7.8 พบว่าแท่งอ้างอิงจางจนอ่านไม่ออกบนจอแขวนผนัง
ให้หยุดรายงานแล้วพิจารณา Argent-200 (2.15 : 1) หรือ Argent-300 (2.75 : 1) แทน

### ผลที่ตามมากับโค้ดที่มีอยู่

- `components/charts/chart-tokens.ts` — `CHART_SERIES` ลดจาก 8 เหลือ 2 และ `seriesColor()` ต้อง throw ที่ 2
- `components/reports/zone-usage-chart.tsx` — แท่ง "ช่วงก่อนหน้า" ใช้ `CHART.offline` อยู่ → เปลี่ยนเป็น `data-reference`
- `components/billing/zone-cost-chart.tsx`, `components/reports/monthly-chart.tsx` — กราฟ 8 โซนชุดเดียว → Blue + ป้ายชื่อ
- `components/ai/forecast-section.tsx`, `components/billing/daily-usage-chart.tsx` — จริง vs พยากรณ์ → สีเดียว เส้นทึบ/ประ + band
- `components/ai/anomaly-evidence-chart.tsx` — มีเส้น threshold สถานะ → Blue ชุดเดียว ห้าม Green

---

## 10. `temp-vs-usage-chart.tsx` — ไม่ใช่กราฟแกนคู่ (แก้ข้อสรุปเดิม)

**ข้อสรุปใน DESIGN_PLAN รอบแรกผิด** — ที่นับได้ว่ามี `<YAxis>` 2 ตัวนั้นไม่ใช่แกนคู่ในกราฟเดียว
แต่เป็น **small multiples 2 กราฟที่แชร์แกนเวลาเดียวกัน** อยู่แล้ว (`<LineChart>` ชั้นบน + `<BarChart>` ชั้นล่าง)
ซึ่งตรงกับข้อเสนอที่เคยบันทึกไว้เป็น "งานนอกขอบเขต" พอดี — คอมเมนต์ในไฟล์อธิบายเหตุผลไว้เองด้วย

**สิ่งที่ทำจริงใน 7.1 (ปรับสีอย่างเดียว ไม่แตะโครง)**

| ชุดข้อมูล | สีเดิม | สีใหม่ |
|---|---|---|
| การใช้น้ำ (ชั้นล่าง) | `CHART.sequential` | `seriesColor(0)` = Blue |
| อุณหภูมิ (ชั้นบน) | `CHART.warning` (สีเตือน) | `seriesColor(1)` = Green |

ป้ายชื่อของทั้งสองชั้นมีหน่วยกำกับอยู่แล้ว (`· °C` และ `· m³`) และเปลี่ยนจาก `text-muted-foreground`
มาใช้สีเดียวกับเส้นของชั้นตัวเอง ตามที่ตัดสินไว้

---

## 11. การแยกความหมายของ `--primary` — ★ ตัดสินแล้วครบ 51 token

นับด้วย `grep -rnE "\b[a-z]+-primary(-foreground)?(/[0-9]{1,3})?\b" app components --include='*.tsx'`
→ **51 token ใน 34 บรรทัด / 23 ไฟล์**

| กลุ่ม | token ใหม่ | จำนวน |
|---|---|---|
| ปุ่ม primary, nav active, tabs, ลิงก์หลัก | `brand` (Cinnabar) | **17** |
| Switch / Checkbox / Radio / Slider ติ๊กแล้ว | `control-checked` | **3** |
| Progress / ตัวเลขที่เป็นปริมาณน้ำ | `data-water` | **7** |
| Progress ของงาน (OTA, export) | Argent-900 | **4** |
| ข้อความ/ไอคอนแจ้งให้ทราบ, สถานะกำลังดำเนินการ | `info` *(token ใหม่)* | **19** |
| แท่งคะแนน anomaly ช่วงต่ำ | `status-ok` | **1** |

### รายละเอียดกลุ่มที่จัดได้

**brand (17)** — `components/ui/button.tsx:11,16` · `components/ui/badge.tsx:10` ·
`components/layout/sidebar.tsx:45,83` · `components/ai/scenario-switcher.tsx:48` · `app/login/page.tsx:68` ·
`components/alerts/recent-alerts.tsx:30` · `components/ai/anomaly-card.tsx:205` · `components/ai/ai-overview-widget.tsx:63`
(สองจุดที่เป็นกล่องโลโก้ชั่วคราว — `sidebar.tsx:45` และ `login/page.tsx:68` — จะถูกแทนด้วย `brand-logo.tsx` ใน 7.3)

**control-checked (3)** — `components/settings/ai-section.tsx:52` · `components/settings/line-section.tsx:174` ·
`components/control/valve-control-card.tsx:154` (ทั้งหมดเป็น `accent-primary` ของ input native)

> **หมายเหตุ:** สวิตช์เปิด/ปิดอีก 2 จุดไม่ได้ใช้ `primary` แต่ใช้ `bg-status-ok` เป็นสถานะ "เปิด"
> (`components/settings/field.tsx:209`, `components/control/schedule-panel.tsx:216`)
> ตามกติกาใหม่ต้องย้ายมาใช้ `control-checked` ด้วย ไม่งั้นสวิตช์จะสื่อความหมายเป็น "สถานะปกติ" แทน "ติ๊กแล้ว"

**data-water (7)** — `components/zones/zone-table.tsx:69` · `components/zones/main-meter-section.tsx:79` ·
`components/billing/billing-section.tsx:74` · `components/control/valve-control-card.tsx:89` ·
`components/diagram/flow-diagram.tsx:280,326` · `components/environment/environment-card.tsx:98`

**Argent-900 progress งาน (4)** — `components/devices/device-detail-panel.tsx:204` (ข้อความ OTA) ·
`app/reports/page.tsx:148` (ข้อความ export)

### ★ 20 token ที่เหลือ — ตัดสิน 2026-09-11 ใช้ทางเลือก (ก)

**เพิ่ม token ใหม่ `info`** แล้วให้กลุ่ม (i) ทั้งหมดไปใช้

| ไฟล์:บรรทัด | token | ใช้ทำอะไร | ปลายทาง |
|---|---|---|---|
| `components/control/command-status.tsx:22` | 3 | สถานะ "กำลังส่ง / รอผลตอบกลับ" | `info` |
| `components/control/audit-log.tsx:14,15` | 2 | `sending` / `awaiting_feedback` ใน audit log | `info` |
| `components/ai/ai-overview-widget.tsx:45` | 2 | ชิปสรุปตอนไม่มีเรื่องวิกฤต | `info` |
| `components/control/confirm-dialog.tsx:86` | 2 | กล่องยืนยันแบบไม่ทำลาย | `info` |
| `components/ai/anomaly-card.tsx:150` | 2 | กล่องคำแนะนำจาก AI | `info` |
| `components/ai/ai-summary-card.tsx:57` | 2 | ไอคอนหัวการ์ดสรุป AI | `info` |
| `components/environment/environment-card.tsx:107` | 2 | ชิป "ฝนตก" | `info` |
| `components/control/pin-gate.tsx:79` | 2 | ไอคอนใน dialog ใส่ PIN | `info` |
| `components/control/valve-control-card.tsx:90` | 1 | ลายทางตอนวาล์วกำลังเคลื่อน | **`data-water`** (แก้จาก `info`) |
| `components/ai/anomaly-card.tsx:118` | 1 | แท่งคะแนน anomaly ช่วง < 50% | `status-ok` |
| `components/control/valve-control-card.tsx:54` | 1 | ขอบการ์ดโซน VIP | `brand` |

→ `info` 18 token · `data-water` 1 · `status-ok` 1 · `brand` 1 (รวมเข้ากลุ่ม brand เดิมเป็น 18)

**แก้จากที่วางแผนไว้ 1 จุด:** ลายทางของวาล์วที่กำลังเคลื่อนใช้ `currentColor` ทับลงบนแท่งเดียวกับ
ตัวบอกตำแหน่งวาล์ว ถ้าให้เป็น `info` ลายจะเป็นคนละสีกับแท่งที่มันวางทับอยู่ จึงใช้ `data-water` ให้ตรงกัน

### ค่าของ `info` และสิ่งที่ต้องแก้จากคำแนะนำเดิม

คำแนะนำเดิมเสนอ dark = Blue-300 **ซึ่งใช้ไม่ได้** เมื่อเอาไปเป็นสีข้อความบนการ์ดของ dark mode

| ขั้น | บนขาว | บน Argent-950 `#36383A` | บน Argent-1000 `#202123` |
|---|---|---|---|
| Blue-500 `#026BB5` | **5.57** ✓ | 2.12 ✗ | 2.90 ✗ |
| Blue-300 `#4E80BF` | 4.07 ✗ | 2.90 ✗ | 3.96 ✗ |
| Blue-200 `#8290B5` | 3.18 ✗ | 3.70 ✗ | 5.07 ✓ |
| **Blue-100 `#A5AECF`** | 2.20 ✗ | **5.36** ✓ | **7.33** ✓ |

**ค่าที่ใช้จริง: `info` = Blue-500 `#026BB5` (light) / Blue-100 `#A5AECF` (dark)**
เป็นรูปแบบเดียวกับที่สีอื่นในระบบทำ — dark mode ไม่ได้พลิกค่าอัตโนมัติ แต่เลือกขั้นที่ตรวจกับพื้นมืดแยกต่างหาก

### พื้นของชิป `info`

จุดเหล่านี้ 8 ใน 11 บรรทัดใช้ `bg-primary/10` เป็นพื้นอ่อนอยู่ ซึ่งกฎ opacity ใหม่ให้เปลี่ยนไปใช้ขั้นจากบันได
แต่**ไม่มีคู่ใดในบันได Blue ที่ให้ contrast ถึง 4.5 : 1**

| ข้อความ / พื้น | contrast |
|---|---|
| Blue-900 `#4B4E5F` บน Blue-100 `#A5AECF` | 3.74 : 1 |
| Blue-800 `#536281` บน Blue-100 | 2.78 : 1 |
| Blue-500 `#026BB5` บน Blue-100 | 2.53 : 1 |
| Lynx White `#F7F7F7` บน Blue-800 `#536281` | **5.71 : 1** ✓ |

**ทางออกที่เลือก: ชิป `info` ไม่มีพื้นเป็นค่าตั้งต้น** — ไอคอน + ข้อความสี `info` บนผิวการ์ด มี `border` ได้
รูปแบบเดียวกับ pill "ปกติ / offline" ในข้อ 3.4 ที่ไม่มีพื้นเหมือนกัน
ถ้าจุดไหนจำเป็นต้องมีพื้นจริง ๆ ให้ใช้ `info-strong` = พื้น Blue-800 + ข้อความ Lynx White (5.71 : 1)

### สวิตช์ที่ใช้ `bg-status-ok` เป็นสถานะ "เปิด"

ยืนยันให้ย้ายมาใช้ `control-checked` ทั้ง 2 จุด (`components/settings/field.tsx:209`,
`components/control/schedule-panel.tsx:216`) — สวิตช์บอก "ติ๊กแล้ว" ไม่ใช่ "สถานะปกติ"
ถ้าปล่อยเป็นเขียวจะชนกับความหมายของ status pill ในข้อ 3.4
contrast: Argent-900 บนขาว 7.53 : 1 · Lynx White บน Argent-950 10.99 : 1

---

## 12. งานที่พบระหว่างทำ แต่เป็นของเฟสอื่น

### 12.1 Header ล้นจอ 29 px ที่ 375 px — เป็นของ Phase 7.3

วัดด้วย iframe กว้าง 375 px จริง (หน้าต่าง Chrome บน macOS ย่อต่ำกว่า 500 px ไม่ได้)
ทุกหน้ารวมทั้ง `/login` ได้ `scrollWidth = 404` เท่ากันหมด

- ต้นเหตุ: แถวควบคุมมุมขวาบนของ header (`ml-auto flex items-center gap-2 sm:gap-3`) กว้าง 328 px
  แต่เหลือที่ให้แค่ ~299 px หลังหักส่วนซ้าย
- **ไม่ใช่ผลจาก Phase 7.1** — ทดสอบโดยบังคับ `font-family: system-ui` ในหน้าเดียวกันได้ 405 px
  (แย่กว่าเดิม 1 px) และ `git diff` ยืนยันว่า `components/layout/header.tsx` ไม่ถูกแตะเลยในเฟสนี้
- น่าจะมาตั้งแต่ตอนเพิ่มหน้า login ซึ่งเติมบล็อกผู้ใช้ (ชื่อ + เวลาเซสชัน + บทบาท + ปุ่มออกจากระบบ) เข้า header
- §6.1 กำหนดไว้แล้วว่า mobile ต้องย่อ header เหลือ โลโก้ + สถานะเชื่อมต่อ + กระดิ่ง → แก้พร้อมกันใน 7.3

---

## 13. Open questions

| # | เรื่อง | สถานะ |
|---|---|---|
| 1 | สีชุดข้อมูลของกราฟ | **ปิดแล้ว** — เลือก (ก) 2 สีหลัก + Argent อ้างอิง (ข้อ 9) |
| 2 | สัดส่วนกล่องโลโก้ | **ปิดแล้ว** — extract ใหม่จากหน้า 11 ได้ 1.4017 (ข้อ 4) |
| 3 | `temp-vs-usage-chart` dual-axis | **ปิดแล้ว — ข้อสรุปเดิมผิด** ไฟล์เป็น small multiples อยู่แล้ว ไม่มีงานค้าง (ข้อ 10) |
| 4 | การแยกความหมาย `--primary` | **ปิดแล้ว** — 51/51 token จัดเข้ากลุ่มครบ เพิ่ม token `info` (ข้อ 11) |
| 5 | ไฟล์โลโก้ต้นฉบับ | **ค้าง** — ที่ได้เป็น JPEG สีกล่องคลาด 8/255 ควรขอไฟล์ ai/svg/png จากองค์กร |
| 6 | Favicon | **ค้าง** — คงรูปทรงเดิมเปลี่ยนสีใน 7.3 แล้ว แต่ยังต้องถามว่าองค์กรมี favicon ทางการหรือไม่ |
| 7 | Argent-950 / Argent-1000 | **ค้าง** — 2 ค่าที่อยู่นอก CI ต้องแจ้งเจ้าของแบรนด์ |
| 8 | สวิตช์ที่ใช้ `bg-status-ok` เป็นสถานะ "เปิด" | **ปิดแล้ว** — ย้ายมาใช้ `control-checked` ทั้ง 2 จุด ทำใน 7.2 (ข้อ 11) |
| 9 | ความจางของชุดอ้างอิงใน light mode | **เฝ้าดู** — Argent-100 ได้ 1.67 : 1 ถ้าอ่านไม่ออกบนจอแขวนผนัง ให้หยุดรายงาน (ข้อ 9) |
| 10 | Header ล้น 29 px ที่ 375 px | **ค้าง** — เป็นของ Phase 7.3 ไม่ใช่ของ 7.1 (ข้อ 12.1) |

---

## 14. สิ่งที่เปลี่ยนจริงใน Phase 7.1

| เรื่อง | ผล |
|---|---|
| ตัวแปรสีใน `app/globals.css` | 84 ค่าผ่าน whitelist ทุกค่า (`npm run check:colors`) |
| contrast ตามข้อ 3.2–3.5 | ผ่านครบ 27 คู่ · ข้อยกเว้นปุ่ม primary ยังอยู่ที่ 4.42 : 1 ตามที่บันทึกไว้ |
| hex ที่ hard-code | เหลือเฉพาะ `lib/config/theme.ts` (สี LINE ย้ายไป `thirdParty.line` แล้ว) |
| class สีสำเร็จรูปของ Tailwind | 0 จุด |
| `*-primary` | 51 → 11 token ที่เหลือเป็นพื้นแบรนด์ล้วน (ปุ่ม, badge, tabs, กล่องโลโก้ชั่วคราว, ขอบการ์ด VIP) |
| ฟอนต์ | Montserrat 4 น้ำหนักใน `app/fonts/` + `OFL.txt` · build มี woff2 12 ไฟล์ · ไม่มี URL ภายนอก |
| ขนาด KPI | วัดจริงได้ 32 px ที่ 375 px และ 48 px ที่ 1920 px ตามข้อ 4 |

### สองเรื่องที่ต้องรู้

**1. `next/font` แทรก fallback กลาง stack** — ถ้าใส่ `fallback: ['system-ui', ...]` ในตัวฟอนต์แต่ละตัว
`var(--font-montserrat)` จะขยายเป็น `__montserrat, __montserrat_Fallback, system-ui, sans-serif`
ทำให้ `system-ui` ไปอยู่**ก่อน** IBM Plex Sans Thai แล้วอักษรไทยตกไปที่ฟอนต์ระบบแทน
แก้โดยเอา `fallback` ออกจากทั้งสองตัว + ตั้ง `adjustFontFallback: false` ให้ Montserrat
แล้วปล่อยให้ `fontFamily.sans` ใน `tailwind.config.ts` กำหนดลำดับจุดเดียว
ตรวจด้วยการวัดความกว้างข้อความ: ละตินได้ 218.2 px (Montserrat) ไม่ใช่ 198.7 px (system-ui)
และไทยได้ 243.3 px (Plex) ไม่ใช่ 244.1 px (system-ui)

**2. บันไดสี Blue ของ CI ไล่เฉดไม่ได้** — ขั้น 700 กับ 500 มี OKLCH L เท่ากันที่ 0.517
`validateOrdinal` จึง FAIL ที่ "Adjacent ΔL" ทุกชุด 4 ขั้นที่ประกอบได้
โชคดีที่โค้ดจริงเรียกใช้แค่ 2 ขั้น จึงตัดบันได 4 ขั้นทิ้ง เหลือ `--data-water` กับ `--data-water-soft`
ตามที่ข้อ 3.3 กำหนดไว้พอดี
