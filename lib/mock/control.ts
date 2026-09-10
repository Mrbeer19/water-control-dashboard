/**
 * การสั่งงานฝั่ง mock
 *
 * ★ หัวใจของไฟล์นี้คือ "คำสั่งไม่สำเร็จทันทีที่กด"
 *   ของจริงต้องเขียนค่าลง PLC แล้วรอ feedback bit ยืนยันว่าอุปกรณ์ขยับจริง
 *   ถ้า mock ตอบ success ทันที หน้าจอจะถูกออกแบบผิดตั้งแต่ต้น เพราะไม่มีใครเห็น
 *   ช่วงรอและไม่มีใครได้ทดสอบเคส timeout
 *
 *   ลำดับที่จำลอง:  sending → awaiting_feedback → success | timeout
 */

import type {
  CommandAction,
  CommandResult,
  CommandSchedule,
  ControlCommand,
  ControlInterlock,
  InterlockReason,
  PumpControlMode,
  ValvePosition,
} from '@/lib/types';
import type { MockState } from './store';
import { notify, nowIso } from './store';
import { toActorRef } from './organization';
import { chance, randomBetween } from './random';

/** ระดับน้ำต้นทางขั้นต่ำที่ยอมให้สตาร์ตปั๊ม — ต่ำกว่านี้ปั๊มจะดูดแห้งและซีลไหม้ */
export const MIN_SOURCE_LEVEL_PERCENT = 15;

/** เวลาที่คำสั่งใช้เดินทางถึง PLC ก่อนเปลี่ยนเป็นสถานะรอ feedback */
const SEND_LATENCY_MS = 220;

/** สัดส่วนคำสั่งที่จงใจให้ timeout เพื่อให้เคสนี้ถูกทดสอบจริงตอนสาธิต */
const TIMEOUT_PROBABILITY = 0.12;

let scheduleCounter = 0;

// ─────────────────────────────────────────────────────────────
// Interlock
// ─────────────────────────────────────────────────────────────

function reason(code: string, messageTh: string, messageEn: string): InterlockReason {
  return { code, messageTh, messageEn };
}

/** เงื่อนไขที่ทำให้ปั๊มตัวหนึ่งสั่งงานไม่ได้ */
export function pumpInterlock(state: MockState, pumpId: string): ControlInterlock {
  const pump = state.pumps.find((item) => item.id === pumpId);
  const reasons: InterlockReason[] = [];
  const blockedActions: CommandAction[] = [];

  if (pump === undefined) {
    return {
      targetType: 'pump',
      targetId: pumpId,
      blocked: true,
      blockedActions: [],
      reasons: [reason('NOT_FOUND', 'ไม่พบปั๊มตัวนี้', 'Pump not found')],
    };
  }

  if (state.settings.security.controlLockout) {
    reasons.push(
      reason('CONTROL_LOCKED', 'ระบบถูกล็อกการสั่งงาน (โหมดซ่อมบำรุง)', 'Control is locked (maintenance mode)'),
    );
    return { targetType: 'pump', targetId: pumpId, blocked: true, blockedActions: [], reasons };
  }

  const source = state.tanks.find((tank) => tank.id === pump.sourceTankId);
  if (source !== undefined && source.percentFull < MIN_SOURCE_LEVEL_PERCENT) {
    blockedActions.push('start');
    reasons.push(
      reason(
        'SOURCE_TANK_LOW',
        `${source.name}ต่ำกว่า ${MIN_SOURCE_LEVEL_PERCENT}% (${source.percentFull.toFixed(1)}%) — สตาร์ตแล้วปั๊มจะดูดแห้ง`,
        `${source.nameEn} below ${MIN_SOURCE_LEVEL_PERCENT}% (${source.percentFull.toFixed(1)}%) — starting would run the pump dry`,
      ),
    );
  }

  if (pump.runState === 'fault') {
    blockedActions.push('start');
    reasons.push(
      reason(
        'PUMP_IN_FAULT',
        `ปั๊มขัดข้อง (${pump.faultCode ?? '-'}) ต้องเคลียร์ก่อนจึงสั่งเดินได้`,
        `Pump is in fault (${pump.faultCode ?? '-'}) — clear it before starting`,
      ),
    );
  }

  if (pump.controlMode === 'locked_out') {
    blockedActions.push('start', 'stop');
    reasons.push(
      reason('PUMP_LOCKED_OUT', 'ปั๊มถูกล็อกอยู่ ต้องปลดล็อกก่อน', 'Pump is locked out — release it first'),
    );
  }

  return {
    targetType: 'pump',
    targetId: pumpId,
    blocked: blockedActions.length > 0,
    blockedActions,
    reasons,
  };
}

