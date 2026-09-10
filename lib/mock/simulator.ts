/**
 * Simulator — ขยับค่า mock ทุก 2 วินาที
 *
 * ค่าไม่ได้สุ่มแยกกันเป็นอิสระ แต่เดินตามสมดุลน้ำจริงของระบบ:
 *
 *   การประปา ──▶ มิเตอร์หลัก ──┬──▶ ถังใต้ดินหลัก ──▶ ปั๊ม 1,2 ──▶ โซน 1–7
 *                              │           └──▶ ถังจ่าย ──▶ ปั๊ม 3 ──▶ โซน 8 (VIP)
 *                              └──▶ บ่อสำรอง
 *
 * ระดับน้ำจึงเป็นผลของการอินทิเกรต (inflow − outflow) ตามเวลาจริง
 * ส่วนค่าที่ไม่มีสมการผูก (อุณหภูมิ, RSSI, แรงดันไฟ) ใช้ random walk แบบดึงกลับเข้าหาค่ากลาง
 */

import type { Device, ElectricNode, EntityStatus, Pump, Tank } from '@/lib/types';
import { ENVIRONMENT_SPECS, MAIN_METER_SPEC, PUMP_SPECS, ZONE_SPECS } from './hardware';
import { DEVICE_SPECS } from './network';
import { ELECTRIC_NODE_SPECS } from './organization';
import { raiseAlert, resolveAlerts, seedAlerts } from './alerts';
import { buildAnomalies } from './ai';
import { chance, clamp, randomBetween, roundTo, walk } from './random';
import {
  TICK_MS,
  getState,
  notify,
  nowIso,
  pushHistory,
  statusFromRange,
  worstStatus,
  type MockState,
} from './store';

/** 2 วินาทีคิดเป็นกี่นาที — ใช้แปลง L/min เป็นลิตรต่อ tick */
const TICK_MINUTES = TICK_MS / 60_000;

/** ระดับที่ปั๊มหลักตัดการทำงานเพื่อกันปั๊มดูดแห้ง และระดับที่ให้กลับมาเดินใหม่ */
const PUMP_CUTOUT_PERCENT = 22;
const PUMP_CUTIN_PERCENT = 40;

/** อัตราถ่ายน้ำจากถังใต้ดินขึ้นถังจ่ายบนดาดฟ้า */
const TRANSFER_LPM = 60;

/**
 * ถังจ่ายเติมเป็นรอบเหมือนถังจริง: เริ่มเติมเมื่อต่ำกว่า 55% หยุดเมื่อถึง 92%
 * ถ้าใช้เกณฑ์เดียวทั้งเปิดและปิด ระดับจะค้างนิ่งอยู่ที่เส้นเกณฑ์และปั๊มถ่ายจะกระพริบ
 */
const TRANSFER_START_PERCENT = 55;
const TRANSFER_STOP_PERCENT = 92;

/** จำสถานะปั๊มถ่ายน้ำไว้ข้าม tick เพื่อให้ hysteresis ทำงาน */
let transferActive = false;

/** อัตราการรั่วของสถานการณ์ night_leak (L/min ต่อโซนที่รั่ว) */
const NIGHT_LEAK_LPM = 11.4;

/** โซนที่รั่วในสถานการณ์ night_leak */
const NIGHT_LEAK_ZONE_ID = 'zone-7';

/** ปั๊มที่เสื่อมในสถานการณ์ pump_degrading */
const DEGRADING_PUMP_ID = 'pump-1';

const VOLTAGE_NOMINAL = 380;
const POWER_FACTOR = 0.86;

let timer: ReturnType<typeof setInterval> | null = null;
let seeded = false;

/** ผู้เรียกที่ยังใช้งาน simulator อยู่ — หยุดเมื่อไม่มีใครดูแล้ว */
let subscriberCount = 0;

/**
 * เริ่ม simulator (ทำงานเฉพาะฝั่ง browser)
 * คืนฟังก์ชันสำหรับปล่อยการใช้งาน — เมื่อไม่มีผู้ใช้เหลือ interval จะถูกหยุด
 */
export function startSimulator(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const state = getState();
  if (!seeded) {
    seedAlerts(state);
    // โหลดผลชุดแรกจากทีม AI ตามสถานการณ์ที่ตั้งไว้
    state.anomalies = buildAnomalies(state, state.scenario);
    seeded = true;
  }

  subscriberCount += 1;
  if (timer === null) {
    timer = setInterval(() => {
      tick(getState());
      notify();
    }, TICK_MS);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    subscriberCount -= 1;
    if (subscriberCount <= 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      subscriberCount = 0;
    }
  };
}

// ─────────────────────────────────────────────────────────────
// หนึ่ง tick
// ─────────────────────────────────────────────────────────────

