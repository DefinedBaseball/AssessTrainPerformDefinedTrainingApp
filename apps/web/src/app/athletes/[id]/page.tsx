'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, Metric, Video } from '@/lib/api';

import { TabBar, TabPanel } from '@/components/assessment';
import type { Tab } from '@/components/assessment';
import { ResetPasswordButton } from '@/components/ResetPasswordButton';
import { ChangeEmailButton } from '@/components/ChangeEmailButton';
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
import { PdfBuilderModal, type PdfLayout } from './PdfBuilderModal';
import { formatHeight, getAge, computeAggregateScores, scoreColor, getHiddenTabs } from './helpers';
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
  /* Tab label was "Strength & Conditioning" → "S & C" → now
     "Physical" per coach-spec. "Physical" reads as the broader
     umbrella that contains BOTH the Strength & Conditioning
     sub-tab AND the Mobility Screen sub-tab inside the S&C tab
     content. Same `key: 'strength'` under the hood so routing /
     report-type matching / sidebar visibility logic all keep
     working unchanged. */
  { key: 'strength', label: 'Physical', icon: IconStrength },
  { key: 'videos', label: 'Videos', icon: IconVideos },
];

/* ── Progress metrics to fetch ── */
const PROGRESS_METRICS = [
  // Hitting
  'max_exit_velo', 'max_bat_speed', 'avg_exit_velo', 'avg_bat_speed',
  'bat_speed', 'smash_factor', 'launch_angle', 'attack_angle', 'distance',
  'squared_up_pct', 'plane_angle',
  // Defense
  'infield_velo', 'outfield_velo', 'catcher_velo', 'pop_time', 'exchange_time',
  // Pitching
  'fb_max_velo', 'fb_avg_velo', 'spin_rate', 'h_break', 'v_break', 'sprint_60',
  // Speed (Physical / defense sprint trends — 60-yd + 10-yd dash)
  'sprint_10',
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
  /* Colleges list — fetched so the Commitment circle can show the logo
     associated with the player's committed school (via College.logoUrl
     set in Settings → Teams & Colleges, or via the "+ Add new college"
     form in the Report modal). */
  const [colleges, setColleges] = useState<api.College[]>([]);
  /* Set while the Summary PDF capture flow is running — pauses the
     active-tab auto-correction below so we can programmatically swap
     to Hitting / Catching / Infield / Outfield / Pitching tabs and
     screenshot each snapshot, even when the player's positions wouldn't
     normally surface those tabs. Also shows a fullscreen "Generating
     PDF…" overlay so the user understands the brief tab flicker. */
  const [capturingPdf, setCapturingPdf] = useState(false);
  /* Toggles the PDF Builder modal where the user picks which sections
     to include, reorders them, sets each section's vertical position,
     and optionally saves the whole layout as a named preset. Opens
     when the Player Summary tab's "Download PDF" button is clicked. */
  const [pdfBuilderOpen, setPdfBuilderOpen] = useState(false);
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
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }

    // Players may only view their own profile. If they navigate (or are
    // linked) to another athlete's id, bounce them back to their own.
    // Coaches can view any athlete. The backend now enforces the same
    // rule; this is the UI mirror so we never paint another player's data.
    if (!isCoach) {
      const myId = (user as any).playerId;
      if (myId && id && id !== myId) {
        router.replace(`/athletes/${myId}`);
      }
    }
  }, [authLoading, user, isCoach, id, router]);

  /* ── Data loading ── */
  useEffect(() => {
    if (!user || !id) return;
    setLoading(true);
    setError(null);

    // `'REPORT'` → only per-report aggregated points (one per report), so
    // the trend charts never show seeded / raw-CSV multi-date demo data.
    const progressPromises = PROGRESS_METRICS.map(mt =>
      api.getMetricProgress(id, mt, 'REPORT')
        .then(data => ({ mt, data }))
        .catch(() => ({ mt, data: [] as { value: number; recordedAt: string }[] })),
    );

    Promise.all([
      api.getPlayer(id),
      api.getTopMetrics(id).catch(() => ({})),
      api.getPlayerVideos(id).catch(() => []),
      api.getPlayerReports(id).catch(() => []),
      Promise.all(progressPromises),
      /* Colleges list is non-critical for the page rendering, so swallow
         errors and fall back to an empty list. The commitment circle
         simply renders the graduation-cap glyph fallback if the lookup
         comes up empty. */
      api.getColleges().catch(() => [] as api.College[]),
    ]).then(([p, top, vids, reps, progressResults, colls]) => {
      setPlayer(p);
      setTopMetrics(top);
      setVideos(vids);
      setReports(reps as ReportSummary[]);
      setColleges(colls);
      const pd: Record<string, { value: number; recordedAt: string }[]> = {};
      progressResults.forEach(({ mt, data }) => { if (data.length > 0) pd[mt] = data; });
      setProgressData(pd);
      setLoading(false);
    }).catch((err: Error) => {
      setError(err.message || 'Failed to load player');
      setLoading(false);
    });
  }, [user, id, refreshKey]);

  /* Live At-Bats for this athlete — feeds the Swing Decision bar in
     the Hitting Tool Grades card. Pulled separately from the metrics
     fetch so the rest of the profile loads quickly even if at-bat
     data is large. 500-row cap is generous (most athletes have far
     fewer); coaches who exceed it can revisit the cap later. */
  const [liveAtBats, setLiveAtBats] = useState<api.AtBatDetail[]>([]);
  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    api.listAtBats({ hitterId: id, limit: 500 })
      .then((rows) => { if (!cancelled) setLiveAtBats(rows); })
      .catch(() => { if (!cancelled) setLiveAtBats([]); });
    return () => { cancelled = true; };
  }, [user, id, refreshKey]);

  /* ── Aggregate score (hero "Player Score" bubble) ── */
  const aggregate = useMemo(() => {
    if (!player) return null;
    return computeAggregateScores(player, reports, topMetrics, liveAtBats);
  }, [player, reports, topMetrics, liveAtBats]);

  /* Hidden-tab preference (per-player, persisted in localStorage). The
     Eye toggle in the Report modal header writes here; we listen for the
     custom event so the tab bar updates the moment the user toggles a
     tab's visibility. Defaults to `DEFAULT_HIDDEN_TABS` for a fresh
     player record — Catching / Infield / Outfield / S & C are hidden
     until explicitly enabled.

     Lazy `useState` initializer reads localStorage on the FIRST render
     (id already resolved to the URL param or auth playerId by then), so
     the tab bar paints with the correct hidden set immediately instead
     of flashing the full set for one tick before the effect runs. The
     `useEffect` below still re-reads when `id` changes (e.g. coach
     navigates between two athletes' profiles in the same tab) and
     subscribes to the cross-component update event. */
  const [hiddenTabs, setHiddenTabsState] = useState<string[]>(() => getHiddenTabs(id));
  useEffect(() => {
    if (!id) return;
    setHiddenTabsState(getHiddenTabs(id));
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { playerId?: string } | undefined;
      // Only re-read when the event matches this player so opening a
      // different athlete's modal can't blow away our state.
      if (!detail || detail.playerId === id) {
        setHiddenTabsState(getHiddenTabs(id));
      }
    };
    window.addEventListener('player:hiddenTabsChanged', handler as EventListener);
    return () => window.removeEventListener('player:hiddenTabsChanged', handler as EventListener);
  }, [id]);

  /* ── Visible tabs (position + hidden-preference driven) ──
     Defense was split into three position-specific tabs — each shows only
     when the player carries that position code on their profile.
     Position groups mirror the Training Calendar's helper so a player
     marked LF/CF/RF (or umbrella OF) counts as an outfielder, and a
     player marked 1B/2B/3B/SS (or umbrella INF) counts as an infielder.
     Layered ON TOP of that: the per-player `hiddenTabs` set further
     filters out tabs the coach has explicitly toggled off via the Eye
     icon in the Report modal header. PDF capture flow bypasses this
     filter via `capturingPdf` so the Summary capture can still walk every
     section regardless of which ones are user-hidden. */
  const visibleTabs = useMemo(() => {
    if (!player) return TABS;
    const positions = (player.positions || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const INFIELD_CODES  = ['1B', '2B', '3B', 'SS', 'INF'];
    const OUTFIELD_CODES = ['LF', 'CF', 'RF', 'OF'];
    const hasNonPitcher = positions.some((p) => p !== 'P');
    const isPitcher    = positions.includes('P');
    const isCatcher    = positions.includes('C');
    const isInfielder  = positions.some((p) => INFIELD_CODES.includes(p));
    const isOutfielder = positions.some((p) => OUTFIELD_CODES.includes(p));

    return TABS.filter((t) => {
      if (t.key === 'summary') return true;
      // Per-player Eye-toggle override — short-circuit before the
      // position checks so a hidden tab disappears even when the player
      // carries a matching position. Summary is exempt above so coaches
      // can always reach the overview.
      if (hiddenTabs.includes(t.key) && !capturingPdf) return false;
      if (t.key === 'hitting') return hasNonPitcher;
      if (t.key === 'pitching') return isPitcher;
      if (t.key === 'catching') return isCatcher;
      if (t.key === 'infield')  return isInfielder;
      if (t.key === 'outfield') return isOutfielder;
      /* Videos pulled out of the main tab nav — now reached via an
         icon button in every tab's TabBarActions (sits next to the
         Download PDF icon). The tab still exists internally for the
         TabPanel render, just not surfaced in the nav row. */
      if (t.key === 'videos')   return false;
      return true; // strength
    });
  }, [player, reports, hiddenTabs, capturingPdf]);

  // If the current tab is filtered out (e.g. positions changed), fall back to Summary.
  // Skipped while `capturingPdf` is true so the Summary PDF capture flow can
  // briefly switch to position-specific tabs (Infield / Catching / Outfield)
  // that wouldn't otherwise appear for this player's positions.
  //
  // `videos` is excluded from `visibleTabs` (the icon button is its only
  // entry point — see the comment on the filter above), but it's still a
  // legitimate destination. Treating it as valid here keeps the
  // `onOpenVideos` callback from being immediately bounced back to
  // Summary the moment the Videos tab tries to mount.
  useEffect(() => {
    if (capturingPdf) return;
    if (activeTab === 'videos') return;
    if (!visibleTabs.some((t) => t.key === activeTab)) {
      setActiveTab('summary');
    }
  }, [visibleTabs, activeTab, capturingPdf]);

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
    /* Jumps the parent profile to the Videos tab. Used by the icon
       button surfaced in each tab's TabBarActions next to Download PDF. */
    onOpenVideos: () => setActiveTab('videos'),
  };

  /* ─────────────────────────────────────────────────────────
   * SUMMARY PDF CAPTURE
   *
   * Drives the Player Summary tab's top-level "Download PDF"
   * button. Cycles `activeTab` through summary → hitting →
   * infield → catching → outfield → pitching, waiting between
   * each switch for the tab to mount, fetch its data, and
   * render. After each render, finds the `[data-pdf-section]`
   * marker baked into the live JSX of that tab and screenshots
   * it via html2canvas. The resulting PNG data URLs are passed
   * to `generateSummaryCapturePdf` which assembles them onto
   * a CoverPage + one image page per snapshot.
   *
   * Sections without a matching DOM marker (e.g. a player
   * with no Catching assessment so the Catching Snapshot
   * isn't rendered) are simply skipped — the PDF includes
   * only sections that were actually visible at capture time.
   * ───────────────────────────────────────────────────────── */
  /** Map of section-key → tab to switch to before capturing. Lives at
   *  module scope of this function so both the modal's "Generate" path
   *  and the legacy capture path agree on the routing. */
  const SECTION_TAB_MAP: Record<
    'tool-grades' | 'hitting-snapshot' | 'infield-snapshot' | 'catching-snapshot' | 'outfield-snapshot' | 'pitch-report',
    { tab: string; title: string }
  > = {
    'tool-grades':       { tab: 'summary',  title: 'Tool Grades' },
    'hitting-snapshot':  { tab: 'hitting',  title: 'Hitting Snapshot' },
    'infield-snapshot':  { tab: 'infield',  title: 'Infield Snapshot' },
    'catching-snapshot': { tab: 'catching', title: 'Catching Snapshot' },
    'outfield-snapshot': { tab: 'outfield', title: 'Outfield Snapshot' },
    'pitch-report':      { tab: 'pitching', title: 'Pitch Report' },
  };

  type CapturedSnap = { dataUrl: string; width: number; height: number; title: string };

  /** Captures every known section by cycling the parent's activeTab
   *  through each section's home tab, waiting for layout, and running
   *  html2canvas. Returns a map keyed by section so the builder modal
   *  can paint live previews and reuse the same images for the final
   *  PDF assembly (avoids a second capture pass). */
  const captureAllSectionsForBuilder = async (): Promise<Record<string, CapturedSnap>> => {
    if (!player) return {};

    const html2canvas = (await import('html2canvas')).default;
    const originalTab = activeTab;
    const captures: Record<string, CapturedSnap> = {};

    setCapturingPdf(true);
    try {
      for (const [key, meta] of Object.entries(SECTION_TAB_MAP)) {
        setActiveTab(meta.tab);
        await new Promise((r) => setTimeout(r, 2500));

        const el = document.querySelector(`[data-pdf-section="${key}"]`) as HTMLElement | null;
        if (!el) continue;

        try {
          const canvas = await html2canvas(el, {
            backgroundColor: '#0a0e14',
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
          });
          captures[key] = {
            dataUrl: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
            title: meta.title,
          };
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`Failed to capture ${key}:`, err);
        }
      }
    } finally {
      setActiveTab(originalTab);
      setCapturingPdf(false);
    }
    return captures;
  };

  /** Opens the PDF Builder modal. The capture pass + final PDF assembly
   *  happen inside the modal's lifecycle (it requests captures itself
   *  via the `onCapture` prop, then calls `onGenerate` with the user's
   *  layout + the captures it already has). */
  const handleCaptureSummaryPdf = async () => {
    if (!player) return;
    setPdfBuilderOpen(true);
  };

  /** Layout-aware PDF assembly. The captures map comes from the builder
   *  modal (which captured everything upfront for its preview pane), so
   *  we never run html2canvas a second time — we just filter / reorder
   *  the cached images according to the user's chosen layout and pass
   *  them through to the PDF generator with their per-section yOffsets. */
  const handleBuildPdf = async (
    layout: PdfLayout,
    captures: Record<string, CapturedSnap>,
  ) => {
    if (!player) return;

    const { generateSummaryCapturePdf } = await import('@/lib/pdf');

    const orderedEnabled = layout.sections.filter(s => s.enabled);
    if (orderedEnabled.length === 0) return;

    const ordered = orderedEnabled
      .map((cfg) => {
        const snap = captures[cfg.key];
        if (!snap) return null;
        return {
          key: cfg.key,
          title: snap.title,
          dataUrl: snap.dataUrl,
          width: snap.width,
          height: snap.height,
          yOffset: cfg.yOffset,
          /* Pulled from the modal's Size slider — drives how wide the
             section image renders on its page in the final PDF. */
          scale: typeof cfg.scale === 'number' ? cfg.scale : 1,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (ordered.length === 0) {
      alert('No on-screen sections were available to capture for this PDF.');
      return;
    }

    await generateSummaryCapturePdf(player, ordered);
  };

  return (
    <div className={styles.pageRoot}>
      {/* ── Back Link (coaches navigating from Athletes list) + account
          tools. Reset Password sets a new login password for this
          player's account (backend keeps the primary admin self-only). ── */}
      {isCoach && params?.id && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/athletes" className={styles.backLink}>← Athletes</Link>
          {player.userId && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <ChangeEmailButton userId={player.userId} currentEmail={player.user?.email} />
              <ResetPasswordButton userId={player.userId} />
            </span>
          )}
        </div>
      )}

      {/* TabBar moved BELOW the Player Name (Command Deck) bubble —
          its render is now between `heroOuter` and `contentWrap` (see
          below) so the player's identity card sits at the very top of
          the profile and the tab nav lives directly underneath as
          the entry point into each report. */}

      {/* ── COMMAND DECK HERO (ported from test-3) ── */}
      {(() => {
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

        /* Resolve the commitment circle's image. Priority order:
             1. Match player.collegeCommit against the colleges list and use
                the matching record's logoUrl (set in Settings →
                Teams & Colleges).
             2. Fall back to the graduation-cap glyph if no match / no logo.
           The lookup is case-insensitive + whitespace-tolerant so legacy
           free-text values still match cleanly. */
        const commitLogoUrl = committed
          ? (() => {
              const needle = (player.collegeCommit || '').trim().toLowerCase();
              if (!needle) return null;
              const match = colleges.find(c => c.name.trim().toLowerCase() === needle);
              return match?.logoUrl || null;
            })()
          : null;

        return (
          <div className={styles.heroOuter}>
            {/* "New Report" has moved into the Reports dropdown on each tab. */}

            <div className={styles.commandDeck}>
              {/* LEFT: identity block */}
              <div className={styles.identityBlock}>
                {/* Top telemetry strip — POS, HT, WT, B/T, GRAD, AGE,
                    HS, Club. The leading pulsing-dot <i> bullet that
                    previously sat before POS has been retired so the
                    strip reads as a clean monospaced row. HS + Club
                    used to render as their own row below the player
                    name; they now join the end of this single strip
                    so the entire identity block reads as one line
                    above the player name. */}
                <div className={styles.telemetryStrip}>
                  <span>POS <b>{player.positions ? player.positions.split(',').map(p => p.trim()).filter(Boolean).join(', ') : '—'}</b></span>
                  <span>HT <b>{formatHeight(player.heightInches)}</b></span>
                  <span>WT <b>{player.weightLbs ? `${player.weightLbs} lb` : '—'}</b></span>
                  <span>B/T <b>{(player.bats || '—')}/{(player.throws || '—')}</b></span>
                  <span>GRAD <b>{api.formatGradYear(player.gradYear)}</b></span>
                  <span>AGE <b>{getAge(player.birthDate)}</b></span>
                  <span>HS <b>{player.highSchool || '—'}</b></span>
                  <span>Club <b>{player.clubTeam || '—'}</b></span>
                </div>

                {/* Player name + Player Score + Commitment row — name
                    pinned LEFT, gauge + commitment grouped together on
                    the RIGHT (justify-content: space-between) so the
                    Commitment circle's right edge aligns with the
                    Tool Grades section's right edge that begins below.
                    Both circles sized ~76px to sit in line with the
                    name + telemetry strip without dwarfing them. */}
                <div
                  /* .nameRow carries the -19px pull toward the telemetry
                     strip (iterated -4 → … → -19) — moved to CSS so a
                     media query can drop it to 0 on narrow windows where
                     the strip wraps to two lines (the fixed pull was
                     stacking the name on top of the wrapped HS/Club
                     entries). */
                  className={styles.nameRow}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 24,
                    flexWrap: 'wrap',
                  }}>
                  <h1 className={styles.megaName} style={{ margin: 0 }}>
                    {player.firstName}{' '}
                    <span className={styles.lastName}>{player.lastName}</span>
                  </h1>

                  {/* Right-side cluster — Commitment + Gauge grouped
                      together. Order is Commitment (left) → Gauge
                      (right) so the Player Grade circle is the
                      RIGHTMOST element in the row.

                      `marginRight: -26` cancels the .commandDeck's
                      26px right padding so the gauge's right edge
                      lands flush with the commandDeck's outer right
                      edge — the same right edge the Tool Grades
                      panel below uses (both panels share the same
                      contentWrap container, no horizontal padding). */}
                  <div style={{
                    display: 'flex',
                    /* alignItems flipped center → flex-start so the
                       Player Grade gauge top-aligns with the
                       Commitment circle's top (instead of being
                       centered against the taller Commitment column
                       that includes the school-name caption). The two
                       circles now share the same vertical position. */
                    alignItems: 'flex-start',
                    /* Gap bumped 20 → 30 → 35 (extra 5px on top of
                       the previous shift) so the Commitment circle
                       pushes a further 5px LEFT while the Player
                       Grade gauge stays anchored to the cluster's
                       right edge. */
                    gap: 35,
                    flex: '0 0 auto',
                    /* marginRight loosened -26 → -16 → -1 (another
                       15px less overhang) so the whole cluster shifts
                       a further 15px LEFT. Combined with the gap
                       bump above, this round moves the Player Grade
                       gauge 15px left and the Commitment circle
                       20px left from their previous positions. */
                    marginRight: -1,
                  }}>

                  {/* College Commitment — outer rectangular bubble
                      chrome (background / border / shadow / fixed
                      width) retired per spec. The wrapper is now a
                      transparent layout-only flex column holding the
                      logo + caption with the same internal spacing
                      the rectangle used. The inner logo still has no
                      chrome of its own — the image circle and the
                      italic caption simply sit on the dark
                      command-deck surface behind, no surrounding
                      bubble. */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    flex: '0 0 auto',
                    opacity: committed ? 1 : 0.9,
                    /* Padding tuned so the LOGO sits at the cluster's
                       exact vertical center, which makes the player-
                       name h1 to the LEFT (parent row uses
                       `alignItems: 'center'`) line up perfectly with
                       the logo's midline rather than with the cluster
                       midpoint that previously sat above the logo
                       because the caption skewed the average down.
                       Math: paddingTop 30 + (logo 72)/2 = 66 from
                       cluster top to logo center. To put the logo
                       at cluster mid-height, paddingBottom must
                       satisfy paddingTop = paddingBottom + gap +
                       caption_height ⇒ 10 = 30 − 6 − 14. */
                    paddingTop: 30,
                    paddingBottom: 10,
                  }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      /* Logo holder — no longer carries the bubble
                         chrome (background/border/shadow lifted up
                         to the outer rectangle). Keeps `border-radius:
                         50%` + `overflow: hidden` so the rendered
                         image is still clipped to a circle inside
                         the surrounding rectangle. */
                      width: 72,
                      height: 72,
                      borderRadius: '50%',
                      color: committed ? '#0E1116' : 'var(--text-muted)',
                      flex: '0 0 auto',
                      padding: commitLogoUrl ? 0 : 6,
                      textAlign: 'center',
                      overflow: 'hidden',
                    }} aria-hidden="true">
                      {commitLogoUrl ? (
                        /* Uploaded college logo — wins over the
                           graduation-cap glyph placeholder. Image is
                           cover-fitted into the circular badge so it
                           reads as the player's commitment crest. */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={commitLogoUrl}
                          alt={`${player.collegeCommit || ''} logo`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: '50%',
                            display: 'block',
                          }}
                        />
                      ) : committed ? (
                        /* Graduation-cap glyph — generic logo placeholder
                           shown when the player IS committed but the
                           matching College record has no `logoUrl` set.
                           Once the coach uploads a logo in Settings →
                           Teams & Colleges this gets replaced by the
                           <img> branch above. Glyph trimmed 47 → 38 →
                           34 (another 10 % smaller) in step with the
                           circle. */
                        <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2"
                             strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 10L12 5 2 10l10 5 10-5z" />
                          <path d="M6 12v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
                        </svg>
                      ) : (
                        /* In-circle "Uncommitted" label — replaces the
                           glyph + caption pair when the player has no
                           commitment on file. Rendered small + muted
                           grey so the badge stays visually subdued
                           (a player with no commit shouldn't shout). */
                        <span style={{
                          fontSize: rem(7),
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          lineHeight: 1.1,
                          color: 'var(--text-muted)',
                          opacity: 0.7,
                        }}>
                          Uncommitted
                        </span>
                      )}
                    </span>
                    {committed && (
                      <span style={{
                        /* Caption bumped 10.5 → 12.6 (20% larger) so
                           the school name reads as a primary identity
                           element below the (now smaller) badge. */
                        fontSize: rem(12.6),
                        fontWeight: 700,
                        /* Italic per spec — the school-name caption
                           and the Player Grade caption below the
                           sibling gauge are both rendered italic so
                           the matched pair of HUD-circle labels reads
                           as accent text rather than plain captions. */
                        fontStyle: 'italic',
                        color: 'var(--text-bright)',
                        letterSpacing: '0.04em',
                        textAlign: 'center',
                        /* `maxWidth: 140` retired + `whiteSpace:
                           'nowrap'` added so long school names (e.g.
                           "University of Minnesota") read on a single
                           horizontal line under the badge instead of
                           wrapping onto two. The parent wrapper uses
                           `flex: '0 0 auto'`, so it grows to fit the
                           caption's natural width — the 72 px logo
                           stays horizontally centered inside the now-
                           wider column. */
                        whiteSpace: 'nowrap',
                        lineHeight: 1.1,
                      }}>
                        {player.collegeCommit}
                      </span>
                    )}
                  </div>

                  {/* Player Score gauge — circular HUD sized to ~90%
                      of the Player Name bubble's height so it matches
                      the Commitment badge to the left. The gauge's
                      `gaugeWrap` CSS class drives its 130×130 default;
                      an inline width/height override here sets it to
                      72×72 (was 110 → 80 → 72; 10 % smaller in step
                      with the Commitment circle's matching shrink).
                      Rightmost element in the row → its right edge
                      aligns with the Tool Grades section's right edge
                      below. Wrapped in a flex column so the "Player
                      Grade" caption can sit directly under the gauge,
                      mirroring the Commitment circle's college-name
                      caption. */}
                  {/* Overall "Player Grade" gauge removed per request — the
                      detailed Tool Grades below remain the source of grades. */}
                  </div>{/* /right-side cluster */}
                </div>

              </div>

              {/* Right metrics column retired — the Player Score gauge
                  now lives next to the Commitment chip inside the
                  identity block above. */}
            </div>{/* /commandDeck */}
          </div>
        );
      })()}

      {/* ── Tab Bar (now below the player name bubble) ── */}
      <TabBar tabs={visibleTabs} activeKey={activeTab} onTabChange={setActiveTab} />

      {/* ── Content ── */}
      <div className={styles.contentWrap}>
        <TabPanel active={activeTab === 'summary'}>
          <PlayerSummaryTab
            {...tabProps}
            onCaptureSummaryPdf={handleCaptureSummaryPdf}
            /* Drive Tool Grades' section list off the SAME visible-
               tabs set the tab bar at the top uses. When the coach
               hides Catching / Infield / Outfield / S & C via the
               Eye toggle in the Report modal, those sections also
               drop out of the Tool Grades grid below the bar so the
               two surfaces always agree on what the player "trains". */
            visibleTabKeys={visibleTabs.map((t) => t.key)}
          />
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

      {/* PDF Builder modal — opens when the Player Summary tab's
          "Download PDF" button is clicked. Lets the user pick which
          sections to include, reorder them, position each section
          vertically on its page, and save / load presets. Calls
          handleBuildPdf with the chosen layout on Generate. */}
      <PdfBuilderModal
        open={pdfBuilderOpen}
        playerName={`${player.firstName ?? ''} ${player.lastName ?? ''}`.trim()}
        onClose={() => setPdfBuilderOpen(false)}
        onCapture={captureAllSectionsForBuilder}
        onGenerate={handleBuildPdf}
      />

      {/* "Generating PDF…" fullscreen overlay — shown while the
          Summary PDF capture cycle is running, BUT only when the
          PDF Builder modal is closed. When the builder is open the
          modal already shows its own "Capturing live previews…"
          state, and stacking the parent overlay on top of the
          modal would obscure it (and was causing the "glitching out
          of generating pdf" loop the user reported). */}
      {capturingPdf && !pdfBuilderOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(8, 11, 18, 0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(2px)',
          }}
          aria-live="polite"
          aria-busy="true"
        >
          <div style={{
            background: 'rgba(20, 24, 32, 0.96)',
            border: '1px solid rgba(126, 182, 255, 0.35)',
            borderRadius: 16,
            padding: '24px 32px',
            color: 'var(--text-bright)',
            fontFamily: 'var(--font-mono)',
            fontSize: rem(13),
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            fontWeight: 700,
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                 style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeDasharray="28 18" />
            </svg>
            Generating PDF…
          </div>
        </div>
      )}

      {/* Report Modal — used for Create / Edit / Player profile-edit.
          profileEditOpen flips it into a SUMMARY-only view that hides the
          report-type chip row, used by the player-side Edit Profile button.
          Also guarded on `user` being present: if auth is still resolving
          (or the session expired) the modal mounted with `(user as any).id`
          would throw "Cannot read property 'id' of null" before rendering.
          The button that flips `showReportModal` true is itself gated
          on the page's auth check above, so this should never fire as
          long as `user` is truthy — the guard is belt-and-suspenders. */}
      {showReportModal && user && (
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
