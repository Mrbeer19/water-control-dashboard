'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, Signal, X } from 'lucide-react';
import type { Device, DeviceActionResult, MetricKey, TimeSeriesPoint } from '@/lib/types';
import { getDeviceHistory, pingDevice, rebootDevice, startFirmwareUpdate } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import {
  cn,
  formatBytes,
  formatDateTimeTH,
  formatNumber,
  formatRelativeTime,
  formatRssi,
  formatUptime,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sparkline } from '@/components/charts/sparkline';
import { CHART, seriesColor } from '@/components/charts/chart-tokens';
import { kindLabel, roleLabel } from './device-labels';

/**
 * ค่าวัดสุขภาพอุปกรณ์ที่เปิดดูย้อนหลังได้ — สลับกันในหน้าต่างเดียว
 * ★ 'online_state' อยู่ในทะเบียนแล้วแต่ยังไม่อยู่ใน MetricKey ของ lib/types.ts
 *   การเพิ่มเข้า union = แก้สัญญากับทีมหลังบ้าน ต้องถามก่อน (RUNBOOK ข้อ 5)
 */
const DEVICE_METRICS: MetricKey[] = ['rssi_dbm', 'uptime_seconds', 'free_heap_bytes'];

/**
 * แผงรายละเอียดอุปกรณ์
 * ใช้ <dialog> ที่จัดวางชิดขวาให้ทำตัวเป็น side panel — ได้ focus trap และปุ่ม Esc มาฟรี
 */
