/**
 * สถานะ mock ที่มีชีวิต — เป็นแหล่งข้อมูลเดียวที่ service layer อ่าน
 *
 * ★ component ห้าม import ไฟล์นี้โดยตรง ต้องเรียกผ่าน lib/services/ เท่านั้น
 *
 * ค่าทั้งหมดเดินด้วยฟิสิกส์อย่างง่าย: น้ำเข้าจากมิเตอร์หลัก → ถัง → ปั๊ม → โซน
 * ระดับน้ำจึงเป็นผลของ (inflow − outflow) จริง ๆ ไม่ใช่ตัวเลขสุ่มแยกกัน
 */

import type {
  Alert,
  AlertAcknowledgement,
  AnomalyEvent,
  CommandLogEntry,
  CommandSchedule,
  FirmwareUpdateJob,
  ConnectionStatus,
  Department,
  Device,
  ElectricNode,
  EntityStatus,
  EnvironmentSensor,
  MainMeter,
  MetricKey,
  MockScenario,
  NotificationDelivery,
  PressureControl,
  Pump,
  SystemSettings,
  Tank,
  TankLevelPoint,
  ThresholdRange,
  TimeSeriesPoint,
  User,
  Valve,
  WaterMeter,
  Zone,
} from '@/lib/types';
import { ENVIRONMENT_SPECS, MAIN_METER_SPEC, PUMP_SPECS, TANK_SPECS, ZONE_SPECS } from './hardware';
import { DEVICE_SPECS } from './network';
import { DEPARTMENTS, ELECTRIC_NODE_SPECS, USERS, toActorRef } from './organization';
import { DEFAULT_SETTINGS } from './settings';
import { clamp, randomBetween, roundTo, rng } from './random';

/** ระยะห่างระหว่าง tick ของ simulator */
export const TICK_MS = 2_000;

/**
 * คีย์จำสถานการณ์สาธิตข้ามการโหลดหน้า
 * ★ มีเฉพาะตอนใช้ mock — state อื่นทั้งหมดตั้งใจให้รีเซ็ตเมื่อรีเฟรช
 *   แต่ scenario ต้องอยู่ข้ามหน้า ไม่งั้นสลับไป night_leak แล้วเดินไปหน้า Overview
 *   จะกลับมาเป็นปกติทันที สาธิตการ์ดวิกฤตไม่ได้
 */
const SCENARIO_STORAGE_KEY = 'wcm.mockScenario';

function readStoredScenario(): MockScenario {
  if (typeof window === 'undefined') return 'normal';
  try {
    const stored = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
    if (stored === 'normal' || stored === 'night_leak' || stored === 'pump_degrading') return stored;
  } catch {
    // เบราว์เซอร์ที่ปิด storage — ใช้ค่าตั้งต้นไป
  }
  return 'normal';
}

/** จำสถานการณ์ที่เลือกไว้ เรียกจาก service ตอนสลับ */
export function persistScenario(scenario: MockScenario): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SCENARIO_STORAGE_KEY, scenario);
  } catch {
    // จำไม่ได้ก็ไม่เป็นไร สลับในหน้าปัจจุบันยังทำงานปกติ
  }
}

/** จำนวนจุดสูงสุดที่เก็บต่อหนึ่งเส้นกราฟ (ราว 40 นาทีที่ 2 วินาที/จุด) */
const HISTORY_LIMIT = 1_200;

/** ระยะเวลาที่ backfill กราฟตอนเริ่มระบบ */
const BACKFILL_MINUTES = 60;
const BACKFILL_STEP_MS = 30_000;

/**
 * ความกดอากาศ/ความเข้มแสง backfill ยาวกว่า เพราะแนวโน้มความกดอากาศต้องเทียบย้อน 3 ชม.
 * ถ้า backfill แค่ 60 นาที หน้าจอจะขึ้น "—" จนกว่าจะเปิดทิ้งไว้ครบ 3 ชั่วโมง
 */
const WEATHER_BACKFILL_HOURS = 4;
const WEATHER_BACKFILL_STEP_MS = 60_000;

