/** Service: สรุปภาพรวมและสถานะการเชื่อมต่อสำหรับ Header/Overview */

import type { ConnectionStatus, SystemSummary } from '@/lib/types';
import { worstStatus } from '@/lib/mock';
import { calculateStorageDelta, calculateUnaccountedWater, currentBillingPeriod, round } from '@/lib/utils/calculation';
import { respond } from './internal';

/**
 * สถานะการเชื่อมต่อกับ gateway ในโรงงาน — Header ใช้แสดง badge "Local Mode"
 * TODO(backend): GET /api/system/connection
 */
export async function getConnectionStatus(): Promise<ConnectionStatus> {
  return respond((state) => state.connection);
}

/**
 * ตัวเลขหลักทั้งหมดของหน้า Overview ในครั้งเดียว
 * TODO(backend): GET /api/system/summary
 */
export async function getSystemSummary(): Promise<SystemSummary> {
  return respond((state) => {
    const { start, end } = currentBillingPeriod(new Date(), state.settings.billing.billingCycleStartDay);
    const unaccounted = calculateUnaccountedWater({
      mainMeter: state.mainMeter,
      zones: state.zones,
      storageDeltaCubicMeters: calculateStorageDelta(state.tanks, state.storageBaselineLiters),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      warningPercent: state.settings.thresholds.unaccountedWarningPercent,
      criticalPercent: state.settings.thresholds.unaccountedCriticalPercent,
    });

    const totalStoredLiters = state.tanks.reduce((sum, tank) => sum + tank.currentLiters, 0);
    const totalCapacityLiters = state.tanks.reduce((sum, tank) => sum + tank.capacityLiters, 0);
    const unread = state.alerts.filter((alert) => !alert.read && alert.state !== 'resolved');

    return {
      totalStoredLiters: Math.round(totalStoredLiters),
      totalCapacityLiters,
      totalStoredPercent: totalCapacityLiters === 0 ? 0 : round((totalStoredLiters / totalCapacityLiters) * 100, 1),
      mainInflowLpm: state.mainMeter.flowLpm,
      zoneOutflowLpm: round(
        state.zones.reduce((sum, zone) => sum + zone.flowLpm, 0),
        1,
      ),
      todayConsumptionCubicMeters: round(
        state.zones.reduce((sum, zone) => sum + zone.todayCubicMeters, 0),
        2,
      ),
      monthConsumptionCubicMeters: round(
        state.zones.reduce((sum, zone) => sum + zone.monthCubicMeters, 0),
        2,
      ),
      // พลังงานวันนี้รวมทั้งปั๊มและตู้ไฟรายแผนก
      todayEnergyKwh: round(
        state.pumps.reduce((sum, pump) => sum + pump.electrical.powerWatt / 1_000, 0) * 8.4 +
          state.electricNodes.reduce((sum, node) => sum + node.todayEnergyKwh, 0),
        1,
      ),
      systemPressureBar: state.pumps.some((pump) => pump.controlMode === 'pid')
        ? state.pressureControl.measuredPressureBar
        : null,
      pumpsRunning: state.pumps.filter((pump) => pump.runState === 'running').length,
      pumpsTotal: state.pumps.length,
      zonesActive: state.zones.filter((zone) => zone.flowLpm > 0.5).length,
      zonesTotal: state.zones.length,
      devicesOnline: state.devices.filter((device) => device.status !== 'offline').length,
      devicesTotal: state.devices.length,
      unreadAlerts: unread.length,
      criticalAlerts: unread.filter((alert) => alert.severity === 'critical').length,
      openAnomalies: state.anomalies.filter(
        (anomaly) => Date.now() - new Date(anomaly.detectedAt).getTime() < 86_400_000,
      ).length,
      unaccounted,
      overallStatus: worstStatus([
        ...state.tanks.map((tank) => tank.status),
        ...state.pumps.map((pump) => pump.status),
        ...state.zones.map((zone) => zone.status),
        ...state.electricNodes.map((node) => node.status),
        unaccounted.status,
      ]),
      updatedAt: state.connection.lastSyncAt,
    };
  });
}