function tick(state: MockState): void {
  state.tick += 1;
  const at = Date.now();
  const iso = nowIso(at);

  /** ความต้องการใช้น้ำตามช่วงกะ — ทำให้กราฟมีจังหวะขึ้นลงแทนเส้นตรง */
  const demandFactor =
    1 + 0.18 * Math.sin(state.tick / 300) + 0.08 * Math.sin(state.tick / 77) + randomBetween(-0.02, 0.02);

  updateEnvironment(state, at, iso);
  const pumpRunning = updatePumpDutyCycle(state);
  updateZones(state, iso, demandFactor, pumpRunning);
  updatePumps(state, iso);
  updatePressureControl(state, at, iso);
  updateMainMeter(state, iso);
  updateTanks(state, iso);
  updateElectricNodes(state, iso, demandFactor);
  updateDevices(state, iso);
  updateConnection(state, iso);
  evaluateAlerts(state, at);
  recordHistory(state, at);
}

// ─────────────────────────────────────────────────────────────
// สภาพแวดล้อม
// ─────────────────────────────────────────────────────────────

function updateEnvironment(state: MockState, at: number, iso: string): void {
  // เวลาของวันจริง ใช้กำหนดค่ากลางของอุณหภูมิ (ร้อนสุดบ่ายสอง เย็นสุดตีห้า)
  const hour = new Date(at).getHours() + new Date(at).getMinutes() / 60;
  const diurnal = Math.sin(((hour - 9) / 24) * 2 * Math.PI);

  for (const sensor of state.sensors) {
    const spec = ENVIRONMENT_SPECS.find((item) => item.id === sensor.id);
    if (spec === undefined) continue;

    // ตู้คอนโทรลและห้องปั๊มร้อนตามโหลดปั๊มด้วย ไม่ใช่ตามอากาศอย่างเดียว
    const pumpLoad = state.pumps.reduce((sum, pump) => sum + pump.electrical.powerWatt, 0) / 6_000;
    const loadHeat = sensor.location === 'outdoor' ? 0 : pumpLoad * 2.4;

    const temperature = walk(sensor.latest.temperatureCelsius, {
      target: spec.baselineTemperatureCelsius + diurnal * 2.8 + loadHeat,
      reversion: 0.05,
      volatility: 0.06,
      min: 18,
      max: 55,
    });
    const humidity = walk(sensor.latest.humidityPercent, {
      target: spec.baselineHumidityPercent - diurnal * 6,
      reversion: 0.04,
      volatility: 0.18,
      min: 15,
      max: 99,
    });

    let rainfall: number | null = null;
    let rainDetected: boolean | null = null;
    if (spec.hasRainGauge) {
      // ฝนมาเป็นช่วง ไม่ใช่สุ่มรายวินาที — ใช้คลื่นช้าเป็นตัวเปิด/ปิด
      const rainWave = Math.sin(state.tick / 900 + 1.2);
      const raining = rainWave > 0.82;
      rainfall = raining ? roundTo(clamp((rainWave - 0.82) * 60, 0, 12), 1) : 0;
      rainDetected = raining;
    }

    sensor.latest = {
      timestamp: at,
      temperatureCelsius: roundTo(temperature, 1),
      humidityPercent: roundTo(humidity, 1),
      dewPointCelsius: dewPointOf(temperature, humidity),
      rainfallMmPerHour: rainfall,
      rainDetected,
    };
    sensor.status = worstStatus([
      statusFromRange(sensor.latest.temperatureCelsius, sensor.temperatureThresholds),
      statusFromRange(sensor.latest.humidityPercent, sensor.humidityThresholds),
    ]);
    sensor.lastSeen = iso;
    sensor.updatedAt = iso;
  }
}

function dewPointOf(temperatureCelsius: number, humidityPercent: number): number {
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * temperatureCelsius) / (b + temperatureCelsius) + Math.log(clamp(humidityPercent, 1, 100) / 100);
  return roundTo((b * alpha) / (a - alpha), 1);
}

// ─────────────────────────────────────────────────────────────
// ปั๊ม — รอบการเดิน/หยุด
// ─────────────────────────────────────────────────────────────

