'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Info, Loader2, LogIn, ServerCog } from 'lucide-react';
import { getSession, signIn } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { BrandLogo } from '@/components/layout/brand-logo';
import { LoginSuccess } from '@/components/layout/login-success';

const INPUT_CLASS =
  'h-10 w-full rounded-control border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * หน้าเข้าสู่ระบบ
 *
 * ★★ เป็นหน้าจอสาธิต ไม่ใช่ระบบยืนยันตัวตนจริง ★★
 *   รหัสผ่านไม่ถูกตรวจและไม่ถูกเก็บที่ไหน — เขียนบอกผู้ใช้ไว้บนหน้าจอตรง ๆ
 *   เพื่อไม่ให้เข้าใจผิดว่าระบบกำลังปกป้องอะไรอยู่
 */
export default function LoginPage(): JSX.Element {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    // ล็อกอินค้างอยู่แล้วก็ไม่ต้องให้กรอกซ้ำ
    void getSession().then((session) => {
      if (session !== null) router.replace('/');
    });
  }, [router]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(username, password);
      if (result.ok) {
        // โชว์เครื่องหมายถูกให้จบก่อนค่อยเปลี่ยนหน้า ไม่งั้นผู้ใช้จะไม่ทันเห็นว่าสำเร็จ
        setSucceeded(true);
        window.setTimeout(() => {
          router.replace('/');
        }, 1_100);
        return;
      }
      setError(locale === 'th' ? result.errorTh : result.errorEn);
      setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      {/*
        ภาพฉากของแบรนด์เต็มจอ — ไฟล์อยู่ใน public/brand/ ไม่ได้ดึงจากอินเทอร์เน็ต (on-premise)
        ★ ภาพสว่างมาก (ความสว่างเฉลี่ย 0.65) จึงห้ามวางตัวอักษรลงบนภาพตรง ๆ
          ทุกข้อความต้องอยู่ในการ์ดที่มีพื้นทึบของตัวเอง
      */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: 'url(/brand/login-scene.jpg)' }}
        aria-hidden
      />
      {/*
        ฉากบังแสง — โหมดสว่างบาง ๆ พอให้การ์ดเด่นขึ้น โหมดมืดเข้มกว่าเพราะภาพสว่างจัด
        (opacity ตรงนี้เป็น backdrop ซึ่งกฎ opacity ในข้อ 3 อนุญาต)
      */}
      <div className="absolute inset-0 bg-background/45 dark:bg-background/80" aria-hidden />

      {/*
        แถบบน: โลโก้ซ้าย ตัวสลับภาษา/ธีมขวา — ไม่มีเมนูนำทาง เพราะหน้านี้ยังไม่ได้ล็อกอิน
        ★ แถบนี้ใช้พื้นทึบ ไม่ใช่โปร่งแสง เพราะ BRANDING_SPEC ข้อ 5.2 ห้ามวางโลโก้บนพื้นภาพ
      */}
      <header className="relative flex items-center gap-3 border-b bg-card px-4 py-3">
        <BrandLogo height={32} priority />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{t.app.shortTitle}</span>
        <LangToggle />
        <ThemeToggle />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-4 pb-10">
        <div className="w-full max-w-sm space-y-4">
          {/*
            การ์ดล็อกอิน — ใช้พื้นทึบ ไม่ใช่กึ่งโปร่งแสง เพื่อให้เด่นออกมาจากภาพฉากชัด ๆ
            ★ ได้เงาของระบบ (เงาเดียวที่อนุญาตตามข้อ 6.2) เพราะทำหน้าที่เหมือน dialog ที่ลอยอยู่บนฉาก
            ★ ring เพิ่มอีกชั้นเพื่อตัดขอบการ์ดออกจากภาพที่มีรายละเอียดเยอะ
          */}
          <Card className="rounded-overlay shadow-xl ring-1 ring-border">
            <CardContent className="p-6">
              <div className="mb-5 text-center">
                <h1 className="text-2xl font-semibold tracking-tight">{t.auth.title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{t.auth.subtitle}</p>
              </div>
              {succeeded ? (
                <LoginSuccess />
              ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t.auth.username}</span>
                  <input
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value);
                      setError(null);
                    }}
                    className={cn(INPUT_CLASS, error !== null && 'border-status-critical')}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium">{t.auth.password}</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError(null);
                    }}
                    className={cn(INPUT_CLASS, error !== null && 'border-status-critical')}
                  />
                </label>

                {error !== null && (
                  <p className="rounded-control bg-status-critical px-2.5 py-2 text-xs text-status-critical-foreground" role="alert">
                    {error}
                  </p>
                )}

                {/* CTA หลักของหน้า — size lg ทำให้ตัวอักษรเป็น 16px/600 จึงวางบน Cinnabar-500 ได้ตามข้อ 3.5 */}
                <Button type="submit" size="lg" className="w-full gap-1.5" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <LogIn className="h-4 w-4" aria-hidden />
                  )}
                  {busy ? t.auth.signingIn : t.auth.signIn}
                </Button>
              </form>
              )}
            </CardContent>
          </Card>

          {/* บอกตรง ๆ ว่านี่เป็นหน้าจอสาธิต ไม่ใช่ระบบที่ปกป้องอะไรอยู่จริง */}
          {!succeeded && (
            <p className="flex gap-1.5 rounded-control bg-status-warning-surface px-2.5 py-2 text-[11px] leading-snug text-status-warning">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t.auth.demoNotice}
            </p>
          )}

          {!succeeded && (
            <p className="flex items-center justify-center gap-1.5 rounded-control bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <ServerCog className="h-3.5 w-3.5" aria-hidden />
              {t.auth.localOnly}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
