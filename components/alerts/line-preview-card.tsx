'use client';

import { MessageSquare, RefreshCw, Send } from 'lucide-react';
import type { NotificationDelivery, NotificationPreview } from '@/lib/types';
import { retryNotificationDelivery } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatRelativeTime } from '@/lib/utils';
import { thirdParty } from '@/lib/config/theme';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * ตัวอย่างข้อความที่ปลายทางจะได้รับ + สถานะการส่งรายช่องทาง
 * ข้อความมาจาก service เพื่อให้ตรงกับที่ส่งจริง ไม่ใช่หน้าบ้านประกอบเองคนละแบบ
 */
export function LinePreviewCard({
  preview,
  deliveries,
  onRetried,
}: {
  preview: NotificationPreview | null;
  deliveries: NotificationDelivery[];
  onRetried: () => void;
}): JSX.Element {
  const { t, locale } = useLocale();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t.alerts.linePreview}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {preview === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t.alerts.previewHint}</p>
        ) : (
          <>
            {/* กล่องข้อความหน้าตาแบบแชท เพื่อให้เห็นว่าคนปลายทางจะเห็นอะไรจริง ๆ */}
            {/*
              สีแบรนด์ของ LINE ไม่ใช่สี CI ของ Kasetphand — เป็นข้อยกเว้นเดียวตาม BRANDING_SPEC ข้อ 3.7
              อ่านจาก lib/config/theme.ts คีย์ thirdParty.line และใช้ได้เฉพาะไฟล์นี้
            */}
            <div
              className="rounded-card rounded-tl-sm p-3 ring-1"
              style={{
                backgroundColor: `color-mix(in srgb, ${thirdParty.line} 10%, transparent)`,
                '--tw-ring-color': `color-mix(in srgb, ${thirdParty.line} 25%, transparent)`,
              } as React.CSSProperties}
            >
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                LINE · {preview.recipient}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{preview.body}</p>
            </div>

            <div className="space-y-1.5">
              {deliveries.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.alerts.pending}</p>
              ) : (
                deliveries.map((delivery) => (
                  <div key={delivery.id} className="flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-xs">
                    <Send
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        delivery.deliveryState === 'delivered' ? 'text-status-ok' : 'text-status-critical',
                      )}
                      aria-hidden
                    />
                    <span className="font-medium uppercase">{delivery.channel}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{delivery.recipient}</span>
                    <span
                      className={cn(
                        'shrink-0 font-medium',
                        delivery.deliveryState === 'delivered' ? 'text-status-ok' : 'text-status-critical',
                      )}
                    >
                      {delivery.deliveryState === 'delivered' ? t.alerts.sent : t.alerts.failed}
                    </span>
                    <span className="tabular shrink-0 text-muted-foreground">
                      {t.alerts.attempts} {delivery.attempts}
                    </span>
                    {delivery.lastAttemptAt !== null && (
                      <span className="hidden shrink-0 text-muted-foreground sm:inline">
                        {formatRelativeTime(delivery.lastAttemptAt, locale)}
                      </span>
                    )}
                    {delivery.deliveryState === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 shrink-0 gap-1 px-2 text-[11px]"
                        onClick={() => {
                          void retryNotificationDelivery(delivery.id).then(onRetried);
                        }}
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden />
                        {t.alerts.retry}
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
