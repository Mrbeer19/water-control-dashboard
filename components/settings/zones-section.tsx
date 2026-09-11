'use client';

import type { ZoneConfig } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { FieldGroup, NumberField, TextField, ToggleField, findError, type SettingsSectionProps } from './field';

/** 3.4 — ตั้งค่าโซนและมิเตอร์ */
export function ZonesSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const zones = draft.zones ?? [];

  const setZone = (zoneId: string, patch: Partial<ZoneConfig>): void => {
    onChange({ zones: zones.map((zone) => (zone.zoneId === zoneId ? { ...zone, ...patch } : zone)) });
  };

  if (zones.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t.settings.noItems}</p>;
  }

  return (
    <div className="space-y-4">
      {zones.map((zone) => (
        <FieldGroup key={zone.zoneId} title={zone.name}>
          <TextField label={t.settings.nameLabel} value={zone.name} onChange={(value) => { setZone(zone.zoneId, { name: value }); }} />
          <NumberField
            label={t.settings.kFactor}
            value={zone.kFactor}
            step={1}
            min={1}
            unit="p/L"
            error={findError(errors, `zones.${zone.zoneId}.kFactor`)}
            onChange={(value) => { setZone(zone.zoneId, { kFactor: value }); }}
          />
          <TextField label={t.settings.boundNode} value={zone.deviceId} onChange={(value) => { setZone(zone.zoneId, { deviceId: value }); }} />
          <TextField label={t.settings.boundValve} value={zone.valveId} onChange={(value) => { setZone(zone.zoneId, { valveId: value }); }} />

          {/* โควตาเป็น null ได้ จึงต้องมีสวิตช์แยกก่อน ไม่ใช่ใช้ 0 แทน "ไม่จำกัด" */}
          <div className="sm:col-span-2 xl:col-span-1">
            <ToggleField
              label={t.settings.unlimited}
              checked={zone.monthlyQuotaCubicMeters === null}
              onChange={(checked) => { setZone(zone.zoneId, { monthlyQuotaCubicMeters: checked ? null : 100 }); }}
            />
          </div>
          {zone.monthlyQuotaCubicMeters !== null && (
            <NumberField
              label={t.settings.monthlyQuota}
              value={zone.monthlyQuotaCubicMeters}
              step={10}
              min={0}
              unit="m³"
              error={findError(errors, `zones.${zone.zoneId}.monthlyQuotaCubicMeters`)}
              onChange={(value) => { setZone(zone.zoneId, { monthlyQuotaCubicMeters: value }); }}
            />
          )}
        </FieldGroup>
      ))}
    </div>
  );
}
