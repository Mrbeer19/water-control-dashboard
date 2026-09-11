import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-brand-strong text-brand-strong-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        outline: 'text-foreground',
        // ★ สถานะของอุปกรณ์/ระบบให้ใช้ <StatusBadge> ใน components/ui/status-badge.tsx เท่านั้น
        //   (ข้อ 3.4 บังคับไอคอน + ข้อความ) variant ด้านล่างเหลือไว้สำหรับป้ายที่ไม่ใช่สถานะ
        ok: 'border-transparent bg-status-ok text-status-ok-foreground',
        warning: 'border-transparent bg-status-warning text-status-warning-foreground',
        critical: 'border-transparent bg-status-critical text-status-critical-foreground',
        offline: 'border-transparent bg-status-offline text-status-offline-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
