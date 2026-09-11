/** Service: แผนก ผู้ใช้ และการแบ่งค่าใช้จ่ายรายแผนก */

import type { Department, DepartmentUsage, User } from '@/lib/types';
import { CURRENT_USER_ID } from '@/lib/mock';
import { currentBillingPeriod, round, splitIntoTiers } from '@/lib/utils/calculation';
import { respond } from './internal';
import { getSession } from './auth';

/**
 * TODO(backend): GET /api/departments
 */
export async function getDepartments(): Promise<Department[]> {
  return respond((state) => state.departments);
}

/**
 * TODO(backend): GET /api/users
 */
export async function getUsers(): Promise<User[]> {
  return respond((state) => state.users);
}

/**
 * ผู้ใช้ที่ล็อกอินอยู่ — อ่านจากเซสชันของหน้าล็อกอิน
 * ถอยไปใช้ผู้ใช้สมมติเมื่อยังไม่มีเซสชัน เพื่อให้หน้าอื่นยังทดสอบได้โดยไม่ต้องล็อกอิน
 *
 * TODO(backend): GET /api/auth/me  (คืน User + สิทธิ์ที่มีผลจาก departmentScopedAccess)
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (session !== null) return session.user;
  return respond((state) => state.users.find((user) => user.id === CURRENT_USER_ID) ?? null);
}

/**
 * ค่าน้ำ + ค่าไฟที่แบ่งให้แต่ละแผนกในรอบบิลปัจจุบัน
 * ★ ผลลัพธ์หลักที่โปรเจกต์ต้องการ — ใช้กับรายงาน department_cost
 *
 * TODO(backend): GET /api/departments/usage?from=&to=
 *   หลังบ้านควรคิดจากข้อมูลที่บันทึกไว้จริงตลอดรอบ ไม่ใช่ค่าสะสมล่าสุดเหมือน mock นี้
 */
export async function getDepartmentUsage(): Promise<DepartmentUsage[]> {
  return respond((state) => {
    const now = new Date();
    const { billing } = state.settings;
    const { start, end } = currentBillingPeriod(now, billing.billingCycleStartDay);
    const electricRate = billing.electricityRatePerKwh + billing.electricityFtPerKwh;

    const rows = state.departments.map((department) => {
      const waterCubicMeters = round(
        state.zones
          .filter((zone) => zone.departmentId === department.id)
          .reduce((sum, zone) => sum + zone.monthCubicMeters, 0),
        2,
      );
      const energyKwh = round(
        state.electricNodes
          .filter((node) => node.departmentId === department.id)
          .reduce((sum, node) => sum + node.monthEnergyKwh, 0),
        1,
      );

      // ค่าน้ำคิดตามขั้นอัตราของปริมาณเฉพาะแผนกนั้น
      const waterCostBaht = round(
        splitIntoTiers(waterCubicMeters, billing.tiers).reduce((sum, tier) => sum + tier.amountBaht, 0),
        2,
      );
      const electricityCostBaht = round(energyKwh * electricRate, 2);

      return {
        departmentId: department.id,
        departmentName: department.name,
        costCenterCode: department.costCenterCode,
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
        waterCubicMeters,
        waterCostBaht,
        energyKwh,
        electricityCostBaht,
        totalCostBaht: round(waterCostBaht + electricityCostBaht, 2),
        sharePercent: 0,
        // ยอดรอบก่อนหน้าที่หลังบ้านจะดึงจากฐานข้อมูลจริง
        changeFromPreviousPercent: 0,
      };
    });

    const grandTotal = rows.reduce((sum, row) => sum + row.totalCostBaht, 0);
    return rows.map((row) => ({
      ...row,
      sharePercent: grandTotal === 0 ? 0 : round((row.totalCostBaht / grandTotal) * 100, 1),
    }));
  });
}