/** เงื่อนไขที่ทำให้วาล์วโซนหนึ่งสั่งงานไม่ได้ */
export function valveInterlock(state: MockState, valveId: string): ControlInterlock {
  const valve = state.valves.find((item) => item.id === valveId);
  const reasons: InterlockReason[] = [];
  const blockedActions: CommandAction[] = [];

  if (valve === undefined) {
    return {
      targetType: 'valve',
      targetId: valveId,
      blocked: true,
      blockedActions: [],
      reasons: [reason('NOT_FOUND', 'ไม่พบวาล์วตัวนี้', 'Valve not found')],
    };
  }

  if (state.settings.security.controlLockout) {
    reasons.push(
      reason('CONTROL_LOCKED', 'ระบบถูกล็อกการสั่งงาน (โหมดซ่อมบำรุง)', 'Control is locked (maintenance mode)'),
    );
    return { targetType: 'valve', targetId: valveId, blocked: true, blockedActions: [], reasons };
  }

  if (!valve.remoteEnabled) {
    reasons.push(
      reason('REMOTE_DISABLED', 'วาล์วนี้ถูกปิดการสั่งงานระยะไกลที่ตู้หน้างาน', 'Remote control disabled at the local panel'),
    );
    return { targetType: 'valve', targetId: valveId, blocked: true, blockedActions: [], reasons };
  }

  if (valve.position === 'opening' || valve.position === 'closing') {
    reasons.push(
      reason('VALVE_MOVING', 'วาล์วกำลังเคลื่อนที่ รอให้หยุดก่อน', 'Valve is still moving — wait for it to settle'),
    );
    return { targetType: 'valve', targetId: valveId, blocked: true, blockedActions: [], reasons };
  }

  const zone = state.zones.find((item) => item.id === valve.zoneId);
  if (zone?.isVip === true) {
    // ไม่ได้ห้ามปิด แต่ต้องยืนยันสองชั้น — แจ้งไว้ให้ UI เตือนก่อนกด
    reasons.push(
      reason('VIP_ZONE', 'โซน VIP — ต้องยืนยันสองชั้นก่อนตัดน้ำ', 'VIP zone — closing requires a second confirmation'),
    );
  }

  return { targetType: 'valve', targetId: valveId, blocked: blockedActions.length > 0, blockedActions, reasons };
}

// ─────────────────────────────────────────────────────────────
// การเดินสถานะของคำสั่ง
// ─────────────────────────────────────────────────────────────

/** ผลการตรวจก่อนส่ง — คืน error message เมื่อสั่งไม่ได้ */
function validate(state: MockState, command: ControlCommand): { code: string; message: string } | null {
  if (state.settings.security.controlLockout && command.action !== 'set_mode') {
    return { code: 'CONTROL_LOCKED', message: 'ระบบถูกล็อกการสั่งงานอยู่ (โหมดซ่อมบำรุง)' };
  }

  if (command.targetType === 'pump') {
    const interlock = pumpInterlock(state, command.targetId);
    if (interlock.blockedActions.includes(command.action)) {
      return { code: interlock.reasons[0]?.code ?? 'BLOCKED', message: interlock.reasons[0]?.messageTh ?? 'สั่งงานไม่ได้' };
    }
    const pump = state.pumps.find((item) => item.id === command.targetId);
    if (pump === undefined) return { code: 'NOT_FOUND', message: 'ไม่พบอุปกรณ์ปลายทาง' };
    if (command.action === 'set_mode' && command.value === 'pid' && !pump.hasVfd) {
      return { code: 'NO_VFD', message: 'ปั๊มตัวนี้ไม่ได้ขับด้วยอินเวอร์เตอร์ จึงใช้โหมด PID ไม่ได้' };
    }
  }

  if (command.targetType === 'valve') {
    const interlock = valveInterlock(state, command.targetId);
    if (interlock.blocked) {
      return { code: interlock.reasons[0]?.code ?? 'BLOCKED', message: interlock.reasons[0]?.messageTh ?? 'สั่งงานไม่ได้' };
    }
    if (command.action === 'set_open_percent') {
      const percent = Number(command.value);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return { code: 'BAD_VALUE', message: 'เปอร์เซ็นต์การเปิดต้องอยู่ระหว่าง 0–100' };
      }
    }
  }

  if (command.targetType === 'pressure_control' && command.action === 'set_setpoint') {
    const setpoint = Number(command.value);
    const { min, max } = state.pressureControl.setpointLimitsBar;
    if (!Number.isFinite(setpoint) || setpoint < min || setpoint > max) {
      return { code: 'SETPOINT_OUT_OF_RANGE', message: `แรงดันเป้าหมายต้องอยู่ระหว่าง ${min}–${max} bar` };
    }
  }

  return null;
}

