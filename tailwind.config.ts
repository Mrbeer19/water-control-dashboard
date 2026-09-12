import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1536px' },
    },
    extend: {
      fontFamily: {
        // ละตินและตัวเลขเป็น Montserrat ตาม CI ส่วนอักษรไทยตกไปที่ IBM Plex Sans Thai
        // ทั้งสองตัว self-host อยู่ใน app/fonts/ — BRANDING_SPEC ข้อ 4
        sans: [
          'var(--font-montserrat)',
          'var(--font-plex-thai)',
          'system-ui',
          'sans-serif',
        ],
      },
      colors: {
        border: 'hsl(var(--border))',
        // เส้นแบ่ง "ส่วนของหน้า" (header / เมนู / เนื้อหา / ท้ายหน้า) — เข้มกว่าขอบการ์ดหนึ่งขั้น
        'border-strong': 'hsl(var(--border-strong))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // สีแบรนด์เมื่อใช้เป็น "ข้อความ" — Cinnabar-500 ได้ contrast แค่ 4.4:1 จึงใช้ขั้นที่เข้ม/สว่างกว่า
        // ดู BRANDING_SPEC ข้อ 3.2 และ 3.5
        'brand-text': 'hsl(var(--brand-text))',
        // ข้อความ error ในฟอร์ม — Cinnabar-800 ได้ 5.7:1 ทุกพื้น ต่างจาก Cinnabar-700 ที่ใช้ได้เฉพาะบนการ์ด
        'form-error': 'hsl(var(--form-error))',
        // พื้นแบรนด์ที่ใช้ได้กับตัวอักษรเล็กกว่า 16px — Cinnabar-700 ได้ 4.8:1 กับตัวอักษรขาว
        'brand-strong': {
          DEFAULT: 'hsl(var(--brand-strong))',
          foreground: 'hsl(var(--brand-strong-foreground))',
        },
        // สีของข้อมูลน้ำ — เป็น hex ตรง ๆ ใช้ opacity modifier ไม่ได้ ซึ่งตั้งใจให้เป็นแบบนั้น
        water: {
          DEFAULT: 'var(--data-water)',
          soft: 'var(--data-water-soft)',
        },
        // ข้อความ/ไอคอนเชิงแจ้งให้ทราบ และสถานะ "กำลังดำเนินการ" — BRANDING_SPEC ข้อ 3.3
        info: {
          DEFAULT: 'hsl(var(--info))',
          strong: 'hsl(var(--info-strong))',
          'strong-foreground': 'hsl(var(--info-strong-foreground))',
        },
        // การ์ดเด่นหนึ่งใบต่อหน้า — พื้น Royal Navy Blue ตัวอักษรขาว (BRANDING_SPEC ข้อ 3.8)
        // ★ ไม่ใช่สีสถานะ แดง/เหลือง/เขียว ยังสงวนไว้ให้ <StatusBadge> เท่านั้น
        // ภาพประกอบลายเส้นบนแถบหัวเรื่อง — ขั้นสีอ่อนของ Blue ไม่ใช้ opacity (ข้อ 5.5)
        'banner-art': 'hsl(var(--banner-art))',
        feature: {
          DEFAULT: 'hsl(var(--feature))',
          foreground: 'hsl(var(--feature-foreground))',
          muted: 'hsl(var(--feature-muted))',
        },
        // ชิปไอคอนหัวหมวด — ผิวสีอ่อนของบันได CI ใช้ค่าเดียวกันทั้งสองโหมด (ข้อ 3.8)
        chip: {
          water: 'hsl(var(--chip-water))',
          'water-foreground': 'hsl(var(--chip-water-foreground))',
          warning: 'hsl(var(--chip-warning))',
          'warning-foreground': 'hsl(var(--chip-warning-foreground))',
          ok: 'hsl(var(--chip-ok))',
          'ok-foreground': 'hsl(var(--chip-ok-foreground))',
          brand: 'hsl(var(--chip-brand))',
          'brand-foreground': 'hsl(var(--chip-brand-foreground))',
        },
        // Switch / Checkbox / Radio / Slider สถานะติ๊กแล้ว — BRANDING_SPEC ข้อ 3.3
        'control-checked': {
          DEFAULT: 'hsl(var(--control-checked))',
          foreground: 'hsl(var(--control-checked-foreground))',
        },
        // สีสถานะตาม CLAUDE.md: เขียว=ปกติ เหลือง=เตือน แดง=วิกฤต เทา=offline
        // รูปทรง pill (พื้น/จุด/ไอคอน) อยู่ใน BRANDING_SPEC ข้อ 3.4
        status: {
          ok: 'hsl(var(--status-ok))',
          'ok-foreground': 'hsl(var(--status-ok-foreground))',
          'ok-dot': 'hsl(var(--status-ok-dot))',
          warning: 'hsl(var(--status-warning))',
          'warning-foreground': 'hsl(var(--status-warning-foreground))',
          'warning-surface': 'hsl(var(--status-warning-surface))',
          critical: 'hsl(var(--status-critical))',
          'critical-foreground': 'hsl(var(--status-critical-foreground))',
          offline: 'hsl(var(--status-offline))',
          'offline-foreground': 'hsl(var(--status-offline-foreground))',
          'offline-dot': 'hsl(var(--status-offline-dot))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // ลำดับชั้นของผิวตาม BRANDING_SPEC ข้อ 6.2
        section: 'var(--radius-section)',
        card: 'var(--radius-card)',
        overlay: 'var(--radius-overlay)',
        control: 'var(--radius-control)',
      },
      fontSize: {
        // ตัวเลขสำหรับจอแขวนผนัง — BRANDING_SPEC ข้อ 4 กำหนด ≥ 48px ที่ 1920px และ ≥ 32px ที่ 375px
        // metric ใช้กับ KPI ทั่วไป (32px → 48px) ส่วน metric-lg ใช้กับตัวเลขเด่นของหน้าภาพรวม
        // ค่าปรับตามความกว้างจอด้วย clamp: metric 32px ที่ 375px → 48px ที่ 1920px
        metric: ['clamp(2rem, 1.5rem + 1.5vw, 3rem)', { lineHeight: '1.1', fontWeight: '700' }],
        'metric-lg': ['clamp(2.5rem, 1.75rem + 3vw, 4rem)', { lineHeight: '1.05', fontWeight: '800' }],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
