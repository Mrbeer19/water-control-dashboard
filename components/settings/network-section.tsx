'use client';

import { useState } from 'react';
import { Plug } from 'lucide-react';
import { testNetworkSettings } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NumberField, TextField, findError, type SettingsSectionProps } from './field';

/** 3.8 — การเชื่อมต่อ (UI เท่านั้น ไม่ได้ต่อจริง) */
export function NetworkSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t } = useLocale();
  const [result, setResult] = useState<{ mqtt: boolean; plc: boolean; latencyMs: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const network = draft.network;

  const set = (patch: Partial<typeof network>): void => {
    onChange({ network: { ...network, ...patch } });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <TextField
          label={t.settings.mqttHost}
          value={network.mqttHost}
          error={findError(errors, 'network.mqttHost')}
          onChange={(value) => { set({ mqttHost: value }); }}
        />
        <NumberField
          label={t.settings.mqttPort}
          value={network.mqttPort}
          min={1}
          max={65535}
          error={findError(errors, 'network.mqttPort')}
          onChange={(value) => { set({ mqttPort: value }); }}
        />
        <TextField label="MQTT base topic" value={network.mqttBaseTopic} onChange={(value) => { set({ mqttBaseTopic: value }); }} />

        <TextField label={t.settings.plcHost} value={network.plcHost} onChange={(value) => { set({ plcHost: value }); }} />
        <NumberField
          label={t.settings.plcPort}
          value={network.plcPort}
          min={1}
          max={65535}
          error={findError(errors, 'network.plcPort')}
          onChange={(value) => { set({ plcPort: value }); }}
        />
        <TextField
          label="PLC ส่วนขยาย (FX3G)"
          value={network.secondaryPlcHost ?? ''}
          hint={t.settings.none}
          onChange={(value) => { set({ secondaryPlcHost: value === '' ? null : value }); }}
        />

        <TextField
          label={t.settings.dbHost}
          value={network.databaseHost ?? network.gatewayHost}
          onChange={(value) => { set({ databaseHost: value }); }}
        />
        <NumberField
          label={t.settings.dbPort}
          value={network.databasePort ?? 5432}
          min={1}
          max={65535}
          onChange={(value) => { set({ databasePort: value }); }}
        />
        <TextField label="Gateway host" value={network.gatewayHost} onChange={(value) => { set({ gatewayHost: value }); }} />

        <TextField
          label={t.settings.ntp}
          value={network.ntpServer}
          hint={t.settings.ntpHint}
          onChange={(value) => { set({ ntpServer: value }); }}
        />
        <NumberField
          label="Poll interval"
          value={network.pollIntervalMs}
          step={500}
          min={500}
          unit="ms"
          onChange={(value) => { set({ pollIntervalMs: value }); }}
        />
        <NumberField
          label="Device timeout"
          value={network.deviceTimeoutSeconds}
          min={1}
          unit={t.settings.seconds}
          onChange={(value) => { set({ deviceTimeoutSeconds: value }); }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void testNetworkSettings()
              .then(setResult)
              .finally(() => { setBusy(false); });
          }}
        >
          <Plug className="h-3.5 w-3.5" aria-hidden />
          {t.settings.testConnection}
        </Button>
        {result !== null && (
          <p className="text-xs">
            <span className={cn(result.mqtt ? 'text-status-ok' : 'text-status-critical')}>MQTT {result.mqtt ? 'OK' : 'FAIL'}</span>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className={cn(result.plc ? 'text-status-ok' : 'text-status-critical')}>PLC {result.plc ? 'OK' : 'FAIL'}</span>
            <span className="tabular ml-2 text-muted-foreground">{result.latencyMs} ms</span>
          </p>
        )}
      </div>
    </div>
  );
}
