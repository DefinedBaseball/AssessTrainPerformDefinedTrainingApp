'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Metric, Video } from '@/lib/api';

import { TabBar, TabPanel } from '@/components/assessment';
import type { Tab } from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from './page.module.css';

import { PlayerSummaryTab } from './tabs/PlayerSummaryTab';
import { HittingTab } from './tabs/HittingTab';
import { DefenseTab } from './tabs/DefenseTab';
import { PitchingTab } from './tabs/PitchingTab';
import { VisionTab } from './tabs/VisionTab';
import { StrengthConditioningTab } from './tabs/StrengthConditioningTab';

import { ReportModal } from './ReportModal';
import { formatHeight, getAge, computeAggregateScores, scoreColor } from './helpers';
import type { ReportSummary, TabProps } from './helpers';

/* ── Tab icons (inline SVG, stroke-based) ── */
const iconProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const IconSummary = (
  <svg {...iconProps}><path d="M4 19V5M4 19h16M8 15V9M12 15V6M16 15v-4M20 15v-7" /></svg>
);
const IconHitting = (
  <svg {...iconProps}><path d="M3 21l4-4" /><path d="M7 17l10-10a3 3 0 114 4L11 21l-4 0 0-4z" /><circle cx="4.5" cy="19.5" r="1.2" /></svg>
);
const IconDefense = (
  <svg {...iconProps}><path d="M6 6c0-1.5 1-3 3-3h6c2 0 3 1.5 3 3v6c0 4-3 8-6 9-3-1-6-5-6-9V6z" /><path d="M9 10v3M12 10v4M15 10v3" /></svg>
);
const IconPitching = (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M7.5 6.5c2 3 5 6 10 8.5M16.5 6.5c-2 3-5 6-10 8.5" /></svg>
);
const IconVision = (
  <svg {...iconProps}><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
const IconStrength = (
  <svg {...iconProps}><path d="M3 9v6M6 6v12M10 4v16M14 4v16M18 6v12M21 9v6" /></svg>
);

/* ── Tab definitions ── */
const TABS: Tab[] = [
  { key: 'summary', label: 'Player Summary', icon: IconSummary },
  { key: 'hitting', label: 'Hitting', icon: IconHitting },
  { key: 'defense', label: 'Defense', icon: IconDefense },
  { key: 'pitching', label: 'Pitching', icon: IconPitching },
  { key: 'vision', label: 'Vision', icon: IconVision },
  { key: 'strength', label: 'Strength & Conditioning', icon: IconStrength },
];

/* ── Progress metrics to fetch ── */
const PROGRESS_METRICS = [
  // Hitting
  'max_exit_velo', 'max_bat_speed', 'avg_exit_velo', 'avg_bat_speed',
  'bat_speed', 'smash_factor', 'launch_angle', 'attack_angle', 'distance',
  // Defense
  'infield_velo', 'outfield_velo', 'catcher_velo', 'pop_time', 'exchange_time',
  // Pitching
  'fb_max_velo', 'sprint_60', 'spin_rate',
  // Strength
  'jump_height', 'broad_jump', 'squat_max', 'bench_max', 'deadlift_max',
  // Vision
  'vizual_edge_overall', 'vizual_edge_convergence', 'vizual_edge_divergence',
  'vizual_edge_tracking', 'vizual_edge_recognition',
];

export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isCoach, isLoading: authLoading } = useAuth();

  // When rendered inline (e.g., player dashboard), use playerId from auth
  const id = params?.id || (user as any)?.playerId || '';

  const [activeTab, setActiveTab] = useState('summary');
  const [player, setPlayer] = useState<(Player & { metrics: Metric[] }) | null>(null);
  const [topMetrics, setTopMetrics] = useState<Record<string, { value: number; unit: string; recordedAt: string }>>({});
  const [videos, setVideos] = useState<Video[]>([]);
  const [progressData, setProgressData] = useState<Record<string, { value: number; recordedAt: string }[]>>({});
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showReportModal, setShowReportModal] = useState(false);

  /* ── Auth guard ── */
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  /* ── Data loading ── */
  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);
    setError(null);

    const progressPromises = PROGRESS_METRICS.map(mt =>
      api.getMetricProgress(id, mt)
        .then(data => ({ mt, data }))
        .catch(() => ({ mt, data: [] as { value: number; recordedAt: string }[] })),
    );

    Promise.all([
      api.getPlayer(id),
      api.getTopMetrics(id).catch(() => ({})),
      api.getPlayerVideos(id).catch(() => []),
      api.getPlayerReports(id).catch(() => []),
      Promise.all(progressPromises),
    ]).then(([p, top, vids, reps, progressResults]) => {
      setPlayer(p);
      setTopMetrics(top);
      setVideos(vids);
      setReports(reps as ReportSummary[]);
      const pd: Record<string, { value: number; recordedAt: string }[]> = {};
      progressResults.forEach(({ mt, data }) => { if (data.length > 0) pd[mt] = data; });
      setProgressData(pd);
      setLoading(false);
    }).catch((err: Error) => {
      setError(err.message || 'Failed to load player');
      setLoading(false);
    });
  }, [user, id, refreshKey]);

  /* ── Aggregate score (hero "Player Score" bubble) ── */
  const aggregate = useMemo(() => {
    if (!player) return null;
    return computeAggregateScores(player, reports, topMetrics);
  }, [player, reports, topMetrics]);

  /* ── Visible tabs (position- and report-driven) ── */
  const visibleTabs = useMemo(() => {
    if (!player) return TABS;
    const positions = (player.positions || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const hasNonPitcher = positions.some((p) => p !== 'P');
    const isPitcher = positions.includes('P');
    const hasDefenseReport = reports.some((r) =>
      r.reportType === 'INFIELD' || r.reportType === 'OUTFIELD' || r.reportType === 'CATCHING',
    );

    return TABS.filter((t) => {
      if (t.key === 'summary') return true;
      if (t.key === 'hitting') return hasNonPitcher;
      if (t.key === 'pitching') return isPitcher;
      if (t.key === 'defense') return hasNonPitcher && hasDefenseReport;
      return true; // vision, strength
    });
  }, [player, reports]);

  // If the current tab is filtered out (e.g. positions changed), fall back to Summary.
  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === activeTab)) {
      setActiveTab('summary');
    }
  }, [visibleTabs, activeTab]);

  /* ── Guards ── */
  if (authLoading || !user) return null;
  if (loading) return <div className={styles.loading}>Loading player profile...</div>;
  if (error || !player) return <div className={styles.error}>{error || 'Player not found'}</div>;

  /* ── Tab props ── */
  const tabProps: TabProps = {
    player,
    topMetrics,
    progressData,
    videos,
    reports,
    isCoach,
    onRefresh: () => setRefreshKey(k => k + 1),
    refreshKey,
  };

  return (
    <div>
      {/* ── Back Link (coaches navigating from Athletes list) ── */}
      {isCoach && params?.id && (
        <Link href="/athletes" className={styles.backLink}>← Athletes</Link>
      )}

      {/* ── Tab Bar (above player name bubble) ── */}
      <TabBar tabs={visibleTabs} activeKey={activeTab} onTabChange={setActiveTab} />

      {/* ── Hero Section (compact — name + tabs only) ── */}
      <div className={styles.heroOuter}>
        {isCoach && (
          <div className={styles.heroEyebrowRow}>
            <button
              type="button"
              className={styles.newReportBtn}
              onClick={() => setShowReportModal(true)}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Report
            </button>
          </div>
        )}

        {/* Hero layout: left column (name + stats + info row) | right column (commitment) */}
        <div className={`${styles.heroTopRow}${activeTab !== 'summary' ? ` ${styles.heroTopRowCompact}` : ''}`}>

          {/* Left: single big player card */}
          <div className={`${styles.playerCard}${activeTab !== 'summary' ? ` ${styles.playerCardCompact}` : ''}`}>
            {/* Name row with accent bar */}
            <div className={styles.nameRow}>
              <div className={styles.nameAccent} aria-hidden="true" />
              <h1 className={styles.heroName}>{player.firstName} {player.lastName}</h1>
            </div>

            {activeTab === 'summary' && (
            <>
            {/* Divider */}
            <div className={styles.cardDivider} />

            {/* Single stat row: Position / Height / Weight / Bats/Throws / Grad Year / Age / High School */}
            <div className={`${styles.cardStatRow} ${styles.cardStatRowProfile}`}>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Position</span>
                <span className={styles.cardStatValue}>{player.positions || '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Height</span>
                <span className={styles.cardStatValue}>{formatHeight(player.heightInches)}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Weight</span>
                <span className={styles.cardStatValue}>{player.weightLbs ? `${player.weightLbs}` : '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Bats/Throws</span>
                <span className={styles.cardStatValue}>
                  {(player.bats || '—')}/{(player.throws || '—')}
                </span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Grad Year</span>
                <span className={styles.cardStatValue}>{player.gradYear || '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Age</span>
                <span className={styles.cardStatValue}>{getAge(player.birthDate, player.gradYear)}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>High School</span>
                <span className={styles.cardStatValue}>{player.highSchool || '—'}</span>
              </div>
            </div>
            </>
            )}
          </div>

          {/* Middle: player score */}
          <div className={styles.scoreBox}>
            <div className={styles.scoreLabel}>Player Score</div>
            <div className={styles.scoreValueRow}>
              <span
                className={styles.scoreValue}
                style={
                  aggregate?.overall != null
                    ? { color: scoreColor(aggregate.overall) }
                    : undefined
                }
              >
                {aggregate?.overall ?? '—'}
              </span>
              <span className={styles.scoreMax}>/80</span>
            </div>
            <div className={styles.scoreSub}>
              {aggregate?.overall != null ? '20–80 Scale' : 'Not Scored'}
            </div>
          </div>

          {/* Right: college commitment — falls back to club team when uncommitted */}
          {(() => {
            const committed = Boolean(player.collegeCommit);
            const showingClub = !committed && Boolean(player.clubTeam);
            return (
              <div className={`${styles.commitBox}${committed ? ` ${styles.commitBoxCommitted}` : ''}${showingClub ? ` ${styles.commitBoxClub}` : ''}`}>
                {committed ? (
                  <svg
                    className={styles.commitIcon}
                    width="22" height="22" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  >
                    <path d="M22 10L12 4 2 10l10 6 10-6z" />
                    <path d="M6 12v5c0 1 2 3 6 3s6-2 6-3v-5" />
                    <path d="M22 10v6" />
                  </svg>
                ) : (
                  <svg
                    className={styles.commitIcon}
                    width="22" height="22" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  >
                    <path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2" />
                    <circle cx="10" cy="7" r="3" />
                    <path d="M21 21v-2a4 4 0 00-3-3.87" />
                    <path d="M17 3.13A4 4 0 0117 11" />
                  </svg>
                )}
                <div className={styles.commitLabel}>
                  {committed ? 'College Commitment' : showingClub ? 'Club Team' : 'College Commitment'}
                </div>
                {committed ? (
                  <div className={styles.commitName}>{player.collegeCommit}</div>
                ) : showingClub ? (
                  <div className={styles.commitName}>{player.clubTeam}</div>
                ) : (
                  <div className={styles.commitNone}>Uncommitted</div>
                )}
              </div>
            );
          })()}

        </div>
      </div>

      {/* ── Content ── */}
      <div className={styles.contentWrap}>
        <TabPanel active={activeTab === 'summary'}>
          <PlayerSummaryTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'hitting'}>
          <HittingTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'defense'}>
          <DefenseTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'pitching'}>
          <PitchingTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'vision'}>
          <VisionTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'strength'}>
          <StrengthConditioningTab {...tabProps} />
        </TabPanel>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <ReportModal
          player={player}
          userId={(user as any).id || (user as any).sub}
          onClose={() => setShowReportModal(false)}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
}
