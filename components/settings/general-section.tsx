'use client';

import type { Locale, TemperatureUnit, ThemeMode } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { NumberField, SelectField, TextField, ToggleField, findError, type SettingsSectionProps } from './field';

/** 3.1 — ตั้งค่าทั่วไป */
export function GeneralSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const set = (patch: Partial<typeof draft.general>): void => {
    onChange({ general: { ...draft.general, ...patch } });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <TextField
        label={t.settings.siteName}
        value={draft.general.siteName}
        error={findError(errors, 'general.siteName')}
        onChange={(value) => { set({ siteName: value }); }}
      />
      <TextField
        label={`${t.settings.siteName} (EN)`}
        value={draft.general.siteNameEn}
        onChange={(value) => { set({ siteNameEn: value }); }}
      />
      <TextField
        label={t.settings.timezone}
        value={draft.general.timezone}
        onChange={(value) => { set({ timezone: value }); }}
      />
      <SelectField<Locale>
        label={t.settings.language}
        value={draft.general.defaultLocale}
        options={[
          { value: 'th', label: 'ไทย' },
          { value: 'en', label: 'English' },
        ]}
        onChange={(value) => { set({ defaultLocale: value }); }}
      />
      <SelectField<ThemeMode>
        label={t.settings.theme}
        value={draft.general.defaultTheme}
        options={[
          { value: 'light', label: t.settings.themeLight },
          { value: 'dark', label: t.settings.themeDark },
          { value: 'system', label: t.settings.themeSystem },
        ]}
        onChange={(value) => { set({ defaultTheme: value }); }}
      />
      <SelectField<TemperatureUnit>
        label={t.settings.temperatureUnit}
        value={draft.general.temperatureUnit ?? 'celsius'}
        options={[
          { value: 'celsius', label: '°C' },
          { value: 'fahrenheit', label: '°F' },
        ]}
        onChange={(value) => { set({ temperatureUnit: value }); }}
      />
      <NumberField
        label={t.settings.refreshInterval}
        value={draft.general.refreshIntervalMs}
        step={500}
        min={500}
        unit="ms"
        error={findError(errors, 'general.refreshIntervalMs')}
        onChange={(value) => { set({ refreshIntervalMs: value }); }}
      />
      <div className="sm:col-span-2 xl:col-span-3">
        <ToggleField
          label={t.settings.wallDisplay}
          hint={t.settings.wallDisplayHint}
          checked={draft.general.wallDisplayMode}
          onChange={(checked) => { set({ wallDisplayMode: checked }); }}
        />
      </div>
    </div>
  );
}
