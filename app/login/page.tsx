'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Droplets, Info, Loader2, LogIn, ServerCog } from 'lucide-react';
import type { User } from '@/lib/types';
import { demoAccounts, getSession, signIn } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';

const INPUT_CLASS =
  'h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
  const [accounts, setAccounts] = useState<User[]>([]);

  useEffect(() => {
    setAccounts(demoAccounts());
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
        router.replace('/');
        return;
      }
      setError(locale === 'th' ? result.errorTh : result.errorEn);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30">
      <header className="flex items-center justify-end gap-2 p-4">
        <LangToggle />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-10">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Droplets className="h-7 w-7" aria-hidden />
            </span>
            <h1 className="text-xl font-semibold tracking-tight">{t.app.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t.auth.subtitle}</p>
          </div>

          <Card>
            <CardContent className="p-5">
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
                  <span className="block text-[11px] text-muted-foreground">{t.auth.demoPasswordHint}</span>
                </label>

                {error !== null && (
                  <p className="rounded-md bg-status-critical/10 px-2.5 py-2 text-xs text-status-critical" role="alert">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full gap-1.5" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <LogIn className="h-4 w-4" aria-hidden />
                  )}
                  {busy ? t.auth.signingIn : t.auth.signIn}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* บอกตรง ๆ ว่านี่เป็นหน้าจอสาธิต ไม่ใช่ระบบที่ปกป้องอะไรอยู่จริง */}
          <p className="flex gap-1.5 rounded-md bg-status-warning/10 px-2.5 py-2 text-[11px] leading-snug text-status-warning">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t.auth.demoNotice}
          </p>

          {accounts.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="mb-2 text-xs font-medium">{t.auth.demoAccounts}</p>
                <ul className="space-y-1">
                  {accounts.map((account) => (
                    <li key={account.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setUsername(account.id);
                          setPassword('demo');
                          setError(null);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1 truncate">{account.displayName}</span>
                        <code className="shrink-0 text-[10px] text-muted-foreground">{account.id}</code>
                        <Badge variant="outline" className="shrink-0 text-[10px]">
                          {account.role}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ServerCog className="h-3.5 w-3.5" aria-hidden />
            {t.auth.localOnly}
          </p>
        </div>
      </main>
    </div>
  );
}
