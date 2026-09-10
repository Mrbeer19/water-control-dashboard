'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell, Menu, ServerCog, Wifi, WifiOff } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getConnectionStatus, getUnreadAlertCount } from '@/lib/services';
import { cn, formatRelativeTime, formatTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { LangToggle } from './lang-toggle';
import { ThemeToggle } from './theme-toggle';

interface HeaderProps {
  onOpenMenu: () => void;
}

export function Header({ onOpenMenu }: HeaderProps): JSX.Element {
  const { t, locale } = useLocale();
  const { data: connection, loading: connectionLoading } = useLiveData(getConnectionStatus, []);
  const { data: unread } = useLiveData(getUnreadAlertCount, []);
  const now = useClock();

  const online = connection?.online ?? false;
  const unreadTotal = unread?.total ?? 0;
  const hasCritical = (unread?.critical ?? 0) > 0;

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <button
        type="button"
        onClick={onOpenMenu}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent lg:hidden"
        aria-label={t.header.openMenu}
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {/* นาฬิกา — ตัวเลขใหญ่พอให้อ่านจากกลางห้องคอนโทรล */}
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="tabular text-xl font-semibold sm:text-2xl">{now === null ? '--:--:--' : formatTime(now, locale)}</span>
        <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
          {connection === null
            ? '—'
            : `${t.header.lastSync} ${formatRelativeTime(connection.lastSyncAt, locale)} · ${t.header.latency} ${connection.latencyMs} ms`}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* สถานะการเชื่อมต่อ */}
        {connectionLoading && connection === null ? (
          <Skeleton className="h-7 w-24 rounded-full" />
        ) : (
          <span
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
              online ? 'border-status-ok/30 text-status-ok' : 'border-status-critical/30 text-status-critical',
            )}
          >
            {online ? <Wifi className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
            <span className="hidden sm:inline">{online ? t.header.connected : t.header.disconnected}</span>
          </span>
        )}

        {/* badge "Local Mode" — ย้ำว่าระบบไม่ได้ออกอินเทอร์เน็ต */}
        <Badge variant="secondary" className="hidden h-7 gap-1.5 px-2.5 font-medium sm:flex">
          <ServerCog className="h-3.5 w-3.5" aria-hidden />
          {t.app.localMode}
        </Badge>

        {/* จำนวน alert ที่ยังไม่อ่าน */}
        <Link
          href="/alerts"
          title={unreadTotal > 0 ? `${t.header.unreadAlerts}: ${unreadTotal}` : t.header.noUnreadAlerts}
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unreadTotal > 0 && (
            <>
              {hasCritical && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-5 w-5 animate-pulse-ring rounded-full bg-status-critical"
                  aria-hidden
                />
              )}
              <span
                className={cn(
                  'tabular absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold',
                  hasCritical
                    ? 'bg-status-critical text-status-critical-foreground'
                    : 'bg-status-warning text-status-warning-foreground',
                )}
              >
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            </>
          )}
          <span className="sr-only">
            {unreadTotal > 0 ? `${t.header.unreadAlerts}: ${unreadTotal}` : t.header.noUnreadAlerts}
          </span>
        </Link>

        <LangToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}

/**
 * นาฬิกาเดินวินาที
 * คืน null จนกว่าจะ mount เสร็จ — เวลาฝั่ง server กับ client ไม่มีทางตรงกัน
 * ถ้าเรนเดอร์ตั้งแต่รอบแรกจะเกิด hydration mismatch
 */
function useClock(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return now;
}
