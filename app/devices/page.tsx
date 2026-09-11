'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import type { Device, DeviceRole, EntityStatus } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getDevices } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatBytes, formatNumber, formatRelativeTime, formatRssi, formatUptime } from '@/lib/utils';
import { Section } from '@/components/layout/section';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-badge';
import { ServiceHealthBar } from '@/components/devices/service-health-bar';
import { DeviceDetailPanel } from '@/components/devices/device-detail-panel';
import { DEVICE_ROLES, kindLabel, roleLabel } from '@/components/devices/device-labels';

const SELECT_CLASS =
  'h-9 rounded-control border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Phase 3A — สถานะอุปกรณ์ทุก node */
export default function DevicesPage(): JSX.Element {
  // useSearchParams ต้องอยู่ใต้ Suspense ตามข้อกำหนดของ App Router
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-card" />}>
      <DevicesView />
    </Suspense>
  );
}

function DevicesView(): JSX.Element {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<DeviceRole | 'all'>('all');
  const [status, setStatus] = useState<EntityStatus | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, loading } = useLiveData<Device[]>(() => getDevices(), []);

  // เปิด panel ให้เลยเมื่อถูกลิงก์มาจากแผนผังการไหล
  const searchParams = useSearchParams();
  const deviceParam = searchParams.get('device');
  useEffect(() => {
    if (deviceParam !== null) setSelectedId(deviceParam);
  }, [deviceParam]);

  const filtered = useMemo(() => {
    if (data === null) return [];
    const needle = query.trim().toLowerCase();
    return data.filter((device) => {
      if (role !== 'all' && device.role !== role) return false;
      if (status !== 'all' && device.status !== status) return false;
      if (needle === '') return true;
      // ค้นได้ทั้งชื่อไทย/อังกฤษ, IP และ MAC — ช่างมักจำ IP ได้แต่จำชื่อไม่ได้
      return (
        device.name.toLowerCase().includes(needle) ||
        device.nameEn.toLowerCase().includes(needle) ||
        device.ip.includes(needle) ||
        device.mac.toLowerCase().includes(needle)
      );
    });
  }, [data, query, role, status]);

  // อ่านตัวที่เลือกจากรายการสด เพื่อให้ค่าใน panel ขยับตามข้อมูลจริงไม่ค้างที่ภาพเก่า
  const selected = data?.find((device) => device.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <Section title={t.device.services}>
        <ServiceHealthBar />
      </Section>

      <Section
        hint={data === null ? undefined : `${t.device.showing} ${filtered.length}/${data.length}`}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder={t.device.search}
                aria-label={t.device.search}
                className="h-9 w-full rounded-control border bg-background pl-8 pr-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <select
              className={SELECT_CLASS}
              value={role}
              aria-label={t.device.kind}
              onChange={(event) => {
                setRole(event.target.value as DeviceRole | 'all');
              }}
            >
              <option value="all">{t.device.allKinds}</option>
              {DEVICE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {roleLabel(option, t)}
                </option>
              ))}
            </select>

            <select
              className={SELECT_CLASS}
              value={status}
              aria-label={t.device.allStatus}
              onChange={(event) => {
                setStatus(event.target.value as EntityStatus | 'all');
              }}
            >
              <option value="all">{t.device.allStatus}</option>
              {(['ok', 'warning', 'critical', 'offline'] as EntityStatus[]).map((option) => (
                <option key={option} value={option}>
                  {t.status[option]}
                </option>
              ))}
            </select>
          </div>

          {loading && data === null ? (
            <Skeleton className="h-96 rounded-card" />
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <p className="text-sm font-medium">{t.device.noMatch}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead>
                    <tr className="border-b bg-secondary text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.device.name}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.device.kind}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.device.ip}</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.device.vlan}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.device.mac}</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.device.port}</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.device.rssi}</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.device.firmware}</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.device.uptime}</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.device.freeHeap}</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">{t.device.reconnects}</th>
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.device.lastSeen}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((device) => (
                      <tr
                        key={device.id}
                        tabIndex={0}
                        role="button"
                        onClick={() => {
                          setSelectedId(device.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelectedId(device.id);
                          }
                        }}
                        className="cursor-pointer border-b last:border-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <StatusDot status={device.status} title={t.status[device.status]} />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{locale === 'th' ? device.name : device.nameEn}</p>
                              {device.lastError !== null && (
                                <p className="truncate text-[11px] text-status-critical">{device.lastError}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="block text-xs">{kindLabel(device.kind, t)}</span>
                          <span className="block text-[11px] text-muted-foreground">{roleLabel(device.role, t)}</span>
                        </td>
                        <td className="tabular px-3 py-2.5 font-mono text-xs">{device.ip}</td>
                        <td className="tabular px-3 py-2.5 text-right text-xs">{device.vlan}</td>
                        <td className="tabular px-3 py-2.5 font-mono text-[11px]">{device.mac}</td>
                        <td className="tabular px-3 py-2.5 text-right text-xs">{device.port}</td>
                        <td
                          className={cn(
                            'tabular px-3 py-2.5 text-right text-xs',
                            device.rssi !== null && device.rssi < -78 && 'text-status-warning',
                            device.rssi !== null && device.rssi < -85 && 'text-status-critical',
                          )}
                        >
                          {formatRssi(device.rssi, locale)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px]">{device.firmware}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-xs">{formatUptime(device.uptimeSeconds, locale)}</td>
                        <td className="tabular px-3 py-2.5 text-right text-xs">{formatBytes(device.freeHeapBytes, locale)}</td>
                        <td
                          className={cn(
                            'tabular px-3 py-2.5 text-right text-xs',
                            device.reconnectCount > 40 && 'text-status-warning',
                          )}
                        >
                          {formatNumber(device.reconnectCount, locale)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                          {formatRelativeTime(device.lastSeen, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </Section>

      <DeviceDetailPanel
        device={selected}
        onClose={() => {
          setSelectedId(null);
        }}
      />
    </div>
  );
}
