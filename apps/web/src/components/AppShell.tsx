'use client';

/* ─────────────────────────────────────────────────────────────────────
   AppShell — the client wrapper that decides what chrome to render.

   A self-registered player whose account is still PENDING is gated to the
   PendingApproval holding screen for EVERY route (no sidebar, no page
   content) until a coach accepts them. Everyone else gets the normal
   Sidebar + scrollable <main> shell. Sits just inside <AuthProvider> in
   the root layout so the gate covers the whole app.
   ───────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from './Sidebar';
import { PendingApproval } from './PendingApproval';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useAuth();

  if (user && isPending) return <PendingApproval />;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main className="app-main" style={{ flex: 1, overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
