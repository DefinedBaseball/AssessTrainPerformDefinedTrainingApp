'use client';

/* ─────────────────────────────────────────────────────────────────────
   /videos — mode picker landing screen, in the Coach Dashboard theme
   (banner + hub-style tiles, grey in light theme / charcoal in dark).
   Three tiles let the user pick:
     • Video Library — the full filterable Film Room (was the
                       previous /videos page, now at /videos/library)
     • Training      — per-player clip recording session (existing
                       /live/training flow, unchanged)
     • Live          — pitch-by-pitch at-bat tracking (existing
                       /live/at-bat flow, unchanged)
   With Training + Live now reachable from this single Videos
   landing page, the standalone Live entry was retired from the
   sidebar.
   ───────────────────────────────────────────────────────────────── */

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
/* Coach Dashboard theme: the Education canvas + tokens, the dashboard's
   canvas shade, the banner, and hub-style mode tiles. */
import eduStyles from '@/app/education/page.module.css';
import dashStyles from '@/app/page.module.css';
import { EduHeader, IconFilm } from '@/app/education/EduHeader';
import styles from './hub.module.css';

interface ModeCard {
  href: string;
  label: string;
  blurb: string;
  icon: React.ReactNode;
  /** Small mono label above the title. */
  eyebrow: string;
  /** Accent ("r,g,b") for the icon chip, eyebrow and round arrow. */
  rgb: string;
  /** Player visibility — players can view the library but not run
   *  Training or Live capture sessions, those are coach-only. */
  coachOnly?: boolean;
}

const MODES: ModeCard[] = [
  {
    href: '/videos/library',
    label: 'Video Library',
    eyebrow: 'Film Room',
    rgb: '232,175,52',
    blurb:
      "Browse, filter, and play every clip on the roster. Search by player, position, category, grad year, or date range. Open a bubble to scrub, draw, compare angles, or record a narrated Coach Review — all of the Film Room's tools in one place.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* Stacked film reels / library — small play triangle in the
            front pane, lines on the back pane to read as "library". */}
        <rect x="3" y="6" width="14" height="11" rx="1.5" />
        <path d="M7 17v2" />
        <path d="M13 17v2" />
        <polygon points="8.5,9.5 8.5,13.5 12,11.5" fill="currentColor" stroke="none" />
        <path d="M17 6.5h4v11h-4" />
        <path d="M19 9h0.5" />
        <path d="M19 12h0.5" />
        <path d="M19 15h0.5" />
      </svg>
    ),
  },
  {
    href: '/live/training',
    label: 'Training',
    eyebrow: 'Session Capture',
    rgb: '61,139,253',
    blurb:
      'Record one clip per athlete during a focused training session. Pick a position, select the roster, then tap a player and hit Start Video. Switching players auto-saves the previous clip. Save the clips to each athlete on session end.',
    coachOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* Dumbbell — same glyph the /live page's Training card uses. */}
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
    eyebrow: 'At-Bat Tracking',
    rgb: '229,72,77',
    blurb:
      "Capture pitch-by-pitch at-bats during a scrimmage or bullpen. Pick a pitcher + hitter, tag each pitch's type / ball-strike / result, and record video per at-bat. Saved at-bats feed the Hitting tab's Swing Decision bubble and the Pitching tab's Live Results bubble.",
    coachOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {/* Record dot + concentric broadcast rings — same glyph the
            /live page's Live card uses. */}
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
        <path d="M8 7.5a6.5 6.5 0 0 0 0 9" />
        <path d="M16 7.5a6.5 6.5 0 0 1 0 9" />
        <path d="M5.5 5a9.5 9.5 0 0 0 0 14" />
        <path d="M18.5 5a9.5 9.5 0 0 1 0 14" />
      </svg>
    ),
  },
];

export default function VideosPage() {
  const { user, isCoach, isLoading } = useAuth();
  const router = useRouter();

  /* Auth guard — bounce unauth'd users to login. Players are NOT
     bounced like the original /live page did; players still get the
     Video Library card (it's safe for them), they just don't see
     the Training / Live cards (filtered by `coachOnly`). */
  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace('/login');
  }, [user, isLoading, router]);

  if (isLoading || !user) return null;

  const visibleModes = MODES.filter((m) => !m.coachOnly || isCoach);

  return (
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      <EduHeader
        tone="light"
        chipInline
        icon={<IconFilm />}
        eyebrow="Film Room"
        title="Videos"
        subtitle="Every clip on the roster, plus the Training and Live capture sessions."
      />

      <div className={styles.grid}>
        {visibleModes.map((mode, i) => (
          <Link
            key={mode.href}
            href={mode.href}
            className={styles.tile}
            style={{ '--tile-rgb': mode.rgb } as React.CSSProperties}
          >
            <span className={styles.tileRule} aria-hidden="true" />
            <span className={styles.tileWatermark} aria-hidden="true">{mode.icon}</span>
            <span className={styles.tileHead}>
              <span className={styles.tileIcon} aria-hidden="true">{mode.icon}</span>
              <span className={styles.tileIndex}>{String(i + 1).padStart(2, '0')}</span>
            </span>
            <span className={styles.tileBody}>
              <span className={styles.tileEyebrow}>{mode.eyebrow}</span>
              <span className={styles.tileTitle}>{mode.label}</span>
              <span className={styles.tileDesc}>{mode.blurb}</span>
            </span>
            <span className={styles.tileFoot}>
              <span className={styles.tileHint}>Open</span>
              <span className={styles.tileGo} aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