/** ตัดสินว่าปั๊มตัวไหนควรเดินใน tick นี้ คืน map<pumpId, boolean> */
function updatePumpDutyCycle(state: MockState): Map<string, boolean> {
  const running = new Map<string, boolean>();

  for (const pump of state.pumps) {
    const source = state.tanks.find((tank) => tank.id === pump.sourceTankId);
    const sourcePercent = source?.percentFull ?? 100;

    if (pump.controlMode === 'locked_out' || pump.runState === 'fault') {
      running.set(pump.id, false);
      continue;
    }

    if (pump.controlMode === 'manual') {
      // โหมด manual ทำตามที่คนสั่งไว้ ยกเว้นถังแห้งจริง ๆ ถึงจะตัด
      running.set(pump.id, pump.runState === 'running' && sourcePercent > 8);
      continue;
    }

    // โหมด auto: ตัดที่ระดับต่ำ กลับมาเดินเมื่อน้ำขึ้นถึง cut-in (hysteresis กันปั๊มกระพริบ)
    const wasRunning = pump.runState === 'running';
    let shouldRun = wasRunning ? sourcePercent > PUMP_CUTOUT_PERCENT : sourcePercent > PUMP_CUTIN_PERCENT;

    if (pump.role === 'vip') {
      // โซน VIP ใช้น้ำเป็นช่วง ปั๊มจึงเดินตามความต้องการ ไม่ได้เดินตลอด
      const vipDemand = Math.sin(state.tick / 220) > -0.3;
      shouldRun = shouldRun && vipDemand;
    }

    running.set(pump.id, shouldRun);
  }

  return running;
}

// ─────────────────────────────────────────────────────────────
// โซนและมิเตอร์
// ─────────────────────────────────────────────────────────────

function updateZones(
  state: MockState,
  iso: string,
  demandFactor: number,
  pumpRunning: Map<string, boolean>,
): void {
  for (const zone of state.zones) {
    const spec = ZONE_SPECS.find((item) => item.id === zone.id);
    const valve = state.valves.find((item) => item.id === zone.valveId);
    const meter = state.zoneMeters.find((item) => item.id === zone.meterId);
    if (spec === undefined || valve === undefined || meter === undefined) continue;

    const feedingPump = state.pumps.find((pump) => pump.servesZoneIds.includes(zone.id));
    const supplied = feedingPump !== undefined && (pumpRunning.get(feedingPump.id) ?? false);
    const valveOpenFraction = valve.position === 'fault' ? 0 : valve.openPercent / 100;

    // night_leak จำลอง "สภาพจริง" ที่มีน้ำรั่ว ไม่ใช่การที่หน้าบ้านไปตัดสินว่ารั่ว
    const leaking = state.scenario === 'night_leak' && zone.id === NIGHT_LEAK_ZONE_ID;
    const leakLpm = leaking ? NIGHT_LEAK_LPM : 0;
    const target = (supplied ? spec.baselineFlowLpm * demandFactor * valveOpenFraction : 0) + leakLpm;
    const flow = walk(zone.flowLpm, {
      target,
      reversion: 0.22,
      volatility: supplied ? spec.baselineFlowLpm * 0.02 : 0.05,
      min: 0,
      max: spec.baselineFlowLpm * 2.6,
    });

    zone.flowLpm = roundTo(flow, 1);
    zone.status = statusFromRange(zone.flowLpm, zone.thresholdsLpm);
    zone.lastSeen = iso;
    zone.updatedAt = iso;

    // ธงนี้เป็นสถานะจากอุปกรณ์ (ไหลทั้งที่วาล์วสั่งปิด) ไม่ใช่ข้อสรุปของ AI
    zone.leakSuspected = valve.position === 'closed' && zone.flowLpm > 1.5;

    const cubicMeters = (zone.flowLpm * TICK_MINUTES) / 1_000;
    meter.flowLpm = zone.flowLpm;
    meter.totalizerCubicMeters = roundTo(meter.totalizerCubicMeters + cubicMeters, 4);
    meter.todayCubicMeters = roundTo(meter.todayCubicMeters + cubicMeters, 4);
    meter.monthCubicMeters = roundTo(meter.monthCubicMeters + cubicMeters, 4);
    meter.status = zone.status;
    meter.lastSeen = iso;
    meter.updatedAt = iso;

    zone.todayCubicMeters = meter.todayCubicMeters;
    zone.monthCubicMeters = meter.monthCubicMeters;

    valve.lastSeen = iso;
    valve.updatedAt = iso;
  }
}

// ─────────────────────────────────────────────────────────────
// ปั๊ม — อัตราไหลและค่าไฟฟ้า
// ─────────────────────────────────────────────────────────────

