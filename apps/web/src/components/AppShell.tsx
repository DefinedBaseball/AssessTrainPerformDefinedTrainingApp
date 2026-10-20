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

/* A parent login's app is its profile page plus their athletes' profiles
   (read-only). Every other route redirects to /parent before it renders;
   the API refuses anything else too, and checks each athlete is linked. */
const PARENT_HOME = '/parent';
/* Schedule (their athletes' training calendar), Education and Settings. */
const PARENT_PAGES = new Set(['/training', '/education', '/settings']);
const ATHLETE_PROFILE = /^\/athletes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending, isParent } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const parentAway = isParent && pathname !== PARENT_HOME
    && !PARENT_PAGES.has(pathname || '') && !ATHLETE_PROFILE.test(pathname || '');

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
