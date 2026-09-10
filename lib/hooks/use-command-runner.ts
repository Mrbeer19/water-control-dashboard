'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandLogEntry, CommandResult } from '@/lib/types';
import { getCommandResult, isCommandPending, issueCommand, type IssueCommandInput } from '@/lib/services';

/** ความถี่ที่ถาม PLC ว่า feedback มาหรือยัง */
const POLL_INTERVAL_MS = 300;

export interface CommandRunner {
  /** ส่งคำสั่งและติดตามจนถึงสถานะสุดท้าย */
  run: (input: IssueCommandInput) => Promise<void>;
  /** คำสั่งล่าสุดที่ส่งจากตัวนี้ — null เมื่อยังไม่เคยส่ง */
  entry: CommandLogEntry | null;
  result: CommandResult | null;
  /** true ระหว่าง sending / awaiting_feedback */
  pending: boolean;
  /** ล้างผลออกจากหน้าจอ */
  clear: () => void;
}

/**
 * ส่งคำสั่งหนึ่งอันแล้วตามผลจนจบ
 *
 * ★ แยก "สถานะปุ่มที่กด" ออกจาก "สถานะจริงของอุปกรณ์" โดยสิ้นเชิง
 *   ปุ่มรู้แค่ว่าคำสั่งเดินไปถึงไหน ส่วนอุปกรณ์ขยับจริงหรือไม่ดูจาก entity
 *   ที่ไหลมาทาง useLiveData ต่างหาก — คำสั่ง success ไม่ได้แปลว่าเห็นผลทันที
 */
export function useCommandRunner(): CommandRunner {
  const [entry, setEntry] = useState<CommandLogEntry | null>(null);
  const [result, setResult] = useState<CommandResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const run = useCallback(
    async (input: IssueCommandInput) => {
      stopPolling();
      const issued = await issueCommand(input);
      if (!activeRef.current) return;

      setEntry(issued);
      setResult(issued.result);
      if (!isCommandPending(issued.result.state)) return;

      timerRef.current = setInterval(() => {
        void (async () => {
          const latest = await getCommandResult(issued.command.id);
          if (!activeRef.current || latest === null) return;
          setResult(latest);
          if (!isCommandPending(latest.state)) stopPolling();
        })();
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  const clear = useCallback(() => {
    stopPolling();
    setEntry(null);
    setResult(null);
  }, [stopPolling]);

  return {
    run,
    entry,
    result,
    pending: result !== null && isCommandPending(result.state),
    clear,
  };
}