function updatePumps(state: MockState, iso: string): void {
  for (const pump of state.pumps) {
    const spec = PUMP_SPECS.find((item) => item.id === pump.id);
    if (spec === undefined) continue;

    // อัตราไหลของปั๊ม = ผลรวมที่โซนปลายทางใช้จริง
    const demand = state.zones
      .filter((zone) => pump.servesZoneIds.includes(zone.id))
      .reduce((sum, zone) => sum + zone.flowLpm, 0);

    const isRunning = demand > 0.5;
    if (isRunning && pump.runState !== 'running') {
      pump.runState = 'running';
      pump.lastStartedAt = iso;
      pump.startsToday += 1;
    } else if (!isRunning && pump.runState === 'running') {
      pump.runState = 'stopped';
      pump.lastStoppedAt = iso;
    }

    pump.flowLpm = roundTo(demand, 1);

    if (pump.runState === 'running') {
      // กำลังไฟฟ้าของปั๊มหอยโข่ง: มีส่วนคงที่ราว 35% บวกส่วนที่แปรตามอัตราไหล
      const loadRatio = clamp(demand / spec.ratedFlowLpm, 0, 1.15);
      // ปั๊มเสื่อม: ใบพัดสึกทำให้ต้องออกแรงมากขึ้นเพื่อน้ำปริมาณเท่าเดิม
      const degradationFactor =
        state.scenario === 'pump_degrading' && pump.id === DEGRADING_PUMP_ID ? 1.35 : 1;
      const targetPower = spec.ratedPowerWatt * (0.35 + 0.65 * loadRatio) * degradationFactor;
      const voltage = walk(pump.electrical.voltage, {
        target: VOLTAGE_NOMINAL,
        reversion: 0.08,
        volatility: 0.35,
        min: 360,
        max: 400,
      });
      const powerWatt = walk(pump.electrical.powerWatt, {
        target: targetPower,
        reversion: 0.18,
        volatility: spec.ratedPowerWatt * 0.006,
        min: 0,
        max: spec.ratedPowerWatt * 1.6,
      });
      const current = powerWatt / (Math.sqrt(3) * voltage * POWER_FACTOR);

      pump.electrical = {
        voltage: roundTo(voltage, 1),
        current: roundTo(current, 2),
        powerWatt: roundTo(powerWatt, 0),
        energyKwh: roundTo(pump.electrical.energyKwh + (powerWatt / 1000) * (TICK_MINUTES / 60), 3),
        powerFactor: roundTo(walk(POWER_FACTOR, { target: POWER_FACTOR, reversion: 0.3, volatility: 0.004, min: 0.78, max: 0.93 }), 3),
      };
      pump.dischargePressureBar = roundTo(
        walk(pump.dischargePressureBar, {
          target: 2.6 + loadRatio * 1.1,
          reversion: 0.15,
          volatility: 0.02,
          min: 0,
          max: 6,
        }),
        2,
      );
      pump.runtimeHours = roundTo(pump.runtimeHours + TICK_MINUTES / 60, 4);
      pump.hoursUntilService = roundTo(
        state.settings.maintenance.serviceIntervalHours -
          (pump.runtimeHours % state.settings.maintenance.serviceIntervalHours),
        2,
      );
    } else {
      pump.electrical = {
        voltage: roundTo(walk(pump.electrical.voltage, { target: VOLTAGE_NOMINAL, reversion: 0.1, volatility: 0.2, min: 360, max: 400 }), 1),
        current: 0,
        powerWatt: 0,
        energyKwh: pump.electrical.energyKwh,
        powerFactor: 0,
      };
      pump.dischargePressureBar = roundTo(
        walk(pump.dischargePressureBar, { target: 0.2, reversion: 0.25, volatility: 0.01, min: 0, max: 6 }),
        2,
      );
    }

    pump.status = pumpStatus(pump, state.settings.thresholds.pumpCurrentAmp.warningHigh);
    pump.lastSeen = iso;
    pump.updatedAt = iso;
  }
}

function pumpStatus(pump: Pump, currentWarningHigh: number | null): EntityStatus {
  if (pump.runState === 'fault') return 'critical';
  if (pump.controlMode === 'locked_out') return 'offline';
  if (currentWarningHigh !== null && pump.electrical.current >= currentWarningHigh) return 'warning';
  if (pump.hoursUntilService < 50) return 'warning';
  return 'ok';
}


// ─────────────────────────────────────────────────────────────
// ระบบควบคุมแรงดัน (PID + VFD)
// ─────────────────────────────────────────────────────────────

/**
 * ลูป PID ที่ S7-1200 รันอยู่: อ่านแรงดันจาก transmitter (4–20 mA ผ่าน SM1231)
 * แล้วปรับความถี่ VFD ของปั๊มให้แรงดันเข้าใกล้ setpoint
 *
 * ที่นี่จำลองเฉพาะพฤติกรรมปลายทาง ไม่ได้อินทิเกรตสมการ PID เต็มรูป —
 * ค่า error ถูกลดทอนตามอัตราส่วนที่กำหนดโดย kp เพื่อให้เส้นกราฟมีลักษณะเดียวกับของจริง
 */
