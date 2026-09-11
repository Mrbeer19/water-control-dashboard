'use client';

import { useLocale } from '@/lib/i18n';

/**
 * เครื่องหมายถูกในวงกลม แสดงตอนเข้าสู่ระบบสำเร็จก่อนพาไปหน้าภาพรวม
 *
 * ★ วงกลมกับเครื่องหมายถูกวาดด้วยการไล่ stroke-dashoffset ไม่ใช่การ fade เข้ามาเฉย ๆ
 *   จะได้รู้สึกว่า "ระบบกำลังยืนยัน" แทนที่จะเป็นแค่ไอคอนโผล่มา
 *
 * ★ เคารพ prefers-reduced-motion — ถ้าผู้ใช้ขอลดการเคลื่อนไหว จะข้ามไปสถานะสุดท้ายทันที
 *   (กติกาเดียวกับ animation อื่นในแอป ดู app/globals.css)
 */
export function LoginSuccess(): JSX.Element {
  const { t } = useLocale();

  return (
    <div className="flex flex-col items-center gap-3 py-6" role="status" aria-live="polite">
      <svg viewBox="0 0 96 96" className="success-pop h-24 w-24" aria-hidden focusable="false">
        <circle
          cx="48"
          cy="48"
          r="40"
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className="success-ring stroke-status-ok"
        />
        <path
          d="M31 49 l12 12 l22 -25"
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="success-check stroke-status-ok"
        />
      </svg>
      <p className="text-sm font-medium text-status-ok">{t.auth.signInSuccess}</p>
    </div>
  );
}