/** ลงมือเปลี่ยนสถานะอุปกรณ์จริง — เรียกตอน feedback กลับมาเท่านั้น */
function applyEffect(state: MockState, command: ControlCommand, iso: string): string | number | null {
  const pump = state.pumps.find((item) => item.id === command.targetId);
  if (pump !== undefined) {
    switch (command.action) {
      case 'start':
        pump.controlMode = 'manual';
        pump.runState = 'running';
        pump.lastStartedAt = iso;
        pump.startsToday += 1;
        return 'running';
      case 'stop':
        pump.controlMode = 'manual';
        pump.runState = 'stopped';
        pump.lastStoppedAt = iso;
        return 'stopped';
      case 'set_mode':
        pump.controlMode = command.value as PumpControlMode;
        return command.value;
      case 'reset_fault':
        pump.faultCode = null;
        pump.faultMessage = null;
        pump.runState = 'stopped';
        return 'cleared';
      default:
        return null;
    }
  }

  const valve = state.valves.find((item) => item.id === command.targetId);
  if (valve !== undefined) {
    let position: ValvePosition = valve.position;
    if (command.action === 'open') {
      valve.openPercent = 100;
      position = 'open';
    } else if (command.action === 'close') {
      valve.openPercent = 0;
      position = 'closed';
    } else if (command.action === 'set_open_percent') {
      valve.openPercent = Number(command.value);
      position = valve.openPercent === 0 ? 'closed' : 'open';
    }
    valve.position = position;
    valve.lastCommandId = command.id;
    valve.lastActuatedAt = iso;
    valve.cycleCount += 1;
    valve.updatedAt = iso;
    return position;
  }

  if (command.targetType === 'pressure_control' && command.action === 'set_setpoint') {
    const loop = state.pressureControl;
    loop.setpointBar = Number(command.value);
    loop.mode = 'manual';
    loop.updatedAt = iso;
    const controlled = state.pumps.find((item) => item.id === loop.controlledPumpId);
    if (controlled !== undefined) controlled.pressureSetpointBar = loop.setpointBar;
    return loop.setpointBar;
  }

  if (command.targetType === 'system') {
    if (command.action === 'emergency_stop') {
      for (const item of state.pumps) {
        item.controlMode = 'locked_out';
        item.runState = 'stopped';
        item.lastStoppedAt = iso;
      }
      state.settings.security.controlLockout = true;
      return 'all_stopped';
    }
    if (command.action === 'set_mode' && command.value === 'auto') {
      for (const item of state.pumps) item.controlMode = 'auto';
      state.settings.security.controlLockout = false;
      return 'auto';
    }
    if (command.action === 'open_all' || command.action === 'close_all') {
      const opening = command.action === 'open_all';
      for (const valveItem of state.valves) {
        valveItem.openPercent = opening ? 100 : 0;
        valveItem.position = opening ? 'open' : 'closed';
        valveItem.lastCommandId = command.id;
        valveItem.lastActuatedAt = iso;
        valveItem.cycleCount += 1;
        valveItem.updatedAt = iso;
      }
      return opening ? 'all_open' : 'all_closed';
    }
  }

  return null;
}

/**
 * เริ่มคำสั่งและตั้งเวลาให้มันเดินสถานะเอง
 * คืน CommandResult ตอน "เพิ่งส่ง" — ผู้เรียกต้อง poll ต่อเพื่อดูผลจริง
 */
