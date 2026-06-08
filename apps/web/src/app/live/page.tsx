'use client';

/* ─────────────────────────────────────────────────────────────────────
   Live Session — Phase 1 scaffolding.
   The page is a mode picker only: pick TRAINING (per-player clip
   recording) or LIVE (pitch-by-pitch at-bat tracking) and the user is
   routed into the corresponding sub-flow. The sub-flow pages are
   stubs for now — they render a "Phase 2/3 coming soon" placeholder
   inside the same layout so the navigation contract is in place and
   the URL structure is locked.

   Route map (Phase 1):
     /live              → mode picker (this file)
     /live/training     → Training mode (stub for Phase 2)
     /live/at-bat       → Live mode    (stub for Phase 3)
   ───────────────────────────────────────────────────────────────── */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

interface ModeCard {
  href: string;
  label: string;
  blurb: string;
  /** Inline SVG glyph — same visual language as Sidebar nav icons. */
  icon: React.ReactNode;
}

const MODES: ModeCard[] = [
  {
    href: '/live/training',
    label: 'Training',
    blurb:
      'Record one clip per athlete during a focused training session. Pick a position, select the roster, then tap a player and hit Start Video. Switching players auto-saves the previous clip. Save the clips to each athlete on session end.',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* Dumbbell — same glyph the Sidebar's Training entry uses,
            scaled up so it reads at card-hero size. */}
        <rect x="2.5" y="8.5" width="3" height="7" />
        <rect x="18.5" y="8.5" width="3" height="7" />
        <rect x="5.5" y="10" width="2.5" height="4" />
        <rect x="16" y="10" width="2.5" height="4" />
        <path d="M8 12h8" />
      </svg>
    ),
  },
  {
    href: '/live/at-bat',
    label: 'Live',
    blurb:
      "Capture pitch-by-pitch at-bats during a scrimmage or bullpen. Pick a pitcher + hitter, tag each pitch's type / ball-strike / result, and record video per at-bat. Saved at-bats feed the Hitting tab's Swing Decision bubble and the Pitching tab's Live Results bubble.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* Record dot + concentric broadcast rings — matches the
            Sidebar's Live nav glyph at hero scale. */}
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        <path d="M8 7.5a6.5 6.5 0 0 0 0 9" />
        <path d="M16 7.5a6.5 6.5 0 0 1 0 9" />
        <path d="M5.5 5a9.5 9.5 0 0 0 0 14" />
        <path d="M18.5 5a9.5 9.5 0 0 1 0 14" />
      </svg>
    ),
  },
];

export default function LivePage() {
  const { user, isCoach } = useAuth();
  const router = useRouter();

  // Guard: coach-only. Players bounce to the dashboard since the
  // Live tools manage rosters / capture clips. Mirrors the pattern
  // used by /program and other coach-only pages.
  useEffect(() => {
    if (user === undefined) return; // still loading
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!isCoach) {
      router.replace('/');
    }
  }, [user, isCoach, router]);

  if (user === undefined || !user || !isCoach) {
    // Render nothing while the redirect fires — avoids a flash of
    // mode picker before the auth/role check resolves.
    return null;
  }

  return (
    <div className={styles.page}>
      <PageHeader size="bar" title="Training" subtitle="Pick a session mode" />

      <div className={styles.modeGrid}>
        {MODES.map((mode) => (
          <Link key={mode.href} href={mode.href} className={styles.modeCard}>
            <div className={styles.modeIcon}>{mode.icon}</div>
            <div className={styles.modeLabel}>{mode.label}</div>
            <div className={styles.modeBlurb}>{mode.blurb}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
