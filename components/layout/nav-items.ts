import { Activity, Bell, Brain, FileBarChart, Gauge, Cpu, Settings, Waves } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n';

export interface NavItem {
  href: string;
  icon: typeof Gauge;
  labelKey: keyof Dictionary['nav'];
  /** true = แสดงจำนวน alert ที่ยังไม่อ่านข้างเมนู */
  showAlertBadge?: boolean;
}

export interface NavSection {
  titleKey: keyof Dictionary['nav'];
  items: NavItem[];
}

/** เมนูหลัก จัดกลุ่มตามลักษณะงานในห้องคอนโทรล */
export const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'sectionMonitor',
    items: [
      { href: '/', icon: Gauge, labelKey: 'overview' },
      { href: '/overview', icon: Waves, labelKey: 'diagram' },
      { href: '/ai', icon: Brain, labelKey: 'ai' },
    ],
  },
  {
    titleKey: 'sectionOperate',
    items: [
      { href: '/control', icon: Activity, labelKey: 'control' },
      { href: '/alerts', icon: Bell, labelKey: 'alerts', showAlertBadge: true },
      { href: '/reports', icon: FileBarChart, labelKey: 'reports' },
    ],
  },
  {
    titleKey: 'sectionSystem',
    items: [
      { href: '/devices', icon: Cpu, labelKey: 'devices' },
      { href: '/settings', icon: Settings, labelKey: 'settings' },
    ],
  },
];
