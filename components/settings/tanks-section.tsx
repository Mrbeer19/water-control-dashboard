'use client';

import type { TankConfig } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { FieldGroup, NumberField, TextField, findError, type SettingsSectionProps } from './field';

/** 3.2 — ตั้งค่าถังน้ำรายใบ */
export function TanksSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const tanks = draft.tanks ?? [];

  const setTank = (tankId: string, patch: Partial<TankConfig>): void => {
    onChange({ tanks: tanks.map((tank) => (tank.tankId === tankId ? { ...tank, ...patch } : tank)) });
  };

  const setThreshold = (tankId: string, key: keyof TankConfig['thresholdsPercent'], value: number): void => {
    const tank = tanks.find((item) => item.tankId === tankId);
    if (tank === undefined) return;
    setTank(tankId, { thresholdsPercent: { ...tank.thresholdsPercent, [key]: value } });
  };

  if (tanks.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t.settings.noItems}</p>;
  }

  return (
    <div className="space-y-4">
      {tanks.map((tank) => (
        <FieldGroup key={tank.tankId} title={tank.name}>
          <TextField label={t.settings.nameLabel} value={tank.name} onChange={(value) => { setTank(tank.tankId, { name: value }); }} />
          <NumberField
            label={t.settings.capacity}
            value={tank.capacityLiters}
            step={100}
            min={1}
            unit="L"
            error={findError(errors, `tanks.${tank.tankId}.capacityLiters`)}
            onChange={(value) => { setTank(tank.tankId, { capacityLiters: value }); }}
          />
          <NumberField
            label={t.settings.sensorOffset}
            value={tank.sensorOffsetMeters}
            step={0.01}
            unit="m"
            onChange={(value) => { setTank(tank.tankId, { sensorOffsetMeters: value }); }}
          />
          <NumberField
            label={t.settings.sensorScale}
            value={tank.sensorScale}
            step={0.01}
            min={0.01}
            error={findError(errors, `tanks.${tank.tankId}.sensorScale`)}
            onChange={(value) => { setTank(tank.tankId, { sensorScale: value }); }}
          />
          <NumberField
            label={t.settings.thresholdCriticalLow}
            value={tank.thresholdsPercent.criticalLow ?? 0}
            unit="%"
            min={0}
            max={100}
            onChange={(value) => { setThreshold(tank.tankId, 'criticalLow', value); }}
          />
          <NumberField
            label={t.settings.thresholdWarningLow}
            value={tank.thresholdsPercent.warningLow ?? 0}
            unit="%"
            min={0}
            max={100}
            onChange={(value) => { setThreshold(tank.tankId, 'warningLow', value); }}
          />
          <NumberField
            label={t.settings.thresholdWarningHigh}
            value={tank.thresholdsPercent.warningHigh ?? 0}
            unit="%"
            min={0}
            max={100}
            onChange={(value) => { setThreshold(tank.tankId, 'warningHigh', value); }}
          />
          <NumberField
            label={t.settings.autoStart}
            value={tank.pumpAutoStartPercent}
            unit="%"
            min={0}
            max={100}
            onChange={(value) => { setTank(tank.tankId, { pumpAutoStartPercent: value }); }}
          />
          <NumberField
            label={t.settings.autoStop}
            value={tank.pumpAutoStopPercent}
            unit="%"
            min={0}
            max={100}
            error={findError(errors, `tanks.${tank.tankId}.pumpAutoStopPercent`)}
            onChange={(value) => { setTank(tank.tankId, { pumpAutoStopPercent: value }); }}
          />
        </FieldGroup>
      ))}
    </div>
  );
}
