'use client';

import type { PumpConfig } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { FieldGroup, NumberField, SelectField, TextField, findError, type SettingsSectionProps } from './field';

/** 3.3 — ตั้งค่าปั๊มรายตัว */
export function PumpsSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const pumps = draft.pumps ?? [];
  const tanks = draft.tanks ?? [];

  const setPump = (pumpId: string, patch: Partial<PumpConfig>): void => {
    onChange({ pumps: pumps.map((pump) => (pump.pumpId === pumpId ? { ...pump, ...patch } : pump)) });
  };

  const tankOptions = tanks.map((tank) => ({ value: tank.tankId, label: tank.name }));

  if (pumps.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t.settings.noItems}</p>;
  }

  return (
    <div className="space-y-4">
      {pumps.map((pump) => (
        <FieldGroup key={pump.pumpId} title={pump.name}>
          <TextField label={t.settings.nameLabel} value={pump.name} onChange={(value) => { setPump(pump.pumpId, { name: value }); }} />
          <NumberField
            label={t.settings.nameplateKw}
            value={pump.nameplateKw}
            step={0.1}
            min={0.1}
            unit="kW"
            error={findError(errors, `pumps.${pump.pumpId}.nameplateKw`)}
            onChange={(value) => { setPump(pump.pumpId, { nameplateKw: value }); }}
          />
          <NumberField
            label={t.settings.overcurrent}
            value={pump.overcurrentAmp}
            step={0.1}
            min={0.1}
            unit="A"
            error={findError(errors, `pumps.${pump.pumpId}.overcurrentAmp`)}
            onChange={(value) => { setPump(pump.pumpId, { overcurrentAmp: value }); }}
          />
          <NumberField
            label={t.settings.maxRun}
            value={pump.maxRunMinutes}
            step={5}
            min={0}
            unit={t.settings.minutes}
            hint="0 = ไม่จำกัด"
            error={findError(errors, `pumps.${pump.pumpId}.maxRunMinutes`)}
            onChange={(value) => { setPump(pump.pumpId, { maxRunMinutes: value }); }}
          />
          <SelectField
            label={t.settings.sourceTank}
            value={pump.sourceTankId}
            options={tankOptions}
            onChange={(value) => { setPump(pump.pumpId, { sourceTankId: value }); }}
          />
          <SelectField
            label={t.settings.destinationTank}
            value={pump.destinationTankId ?? ''}
            options={[{ value: '', label: t.settings.none }, ...tankOptions]}
            onChange={(value) => { setPump(pump.pumpId, { destinationTankId: value === '' ? null : value }); }}
          />
        </FieldGroup>
      ))}
    </div>
  );
}
