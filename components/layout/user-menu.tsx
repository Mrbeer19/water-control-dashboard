'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import type { AuthSession } from '@/lib/types';
import { getSession, signOut } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { formatMinutes } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/** ผู้ใช้ที่ล็อกอินอยู่ พร้อมปุ่มออกจากระบบ */
export function UserMenu(): JSX.Element | null {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    void getSession().then(setSession);
  }, []);

  const handleSignOut = useCallback(() => {
    void signOut().then(() => {
      router.replace('/login');
    });
  }, [router]);

  if (session === null) return null;

  const minutesLeft = Math.max(
    0,
    Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 60_000),
  );

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-xs font-medium">{session.user.displayName}</p>
        <p className="text-[10px] text-muted-foreground">
          {t.auth.sessionExpires} {formatMinutes(minutesLeft, locale)}
        </p>
      </div>
      <Badge variant="outline" className="hidden text-[10px] md:inline-flex">
        {session.user.role}
      </Badge>
      <button
        type="button"
        onClick={handleSignOut}
        title={t.auth.signOut}
        aria-label={t.auth.signOut}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
