/**
 * Service: จุดวัดไฟฟ้ารายแผนก
 * ระบบนี้มอนิเตอร์และแบ่งค่าใช้จ่ายเท่านั้น ไม่มีคำสั่งตัด/ต่อไฟ
 */

import type { ElectricNode, MetricKey, TimeSeriesPoint } from '@/lib/types';
import { readHistory } from '@/lib/mock';
import { round } from '@/lib/utils/calculation';
import { respond } from './internal';

/**
 * TODO(backend): GET /api/electric/nodes?departmentId=
 */
export async function getElectricNodes(departmentId?: string): Promise<ElectricNode[]> {
  return respond((state) =>
    departmentId === undefined
      ? state.electricNodes
      : state.electricNodes.filter((node) => node.departmentId === departmentId),
  );
}

/**
 * TODO(backend): GET /api/electric/nodes/:id
 */
export async function getElectricNode(id: string): Promise<ElectricNode | null> {
  return respond((state) => state.electricNodes.find((node) => node.id === id) ?? null);
}

/**
 * TODO(backend): GET /api/electric/nodes/:id/history?metric=power_watt&from=&to=&interval=
 */
export async function getElectricHistory(id: string, metric: MetricKey = 'power_watt'): Promise<TimeSeriesPoint[]> {
  return respond(() => readHistory(id, metric));
}

/**
 * พลังงานรวมรายแผนกวันนี้ ใช้กับกราฟเปรียบเทียบ
 * TODO(backend): GET /api/electric/summary?period=today
 */
export async function getEnergyByDepartment(
  period: 'today' | 'month' = 'today',
): Promise<{ departmentId: string; departmentName: string; energyKwh: number }[]> {
  return respond((state) =>
    state.departments.map((department) => ({
      departmentId: department.id,
      departmentName: department.name,
      energyKwh: round(
        state.electricNodes
          .filter((node) => node.departmentId === department.id)
          .reduce((sum, node) => sum + (period === 'today' ? node.todayEnergyKwh : node.monthEnergyKwh), 0),
        1,
      ),
    })),
  );
}
