/** สร้างและจัดการ alert ใน mock state */

import type {
  Alert,
  AlertAcknowledgement,
  AlertCode,
  AlertSeverity,
  AlertSourceType,
  NotificationChannel,
  NotificationDelivery,
} from '@/lib/types';
import type { MockState } from './store';
import { nowIso } from './store';
import { toActorRef } from './organization';
import { randomInt } from './random';

let alertCounter = 0;
let deliveryCounter = 0;
let ackCounter = 0;

export interface RaiseAlertInput {
  severity: AlertSeverity;
  code: AlertCode;
  sourceType: AlertSourceType;
  sourceId: string;
  sourceName: string;
  /** แผนกที่ควรได้รับเรื่องนี้ — ไม่ระบุ = เหตุการณ์ระดับระบบ */
  departmentId?: string | null;
  messageTh: string;
  messageEn: string;
  triggerValue?: number | null;
  thresholdValue?: number | null;
  unit?: string | null;
  at?: number;
}

/**
 * เพิ่ม alert ใหม่ลง state
 * ถ้ามี alert code เดิมจากต้นทางเดิมที่ยัง active อยู่ จะนับ occurrence เพิ่มแทนการสร้างใหม่
 * (พฤติกรรมเดียวกับ deduplicationWindowMinutes ใน NotificationSettings)
 */
export function raiseAlert(state: MockState, input: RaiseAlertInput): Alert {
  const at = input.at ?? Date.now();
  const iso = nowIso(at);

  const existing = state.alerts.find(
    (alert) => alert.code === input.code && alert.sourceId === input.sourceId && alert.state !== 'resolved',
  );
  if (existing !== undefined) {
    existing.occurrenceCount += 1;
    existing.updatedAt = iso;
    existing.triggerValue = input.triggerValue ?? existing.triggerValue;
    return existing;
  }

  alertCounter += 1;
  const alert: Alert = {
    id: `alert-${alertCounter}`,
    name: input.messageTh,
    createdAt: iso,
    updatedAt: iso,
    severity: input.severity,
    state: 'active',
    code: input.code,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    departmentId: input.departmentId ?? null,
    messageTh: input.messageTh,
    messageEn: input.messageEn,
    triggerValue: input.triggerValue ?? null,
    thresholdValue: input.thresholdValue ?? null,
    unit: input.unit ?? null,
    raisedAt: iso,
    resolvedAt: null,
    read: false,
    acknowledgementId: null,
    anomalyEventId: null,
    occurrenceCount: 1,
  };
  state.alerts.unshift(alert);

  // ส่งแจ้งเตือนตามช่องทางที่เปิดไว้ ถ้าถึงระดับความรุนแรงขั้นต่ำ
  const { notifications } = state.settings;
  const severityRank: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
  if (severityRank[input.severity] >= severityRank[notifications.minimumSeverity]) {
    for (const channel of notifications.enabledChannels) {
      state.deliveries.unshift(createDelivery(alert.id, channel, at, state));
    }
  }

  return alert;
}

function createDelivery(
  alertId: string,
  channel: NotificationChannel,
  at: number,
  state: MockState,
): NotificationDelivery {
  deliveryCounter += 1;
  const recipients = state.settings.notifications.recipients[channel];
  const recipient = recipients[0] ?? '-';
  // buzzer ในตู้คอนโทรลถึงผู้รับทันที ช่องทางอื่นมีดีเลย์เล็กน้อย
  const delivered = channel === 'buzzer' || randomInt(0, 9) > 1;
  return {
    id: `delivery-${deliveryCounter}`,
    name: `${channel} → ${recipient}`,
    createdAt: nowIso(at),
    updatedAt: nowIso(at),
    alertId,
    channel,
    deliveryState: delivered ? 'delivered' : 'failed',
    recipient,
    attempts: delivered ? 1 : 3,
    lastAttemptAt: nowIso(at),
    deliveredAt: delivered ? nowIso(at + 1_200) : null,
    errorMessage: delivered ? null : 'ไม่สามารถติดต่อปลายทางได้ภายในเวลาที่กำหนด',
  };
}

/** ปิด alert ที่เงื่อนไขหายไปแล้ว */
export function resolveAlerts(state: MockState, code: AlertCode, sourceId: string, at: number = Date.now()): void {
  for (const alert of state.alerts) {
    if (alert.code === code && alert.sourceId === sourceId && alert.state !== 'resolved') {
      alert.state = 'resolved';
      alert.resolvedAt = nowIso(at);
      alert.updatedAt = nowIso(at);
    }
  }
}

