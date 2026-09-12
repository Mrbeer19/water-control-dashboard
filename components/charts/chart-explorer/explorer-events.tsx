'use client';

/**
 * รายการเหตุการณ์ที่ปักไว้บนแกนเวลา — กดดูรายละเอียดได้
 * ★ ช่วยตอบว่า "กราฟกระโดดเพราะมีคนสั่งงาน หรือเพราะผิดปกติจริง"
 * ★ สถานะต้องมีไอคอน + ข้อความเสมอ ห้ามสื่อด้วยสีอย่างเดียว (BRANDING_SPEC ข้อ 3.4)
 */
import { AlertTriangle, Hand, Sparkles, WifiOff } from 'lucide-react';
import { useLocale } from '@/lib/i18n';
import { CHART } from '../chart-tokens';
import { eventTimeLabel } from './explorer-labels';
import type { EventMarker, EventMarkerKind } from './explorer-types';

const ICON: Record<EventMarkerKind, typeof AlertTriangle> = {
  alert: AlertTriangle,
  anomaly: Sparkles,
  command: Hand,
  offline: WifiOff,
};

const COLOR: Record<EventMarkerKind, string> = {
  alert: CHART.critical,
  anomaly: CHART.warning,
  command: CHART.info,
  offline: CHART.offline,
};

interface ExplorerEventsProps {
  markers: EventMarker[];
  timeZone: string;
}

export function ExplorerEvents({ markers, timeZone }: ExplorerEventsProps): JSX.Element {
  const { t, locale } = useLocale();

  const kindLabel: Record<EventMarkerKind, string> = {
    alert: t.chart.eventAlert,
    anomaly: t.chart.eventAnomaly,
    command: t.chart.eventCommand,
    offline: t.chart.eventOffline,
  };

  if (markers.length === 0) {
    return <p className="text-xs text-muted-foreground">{t.chart.noEvents}</p>;
  }

  return (
    <ul className="max-h-40 space-y-1 overflow-auto rounded-control border p-2">
      {markers.map((marker) => {
        const Icon = ICON[marker.kind];
        return (
          <li key={marker.id} className="flex items-start gap-2 text-xs">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: COLOR[marker.kind] }} aria-hidden />
            <span className="min-w-0">
              <span className="text-muted-foreground">{eventTimeLabel(marker.at, timeZone, locale)}</span>{' '}
              <span className="font-medium">{kindLabel[marker.kind]}</span>
              {marker.label !== '' && <span> — {marker.label}</span>}
              {marker.until !== null && (
                <span className="text-muted-foreground">
                  {' '}
                  → {eventTimeLabel(marker.until, timeZone, locale)}
                </span>
              )}
              {marker.detail !== null && <span className="block text-muted-foreground">{marker.detail}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
