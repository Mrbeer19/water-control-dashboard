/**
 * Service: การสั่งงานปั๊มและวาล์ว
 *
 * ทุกคำสั่งเดินผ่าน state machine เดียวกัน:
 *   idle → sending → awaiting_feedback → success | timeout | failed
 * หน้า Control ควรแสดง state นี้ตรง ๆ ไม่ควรถือว่ากดแล้วสำเร็จทันที
 */

import type {
  CommandAction,
  CommandLogEntry,
  CommandResult,
  CommandState,
  CommandTargetType,
  ControlCommand,
  PumpControlMode,
} from '@/lib/types';
import type { MockState } from '@/lib/mock';
import { toActorRef } from '@/lib/mock';
import { mutate, respond } from './internal';

let commandCounter = 0;

export interface IssueCommandInput {
  targetType: CommandTargetType;
  targetId: string;
  action: CommandAction;
  value?: string | number | null;
  /** ผู้สั่ง — ส่งเป็น User['id'] แล้ว service เติมชื่อ/บทบาทให้เอง */
  issuedByUserId: string;
  reason?: string | null;
}

/** เวลารอ feedback จาก PLC ก่อนตัดเป็น timeout */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * ส่งคำสั่งไปยังปั๊มหรือวาล์ว
 *
 * TODO(backend): POST /api/control/pump/:id             body: { action, value, issuedByUserId, reason }
 * TODO(backend): POST /api/control/valve/:id            body: { action, value, issuedByUserId, reason }
 * TODO(backend): POST /api/control/pressure/:id         body: { action: 'set_setpoint', value, issuedByUserId }
 * TODO(backend): POST /api/control/system               body: { action: 'emergency_stop', issuedByUserId, reason }
 *   หลังบ้านควรเขียนลง PLC แล้วรอ feedback bit ยืนยันก่อนตอบ 200
 */
export async function issueCommand(input: IssueCommandInput): Promise<CommandLogEntry> {
  return mutate((state) => {
    commandCounter += 1;
    const iso = new Date().toISOString();

    const targetName =
      state.pumps.find((pump) => pump.id === input.targetId)?.name ??
      state.valves.find((valve) => valve.id === input.targetId)?.name ??
      (input.targetType === 'pressure_control' ? state.pressureControl.name : 'ระบบ');

    const requiresConfirmation =
      input.action === 'emergency_stop' ||
      state.zones.some((zone) => zone.isVip && (zone.valveId === input.targetId || zone.id === input.targetId));

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

    const result = applyCommand(state, command, iso);
    const entry: CommandLogEntry = { command, result };
    state.commandLog.unshift(entry);
    return entry;
  });
}