export function acknowledgeAlert(
  state: MockState,
  alertId: string,
  acknowledgedByUserId: string,
  note: string | null,
  snoozeMinutes: number | null,
): AlertAcknowledgement | null {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (alert === undefined) return null;

  ackCounter += 1;
  const iso = nowIso();
  const ack: AlertAcknowledgement = {
    id: `ack-${ackCounter}`,
    name: `รับทราบ ${alert.code}`,
    createdAt: iso,
    updatedAt: iso,
    alertId,
    acknowledgedBy: toActorRef(acknowledgedByUserId),
    acknowledgedAt: iso,
    note,
    snoozeMinutes,
  };
  state.acknowledgements.unshift(ack);

  alert.state = 'acknowledged';
  alert.acknowledgementId = ack.id;
  alert.read = true;
  alert.updatedAt = iso;
  return ack;
}

/** alert ตั้งต้นตอนเปิดระบบ — เหตุการณ์ที่ค้างอยู่จากกะก่อนหน้า */
export function seedAlerts(state: MockState): void {
  const now = Date.now();
  const minute = 60_000;

  raiseAlert(state, {
    severity: 'warning',
    code: 'DEVICE_WEAK_SIGNAL',
    sourceType: 'device',
    sourceId: 'esp32-meter-5',
    sourceName: 'ESP32 มิเตอร์โซน 5',
    departmentId: 'dept-hr',
    messageTh: 'สัญญาณ Wi-Fi อ่อนที่หอพักพนักงาน — หลุดบ่อยผิดปกติ',
    messageEn: 'Weak Wi-Fi at staff dormitory — frequent reconnects',
    triggerValue: -81,
    thresholdValue: -75,
    unit: 'dBm',
    at: now - 96 * minute,
  });

  raiseAlert(state, {
    severity: 'warning',
    code: 'UNACCOUNTED_WATER_HIGH',
    sourceType: 'system',
    sourceId: 'system',
    sourceName: 'ระบบจ่ายน้ำ',
    messageTh: 'น้ำสูญหายเกินเกณฑ์ — มิเตอร์หลักสูงกว่าผลรวม 8 โซน',
    messageEn: 'Unaccounted water above threshold — main meter exceeds zone total',
    triggerValue: 9.4,
    thresholdValue: 8,
    unit: '%',
    at: now - 41 * minute,
  });

  raiseAlert(state, {
    severity: 'info',
    code: 'PUMP_ALTERNATION',
    sourceType: 'pump',
    sourceId: 'pump-2',
    sourceName: 'ปั๊มหลัก 2',
    messageTh: 'สลับปั๊มหลักตามรอบอัตโนมัติ (ทุก 12 ชั่วโมง)',
    messageEn: 'Automatic main pump alternation (every 12 hours)',
    at: now - 28 * minute,
  });

  raiseAlert(state, {
    severity: 'critical',
    code: 'ENV_TEMP_HIGH',
    sourceType: 'sensor',
    sourceId: 'env-control-cabinet',
    sourceName: 'เซนเซอร์ตู้คอนโทรล',
    messageTh: 'อุณหภูมิในตู้คอนโทรลสูงเกินเกณฑ์วิกฤต — ตรวจสอบพัดลมระบายอากาศ',
    messageEn: 'Control cabinet temperature above critical threshold — check exhaust fan',
    triggerValue: 45.6,
    thresholdValue: 45,
    unit: '°C',
    at: now - 12 * minute,
  });

  // เหตุการณ์เก่าที่ปิดไปแล้ว ใช้ทดสอบตัวกรองสถานะในหน้า Alerts
  const resolved = raiseAlert(state, {
    severity: 'warning',
    code: 'TANK_LEVEL_LOW',
    sourceType: 'tank',
    sourceId: 'tank-2',
    sourceName: 'ถังจ่ายน้ำ',
    departmentId: 'dept-facility',
    messageTh: 'ระดับน้ำถังจ่ายต่ำกว่าเกณฑ์เตือน',
    messageEn: 'Service tank level below warning threshold',
    triggerValue: 31.2,
    thresholdValue: 35,
    unit: '%',
    at: now - 213 * minute,
  });
  resolved.state = 'resolved';
  resolved.resolvedAt = nowIso(now - 197 * minute);
  resolved.read = true;

  acknowledgeAlert(state, 'alert-1', 'user-somchai', 'แจ้งทีมเน็ตเวิร์กย้าย AP แล้ว', 120);
}
