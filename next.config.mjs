/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // On-premise: ไม่มีอินเทอร์เน็ต — ปิด optimizer ที่ต้องดึง remote และ telemetry ภายนอก
  images: { unoptimized: true },
  eslint: { dirs: ['app', 'components', 'lib'] },
};

export default nextConfig;
