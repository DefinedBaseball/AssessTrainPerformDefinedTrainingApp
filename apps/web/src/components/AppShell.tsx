'use client';

/* ─────────────────────────────────────────────────────────────────────
   AppShell — the client wrapper that decides what chrome to render.

   A self-registered player whose account is still PENDING is gated to the
   PendingApproval holding screen for EVERY route (no sidebar, no page
   content) until a coach accepts them. Everyone else gets the normal
   Sidebar + scrollable <main> shell. Sits just inside <AuthProvider> in
   the root layout so the gate covers the whole app.
   ───────────────────────────────────────────────────────────────────── */

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from './Sidebar';
import { PendingApproval } from './PendingApproval';

/* A parent login's whole app is its profile page. Every other route --
   coach or athlete -- redirects there before it renders, so no athlete
   page ever loads for a parent (the API refuses them too). */
const PARENT_HOME = '/parent';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending, isParent } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const parentAway = isParent && pathname !== PARENT_HOME;

  useEffect(() => {
    if (parentAway) router.replace(PARENT_HOME);
  }, [parentAway, router]);

  if (user && isPending) return <PendingApproval />;

  /* BOTH roles get a FIXED bottom nav bar on phones (see the bottom-bar
     block in Sidebar.module.css). Because it's fixed it no longer occupies
     flex space, so the scroll container needs bottom padding or the last row
     of content sits underneath it. Above the phone breakpoint the class is
     inert — the padding rule is inside a media query. */
  const bottomNav = !!user;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <main
        className={`app-main${bottomNav ? ' app-main-bottom-nav' : ''}`}
        style={{ flex: 1, overflowY: 'auto' }}
      >
        {parentAway ? null : children}
      </main>
    </div>
  );
}
