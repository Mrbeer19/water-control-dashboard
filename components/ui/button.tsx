import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // ★ ข้อ 3.5: ตัวอักษรบนพื้น Cinnabar-500 ต้อง ≥ 16px / weight 600
        //   ปุ่มขนาดปกติเป็น 14px จึงต้องใช้พื้น Cinnabar-700 (brand-strong, 4.8:1)
        //   ขนาด lg ถูกตั้งเป็น 16px/600 จึงใช้ Cinnabar-500 ได้ ดู compoundVariants ด้านล่าง
        default: 'bg-brand-strong text-brand-strong-foreground hover:bg-brand-strong/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8 text-base font-semibold',
        icon: 'h-10 w-10',
      },
    },
    compoundVariants: [
      {
        variant: 'default',
        size: 'lg',
        // 16px / 600 แล้ว จึงวางบน Cinnabar-500 ได้ตามข้อ 3.5
        className: 'bg-primary text-primary-foreground hover:bg-primary/90',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
