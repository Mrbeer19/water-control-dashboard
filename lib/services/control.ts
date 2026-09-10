/**
 * Service: การสั่งงานปั๊ม วาล์ว และระบบแรงดัน
 *
 * ทุกคำสั่งเดินผ่าน state machine เดียวกัน:
 *   sending → awaiting_feedback → success | timeout | failed
 *
 * ★ issueCommand() คืนค่าตอน "เพิ่งส่ง" ไม่ใช่ตอนสำเร็จ
 *   หน้าจอต้อง poll getCommandResult() ต่อจนกว่าจะถึงสถานะสุดท้าย
 *   ห้ามถือว่ากดแล้วสำเร็จ เพราะอุปกรณ์อาจไม่ขยับจริงและ feedback ไม่กลับมา
 */

import type {
  CommandAction,
  CommandLogEntry,
  CommandResult,
  CommandSchedule,
  CommandState,
  CommandTargetType,
  ControlCommand,
  ControlInterlock,
  ScheduleRepeat,
} from '@/lib/types';
import {
  computeNextRun,
  createSchedule as createScheduleInStore,
  pumpInterlock,
  startCommand,
  toActorRef,
  valveInterlock,
} from '@/lib/mock';
import { mutate, respond } from './internal';

let commandCounter = 0;

/** เวลารอ feedback จาก PLC ก่อนตัดเป็น timeout */
const DEFAULT_TIMEOUT_MS = 5_000;

export interface IssueCommandInput {
  targetType: CommandTargetType;
  targetId: string;
  action: CommandAction;
  value?: string | number | null;
  /** ผู้สั่ง — ส่งเป็น User['id'] แล้ว service เติมชื่อ/บทบาทให้เอง */
  issuedByUserId: string;
  reason?: string | null;
}

/**
 * ส่งคำสั่งไปยังอุปกรณ์
 *
 * TODO(backend): POST /api/control/pump/:id      body: { action, value, issuedByUserId, reason }
 * TODO(backend): POST /api/control/valve/:id     body: { action, value, issuedByUserId, reason }
 * TODO(backend): POST /api/control/pressure/:id  body: { action: 'set_setpoint', value, issuedByUserId }
 * TODO(backend): POST /api/control/system        body: { action: 'emergency_stop' | 'open_all' | 'close_all', ... }
 *   ควรตอบ 202 ทันทีพร้อม commandId แล้วให้หน้าบ้าน poll ผลต่อ
 *   ห้ามค้าง request ไว้รอ feedback bit เพราะจะ timeout ที่ชั้น HTTP ก่อน
 */
export async function issueCommand(input: IssueCommandInput): Promise<CommandLogEntry> {
  return mutate((state) => {
    commandCounter += 1;
    const iso = new Date().toISOString();

    const targetName =
      state.pumps.find((pump) => pump.id === input.targetId)?.name ??
      state.valves.find((valve) => valve.id === input.targetId)?.name ??
      (input.targetType === 'pressure_control' ? state.pressureControl.name : 'ทั้งระบบ');

    // คำสั่งที่กระทบโซน VIP หรือกระทบทั้งระบบ ต้องยืนยันสองชั้น
    const affectsVip = state.zones.some(
      (zone) => zone.isVip && (zone.valveId === input.targetId || zone.id === input.targetId),
    );
    const requiresConfirmation =
      affectsVip ||
      input.action === 'emergency_stop' ||
      input.action === 'open_all' ||
      input.action === 'close_all';

    const command: ControlCommand = {
      id: `cmd-${commandCounter}`,
      name: `${input.action} → ${targetName}`,
      createdAt: iso,
      updatedAt: iso,
      targetType: input.targetType,
      targetId: input.targetId,
      targetName,
      action: input.action,
      value: input.value ?? null,
      issuedBy: toActorRef(input.issuedByUserId),
      issuedAt: iso,
      requiresConfirmation,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      reason: input.reason ?? null,
    };

    const result = startCommand(state, command);
    const entry: CommandLogEntry = { command, result };
    state.commandLog.unshift(entry);
    return entry;
  }, 60);
}

/**
 * สถานะล่าสุดของคำสั่งหนึ่ง — หน้า Control poll ตัวนี้ระหว่างรอ feedback
 * TODO(backend): GET /api/control/commands/:id
 */
export async function getCommandResult(commandId: string): Promise<CommandResult | null> {
  return respond(
    (state) => state.commandLog.find((entry) => entry.command.id === commandId)?.result ?? null,
  );
}

/**
 * audit log ของการสั่งงาน
 * TODO(backend): GET /api/control/commands?limit=&offset=
 */
