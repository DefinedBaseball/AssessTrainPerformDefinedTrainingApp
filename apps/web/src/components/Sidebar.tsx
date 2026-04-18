'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import styles from './Sidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  sub: string;
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
    sub: 'Overview + analytics',
    coachLabel: 'Dashboard',
    playerLabel: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 13.5h6.5V20H4z" />
        <path d="M13.5 4H20v16h-6.5z" />
        <path d="M4 4h6.5v6.5H4z" />
        <path d="M13.5 13.5H20V20h-6.5z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    sub: 'Your athlete profile',
    playerOnly: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20c.8-3.6 4-5.5 7.5-5.5s6.7 1.9 7.5 5.5" />
      </svg>
    ),
  },
  {
    href: '/athletes',
    label: 'Athletes',
    sub: 'Roster \u00b7 Profiles',
    coachOnly: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M16.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M7.5 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M2.8 19.5c.6-2.6 2.9-4 5.5-4s4.9 1.4 5.5 4" />
        <path d="M13.5 18.8c.5-1.8 2.1-2.8 4-2.8 1.8 0 3.2.8 3.7 2.5" />
      </svg>
    ),
  },
  {
    href: '/training',
    label: 'Training',
    sub: 'Calendar \u00b7 Workouts',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 10v4" />
        <path d="M6 8v8" />
        <path d="M9 9.5v5" />
        <path d="M15 9.5v5" />
        <path d="M18 8v8" />
        <path d="M21 10v4" />
        <path d="M9 12h6" />
        <path d="M6 12H3" />
        <path d="M21 12h-3" />
      </svg>
    ),
  },
  {
    href: '/education',
    label: 'Education',
    sub: 'Classes \u00b7 Drills \u00b7 Examples',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h11v14.5a1.5 1.5 0 0 0-1.5-1.5H7a2.5 2.5 0 0 0-2.5 2.5z" />
        <path d="M7 4a2.5 2.5 0 0 0-2.5 2.5V20" />
        <path d="M8.5 8h6" />
        <path d="M8.5 11h6" />
      </svg>
    ),
  },
  {
    href: '/leaderboard',
    label: 'Leaderboards',
    sub: 'Age Ranks',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M8 4h8v2a4 4 0 0 1-4 4 4 4 0 0 1-4-4z" />
        <path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5c0 2.5 2 4.5 4.5 4.5H8" />
        <path d="M17 6h2.5A1.5 1.5 0 0 1 21 7.5c0 2.5-2 4.5-4.5 4.5H16" />
        <path d="M12 10v5" />
        <path d="M8.5 20h7" />
        <path d="M9.5 15h5l1 5h-7z" />
      </svg>
    ),
  },
  {
    href: '/videos',
    label: 'Videos',
    sub: 'Video Library',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5" width="12" height="14" rx="2" />
        <path d="m16 10 4-2.5v9L16 14" />
        <path d="M7 9h6" />
        <path d="M7 12h4" />
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Data Analytics',
    sub: 'Custom charts \u00b7 Previews',
    coachOnly: true,
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 20V8" />
        <path d="M10 20V4" />
        <path d="M16 20v-8" />
        <path d="M22 20V10" />
        <path d="M3 20h19" />
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
    <aside className={styles.sidebar}>
      <div>
        {/* ── Brand ── */}
        <div className={styles.brand}>
          <div className={styles.logoIcon}>
            <img src="/logo.png" alt="" width={50} height={50} />
          </div>
          <div className={styles.brandCopy}>
            <h1 className={styles.brandTitle}>Defined Baseball Academy</h1>
            <p className={styles.brandSub}>Assess, Train, Perform</p>
          </div>
        </div>

        {/* ── Eyebrow ── */}
        <p className={styles.eyebrow}>Navigation</p>

        {/* ── Nav Items ── */}
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
              >
                <span className={styles.iconBox} aria-hidden="true">
                  {item.icon}
                </span>
                <span className={styles.labelWrap}>
                  <strong className={styles.labelTitle}>{label}</strong>
                  <span className={styles.labelSub}>{item.sub}</span>
                </span>
                <span className={styles.dot} />
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── Account Card ── */}
      {user && (
        <div className={styles.account}>
          <div className={styles.accountTop}>
            <div className={styles.avatar}>
              {user.email[0].toUpperCase()}
            </div>
            <div className={styles.meta}>
              <strong className={styles.metaName}>{user.email}</strong>
              <span className={styles.metaRole}>{user.role}</span>
            </div>
          </div>
          <div className={styles.accountActions}>
            <Link href="/settings" className={styles.settingsBtn}>Settings</Link>
            <button className={styles.logoutBtn} onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
