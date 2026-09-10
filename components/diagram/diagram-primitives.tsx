'use client';

import type { EntityStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

export const NODE_FILL: Record<EntityStatus, string> = {
  ok: 'fill-status-ok/15 stroke-status-ok',
  warning: 'fill-status-warning/15 stroke-status-warning',
  critical: 'fill-status-critical/15 stroke-status-critical',
  offline: 'fill-status-offline/10 stroke-status-offline',
};

const STROKE: Record<EntityStatus, string> = {
  ok: 'stroke-status-ok',
  warning: 'stroke-status-warning',
  critical: 'stroke-status-critical',
  offline: 'stroke-status-offline',
};

/**
 * ท่อหนึ่งเส้น
 * ★ ความเร็วเส้นไหลผูกกับอัตราไหลจริง — ไหลแรงเส้นวิ่งเร็ว ไม่ไหลเส้นหยุดสนิท
 *   ถ้าปล่อยให้วิ่งเท่ากันหมด แผนผังจะโกหกว่าทุกท่อทำงานอยู่
 */
export function Pipe({
  d,
  flowLpm,
  status = 'ok',
  width = 6,
}: {
  d: string;
  flowLpm: number;
  status?: EntityStatus;
  width?: number;
}): JSX.Element {
  const flowing = flowLpm > 0.5;
  // ไหลแรง → รอบสั้น; หน่วงไว้ที่ 0.35–6 วินาที ให้ตายังตามทัน
  const duration = Math.max(0.35, Math.min(6, 90 / Math.max(flowLpm, 1)));

  return (
    <g>
      <path d={d} fill="none" strokeWidth={width} className="stroke-border" strokeLinecap="round" />
      {flowing && (
        <path
          d={d}
          fill="none"
          strokeWidth={width - 2}
          strokeLinecap="round"
          className={cn('pipe-flow', STROKE[status])}
          style={{ animationDuration: `${duration}s` }}
        />
      )}
    </g>
  );
}

/** กล่องอุปกรณ์ที่คลิกได้ พร้อมขอบเรืองแสงเมื่อ AI แจ้งว่าผิดปกติ */
export function DiagramNode({
  x,
  y,
  width,
  height,
  status,
  label,
  value,
  sub,
  anomaly = false,
  onClick,
  ariaLabel,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  status: EntityStatus;
  label: string;
  value?: string;
  sub?: string;
  anomaly?: boolean;
  onClick?: () => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <g
      transform={`translate(${x} ${y})`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (onClick !== undefined && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
      tabIndex={onClick === undefined ? undefined : 0}
      role={onClick === undefined ? undefined : 'button'}
      aria-label={ariaLabel}
      className={cn(onClick !== undefined && 'cursor-pointer outline-none [&:focus-visible>rect:first-of-type]:stroke-[3]')}
    >
      {anomaly && (
        <rect
          x={-4}
          y={-4}
          width={width + 8}
          height={height + 8}
          rx={10}
          fill="none"
          className="node-alarm stroke-status-critical"
        />
      )}
      <rect width={width} height={height} rx={8} strokeWidth={1.5} className={NODE_FILL[status]} />
      <text x={8} y={15} className="fill-foreground text-[10px] font-medium">
        {label}
      </text>
      {value !== undefined && (
        <text x={8} y={height - (sub === undefined ? 10 : 20)} className="tabular fill-foreground text-[14px] font-semibold">
          {value}
        </text>
      )}
      {sub !== undefined && (
        <text x={8} y={height - 7} className="tabular fill-muted-foreground text-[9px]">
          {sub}
        </text>
      )}
    </g>
  );
}
