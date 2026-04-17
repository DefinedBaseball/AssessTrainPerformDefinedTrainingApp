'use client';

import { useEffect, useState } from 'react';
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
import { formatHeight, getAge } from './helpers';
import type { ReportSummary, TabProps } from './helpers';

/* ── Tab definitions ── */
const TABS: Tab[] = [
  { key: 'summary', label: 'Player Summary' },
  { key: 'hitting', label: 'Hitting' },
  { key: 'defense', label: 'Defense' },
  { key: 'pitching', label: 'Pitching' },
  { key: 'vision', label: 'Vision' },
  { key: 'strength', label: 'Strength & Conditioning' },
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

      {/* ── Hero Section (compact — name + tabs only) ── */}
      <div className={styles.heroOuter}>
        <div className={styles.heroEyebrow}>SUMMER PRO ASSESSMENT</div>

        {/* Hero layout: left column (name + stats + info row) | right column (commitment) */}
        <div className={styles.heroTopRow}>

          {/* Left: single big player card */}
          <div className={styles.playerCard}>
            {/* Name */}
            <h1 className={styles.heroName}>{player.firstName} {player.lastName}</h1>

            {/* Divider */}
            <div className={styles.cardDivider} />

            {/* Row 1: Position, Height, Weight, Bats, Throws */}
            <div className={styles.cardStatRow}>
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
                <span className={styles.cardStatLabel}>Bats</span>
                <span className={styles.cardStatValue}>{player.bats || '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Throws</span>
                <span className={styles.cardStatValue}>{player.throws || '—'}</span>
              </div>
            </div>

            {/* Row 2: Grad Year, Age, High School, Club Team, PBR National, PBR State, PBR Position, PG Score */}
            <div className={styles.cardStatRow}>
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
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>Club Team</span>
                <span className={styles.cardStatValue}>{player.clubTeam || '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>PBR National</span>
                <span className={styles.cardStatValue}>{player.pbrNational ? `#${player.pbrNational}` : '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>PBR State</span>
                <span className={styles.cardStatValue}>{player.pbrState ? `#${player.pbrState}` : '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>PBR Position</span>
                <span className={styles.cardStatValue}>{player.pbrPosition ? `#${player.pbrPosition}` : '—'}</span>
              </div>
              <div className={styles.cardStat}>
                <span className={styles.cardStatLabel}>PG Score</span>
                <span className={styles.cardStatValue}>{player.pgScore || '—'}</span>
              </div>
            </div>
          </div>

          {/* Right: college commitment */}
          <div className={`${styles.commitBox}${player.collegeCommit ? ` ${styles.commitBoxCommitted}` : ''}`}>
            <div className={styles.commitLabel}>College Commitment</div>
            {player.collegeCommit ? (
              <div className={styles.commitName}>{player.collegeCommit}</div>
            ) : (
              <div className={styles.commitNone}>Uncommitted</div>
            )}
          </div>

        </div>

        {isCoach && (
          <button
            type="button"
            className={styles.newReportBtn}
            onClick={() => setShowReportModal(true)}
          >
            + New Report
          </button>
        )}
      </div>

      {/* ── Tab Bar (directly under name) ── */}
      <TabBar tabs={TABS} activeKey={activeTab} onTabChange={setActiveTab} />

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
