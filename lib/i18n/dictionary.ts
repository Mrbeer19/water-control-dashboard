/**
 * พจนานุกรม th/en — dictionary object ธรรมดา ไม่ใช้ i18n library
 * (ทุกอย่างต้อง bundle มากับ build เพราะระบบรันแบบ on-premise ไม่มีอินเทอร์เน็ต)
 *
 * โครงสร้างของ en ถูกบังคับให้ตรงกับ th ด้วย type Dictionary
 * ถ้าเพิ่มคีย์ที่ th แล้วลืมเพิ่มที่ en จะ error ตอน typecheck
 */

export const th = {
  app: {
    title: 'ระบบมอนิเตอร์และควบคุมการใช้น้ำ',
    shortTitle: 'ระบบน้ำโรงงาน',
    localMode: 'Local Mode',
  },
  nav: {
    overview: 'ภาพรวม',
    diagram: 'แผนผังการไหล',
    ai: 'AI Insights',
    control: 'ควบคุม',
    devices: 'อุปกรณ์',
    alerts: 'การแจ้งเตือน',
    reports: 'รายงาน',
    settings: 'ตั้งค่า',
    sectionMonitor: 'มอนิเตอร์',
    sectionOperate: 'ปฏิบัติการ',
    sectionSystem: 'ระบบ',
  },
  header: {
    connected: 'เชื่อมต่อแล้ว',
    disconnected: 'ขาดการเชื่อมต่อ',
    lastSync: 'ซิงก์ล่าสุด',
    latency: 'หน่วงเวลา',
    unreadAlerts: 'แจ้งเตือนที่ยังไม่อ่าน',
    noUnreadAlerts: 'ไม่มีแจ้งเตือนใหม่',
    openMenu: 'เปิดเมนู',
    closeMenu: 'ปิดเมนู',
    themeToggle: 'สลับธีมสว่าง/มืด',
    langToggle: 'เปลี่ยนภาษา',
  },
  status: {
    ok: 'ปกติ',
    warning: 'เตือน',
    critical: 'วิกฤต',
    offline: 'ออฟไลน์',
  },
  common: {
    loading: 'กำลังโหลดข้อมูล…',
    empty: 'ยังไม่มีข้อมูล',
    emptyHint: 'เมื่อเซนเซอร์ส่งค่าเข้ามา ข้อมูลจะแสดงที่นี่',
    error: 'โหลดข้อมูลไม่สำเร็จ',
    retry: 'ลองใหม่',
    all: 'ทั้งหมด',
    of: 'จาก',
    updatedAt: 'อัปเดตเมื่อ',
    comingSoon: 'อยู่ระหว่างพัฒนา',
    comingSoonHint: 'หน้านี้จะถูกสร้างในเฟสถัดไป',
  },
  units: {
    liters: 'ลิตร',
    cubicMeters: 'ลบ.ม.',
    flow: 'ล./นาที',
    percent: '%',
    baht: 'บาท',
  },
} as const;

/** โครงสร้างที่ทุกภาษาต้องมีครบ */
export type Dictionary = {
  readonly [K in keyof typeof th]: { readonly [P in keyof (typeof th)[K]]: string };
};

export const en: Dictionary = {
  app: {
    title: 'Water Control & Monitoring',
    shortTitle: 'Plant Water',
    localMode: 'Local Mode',
  },
  nav: {
    overview: 'Overview',
    diagram: 'Flow Diagram',
    ai: 'AI Insights',
    control: 'Control',
    devices: 'Devices',
    alerts: 'Alerts',
    reports: 'Reports',
    settings: 'Settings',
    sectionMonitor: 'Monitor',
    sectionOperate: 'Operate',
    sectionSystem: 'System',
  },
  header: {
    connected: 'Connected',
    disconnected: 'Disconnected',
    lastSync: 'Last sync',
    latency: 'Latency',
    unreadAlerts: 'Unread alerts',
    noUnreadAlerts: 'No new alerts',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    themeToggle: 'Toggle light/dark theme',
    langToggle: 'Change language',
  },
  status: {
    ok: 'Normal',
    warning: 'Warning',
    critical: 'Critical',
    offline: 'Offline',
  },
  common: {
    loading: 'Loading…',
    empty: 'No data yet',
    emptyHint: 'Readings will appear here once sensors report in.',
    error: 'Failed to load data',
    retry: 'Retry',
    all: 'All',
    of: 'of',
    updatedAt: 'Updated',
    comingSoon: 'Under construction',
    comingSoonHint: 'This page will be built in the next phase.',
  },
  units: {
    liters: 'L',
    cubicMeters: 'm³',
    flow: 'L/min',
    percent: '%',
    baht: 'THB',
  },
};

export const dictionaries = { th, en } as const;