function updatePressureControl(state: MockState, at: number, iso: string): void {
  const loop = state.pressureControl;
  const pump = state.pumps.find((item) => item.id === loop.controlledPumpId);

  // โหมด headcount: จำนวนคนมากขึ้น ต้องการแรงดันสูงขึ้น
  if (loop.mode === 'headcount') {
    // คนเข้า-ออกพื้นที่เป็นช่วง ๆ ตามกะ ไม่ได้เปลี่ยนทุกวินาที
    if (state.tick % 45 === 0) {
      const base = 40 + Math.sin(state.tick / 400) * 22;
      loop.headcount = Math.max(0, Math.round(base + randomBetween(-4, 4)));
      loop.headcountUpdatedAt = iso;
    }
    const headcount = loop.headcount ?? 0;
    // 2.6 bar ตอนไม่มีคน ไต่ขึ้นได้ถึงเพดานที่ตั้งไว้
    const target = clamp(2.6 + headcount * 0.014, loop.setpointLimitsBar.min, loop.setpointLimitsBar.max);
    loop.setpointBar = roundTo(target, 2);
  }

  const running = pump !== undefined && pump.runState === 'running';
  if (!running) {
    loop.measuredPressureBar = roundTo(
      walk(loop.measuredPressureBar, { target: 0.4, reversion: 0.12, volatility: 0.01, min: 0, max: 6 }),
      2,
    );
    loop.outputPercent = 0;
    if (pump !== undefined && pump.hasVfd) {
      pump.vfdFrequencyHz = 0;
      pump.speedPercent = 0;
    }
    loop.status = 'offline';
    loop.lastSeen = iso;
    loop.updatedAt = iso;
    return;
  }

  const error = loop.setpointBar - loop.measuredPressureBar;
  const correction = error * loop.gains.kp * 0.08;
  loop.outputPercent = roundTo(clamp(loop.outputPercent + correction * 20, 25, 100), 1);

  loop.measuredPressureBar = roundTo(
    clamp(loop.measuredPressureBar + correction + randomBetween(-0.012, 0.012), 0, 6),
    2,
  );

  if (pump.hasVfd) {
    // VFD พิกัด 50 Hz — ความถี่แปรตามเอาต์พุตของ PID โดยตรง
    pump.vfdFrequencyHz = roundTo((loop.outputPercent / 100) * 50, 1);
    pump.speedPercent = loop.outputPercent;
    pump.pressureSetpointBar = pump.controlMode === 'pid' ? loop.setpointBar : null;
  }

  // เบี่ยงจาก setpoint เกิน 0.5 bar ถือว่าลูปคุมไม่อยู่
  const deviation = Math.abs(error);
  loop.status = deviation > 0.8 ? 'critical' : deviation > 0.5 ? 'warning' : 'ok';
  loop.lastSeen = iso;
  loop.updatedAt = iso;
}

// ─────────────────────────────────────────────────────────────
// ตู้ไฟรายแผนก
// ─────────────────────────────────────────────────────────────

function updateElectricNodes(state: MockState, iso: string, demandFactor: number): void {
  for (const node of state.electricNodes) {
    const spec = ELECTRIC_NODE_SPECS.find((item) => item.id === node.id);
    if (spec === undefined) continue;

    const isThreePhase = node.phase === 'three';
    const voltage = walk(node.electrical.voltage, {
      target: isThreePhase ? 380 : 230,
      reversion: 0.08,
      volatility: isThreePhase ? 0.4 : 0.3,
      min: isThreePhase ? 360 : 215,
      max: isThreePhase ? 400 : 242,
    });
    const powerWatt = walk(node.electrical.powerWatt, {
      target: spec.baselinePowerWatt * demandFactor,
      reversion: 0.12,
      volatility: spec.baselinePowerWatt * 0.004,
      min: spec.baselinePowerWatt * 0.15,
      max: spec.baselinePowerWatt * 1.45,
    });
    const powerFactor = walk(node.electrical.powerFactor, {
      target: 0.91,
      reversion: 0.25,
      volatility: 0.003,
      min: 0.82,
      max: 0.97,
    });
    const current = isThreePhase
      ? powerWatt / (Math.sqrt(3) * voltage * powerFactor)
      : powerWatt / (voltage * powerFactor);
    const energyStep = (powerWatt / 1_000) * (TICK_MINUTES / 60);

    node.electrical = {
      voltage: roundTo(voltage, 1),
      current: roundTo(current, 2),
      powerWatt: roundTo(powerWatt, 0),
      energyKwh: roundTo(node.electrical.energyKwh + energyStep, 3),
      powerFactor: roundTo(powerFactor, 3),
    };
    node.todayEnergyKwh = roundTo(node.todayEnergyKwh + energyStep, 3);
    node.monthEnergyKwh = roundTo(node.monthEnergyKwh + energyStep, 3);
    node.status = electricNodeStatus(node);
    node.lastSeen = iso;
    node.updatedAt = iso;
  }
}

function electricNodeStatus(node: ElectricNode): EntityStatus {
  const status = statusFromRange(node.electrical.current, node.currentThresholds);
  // ไฟตกกว่า 10% จากพิกัดถือว่าเตือน ถึงกระแสจะยังไม่เกิน
  const nominal = node.phase === 'three' ? 380 : 230;
  if (node.electrical.voltage < nominal * 0.9) return worstStatus([status, 'warning']);
  return status;
}

