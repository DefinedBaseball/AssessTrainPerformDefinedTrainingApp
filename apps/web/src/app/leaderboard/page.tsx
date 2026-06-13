'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { LeaderboardEntry, Player } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from './page.module.css';

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
  const [players, setPlayers] = useState<Player[]>([]);
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

  // Track whether initial recompute has completed (coaches get fresh data on page load)
  const [recomputeDone, setRecomputeDone] = useState(false);

  // Load players to derive grad years + auto-recompute for coaches
  useEffect(() => {
    if (!user) return;
    api.getPlayers().then(setPlayers).catch(() => setPlayers([]));

    // Coaches: silently recompute leaderboards on page load so data is always fresh
    if (user.role === 'COACH') {
      api.recomputeLeaderboard()
        .then(() => setRecomputeDone(true))
        .catch(() => setRecomputeDone(true));
    } else {
      setRecomputeDone(true);
    }
  }, [user]);

  // Derive available grad years from real player data
  const availableGradYears = useMemo(() => {
    const years = [...new Set(players.map(p => p.gradYear).filter((y): y is number => y !== null))];
    return years.sort((a, b) => a - b);
  }, [players]);

  // Auto-select the first available grad year when players load
  useEffect(() => {
    if (gradYear === null && availableGradYears.length > 0) {
      setGradYear(availableGradYears[0]);
    }
  }, [availableGradYears, gradYear]);

  // Fetch leaderboard data (waits for initial recompute to finish first)
  const fetchLeaderboard = useCallback(() => {
    if (!user || gradYear === null || !recomputeDone) return;
    setLoading(true);
    api.getLeaderboard(gradYear, metricType)
      .then(data => { setEntries(data); setLoading(false); })
      .catch(() => { setEntries([]); setLoading(false); });
  }, [user, gradYear, metricType, recomputeDone]);

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
    <div className={styles.pageWrap}>
      {/* ── Header ── */}
      <PageHeader
        eyebrow="Rankings"
        title="Leader"
        titleAccent="Boards"
        readout="Live"
        actions={isCoach ? (
          <button
            className={styles.recomputeBtn}
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

      {/* ── Outer lighter panel wrapping all controls + table ── */}
      <div
        className={aStyles.profilePanel}
        style={{ marginTop: 16, padding: 20, display: 'flex', flexDirection: 'column' }}
      >
      {/* ── Filter Selects (Grad Year + Metric) ── */}
      <div className={styles.filterGrid}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Graduation Year</label>
          {availableGradYears.length > 0 ? (
            <select
              className={styles.filterSelect}
              value={gradYear ?? ''}
              onChange={e => setGradYear(parseInt(e.target.value))}
            >
              {/* All Ages = sentinel 0 → backend ranks every grad year together. */}
              <option value={0}>All Ages</option>
              {availableGradYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          ) : (
            <span className={styles.noYears}>No athletes found — add players to see grad years.</span>
          )}
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Metric</label>
          <select
            className={styles.filterSelect}
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
      <div className={styles.tableWrap}>
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
                ? `No data for ${activeMetric?.label || metricType} ${gradYear === 0 ? 'across all ages' : `in the ${gradYear} class`}. Upload metrics via CSV or manual entry, then click "Recompute Rankings" above.`
                : `No data for ${activeMetric?.label || metricType} ${gradYear === 0 ? 'across all ages' : `in the ${gradYear} class`} yet.`}
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
      </div>{/* /profilePanel */}
    </div>
  );
}
