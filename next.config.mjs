/**
 * ★ ค่าปกติคือ build แบบเซิร์ฟเวอร์ สำหรับรันบน VM ในโรงงาน — ห้ามแก้พฤติกรรมนี้
 * ★ ตัวแปร STATIC_EXPORT ใช้เฉพาะตอนทำ "เดโมแบบไฟล์นิ่ง" ให้เพื่อนในทีมเปิดดูผ่านเว็บ
 *   ไม่ได้กระทบของที่ส่งจริง เพราะเปิดด้วย env เท่านั้น
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const staticExport = process.env.STATIC_EXPORT === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // On-premise: ไม่มีอินเทอร์เน็ต — ปิด optimizer ที่ต้องดึง remote และ telemetry ภายนอก
  images: { unoptimized: true },
  eslint: { dirs: ['app', 'components', 'lib'] },
  ...(staticExport
    ? {
        output: 'export',
        // เดโมอยู่ใต้เส้นทางย่อยของ GitHub Pages จึงต้องบอก Next ให้เติม prefix ให้ asset
        basePath,
        // Pages เสิร์ฟไฟล์นิ่ง ต้องมี index.html ในทุกโฟลเดอร์ ไม่งั้น /control จะ 404
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
