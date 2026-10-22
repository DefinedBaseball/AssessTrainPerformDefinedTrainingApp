'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { LeaderboardEntry } from '@/lib/api';
import styles from './page.module.css';
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import theme from '../dashTheme.module.css';
import { EduHeader, IconPodium } from '../education/EduHeader';

/* ── Metric definitions ── */

const METRIC_TYPES = [
  { key: 'max_exit_velo', label: 'Max Exit Velo', unit: 'mph' },
  { key: 'avg_exit_velo', label: 'Avg Exit Velo', unit: 'mph' },
  { key: 'max_bat_speed', label: 'Max Bat Speed', unit: 'mph' },
  { key: 'fb_max_velo', label: 'FB Max Velo', unit: 'mph' },
  { key: 'infield_velo', label: 'Infield Velo', unit: 'mph' },
  { key: 'outfield_velo', label: 'Outfield Velo', unit: 'mph' },
  { key: 'catcher_velo', label: 'Catcher Velo', unit: 'mph' },
  { key: 'pop_time', label: 'Pop Time', unit: 'sec' },
  { key: 'jump_height', label: 'Jump Height', unit: 'in' },
  { key: 'sprint_60', label: '60-Yard Dash', unit: 'sec' },
  { key: 'sprint_10', label: '10-Yard Sprint', unit: 'sec' },
];