export function DeviceDetailPanel({ device, onClose }: { device: Device | null; onClose: () => void }): JSX.Element {
  const { t, locale } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [rssiHistory, setRssiHistory] = useState<TimeSeriesPoint[]>([]);
  const [uptimeHistory, setUptimeHistory] = useState<TimeSeriesPoint[]>([]);
  const [action, setAction] = useState<DeviceActionResult | null>(null);
  const [busy, setBusy] = useState<'reboot' | 'ping' | 'ota' | null>(null);
  const [otaMessage, setOtaMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (device !== null && !dialog.open) dialog.showModal();
    if (device === null && dialog.open) dialog.close();
  }, [device]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const handleClose = (): void => {
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  // โหลดกราฟใหม่ทุกครั้งที่เปิดอุปกรณ์ตัวอื่น และล้างผลของปุ่มที่กดค้างไว้
  useEffect(() => {
    if (device === null) return;
    setAction(null);
    setOtaMessage(null);
    void (async () => {
      const [rssi, uptime] = await Promise.all([
        getDeviceHistory(device.id, 'rssi_dbm'),
        getDeviceHistory(device.id, 'uptime_seconds'),
      ]);
      setRssiHistory(rssi);
      setUptimeHistory(uptime);
    })();
  }, [device]);

  const runAction = useCallback(
    async (kind: 'reboot' | 'ping') => {
      if (device === null) return;
      setBusy(kind);
      try {
        const result = kind === 'reboot' ? await rebootDevice(device.id) : await pingDeviceAsResult(device.id);
        setAction(result);
      } finally {
        setBusy(null);
      }
    },
    [device],
  );

  const runOta = useCallback(async () => {
    if (device === null) return;
    setBusy('ota');
    try {
      const job = await startFirmwareUpdate(device.id, bumpVersion(device.firmware));
      setOtaMessage(job === null ? t.common.error : `${t.device.otaRunning} → ${job.toVersion}`);
    } finally {
      setBusy(null);
    }
  }, [device, t]);

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        'ml-auto mr-0 h-dvh max-h-none w-[min(26rem,100vw)] rounded-none border-l bg-card p-0 text-card-foreground shadow-xl',
        'backdrop:bg-black/50',
      )}
      aria-label={t.device.detail}
    >
      {device !== null && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-2 border-b px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight">{locale === 'th' ? device.name : device.nameEn}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {kindLabel(device.kind, t)} · {roleLabel(device.role, t)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={device.status} />
              <button
                type="button"
                onClick={onClose}
                aria-label={t.device.close}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <Field label={t.device.ip} value={device.ip} mono />
              <Field label={t.device.vlan} value={String(device.vlan)} mono />
              <Field label={t.device.mac} value={device.mac} mono />
              <Field label={t.device.port} value={String(device.port)} mono />
              <Field label={t.device.protocol} value={device.protocol} mono />
              <Field label={t.device.fieldbus} value={device.fieldbus ?? '—'} mono />
              <Field label={t.device.firmware} value={device.firmware} mono />
              <Field label={t.device.reconnects} value={formatNumber(device.reconnectCount, locale)} />
              <Field label={t.device.uptime} value={formatUptime(device.uptimeSeconds, locale)} />
              <Field label={t.device.freeHeap} value={formatBytes(device.freeHeapBytes, locale)} />
              <Field label={t.device.rssi} value={formatRssi(device.rssi, locale)} />
              <Field label={t.device.lastSeen} value={formatRelativeTime(device.lastSeen, locale)} />
            </dl>

            <div>
              <p className="text-[11px] text-muted-foreground">{t.device.location}</p>
              <p className="text-sm">{locale === 'th' ? device.location : device.locationEn}</p>
            </div>

            {device.expansionModules.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground">{t.device.modules}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {device.expansionModules.map((module) => (
                    <li key={module} className="text-sm">{module}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* กราฟสัญญาณ — อุปกรณ์ที่ต่อสายไม่มี RSSI จึงไม่ต้องวาด */}
            {device.rssi !== null && (
              <div>
                <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Signal className="h-3 w-3" aria-hidden />
                  {t.device.rssi} · dBm
                </p>
                <Sparkline
                  points={rssiHistory}
                  color={seriesColor(0)}
                  height={56}
                  label={`${t.device.rssi} ${device.nameEn}`}
                  series={{ sourceType: 'device', sourceId: device.id, metric: 'rssi_dbm', sourceName: locale === 'th' ? device.name : device.nameEn }}
                  seriesMetrics={DEVICE_METRICS}
                />
              </div>
            )}

            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">{t.device.uptime}</p>
              <Sparkline
                points={uptimeHistory}
                color={CHART.ok}
                height={48}
                label={`${t.device.uptime} ${device.nameEn}`}
                series={{ sourceType: 'device', sourceId: device.id, metric: 'uptime_seconds', sourceName: locale === 'th' ? device.name : device.nameEn }}
                seriesMetrics={DEVICE_METRICS}
              />
            </div>

            {device.lastError !== null && (
              <div className="rounded-control bg-status-critical px-2.5 py-2 text-status-critical-foreground">
                <p className="text-[11px]">{t.device.lastError}</p>
                <p className="text-xs">{device.lastError}</p>
                {device.lastErrorAt !== null && (
                  <p className="mt-0.5 text-[10px] opacity-90">{formatDateTimeTH(device.lastErrorAt, locale)}</p>
                )}
              </div>
            )}

            {device.linkedEntityIds.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground">{t.device.linked}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {device.linkedEntityIds.map((id) => (
                    <code key={id} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{id}</code>
                  ))}
                </div>
              </div>
            )}

            {/* ผลของคำสั่ง — ไล่น้ำหนักตามข้อ 3.4: สำเร็จไม่มีพื้น ล้มเหลวพื้นเต็ม */}
            {action !== null && (
              <p
                className={cn(
                  'rounded-control px-2.5 py-2 text-xs',
                  action.ok
                    ? 'border text-status-ok'
                    : 'bg-status-critical text-status-critical-foreground',
                )}
              >
                {action.message}
                {action.latencyMs !== null && <span className="tabular"> · {action.latencyMs} ms</span>}
              </p>
            )}
            {otaMessage !== null && (
              <p className="rounded-control border px-2.5 py-2 text-xs text-foreground">{otaMessage}</p>
            )}
          </div>

          <footer className="grid grid-cols-3 gap-2 border-t px-4 py-3">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runAction('ping')}>
              {busy === 'ping' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t.device.ping}
            </Button>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void runAction('reboot')}>
              {busy === 'reboot' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> : t.device.reboot}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void runOta()}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              {t.device.ota}
            </Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}

/** ping คืนรูปแบบต่างจาก reboot — แปลงให้เป็นชนิดเดียวกันเพื่อแสดงผลที่เดียว */
async function pingDeviceAsResult(id: string): Promise<DeviceActionResult> {
  const result = await pingDevice(id);
  return {
    deviceId: id,
    action: 'ping',
    ok: result.reachable,
    latencyMs: result.latencyMs,
    message: result.reachable ? 'ติดต่ออุปกรณ์ได้ตามปกติ' : 'ติดต่ออุปกรณ์ไม่ได้',
    at: new Date().toISOString(),
  };
}

/** ขยับเลขเวอร์ชันย่อยขึ้นหนึ่งขั้น ใช้เป็นเวอร์ชันปลายทางของการอัปเดตจำลอง */
function bumpVersion(version: string): string {
  const match = /(\d+)(?!.*\d)/.exec(version);
  const digits = match?.[1];
  if (match === null || digits === undefined) return `${version}-next`;
  const next = Number(digits) + 1;
  return version.slice(0, match.index) + String(next) + version.slice(match.index + digits.length);
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn('truncate font-medium', mono && 'tabular font-mono text-[11px]')}>{value}</dd>
    </div>
  );
}
