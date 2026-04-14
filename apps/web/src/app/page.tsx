'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, UploadHistoryEntry } from '@/lib/api';
import { MOCK_PLAYERS } from '@/lib/mock-data';
import styles from './page.module.css';

/* ── Player Profile (inline) ── */
import PlayerProfilePage from './athletes/[id]/page';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [uploads, setUploads] = useState<UploadHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    // Players with a playerId don't need the coach dashboard data
    if (!isCoach && user.playerId) {
      setLoading(false);
      return;
    }
    const promises: Promise<any>[] = [
      api.getPlayers().then(p => {
        const athletes = p.filter((x: Player) => x.positions !== 'COACH');
        return athletes.length > 0 ? athletes : MOCK_PLAYERS;
      }).catch(() => MOCK_PLAYERS),
    ];
    if (isCoach) {
      promises.push(
        api.getUploadHistory().catch(() => []),
      );
    }
    Promise.all(promises).then(([p, u]) => {
      setPlayers(p);
      if (u) setUploads(u.slice(0, 5));
      setLoading(false);
    });
  }, [user, isCoach]);

  if (isLoading || !user) return null;

  /* ── Player view: show their own profile ── */
  if (!isCoach && user.playerId) {
    return <PlayerProfilePage />;
  }
  /* Players without a linked playerId see a message */
  if (!isCoach) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <h2>Welcome, {user.email}</h2>
        <p style={{ marginTop: 12 }}>Your player profile has not been linked yet. Please contact your coach.</p>
      </div>
    );
  }

  const gradYears = new Set(players.map(p => p.gradYear).filter(Boolean));
  const positionSet = new Set(players.flatMap(p => p.positions.split(',').map(s => s.trim())));
  const committed = players.filter(p => p.collegeCommit).length;

  return (
    <div>
      {/* ── Hero ── */}
      <div className={styles.heroOuter}>
        <div className={styles.hero}>
          <div className={styles.heroEyebrow}>
            {isCoach ? 'COACH DASHBOARD' : 'PLAYER DASHBOARD'}
          </div>
          <h1 className={styles.heroTitle}>
            {isCoach ? 'Assess, Train, Perform' : 'My Development'}
          </h1>
          <p className={styles.heroSub}>
            {isCoach
              ? 'Manage your athletes, upload data, and track development.'
              : 'View your profile, metrics, and development progress.'}
          </p>
          {isCoach && (
            <div className={styles.heroActions}>
              <Link href="/upload" className={`${styles.actionBtn} ${styles.actionPrimary}`}>
                📁 Upload CSV
              </Link>
              <Link href="/athletes" className={`${styles.actionBtn} ${styles.actionOutline}`}>
                👥 View All Athletes
              </Link>
              <Link href="/leaderboard" className={`${styles.actionBtn} ${styles.actionOutline}`}>
                🏆 Leaderboard
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      <div className={styles.content}>
        {/* Quick Stats */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{players.length}</div>
            <div className={styles.statLabel}>Total Athletes</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{gradYears.size}</div>
            <div className={styles.statLabel}>Grad Years</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{positionSet.size}</div>
            <div className={styles.statLabel}>Positions</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{committed}</div>
            <div className={styles.statLabel}>Committed</div>
          </div>
        </div>

        {/* Athletes Table */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              👥 Athletes
              <span className={styles.sectionBadge}>{players.length}</span>
            </div>
            <Link href="/athletes" className={styles.sectionAction}>View All →</Link>
          </div>
          {loading ? (
            <div className={styles.empty}>Loading athletes...</div>
          ) : players.length === 0 ? (
            <div className={styles.empty}>
              No athletes yet.
              <span className={styles.emptyHint}>
                {isCoach ? 'Add players from the Athletes page.' : ''}
              </span>
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Position</th>
                    <th>Class</th>
                    <th>Commit</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {players.slice(0, 10).map(p => (
                    <tr key={p.id}>
                      <td>
                        <div className={styles.playerCell}>
                          <div className={styles.avatar}>
                            {p.firstName[0]}{p.lastName[0]}
                          </div>
                          <div>
                            <div className={styles.playerName}>
                              {p.firstName} {p.lastName}
                            </div>
                            {p.gradYear && (
                              <div className={styles.playerSub}>Class of {p.gradYear}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={styles.positionsRow}>
                          {p.positions.split(',').map(pos => (
                            <span key={pos.trim()} className="chip">{pos.trim()}</span>
                          ))}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.gradYear || '—'}</td>
                      <td>
                        {p.collegeCommit ? (
                          <span className="chip chipGreen">{p.collegeCommit}</span>
                        ) : (
                          <span style={{ color: 'var(--faint)' }}>—</span>
                        )}
                      </td>
                      <td>
                        <Link href={`/athletes/${p.id}`} className={styles.viewBtn}>
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Uploads (Coach only) */}
        {isCoach && uploads.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                📁 Recent Uploads
                <span className={styles.sectionBadge}>{uploads.length}</span>
              </div>
              <Link href="/upload" className={styles.sectionAction}>Upload New →</Link>
            </div>
            <div className={styles.uploadList}>
              {uploads.map(u => (
                <div key={u.id} className={styles.uploadItem}>
                  <div className={styles.uploadMeta}>
                    <span className={styles.uploadSource}>{u.source}</span>
                    <span className={styles.uploadDate}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </span>
                    {u.successRows != null && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {u.successRows}/{u.totalRows} rows
                      </span>
                    )}
                  </div>
                  <span className={`${styles.uploadStatus} ${
                    u.status === 'COMPLETED' ? styles.statusSuccess
                    : u.status === 'FAILED' ? styles.statusFailed
                    : styles.statusPending
                  }`}>
                    {u.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick Access */}
        {isCoach && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>⚡ Quick Access</div>
            </div>
            <div className={styles.quickGrid}>
              <Link href="/upload" className={styles.quickCard}>
                <span className={styles.quickIcon}>📁</span>
                <span className={styles.quickLabel}>Upload CSV</span>
                <span className={styles.quickDesc}>Import Blast Motion, Full Swing, Trackman, or VALD data</span>
              </Link>
              <Link href="/leaderboard" className={styles.quickCard}>
                <span className={styles.quickIcon}>🏆</span>
                <span className={styles.quickLabel}>Leaderboard</span>
                <span className={styles.quickDesc}>View top performers by metric and grad year</span>
              </Link>
              <Link href="/videos" className={styles.quickCard}>
                <span className={styles.quickIcon}>🎬</span>
                <span className={styles.quickLabel}>Videos</span>
                <span className={styles.quickDesc}>Manage session film, annotations, and voice-overs</span>
              </Link>
              <Link href="/training" className={styles.quickCard}>
                <span className={styles.quickIcon}>🏋️</span>
                <span className={styles.quickLabel}>Training</span>
                <span className={styles.quickDesc}>Build training programs and schedule workouts</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
