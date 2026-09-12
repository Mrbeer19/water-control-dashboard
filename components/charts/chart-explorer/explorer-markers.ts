/**
 * รวบรวมเหตุการณ์ที่ควรปักบนแกนเวลาของกราฟ
 *
 * ★ จุดประสงค์: ให้คนดูรู้ว่ากราฟกระโดดเพราะ "มีคนสั่งงาน" หรือ "ผิดปกติจริง"
 * ★ ทุกอย่างดึงผ่าน service layer เท่านั้น ห้ามแตะ lib/mock/ ตรง ๆ
 * ★ ช่วง offline มาจาก state-spans ไม่ได้เดาจากช่องว่างในกราฟ
 *   (ช่องว่างอาจแปลว่ายังไม่ถึงรอบส่งข้อมูล ไม่ใช่เซนเซอร์หลุดเสมอไป)
 */
import type { Locale } from '@/lib/types';
import { NO_DATA_STATE } from '@/lib/types';
import { getAlerts, getAnomalies, getCommandLog, getStateSpans } from '@/lib/services';
import { getAnomalyTypeConfig } from '@/lib/config/anomaly-types';
import type { EventMarker, MetricSourceRef } from './explorer-types';

export interface MarkerBundle {
  markers: EventMarker[];
  /** เวลาที่เซนเซอร์เริ่มหลุดจนถึงตอนนี้ — null เมื่อไม่ได้หลุดค้างอยู่ */
  offlineSince: number | null;
}

const ms = (iso: string | null | undefined): number | null => {
  if (iso === null || iso === undefined) return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
};

export async function loadMarkers(
  ref: MetricSourceRef,
  from: number,
  to: number,
  locale: Locale,
): Promise<MarkerBundle> {
  const range = { preset: 'custom' as const, from: new Date(from).toISOString(), to: new Date(to).toISOString() };

  const [alerts, anomalies, commands, spans] = await Promise.all([
    getAlerts({ sourceIds: [ref.sourceId], range, limit: 100 }),
    getAnomalies({ range, limit: 100 }),
    getCommandLog(200),
    getStateSpans({ sourceId: ref.sourceId, from, to }),
  ]);

  const markers: EventMarker[] = [];

  for (const alert of alerts.items) {
    const at = ms(alert.raisedAt);
    if (at === null) continue;
    markers.push({
      id: `alert:${alert.id}`,
      kind: 'alert',
      at,
      until: ms(alert.resolvedAt),
      label: locale === 'th' ? alert.messageTh : alert.messageEn,
      detail: alert.unit === null || alert.triggerValue === null ? null : `${alert.triggerValue} ${alert.unit}`,
      severity: alert.severity,
    });
  }

  for (const anomaly of anomalies.items) {
    if (anomaly.sourceId !== undefined && anomaly.sourceId !== ref.sourceId) continue;
    const at = ms(anomaly.detectedAt);
    if (at === null) continue;
    const config = getAnomalyTypeConfig(anomaly.type);
    const summary = locale === 'th' ? anomaly.summaryTh : anomaly.summaryEn;
    markers.push({
      id: `anomaly:${anomaly.id}`,
      kind: 'anomaly',
      at,
      until: ms(anomaly.windowEnd),
      label: locale === 'th' ? config.labelTh : config.labelEn,
      detail: summary ?? null,
      severity: anomaly.severity ?? null,
    });
  }

  for (const entry of commands) {
    if (entry.command.targetId !== ref.sourceId) continue;
    const at = ms(entry.command.issuedAt);
    if (at === null || at < from || at > to) continue;
    markers.push({
      id: `command:${entry.command.id}`,
      kind: 'command',
      at,
      until: null,
      label: `${entry.command.targetName} · ${entry.command.action}`,
      detail: entry.command.reason,
      severity: null,
    });
  }

  let offlineSince: number | null = null;
  for (const span of spans) {
    if (span.state !== NO_DATA_STATE) continue;
    markers.push({
      id: `offline:${span.from}`,
      kind: 'offline',
      at: span.from,
      until: span.to,
      label: '',
      detail: null,
      severity: null,
    });
    // span ที่ยังไม่ปิด (to === null) แปลว่ายังหลุดอยู่จนถึงตอนนี้
    if (span.to === null || span.to >= to) offlineSince = span.from;
  }

  markers.sort((a, b) => a.at - b.at);
  return { markers, offlineSince };
}
