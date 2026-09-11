import localFont from 'next/font/local';

/**
 * Montserrat — ฟอนต์อังกฤษตาม CI ของ Kasetphand (docs/BRANDING_SPEC.md ข้อ 4)
 * ได้มาจาก github.com/google/fonts (ofl/montserrat) แล้ว instance ที่น้ำหนัก 400/500/600/800
 * subset เฉพาะ Latin พร้อม --layout-features+=tnum,lnum แล้วแปลงเป็น woff2 ด้วย fonttools
 * สัญญาอนุญาต OFL อยู่ที่ app/fonts/OFL.txt — ไม่มีการเรียก Google Fonts CDN
 */
export const montserrat = localFont({
  src: [
    { path: './fonts/montserrat-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/montserrat-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/montserrat-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/montserrat-latin-800-normal.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-montserrat',
  // ★ ห้ามใส่ fallback ที่นี่ — next/font จะขยาย var(--font-montserrat) เป็นรายการ family ทั้งชุด
  //   ทำให้ system-ui ไปแทรกกลาง stack แล้วอักษรไทยตกไปที่ system-ui แทน IBM Plex Sans Thai
  //   ลำดับ fallback ที่ถูกต้องกำหนดไว้ที่ fontFamily.sans ใน tailwind.config.ts จุดเดียว
  // ปิด fallback ที่ปรับ metric ด้วย เพราะมันจะถูกแทรกก่อน IBM Plex Sans Thai ในลำดับฟอนต์
  adjustFontFallback: false,
});

/**
 * IBM Plex Sans Thai — self-host 100%
 * ไฟล์ .woff2 ถูก bundle ไว้ใน app/fonts/ ไม่มีการเรียก Google Fonts CDN
 * subset: thai + latin, น้ำหนัก 400/500/600/700
 */
export const plexThai = localFont({
  src: [
    { path: './fonts/ibm-plex-sans-thai-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-thai-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-thai-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-thai-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-latin-700-normal.woff2', weight: '700', style: 'normal' },
    { path: './fonts/ibm-plex-sans-thai-thai-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-thai',
  // เหตุผลเดียวกับ Montserrat — ลำดับ fallback อยู่ที่ tailwind.config.ts
});
