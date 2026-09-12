/**
 * เติม prefix ให้เส้นทางไฟล์ใน public/
 *
 * ★ ระบบจริงรันที่ราก (`/`) บน VM ในโรงงาน — ค่าปกติจึงเป็นค่าว่าง ไม่มีอะไรเปลี่ยน
 * ★ ใช้ prefix เฉพาะตอน export ไปวางใต้เส้นทางย่อย เช่นเดโมบน GitHub Pages
 *   ที่อยู่ใต้ `/<ชื่อ repo>/` ถ้าไม่เติม รูปกับโลโก้จะ 404 ทั้งหมด
 * ★ ต้องเป็น NEXT_PUBLIC_* เพราะโค้ดฝั่งเบราว์เซอร์ต้องอ่านค่านี้ด้วย
 *   และ Next.js แทนค่าให้ตอน build ไม่ใช่ตอนรัน
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** เส้นทางของไฟล์ใน public/ — รับค่าที่ขึ้นต้นด้วย "/" เสมอ */
export function assetPath(path: string): string {
  return `${BASE_PATH}${path}`;
}
