/**
 * ทางเข้าเดียวของ mock layer
 * ★ ให้ lib/services/ เท่านั้นที่ import จากที่นี่ — component ห้ามเรียกตรง
 */

export { ENVIRONMENT_SPECS, MAIN_METER_SPEC, PUMP_SPECS, TANK_SPECS, ZONE_SPECS } from './hardware';
export { DEVICE_SPECS } from './network';
export { CURRENT_USER_ID, DEPARTMENTS, ELECTRIC_NODE_SPECS, SYSTEM_ACTOR, USERS, toActorRef } from './organization';
export { DEFAULT_SETTINGS } from './settings';
export { acknowledgeAlert, raiseAlert, resolveAlerts } from './alerts';
export { buildAnomalies, buildForecast, buildForecasts, buildMaintenancePredictions, buildServiceStatus } from './ai';
export { DAILY_HISTORY_DAYS, buildDailyUsage, buildMeterReadings, buildMonthlyUsage, daysRemainingInMonth } from './daily';
export {
  MIN_SOURCE_LEVEL_PERCENT,
  computeNextRun,
  createSchedule,
  pumpInterlock,
  seedSchedules,
  startCommand,
  valveInterlock,
} from './control';
export { startSimulator, tickOnce } from './simulator';
export {
  getState,
  historyKey,
  notify,
  nowIso,
  persistScenario,
  pushHistory,
  readHistory,
  resetState,
  levelFromVolume,
  statusFromRange,
  subscribe,
  worstStatus,
  TICK_MS,
  type MockState,
} from './store';
