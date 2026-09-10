'use client';

import { useEffect, useState } from 'react';
import { LayoutGrid, Table2 } from 'lucide-react';
import type { Zone, ZoneCost } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getZoneCosts, getZones } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ZoneTable } from './zone-table';
import { ZoneCards } from './zone-cards';

export interface ZoneRow {
  zone: Zone;
  cost: ZoneCost | null;
  /** อุปกรณ์ยังส่งค่าอยู่หรือไม่ ตัดสินจาก lastSeen */
  online: boolean;
}

const STORAGE_KEY = 'wcm.zoneView';
type ZoneView = 'table' | 'cards';

/** 1.3 — มิเตอร์น้ำ 8 โซน สลับดูแบบตาราง/การ์ดได้ */
export function ZoneSection(): JSX.Element {
  const { t } = useLocale();
  const [view, setView] = useState<ZoneView>('table');

  // อ่านมุมมองที่เลือกไว้หลัง mount เพื่อไม่ให้ HTML ฝั่ง server ต่างจาก client
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'table' || stored === 'cards') setView(stored);
    } catch {
      // เบราว์เซอร์ที่ปิด storage — ใช้ค่าตั้งต้นไป
    }
  }, []);

  const chooseView = (next: ZoneView): void => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ไม่จำก็ไม่เป็นไร
    }
  };

  const { data, loading } = useLiveData<{ zones: Zone[]; costs: ZoneCost[]; timeoutSeconds: number }>(async () => {
    const [zones, costs] = await Promise.all([getZones(), getZoneCosts()]);
    // เกณฑ์ offline ควรมาจาก settings แต่ Phase 1 ยังไม่ต้องดึงทั้งก้อน จึงใช้ค่าเดียวกับที่ตั้งไว้
    return { zones, costs, timeoutSeconds: 30 };
  }, []);

  if (loading && data === null) {
    return <Skeleton className="h-[420px] rounded-lg" />;
  }

  if (data === null || data.zones.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm font-medium">{t.common.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  const now = Date.now();
  const rows: ZoneRow[] = data.zones.map((zone) => ({
    zone,
    cost: data.costs.find((item) => item.zoneId === zone.id) ?? null,
    online: now - new Date(zone.lastSeen).getTime() < data.timeoutSeconds * 1_000,
  }));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="inline-flex rounded-md border bg-muted/40 p-0.5" role="group">
          <ViewButton active={view === 'table'} onClick={() => { chooseView('table'); }} icon={Table2} label={t.overview.viewTable} />
          <ViewButton active={view === 'cards'} onClick={() => { chooseView('cards'); }} icon={LayoutGrid} label={t.overview.viewCards} />
        </div>
      </div>

      {view === 'table' ? <ZoneTable rows={rows} /> : <ZoneCards rows={rows} />}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Table2;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}
