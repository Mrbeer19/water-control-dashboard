'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeToUpdates } from '@/lib/services';

export interface LiveDataResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

/**
 * ดึงข้อมูลจาก service layer แล้วดึงซ้ำทุกครั้งที่มีค่าใหม่เข้ามา
 *
 * ★ fetcher ต้องเป็นฟังก์ชันจาก lib/services เท่านั้น
 *   component จึงไม่ต้องรู้ว่าเบื้องหลังเป็น mock หรือ API จริง
 */
export function useLiveData<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): LiveDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // เก็บ fetcher ล่าสุดไว้ใน ref เพื่อไม่ให้ inline arrow function ทำให้ effect รันใหม่ทุกเรนเดอร์
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let active = true;

    const load = async (): Promise<void> => {
      try {
        const result = await fetcherRef.current();
        if (!active) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    const unsubscribe = subscribeToUpdates(() => {
      void load();
    });

    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
