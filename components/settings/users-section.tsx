'use client';

import type { Department, User, UserRole } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getDepartments, getUsers } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { NumberField, SelectField, ToggleField, type SettingsSectionProps } from './field';

/** 3.9 — ผู้ใช้และสิทธิ์ */
export function UsersSection({ draft, onChange }: SettingsSectionProps): JSX.Element {
  const { t, locale } = useLocale();
  const security = draft.security;
  const set = (patch: Partial<typeof security>): void => {
    onChange({ security: { ...security, ...patch } });
  };

  const { data, loading } = useLiveData<{ users: User[]; departments: Department[] }>(async () => {
    const [users, departments] = await Promise.all([getUsers(), getDepartments()]);
    return { users, departments };
  }, []);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4">
        <ToggleField
          label={t.settings.requirePin}
          checked={security.requirePinForControl}
          onChange={(checked) => { set({ requirePinForControl: checked }); }}
        />
        <ToggleField
          label={t.settings.scopedAccess}
          checked={security.departmentScopedAccess}
          onChange={(checked) => { set({ departmentScopedAccess: checked }); }}
        />
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <SelectField<UserRole>
            label={t.settings.minRole}
            value={security.minimumRoleForControl}
            options={[
              { value: 'viewer', label: 'viewer' },
              { value: 'operator', label: 'operator' },
              { value: 'admin', label: 'admin' },
            ]}
            onChange={(value) => { set({ minimumRoleForControl: value }); }}
          />
          <NumberField
            label={t.settings.sessionTimeout}
            value={security.sessionTimeoutMinutes}
            min={1}
            unit={t.settings.minutes}
            onChange={(value) => { set({ sessionTimeoutMinutes: value }); }}
          />
        </div>
      </div>

      {/* รายชื่อผู้ใช้อ่านอย่างเดียว — การจัดการบัญชีเป็นงานของหลังบ้าน ไม่ใช่ของหน้าจอนี้ */}
      {loading && data === null ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : data === null || data.users.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t.common.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.device.name}</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.settings.role}</th>
                <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.settings.department}</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">{t.settings.active}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="px-4 py-2.5">{user.displayName}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="text-[10px]">{user.role}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {user.departmentId === null
                      ? '—'
                      : (() => {
                          const dept = data.departments.find((item) => item.id === user.departmentId);
                          return dept === undefined ? user.departmentId : locale === 'th' ? dept.name : dept.nameEn;
                        })()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    {user.active ? <span className="text-status-ok">●</span> : <span className="text-muted-foreground">○</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
