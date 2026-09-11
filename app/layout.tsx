import type { Metadata, Viewport } from 'next';
import './globals.css';
import { montserrat, plexThai } from './fonts';
import { themeColor } from '@/lib/config/theme';
import { LocaleProvider } from '@/lib/i18n';
import { AuthGate } from '@/components/layout/auth-gate';
import { THEME_INIT_SCRIPT, ThemeProvider } from '@/components/layout/theme-provider';

export const metadata: Metadata = {
  title: 'ระบบมอนิเตอร์และควบคุมการใช้น้ำ',
  description: 'แดชบอร์ดมอนิเตอร์และควบคุมการใช้น้ำในโรงงาน — ทำงานแบบ on-premise 100%',
  // ไอคอนต้องอยู่ในโปรเจกต์ ห้ามชี้ไป CDN
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  // ค่าสีมาจาก lib/config/theme.ts จุดเดียว ห้ามเขียน hex ซ้ำที่นี่ (BRANDING_SPEC ข้อ 3.7)
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: themeColor.light },
    { media: '(prefers-color-scheme: dark)', color: themeColor.dark },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* ทาธีมก่อน React hydrate เพื่อไม่ให้จอขาววาบในห้องคอนโทรลที่เปิดจอทิ้งไว้ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${montserrat.variable} ${plexThai.variable} font-sans`}>
        <ThemeProvider>
          <LocaleProvider>
            <AuthGate>{children}</AuthGate>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
