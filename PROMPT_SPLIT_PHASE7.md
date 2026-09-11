อ่าน CLAUDE.md, RUNBOOK.md และ PROMPTS.md ก่อน

งานรอบนี้คือ **วางแผนอย่างเดียว ห้ามแก้โค้ดของแอป**
ให้เตรียมไฟล์อ้างอิง แล้วแตกสเปก UI Branding เป็น phase ย่อยต่อท้าย PROMPTS.md

## ขั้น A — เตรียมไฟล์

1. `ls -la ~/Downloads/templat/` — ถ้าไม่มีโฟลเดอร์นี้หรือไม่เจอ `BRANDING_SPEC.md` ข้างใน ให้หยุดถาม
2. `mkdir -p docs/design-refs public/brand`
3. ย้าย `BRANDING_SPEC.md` ไปที่ `docs/BRANDING_SPEC.md`
4. คัดลอกไฟล์ที่เหลือทั้งหมด (PDF + ภาพ) ไปที่ `docs/design-refs/`
5. เพิ่ม `docs/design-refs/` ใน `.gitignore` (เอกสาร CI ขององค์กรและภาพหน้าจอ KLC ห้ามขึ้น repo)
6. เช็คข้อ 3.6 ใน BRANDING_SPEC ว่าเลือก dark mode (ก) หรือ (ข) แล้วหรือยัง ถ้ายังว่าง ให้จดไว้เป็น open question และทำขั้นต่อไปได้

## ขั้น B — สำรวจโค้ด (อ่านอย่างเดียว)

เก็บตัวเลขและรายชื่อไฟล์จริงสำหรับขั้น C:

- จำนวนและตำแหน่ง hex ที่ hard-code: `grep -rnE "#[0-9a-fA-F]{3,8}\b" app/ components/ lib/ --include=*.tsx --include=*.ts`
- class สีสำเร็จรูปของ Tailwind: `grep -rnE "\b(bg|text|border|fill|stroke|ring|from|to|via)-(red|green|yellow|amber|blue|sky|slate|gray|zinc|neutral|stone|emerald|orange|rose)-[0-9]{2,3}" app/ components/`
- รูปแบบตัวแปรสีใน `app/globals.css` (HSL หรือ oklch) และ `tailwind.config.*`
- ฟอนต์ใน `app/fonts/` และวิธีโหลดใน `app/layout.tsx`
- component ที่กำหนดสีสถานะเอง (ok/warning/critical/offline) — มี component กลางอยู่แล้วหรือยัง
- สีใน Recharts, SVG ของ `components/tanks/` และ `components/diagram/`, และ `lib/config/anomaly-types.ts`
- ไฟล์ใน `components/layout/` และหน้า `/login`
- จำนวนไฟล์ component ที่แต่ละ route ใช้

## ขั้น C — แตก phase

เขียนต่อท้าย `PROMPTS.md` เป็นหัวข้อ `## Phase 7 — UI Branding (Kasetphand CI)` แล้วแบ่ง phase ย่อยตามกฎนี้:

- ใช้รูปแบบเดียวกับ phase เดิม: หัวข้อ `## Phase 7.x — <ชื่อ>` แล้วตามด้วย code block ที่เป็นคำสั่ง
- **อ้างอิงเลขข้อใน `docs/BRANDING_SPEC.md` ห้ามคัดลอกเนื้อหาสเปกมาซ้ำ** (สเปกต้องแก้ได้ที่เดียว)
- แต่ละ phase ต้องระบุ 4 อย่าง:
  1. ไฟล์ที่จะแตะ — ใช้รายชื่อจริงจากขั้น B ห้ามเดา path
  2. สิ่งที่ต้องทำ
  3. ข้อใน checklist ของ BRANDING_SPEC ข้อ 8 ที่ต้องผ่านเมื่อจบ phase
  4. จุดหยุดถามเฉพาะของ phase นั้น (นอกเหนือจากที่ RUNBOOK กำหนดอยู่แล้ว)
- ขนาดของแต่ละ phase ต้องจบได้ใน context เดียว — ถ้า phase ไหนต้องแตะ component เกิน ~15 ไฟล์ ให้แตกย่อยอีก (เช่น 7.5a / 7.5b)
- ลำดับ **foundation → components กลาง → shell → หน้า → sweep** ห้ามสลับ

โครงตั้งต้น (ปรับจำนวนและการจับกลุ่มหน้าได้ตามผลขั้น B):

| Phase | งาน | เมื่อจบต้องได้ |
|---|---|---|
| 7.0 | `docs/DESIGN_PLAN.md`: ยืนยันค่าบันไดสีเทียบ PDF (ข้อ 3.1), ได้ไฟล์โลโก้ (ข้อ 5.1), ตาราง mapping สีเดิม → token ใหม่, สรุปทางเลือก dark mode (ข้อ 3.6), open questions | เอกสาร + โลโก้ใน `public/brand/` โดยยังไม่แก้ UI — **หยุดรออนุมัติ** |
| 7.1 | Tokens + ฟอนต์: `globals.css` (light/dark), `tailwind.config.*`, `lib/config/theme.ts`, Montserrat ผ่าน `next/font/local`, test whitelist hex + test contrast (ข้อ 3, 4) | build + test ผ่าน ทุกหน้ายังทำงานได้ (สีอาจยังผสมกันอยู่) |
| 7.2 | Components กลาง: `brand-logo.tsx`, status pill (ต่อยอดของเดิมถ้ามี), สีใน `anomaly-types.ts` (ข้อ 3.4, 3.7, 5.2) | ไม่มี component ไหนประกอบสีสถานะเอง |
| 7.3 | Shell: Header, Sidebar, ThemeToggle, LangToggle, mobile drawer, `/login` (ข้อ 5.3, 6.1, 6.2) | ทุกหน้าใช้ shell ใหม่ |
| 7.4 | `/` ภาพรวม + tank gauge (ข้อ 6.3, 7) | |
| 7.5 | `/control` + `/devices` | |
| 7.6 | `/alerts` + `/reports` | |
| 7.7 | `/ai` + `/overview` ผังการไหล | |
| 7.8 | `/settings` + sweep ทั้งแอป: checklist ข้อ 8 ครบทุกข้อ, ตรวจ 375px / 1920px ทั้ง light และ dark, เพิ่มหัวข้อ "Brand rules" สั้น ๆ ใน `CLAUDE.md` ที่ชี้ไป `docs/BRANDING_SPEC.md`, ปรับ `HANDOFF.md` ถ้ามีจุดที่เปลี่ยน (เช่น ไฟล์ theme ใหม่) | ผ่าน checklist ทั้งหมด |

## ขั้น D — จบรอบ

1. `git add -A && git commit -m "Phase 7 plan: split UI branding into sub-phases"`
2. รายงานไม่เกิน 15 บรรทัด:
   - ตาราง phase ที่แตกได้ + จำนวนไฟล์ที่แต่ละ phase จะแตะ
   - ตัวเลขจากขั้น B (จำนวน hex, จำนวน class สี Tailwind, จำนวน component ที่ประกอบสีสถานะเอง)
   - ความเสี่ยงหรือจุดที่สเปกขัดกับโค้ดจริง
   - open questions (รวมเรื่อง dark mode ถ้ายังไม่ได้เลือก)
3. **หยุด ห้ามเริ่ม Phase 7.0 จนกว่าผมสั่ง**
