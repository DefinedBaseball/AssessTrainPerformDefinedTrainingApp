'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import styles from './Sidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  coachOnly?: boolean;
  playerOnly?: boolean;
  coachLabel?: string;
  playerLabel?: string;
  /** Nested nav items rendered indented beneath this row. Used by the
   *  Data Analytics group to surface Live + Program as sub-items under
   *  the parent Data Analytics entry. */
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Dashboard',
    /* Dashboard is the home / news-feed surface — visible to both
       coaches AND players. Page-level UI elements that are
       coach-only (e.g. "+ Create Post") gate themselves via
       `isCoach` inside the page; the sidebar nav entry itself is
       always shown. */
    coachLabel: 'Dashboard',
    playerLabel: 'Dashboard',
    // 2x2 telemetry grid with an accent tick in the top-right module
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3.5" y="3.5" width="7" height="7" />
        <rect x="13.5" y="3.5" width="7" height="7" />
        <rect x="3.5" y="13.5" width="7" height="7" />
        <rect x="13.5" y="13.5" width="7" height="7" />
        <path d="M17 5.5h2" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    playerOnly: true,
    // Helmet-style head with angular shoulders
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M8.5 8.5a3.5 3.5 0 1 1 7 0v1a3.5 3.5 0 1 1-7 0z" />
        <path d="M4 20.5v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1" />
      </svg>
    ),
  },
  {
    href: '/athletes',
    label: 'Athletes',
    coachOnly: true,
    // Two stacked angular figures — roster readout
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M6.5 10.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0Z" />
        <path d="M15 11a2 2 0 1 1 4 0 2 2 0 0 1-4 0Z" />
        <path d="M3 20v-.5a4.5 4.5 0 0 1 4.5-4.5h3A4.5 4.5 0 0 1 15 19.5V20" />
        <path d="M15 15.5h1.5a3.5 3.5 0 0 1 3.5 3.5V20" />
      </svg>
    ),
  },
  {
    href: '/training',
    label: 'Training',
    // Clean dumbbell with visible grip
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="2.5" y="8.5" width="3" height="7" />
        <rect x="18.5" y="8.5" width="3" height="7" />
        <rect x="5.5" y="10" width="2.5" height="4" />
        <rect x="16" y="10" width="2.5" height="4" />
        <path d="M8 12h8" />
      </svg>
    ),
  },
  /* Live + Program retired from the top-level rail — they're now nested
     sub-items beneath Data Analytics (see the `children:` array on the
     Data Analytics entry below). Their routes are unchanged so existing
     bookmarks / links still work; only the sidebar grouping moved. */
  {
    href: '/education',
    label: 'Education',
    // Open book with crisp spine and two page rules
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 5.5h6.5a2 2 0 0 1 2 2v12a1.5 1.5 0 0 0-1.5-1.5H4z" />
        <path d="M20 5.5h-6.5a2 2 0 0 0-2 2v12a1.5 1.5 0 0 1 1.5-1.5H20z" />
        <path d="M6 9h4" />
        <path d="M6 12h4" />
        <path d="M14 9h4" />
        <path d="M14 12h4" />
      </svg>
    ),
  },
  {
    href: '/leaderboard',
    label: 'Leaderboards',
    // Stepped podium — 2nd / 1st / 3rd
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="13" width="5.5" height="8" />
        <rect x="9.25" y="7" width="5.5" height="14" />
        <rect x="15.5" y="16" width="5.5" height="5" />
        <path d="M11 4.5h2" />
      </svg>
    ),
  },
  {
    href: '/videos',
    label: 'Videos',
    // Coaches only — players access video via the Videos tab on their
    // own profile, so the global library entry is redundant for them.
    coachOnly: true,
    // Play triangle inside an angular display frame
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5.5" width="18" height="13" />
        <path d="m10.5 9.5 5 2.5-5 2.5z" />
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Data',
    coachOnly: true,
    // Ascending bars with an overlaid trend vector
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3.5" y="14" width="3" height="6.5" />
        <rect x="9" y="10" width="3" height="10.5" />
        <rect x="14.5" y="6" width="3" height="14.5" />
        <path d="m4 11 6-4 5 2 5-4" />
      </svg>
    ),
    /* Live retired from this sub-list — it now lives as a mode card
       on the top-level `/videos` page (alongside Video Library and
       Training). Program stays here. Both `/live`, `/live/training`,
       and `/live/at-bat` routes remain intact; they're just no
       longer surfaced from the sidebar. */
    children: [
      {
        href: '/program',
        label: 'Program',
        coachOnly: true,
        // Clipboard with a roster of horizontal lines
        icon: (
          <svg viewBox="0 0 24 24">
            <rect x="5" y="4.5" width="14" height="16" rx="1" />
            <rect x="9" y="2.5" width="6" height="3" rx="0.6" />
            <path d="M8 10h8" />
            <path d="M8 13h8" />
            <path d="M8 16h5" />
          </svg>
        ),
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, isCoach, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  if (!user && pathname !== '/login') return null;
  if (pathname === '/login') return null;

  /** Per-role visibility filter. Used at the top level AND recursively
   *  on each item's children so a coach-only sub-item doesn't leak
   *  into a player's sidebar. */
  function isVisible(item: NavItem): boolean {
    if (item.coachOnly && !isCoach) return false;
    if (item.playerOnly && isCoach) return false;
    return true;
  }
  const visibleItems = NAV_ITEMS.filter(isVisible);

  /** Render a single nav row (top-level or child). When the item has
   *  children, render the row followed by each visible child rendered
   *  with `isChild=true` so it picks up the indented sub-item style. */
  function renderNavItem(item: NavItem, isChild: boolean): React.ReactNode {
    const label = isCoach
      ? (item.coachLabel || item.label)
      : (item.playerLabel || item.label);
    const isActive = pathname === item.href
      || (item.href !== '/' && pathname.startsWith(item.href));
    const visibleChildren = (item.children || []).filter(isVisible);

    return (
      <React.Fragment key={item.href}>
        <Link
          href={item.href}
          className={`${styles.navItem}${isChild ? ' ' + styles.navItemChild : ''}${isActive ? ' ' + styles.active : ''}`}
          title={label}
          aria-label={label}
          onClick={() => {
            /* When the user is already on this section's path (e.g. on
               /education while drilled into Classes), fire a global
               "sidebar-nav-home" event so the page can reset its
               internal view state back to the section landing. Doing
               it on every click is a no-op for first-visits since the
               page is mounting fresh. */
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('sidebar-nav-home', { detail: { href: item.href } }),
              );
            }
          }}
        >
          <span className={styles.iconBox} aria-hidden="true">
            {item.icon}
          </span>
          <span className={styles.labelWrap}>
            <strong className={styles.labelTitle}>{label}</strong>
          </span>
        </Link>
        {visibleChildren.map(child => renderNavItem(child, true))}
      </React.Fragment>
    );
  }

  return (
    <aside className={styles.sidebar} data-theme="dark">
      {/* ── Brand (logo only in compact rail) ── */}
      <div className={styles.brand}>
        <div className={styles.logoIcon}>
          <img src="/logo.png" alt="Defined Baseball Academy" width={44} height={44} />
        </div>
      </div>

      {/* ── Nav ──
          Two-level rendering: top-level items render with the normal
          `.navItem` chrome; their children (if any) render right
          beneath with `.navItemChild` for the indented sub-item look.
          Used by Data Analytics to surface Live + Program as nested
          rows. The same `sidebar-nav-home` event fires for both. */}
      <nav className={styles.nav}>
        {visibleItems.map(item => renderNavItem(item, false))}
      </nav>

      {/* ── Bottom stack: theme toggle / settings / sign-out ── */}
      {user && (
        <div className={styles.account}>
          {/* Theme toggle — sun in dark mode, moon in light mode (the
              icon previews what you'd switch TO). */}
          <button
            type="button"
            className={styles.themeBtn}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              // Sun
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              // Moon
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
              </svg>
            )}
          </button>
          <Link href="/settings" className={styles.settingsBtn} aria-label="Settings" title="Settings" />
          <button
            className={styles.logoutBtn}
            onClick={logout}
            aria-label="Sign Out"
            title="Sign Out"
          />
        </div>
      )}
    </aside>
  );
}