/** เปลี่ยน state ของอุปกรณ์จริงตามคำสั่ง แล้วสร้าง CommandResult */
function applyCommand(state: MockState, command: ControlCommand, iso: string): CommandResult {
  const base: CommandResult = {
    commandId: command.id,
    state: 'awaiting_feedback',
    sentAt: iso,
    feedbackAt: null,
    latencyMs: null,
    feedbackValue: null,
    errorCode: null,
    errorMessage: null,
    attempt: 1,
  };

  if (state.settings.security.controlLockout) {
    return {
      ...base,
      state: 'failed',
      errorCode: 'CONTROL_LOCKED',
      errorMessage: 'ระบบถูกล็อกการสั่งงานอยู่ (โหมดซ่อมบำรุง)',
    };
  }

  const pump = state.pumps.find((item) => item.id === command.targetId);
  if (pump !== undefined) {
    switch (command.action) {
      case 'start':
        pump.controlMode = 'manual';
        pump.runState = 'running';
        pump.lastStartedAt = iso;
        pump.startsToday += 1;
        return { ...base, state: 'success', feedbackAt: iso, latencyMs: 340, feedbackValue: 'running' };
      case 'stop':
        pump.controlMode = 'manual';
        pump.runState = 'stopped';
        pump.lastStoppedAt = iso;
        return { ...base, state: 'success', feedbackAt: iso, latencyMs: 290, feedbackValue: 'stopped' };
      case 'set_mode': {
        const mode = command.value;
        if (mode !== 'auto' && mode !== 'manual' && mode !== 'pid' && mode !== 'locked_out') {
          return { ...base, state: 'failed', errorCode: 'BAD_VALUE', errorMessage: 'โหมดไม่ถูกต้อง' };
        }
        // โหมด pid ต้องมี VFD ขับปั๊ม ไม่งั้นไม่มีอะไรให้ปรับรอบ
        if (mode === 'pid' && !pump.hasVfd) {
          return {
            ...base,
            state: 'failed',
            errorCode: 'NO_VFD',
            errorMessage: 'ปั๊มตัวนี้ไม่ได้ขับด้วยอินเวอร์เตอร์ จึงใช้โหมด PID ไม่ได้',
          };
        }
        pump.controlMode = mode as PumpControlMode;
        return { ...base, state: 'success', feedbackAt: iso, latencyMs: 180, feedbackValue: mode };
      }
      case 'reset_fault':
        pump.faultCode = null;
        pump.faultMessage = null;
        pump.runState = 'stopped';
        return { ...base, state: 'success', feedbackAt: iso, latencyMs: 410, feedbackValue: 'cleared' };
      default:
        return { ...base, state: 'failed', errorCode: 'UNSUPPORTED', errorMessage: 'ปั๊มไม่รองรับคำสั่งนี้' };
    }
  }

  const valve = state.valves.find((item) => item.id === command.targetId);
  if (valve !== undefined) {
    if (!valve.remoteEnabled) {
      return { ...base, state: 'failed', errorCode: 'REMOTE_DISABLED', errorMessage: 'วาล์วนี้ถูกปิดการสั่งงานระยะไกล' };
    }
    switch (command.action) {
      case 'open':
        valve.position = 'open';
        valve.openPercent = 100;
        break;
      case 'close':
        valve.position = 'closed';
        valve.openPercent = 0;
        break;
      case 'set_open_percent': {
        const percent = typeof command.value === 'number' ? command.value : Number(command.value);
        if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
          return { ...base, state: 'failed', errorCode: 'BAD_VALUE', errorMessage: 'เปอร์เซ็นต์การเปิดต้องอยู่ระหว่าง 0–100' };
        }
        valve.openPercent = percent;
        valve.position = percent === 0 ? 'closed' : 'open';
        break;
      }
      default:
        return { ...base, state: 'failed', errorCode: 'UNSUPPORTED', errorMessage: 'วาล์วไม่รองรับคำสั่งนี้' };
    }
    valve.lastCommandId = command.id;
    valve.lastActuatedAt = iso;
    valve.cycleCount += 1;
    valve.updatedAt = iso;
    return { ...base, state: 'success', feedbackAt: iso, latencyMs: 620, feedbackValue: valve.position };
  }

  if (command.targetType === 'pressure_control' && command.action === 'set_setpoint') {
    const loop = state.pressureControl;
    const setpoint = typeof command.value === 'number' ? command.value : Number(command.value);
    const { min, max } = loop.setpointLimitsBar;
    if (!Number.isFinite(setpoint) || setpoint < min || setpoint > max) {
      return {
        ...base,
        state: 'failed',
        errorCode: 'SETPOINT_OUT_OF_RANGE',
        errorMessage: `แรงดันเป้าหมายต้องอยู่ระหว่าง ${min}–${max} bar`,
      };
    }
    loop.setpointBar = setpoint;
    loop.mode = 'manual';
    loop.updatedAt = iso;
    const controlled = state.pumps.find((item) => item.id === loop.controlledPumpId);
    if (controlled !== undefined) {
      controlled.pressureSetpointBar = setpoint;
    }
    return { ...base, state: 'success', feedbackAt: iso, latencyMs: 520, feedbackValue: setpoint };
  }

  if (command.targetType === 'system' && command.action === 'set_mode' && command.value === 'auto') {
    for (const item of state.pumps) {
      item.controlMode = 'auto';
    }
    return { ...base, state: 'success', feedbackAt: iso, latencyMs: 160, feedbackValue: 'auto' };
  }

  if (command.action === 'emergency_stop') {
    for (const item of state.pumps) {
      item.controlMode = 'locked_out';
      item.runState = 'stopped';
      item.lastStoppedAt = iso;
    }
    return { ...base, state: 'success', feedbackAt: iso, latencyMs: 150, feedbackValue: 'all_stopped' };
  }

  return { ...base, state: 'failed', errorCode: 'NOT_FOUND', errorMessage: 'ไม่พบอุปกรณ์ปลายทาง' };
}

/**
 * สถานะล่าสุดของคำสั่งหนึ่ง — หน้า Control ใช้ poll ระหว่าง awaiting_feedback
 * TODO(backend): GET /api/control/commands/:id
 */
export async function getCommandResult(commandId: string): Promise<CommandResult | null> {
  return respond((state) => state.commandLog.find((entry) => entry.command.id === commandId)?.result ?? null);
}

/**
 * audit log ของการสั่งงาน
 * TODO(backend): GET /api/control/commands?limit=&offset=
 */
export async function getCommandLog(limit = 50): Promise<CommandLogEntry[]> {
  return respond((state) => state.commandLog.slice(0, limit));
}

/**
 * ยกเลิกการล็อกหลังกดหยุดฉุกเฉิน
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

/** ข้อความอธิบาย state ของคำสั่ง ใช้ร่วมกันในหน้า Control */
export const COMMAND_STATE_LABEL: Record<CommandState, { th: string; en: string }> = {
  idle: { th: 'พร้อมส่ง', en: 'Idle' },
  sending: { th: 'กำลังส่งคำสั่ง…', en: 'Sending…' },
  awaiting_feedback: { th: 'รอการยืนยันจาก PLC…', en: 'Awaiting PLC feedback…' },
  success: { th: 'สำเร็จ', en: 'Success' },
  timeout: { th: 'หมดเวลารอการยืนยัน', en: 'Feedback timeout' },
  failed: { th: 'ล้มเหลว', en: 'Failed' },
};