export interface MockState {
  departments: Department[];
  users: User[];
  tanks: Tank[];
  pumps: Pump[];
  zones: Zone[];
  valves: Valve[];
  zoneMeters: WaterMeter[];
  mainMeter: MainMeter;
  sensors: EnvironmentSensor[];
  electricNodes: ElectricNode[];
  pressureControl: PressureControl;
  devices: Device[];
  alerts: Alert[];
  /** ผลจากทีม AI — mock ปล่อยเป็นชุดสำเร็จรูปตาม scenario ไม่ได้คำนวณเองที่หน้าบ้าน */
  anomalies: AnomalyEvent[];
  acknowledgements: AlertAcknowledgement[];
  deliveries: NotificationDelivery[];
  commandLog: CommandLogEntry[];
  /** ตารางสั่งงานล่วงหน้า */
  schedules: CommandSchedule[];
  /** งานอัปเดตเฟิร์มแวร์ที่กำลังเดินอยู่ */
  firmwareJobs: FirmwareUpdateJob[];
  settings: SystemSettings;
  connection: ConnectionStatus;
  /** ประวัติกราฟ key = `${entityId}:${metric}` */
  history: Map<string, TimeSeriesPoint[]>;
  /**
   * ปริมาณน้ำรวมในถังทุกใบ ณ ต้นรอบที่ใช้คิด unaccounted water
   * จำเป็นสำหรับหัก Δstorage ออกจากผลต่าง (มิเตอร์หลัก − Σโซน)
   */
  storageBaselineLiters: number;
  storageBaselineAt: string;
  /** สถานการณ์สาธิตที่เลือกอยู่ — มีเฉพาะใน mock */
  scenario: MockScenario;
  tick: number;
}

// ─────────────────────────────────────────────────────────────
// ตัวช่วย
// ─────────────────────────────────────────────────────────────

export function nowIso(at: number = Date.now()): string {
  return new Date(at).toISOString();
}

/** แปลงค่าวัดเป็นสถานะสี ตามขอบเขตเตือน */
export function statusFromRange(value: number, range: ThresholdRange): EntityStatus {
  if (range.criticalLow !== null && value <= range.criticalLow) return 'critical';
  if (range.criticalHigh !== null && value >= range.criticalHigh) return 'critical';
  if (range.warningLow !== null && value <= range.warningLow) return 'warning';
  if (range.warningHigh !== null && value >= range.warningHigh) return 'warning';
  return 'ok';
}

/** สถานะที่แย่ที่สุดของกลุ่ม ใช้สรุปภาพรวม */
export function worstStatus(statuses: readonly EntityStatus[]): EntityStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('offline')) return 'offline';
  if (statuses.includes('warning')) return 'warning';
  return 'ok';
}

/**
 * เทียบปริมาตร (ลิตร) กลับเป็นระดับ (เมตร) จากตารางของบ่อ
 * บ่อขุดผนังลาดใช้สูตร level × area ไม่ได้ ต้องประมาณเชิงเส้นระหว่างจุดในตาราง
 */
