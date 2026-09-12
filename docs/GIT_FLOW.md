# GIT_FLOW.md — วิธีแตก branch และส่งงาน

## ภาพรวม

```
feature/<ชื่อคุณ>-<สิ่งที่ทำ>   ← แต่ละคนทำงานที่นี่
            │
            ▼  Pull Request
          dev                  ← รวมงานของทุกคน ทดสอบรวมกันที่นี่
            │
            ▼  Pull Request (เมื่อ dev ผ่านแล้ว)
          main                 ← ของที่พร้อมส่งอาจารย์ / ขึ้นเครื่องจริง
```

| branch | ใครแตะได้ | ไว้ทำอะไร |
|---|---|---|
| `main` | merge จาก `dev` เท่านั้น | เวอร์ชันที่พร้อมส่ง ต้องรันได้เสมอ |
| `dev` | merge จาก PR เท่านั้น | ที่รวมงานของทุกคน อาจพังชั่วคราวได้แต่ต้องรีบแก้ |
| `feature/*` | เจ้าของ branch | งานของแต่ละคน push ได้อิสระ |

**`dev` เป็น default branch ของ repo** — เปิด PR ใหม่จะพุ่งเข้า `dev` ให้เอง

---

## ขั้นตอนสำหรับสมาชิกในทีม

### 1. ดึงของล่าสุดมาก่อน

```bash
git checkout dev
git pull origin dev
```

### 2. แตก branch ของตัวเอง

```bash
git checkout -b feature/beer-tank-card
```

**รูปแบบชื่อ:** `feature/<ชื่อคุณ>-<สิ่งที่ทำ>` เช่น

| ประเภท | ตัวอย่าง |
|---|---|
| ทำของใหม่ | `feature/beer-alert-filter` |
| แก้บั๊ก | `fix/nont-chart-tooltip` |
| งานเอกสาร | `docs/mint-handoff` |

ใช้ตัวพิมพ์เล็กกับขีดกลางเท่านั้น ห้ามมีเว้นวรรคหรือภาษาไทยในชื่อ branch

### 3. ทำงานและ commit

```bash
git add .
git commit -m "เพิ่มตัวกรองการแจ้งเตือนตามความรุนแรง"
```

ข้อความ commit เขียนเป็นภาษาไทยได้ **บอกว่าทำอะไร ไม่ใช่บอกว่าแก้ไฟล์ไหน**

### 4. ตรวจก่อน push — ต้องผ่านครบทุกข้อ

```bash
npx tsc --noEmit
npm run lint
npm run check:colors
npm run check:buckets
npm run check:series
npm run build
```

ข้อไหนไม่ผ่าน **ห้าม push** ให้แก้ให้ผ่านก่อน

### 5. push แล้วเปิด Pull Request เข้า `dev`

```bash
git push -u origin feature/beer-tank-card
```

แล้วเปิด PR บน GitHub — ปลายทางต้องเป็น **`dev`** (เป็นค่าตั้งต้นอยู่แล้ว)

ในคำอธิบาย PR บอกสามอย่าง
1. ทำอะไร
2. ทดสอบยังไง / เปิดหน้าไหนดูได้
3. มีอะไรที่คนอื่นต้องรู้ไหม (เช่น แก้ `lib/types.ts`)

### 6. หลัง merge แล้ว

```bash
git checkout dev
git pull origin dev
git branch -d feature/beer-tank-card
```

---

## การเอา `dev` ขึ้น `main`

ทำเมื่อ **ทดสอบบน `dev` ผ่านแล้ว** เท่านั้น

1. เปิด PR จาก `dev` → `main`
2. ไล่เช็คลิสต์ในขั้นที่ 4 อีกรอบบน `dev`
3. เปิดเว็บดูจริงให้ครบทุกหน้า ทั้งโหมดสว่าง/มืด และจอ 375px
4. merge เข้า `main`

---

## เจอปัญหาบ่อย

**ทำงานผิด branch (เผลอแก้บน `dev`)**

```bash
git stash                              # เก็บงานไว้ก่อน
git checkout -b feature/beer-my-work   # แตก branch ใหม่
git stash pop                          # เอางานกลับมา
```

**`dev` ขยับไปไกลแล้ว อยากดึงมาทับ branch ตัวเอง**

```bash
git checkout feature/beer-my-work
git fetch origin
git merge origin/dev
```

**ชน conflict**
เปิดไฟล์ที่ชน แก้ให้เหลือของที่ถูก ลบเครื่องหมาย `<<<<<<<` `=======` `>>>>>>>` ออกให้หมด
แล้ว `git add` ไฟล์นั้นและ `git commit`
ถ้าไม่แน่ใจว่าฝั่งไหนถูก **ให้ถามเจ้าของโค้ดก่อน อย่าเดา**

---

## ข้อห้าม

1. **ห้าม `git push --force` เข้า `main` หรือ `dev`** — ประวัติของคนอื่นจะหาย
2. **ห้าม commit ไฟล์ใน `docs/design-refs/`** — เป็นเอกสาร CI ขององค์กร (อยู่ใน `.gitignore` แล้ว)
3. **ห้าม commit `node_modules/`, `.next/`, `out/`, ไฟล์ `.env`**
4. **ห้าม merge PR ของตัวเองโดยไม่มีคนดู** อย่างน้อยต้องมีเพื่อนอ่านหนึ่งคน
5. **ห้ามแก้ `lib/types.ts` ของเดิมโดยไม่บอกทีม** เพราะเป็นสัญญากับทีมหลังบ้านและทีม AI

> **หมายเหตุ:** repo นี้เป็น private บนบัญชีแบบฟรี จึงยังตั้ง branch protection บน GitHub ไม่ได้
> กฎด้านบนจึงต้องอาศัยวินัยของทีมเอง ถ้าอัปเกรดเป็น GitHub Pro เมื่อไร
> ให้เปิด "Require a pull request before merging" ที่ `main` และ `dev` ทันที
