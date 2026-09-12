/** Service: การแจ้งเตือนและการส่งต่อ */

import type {
  Alert,
  AlertAcknowledgement,
  AlertQuery,
  NotificationChannel,
  NotificationDelivery,
  NotificationPreview,
  Paginated,
  RecoveryEvent,
} from '@/lib/types';
import { acknowledgeAlert as acknowledgeInStore } from '@/lib/mock';
import { mutate, respond } from './internal';
import { formatDateTimeTH } from '@/lib/utils';

/**
 * รายการ alert พร้อมตัวกรองและแบ่งหน้า
 * TODO(backend): GET /api/alerts?severity=&state=&sourceType=&unreadOnly=&from=&to=&limit=&offset=
 */
export async function getAlerts(query: AlertQuery = {}): Promise<Paginated<Alert>> {
  return respond((state) => {
    const filtered = state.alerts.filter((alert) => {
      if (query.severities !== undefined && !query.severities.includes(alert.severity)) return false;
      if (query.states !== undefined && !query.states.includes(alert.state)) return false;
      if (query.sourceTypes !== undefined && !query.sourceTypes.includes(alert.sourceType)) return false;
      if (query.codes !== undefined && !query.codes.includes(alert.code)) return false;
      if (
        query.departmentIds !== undefined &&
        (alert.departmentId === null || !query.departmentIds.includes(alert.departmentId))
      ) {
        return false;
      }
      if (query.sourceIds !== undefined && !query.sourceIds.includes(alert.sourceId)) return false;
      if (query.unreadOnly === true && alert.read) return false;
      if (query.range !== undefined) {
        const raised = new Date(alert.raisedAt).getTime();
        if (raised < new Date(query.range.from).getTime() || raised > new Date(query.range.to).getTime()) return false;
      }
      return true;
    });

    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  });
}

/**
 * TODO(backend): GET /api/alerts/:id
 */
export async function getAlert(id: string): Promise<Alert | null> {
  return respond((state) => state.alerts.find((alert) => alert.id === id) ?? null);
}

/**
 * จำนวน alert ที่ยังไม่อ่าน — ใช้กับ badge บน Header
 * TODO(backend): GET /api/alerts/unread-count
 */
export async function getUnreadAlertCount(): Promise<{ total: number; critical: number }> {
  return respond((state) => {
    const unread = state.alerts.filter((alert) => !alert.read && alert.state !== 'resolved');
    return {
      total: unread.length,
      critical: unread.filter((alert) => alert.severity === 'critical').length,
    };
  });
}

/**
 * ทำเครื่องหมายว่าอ่านแล้ว
 * TODO(backend): POST /api/alerts/:id/read
 */
export async function markAlertRead(id: string): Promise<Alert | null> {
  return mutate((state) => {
    const alert = state.alerts.find((item) => item.id === id);
    if (alert === undefined) return null;
    alert.read = true;
    alert.updatedAt = new Date().toISOString();
    return alert;
  });
}

/**
 * ทำเครื่องหมายว่าอ่านทั้งหมด
 * TODO(backend): POST /api/alerts/read-all
 */
export async function markAllAlertsRead(): Promise<number> {
  return mutate((state) => {
    const iso = new Date().toISOString();
    let count = 0;
    for (const alert of state.alerts) {
      if (!alert.read) {
        alert.read = true;
        alert.updatedAt = iso;
        count += 1;
      }
    }
    return count;
  });
}

/**
 * รับทราบ alert (ระบุผู้รับทราบและหมายเหตุ)
 * TODO(backend): POST /api/alerts/:id/acknowledge  body: { acknowledgedByUserId, note, snoozeMinutes }
 *   หลังบ้านคืน AlertAcknowledgement ที่ acknowledgedBy เป็น ActorRef เต็ม (id + ชื่อ + role)
 */
export async function acknowledgeAlert(
  id: string,
  acknowledgedByUserId: string,
  note: string | null = null,
  snoozeMinutes: number | null = null,
): Promise<AlertAcknowledgement | null> {
  return mutate((state) => acknowledgeInStore(state, id, acknowledgedByUserId, note, snoozeMinutes));
}

/**
 * ประวัติการรับทราบ
 * TODO(backend): GET /api/alerts/acknowledgements?alertId=
 */
export async function getAcknowledgements(alertId?: string): Promise<AlertAcknowledgement[]> {
  return respond((state) =>
    alertId === undefined ? state.acknowledgements : state.acknowledgements.filter((ack) => ack.alertId === alertId),
  );
}

/**
 * สถานะการส่งแจ้งเตือนออกแต่ละช่องทาง
 * TODO(backend): GET /api/notifications/deliveries?alertId=
 */
export async function getNotificationDeliveries(alertId?: string): Promise<NotificationDelivery[]> {
  return respond((state) =>
    alertId === undefined ? state.deliveries : state.deliveries.filter((delivery) => delivery.alertId === alertId),
  );
}

