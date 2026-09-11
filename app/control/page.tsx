'use client';

import { useCallback, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { CommandLogEntry, CommandSchedule, ControlInterlock, Pump, SystemSettings, Valve, Zone } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import {
  getCommandLog,
  getCurrentUser,
  getInterlocks,
  getPumps,
  getSchedules,
  getSettings,
  getValves,
  getZones,
} from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { Section } from '@/components/layout/section';
import { Skeleton } from '@/components/ui/skeleton';
import { PumpControlCard } from '@/components/control/pump-control-card';
import { ValveControlCard } from '@/components/control/valve-control-card';
import { EmergencyPanel } from '@/components/control/emergency-panel';
import { SchedulePanel } from '@/components/control/schedule-panel';
import { AuditLog } from '@/components/control/audit-log';
import { PinGate } from '@/components/control/pin-gate';

interface ControlData {
  pumps: Pump[];
  valves: Valve[];
  zones: Zone[];
  interlocks: ControlInterlock[];
  schedules: CommandSchedule[];
  log: CommandLogEntry[];
  settings: SystemSettings;
  userId: string;
}

/**
 * หน้าควบคุมปั๊มและวาล์ว
 *
 * ★ สถานะปุ่มกับสถานะอุปกรณ์แยกกันคนละทาง:
 *   - ปุ่มรู้แค่ว่า "คำสั่งที่เพิ่งส่งเดินไปถึงไหน" (useCommandRunner → poll)
 *   - ตัวเลข/สถานะอุปกรณ์มาจาก useLiveData ที่ไหลเข้ามาทุก 2 วินาที
 *   คำสั่งขึ้น success ไม่ได้แปลว่าอุปกรณ์ขยับแล้ว — ต้องดูค่าจริงประกอบเสมอ
 */
export default function ControlPage(): JSX.Element {
  const { t } = useLocale();
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  const { data, loading } = useLiveData<ControlData>(async () => {
    const [pumps, valves, zones, interlocks, schedules, log, settings, user] = await Promise.all([
      getPumps(),
      getValves(),
      getZones(),
      getInterlocks(),
      getSchedules(),
      getCommandLog(30),
      getSettings(),
      getCurrentUser(),
    ]);
    return { pumps, valves, zones, interlocks, schedules, log, settings, userId: user?.id ?? 'user-somchai' };
  }, [refreshKey]);

  if (loading && data === null) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-52" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-64 rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (data === null) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{t.common.error}</p>;
  }

  const { pumps, valves, zones, interlocks, schedules, log, settings, userId } = data;
  const lockedOut = settings.security.controlLockout;
  // ต้องผ่านด่าน PIN ก่อน ถ้าการตั้งค่าบังคับไว้ — และล็อกทุกอย่างเมื่อระบบอยู่ในสถานะหยุดฉุกเฉิน
  const needsPin = settings.security.requirePinForControl && !pinUnlocked;
  const deviceControlsDisabled = needsPin || lockedOut;

  const findInterlock = (targetId: string): ControlInterlock | null =>
    interlocks.find((item) => item.targetId === targetId) ?? null;

  const vipZone = zones.find((zone) => zone.isVip);

  return (
    <div className="space-y-8">
      {/* ด่าน PIN */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border bg-card px-4 py-3">
        <p className="flex items-center gap-2 text-sm">
          <ShieldCheck className={`h-4 w-4 ${needsPin ? 'text-muted-foreground' : 'text-status-ok'}`} aria-hidden />
          {needsPin ? t.control.pinTitle : t.control.pinUnlocked}
        </p>
        <PinGate
          unlocked={pinUnlocked}
          onUnlock={() => {
            setPinUnlocked(true);
          }}
          onLock={() => {
            setPinUnlocked(false);
          }}
        />
      </div>

      <Section title={t.control.emergency}>
        <EmergencyPanel
          userId={userId}
          disabled={needsPin}
          lockedOut={lockedOut}
          vipZoneName={vipZone?.name ?? '—'}
        />
      </Section>

      <Section title={t.control.pumps}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pumps.map((pump) => (
            <PumpControlCard
              key={pump.id}
              pump={pump}
              interlock={findInterlock(pump.id)}
              userId={userId}
              disabled={deviceControlsDisabled}
            />
          ))}
        </div>
      </Section>

      <Section title={t.control.valves}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {valves.map((valve) => (
            <ValveControlCard
              key={valve.id}
              valve={valve}
              zone={zones.find((zone) => zone.id === valve.zoneId) ?? null}
              interlock={findInterlock(valve.id)}
              userId={userId}
              disabled={deviceControlsDisabled}
            />
          ))}
        </div>
      </Section>

      <Section title={t.control.schedule}>
        <SchedulePanel
          schedules={schedules}
          loading={loading}
          pumps={pumps}
          valves={valves}
          userId={userId}
          disabled={needsPin}
          onChanged={refresh}
        />
      </Section>

      <Section title={t.control.auditLog}>
        <AuditLog entries={log} loading={loading} />
      </Section>
    </div>
  );
}
