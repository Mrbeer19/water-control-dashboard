import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * โลโก้ Kasetphand — docs/BRANDING_SPEC.md ข้อ 5
 *
 * ★ นี่คือจุดเดียวในแอปที่ render โลโก้ ห้ามวางไฟล์ภาพเองที่อื่น
 *
 * ไฟล์มาจากหน้า PDF ที่ 11 ของเอกสาร CI (ข้อ 5.1) ครอปเฉพาะกล่องแดง
 * สัดส่วนจริงของไฟล์คือ 991 × 707 = 1.4017 ซึ่งตรงกับ 14 : 10 ที่ CI กำหนด
 * จึงวางเต็มกล่องได้ตรง ๆ ไม่ต้องใช้ object-fit: contain (ข้อ 5.2)
 *
 * ข้อห้ามตามข้อ 5.2 — ห้ามใส่ shadow / border / opacity < 1 / filter / rotate / animation
 * ห้าม hover effect ห้ามวางบนพื้นแดงหรือพื้นลาย ห้ามวางทับข้อความ และห้ามวางด้านล่างของหน้า (ข้อ 5.3)
 * โหมดมืดใช้ไฟล์เดียวกัน
 */

/** สัดส่วนจริงของไฟล์ — ใช้คำนวณความกว้างจากความสูงที่เรียกมา */
const ASPECT = 991 / 707;

/** ความสูงขั้นต่ำที่ตัวอักษร KASETPHAND ยังอ่านออก (ข้อ 5.2) */
const MIN_HEIGHT = 32;

export function BrandLogo({
  height = MIN_HEIGHT,
  priority = false,
  className,
}: {
  /** ความสูงเป็น px — ต่ำกว่า 32 ไม่ได้ตามข้อ 5.2 */
  height?: number;
  priority?: boolean;
  className?: string;
}): JSX.Element {
  const h = Math.max(height, MIN_HEIGHT);
  const w = Math.round(h * ASPECT);

  return (
    <span
      className={cn('inline-block shrink-0', className)}
      // clear space ≥ ความสูงโลโก้ ÷ 10 (ข้อ 5.2)
      style={{ padding: `${Math.round(h / 10)}px` }}
    >
      <Image
        src="/brand/kasetphand-logo.png"
        alt="Kasetphand Group"
        width={w}
        height={h}
        priority={priority}
        // ไฟล์อยู่ใน public/ ของโปรเจกต์ ไม่มีการเรียก CDN ภายนอก
        unoptimized
        style={{ height: `${h}px`, width: `${w}px` }}
      />
    </span>
  );
}