// ─────────────────────────────────────────────────────────────
// มิเตอร์หลัก — คุมการเติมถังใต้ดิน
// ─────────────────────────────────────────────────────────────

function updateMainMeter(state: MockState, iso: string): void {
  const mainTank = state.tanks.find((tank) => tank.id === 'tank-1');
  const percent = mainTank?.percentFull ?? 70;

  // วาล์วลูกลอยไฟฟ้าที่ทางเข้า: เปิดเต็มเมื่อถังพร่อง หรี่ลงเมื่อใกล้เต็ม
  let target: number;
  if (percent < 55) {
    target = MAIN_METER_SPEC.baselineFlowLpm;
  } else if (percent > 92) {
    target = 40;
  } else {
    target = MAIN_METER_SPEC.baselineFlowLpm - ((percent - 55) / 37) * (MAIN_METER_SPEC.baselineFlowLpm - 40);
  }

  const meter = state.mainMeter;
  const flow = walk(meter.flowLpm, {
    target,
    reversion: 0.12,
    volatility: 2.2,
    min: 0,
    // ท่อ 2" ที่ความเร็วน้ำ ~3.5 m/s จ่ายได้ราว 420 L/min เป็นเพดานทางกายภาพ
    max: 420,
  });

  const cubicMeters = (flow * TICK_MINUTES) / 1_000;
  meter.flowLpm = roundTo(flow, 1);
  meter.totalizerCubicMeters = roundTo(meter.totalizerCubicMeters + cubicMeters, 4);
  meter.todayCubicMeters = roundTo(meter.todayCubicMeters + cubicMeters, 4);
  meter.monthCubicMeters = roundTo(meter.monthCubicMeters + cubicMeters, 4);
  meter.inletPressureBar = roundTo(
    walk(meter.inletPressureBar, { target: 2.8, reversion: 0.06, volatility: 0.015, min: 1.2, max: 4.0 }),
    2,
  );
  meter.status = meter.inletPressureBar < 1.8 ? 'warning' : 'ok';
  meter.lastSeen = iso;
  meter.updatedAt = iso;
}

// ─────────────────────────────────────────────────────────────
// ถังน้ำ — อินทิเกรตสมดุลน้ำ
// ─────────────────────────────────────────────────────────────

function updateTanks(state: MockState, iso: string): void {
  const mainFlow = state.mainMeter.flowLpm;
  const tank1 = state.tanks.find((tank) => tank.id === 'tank-1');
  const tank2 = state.tanks.find((tank) => tank.id === 'tank-2');
  const tank3 = state.tanks.find((tank) => tank.id === 'tank-3');

  const pumpDraw = (tankId: string): number =>
    state.pumps.filter((pump) => pump.sourceTankId === tankId).reduce((sum, pump) => sum + pump.flowLpm, 0);

  // ถ่ายน้ำขึ้นถังจ่ายเป็นรอบ และหยุดทันทีถ้าถังใต้ดินเหลือน้อย
  const tank2Percent = tank2?.percentFull ?? 100;
  const sourceHasWater = (tank1?.percentFull ?? 0) > 25;
  if (transferActive && (tank2Percent >= TRANSFER_STOP_PERCENT || !sourceHasWater)) {
    transferActive = false;
  } else if (!transferActive && tank2Percent <= TRANSFER_START_PERCENT && sourceHasWater) {
    transferActive = true;
  }
  const transferLpm = transferActive ? TRANSFER_LPM : 0;

  if (tank1 !== undefined) {
    applyTankFlow(tank1, mainFlow * 0.85, pumpDraw('tank-1') + transferLpm, iso);
  }
  if (tank2 !== undefined) {
    applyTankFlow(tank2, transferLpm, pumpDraw('tank-2'), iso);
  }
  if (tank3 !== undefined) {
    // บ่อสำรองรับส่วนแบ่งเล็กน้อยจากท่อเมน และระเหยวันละเล็กน้อย
    applyTankFlow(tank3, mainFlow * 0.15, pumpDraw('tank-3') + 0.6, iso);
  }
}

function applyTankFlow(tank: Tank, inflowLpm: number, outflowLpm: number, iso: string): void {
  const netLpm = inflowLpm - outflowLpm;
  const nextLiters = clamp(tank.currentLiters + netLpm * TICK_MINUTES, 0, tank.capacityLiters);

  tank.currentLiters = roundTo(nextLiters, 1);
  tank.percentFull = roundTo((nextLiters / tank.capacityLiters) * 100, 2);
  tank.levelMeters = roundTo((tank.percentFull / 100) * tank.heightMeters, 3);
  tank.inflowLpm = roundTo(inflowLpm, 1);
  tank.outflowLpm = roundTo(outflowLpm, 1);
  tank.netFlowLpm = roundTo(netLpm, 1);

  // ประมาณเวลาถึงเต็ม/ถึงหมด — ไม่มีความหมายเมื่อสมดุลเกือบนิ่ง
  const NEGLIGIBLE_LPM = 1;
  tank.minutesToFull =
    netLpm > NEGLIGIBLE_LPM ? roundTo((tank.capacityLiters - tank.currentLiters) / netLpm, 0) : null;
  tank.minutesToEmpty = netLpm < -NEGLIGIBLE_LPM ? roundTo(tank.currentLiters / -netLpm, 0) : null;

  tank.status = statusFromRange(tank.percentFull, tank.thresholdsPercent);
  tank.lastSeen = iso;
  tank.updatedAt = iso;
}

