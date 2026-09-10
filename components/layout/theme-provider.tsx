'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemeMode } from '@/lib/types';

const STORAGE_KEY = 'wcm.theme';

interface ThemeContextValue {
  /** ค่าที่ผู้ใช้เลือก (อาจเป็น 'system') */
  theme: ThemeMode;
  /** ธีมที่แสดงจริงหลังแปลง 'system' แล้ว */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: 'light' | 'dark'): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  // อ่านค่าหลัง mount — สคริปต์ใน <head> ทาคลาสให้แล้วตั้งแต่ก่อน hydrate จึงไม่มีจอกะพริบ
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: ThemeMode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setThemeState(initial);
    const resolved = initial === 'system' ? systemTheme() : initial;
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  // ตามการตั้งค่าของเครื่องเมื่อผู้ใช้เลือก 'system'
  useEffect(() => {
    if (theme !== 'system') return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      const resolved = systemTheme();
      setResolvedTheme(resolved);
      applyTheme(resolved);
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    const resolved = next === 'system' ? systemTheme() : next;
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error('useTheme ต้องอยู่ภายใน <ThemeProvider>');
  }
  return context;
}

/**
 * สคริปต์ที่รันก่อน React hydrate เพื่อทาคลาส dark ทันที
 * ห้องคอนโทรลเปิดจอทิ้งไว้ ถ้าจอขาววาบตอนโหลดจะแสบตา
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var stored = localStorage.getItem('${STORAGE_KEY}');
  var dark = stored === 'dark' || ((stored === null || stored === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) { document.documentElement.classList.add('dark'); }
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}catch(e){}})();
`;