/**
 * ส่งซ้ำเมื่อช่องทางใดล้มเหลว
 * TODO(backend): POST /api/notifications/deliveries/:id/retry
 */
export async function retryNotificationDelivery(id: string): Promise<NotificationDelivery | null> {
  return mutate((state) => {
    const delivery = state.deliveries.find((item) => item.id === id);
    if (delivery === undefined) return null;
    const iso = new Date().toISOString();
    delivery.attempts += 1;
    delivery.deliveryState = 'delivered';
    delivery.deliveredAt = iso;
    delivery.lastAttemptAt = iso;
    delivery.errorMessage = null;
    delivery.updatedAt = iso;
    return delivery;
  });
}

/**
 * เหตุการณ์ที่คลี่คลายแล้ว จับคู่กับ alert ต้นทาง
 *
 * ★ "ระยะเวลาที่เกิดเหตุ" คิดจาก raisedAt → resolvedAt ไม่ใช่จนถึงตอนที่มีคนกด ack
 *   เพราะการรับทราบไม่ได้แปลว่าปัญหาหายแล้ว ทั้งสองตัวเลขจึงแยกกันคนละช่อง
 *
 * TODO(backend): GET /api/alerts/recoveries?from=&to=&limit=
 */
export async function getRecoveryEvents(limit = 20): Promise<RecoveryEvent[]> {
  return respond((state) =>
    state.alerts
      .filter((alert): alert is Alert & { resolvedAt: string } => alert.state === 'resolved' && alert.resolvedAt !== null)
      .slice(0, limit)
      .map((alert) => {
        const raised = new Date(alert.raisedAt).getTime();
        const resolved = new Date(alert.resolvedAt).getTime();
        const ack =
          alert.acknowledgementId === null
            ? null
            : (state.acknowledgements.find((item) => item.id === alert.acknowledgementId) ?? null);

        return {
          alertId: alert.id,
          code: alert.code,
          sourceType: alert.sourceType,
          sourceId: alert.sourceId,
          sourceName: alert.sourceName,
          severity: alert.severity,
          messageTh: alert.messageTh,
          messageEn: alert.messageEn,
          raisedAt: alert.raisedAt,
          resolvedAt: alert.resolvedAt,
          durationMinutes: Math.max(0, Math.round((resolved - raised) / 60_000)),
          acknowledgedBy: ack?.acknowledgedBy ?? null,
          minutesToAcknowledge:
            ack === null ? null : Math.max(0, Math.round((new Date(ack.acknowledgedAt).getTime() - raised) / 60_000)),
        };
      }),
  );
}

/**
 * ข้อความที่จะถูกส่งออกจริงสำหรับ alert หนึ่ง
 *
 * ★ ประกอบข้อความที่นี่เพื่อให้ preview ตรงกับของจริง เมื่อหลังบ้านมาต่อ
 *   ต้องย้ายการประกอบข้อความไปฝั่งเซิร์ฟเวอร์ แล้วให้ endpoint นี้คืนข้อความเดียวกัน
 *   ไม่ใช่ให้หน้าบ้านประกอบเองคนละแบบกับที่ส่งจริง
 *
 * TODO(backend): GET /api/alerts/:id/preview?channel=line
 */
export async function getNotificationPreview(
  alertId: string,
  channel: NotificationChannel = 'line',
): Promise<NotificationPreview | null> {
  return respond((state) => {
    const alert = state.alerts.find((item) => item.id === alertId);
    if (alert === undefined) return null;

    const delivery = state.deliveries.find((item) => item.alertId === alertId && item.channel === channel);
    const recipients = state.settings.notifications.recipients[channel];
    const severityMark = { critical: '🔴 วิกฤต', warning: '🟡 เตือน', info: '🔵 แจ้งให้ทราบ' }[alert.severity];
    const site = state.settings.general.siteName;

    const lines = [
      `${severityMark} · ${site}`,
      alert.messageTh,
      `จุดเกิดเหตุ: ${alert.sourceName}`,
    ];
    if (alert.triggerValue !== null && alert.thresholdValue !== null) {
      lines.push(`ค่าที่วัดได้: ${alert.triggerValue} ${alert.unit ?? ''} (เกณฑ์ ${alert.thresholdValue} ${alert.unit ?? ''})`);
    }
    // ★ ต้องใช้เขตเวลาเดียวกับทั้งแอป ไม่ใช่เวลาเครื่อง ไม่งั้นข้อความแจ้งเตือนจะบอกเวลาผิด
    lines.push(`เวลา: ${formatDateTimeTH(alert.raisedAt, 'th')}`);
    if (alert.occurrenceCount > 1) lines.push(`เกิดซ้ำ ${alert.occurrenceCount} ครั้ง`);

    return {
      alertId,
      channel,
      recipient: delivery?.recipient ?? recipients[0] ?? '-',
      title: `${severityMark} · ${site}`,
      body: lines.join('\n'),
      deliveryState: delivery?.deliveryState ?? null,
    };
  });
}
