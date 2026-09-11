'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import type { SystemSummary } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getSystemSummary, getUnreadAlertCount } from '@/lib/services';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import { BrandLogo } from './brand-logo';
import { LangToggle } from './lang-toggle';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { APP_VERSION, NAV_SECTIONS } from './nav-items';

interface SidebarProps {
  /** เปิดอยู่หรือไม่ (ใช้เฉพาะ mobile — desktop แสดงถาวร) */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps): JSX.Element {
  const pathname = usePathname();
  const { t, locale } = useLocale();
  const { data: unread } = useLiveData(getUnreadAlertCount, []);
  // กล่องสรุประบบท้าย sidebar — ดึงจาก service เดิม ห้ามสร้าง service ใหม่ (BRANDING_SPEC ข้อ 6.1)
  const { data: summary } = useLiveData<SystemSummary>(getSystemSummary, []);

  return (
    <>
      {/* ฉากหลังสำหรับ mobile */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/50 transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-card transition-transform',
          'lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label={t.nav.overview}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
          {/* โลโก้องค์กรมุมซ้ายบน — BRANDING_SPEC ข้อ 5.3 (ห้ามวางด้านล่างของหน้า) */}
          <Link href="/" className="flex min-w-0 items-center gap-2" onClick={onClose}>
            <BrandLogo height={32} priority />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold">{t.app.shortTitle}</span>
              <span className="truncate text-[11px] text-muted-foreground">{t.app.title}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent lg:hidden"
            aria-label={t.header.closeMenu}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.titleKey}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t.nav[section.titleKey]}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  const badgeCount = item.showAlertBadge === true ? (unread?.total ?? 0) : 0;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-brand-strong text-brand-strong-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="flex-1">{t.nav[item.labelKey]}</span>
                        {badgeCount > 0 && (
                          <span className="tabular flex h-5 min-w-5 items-center justify-center rounded-full bg-status-critical px-1.5 text-[11px] font-semibold text-status-critical-foreground">
                            {badgeCount}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* กล่องสรุประบบ + เวอร์ชัน ตามผัง ข้อ 6.1 */}
        <div className="shrink-0 space-y-3 border-t px-4 py-3">
          {summary !== null && (
            <div className="rounded-control border p-2.5">
              <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{t.nav.summary}</p>
              <StatusBadge status={summary.overallStatus} />
              <dl className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <dt className="truncate">{t.nav.devicesOnline}</dt>
                  <dd className="tabular shrink-0 font-medium text-foreground">
                    {summary.devicesOnline}/{summary.devicesTotal}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="truncate">{t.nav.pumpsRunning}</dt>
                  <dd className="tabular shrink-0 font-medium text-foreground">
                    {summary.pumpsRunning}/{summary.pumpsTotal}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {/* บนมือถือ header ย่อเหลือ โลโก้ + สถานะ + กระดิ่ง (ข้อ 6.1) ตัวควบคุมที่เหลือย้ายมาที่นี่ */}
          <div className="flex items-center gap-2 sm:hidden">
            <LangToggle />
            <ThemeToggle />
            <div className="ml-auto">
              <UserMenu />
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {locale === 'th'
              ? 'ระบบทำงานภายในโรงงาน 100% ไม่เชื่อมต่ออินเทอร์เน็ต'
              : 'Runs fully on-premise. No internet connection.'}
          </p>
          <p className="tabular text-[10px] text-muted-foreground">
            {t.nav.version} {APP_VERSION}
          </p>
        </div>
      </aside>
    </>
  );
}
