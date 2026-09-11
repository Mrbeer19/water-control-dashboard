'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { WaterTariffTier } from '@/lib/types';
import { useLocale } from '@/lib/i18n';
import { formatBaht, formatCubicMeters } from '@/lib/utils';
import { splitIntoTiers, round } from '@/lib/utils/calculation';
import { Button } from '@/components/ui/button';
import { NumberField, TextField, findError, type SettingsSectionProps } from './field';

/** 3.5 — อัตราค่าน้ำแบบขั้นบันได พร้อมตัวอย่างการคำนวณ */
export function BillingSection({ draft, errors, onChange }: SettingsSectionProps): JSX.Element {
  const { t, locale } = useLocale();
  const [previewUsage, setPreviewUsage] = useState(120);
  const billing = draft.billing;

  const setBilling = (patch: Partial<typeof billing>): void => {
    onChange({ billing: { ...billing, ...patch } });
  };

  const setTier = (index: number, patch: Partial<WaterTariffTier>): void => {
    setBilling({ tiers: billing.tiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)) });
  };

  const addTier = (): void => {
    const last = billing.tiers[billing.tiers.length - 1];
    const from = last?.maxCubicMeters ?? (last?.minCubicMeters ?? 0) + 50;
    // ขั้นเดิมที่เคยเป็นขั้นบนสุดต้องมีเพดาน ไม่งั้นขั้นใหม่จะไม่มีวันถูกใช้
    const tiers = billing.tiers.map((tier, i) =>
      i === billing.tiers.length - 1 && tier.maxCubicMeters === null ? { ...tier, maxCubicMeters: from } : tier,
    );
    setBilling({
      tiers: [
        ...tiers,
        {
          id: `tier-${Date.now()}`,
          name: `${from}+ ลบ.ม.`,
          nameEn: `${from}+ m³`,
          minCubicMeters: from,
          maxCubicMeters: null,
          ratePerCubicMeter: last?.ratePerCubicMeter ?? 20,
        },
      ],
    });
  };

  const removeTier = (index: number): void => {
    const tiers = billing.tiers.filter((_, i) => i !== index);
    // ขั้นสุดท้ายต้องไม่มีเพดานเสมอ ไม่งั้นปริมาณที่เกินจะตกหล่นไม่ถูกคิดเงิน
    const fixed = tiers.map((tier, i) => (i === tiers.length - 1 ? { ...tier, maxCubicMeters: null } : tier));
    setBilling({ tiers: fixed });
  };

  const breakdown = splitIntoTiers(previewUsage, billing.tiers);
  const subtotal = round(breakdown.reduce((sum, tier) => sum + tier.amountBaht, 0), 2);
  const vat = round(((subtotal + billing.serviceChargeBaht) * billing.vatPercent) / 100, 2);
  const total = round(subtotal + billing.serviceChargeBaht + vat, 2);

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold">{t.settings.tiers}</p>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={addTier}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t.settings.addTier}
          </Button>
        </div>
        {findError(errors, 'billing.tiers') !== undefined && (
          <p className="mb-2 text-[11px] text-form-error">{findError(errors, 'billing.tiers')?.messageTh}</p>
        )}

        <div className="space-y-2">
          {billing.tiers.map((tier, index) => (
            <div key={tier.id} className="grid items-start gap-2 rounded-card border p-3 sm:grid-cols-[1fr_auto] ">
              <div className="grid gap-2 sm:grid-cols-4">
                <TextField label={t.settings.nameLabel} value={tier.name} onChange={(value) => { setTier(index, { name: value }); }} />
                <NumberField
                  label={t.settings.tierFrom}
                  value={tier.minCubicMeters}
                  unit="m³"
                  min={0}
                  error={findError(errors, `billing.tiers.${index}.min`)}
                  onChange={(value) => { setTier(index, { minCubicMeters: value }); }}
                />
                <NumberField
                  label={t.settings.tierTo}
                  value={tier.maxCubicMeters ?? 0}
                  unit="m³"
                  min={0}
                  disabled={tier.maxCubicMeters === null}
                  hint={tier.maxCubicMeters === null ? t.settings.unlimited : undefined}
                  error={findError(errors, `billing.tiers.${index}.max`)}
                  onChange={(value) => { setTier(index, { maxCubicMeters: value }); }}
                />
                <NumberField
                  label={t.settings.tierRate}
                  value={tier.ratePerCubicMeter}
                  step={0.1}
                  min={0}
                  unit={`${t.units.baht}/m³`}
                  error={findError(errors, `billing.tiers.${index}.rate`)}
                  onChange={(value) => { setTier(index, { ratePerCubicMeter: value }); }}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t.settings.removeTier}
                disabled={billing.tiers.length <= 1}
                className="mt-5 text-muted-foreground hover:text-status-critical"
                onClick={() => { removeTier(index); }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <NumberField
          label={t.settings.serviceCharge}
          value={billing.serviceChargeBaht}
          min={0}
          unit={t.units.baht}
          onChange={(value) => { setBilling({ serviceChargeBaht: value }); }}
        />
        <NumberField
          label={t.settings.vat}
          value={billing.vatPercent}
          step={0.5}
          min={0}
          max={100}
          unit="%"
          error={findError(errors, 'billing.vatPercent')}
          onChange={(value) => { setBilling({ vatPercent: value }); }}
        />
        <NumberField
          label={t.settings.cycleStart}
          value={billing.billingCycleStartDay}
          min={1}
          max={28}
          error={findError(errors, 'billing.billingCycleStartDay')}
          onChange={(value) => { setBilling({ billingCycleStartDay: value }); }}
        />
        <NumberField
          label={t.settings.readingDay}
          value={billing.meterReadingDay}
          min={1}
          max={28}
          error={findError(errors, 'billing.meterReadingDay')}
          onChange={(value) => { setBilling({ meterReadingDay: value }); }}
        />
      </div>

      {/* ตัวอย่างการคำนวณ — ให้เห็นผลของขั้นอัตราทันทีโดยไม่ต้องรอรอบบิลจริง */}
      <div className="rounded-card border bg-secondary p-4">
        <p className="mb-2 text-sm font-semibold">{t.settings.preview}</p>
        <div className="mb-3 max-w-[220px]">
          <NumberField
            label={t.settings.previewUsage}
            value={previewUsage}
            step={10}
            min={0}
            unit="m³"
            onChange={setPreviewUsage}
          />
        </div>
        <table className="w-full text-xs">
          <tbody>
            {breakdown.map((tier) => (
              <tr key={tier.tierId} className="border-b last:border-0">
                <td className="py-1">{tier.tierName}</td>
                <td className="tabular py-1 text-right">{formatCubicMeters(tier.cubicMeters, locale)}</td>
                <td className="tabular py-1 text-right text-muted-foreground">× {tier.ratePerCubicMeter}</td>
                <td className="tabular py-1 text-right font-medium">{formatBaht(tier.amountBaht, locale, 2)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1 text-muted-foreground" colSpan={3}>{t.settings.serviceCharge}</td>
              <td className="tabular py-1 text-right">{formatBaht(billing.serviceChargeBaht, locale, 2)}</td>
            </tr>
            <tr>
              <td className="py-1 text-muted-foreground" colSpan={3}>VAT {billing.vatPercent}%</td>
              <td className="tabular py-1 text-right">{formatBaht(vat, locale, 2)}</td>
            </tr>
            <tr className="border-t">
              <td className="py-1.5 font-semibold" colSpan={3}>{t.settings.previewTotal}</td>
              <td className="tabular py-1.5 text-right text-base font-semibold">{formatBaht(total, locale, 2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
