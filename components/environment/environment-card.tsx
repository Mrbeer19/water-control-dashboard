'use client';

import { CloudRain, Droplet, Gauge, Minus, Sun, Thermometer, TrendingDown, TrendingUp } from 'lucide-react';
import type { EnvironmentSensor, TimeSeriesPoint } from '@/lib/types';
import { useLiveData } from '@/lib/hooks/use-live-data';
import { getEnvironmentHistory } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatNumber, formatPercent, formatRelativeTime, formatTemperature, STATUS_TEXT_CLASS } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sparkline } from '@/components/charts/sparkline';
import { CHART } from '@/components/charts/chart-tokens';

/** การ์ดเซนเซอร์หนึ่งจุด — จุดกลางแจ้งมีค่าเพิ่มที่จุดในอาคารไม่มี */
export function EnvironmentCard({ sensor }: { sensor: EnvironmentSensor }): JSX.Element {
  const { t, locale } = useLocale();
  const { data: tempHistory } = useLiveData<TimeSeriesPoint[]>(
    () => getEnvironmentHistory(sensor.id, 'temperature'),
    [sensor.id],
  );

  const reading = sensor.latest;
  const trendIcon =
    sensor.pressureTrend3h === 'rising' ? TrendingUp : sensor.pressureTrend3h === 'falling' ? TrendingDown : Minus;
  const TrendIcon = trendIcon;
  const trendLabel =
    sensor.pressureTrend3h === 'rising'
      ? t.env.trendRising
      : sensor.pressureTrend3h === 'falling'
        ? t.env.trendFalling
        : t.env.trendSteady;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">
              {locale === 'th' ? sensor.locationLabel : sensor.locationLabelEn}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {t.common.updatedAt} {formatRelativeTime(sensor.lastSeen, locale)}
            </p>
          </div>
          <StatusBadge status={sensor.status} />
        </div>

        <div className="flex items-end gap-4">
          <div>
            <p className={cn('tabular text-metric leading-none', STATUS_TEXT_CLASS[sensor.status])}>
              {formatTemperature(reading.temperatureCelsius, locale)}
            </p>
            <p className="tabular mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Droplet className="h-3.5 w-3.5" aria-hidden />
              {formatPercent(reading.humidityPercent, locale, 0)} RH
            </p>
          </div>
          <div className="min-w-[80px] flex-1">
            <Sparkline points={tempHistory ?? []} color={CHART.sequential} height={38} label={t.env.last24h} />
            <p className="mt-0.5 text-right text-[10px] text-muted-foreground">{t.env.last24h}</p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-3 text-xs">
          <Field
            icon={Thermometer}
            label={t.env.heatIndex}
            value={formatTemperature(reading.heatIndexCelsius, locale)}
            /* ดัชนีความร้อนเกิน 40°C คือช่วงที่เริ่มเสี่ยงต่อคนทำงาน */
            tone={reading.heatIndexCelsius >= 41 ? 'text-status-critical' : reading.heatIndexCelsius >= 35 ? 'text-status-warning' : undefined}
          />
          <Field icon={Droplet} label={t.env.dewPoint} value={formatTemperature(reading.dewPointCelsius, locale)} />

          {reading.pressureHpa !== null && (
            <>
              <Field icon={Gauge} label={t.env.pressure} value={`${formatNumber(reading.pressureHpa, locale, 1)} hPa`} />
              <div className="min-w-0">
                <dt className="truncate text-[10px] text-muted-foreground">{t.env.trend3h}</dt>
                <dd className="tabular inline-flex items-center gap-1 font-medium">
                  <TrendIcon className="h-3 w-3" aria-hidden />
                  {sensor.pressureTrend3h === null
                    ? '—'
                    : `${trendLabel} ${sensor.pressureChange3hHpa === null ? '' : formatNumber(sensor.pressureChange3hHpa, locale, 1)}`}
                </dd>
              </div>
            </>
          )}

          {reading.illuminanceLux !== null && (
            <Field icon={Sun} label={t.env.illuminance} value={`${formatNumber(reading.illuminanceLux, locale)} lx`} />
          )}

          {reading.rainfallTodayMm !== null && (
            <Field
              icon={CloudRain}
              label={t.env.rainToday}
              value={`${formatNumber(reading.rainfallTodayMm, locale, 1)} mm`}
              tone={reading.rainDetected === true ? 'text-primary' : undefined}
            />
          )}
          {reading.rainfallMonthMm !== null && (
            <Field icon={CloudRain} label={t.env.rainMonth} value={`${formatNumber(reading.rainfallMonthMm, locale, 1)} mm`} />
          )}
        </dl>

        {reading.rainDetected === true && (
          <p className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary">
            <CloudRain className="h-3.5 w-3.5" aria-hidden />
            {t.env.raining} · {formatNumber(reading.rainfallMmPerHour ?? 0, locale, 1)} mm/h
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Thermometer;
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
      <dd className={cn('tabular inline-flex items-center gap-1 truncate font-medium', tone)}>
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {value}
      </dd>
    </div>
  );
}