export default function LeaderboardPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  // Data
  const [gradYears, setGradYears] = useState<number[]>([]);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  // Filters
  const [gradYear, setGradYear] = useState<number | null>(null);
  const [metricType, setMetricType] = useState('max_exit_velo');

  // Auth guard
  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  // Load available grad years (both roles). No recompute on page load: the
  // server rebuilds the boards whenever results change (report saves, CSV
  // imports, a class change), so the stored rankings are already current.
  // The coach's Recompute button is still there for a manual rebuild.
  useEffect(() => {
    if (!user) return;
    // Dedicated endpoint returns just the year numbers so PLAYERS can build the
    // dropdown too — the coach-only player list left their board blank before.
    api.getLeaderboardGradYears().then(setGradYears).catch(() => setGradYears([]));
  }, [user]);

  // Available grad years for the dropdown (from the grad-years endpoint).
  const availableGradYears = useMemo(() => {
    return [...new Set(gradYears)].sort((a, b) => a - b);
  }, [gradYears]);

  // Auto-select the first available grad year when players load
  useEffect(() => {
    if (gradYear === null && availableGradYears.length > 0) {
      setGradYear(availableGradYears[0]);
    }
  }, [availableGradYears, gradYear]);

  // Fetch the leaderboard: the precomputed rankings (a fast indexed read).
  const fetchLeaderboard = useCallback(() => {
    if (!user || gradYear === null) return;
    setLoading(true);
    api.getLeaderboard(gradYear, metricType)
      .then(data => { setEntries(data); setLoading(false); })
      .catch(() => { setEntries([]); setLoading(false); });
  }, [user, gradYear, metricType]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  // Recompute handler (coach only)
  const handleRecompute = async () => {
    if (recomputing) return;
    setRecomputing(true);
    try {
      await api.recomputeLeaderboard();
      // Re-fetch current view after recompute
      fetchLeaderboard();
    } catch {
      // silently fail
    } finally {
      setRecomputing(false);
    }
  };

  const activeMetric = METRIC_TYPES.find(m => m.key === metricType);
  const isCoach = user?.role === 'COACH';

  if (isLoading || !user) return null;

  return (
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      {/* ── Header ── */}
      <EduHeader
        tone="light"
        chipInline
        icon={<IconPodium />}
        eyebrow="Rankings"
        /* Players: the thin one-line "Leaderboards" bar. */
        compact={user?.role === 'PLAYER'}
        title={user?.role === 'PLAYER' ? 'Leaderboards' : 'Leader'}
        accent={user?.role === 'PLAYER' ? undefined : 'Boards'}
        readout="Live"
        readoutClassName={theme.firm}
        actions={isCoach ? (
          <button
            className={`${styles.recomputeBtn} ${theme.field} ${theme.firm}`}
            onClick={handleRecompute}
            disabled={recomputing}
          >
            {recomputing ? (
              <><span className={styles.recomputeSpinner} /> Recomputing...</>
            ) : (
              '↻ Recompute Rankings'
            )}
          </button>
        ) : undefined}
      />

      {/* ── Outer bubble wrapping all controls + table ── */}
      <div
        className={theme.bubble}
        style={{ padding: 20, display: 'flex', flexDirection: 'column' }}
      >
      {/* ── Filter Selects (Grad Year + Metric) ── */}
      <div className={styles.filterGrid}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Graduation Year</label>
          {availableGradYears.length > 0 ? (
            <select
              className={`${styles.filterSelect} ${theme.field} ${theme.firm}`}
              value={gradYear ?? ''}
              onChange={e => setGradYear(parseInt(e.target.value))}
            >
              {/* All Ages = sentinel 0 → backend ranks every grad year together. */}
              <option value={0}>All Ages</option>
              {availableGradYears.map(y => (
                <option key={y} value={y}>{api.formatGradYear(y)}</option>
              ))}
              {/* Always offer College + Professional, even when no athlete
                  currently carries that grad year. */}
              {!availableGradYears.includes(api.GRAD_COLLEGE) && (
                <option value={api.GRAD_COLLEGE}>{api.formatGradYear(api.GRAD_COLLEGE)}</option>
              )}
              {!availableGradYears.includes(api.GRAD_PRO) && (
                <option value={api.GRAD_PRO}>{api.formatGradYear(api.GRAD_PRO)}</option>
              )}
            </select>
          ) : (
            <span className={styles.noYears}>No athletes found — add players to see grad years.</span>
          )}
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Metric</label>
          <select
            className={`${styles.filterSelect} ${theme.field} ${theme.firm}`}
            value={metricType}
            onChange={e => setMetricType(e.target.value)}
          >
            {METRIC_TYPES.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Leaderboard table ── */}
      <div className={`${styles.tableWrap} ${theme.inner} ${theme.firm}`}>
        {loading ? (
          <div className={styles.loadingWrap}>
            <div className={styles.spinner} />
            <p>Loading leaderboard...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🏆</span>
            <p className={styles.emptyTitle}>No rankings available</p>
            <p className={styles.emptyHint}>
              {isCoach
                ? `No data for ${activeMetric?.label || metricType} ${gradYear === 0 ? 'across all ages' : `in the ${api.formatGradYear(gradYear)} class`}. Upload metrics via CSV or manual entry, then click "Recompute Rankings" above.`
                : `No data for ${activeMetric?.label || metricType} ${gradYear === 0 ? 'across all ages' : `in the ${api.formatGradYear(gradYear)} class`} yet.`}
            </p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thRank}>Rank</th>
                <th className={styles.thPlayer}>Player</th>
                <th className={styles.thValue}>{activeMetric?.label || metricType}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} className={styles.row}>
                  <td className={styles.tdRank}>
                    <span className={`${styles.rank} ${i < 3 ? styles[`rank${i + 1}` as keyof typeof styles] : ''}`}>
                      {e.rank}
                    </span>
                  </td>
                  <td className={styles.tdPlayer}>
                    {e.player ? (
                      <Link href={`/athletes/${e.playerId}`} className={styles.playerLink}>
                        <span className={styles.playerAvatar}>
                          {e.player.profilePhoto ? (
                            <img
                              src={e.player.profilePhoto}
                              alt=""
                              className={styles.avatarImg}
                            />
                          ) : (
                            <>{e.player.firstName?.[0]}{e.player.lastName?.[0]}</>
                          )}
                        </span>
                        <span className={styles.playerInfo}>
                          <span className={styles.playerName}>
                            {e.player.firstName} {e.player.lastName}
                          </span>
                          <span className={styles.playerMeta}>
                            {e.player.positions || '—'}
                            {e.player.collegeCommit && (
                              <span className={styles.commit}> · {e.player.collegeCommit}</span>
                            )}
                          </span>
                        </span>
                      </Link>
                    ) : (
                      <span className={styles.unknownPlayer}>Unknown Player</span>
                    )}
                  </td>
                  <td className={styles.tdValue}>
                    <span className={styles.value}>
                      {activeMetric?.unit === 'sec' ? e.value.toFixed(2) : e.value.toFixed(1)}
                    </span>
                    <span className={styles.unit}>{activeMetric?.unit}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      </div>{/* /bubble */}
    </div>
  );
}
