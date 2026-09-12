/**
 * สีสำหรับกราฟทั้งระบบ
 *
 * ใช้ CSS custom property ตรง ๆ ใน attribute ของ SVG ได้เลย เบราว์เซอร์จะ resolve ให้
 * กราฟจึงเปลี่ยนสีตามธีมสว่าง/มืดเองโดยไม่ต้อง re-render ฝั่ง React
 * (docs/BRANDING_SPEC.md ข้อ 3.7 ห้ามใส่ hex ใน props ของกราฟ — การอ่านผ่านตัวแปร CSS
 *  ให้ผลดีกว่าการ import hex จาก lib/config/theme.ts เพราะสลับธีมได้โดยไม่ต้อง render ใหม่)
 *
 * ★ จานสีตามข้อ 3.3: ชุดข้อมูลหลักได้แค่ 2 สี + ชุดอ้างอิงอีก 1 สี
 *   ชุด 4 สีเดิมไม่ผ่าน validator ของ skill dataviz ทั้งสองโหมด (ดู docs/DESIGN_PLAN.md ข้อ 9)
 *   ห้ามเพิ่มสีที่คิดเองเข้ามาโดยไม่ตรวจซ้ำ — ตาเปล่าตัดสินเรื่อง colorblind safety ไม่ได้
 */

export const CHART = {
  /** สีของข้อมูลน้ำ — Blue-500 (dark: Blue-300) */
  water: 'var(--data-water)',
  /** พื้นใต้เส้นกราฟและช่วงความเชื่อมั่น — Blue-100 (dark: Blue-800) */
  waterSoft: 'var(--data-water-soft)',
  /** ชุดอ้างอิงที่ต้องถอยหลังฉาก เช่น แท่งของช่วงก่อนหน้า — ต้องมี legend เสมอ */
  reference: 'var(--chart-reference)',
  /** เส้นกราฟเมื่อวางบนการ์ดเด่นที่ถมสีทึบ — ต้องเป็นขาว ไม่ใช่สีน้ำเงินบนน้ำเงิน */
  onFeature: 'hsl(var(--feature-foreground))',
  muted: 'hsl(var(--muted-foreground))',
  border: 'hsl(var(--border))',
  info: 'hsl(var(--info))',
  ok: 'hsl(var(--status-ok))',
  warning: 'hsl(var(--status-warning))',
  critical: 'hsl(var(--status-critical))',
  offline: 'hsl(var(--status-offline))',
} as const;

/**
 * ลำดับสี categorical — ใช้ตามลำดับเสมอ ห้ามวนซ้ำ
 *
 * มีแค่ 2 สีเพราะบันไดสี CI เหลือเพียง 3 hue ที่ไม่ใช่แดงและไม่ใช่เทา
 * และคู่ Marigold↔Green ยุบรวมกันภายใต้ protanopia (CVD ΔE 5.9 ต่ำกว่าเกณฑ์)
 * กราฟที่ต้องการมากกว่านี้ให้ใช้สีเดียว + ป้ายชื่อ หรือเน้น 1 ชุดที่เหลือใช้ CHART.reference
 */
export const CHART_SERIES = ['var(--chart-series-1)', 'var(--chart-series-2)'] as const;

export function seriesColor(index: number): string {
  if (index >= CHART_SERIES.length) {
    throw new Error(
      'ชุดข้อมูลเกิน 2 ชุด — ให้ใช้สีเดียว + ป้ายชื่อ หรือเน้น 1 ชุดที่เหลือใช้ CHART.reference แทนการวนสีซ้ำ',
    );
  }
  return CHART_SERIES[index] ?? CHART.water;
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
