'use client';

import type { EnvironmentConfig, ThresholdRange } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { FieldGroup, NumberField, TextField, findError, type SettingsSectionProps } from './field';

/** 3.11 — ตั้งค่าเซนเซอร์สภาพแวดล้อมรายจุด */
export function EnvironmentSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const sensors = draft.environment ?? [];

  const setSensor = (sensorId: string, patch: Partial<EnvironmentConfig>): void => {
    onChange({ environment: sensors.map((s) => (s.sensorId === sensorId ? { ...s, ...patch } : s)) });
  };

  const setThreshold = (
    sensorId: string,
    field: 'temperatureThresholds' | 'humidityThresholds',
    key: keyof ThresholdRange,
    value: number,
  ): void => {
    const sensor = sensors.find((item) => item.sensorId === sensorId);
    if (sensor === undefined) return;
    setSensor(sensorId, { [field]: { ...sensor[field], [key]: value } } as Partial<EnvironmentConfig>);
  };

  if (sensors.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t.settings.noItems}</p>;
  }

  return (
    <div className="space-y-4">
      {sensors.map((sensor) => (
        <FieldGroup key={sensor.sensorId} title={sensor.locationLabel}>
          <TextField
            label={t.device.location}
            value={sensor.locationLabel}
            error={findError(errors, `environment.${sensor.sensorId}.locationLabel`)}
            onChange={(value) => { setSensor(sensor.sensorId, { locationLabel: value }); }}
          />
          <NumberField
            label={t.settings.tempOffset}
            value={sensor.temperatureOffsetCelsius}
            step={0.1}
            unit="°C"
            onChange={(value) => { setSensor(sensor.sensorId, { temperatureOffsetCelsius: value }); }}
          />
          <NumberField
            label={t.settings.humidityOffset}
            value={sensor.humidityOffsetPercent}
            step={0.5}
            unit="%RH"
            onChange={(value) => { setSensor(sensor.sensorId, { humidityOffsetPercent: value }); }}
          />
          <NumberField
            label={`${t.env.temperature} — ${t.settings.thresholdWarningHigh}`}
            value={sensor.temperatureThresholds.warningHigh ?? 0}
            unit="°C"
            onChange={(value) => { setThreshold(sensor.sensorId, 'temperatureThresholds', 'warningHigh', value); }}
          />
          <NumberField
            label={`${t.env.temperature} — ${t.settings.thresholdCriticalHigh}`}
            value={sensor.temperatureThresholds.criticalHigh ?? 0}
            unit="°C"
            onChange={(value) => { setThreshold(sensor.sensorId, 'temperatureThresholds', 'criticalHigh', value); }}
          />
          <NumberField
            label={`${t.env.humidity} — ${t.settings.thresholdWarningHigh}`}
            value={sensor.humidityThresholds.warningHigh ?? 0}
            unit="%"
            onChange={(value) => { setThreshold(sensor.sensorId, 'humidityThresholds', 'warningHigh', value); }}
          />
          {/* จุดที่ไม่มี rain gauge ไม่ต้องแสดงช่องนี้ ไม่ใช่แสดงแล้วปล่อยว่าง */}
          {sensor.rainGaugeMmPerTip !== null && (
            <NumberField
              label={t.settings.mmPerTip}
              value={sensor.rainGaugeMmPerTip}
              step={0.1}
              min={0.01}
              unit="mm"
              error={findError(errors, `environment.${sensor.sensorId}.rainGaugeMmPerTip`)}
              onChange={(value) => { setSensor(sensor.sensorId, { rainGaugeMmPerTip: value }); }}
            />
          )}
        </FieldGroup>
      ))}
    </div>
  );
}
