'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import styles from './Sidebar.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  coachOnly?: boolean;
  playerOnly?: boolean;
  coachLabel?: string;
  playerLabel?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '📊', coachLabel: 'Dashboard', playerLabel: 'Profile' },
  { href: '/athletes', label: 'Athletes', icon: '👥', coachOnly: true },
  { href: '/training', label: 'Training', icon: '🏋️' },
  { href: '/education', label: 'Education', icon: '📖' },
  { href: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
  { href: '/videos', label: 'Videos', icon: '🎬' },
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
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <img src="/logo.png" alt="" width={26} height={26} />
        </div>
        <span className={styles.logoText}>Assess, Train, Perform</span>
      </div>

      <nav className={styles.nav}>
        {visibleItems.map(item => {
          const label = isCoach
            ? (item.coachLabel || item.label)
            : (item.playerLabel || item.label);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${pathname === item.href ? styles.active : ''}`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      <div className={styles.footer}>
        {user && (
          <>
            <div className={styles.userInfo}>
              <div className={styles.avatar}>
                {user.email[0].toUpperCase()}
              </div>
              <div className={styles.userMeta}>
                <div className={styles.userEmail}>{user.email}</div>
                <div className={styles.userRole}>{user.role}</div>
              </div>
            </div>
            <button className={styles.logoutBtn} onClick={logout}>
              Sign Out
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