export function startCommand(state: MockState, command: ControlCommand): CommandResult {
  const iso = nowIso();

  const invalid = validate(state, command);
  if (invalid !== null) {
    // ตรวจไม่ผ่านตั้งแต่ต้น — ไม่ต้องเสียเวลารอ feedback
    return {
      commandId: command.id,
      state: 'failed',
      sentAt: iso,
      feedbackAt: iso,
      latencyMs: 0,
      feedbackValue: null,
      errorCode: invalid.code,
      errorMessage: invalid.message,
      attempt: 1,
    };
  }

  const result: CommandResult = {
    commandId: command.id,
    state: 'sending',
    sentAt: iso,
    feedbackAt: null,
    latencyMs: null,
    feedbackValue: null,
    errorCode: null,
    errorMessage: null,
    attempt: 1,
  };

  // หยุดฉุกเฉินต้องมีผลทันที ไม่ควรมีจังหวะรอหรือโอกาส timeout
  const isEmergency = command.action === 'emergency_stop';
  const willTimeout = !isEmergency && chance(TIMEOUT_PROBABILITY);
  const feedbackDelay = isEmergency ? 120 : randomBetween(420, 1_400);

  if (typeof window === 'undefined') {
    // ฝั่ง server ไม่มี timer ให้เดิน — ลงมือทันทีเพื่อไม่ให้คำสั่งค้าง
    result.state = 'success';
    result.feedbackAt = iso;
    result.latencyMs = Math.round(feedbackDelay);
    result.feedbackValue = applyEffect(state, command, iso);
    return result;
  }

  const update = (mutate: (target: CommandResult) => void): void => {
    const entry = state.commandLog.find((item) => item.command.id === command.id);
    if (entry === undefined) return;
    mutate(entry.result);
    entry.command.updatedAt = nowIso();
    notify();
  };

  setTimeout(() => {
    update((target) => {
      if (target.state !== 'sending') return;
      target.state = 'awaiting_feedback';
    });
  }, SEND_LATENCY_MS);

  if (willTimeout) {
    setTimeout(() => {
      update((target) => {
        if (target.state === 'success' || target.state === 'failed') return;
        target.state = 'timeout';
        target.errorCode = 'FEEDBACK_TIMEOUT';
        target.errorMessage = 'ไม่ได้รับการยืนยันจาก PLC ภายในเวลาที่กำหนด — อุปกรณ์อาจไม่ได้ขยับจริง';
      });
    }, command.timeoutMs);
  } else {
    setTimeout(() => {
      const at = nowIso();
      update((target) => {
        if (target.state === 'timeout' || target.state === 'failed') return;
        target.state = 'success';
        target.feedbackAt = at;
        target.latencyMs = Math.round(feedbackDelay + SEND_LATENCY_MS);
        target.feedbackValue = applyEffect(state, command, at);
      });
    }, SEND_LATENCY_MS + feedbackDelay);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// ตารางเวลา
// ─────────────────────────────────────────────────────────────

/** เวลาที่ตารางนี้จะทำงานครั้งถัดไป */
export function computeNextRun(schedule: Pick<CommandSchedule, 'time' | 'repeat' | 'daysOfWeek' | 'enabled'>): string | null {
  if (!schedule.enabled) return null;

  const parts = schedule.time.split(':');
  const hour = Number(parts[0] ?? 0);
  const minute = Number(parts[1] ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const now = new Date();
  const candidate = new Date();
  candidate.setHours(hour, minute, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  // เลื่อนไปจนเจอวันที่ตรงกับรูปแบบการทำซ้ำ (มองไปข้างหน้าไม่เกิน 1 สัปดาห์)
  for (let step = 0; step < 8; step += 1) {
    const day = candidate.getDay();
    const matches =
      schedule.repeat === 'daily' ||
      schedule.repeat === 'once' ||
      (schedule.repeat === 'weekdays' && day >= 1 && day <= 5) ||
      (schedule.repeat === 'weekly' && schedule.daysOfWeek.includes(day));
    if (matches) return candidate.toISOString();
    candidate.setDate(candidate.getDate() + 1);
  }
  return null;
}

export function createSchedule(
  state: MockState,
  input: Omit<CommandSchedule, 'id' | 'name' | 'createdAt' | 'updatedAt' | 'nextRunAt' | 'lastRunAt' | 'lastResultState' | 'createdBy' | 'targetName'>,
  createdByUserId: string,
): CommandSchedule {
  scheduleCounter += 1;
  const iso = nowIso();
  const targetName =
    state.pumps.find((pump) => pump.id === input.targetId)?.name ??
    state.valves.find((valve) => valve.id === input.targetId)?.name ??
    'ระบบ';

  const schedule: CommandSchedule = {
    id: `sched-${scheduleCounter}`,
    name: `${input.action} → ${targetName} ${input.time}`,
    createdAt: iso,
    updatedAt: iso,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName,
    action: input.action,
    value: input.value,
    time: input.time,
    repeat: input.repeat,
    daysOfWeek: [...input.daysOfWeek],
    enabled: input.enabled,
    nextRunAt: computeNextRun(input),
    lastRunAt: null,
    lastResultState: null,
    createdBy: toActorRef(createdByUserId),
  };
  state.schedules.unshift(schedule);
  return schedule;
}

/** ตารางตั้งต้นที่มีอยู่แล้วในระบบตอนติดตั้ง */
export function seedSchedules(state: MockState): void {
  createSchedule(
    state,
    {
      targetType: 'valve',
      targetId: 'valve-zone-7',
      action: 'close',
      value: null,
      time: '22:00',
      repeat: 'daily',
      daysOfWeek: [],
      enabled: true,
    },
    'user-somchai',
  );
  createSchedule(
    state,
    {
      targetType: 'valve',
      targetId: 'valve-zone-7',
      action: 'open',
      value: null,
      time: '05:30',
      repeat: 'daily',
      daysOfWeek: [],
      enabled: true,
    },
    'user-somchai',
  );
  createSchedule(
    state,
    {
      targetType: 'valve',
      targetId: 'valve-zone-3',
      action: 'set_open_percent',
      value: 60,
      time: '13:30',
      repeat: 'weekdays',
      daysOfWeek: [],
      enabled: false,
    },
    'user-nid',
  );
}
