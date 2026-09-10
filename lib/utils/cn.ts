import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** รวม className โดยให้คลาส Tailwind ที่ชนกันตัวหลังชนะ */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
