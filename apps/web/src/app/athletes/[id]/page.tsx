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
import { CatchingTab, InfieldTab, OutfieldTab } from './tabs/DefenseTab';
import { PitchingTab } from './tabs/PitchingTab';
import { VisionTab } from './tabs/VisionTab';
import { StrengthConditioningTab } from './tabs/StrengthConditioningTab';
import { VideosTab } from './tabs/VideosTab';

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
const IconVideos = (
  <svg {...iconProps}>
    <rect x="2" y="5" width="14" height="14" rx="2" />
    <path d="M16 10l5-3v10l-5-3z" />
    <circle cx="9" cy="12" r="2.5" />
  </svg>
);

/* ── Tab definitions ──
   Defense is split into three position-specific tabs that show only when
   the player has that position selected in their profile (C / INF / OF). */
const TABS: Tab[] = [
  { key: 'summary', label: 'Player Summary', icon: IconSummary },
  { key: 'hitting', label: 'Hitting', icon: IconHitting },
  { key: 'infield', label: 'Infield', icon: IconDefense },
  { key: 'catching', label: 'Catching', icon: IconDefense },
  { key: 'outfield', label: 'Outfield', icon: IconDefense },
  { key: 'pitching', label: 'Pitching', icon: IconPitching },
  { key: 'strength', label: 'Strength & Conditioning', icon: IconStrength },
  { key: 'videos', label: 'Videos', icon: IconVideos },
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
  /** When set, ReportModal opens in edit mode for this existing report. */
  const [editingReport, setEditingReport] = useState<ReportSummary | null>(null);
  /** When true, ReportModal opens in profile-only mode (player edit view) —
   *  shows just the Summary form with no report-type chips. */
  const [profileEditOpen, setProfileEditOpen] = useState(false);

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

  /* ── Visible tabs (position-driven) ──
     Defense was split into three position-specific tabs — each shows only
     when the player carries that position code on their profile. */
  const visibleTabs = useMemo(() => {
    if (!player) return TABS;
    const positions = (player.positions || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const hasNonPitcher = positions.some((p) => p !== 'P');
    const isPitcher = positions.includes('P');
    const isCatcher    = positions.includes('C');
    const isInfielder  = positions.includes('INF');
    const isOutfielder = positions.includes('OF');

    return TABS.filter((t) => {
      if (t.key === 'summary') return true;
      if (t.key === 'hitting') return hasNonPitcher;
      if (t.key === 'pitching') return isPitcher;
      if (t.key === 'catching') return isCatcher;
      if (t.key === 'infield')  return isInfielder;
      if (t.key === 'outfield') return isOutfielder;
      return true; // strength, videos
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
    onNewReport: () => { setEditingReport(null); setShowReportModal(true); },
    onEditReport: (r) => { setEditingReport(r); setShowReportModal(true); },
    onEditProfile: () => { setEditingReport(null); setProfileEditOpen(true); setShowReportModal(true); },
  };

  return (
    <div>
      {/* ── Back Link (coaches navigating from Athletes list) ── */}
      {isCoach && params?.id && (
        <Link href="/athletes" className={styles.backLink}>← Athletes</Link>
      )}

      {/* ── Tab Bar (above player name bubble) ── */}
      <TabBar tabs={visibleTabs} activeKey={activeTab} onTabChange={setActiveTab} />

      {/* ── COMMAND DECK HERO (ported from test-3) ── */}
      {(() => {
        const overall = aggregate?.overall ?? null;
        const pct = overall != null ? Math.max(0, Math.min(1, (overall - 20) / 60)) : 0;
        const R = 68;                // gauge radius
        const C = 2 * Math.PI * R;   // gauge circumference

        // 5-axis radar values (20-80 scouting scale) — derived from the
        // aggregate sections when available; otherwise a neutral 50.
        const bySection = (key: string) => {
          const sec = aggregate?.sections?.find((s) => s.key === key);
          if (!sec) return 50;
          const scored = sec.bars.filter((b) => b.score != null).map((b) => b.score as number);
          if (!scored.length) return 50;
          return scored.reduce((a, b) => a + b, 0) / scored.length;
        };
        // DEF axis rolls up across the per-position defense sections
        // (defense_infield / defense_catching / defense_outfield) since
        // the single 'defense' section was split. Average every populated
        // bar score across whichever ones exist; fall back to 50.
        const defenseScores = (aggregate?.sections ?? [])
          .filter((s) => s.key === 'defense_infield' || s.key === 'defense_catching' || s.key === 'defense_outfield')
          .flatMap((s) => s.bars.filter((b) => b.score != null).map((b) => b.score as number));
        const defAvg = defenseScores.length === 0
          ? 50
          : defenseScores.reduce((a, b) => a + b, 0) / defenseScores.length;
        // 4-axis radar (HIT / DEF / PITCH / ATH) — Vision was retired.
        const axes = [
          { label: 'HIT',    v: bySection('hitting') },
          { label: 'DEF',    v: defAvg },
          { label: 'PITCH',  v: bySection('pitching') },
          { label: 'ATH',    v: bySection('strength') },
        ];
        const rx = 70;
        const cx = 85;
        const cy = 85;
        const pts = axes.map((a, i) => {
          const theta = (-Math.PI / 2) + (2 * Math.PI * i) / axes.length;
          const k = Math.max(0.1, Math.min(1, (a.v - 20) / 60));
          return {
            x: cx + Math.cos(theta) * rx * k,
            y: cy + Math.sin(theta) * rx * k,
            lx: cx + Math.cos(theta) * (rx + 14),
            ly: cy + Math.sin(theta) * (rx + 14),
            label: a.label,
          };
        });

        const committed = Boolean(player.collegeCommit);

        return (
          <div className={styles.heroOuter}>
            {/* "New Report" has moved into the Reports dropdown on each tab. */}

            <div className={styles.commandDeck}>
              {/* LEFT: identity block */}
              <div className={styles.identityBlock}>
                <div className={styles.telemetryStrip}>
                  <i aria-hidden="true" />
                  <span>POS <b>{player.positions ? player.positions.split(',').map(p => p.trim()).filter(Boolean).join(', ') : '—'}</b></span>
                  <span>HT <b>{formatHeight(player.heightInches)}</b></span>
                  <span>WT <b>{player.weightLbs ? `${player.weightLbs} lb` : '—'}</b></span>
                  <span>B/T <b>{(player.bats || '—')}/{(player.throws || '—')}</b></span>
                  <span>GRAD <b>{player.gradYear || '—'}</b></span>
                  <span>AGE <b>{getAge(player.birthDate, player.gradYear)}</b></span>
                </div>

                <h1 className={styles.megaName}>
                  {player.firstName}{' '}
                  <span className={styles.lastName}>{player.lastName}</span>
                </h1>

                <div className={styles.hud}>
                  <div className={styles.hudCell}>
                    <span className={styles.hudLabel}>High School</span>
                    <span className={styles.hudValue}>{player.highSchool || '—'}</span>
                  </div>
                  <div className={`${styles.hudCell} ${player.clubTeam ? '' : styles.cold}`}>
                    <span className={styles.hudLabel}>Club Team</span>
                    <span className={styles.hudValue}>{player.clubTeam || '—'}</span>
                  </div>
                  <div className={`${styles.hudCell} ${committed ? styles.warm : styles.cold}`}>
                    <span className={styles.hudLabel}>Commitment</span>
                    <span className={styles.hudValue}>{committed ? player.collegeCommit : 'Uncommitted'}</span>
                  </div>
                </div>
              </div>

              {/* RIGHT: gauge + radar */}
              <div className={styles.metricsCol}>
                {(() => {
                  // Gauge now follows the unified score bands: 20-40 red,
                  // 40-50 orange, 50-60 yellow→green, 60-80 green. Use the
                  // current overall to drive the stroke color (plus a softer
                  // second stop for visual depth).
                  const gaugeHi = overall != null ? scoreColor(overall) : '#c9ced6';
                  const gaugeLo = overall != null ? scoreColor(Math.max(20, overall - 12)) : '#ffffff';
                  return (
                    <div className={styles.gaugeWrap}>
                      <svg viewBox="0 0 160 160" aria-hidden="true">
                        <defs>
                          <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%"  stopColor={gaugeLo} />
                            <stop offset="100%" stopColor={gaugeHi} />
                          </linearGradient>
                        </defs>
                        <circle cx="80" cy="80" r={R} className={styles.gaugeTrack} />
                        <circle
                          cx="80" cy="80" r={R}
                          className={styles.gaugeFill}
                          strokeDasharray={C}
                          strokeDashoffset={C - C * pct}
                        />
                      </svg>
                      <div className={styles.gaugeInner}>
                        <span
                          className={styles.val}
                          style={overall != null ? { color: gaugeHi, WebkitTextFillColor: gaugeHi, background: 'none' } : undefined}
                        >
                          {overall ?? '—'}
                        </span>
                        <span className={styles.suffix}>/80 SCALE</span>
                      </div>
                    </div>
                  );
                })()}

                <div className={styles.radarWrap}>
                  <svg viewBox="0 0 170 170" aria-hidden="true">
                    <defs>
                      <radialGradient id="radarFill" cx="50%" cy="50%" r="60%">
                        <stop offset="0%"  stopColor="rgba(255,255,255,0.32)" />
                        <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
                      </radialGradient>
                    </defs>
                    {[0.33, 0.66, 1].map((k) => (
                      <polygon
                        key={k}
                        className={styles.radarGrid}
                        points={axes.map((_, i) => {
                          const theta = (-Math.PI / 2) + (2 * Math.PI * i) / axes.length;
                          return `${cx + Math.cos(theta) * rx * k},${cy + Math.sin(theta) * rx * k}`;
                        }).join(' ')}
                      />
                    ))}
                    {axes.map((_, i) => {
                      const theta = (-Math.PI / 2) + (2 * Math.PI * i) / axes.length;
                      return (
                        <line
                          key={i}
                          className={styles.radarSpoke}
                          x1={cx} y1={cy}
                          x2={cx + Math.cos(theta) * rx}
                          y2={cy + Math.sin(theta) * rx}
                        />
                      );
                    })}
                    <polygon
                      className={styles.radarShape}
                      points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
                    />
                    {pts.map((p, i) => (
                      <circle key={i} className={styles.radarVertex} cx={p.x} cy={p.y} r="2.5" />
                    ))}
                    {pts.map((p, i) => (
                      <text key={i} className={styles.radarLabel} x={p.lx} y={p.ly}>
                        {p.label}
                      </text>
                    ))}
                  </svg>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Content ── */}
      <div className={styles.contentWrap}>
        <TabPanel active={activeTab === 'summary'}>
          <PlayerSummaryTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'hitting'}>
          <HittingTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'infield'}>
          <InfieldTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'catching'}>
          <CatchingTab {...tabProps} />
        </TabPanel>
        <TabPanel active={activeTab === 'outfield'}>
          <OutfieldTab {...tabProps} />
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
        <TabPanel active={activeTab === 'videos'}>
          <VideosTab {...tabProps} />
        </TabPanel>
      </div>

      {/* Report Modal — used for Create / Edit / Player profile-edit.
          profileEditOpen flips it into a SUMMARY-only view that hides the
          report-type chip row, used by the player-side Edit Profile button. */}
      {showReportModal && (
        <ReportModal
          player={player}
          userId={(user as any).id || (user as any).sub}
          existingReport={editingReport}
          initialReportType={profileEditOpen ? 'SUMMARY' : undefined}
          profileOnly={profileEditOpen}
          onClose={() => { setShowReportModal(false); setEditingReport(null); setProfileEditOpen(false); }}
          onSaved={() => setRefreshKey(k => k + 1)}
        />
      )}
    </div>
  );
}