export async function getCommandLog(limit = 50): Promise<CommandLogEntry[]> {
  return respond((state) => state.commandLog.slice(0, limit));
}

/**
 * เงื่อนไข interlock ของอุปกรณ์ทุกตัวที่สั่งงานได้
 * ★ หน้าจอต้องใช้ตัวนี้ตัดสินว่าปุ่มไหน disable และแสดงเหตุผลอะไร
 *   ห้ามคำนวณเงื่อนไขเองในหน้าบ้าน เพราะของจริงเงื่อนไขอยู่ใน PLC
 *
 * TODO(backend): GET /api/control/interlocks
 */
export async function getInterlocks(): Promise<ControlInterlock[]> {
  return respond((state) => [
    ...state.pumps.map((pump) => pumpInterlock(state, pump.id)),
    ...state.valves.map((valve) => valveInterlock(state, valve.id)),
  ]);
}

/**
 * ปลดล็อกหลังกดหยุดฉุกเฉิน
 * TODO(backend): POST /api/control/system/clear-lockout
 */
export async function clearEmergencyLockout(issuedByUserId: string): Promise<CommandLogEntry> {
  return issueCommand({
    targetType: 'system',
    targetId: 'system',
    action: 'set_mode',
    value: 'auto',
    issuedByUserId,
    reason: 'ปลดล็อกหลังหยุดฉุกเฉิน',
  });
}

// ─────────────────────────────────────────────────────────────
// ตารางสั่งงานล่วงหน้า
// ─────────────────────────────────────────────────────────────

/**
 * TODO(backend): GET /api/control/schedules
 */
export async function getSchedules(): Promise<CommandSchedule[]> {
  return respond((state) => state.schedules);
}

export interface CreateScheduleInput {
  targetType: CommandTargetType;
  targetId: string;
  action: CommandAction;
  value?: string | number | null;
  /** "HH:mm" */
  time: string;
  repeat: ScheduleRepeat;
  daysOfWeek?: number[];
  enabled?: boolean;
  createdByUserId: string;
}

/**
 * TODO(backend): POST /api/control/schedules
 *   หลังบ้านเป็นผู้เดินตารางเวลา (cron ที่ gateway) ไม่ใช่หน้าบ้าน
 *   เพราะจอในห้องคอนโทรลอาจถูกปิดหรือรีเฟรชเมื่อไรก็ได้
 */
export async function createSchedule(input: CreateScheduleInput): Promise<CommandSchedule> {
  return mutate((state) =>
    createScheduleInStore(
      state,
      {
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        value: input.value ?? null,
        time: input.time,
        repeat: input.repeat,
        daysOfWeek: input.daysOfWeek ?? [],
        enabled: input.enabled ?? true,
      },
      input.createdByUserId,
    ),
  );
}

/**
 * เปิด/ปิดการทำงานของตารางหนึ่ง
 * TODO(backend): PATCH /api/control/schedules/:id  body: { enabled }
 */
export async function setScheduleEnabled(id: string, enabled: boolean): Promise<CommandSchedule | null> {
  return mutate((state) => {
    const schedule = state.schedules.find((item) => item.id === id);
    if (schedule === undefined) return null;
    schedule.enabled = enabled;
    schedule.nextRunAt = computeNextRun(schedule);
    schedule.updatedAt = new Date().toISOString();
    return schedule;
  });
}

/**
 * TODO(backend): DELETE /api/control/schedules/:id
 */
export async function deleteSchedule(id: string): Promise<boolean> {
  return mutate((state) => {
    const index = state.schedules.findIndex((item) => item.id === id);
    if (index === -1) return false;
    state.schedules.splice(index, 1);
    return true;
  });
}

/** ข้อความอธิบาย state ของคำสั่ง ใช้ร่วมกันในหน้า Control */
export const COMMAND_STATE_LABEL: Record<CommandState, { th: string; en: string }> = {
  idle: { th: 'พร้อมส่ง', en: 'Idle' },
  sending: { th: 'กำลังส่งคำสั่ง…', en: 'Sending…' },
  awaiting_feedback: { th: 'รอการยืนยันจาก PLC…', en: 'Awaiting PLC feedback…' },
  success: { th: 'สำเร็จ', en: 'Success' },
  timeout: { th: 'หมดเวลารอการยืนยัน', en: 'Feedback timeout' },
  failed: { th: 'ล้มเหลว', en: 'Failed' },
};

/** true เมื่อคำสั่งยังเดินไม่จบ — ใช้ตัดสินว่าจะ poll ต่อและโชว์ spinner ไหม */
export function isCommandPending(state: CommandState): boolean {
  return state === 'sending' || state === 'awaiting_feedback';
}