export function levelFromVolume(table: TankLevelPoint[], liters: number): number {
  if (table.length === 0) return 0;
  const first = table[0];
  const last = table[table.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (liters <= first.volumeLiters) return first.levelMeters;
  if (liters >= last.volumeLiters) return last.levelMeters;

  for (let index = 1; index < table.length; index += 1) {
    const lower = table[index - 1];
    const upper = table[index];
    if (lower === undefined || upper === undefined) continue;
    if (liters <= upper.volumeLiters) {
      const span = upper.volumeLiters - lower.volumeLiters;
      const ratio = span === 0 ? 0 : (liters - lower.volumeLiters) / span;
      return roundTo(lower.levelMeters + ratio * (upper.levelMeters - lower.levelMeters), 3);
    }
  }
  return last.levelMeters;
}

/**
 * ดัชนีความร้อน (Rothfusz regression ที่ NOAA ใช้)
 * สูตรใช้หน่วยฟาเรนไฮต์ จึงต้องแปลงไป-กลับ และมีผลจริงเมื่ออุณหภูมิเกิน 27°C
 * ต่ำกว่านั้นคืนอุณหภูมิจริง เพราะความชื้นยังไม่ทำให้รู้สึกร้อนขึ้น
 */
export function heatIndex(temperatureCelsius: number, humidityPercent: number): number {
  if (temperatureCelsius < 27) return roundTo(temperatureCelsius, 1);

  const t = (temperatureCelsius * 9) / 5 + 32;
  const r = humidityPercent;
  const hf =
    -42.379 +
    2.04901523 * t +
    10.14333127 * r -
    0.22475541 * t * r -
    0.00683783 * t * t -
    0.05481717 * r * r +
    0.00122874 * t * t * r +
    0.00085282 * t * r * r -
    0.00000199 * t * t * r * r;
  return roundTo(((hf - 32) * 5) / 9, 1);
}

/** จุดน้ำค้าง (Magnus formula) — ใช้เตือนไอน้ำเกาะในตู้คอนโทรล */
function dewPoint(temperatureCelsius: number, humidityPercent: number): number {
  const a = 17.27;
  const b = 237.7;
  const rh = clamp(humidityPercent, 1, 100) / 100;
  const alpha = (a * temperatureCelsius) / (b + temperatureCelsius) + Math.log(rh);
  return roundTo((b * alpha) / (a - alpha), 1);
}

// ─────────────────────────────────────────────────────────────
// สร้างสถานะตั้งต้น
// ─────────────────────────────────────────────────────────────

function createInitialState(): MockState {
  const at = Date.now();
  const iso = nowIso(at);
  const settings = DEFAULT_SETTINGS;

  const tanks: Tank[] = TANK_SPECS.map((spec) => {
    const currentLiters = roundTo((spec.capacityLiters * spec.initialPercent) / 100, 0);
    const percentFull = roundTo((currentLiters / spec.capacityLiters) * 100, 1);
    const thresholds = settings.thresholds.tankLevelPercent[spec.id] ?? {
      criticalLow: 20,
      warningLow: 35,
      warningHigh: 95,
      criticalHigh: 98,
    };
    return {
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      status: statusFromRange(percentFull, thresholds),
      lastSeen: iso,
      updatedAt: iso,
      role: spec.role,
      shape: spec.shape,
      levelSource: spec.levelSource,
      levelToVolumeTable: spec.levelToVolumeTable,
      // บ่อสำรองยังไม่มีเซนเซอร์ — ค่าล่าสุดมาจากที่ช่างจดไว้เมื่อเช้า
      manualReadingAt: spec.levelSource === 'manual' ? nowIso(at - 5_400_000) : null,
      manualReadingBy: spec.levelSource === 'manual' ? toActorRef('user-somchai') : null,
      capacityLiters: spec.capacityLiters,
      currentLiters,
      percentFull,
      levelMeters:
        spec.levelToVolumeTable === null
          ? roundTo((percentFull / 100) * spec.heightMeters, 2)
          : levelFromVolume(spec.levelToVolumeTable, currentLiters),
      heightMeters: spec.heightMeters,
      inflowLpm: 0,
      outflowLpm: 0,
      netFlowLpm: 0,
      thresholdsPercent: thresholds,
      minutesToFull: null,
      minutesToEmpty: null,
      deviceId: spec.deviceId,
      location: spec.location,
      locationEn: spec.locationEn,
    };
  });

  const pumps: Pump[] = PUMP_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    nameEn: spec.nameEn,
    status: 'ok',
    lastSeen: iso,
    updatedAt: iso,
    role: spec.role,
    runState: spec.initiallyRunning ? 'running' : 'stopped',
    controlMode: spec.hasVfd ? 'pid' : 'auto',
    hasVfd: spec.hasVfd,
    vfdFrequencyHz: spec.hasVfd ? 38.5 : null,
    speedPercent: spec.hasVfd ? 77 : null,
    pressureSetpointBar: spec.hasVfd ? 3.2 : null,
    electrical: {
      voltage: spec.initiallyRunning ? 383.2 : 380.1,
      current: spec.initiallyRunning ? roundTo(spec.ratedPowerWatt / (Math.sqrt(3) * 380 * 0.86), 2) : 0,
      powerWatt: spec.initiallyRunning ? spec.ratedPowerWatt * 0.88 : 0,
      energyKwh: roundTo(spec.initialRuntimeHours * (spec.ratedPowerWatt / 1000) * 0.72, 1),
      powerFactor: spec.initiallyRunning ? 0.86 : 0,
    },
    flowLpm: spec.initiallyRunning ? spec.ratedFlowLpm * 0.72 : 0,
    dischargePressureBar: spec.initiallyRunning ? 3.1 : 0.2,
    runtimeHours: spec.initialRuntimeHours,
    startsToday: spec.initiallyRunning ? 3 : 1,
    lastStartedAt: spec.initiallyRunning ? nowIso(at - 4_200_000) : nowIso(at - 26_400_000),
    lastStoppedAt: spec.initiallyRunning ? nowIso(at - 18_600_000) : nowIso(at - 20_100_000),
    faultCode: null,
    faultMessage: null,
    hoursUntilService: roundTo(
      settings.maintenance.serviceIntervalHours - (spec.initialRuntimeHours % settings.maintenance.serviceIntervalHours),
      1,
    ),
    sourceTankId: spec.sourceTankId,
    servesZoneIds: [...spec.servesZoneIds],
    deviceId: spec.deviceId,
  }));

  const valves: Valve[] = ZONE_SPECS.map((spec, index) => ({
    id: spec.valveId,
    name: `วาล์วโซน ${spec.zoneNumber}`,
    nameEn: `Zone ${spec.zoneNumber} Valve`,
    status: 'ok',
    lastSeen: iso,
    updatedAt: iso,
    zoneId: spec.id,
    position: 'open',
    openPercent: 100,
    remoteEnabled: true,
    lastCommandId: null,
    lastActuatedAt: nowIso(at - 86_400_000 * (index + 1)),
    cycleCount: 120 + index * 37,
    deviceId: spec.valveDeviceId,
  }));

  const zoneMeters: WaterMeter[] = ZONE_SPECS.map((spec) => {
    const todayCubicMeters = roundTo((spec.baselineFlowLpm * 60 * 9) / 1000, 2);
    return {
      id: spec.meterId,
      name: `มิเตอร์โซน ${spec.zoneNumber}`,
      nameEn: `Zone ${spec.zoneNumber} Meter`,
      status: 'ok',
      lastSeen: iso,
      updatedAt: iso,
      pipeSizeInches: 1,
      flowLpm: spec.baselineFlowLpm,
      totalizerCubicMeters: roundTo(randomBetween(4_000, 26_000), 2),
      todayCubicMeters,
      monthCubicMeters: roundTo(todayCubicMeters * 9.4, 2),
      pulsesPerLiter: 450,
      zoneId: spec.id,
      deviceId: spec.meterDeviceId,
    };
  });

  const zones: Zone[] = ZONE_SPECS.map((spec) => {
    const meter = zoneMeters.find((item) => item.id === spec.meterId);
    const todayCubicMeters = meter?.todayCubicMeters ?? 0;
    const thresholds = settings.thresholds.zoneFlowLpm[spec.id] ?? {
      criticalLow: null,
      warningLow: null,
      warningHigh: null,
      criticalHigh: null,
    };
    return {
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      status: 'ok',
      lastSeen: iso,
      updatedAt: iso,
      zoneNumber: spec.zoneNumber,
      area: spec.area,
      areaEn: spec.areaEn,
      departmentId: spec.departmentId,
      meterId: spec.meterId,
      valveId: spec.valveId,
      flowLpm: spec.baselineFlowLpm,
      todayCubicMeters,
      monthCubicMeters: roundTo(todayCubicMeters * 9.4, 2),
      dailyQuotaCubicMeters: spec.dailyQuotaCubicMeters,
      thresholdsLpm: thresholds,
      isVip: spec.isVip,
      leakSuspected: false,
    };
  });

  const mainTodayCubicMeters = roundTo(
    zones.reduce((sum, zone) => sum + zone.todayCubicMeters, 0) * 1.06,
    2,
  );
  const mainMeter: MainMeter = {
    id: MAIN_METER_SPEC.id,
    name: MAIN_METER_SPEC.name,
    nameEn: MAIN_METER_SPEC.nameEn,
    status: 'ok',
    lastSeen: iso,
    updatedAt: iso,
    pipeSizeInches: MAIN_METER_SPEC.pipeSizeInches,
    flowLpm: MAIN_METER_SPEC.baselineFlowLpm,
    totalizerCubicMeters: 184_205.4,
    todayCubicMeters: mainTodayCubicMeters,
    monthCubicMeters: roundTo(mainTodayCubicMeters * 9.4, 2),
    pulsesPerLiter: 100,
    zoneId: null,
    deviceId: MAIN_METER_SPEC.deviceId,
    supplierName: MAIN_METER_SPEC.supplierName,
    supplierNameEn: MAIN_METER_SPEC.supplierNameEn,
    supplierMeterNo: MAIN_METER_SPEC.supplierMeterNo,
    inletPressureBar: 2.8,
  };

  const sensors: EnvironmentSensor[] = ENVIRONMENT_SPECS.map((spec) => {
    const temperatureCelsius = roundTo(spec.baselineTemperatureCelsius, 1);
    const humidityPercent = roundTo(spec.baselineHumidityPercent, 1);
    return {
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      status: statusFromRange(temperatureCelsius, settings.thresholds.temperatureCelsius),
      lastSeen: iso,
      updatedAt: iso,
      location: spec.location,
      locationLabel: spec.locationLabel,
      locationLabelEn: spec.locationLabelEn,
      latest: {
        timestamp: at,
        temperatureCelsius,
        humidityPercent,
        dewPointCelsius: dewPoint(temperatureCelsius, humidityPercent),
        heatIndexCelsius: heatIndex(temperatureCelsius, humidityPercent),
        pressureHpa: spec.baselinePressureHpa,
        illuminanceLux: spec.peakIlluminanceLux === null ? null : Math.round(spec.peakIlluminanceLux * 0.42),
        rainfallMmPerHour: spec.hasRainGauge ? 0 : null,
        rainfallTodayMm: spec.hasRainGauge ? 2.4 : null,
        rainfallMonthMm: spec.hasRainGauge ? 118.6 : null,
        rainDetected: spec.hasRainGauge ? false : null,
      },
      temperatureThresholds: settings.thresholds.temperatureCelsius,
      humidityThresholds: settings.thresholds.humidityPercent,
      hasRainGauge: spec.hasRainGauge,
      hasWeatherSensors: spec.hasWeatherSensors,
      pressureTrend3h: null,
      pressureChange3hHpa: null,
      deviceId: spec.deviceId,
    };
  });

  const devices: Device[] = DEVICE_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    nameEn: spec.nameEn,
    // node ที่ reconnect ถี่ผิดปกติเริ่มต้นเป็นสถานะเตือน
    status: spec.initialReconnectCount > 40 ? 'warning' : 'ok',
    lastSeen: iso,
    updatedAt: iso,
    kind: spec.kind,
    role: spec.role,
    model: spec.model,
    expansionModules: [...spec.expansionModules],
    protocol: spec.protocol,
    fieldbus: spec.fieldbus,
    linkType: spec.linkType,
    ip: spec.ip,
    vlan: spec.vlan,
    mac: spec.mac,
    port: spec.port,
    rssi: spec.baselineRssi,
    firmware: spec.firmware,
    uptimeSeconds: spec.initialUptimeSeconds,
    freeHeapBytes: spec.baselineFreeHeapBytes,
    reconnectCount: spec.initialReconnectCount,
    lastError: spec.initialReconnectCount > 40 ? 'MQTT keepalive timeout' : null,
    lastErrorAt: spec.initialReconnectCount > 40 ? nowIso(at - 1_920_000) : null,
    linkedEntityIds: [...spec.linkedEntityIds],
    location: spec.location,
    locationEn: spec.locationEn,
  }));

  const electricNodes: ElectricNode[] = ELECTRIC_NODE_SPECS.map((spec) => {
    const voltage = spec.phase === 'three' ? 383.1 : 228.4;
    const powerFactor = 0.91;
    const current =
      spec.phase === 'three'
        ? spec.baselinePowerWatt / (Math.sqrt(3) * voltage * powerFactor)
        : spec.baselinePowerWatt / (voltage * powerFactor);
    const todayEnergyKwh = roundTo((spec.baselinePowerWatt / 1_000) * 9.2, 1);
    const thresholds = settings.thresholds.electricCurrentAmp[spec.id] ?? {
      criticalLow: null,
      warningLow: null,
      warningHigh: null,
      criticalHigh: null,
    };
    return {
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      status: statusFromRange(current, thresholds),
      lastSeen: iso,
      updatedAt: iso,
      departmentId: spec.departmentId,
      phase: spec.phase,
      electrical: {
        voltage: roundTo(voltage, 1),
        current: roundTo(current, 2),
        powerWatt: spec.baselinePowerWatt,
        energyKwh: roundTo(todayEnergyKwh * 28.4, 1),
        powerFactor,
      },
      todayEnergyKwh,
      monthEnergyKwh: roundTo(todayEnergyKwh * 9.4, 1),
      breakerRatingAmp: spec.breakerRatingAmp,
      currentThresholds: thresholds,
      panelName: spec.panelName,
      panelNameEn: spec.panelNameEn,
      deviceId: spec.deviceId,
    };
  });

  const vfdPump = PUMP_SPECS.find((spec) => spec.hasVfd);
  const pressureControl: PressureControl = {
    id: 'pressure-control-1',
    name: 'ระบบควบคุมแรงดันน้ำ',
    nameEn: 'Pressure Control Loop',
    status: 'ok',
    lastSeen: iso,
    updatedAt: iso,
    setpointBar: 3.2,
    measuredPressureBar: 3.18,
    mode: 'headcount',
    headcount: 46,
    headcountUpdatedAt: nowIso(at - 90_000),
    outputPercent: 77,
    gains: { kp: 1.8, ki: 0.35, kd: 0.05 },
    controlledPumpId: vfdPump?.id ?? 'pump-3',
    setpointLimitsBar: { min: 1.5, max: 4.5 },
  };

  const connection: ConnectionStatus = {
    online: true,
    lastSyncAt: iso,
    latencyMs: 12,
    offlineDeviceCount: 0,
  };

  return {
    departments: [...DEPARTMENTS],
    users: [...USERS],
    tanks,
    pumps,
    zones,
    valves,
    zoneMeters,
    mainMeter,
    sensors,
    electricNodes,
    pressureControl,
    devices,
    alerts: [],
    anomalies: [],
    acknowledgements: [],
    deliveries: [],
    commandLog: [],
    schedules: [],
    firmwareJobs: [],
    settings,
    connection,
    history: new Map(),
    storageBaselineLiters: tanks.reduce((sum, tank) => sum + tank.currentLiters, 0),
    storageBaselineAt: iso,
    scenario: readStoredScenario(),
    tick: 0,
  };
}

