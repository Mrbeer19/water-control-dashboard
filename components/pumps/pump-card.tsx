'use client';

import { Gauge, Power, Wrench } from 'lucide-react';
import type { EntityStatus, Pump, PumpRunState, TimeSeriesPoint } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getPumpHistory } from '@/lib/services';
import {
  cn,
  formatCurrent,
  formatEnergy,
  formatFlow,
  formatNumber,
  formatPower,
  formatPressure,
  formatVoltage,
} from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sparkline } from '@/components/charts/sparkline';
import { CHART } from '@/components/charts/chart-tokens';

/** สถานะการเดินของปั๊ม → สีสถานะกลางของระบบ */
const RUN_STATE_TONE: Record<PumpRunState, EntityStatus> = {
  running: 'ok',
  starting: 'ok',
  stopping: 'warning',
  stopped: 'offline',
  fault: 'critical',
};

export function PumpCard({ pump }: { pump: Pump }): JSX.Element {
  const { t, locale } = useLocale();
  const { data: history } = useLiveData<TimeSeriesPoint[]>(() => getPumpHistory(pump.id, 'power_watt'), [pump.id]);

  const tone = pump.controlMode === 'locked_out' ? 'offline' : RUN_STATE_TONE[pump.runState];
  const runLabel = {
    running: t.pump.run,
    stopped: t.pump.stop,
    fault: t.pump.fault,
    starting: t.pump.starting,
    stopping: t.pump.stopping,
  }[pump.runState];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{locale === 'th' ? pump.name : pump.nameEn}</p>
            <p className="text-xs text-muted-foreground">
              {t.pump.mode}: {pump.controlMode.toUpperCase()}
              {pump.hasVfd && ' · VFD'}
            </p>
          </div>
          <StatusBadge status={tone} label={runLabel} />
        </div>

        {/* กำลังไฟเป็นตัวเลขหลัก — บอกได้ทันทีว่าปั๊มออกแรงแค่ไหน */}
        <div className="flex items-end justify-between gap-3">
          <p className={cn('tabular text-metric leading-none', pump.runState === 'fault' && 'text-status-critical')}>
            {formatPower(pump.electrical.powerWatt, locale)}
          </p>
          <div className="min-w-[92px] flex-1">
            <Sparkline
              points={history ?? []}
              color={tone === 'critical' ? CHART.critical : CHART.water}
              height={38}
              label={`${t.pump.energy24h} ${pump.nameEn}`}
            />
            <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{t.pump.energy24h}</p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-x-2 gap-y-2 border-t pt-3 text-xs">
          <Field label={t.pump.voltage} value={formatVoltage(pump.electrical.voltage, locale)} />
          <Field label={t.pump.current} value={formatCurrent(pump.electrical.current, locale)} />
          <Field label={t.pump.flow} value={formatFlow(pump.flowLpm, locale, 0)} />
          <Field label={t.pump.energy} value={formatEnergy(pump.electrical.energyKwh, locale, 0)} />
          <Field label={t.pump.runtime} value={`${formatNumber(pump.runtimeHours, locale, 0)} h`} />
          <Field label={t.pump.startsToday} value={formatNumber(pump.startsToday, locale)} />
        </dl>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Gauge className="h-3 w-3" aria-hidden />
            {t.pump.pressure} {formatPressure(pump.dischargePressureBar, locale)}
          </span>
          {pump.hasVfd && pump.vfdFrequencyHz !== null && (
            <span className="inline-flex items-center gap-1">
              <Power className="h-3 w-3" aria-hidden />
              {formatNumber(pump.vfdFrequencyHz, locale, 1)} Hz
            </span>
          )}
          <span
            className={cn('inline-flex items-center gap-1', pump.hoursUntilService < 50 && 'text-status-warning')}
          >
            <Wrench className="h-3 w-3" aria-hidden />
            {t.pump.serviceDue} {formatNumber(pump.hoursUntilService, locale, 0)} h
          </span>
        </div>

        {pump.faultCode !== null && (
          <p className="rounded-control bg-status-critical px-2 py-1.5 text-xs text-status-critical-foreground">
            {pump.faultCode} — {pump.faultMessage}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className="tabular truncate font-medium">{value}</dd>
    </div>
  );
}
