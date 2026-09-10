import type { Metadata, Viewport } from 'next';
import './globals.css';
import { plexThai } from './fonts';
import { LocaleProvider } from '@/lib/i18n';
import { AppShell } from '@/components/layout/app-shell';
import { THEME_INIT_SCRIPT, ThemeProvider } from '@/components/layout/theme-provider';

export const metadata: Metadata = {
  title: 'ระบบมอนิเตอร์และควบคุมการใช้น้ำ',
  description: 'แดชบอร์ดมอนิเตอร์และควบคุมการใช้น้ำในโรงงาน — ทำงานแบบ on-premise 100%',
  // ไอคอนต้องอยู่ในโปรเจกต์ ห้ามชี้ไป CDN
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1120' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* ทาธีมก่อน React hydrate เพื่อไม่ให้จอขาววาบในห้องคอนโทรลที่เปิดจอทิ้งไว้ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${plexThai.variable} font-sans`}>
        <ThemeProvider>
          <LocaleProvider>
            <AppShell>{children}</AppShell>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
