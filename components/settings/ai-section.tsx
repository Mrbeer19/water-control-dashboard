'use client';

import { useLocale } from '@/lib/i18n';
import { formatRatio } from '@/lib/utils';
import { NumberField, TextField, ToggleField, findError, type SettingsSectionProps } from './field';

/** 3.7 — ตั้งค่าบริการ AI */
export function AiSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t, locale } = useLocale();
  const ai = draft.ai;
  const set = (patch: Partial<typeof ai>): void => {
    onChange({ ai: { ...ai, ...patch } });
  };

  const sensitivityError = findError(errors, 'ai.anomalySensitivity');

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4">
        <ToggleField
          label={t.settings.anomalyEnabled}
          checked={ai.anomalyDetectionEnabled}
          onChange={(checked) => { set({ anomalyDetectionEnabled: checked }); }}
        />
        <ToggleField
          label={t.settings.forecastEnabled}
          checked={ai.forecastEnabled}
          onChange={(checked) => { set({ forecastEnabled: checked }); }}
        />
        <ToggleField
          label={t.ai.detector + ' rule'}
          hint="ใช้กฎเกณฑ์ตายตัวควบคู่กับโมเดล"
          checked={ai.ruleBasedDetectionEnabled}
          onChange={(checked) => { set({ ruleBasedDetectionEnabled: checked }); }}
        />
      </div>

      {/* ความไวเป็น 0–1 ตามสัญญา แปลงเป็น % ที่ชั้นแสดงผลเท่านั้น */}
      <div className="rounded-lg border p-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor="sensitivity" className="text-xs font-medium">{t.settings.sensitivity}</label>
          <span className="tabular text-sm font-semibold">{formatRatio(ai.anomalySensitivity, locale)}</span>
        </div>
        <input
          id="sensitivity"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={ai.anomalySensitivity}
          onChange={(event) => { set({ anomalySensitivity: Number(event.target.value) }); }}
          className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-control-checked"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">{t.settings.sensitivityHint}</p>
        {sensitivityError !== undefined && (
          <p className="mt-1 text-[11px] text-status-critical">
            {locale === 'th' ? sensitivityError.messageTh : sensitivityError.messageEn}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <NumberField
          label={t.settings.forecastHorizon}
          value={ai.forecastHorizonHours}
          min={1}
          unit={t.settings.hours}
          onChange={(value) => { set({ forecastHorizonHours: value }); }}
        />
        <TextField
          label={`${t.settings.nightFlowWindow} — ${t.settings.quietFrom}`}
          value={ai.nightFlowStartTime ?? '23:00'}
          hint="รูปแบบ HH:mm"
          onChange={(value) => { set({ nightFlowStartTime: value }); }}
        />
        <TextField
          label={`${t.settings.nightFlowWindow} — ${t.settings.quietTo}`}
          value={ai.nightFlowEndTime ?? '05:00'}
          hint="รูปแบบ HH:mm"
          onChange={(value) => { set({ nightFlowEndTime: value }); }}
        />
        <TextField
          label={`${t.ai.model} — ${t.ai.anomalies}`}
          value={ai.anomalyModelName}
          onChange={(value) => { set({ anomalyModelName: value }); }}
        />
        <TextField
          label={`${t.ai.model} — ${t.ai.forecasts}`}
          value={ai.forecastModelName}
          onChange={(value) => { set({ forecastModelName: value }); }}
        />
        <NumberField
          label="Retrain"
          value={ai.retrainIntervalHours}
          min={1}
          unit={t.settings.hours}
          onChange={(value) => { set({ retrainIntervalHours: value }); }}
        />
      </div>
    </div>
  );
}