// ─────────────────────────────────────────────────────────────
// อุปกรณ์เครือข่าย
// ─────────────────────────────────────────────────────────────

function updateDevices(state: MockState, iso: string): void {
  for (const device of state.devices) {
    const spec = DEVICE_SPECS.find((item) => item.id === device.id);
    if (spec === undefined) continue;

    device.uptimeSeconds += TICK_MS / 1_000;

    if (spec.baselineRssi !== null) {
      const rssi = walk(device.rssi ?? spec.baselineRssi, {
        target: spec.baselineRssi,
        reversion: 0.06,
        volatility: 0.9,
        min: -95,
        max: -35,
      });
      device.rssi = Math.round(rssi);

      // สัญญาณอ่อนกว่า -85 dBm มีโอกาสหลุดและต้องเชื่อมต่อใหม่
      if (device.rssi < -85 && chance(0.05)) {
        device.reconnectCount += 1;
        device.uptimeSeconds = 0;
        device.lastError = 'Wi-Fi disconnected (weak signal)';
        device.lastErrorAt = iso;
      }
    }

    if (spec.baselineFreeHeapBytes !== null) {
      device.freeHeapBytes = Math.round(
        walk(device.freeHeapBytes ?? spec.baselineFreeHeapBytes, {
          target: spec.baselineFreeHeapBytes,
          reversion: 0.04,
          volatility: 380,
          min: spec.baselineFreeHeapBytes * 0.55,
          max: spec.baselineFreeHeapBytes * 1.08,
        }),
      );
    }

    device.status = deviceStatus(device);
    device.lastSeen = iso;
    device.updatedAt = iso;
  }
}

function deviceStatus(device: Device): EntityStatus {
  if (device.freeHeapBytes !== null && device.freeHeapBytes < 40_000) return 'critical';
  if (device.rssi !== null && device.rssi < -85) return 'critical';
  if (device.rssi !== null && device.rssi < -78) return 'warning';
  if (device.reconnectCount > 40) return 'warning';
  return 'ok';
}

function updateConnection(state: MockState, iso: string): void {
  const offlineDeviceCount = state.devices.filter((device) => device.status === 'offline').length;
  state.connection = {
    online: true,
    lastSyncAt: iso,
    latencyMs: Math.round(walk(state.connection.latencyMs, { target: 12, reversion: 0.2, volatility: 1.6, min: 3, max: 90 })),
    offlineDeviceCount,
  };
}

// ─────────────────────────────────────────────────────────────
// ประเมินเงื่อนไข alert
// ─────────────────────────────────────────────────────────────

