'use client';

import type { EntityStatus, TankShape } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * ★ ตัวน้ำใช้บันได Royal Navy Blue เสมอ ไม่ผูกกับสถานะ — docs/BRANDING_SPEC.md ข้อ 6.3
 *   สถานะของถังสื่อผ่านเส้นเกณฑ์กับ StatusBadge บนการ์ด ไม่ใช่ผ่านสีของน้ำ
 *   (ของเดิมเปลี่ยนสีน้ำตามสถานะ ทำให้แดงไปโผล่ในพื้นที่ข้อมูลซึ่งผิดกฎการใช้แดงในข้อ 3.3)
 */
const WATER_BODY = 'fill-water';
const WATER_SURFACE = 'fill-water-soft';

interface TankGaugeProps {
  percentFull: number;
  shape: TankShape;
  /** เกณฑ์ที่จะขีดเส้นอ้างอิงบนถัง (เปอร์เซ็นต์) */
  markers?: { percent: number; tone: EntityStatus }[];
  className?: string;
}

/**
 * ภาพถังน้ำแบบ SVG พร้อมระดับน้ำที่ไหลขึ้นลงตามค่าจริง
 *
 * ระดับใช้ CSS transition ที่ความสูงของ rect จึงขยับนุ่มเมื่อค่าใหม่เข้ามาทุก 2 วินาที
 * ผิวน้ำเป็นคลื่นสองชั้นเลื่อนสวนทางกัน ให้ดูมีชีวิตบนจอที่เปิดทิ้งไว้ทั้งวัน
 */
export function TankGauge({ percentFull, shape, markers = [], className }: TankGaugeProps): JSX.Element {
  const width = 120;
  const height = 150;
  const inset = 6;
  const innerHeight = height - inset * 2;
  const clamped = Math.min(100, Math.max(0, percentFull));
  const waterHeight = (clamped / 100) * innerHeight;
  const waterTop = inset + innerHeight - waterHeight;

  // บ่อขุดผนังลาด วาดเป็นทรงสี่เหลี่ยมคางหมู ถังกลมมุมมนกว่า
  const isPond = shape === 'pond' || shape === 'irregular';
  const bodyRadius = shape === 'cylindrical' ? 26 : isPond ? 4 : 10;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn('h-full w-full', className)}
      role="img"
      aria-label={`ระดับน้ำ ${clamped.toFixed(1)} เปอร์เซ็นต์`}
    >
      <defs>
        <clipPath id={`tank-clip-${shape}`}>
          {isPond ? (
            <polygon points={`${inset + 14},${inset} ${width - inset - 14},${inset} ${width - inset},${height - inset} ${inset},${height - inset}`} />
          ) : (
            <rect x={inset} y={inset} width={width - inset * 2} height={innerHeight} rx={bodyRadius} />
          )}
        </clipPath>
      </defs>

      {/* ผนังถัง */}
      {isPond ? (
        <polygon
          points={`${inset + 14},${inset} ${width - inset - 14},${inset} ${width - inset},${height - inset} ${inset},${height - inset}`}
          className="fill-secondary stroke-border"
          strokeWidth={2}
        />
      ) : (
        <rect
          x={inset}
          y={inset}
          width={width - inset * 2}
          height={innerHeight}
          rx={bodyRadius}
          className="fill-secondary stroke-border"
          strokeWidth={2}
        />
      )}

      <g clipPath={`url(#tank-clip-${shape})`}>
        {/* ตัวน้ำ — ความสูงเปลี่ยนแบบ transition ทำให้ระดับไหลขึ้นลงแทนการกระโดด */}
        <rect
          x={0}
          y={waterTop}
          width={width}
          height={waterHeight + 4}
          className={cn(WATER_BODY, '[transition:y_900ms_ease-out,height_900ms_ease-out]')}
        />

        {/* ผิวน้ำ 2 ชั้นเลื่อนสวนทาง */}
        {clamped > 0.5 && (
          <g className="[transition:transform_900ms_ease-out]" style={{ transform: `translateY(${waterTop}px)` }}>
            {/* คลื่นสองชั้นเลื่อนสวนทาง — ใช้คนละขั้นในบันไดเดียวกัน ไม่ได้ทำจาง ๆ ด้วย opacity */}
            <path d="M-120 0 q30 -5 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 v12 h-360 z" className={WATER_SURFACE}>
              <animateTransform attributeName="transform" type="translate" from="0 0" to="120 0" dur="5s" repeatCount="indefinite" />
            </path>
            <path d="M-120 2 q30 5 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 v12 h-360 z" className={WATER_BODY}>
              <animateTransform attributeName="transform" type="translate" from="120 0" to="0 0" dur="7s" repeatCount="indefinite" />
            </path>
          </g>
        )}
      </g>

      {/* เส้นเกณฑ์เตือน */}
      {markers.map((marker) => {
        const y = inset + innerHeight - (Math.min(100, Math.max(0, marker.percent)) / 100) * innerHeight;
        return (
          <line
            key={`${marker.percent}-${marker.tone}`}
            x1={inset}
            x2={width - inset}
            y1={y}
            y2={y}
            strokeWidth={1}
            strokeDasharray="3 3"
            className={marker.tone === 'critical' ? 'stroke-status-critical' : 'stroke-status-warning'}
          />
        );
      })}

      {/* ขีดบอกระดับทุก 25% */}
      {[25, 50, 75].map((mark) => {
        const y = inset + innerHeight - (mark / 100) * innerHeight;
        return <line key={mark} x1={width - inset - 10} x2={width - inset} y1={y} y2={y} strokeWidth={1} className="stroke-border" />;
      })}
    </svg>
  );
}
