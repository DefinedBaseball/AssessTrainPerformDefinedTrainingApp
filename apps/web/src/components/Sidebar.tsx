'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import styles from './Sidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  coachOnly?: boolean;
  playerOnly?: boolean;
  coachLabel?: string;
  playerLabel?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Dashboard',
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
    label: 'Data Analytics',
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
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, isCoach, logout } = useAuth();

  if (!user && pathname !== '/login') return null;
  if (pathname === '/login') return null;

  const visibleItems = NAV_ITEMS.filter(item => {
    if (item.coachOnly && !isCoach) return false;
    if (item.playerOnly && isCoach) return false;
    return true;
  });

  return (
    <aside className={styles.sidebar} data-theme="dark">
      {/* ── Brand (logo only in compact rail) ── */}
      <div className={styles.brand}>
        <div className={styles.logoIcon}>
          <img src="/logo.png" alt="Defined Baseball Academy" width={44} height={44} />
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className={styles.nav}>
        {visibleItems.map(item => {
          const label = isCoach
            ? (item.coachLabel || item.label)
            : (item.playerLabel || item.label);
          const isActive = pathname === item.href
            || (item.href !== '/' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              title={label}
              aria-label={label}
            >
              <span className={styles.iconBox} aria-hidden="true">
                {item.icon}
              </span>
              <span className={styles.labelWrap}>
                <strong className={styles.labelTitle}>{label}</strong>
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom stack: settings / sign-out ── */}
      {user && (
        <div className={styles.account}>
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
