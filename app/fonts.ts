import localFont from 'next/font/local';

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
  fallback: ['system-ui', 'sans-serif'],
});
