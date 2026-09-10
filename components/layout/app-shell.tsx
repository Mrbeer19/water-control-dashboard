'use client';

import { useState, type ReactNode } from 'react';
import { Header } from './header';
import { Sidebar } from './sidebar';

/** โครงหน้าจอร่วมของทุกหน้า: sidebar ถาวรบน desktop + drawer บน mobile */
export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen lg:pl-64">
      <Sidebar
        open={menuOpen}
        onClose={() => {
          setMenuOpen(false);
        }}
      />
      <div className="flex min-h-screen flex-col">
        <Header
          onOpenMenu={() => {
            setMenuOpen(true);
          }}
        />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
