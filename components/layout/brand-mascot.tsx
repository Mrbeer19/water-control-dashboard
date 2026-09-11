import { cn } from '@/lib/utils';

/**
 * มาสคอตของแดชบอร์ด — "น้องหยด" หยดน้ำใส่หมวกนิรภัย
 *
 * ★ วาดเป็น SVG ด้วย semantic token ล้วน ไม่มี hex สักค่า จึงเปลี่ยนตามธีมเองและ
 *   ผ่านตัวตรวจ `npm run check:colors` เหมือน component อื่น
 *
 * ★ ออกแบบใหม่ทั้งหมด ไม่ได้ลอกมาสคอตหยดน้ำใน `water.jpg` ของ template (ข้อ 2 ห้ามลอก)
 *   ของ template เป็นหยดน้ำฟ้าอ่อนมีแขนขาถือแก้ว ตัวนี้เป็นทรงแบนเรียบ ไม่มีแขนขา
 *   ใส่หมวกนิรภัยเพื่อโยงกับบริบทโรงงาน
 *
 * ★ ใช้ได้เฉพาะพื้นที่ที่เป็น "chrome" เท่านั้น (หน้า login, หน้า 404, empty state)
 *   **ห้ามวางในพื้นที่ข้อมูล** เพราะหมวกเป็นสีแดง ซึ่งในพื้นที่ข้อมูลสงวนไว้ให้ความหมาย "วิกฤต" (ข้อ 3.3)
 *
 * ★ ตัวมาสคอตต้องอยู่นอก clear space ของโลโก้องค์กรเสมอ ห้ามวางติดกันจนดูเป็นชุดเดียว (ข้อ 5.2)
 */
/**
 * ★ ตัวมาสคอตมีสองชุดสี เพราะตัวขาวจะหายไปเลยบนพื้นการ์ดสีขาว
 *   `on-brand`   — ตัวขาว ใช้บนพื้นสีเข้ม เช่น พาเนลซ้ายของ /login
 *   `on-surface` — ตัวสีน้ำ ใช้บนพื้นการ์ด/พื้นหน้า ซึ่งเป็นสีขาวในโหมดสว่างและเทาเข้มในโหมดมืด
 */
const TONE = {
  'on-brand': { body: 'fill-info-strong-foreground', face: 'fill-info-strong', faceStroke: 'stroke-info-strong', glint: 'fill-info-strong-foreground' },
  'on-surface': { body: 'fill-water', face: 'fill-info-strong-foreground', faceStroke: 'stroke-info-strong-foreground', glint: 'fill-info-strong' },
} as const;

export function BrandMascot({
  /** ความสูงเป็น px */
  height = 120,
  /** ชุดสีตามพื้นที่วาง */
  tone = 'on-brand',
  /** แสดงหยดน้ำเล็กสองเม็ดข้าง ๆ (ใช้เมื่อมีพื้นที่กว้างพอ) */
  withDrops = true,
  className,
}: {
  height?: number;
  tone?: keyof typeof TONE;
  withDrops?: boolean;
  className?: string;
}): JSX.Element {
  const width = Math.round((height * 150) / 180);
  const c = TONE[tone];

  return (
    <svg
      viewBox="0 0 150 180"
      width={width}
      height={height}
      className={cn('shrink-0', className)}
      role="img"
      aria-hidden
      focusable="false"
    >
      {withDrops && (
        <>
          <path
            d="M126 104 C126 104 138 119 138 126 a12 12 0 1 1 -24 0 C114 119 126 104 126 104 Z"
            className={c.body}
            opacity={0.5}
          />
          <path
            d="M20 92 C20 92 29 103 29 108 a9 9 0 1 1 -18 0 C11 103 20 92 20 92 Z"
            className={c.body}
            opacity={0.35}
          />
        </>
      )}

      {/* ตัวหยดน้ำ */}
      <path
        d="M70 44 C70 44 114 92 114 116 a44 44 0 1 1 -88 0 C26 92 70 44 70 44 Z"
        className={c.body}
      />

      {/* หมวกนิรภัย — โดม Cinnabar-500 ปีกและสันหมวก Cinnabar-700 */}
      <path d="M34 70 a36 28 0 0 1 72 0 Z" className="fill-primary" />
      <rect x="22" y="67" width="96" height="11" rx="5.5" className="fill-brand-strong" />
      <rect x="66" y="50" width="8" height="20" rx="4" className="fill-brand-strong" />

      {/* ใบหน้า */}
      <circle cx="56" cy="108" r="7" className={c.face} />
      <circle cx="86" cy="108" r="7" className={c.face} />
      <circle cx="58.5" cy="105.5" r="2.4" className={c.glint} />
      <circle cx="88.5" cy="105.5" r="2.4" className={c.glint} />
      <path
        d="M58 124 q13 12 26 0"
        strokeWidth={5.5}
        strokeLinecap="round"
        fill="none"
        className={c.faceStroke}
      />
    </svg>
  );
}
