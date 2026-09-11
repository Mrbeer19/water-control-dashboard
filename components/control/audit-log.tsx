'use client';

import type { CommandLogEntry } from '@/lib/types';
import { COMMAND_STATE_LABEL } from '@/lib/services';
import { useLocale } from '@/lib/i18n';
import { cn, formatDateTimeTH } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const STATE_CLASS = {
  success: 'text-status-ok',
  timeout: 'text-status-warning',
  failed: 'text-status-critical',
  sending: 'text-info',
  awaiting_feedback: 'text-info',
  idle: 'text-muted-foreground',
} as const;

/** ใคร สั่งอะไร กับอะไร เมื่อไร ผลเป็นยังไง — เก็บไว้ให้ตรวจย้อนหลังได้ */
export function AuditLog({ entries, loading }: { entries: CommandLogEntry[] | null; loading: boolean }): JSX.Element {
  const { t, locale } = useLocale();

  if (loading && entries === null) {
    return <Skeleton className="h-56 rounded-lg" />;
  }

  if (entries === null || entries.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <p className="text-sm font-medium">{t.control.noCommands}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t.common.emptyHint}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.control.when}</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.control.target}</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.control.action}</th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium">{t.control.issuedBy}</th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">{t.control.result}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ command, result }) => (
              <tr key={command.id} className="border-b last:border-0 align-top hover:bg-accent/40">
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                  {formatDateTimeTH(command.issuedAt, locale)}
                </td>
                <td className="px-3 py-2.5">{command.targetName}</td>
                <td className="px-3 py-2.5">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{command.action}</code>
                  {command.value !== null && <span className="tabular ml-1.5 text-xs">{String(command.value)}</span>}
                  {command.reason !== null && (
                    <p className="mt-0.5 text-[11px] italic text-muted-foreground">{command.reason}</p>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs">
                  {command.issuedBy.displayName}
                  <span className="block text-[10px] text-muted-foreground">{command.issuedBy.role}</span>
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn('text-xs font-medium', STATE_CLASS[result.state])}>
                    {COMMAND_STATE_LABEL[result.state][locale]}
                  </span>
                  {result.latencyMs !== null && result.state === 'success' && (
                    <span className="tabular ml-1.5 text-[11px] text-muted-foreground">{result.latencyMs} ms</span>
                  )}
                  {result.errorMessage !== null && (
                    <p className="mt-0.5 max-w-[22rem] text-[11px] leading-snug text-muted-foreground">
                      {result.errorMessage}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
