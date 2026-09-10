/**
 * สีสำหรับกราฟทั้งระบบ
 *
 * ใช้ CSS custom property ตรง ๆ ใน attribute ของ SVG ได้เลย เบราว์เซอร์จะ resolve ให้
 * กราฟจึงเปลี่ยนสีตามธีมสว่าง/มืดเองโดยไม่ต้อง re-render ฝั่ง React
 *
 * ★ ชุดสี categorical ด้านล่างผ่านการตรวจแล้วทั้งสองโหมด (ดูคอมเมนต์ใน globals.css)
 *   ห้ามเพิ่มสีที่คิดเองเข้ามาโดยไม่ตรวจซ้ำ — ตาเปล่าตัดสินเรื่อง colorblind safety ไม่ได้
 */

export const CHART = {
  primary: 'hsl(var(--primary))',
  muted: 'hsl(var(--muted-foreground))',
  border: 'hsl(var(--border))',
  ok: 'hsl(var(--status-ok))',
  warning: 'hsl(var(--status-warning))',
  critical: 'hsl(var(--status-critical))',
  offline: 'hsl(var(--status-offline))',
  /** เฉดหลักสำหรับค่าเชิงปริมาณชุดเดียว */
  sequential: 'var(--chart-seq-400)',
  sequentialSoft: 'var(--chart-seq-250)',
} as const;

/**
 * ลำดับสี categorical — ใช้ตามลำดับเสมอ ห้ามวนซ้ำ
 * ถ้ามีชุดข้อมูลเกิน 8 ให้ยุบเป็น "อื่น ๆ" หรือแยกเป็นกราฟย่อยหลายอัน
 */
export const CHART_SERIES = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
] as const;

export function seriesColor(index: number): string {
  if (index >= CHART_SERIES.length) {
    throw new Error('ชุดข้อมูลเกิน 8 ชุด — ให้ยุบเป็น "อื่น ๆ" หรือแยกกราฟ แทนการวนสีซ้ำ');
  }
  return CHART_SERIES[index] ?? CHART.primary;
}

/** สไตล์กล่อง tooltip ให้ตรงกับธีมของแอป ใช้ซ้ำทุกกราฟ */
export const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.5rem',
    fontSize: '12px',
    padding: '8px 10px',
    color: 'hsl(var(--popover-foreground))',
    boxShadow: '0 4px 14px rgb(0 0 0 / 0.14)',
  },
  labelStyle: { color: 'hsl(var(--muted-foreground))', marginBottom: 4, fontSize: '11px' },
  itemStyle: { color: 'hsl(var(--popover-foreground))', padding: 0 },
} as const;

/** สไตล์แกนที่ถอยหลังฉากให้ข้อมูลเด่น ใช้ร่วมกันทุกกราฟ */
export const AXIS_PROPS = {
  stroke: 'hsl(var(--border))',
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;