function evaluateAlerts(state: MockState, at: number): void {
  // ตรวจทุก 15 tick (30 วินาที) — ไม่ต้องตรวจทุกรอบให้เปลืองและสร้าง alert ถี่เกินจริง
  if (state.tick % 15 !== 0) return;

  for (const tank of state.tanks) {
    const low = tank.thresholdsPercent.warningLow;
    if (low !== null && tank.percentFull <= low) {
      raiseAlert(state, {
        severity: tank.status === 'critical' ? 'critical' : 'warning',
        code: 'TANK_LEVEL_LOW',
        sourceType: 'tank',
        sourceId: tank.id,
        sourceName: tank.name,
        messageTh: `ระดับน้ำ${tank.name}ต่ำกว่าเกณฑ์ (${tank.percentFull.toFixed(1)}%)`,
        messageEn: `${tank.nameEn} level below threshold (${tank.percentFull.toFixed(1)}%)`,
        triggerValue: tank.percentFull,
        thresholdValue: low,
        unit: '%',
        at,
      });
    } else if (low !== null && tank.percentFull > low + 5) {
      resolveAlerts(state, 'TANK_LEVEL_LOW', tank.id, at);
    }
  }

  for (const zone of state.zones) {
    if (zone.leakSuspected) {
      raiseAlert(state, {
        severity: 'critical',
        code: 'ZONE_LEAK_SUSPECTED',
        sourceType: 'zone',
        sourceId: zone.id,
        sourceName: zone.name,
        messageTh: `พบการไหลขณะวาล์วสั่งปิดที่${zone.name} — สงสัยรั่วหรือวาล์วค้าง`,
        messageEn: `Flow detected while valve is closed at ${zone.nameEn} — suspected leak or stuck valve`,
        triggerValue: zone.flowLpm,
        thresholdValue: 0,
        unit: 'L/min',
        at,
      });
    } else {
      resolveAlerts(state, 'ZONE_LEAK_SUSPECTED', zone.id, at);
    }
  }

  for (const device of state.devices) {
    if (device.status === 'critical' && device.rssi !== null) {
      raiseAlert(state, {
        severity: 'critical',
        code: 'DEVICE_WEAK_SIGNAL',
        sourceType: 'device',
        sourceId: device.id,
        sourceName: device.name,
        messageTh: `สัญญาณ Wi-Fi ต่ำมากที่ ${device.name} (${device.rssi} dBm)`,
        messageEn: `Very weak Wi-Fi at ${device.nameEn} (${device.rssi} dBm)`,
        triggerValue: device.rssi,
        thresholdValue: -85,
        unit: 'dBm',
        at,
      });
    }
  }

  for (const sensor of state.sensors) {
    const criticalHigh = sensor.temperatureThresholds.criticalHigh;
    if (criticalHigh !== null && sensor.latest.temperatureCelsius >= criticalHigh) {
      raiseAlert(state, {
        severity: 'critical',
        code: 'ENV_TEMP_HIGH',
        sourceType: 'sensor',
        sourceId: sensor.id,
        sourceName: sensor.name,
        messageTh: `อุณหภูมิที่${sensor.locationLabel}สูงเกินเกณฑ์วิกฤต (${sensor.latest.temperatureCelsius.toFixed(1)}°C)`,
        messageEn: `Temperature at ${sensor.locationLabelEn} above critical threshold (${sensor.latest.temperatureCelsius.toFixed(1)}°C)`,
        triggerValue: sensor.latest.temperatureCelsius,
        thresholdValue: criticalHigh,
        unit: '°C',
        at,
      });
    } else if (criticalHigh !== null && sensor.latest.temperatureCelsius < criticalHigh - 1.5) {
      resolveAlerts(state, 'ENV_TEMP_HIGH', sensor.id, at);
    }
  }
}


// ─────────────────────────────────────────────────────────────
// บันทึกจุดกราฟ
// ─────────────────────────────────────────────────────────────

function recordHistory(state: MockState, at: number): void {
  for (const tank of state.tanks) {
    pushHistory(state, tank.id, 'level_percent', at, tank.percentFull);
    pushHistory(state, tank.id, 'level_liters', at, tank.currentLiters);
    pushHistory(state, tank.id, 'net_flow_lpm', at, tank.netFlowLpm);
  }

  for (const pump of state.pumps) {
    pushHistory(state, pump.id, 'flow_lpm', at, pump.flowLpm);
    pushHistory(state, pump.id, 'power_watt', at, pump.electrical.powerWatt);
    pushHistory(state, pump.id, 'current_amp', at, pump.electrical.current);
  }

  let zoneOutflow = 0;
  for (const zone of state.zones) {
    zoneOutflow += zone.flowLpm;
    pushHistory(state, zone.id, 'flow_lpm', at, zone.flowLpm);
  }

  for (const node of state.electricNodes) {
    pushHistory(state, node.id, 'power_watt', at, node.electrical.powerWatt);
    pushHistory(state, node.id, 'current_amp', at, node.electrical.current);
  }

  const loop = state.pressureControl;
  pushHistory(state, loop.id, 'pressure_bar', at, loop.measuredPressureBar);
  if (loop.headcount !== null) {
    pushHistory(state, loop.id, 'headcount', at, loop.headcount);
  }
  const vfdPump = state.pumps.find((pump) => pump.hasVfd);
  if (vfdPump?.vfdFrequencyHz != null) {
    pushHistory(state, vfdPump.id, 'vfd_frequency_hz', at, vfdPump.vfdFrequencyHz);
  }

  pushHistory(state, state.mainMeter.id, 'flow_lpm', at, state.mainMeter.flowLpm);
  pushHistory(state, 'system', 'main_inflow_lpm', at, state.mainMeter.flowLpm);
  pushHistory(state, 'system', 'zone_outflow_lpm', at, roundTo(zoneOutflow, 1));

  for (const sensor of state.sensors) {
    pushHistory(state, sensor.id, 'temperature', at, sensor.latest.temperatureCelsius);
    pushHistory(state, sensor.id, 'humidity', at, sensor.latest.humidityPercent);
    if (sensor.latest.rainfallMmPerHour !== null) {
      pushHistory(state, sensor.id, 'rainfall', at, sensor.latest.rainfallMmPerHour);
    }
  }
}

/** ให้ zone/valve เรียกใช้ตอนสั่งงานจากหน้า Control */
export function tickOnce(): void {
  tick(getState());
  notify();
}