// ─────────────────────────────────────────────────────────────
// singleton + การแจ้งเตือนผู้ติดตาม
// ─────────────────────────────────────────────────────────────

let state: MockState | null = null;
const listeners = new Set<() => void>();

export function getState(): MockState {
  if (state === null) {
    state = createInitialState();
    backfillHistory(state);
  }
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

// ─────────────────────────────────────────────────────────────
// ประวัติกราฟ
// ─────────────────────────────────────────────────────────────

export function historyKey(entityId: string, metric: MetricKey): string {
  return `${entityId}:${metric}`;
}

export function pushHistory(
  target: MockState,
  entityId: string,
  metric: MetricKey,
  timestamp: number,
  value: number,
): void {
  const key = historyKey(entityId, metric);
  const series = target.history.get(key);
  if (series === undefined) {
    target.history.set(key, [{ timestamp, value }]);
    return;
  }
  series.push({ timestamp, value });
  if (series.length > HISTORY_LIMIT) {
    series.splice(0, series.length - HISTORY_LIMIT);
  }
}

export function readHistory(entityId: string, metric: MetricKey): TimeSeriesPoint[] {
  return getState().history.get(historyKey(entityId, metric)) ?? [];
}

/**
 * เติมประวัติย้อนหลัง 60 นาทีตอนเริ่มระบบ
 * เพื่อให้กราฟมีเส้นให้ดูทันทีที่เปิดหน้า ไม่ต้องรอสะสมจุด
 */
function backfillHistory(target: MockState): void {
  const now = Date.now();
  const steps = Math.floor((BACKFILL_MINUTES * 60_000) / BACKFILL_STEP_MS);

  for (let step = steps; step >= 1; step -= 1) {
    const timestamp = now - step * BACKFILL_STEP_MS;
    // ตัวคูณตามเวลาของวัน ทำให้เส้นย้อนหลังมีรูปทรงเหมือนกะทำงานจริง
    const phase = Math.sin((step / steps) * Math.PI * 1.5);
    const jitter = () => randomBetween(0.94, 1.06);

    for (const tank of target.tanks) {
      const percent = clamp(tank.percentFull + phase * 3.5 + randomBetween(-0.4, 0.4), 5, 99);
      pushHistory(target, tank.id, 'level_percent', timestamp, roundTo(percent, 1));
      pushHistory(target, tank.id, 'level_liters', timestamp, roundTo((percent / 100) * tank.capacityLiters, 0));
    }

    for (const pump of target.pumps) {
      const running = pump.runState === 'running';
      pushHistory(target, pump.id, 'flow_lpm', timestamp, running ? roundTo(pump.flowLpm * jitter(), 1) : 0);
      pushHistory(target, pump.id, 'power_watt', timestamp, running ? roundTo(pump.electrical.powerWatt * jitter(), 0) : 0);
    }

    let zoneTotal = 0;
    for (const zone of target.zones) {
      const flow = roundTo(zone.flowLpm * (1 + phase * 0.18) * jitter(), 1);
      zoneTotal += flow;
      pushHistory(target, zone.id, 'flow_lpm', timestamp, flow);
    }

    const mainFlow = roundTo(zoneTotal * randomBetween(1.03, 1.1), 1);
    pushHistory(target, target.mainMeter.id, 'flow_lpm', timestamp, mainFlow);
    pushHistory(target, 'system', 'main_inflow_lpm', timestamp, mainFlow);
    pushHistory(target, 'system', 'zone_outflow_lpm', timestamp, roundTo(zoneTotal, 1));

    for (const node of target.electricNodes) {
      pushHistory(target, node.id, 'power_watt', timestamp, roundTo(node.electrical.powerWatt * (1 + phase * 0.14) * jitter(), 0));
    }

    for (const sensor of target.sensors) {
      pushHistory(target, sensor.id, 'temperature', timestamp, roundTo(sensor.latest.temperatureCelsius + phase * 1.6 + randomBetween(-0.3, 0.3), 1));
      pushHistory(target, sensor.id, 'humidity', timestamp, roundTo(sensor.latest.humidityPercent - phase * 3.2 + randomBetween(-0.8, 0.8), 1));
      pushHistory(target, sensor.id, 'heat_index', timestamp, roundTo(sensor.latest.heatIndexCelsius + phase * 2.1 + randomBetween(-0.3, 0.3), 1));
    }
  }

  backfillWeatherHistory(target, now);
  backfillDeviceHistory(target, now);
}

/** backfill สุขภาพอุปกรณ์ย้อนหลัง 4 ชั่วโมง ความละเอียด 1 นาที */
function backfillDeviceHistory(target: MockState, now: number): void {
  const steps = Math.floor((WEATHER_BACKFILL_HOURS * 3_600_000) / WEATHER_BACKFILL_STEP_MS);

  for (const device of target.devices) {
    for (let step = steps; step >= 1; step -= 1) {
      const timestamp = now - step * WEATHER_BACKFILL_STEP_MS;
      if (device.rssi !== null) {
        pushHistory(target, device.id, 'rssi_dbm', timestamp, Math.round(device.rssi + randomBetween(-3.5, 3.5)));
      }
      if (device.freeHeapBytes !== null) {
        pushHistory(target, device.id, 'free_heap_bytes', timestamp, Math.round(device.freeHeapBytes + randomBetween(-2600, 2600)));
      }
      // uptime เดินขึ้นเป็นเส้นตรง ยกเว้นช่วงที่อุปกรณ์รีบูตซึ่งจะตกกลับไปศูนย์
      pushHistory(target, device.id, 'uptime_seconds', timestamp, Math.max(0, Math.round(device.uptimeSeconds - step * 60)));
    }
  }
}

/** backfill ความกดอากาศและความเข้มแสงย้อนหลัง 4 ชั่วโมงที่ความละเอียด 1 นาที */
function backfillWeatherHistory(target: MockState, now: number): void {
  const steps = Math.floor((WEATHER_BACKFILL_HOURS * 3_600_000) / WEATHER_BACKFILL_STEP_MS);

  for (const sensor of target.sensors) {
    if (!sensor.hasWeatherSensors) continue;
    const basePressure = sensor.latest.pressureHpa;
    const peakLux = sensor.latest.illuminanceLux;
    if (basePressure === null) continue;

    for (let step = steps; step >= 1; step -= 1) {
      const timestamp = now - step * WEATHER_BACKFILL_STEP_MS;
      // ความกดอากาศไล่ลงช้า ๆ เข้าหาค่าปัจจุบัน ให้เห็นแนวโน้มจริงบนกราฟ
      const drift = (step / steps) * 2.2;
      pushHistory(target, sensor.id, 'pressure_hpa', timestamp, roundTo(basePressure + drift + randomBetween(-0.15, 0.15), 1));

      if (peakLux !== null) {
        const hour = new Date(timestamp).getHours() + new Date(timestamp).getMinutes() / 60;
        const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
        pushHistory(target, sensor.id, 'illuminance_lux', timestamp, Math.round(92_000 * daylight ** 1.6));
      }
    }
  }
}

/** ใช้ในเทสต์/รีเซ็ตเดโม — สร้างสถานะใหม่ทั้งหมด */
export function resetState(): void {
  state = null;
  notify();
}

/** สุ่มค่าเล็ก ๆ ที่ simulator ใช้ร่วมกัน */
export const simRandom = rng;
