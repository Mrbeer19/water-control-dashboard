'use client';

import { useId, type ReactNode } from 'react';
import type { SettingsFieldError, SystemSettings } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * props ร่วมของทุกแท็บในหน้า Settings
 * แต่ละแท็บแก้เฉพาะส่วนของตัวเองบน draft ก้อนเดียว การบันทึกเกิดที่หน้าแม่ที่เดียว
 */
export interface SettingsSectionProps {
  draft: SystemSettings;
  errors: SettingsFieldError[];
  onChange: (patch: Partial<SystemSettings>) => void;
}

const CONTROL_CLASS =
  'h-9 w-full rounded-md border bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** หาข้อความผิดพลาดของฟิลด์หนึ่งจากรายการที่ service ตรวจมา */
export function findError(errors: SettingsFieldError[], path: string): SettingsFieldError | undefined {
  return errors.find((item) => item.path === path);
}

interface BaseProps {
  label: string;
  /** คำอธิบายใต้ช่อง บอกว่าค่านี้มีผลกับอะไร */
  hint?: string;
  error?: SettingsFieldError;
  className?: string;
}

function FieldShell({
  label,
  hint,
  error,
  className,
  htmlFor,
  children,
}: BaseProps & { htmlFor: string; children: ReactNode }): JSX.Element {
  const { locale } = useLocale();
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium">
        {label}
      </label>
      {children}
      {error !== undefined ? (
        <p className="text-[11px] leading-snug text-status-critical" role="alert">
          {locale === 'th' ? error.messageTh : error.messageEn}
        </p>
      ) : (
        hint !== undefined && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  disabled,
  ...rest
}: BaseProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <FieldShell {...rest} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        aria-invalid={rest.error !== undefined}
        className={cn(CONTROL_CLASS, rest.error !== undefined && 'border-status-critical')}
      />
    </FieldShell>
  );
}

export function NumberField({
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
  disabled,
  ...rest
}: BaseProps & {
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** หน่วยที่แสดงท้ายช่อง ช่วยให้ไม่ต้องเดาว่าตัวเลขนี้คืออะไร */
  unit?: string;
  disabled?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <FieldShell {...rest} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            // ช่องว่างให้เป็น 0 แทน NaN ไม่งั้น validation จะฟ้องข้อความที่อ่านไม่รู้เรื่อง
            onChange(event.target.value === '' ? 0 : next);
          }}
          aria-invalid={rest.error !== undefined}
          className={cn(CONTROL_CLASS, 'tabular pr-12', rest.error !== undefined && 'border-status-critical')}
        />
        {unit !== undefined && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ...rest
}: BaseProps & {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <FieldShell {...rest} htmlFor={id}>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
        className={cn(CONTROL_CLASS, rest.error !== undefined && 'border-status-critical')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function ToggleField({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-xs font-medium">
          {label}
        </label>
        {hint !== undefined && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          checked ? 'bg-control-checked' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-background transition-[left]',
            checked ? 'left-[1.125rem]' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** กล่องครอบหนึ่งกลุ่มฟิลด์ เช่น ถังหนึ่งใบ หรือปั๊มหนึ่งตัว */
export function FieldGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-3 text-sm font-semibold">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}
