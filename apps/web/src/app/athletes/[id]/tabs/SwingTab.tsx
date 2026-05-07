'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  KpiCard, SectionHeader, Section,
  NotesBox,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  toScoutingGrade, GRADE_RANGES,
  getLatestReport, getManualSwingScores, getManualSwingOptions, averageGrades,
  metricToGrade, scoreColor,
  getReportUploadIds,
  type ManualSwingScores, type ManualSwingOptions,
} from '../helpers';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { SprayChartView } from '../components/SprayChartView';

const HITTING_REPORT_TYPES = ['HITTING'];

/* ─────────────────────────────────────────────────────────────────────────────
   Vendor logos — inline SVGs so we don't have to ship binary assets.
   Sized to fit the SectionHeader's 36×36 .sectionIcon slot; both render on a
   white tile to match each brand's standard treatment.
   ───────────────────────────────────────────────────────────────────────── */
/* Coach Grades icon — clipboard with three checked rows and an "A+"
   stamp on the bottom-right. Renders on a dark rounded tile so it
   reads consistently with the other vendor logos in the section
   header (Full Swing / Blast Motion). */
function CoachGradesIcon() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Coach Grades"
      style={{ display: 'block' }}
    >
      {/* Dark rounded tile background */}
      <rect x="0" y="0" width="100" height="100" rx="22" fill="#1a1f25" />
      {/* Paper / clipboard body */}
      <rect x="22" y="22" width="46" height="64" rx="3" fill="#ffffff" />
      {/* Three checkbox rows: small square + check + line */}
      <g stroke="#1a1f25" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* Row 1 */}
        <path d="M28 36 v6 h6" />
        <path d="M30.5 39 l3 3 l5.5 -5.5" />
        <line x1="42" y1="40" x2="63" y2="40" />
        {/* Row 2 */}
        <path d="M28 53 v6 h6" />
        <path d="M30.5 56 l3 3 l5.5 -5.5" />
        <line x1="42" y1="57" x2="63" y2="57" />
        {/* Row 3 */}
        <path d="M28 70 v6 h6" />
        <path d="M30.5 73 l3 3 l5.5 -5.5" />
        <line x1="42" y1="74" x2="63" y2="74" />
      </g>
      {/* A+ grade circle (bottom-right) */}
      <circle cx="74" cy="62" r="18" fill="#ffffff" stroke="#1a1f25" strokeWidth="3" />
      <text
        x="71" y="69"
        textAnchor="middle"
        fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
        fontSize="22"
        fontWeight="800"
        fill="#1a1f25"
        letterSpacing="-1"
      >A</text>
      <text
        x="84" y="55"
        textAnchor="middle"
        fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
        fontSize="14"
        fontWeight="800"
        fill="#1a1f25"
      >+</text>
    </svg>
  );
}

function HitTraxLogo() {
  /* Charcoal rounded tile, "HT" wordmark in white with a red diagonal
     swoosh through it, framed by chevrons (◀ ▶) on the sides and red
     arrow points (▲ ▼) top + bottom — matches the HitTrax app icon. */
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="HitTrax"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="ht-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#5a5e63" />
          <stop offset="100%" stopColor="#3a3d42" />
        </linearGradient>
        <linearGradient id="ht-red" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#ff5b5b" />
          <stop offset="100%" stopColor="#c92020" />
        </linearGradient>
      </defs>
      {/* Charcoal tile */}
      <rect x="0" y="0" width="100" height="100" rx="22" fill="url(#ht-tile)" />
      {/* Top + bottom red arrow points */}
      <polygon points="50,8 64,22 36,22" fill="url(#ht-red)" />
      <polygon points="50,92 64,78 36,78" fill="url(#ht-red)" />
      {/* Side chevrons */}
      <polygon points="6,50 22,40 22,60" fill="url(#ht-red)" />
      <polygon points="94,50 78,40 78,60" fill="url(#ht-red)" />
      {/* "HT" wordmark — squared, bold */}
      <g fill="#ffffff">
        {/* H */}
        <rect x="28" y="36" width="6" height="30" />
        <rect x="44" y="36" width="6" height="30" />
        <rect x="34" y="48" width="10" height="6" />
        {/* T */}
        <rect x="56" y="36" width="20" height="6" />
        <rect x="63" y="36" width="6" height="30" />
      </g>
      {/* Red swoosh slashing through HT */}
      <path
        d="M 22 60 Q 50 34 80 50"
        fill="none"
        stroke="url(#ht-red)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FullSwingLogo() {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Full Swing"
      style={{ display: 'block' }}
    >
      {/* Black tile background */}
      <rect x="0" y="0" width="100" height="100" rx="6" fill="#000" />
      {/* "FS" mark — bold, slightly squared */}
      <text
        x="50" y="62"
        textAnchor="middle"
        fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
        fontSize="58"
        fontWeight="900"
        letterSpacing="-2"
        fill="#fff"
      >FS</text>
      {/* "FULL SWING" footer */}
      <text
        x="50" y="86"
        textAnchor="middle"
        fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
        fontSize="11"
        fontWeight="700"
        letterSpacing="1.5"
        fill="#fff"
      >FULL SWING</text>
    </svg>
  );
}

function BlastLogo() {
  // Black circle outline + 4-node sensor pattern: a top dot, a hub
  // mid-circle with a horizontal cross-arm, and two dots fanning out
  // diagonally below the hub. Mirrors the Blast Motion brand mark.
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
      role="img"
      aria-label="Blast Motion"
      style={{ display: 'block' }}
    >
      {/* White tile background to match brand presentation */}
      <rect x="0" y="0" width="100" height="100" rx="50" fill="#fff" />
      {/* Outer ring */}
      <circle cx="50" cy="50" r="36" fill="none" stroke="#000" strokeWidth="6" />
      {/* Connecting lines */}
      <g stroke="#000" strokeWidth="3.5" strokeLinecap="round">
        {/* top spoke */}
        <line x1="50" y1="50" x2="50" y2="32" />
        {/* horizontal cross-arm */}
        <line x1="34" y1="50" x2="66" y2="50" />
        {/* lower-left diagonal */}
        <line x1="50" y1="50" x2="38" y2="68" />
        {/* lower-right diagonal */}
        <line x1="50" y1="50" x2="62" y2="68" />
      </g>
      {/* Sensor nodes */}
      <g fill="#000">
        <circle cx="50" cy="50" r="4.5" />
        <circle cx="50" cy="32" r="4" />
        <circle cx="34" cy="50" r="4" />
        <circle cx="66" cy="50" r="4" />
        <circle cx="38" cy="68" r="4" />
        <circle cx="62" cy="68" r="4" />
      </g>
    </svg>
  );
}

/** Single horizontal row of KpiCards — cards grow to fill the bubble width.
 *  Used by both the Full Swing and Blast Motion bubbles, which span the same
 *  width as the Hitting Snapshot row above them. */
const metricRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'nowrap',
  gap: 10,
  width: '100%',
};
const metricRowItemStyle: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
};

/* The 7 underlying Blast / Full-Swing metrics that contribute to the Swing grade. */
const SWING_METRIC_KEYS = [
  'attack_angle',
  'plane_angle',
  'avg_bat_speed',
  'time_to_contact',
  'on_plane_efficiency',
  'connection_at_contact',
  'rotational_acceleration',
] as const;

/** Map a raw Blast metric to a friendlier "graded score" label used in the UI. */
const SCORE_LABEL_OVERRIDES: Record<string, string> = {
  on_plane_efficiency:    'Plane Score',
  connection_at_contact:  'Connection Score',
  rotational_acceleration:'Rotation Score',
};

/** Manual coach-entered score keys (the "Coach Diagnosis" row) — each
 *  category has a multi-select option list rendered as chips on the card. */
const MANUAL_KEYS: { key: keyof ManualSwingScores; label: string; hint: string; options: string[] }[] = [
  { key: 'forwardMove', label: 'Forward Move', hint: 'Lower-half load → directional intent toward the pitcher.', options: ['Stuck', 'Stable', 'Drift'] },
  { key: 'posture',     label: 'Posture',      hint: 'Spine angle from set-up through contact.',                  options: ['Tall', 'Hinged', 'Forward', 'Back'] },
  { key: 'stability',   label: 'Stability',    hint: 'Balance and base — head-still through finish.',             options: ['+Stack', '-Stack', '+Lead Leg', '-Lead Leg'] },
  { key: 'direction',   label: 'Direction',    hint: 'Bat path & body line working through the ball.',            options: ['Pull', 'Center', 'Oppo'] },
  { key: 'stretch',     label: 'Stretch',      hint: 'Length & separation between hips and shoulders at launch.', options: ['Rhythmic', 'Good', 'Stuck', 'None'] },
  { key: 'core',        label: 'Core',         hint: 'Trunk strength & sequencing through contact.',              options: ['Connected', 'Disconnected', 'Weak'] },
  { key: 'slot',        label: 'Slot',         hint: 'Hand path & barrel slot through the hitting zone.',         options: ['Steep', 'Flat', 'Uphill'] },
  { key: 'timing',      label: 'Timing',       hint: 'On-time launch — load → stride → swing in rhythm with the pitch.', options: ['Early', 'Late', 'On-Time', 'Inconsistent'] },
];

/** State and derived values shared between SwingTab + HittingTab's bubble. */
export interface SharedHittingState {
  manual: ManualSwingScores;
  setManual: React.Dispatch<React.SetStateAction<ManualSwingScores>>;
  persistedManual: ManualSwingScores;
  /** Multi-select option tags paired with each manual score. Edited inline
   *  on each ManualScoreCard; saved alongside scores via saveManual. */
  manualOptions: ManualSwingOptions;
  setManualOptions: React.Dispatch<React.SetStateAction<ManualSwingOptions>>;
  diagnosisNotes: string;
  setDiagnosisNotes: React.Dispatch<React.SetStateAction<string>>;
  topMetricsWithMiss: Record<string, { value: number; unit: string; recordedAt: string }>;
  metricGrades: Record<string, number | null>;
  reportUploadIds: string[];
  dirty: boolean;
  saving: boolean;
  saveOk: boolean;
  saveError: string | null;
  saveManual: () => Promise<void>;
}

export function SwingTab(props: TabProps & { shared: SharedHittingState }) {
  const { player, topMetrics, progressData, reports, isCoach, refreshKey, shared } = props;
  const {
    manual, setManual, persistedManual,
    manualOptions, setManualOptions,
    topMetricsWithMiss, metricGrades, reportUploadIds,
    dirty, saving, saveOk, saveError, saveManual,
  } = shared;
  const latestHitting = useMemo(() => getLatestReport(reports, HITTING_REPORT_TYPES), [reports]);

  /* HitTrax + Full Swing read from the same metric_type names but are
     distinguished by the Metric.source field at the database level
     (HitTrax = 'HITTRAX', Full Swing = 'FULL_SWING'). Fetch each
     section's progress data filtered by source so they never bleed
     into each other. */
  const [hittraxVelos, setHittraxVelos] = useState<number[]>([]);
  const [hittraxLAs, setHittraxLAs] = useState<number[]>([]);
  const [hittraxDists, setHittraxDists] = useState<number[]>([]);
  const [fullswingLAs, setFullswingLAs] = useState<number[]>([]);
  const [fullswingDists, setFullswingDists] = useState<number[]>([]);
  const [fullswingVelos, setFullswingVelos] = useState<number[]>([]);

  useEffect(() => {
    if (!player?.id) return;
    let cancelled = false;
    const fetchVals = (type: string, source: string) =>
      api.getMetricProgress(player.id, type, source)
        .then(rows => rows.map(r => r.value))
        .catch(() => [] as number[]);
    Promise.all([
      fetchVals('max_exit_velo', 'HITTRAX'),
      fetchVals('launch_angle',  'HITTRAX'),
      fetchVals('distance',      'HITTRAX'),
      fetchVals('max_exit_velo', 'FULL_SWING'),
      fetchVals('launch_angle',  'FULL_SWING'),
      fetchVals('distance',      'FULL_SWING'),
    ]).then(([htV, htLA, htD, fsV, fsLA, fsD]) => {
      if (cancelled) return;
      setHittraxVelos(htV);
      setHittraxLAs(htLA);
      setHittraxDists(htD);
      setFullswingVelos(fsV);
      setFullswingLAs(fsLA);
      setFullswingDists(fsD);
    });
    return () => { cancelled = true; };
  }, [player?.id, refreshKey]);

  const mean = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;
  const round = (n: number) => Math.round(n * 100) / 100;

  /* HitTrax-only session stats. */
  const hitTraxValues: Record<string, { value: number; unit: string }> = useMemo(() => {
    const out: Record<string, { value: number; unit: string }> = {};
    if (hittraxVelos.length > 0) {
      out.avg_exit_velo = { value: round(mean(hittraxVelos)), unit: 'mph' };
      out.max_exit_velo = { value: round(Math.max(...hittraxVelos)), unit: 'mph' };
    }
    if (hittraxLAs.length > 0) {
      out.launch_angle = { value: round(mean(hittraxLAs)), unit: 'deg' };
    }
    if (hittraxDists.length > 0) {
      out.distance = { value: round(mean(hittraxDists)), unit: 'ft' };
    }
    return out;
  }, [hittraxVelos, hittraxLAs, hittraxDists]);

  /* Full Swing-only session stats — used to OVERRIDE topMetricsWithMiss
     for the Full Swing card so HitTrax-source data never appears there. */
  const fullswingOverride: Record<string, { value: number; unit: string }> = useMemo(() => {
    const out: Record<string, { value: number; unit: string }> = {};
    if (fullswingVelos.length > 0) {
      out.avg_exit_velo = { value: round(mean(fullswingVelos)), unit: 'mph' };
      out.max_exit_velo = { value: round(Math.max(...fullswingVelos)), unit: 'mph' };
    }
    if (fullswingLAs.length > 0) {
      out.launch_angle = { value: round(mean(fullswingLAs)), unit: 'deg' };
    }
    if (fullswingDists.length > 0) {
      out.distance = { value: round(mean(fullswingDists)), unit: 'ft' };
    }
    return out;
  }, [fullswingVelos, fullswingLAs, fullswingDists]);

  /* ── Per-section "has data" flags ──────────────────────────────────
     Each sub-section (Coach Grades / Full Swing / Blast Motion /
     HitTrax) hides itself entirely — header, body, and the divider
     above it — unless the underlying data source has at least one
     populated value. Dividers only render when both the section above
     and below them are visible. */
  const hasCoachGrades = MANUAL_KEYS.some(({ key }) => manual[key] != null)
    || (manualOptions && Object.values(manualOptions).some(arr => (arr?.length ?? 0) > 0));
  const hasFullSwing   = QOC_KEYS.some(k =>
    fullswingOverride[k] !== undefined
    /* Allow Full-Swing-only metrics that the override doesn't carry
       (squared_up_pct, smash_factor, full_swing_miss_pct, etc.) to
       still light up the section via topMetricsWithMiss. */
    || (!['avg_exit_velo','max_exit_velo','launch_angle','distance'].includes(k as string)
        && topMetricsWithMiss[k] !== undefined),
  );
  const hasBlast       = SWING_METRIC_KEYS.some(k => topMetricsWithMiss[k] !== undefined)
    && Object.values(metricGrades).some(g => g !== null);
  const hasHitTrax     = HITTRAX_KEYS.some(k => hitTraxValues[k] !== undefined);
  const anySection     = hasCoachGrades || hasFullSwing || hasBlast || hasHitTrax;

  /* Track which sections have rendered so the dividers know whether
     there's anything above them to separate from. */
  let renderedSections = 0;

  return (
    <>
      {/* Spray Chart + grade bubble live in HittingTab now, side-by-side at the
         top, so they stay visible regardless of which sub-tab is active. */}

      {/* ────────────────────────────────────────────────────────────────────
          HITTING INPUTS — Full Swing + Blast Motion + Coach Grades in one bubble
          ───────────────────────────────────────────────────────────────── */}
      <Section>
        {/* Outer bubble wrapping Coach Grades + Full Swing + Blast Motion —
            shared profilePanel chrome (matches Player Summary). */}
        <div className={aStyles.profilePanel}>
        {!anySection && (
          <EmptyState
            text="No hitting data yet."
            hint={isCoach
              ? 'Fill in Coach Grades from the report modal, or upload a Blast Motion / Full Swing / HitTrax CSV to start populating this tab.'
              : 'Ask your coach to enter Coach Grades or upload swing data.'}
          />
        )}

        {/* ── COACH GRADES — only when at least one manual score / option is set */}
        {hasCoachGrades && (() => { renderedSections++; return (
        <>
        <SectionHeader
          icon={<CoachGradesIcon />}
          iconColor="green"
          title="Coach Grades"
        />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14,
        }}>
          {MANUAL_KEYS.map(({ key, label, hint, options }) => {
            const value = manual[key];
            const selectedOpts = manualOptions[key] || [];
            return (
              <ManualScoreCard
                key={key}
                label={label}
                hint={hint}
                value={value}
                isCoach={isCoach}
                onChange={(v) => setManual(prev => ({ ...prev, [key]: v }))}
                optionList={options}
                selectedOptions={selectedOpts}
                onToggleOption={(opt) => setManualOptions(prev => {
                  const cur = prev[key] || [];
                  const next = cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt];
                  return { ...prev, [key]: next };
                })}
              />
            );
          })}
        </div>

        {isCoach && (
          <div style={{
            marginTop: 16,
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <button
              type="button"
              onClick={saveManual}
              disabled={saving || !dirty}
              style={{
                padding: '9px 22px',
                borderRadius: 9,
                background: dirty
                  ? 'linear-gradient(135deg, rgba(74,222,128,0.30), rgba(74,222,128,0.18))'
                  : 'rgba(255,255,255,0.04)',
                border: dirty
                  ? '1px solid rgba(74,222,128,0.55)'
                  : '1px solid var(--border)',
                color: dirty ? '#ecfdf5' : 'var(--text-muted)',
                fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em',
                cursor: saving || !dirty ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : '💾 Save Coach Grades'}
            </button>
            {saveOk && <span style={{ color: '#86efac', fontSize: 12 }}>Saved.</span>}
            {saveError && <span style={{ color: '#fda4af', fontSize: 12 }}>{saveError}</span>}
            {!dirty && !saveOk && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {(() => {
                  const filled = MANUAL_KEYS
                    .map(k => persistedManual[k.key])
                    .filter(v => v != null).length;
                  return filled === 0
                    ? 'No grades saved yet.'
                    : `Last saved with ${filled}/${MANUAL_KEYS.length} grades filled in.`;
                })()}
              </span>
            )}
          </div>
        )}
        </>
        ); })()}

        {/* ── FULL SWING — only when QoC metrics have data */}
        {hasFullSwing && (() => {
          const showDivider = renderedSections > 0;
          renderedSections++;
          return (
        <>
        {showDivider && (
          <div style={{ height: 1, background: 'var(--border)', margin: '24px 0' }} />
        )}

        <SectionHeader
          icon={<FullSwingLogo />}
          iconColor="gold"
          title="Full Swing"
        />
        {(() => {
          const fmt = (key: string, value: number): { display: string; unit?: string } => {
            switch (key) {
              case 'avg_exit_velo':       return { display: value.toFixed(1), unit: 'mph' };
              case 'max_exit_velo':       return { display: value.toFixed(1), unit: 'mph' };
              case 'squared_up_pct':
              case 'full_swing_miss_pct':
              case 'overall_whiff_pct':
              case 'overall_barrel_pct':  return { display: `${value.toFixed(1)}%` };
              case 'smash_factor':        return { display: value.toFixed(2) };
              case 'launch_angle':        return { display: `${value.toFixed(1)}°` };
              case 'distance':            return { display: value.toFixed(0), unit: 'ft' };
              default:                    return { display: value.toFixed(1) };
            }
          };
          /* For metrics that BOTH HitTrax and Full Swing emit
             (avg_exit_velo / max_exit_velo / launch_angle / distance),
             prefer the Full-Swing-source-only override so HitTrax data
             never mixes in. For everything else (squared_up_pct,
             smash_factor, etc., which only Full Swing emits), fall
             through to topMetricsWithMiss. */
          const fsResolve = (k: string): { value: number; unit: string } | undefined => {
            if (fullswingOverride[k] !== undefined) return fullswingOverride[k];
            return topMetricsWithMiss[k];
          };
          return (
            <div style={metricRowStyle} className="metricRow">
              {QOC_KEYS.map(k => {
                const m = fsResolve(k);
                const label = METRIC_LABELS[k] || k;
                if (!m) return (
                  <div key={k} style={metricRowItemStyle}>
                    <KpiCard label={label} value="—" />
                  </div>
                );
                /* Grade lookup uses the Full-Swing-only value too. */
                const grade = metricToGrade(
                  { [k]: { value: m.value, unit: m.unit, recordedAt: '' } } as any,
                  k,
                );
                const f = fmt(k, m.value);
                return (
                  <div key={k} style={metricRowItemStyle}>
                    <KpiCard
                      label={label}
                      // Pass unit separately so KpiCard renders it via
                      // .kpiUnit (smaller) instead of inline at .kpiVal size.
                      value={f.display}
                      unit={f.unit}
                      color={grade !== null ? scoreColor(grade) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          );
        })()}
        </>
        ); })()}

        {/* ── BLAST MOTION — only when at least one swing metric grade is set */}
        {hasBlast && (() => {
          const showDivider = renderedSections > 0;
          renderedSections++;
          return (
        <>
        {showDivider && (
          <div style={{ height: 1, background: 'var(--border)', margin: '24px 0' }} />
        )}

        <SectionHeader
          icon={<BlastLogo />}
          iconColor="teal"
          title="Blast Motion"
        />

        <div style={metricRowStyle}>
            {SWING_METRIC_KEYS.map(k => {
              // Carry-forward from the active HITTING report (and earlier
              // HITTING reports if the active one is missing the metric).
              // No fallback to global topMetrics — render "—" if no report has it.
              const m = topMetricsWithMiss[k];
              const grade = metricGrades[k];
              const label = SCORE_LABEL_OVERRIDES[k] || METRIC_LABELS[k] || k;
              if (!m) {
                return (
                  <div key={k} style={metricRowItemStyle}>
                    <KpiCard label={label} value="—" />
                  </div>
                );
              }
              const display = (() => {
                if (k === 'time_to_contact') return m.value.toFixed(2);
                if (k === 'plane_angle' || k === 'attack_angle') return `${m.value.toFixed(1)}°`;
                return m.value.toFixed(1);
              })();
              // Angles bake the ° into the display so it stays attached to
              // the number. Pure-symbol units (°, %) also stay inline.
              // Word units (mph, ft) route through the smaller .kpiUnit slot.
              const isAngle = k === 'plane_angle' || k === 'attack_angle';
              const symbolUnit = m.unit === '°' || m.unit === '%';
              const inlineValue = isAngle || !m.unit
                ? display
                : symbolUnit ? `${display}${m.unit}` : display;
              const smallUnit = isAngle || !m.unit || symbolUnit
                ? undefined
                : m.unit;
              return (
                <div key={k} style={metricRowItemStyle}>
                  <KpiCard
                    label={label}
                    value={inlineValue}
                    unit={smallUnit}
                    color={grade !== null ? scoreColor(grade) : undefined}
                  />
                </div>
              );
            })}
          </div>
        </>
        ); })()}

        {/* ── HITTRAX — only when at least one HitTrax metric has data */}
        {hasHitTrax && (() => {
          const showDivider = renderedSections > 0;
          renderedSections++;
          return (
        <>
        {showDivider && (
          <div style={{ height: 1, background: 'var(--border)', margin: '24px 0' }} />
        )}

        <SectionHeader
          icon={<HitTraxLogo />}
          iconColor="red"
          title="HitTrax"
        />

        {(() => {
          /* Same number formatting as the Full Swing card so values read
             consistently across both sections. */
          const fmt = (key: string, value: number): { display: string; unit?: string } => {
            switch (key) {
              case 'avg_exit_velo':
              case 'max_exit_velo':  return { display: value.toFixed(1), unit: 'mph' };
              case 'launch_angle':   return { display: `${value.toFixed(1)}°` };
              case 'distance':       return { display: value.toFixed(0), unit: 'ft' };
              default:               return { display: value.toFixed(1) };
            }
          };
          return (
            <div style={metricRowStyle} className="metricRow">
              {HITTRAX_KEYS.map(k => {
                const m = hitTraxValues[k];
                const label = METRIC_LABELS[k] || k;
                if (!m) return (
                  <div key={k} style={metricRowItemStyle}>
                    <KpiCard label={label} value="—" />
                  </div>
                );
                /* Build a synthetic single-entry topMetrics so metricToGrade
                   sees the same averaged value the card displays. */
                const grade = metricToGrade(
                  { [k]: { value: m.value, unit: m.unit, recordedAt: '' } } as any,
                  k,
                );
                const f = fmt(k, m.value);
                return (
                  <div key={k} style={metricRowItemStyle}>
                    <KpiCard
                      label={label}
                      value={f.display}
                      unit={f.unit}
                      color={grade !== null ? scoreColor(grade) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          );
        })()}
        </>
        ); })()}

        </div>{/* /outer Hitting Inputs bubble */}
      </Section>

    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   HittingGradeStack — three composite grade bars (Swing · QoC · Swing Decision)
   stacked vertically, each with a row of small underlying-metric grade chips.
   ─────────────────────────────────────────────────────────────────────────── */
const QOC_KEYS = [
  'avg_exit_velo', 'squared_up_pct', 'smash_factor',
  'full_swing_miss_pct', 'overall_barrel_pct',
  'launch_angle', 'distance',
] as const;

/* HitTrax-driven KPIs — single session-level summary metrics emitted by
   the HitTrax CSV parser (and shared with whatever Full Swing happens
   to populate). Rendered in their own section under Blast Motion. */
const HITTRAX_KEYS = [
  'avg_exit_velo', 'max_exit_velo', 'distance', 'launch_angle',
] as const;

const DECISION_KEYS = [
  'fb_barrel_pct', 'os_barrel_pct', 'overall_barrel_pct',
  'fb_whiff_pct', 'os_whiff_pct', 'overall_whiff_pct',
  'fb_chase_pct', 'os_chase_pct', 'overall_chase_pct',
  'overall_bb_pct', 'overall_k_pct', 'overall_in_zone_swing_pct',
] as const;

/** Format a raw metric reading for the small chips (Swing + Quality of Contact rows).
 *  Coach Diagnosis chips bypass this and keep showing the 20-80 grade. */
function formatRawChip(key: string, value: number): string {
  switch (key) {
    case 'attack_angle':            return `${value.toFixed(1)}°`;
    case 'plane_angle':             return `${value.toFixed(1)}°`;
    case 'avg_bat_speed':           return value.toFixed(1);
    case 'time_to_contact':         return value.toFixed(2);
    case 'on_plane_efficiency':     return `${value.toFixed(0)}%`;
    case 'connection_at_contact':   return value.toFixed(0);
    case 'rotational_acceleration': return value.toFixed(1);
    case 'avg_exit_velo':           return value.toFixed(1);
    case 'squared_up_pct':          return `${value.toFixed(0)}%`;
    case 'smash_factor':            return value.toFixed(2);
    case 'full_swing_miss_pct':     return `${value.toFixed(0)}%`;
    case 'overall_whiff_pct':
    case 'overall_barrel_pct':
    case 'overall_chase_pct':
    case 'overall_in_zone_swing_pct':
    case 'overall_bb_pct':
    case 'overall_k_pct':
    case 'fb_barrel_pct':
    case 'fb_whiff_pct':
    case 'fb_chase_pct':
    case 'fb_in_zone_swing_pct':
    case 'os_barrel_pct':
    case 'os_whiff_pct':
    case 'os_chase_pct':
    case 'os_in_zone_swing_pct':    return `${value.toFixed(0)}%`;
    case 'launch_angle':            return `${value.toFixed(1)}°`;
    case 'distance':                return value.toFixed(0);
    default:                        return value.toFixed(1);
  }
}

const SHORT_LABELS: Record<string, string> = {
  // Swing mechanics
  attack_angle: 'Attack',
  plane_angle: 'Tilt',
  avg_bat_speed: 'Bat Spd',
  time_to_contact: 'TtC',
  on_plane_efficiency: 'Plane',
  connection_at_contact: 'Conn',
  rotational_acceleration: 'Rot',
  // Manual / Coach Diagnosis
  manual_forwardMove: 'Fwd Mv',
  manual_posture: 'Posture',
  manual_stability: 'Stable',
  manual_direction: 'Direct',
  manual_stretch: 'Stretch',
  manual_core: 'Core',
  manual_slot: 'Slot',
  manual_timing: 'Timing',
  // QoC
  avg_exit_velo: 'Avg EV',
  squared_up_pct: 'Sq-Up',
  smash_factor: 'Smash',
  full_swing_miss_pct: 'Miss',
  overall_whiff_pct: 'Whiff',
  overall_barrel_pct: 'Barrel',
  launch_angle: 'LA',
  distance: 'Dist',
  // Swing Decision
  fb_barrel_pct: 'FB Bar',
  os_barrel_pct: 'OS Bar',
  fb_whiff_pct: 'FB Wh',
  os_whiff_pct: 'OS Wh',
  fb_chase_pct: 'FB Ch',
  os_chase_pct: 'OS Ch',
  overall_chase_pct: 'Chase',
  overall_bb_pct: 'Walk',
  overall_k_pct: 'K%',
  fb_in_zone_swing_pct: 'FB Zn',
  os_in_zone_swing_pct: 'OS Zn',
  overall_in_zone_swing_pct: 'Zone Sw',
};

export function HittingGradeStack({
  topMetrics, manual, metricGrades, isCoach,
  diagnosisNotes, setDiagnosisNotes,
  subTabBar,
  subTab = 'swing',
}: {
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>;
  manual: ManualSwingScores;
  metricGrades: Record<string, number | null>;
  isCoach: boolean;
  diagnosisNotes: string;
  setDiagnosisNotes: (v: string) => void;
  /** Optional sub-tab nav rendered at the top of the bubble (HittingTab passes this in). */
  subTabBar?: React.ReactNode;
  /** Which sub-tab is active — controls which grade rows fill the bubble. */
  subTab?: 'swing' | 'decision';
}) {
  // Swing row — show raw metric values (chip color still derived from the 20-80 grade)
  const swingChips = SWING_METRIC_KEYS.map(k => {
    const m = topMetrics[k];
    return {
      key: k,
      label: SHORT_LABELS[k] || k,
      grade: metricGrades[k] ?? null,
      display: m ? formatRawChip(k, m.value) : undefined,
    };
  });
  const swingComposite = averageGrades(swingChips.map(c => c.grade));

  // Quality of Contact row — show raw metric values
  const qocChips = QOC_KEYS.map(k => {
    const m = topMetrics[k];
    return {
      key: k,
      label: SHORT_LABELS[k] || k,
      grade: metricToGrade(topMetrics, k),
      display: m ? formatRawChip(k, m.value) : undefined,
    };
  });
  const qocComposite = averageGrades(qocChips.map(c => c.grade));

  // Decision-view grade groups — one composite + chip strip per group
  const buildGroup = (keys: readonly string[]) => {
    const chips = keys.map(k => {
      const m = topMetrics[k];
      return {
        key: k,
        label: SHORT_LABELS[k] || k,
        grade: metricToGrade(topMetrics, k),
        display: m ? formatRawChip(k, m.value) : undefined,
      };
    });
    return { chips, composite: averageGrades(chips.map(c => c.grade)) };
  };
  const barrelGroup   = buildGroup(['fb_barrel_pct', 'os_barrel_pct', 'overall_barrel_pct']);
  const whiffGroup    = buildGroup(['fb_whiff_pct', 'os_whiff_pct', 'overall_whiff_pct']);
  const chaseGroup    = buildGroup(['fb_chase_pct', 'os_chase_pct', 'overall_chase_pct']);
  const approachGroup = buildGroup(['overall_bb_pct', 'overall_k_pct', 'fb_in_zone_swing_pct', 'os_in_zone_swing_pct', 'overall_in_zone_swing_pct']);

  // Coach Diagnosis row — all 7 manual scores
  const diagnosisChips: { key: string; label: string; grade: number | null }[] = [
    { key: 'manual_forwardMove', label: 'Fwd Mv',  grade: manual.forwardMove },
    { key: 'manual_posture',     label: 'Posture', grade: manual.posture },
    { key: 'manual_stability',   label: 'Stable',  grade: manual.stability },
    { key: 'manual_direction',   label: 'Direct',  grade: manual.direction },
    { key: 'manual_stretch',     label: 'Stretch', grade: manual.stretch },
    { key: 'manual_core',        label: 'Core',    grade: manual.core },
    { key: 'manual_slot',        label: 'Slot',    grade: manual.slot },
    { key: 'manual_timing',      label: 'Timing',  grade: manual.timing },
  ];
  const diagnosisComposite = averageGrades(diagnosisChips.map(c => c.grade));

  return (
    <div
      // Hitting Grades bubble — Movement-Plot tone (slight blue/dark hue
      // with center highlight) so it sits in the same interior palette
      // as the rest of the profile.
      className={aStyles.innerPanel}
      style={{
        padding: '14px 16px 16px',
        display: 'flex', flexDirection: 'column', gap: 12,
        width: '100%',
        minHeight: '100%',
      }}
    >
      {subTabBar /* sub-tab nav lives at the very top of the bubble when provided */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.22em',
        textTransform: 'uppercase', color: 'rgba(126,182,255,0.85)',
      }}>
        <span style={{
          display: 'inline-block', width: 7, height: 7, borderRadius: 4,
          background: '#7eb6ff', boxShadow: '0 0 8px rgba(126,182,255,0.7)',
        }} />
        Hitting Grades
      </div>

      {subTab === 'decision' ? (
        <>
          <GradeRow label="Barrel Rate" grade={barrelGroup.composite}   chips={barrelGroup.chips} />
          <GradeRow label="Whiff Rate"  grade={whiffGroup.composite}    chips={whiffGroup.chips} />
          <GradeRow label="Chase Rate"  grade={chaseGroup.composite}    chips={chaseGroup.chips} />
          <GradeRow label="Approach"    grade={approachGroup.composite} chips={approachGroup.chips} />
          <div style={{ flex: '1 1 auto', minHeight: 0 }} />
        </>
      ) : (
        <>
          <GradeRow label="Swing"              grade={swingComposite}     chips={swingChips} />
          <GradeRow label="Quality of Contact" grade={qocComposite}       chips={qocChips} />
          <GradeRow label="Coach Diagnosis"    grade={diagnosisComposite} chips={diagnosisChips} />
          <NoteBlock
            label="Diagnosis Notes"
            value={diagnosisNotes}
            onChange={setDiagnosisNotes}
            placeholder="Mechanical observations — load, posture, slot, sequencing, body line, swing decisions you noticed…"
            editable={isCoach}
            fill
          />
        </>
      )}
    </div>
  );
}

function NoteBlock({
  label, value, onChange, placeholder, editable, fill = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  editable: boolean;
  /** Make the block grow to fill remaining height of its flex parent. */
  fill?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      paddingBottom: fill ? 0 : 12,
      borderBottom: fill ? 'none' : '1px solid var(--border)',
      flex: fill ? '1 1 auto' : '0 0 auto',
      minHeight: 0,
    }}>
      <span style={{
        fontSize: 9.5, fontWeight: 700, letterSpacing: '0.22em',
        textTransform: 'uppercase', color: 'var(--text-bright)',
      }}>
        {label}
      </span>
      {editable ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={fill ? undefined : 2}
          style={{
            background: 'rgba(20,24,32,0.85)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '10px 12px',
            borderRadius: 7,
            fontSize: 14,
            lineHeight: 1.55,
            resize: fill ? 'none' : 'vertical',
            fontFamily: 'inherit',
            minHeight: fill ? 0 : 52,
            flex: fill ? '1 1 auto' : '0 0 auto',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div style={{
          fontSize: 14, lineHeight: 1.55,
          color: value ? 'var(--text)' : 'var(--text-muted)',
          fontStyle: value ? 'normal' : 'italic',
          padding: fill ? '10px 12px' : '6px 2px',
          background: fill ? 'rgba(20,24,32,0.55)' : 'transparent',
          border: fill ? '1px solid var(--border)' : 'none',
          borderRadius: fill ? 7 : 0,
          flex: fill ? '1 1 auto' : '0 0 auto',
          minHeight: 0,
          overflowY: 'auto',
        }}>
          {value || 'No notes yet.'}
        </div>
      )}
    </div>
  );
}

function GradeRow({
  label, grade, chips,
}: {
  label: string;
  grade: number | null;
  chips: { key: string; label: string; grade: number | null; display?: string }[];
}) {
  const tone = grade !== null ? scoreColor(grade) : '#475569';
  // Piecewise bar-fill: 20 → 0% empty, 40 → 50% halfway, 80 → 100% full.
  // The 20-point span 20-40 maps to the first half of the bar (more sensitive
  // around the league-average band); the 40-point span 40-80 maps to the
  // second half (so elite grades visually pop without compressing).
  const pct = grade === null ? 0
    : grade <= 20 ? 0
    : grade >= 80 ? 100
    : grade <= 40 ? (grade - 20) * 2.5
    : 50 + (grade - 40) * 1.25;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 7,
      paddingBottom: 12, borderBottom: '1px solid var(--border)',
    }}>
      {/* Header row: label + composite grade */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.20em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800,
          fontSize: 26, color: tone, letterSpacing: '-0.02em', lineHeight: 1,
        }}>
          {grade ?? '—'}
        </span>
      </div>

      {/* Big bar — 14 px tall, opaque fill so the score reads at a glance */}
      <div style={{
        position: 'relative',
        height: 14, borderRadius: 7,
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.18)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: tone,
          boxShadow: `0 0 10px ${tone}66`,
          transition: 'width 0.35s ease',
        }} />
        {/* 50% halfway tick — visual reference for the new piecewise scale */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: '50%',
          width: 1, background: 'rgba(255,255,255,0.22)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Underlying metric chips */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(58px, 1fr))',
        gap: 4,
        marginTop: 2,
      }}>
        {chips.map(c => {
          const ct = c.grade !== null ? scoreColor(c.grade) : '#475569';
          const hasData = c.display !== undefined || c.grade !== null;
          // For Swing/QoC chips: c.display is the formatted raw value (e.g., "92.5°")
          // For Coach Diagnosis chips: c.display is undefined → fall back to the 20-80 grade.
          const shownValue = c.display !== undefined ? c.display : (c.grade !== null ? `${c.grade}` : '—');
          // Smaller font when the display string is wide (e.g., "92.5°") to keep chips uniform.
          const valueFontSize = shownValue.length >= 5 ? 11 : shownValue.length >= 4 ? 12 : 13;
          return (
            <div key={c.key} title={c.label}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                padding: '4px 2px',
                background: hasData ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.012)',
                border: '1px solid',
                borderColor: hasData ? 'var(--border)' : 'rgba(255,255,255,0.04)',
                borderRadius: 6,
              }}>
              <span style={{
                fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em',
                color: 'var(--text-bright)', whiteSpace: 'nowrap',
                fontFamily: "'DM Mono', ui-monospace, monospace",
              }}>
                {c.label}
              </span>
              <span style={{
                fontSize: valueFontSize, fontWeight: 800,
                color: hasData ? ct : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
                lineHeight: 1.1, whiteSpace: 'nowrap',
              }}>
                {shownValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Composite hero — big number + breakdown bars
   ─────────────────────────────────────────────────────────────────────────── */
function CompositeHero({
  label, grade, parts,
}: {
  label: string;
  grade: number | null;
  parts: { label: string; grade: number | null }[];
}) {
  const pct = grade !== null ? ((grade - 20) / 60) * 100 : 0;
  const tone = grade !== null ? scoreColor(grade) : '#94a3b8';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 240px) 1fr',
      gap: 24,
      padding: '22px 26px',
      background: 'linear-gradient(135deg, rgba(126,182,255,0.06), rgba(61,139,253,0.02))',
      border: '1px solid rgba(126,182,255,0.25)',
      borderRadius: 14,
      alignItems: 'center',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.30em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
        }}>
          {label}
        </span>
        <div style={{
          fontSize: 64, fontWeight: 800, lineHeight: 1,
          color: tone,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.04em',
        }}>
          {grade ?? '—'}
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
          /80 · 20-80 SCALE
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Composite gauge bar */}
        <div style={{
          position: 'relative', height: 14, borderRadius: 9,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${tone}55, ${tone})`,
            transition: 'width 0.35s ease',
          }} />
        </div>
        {/* Sub-parts */}
        {parts.map(p => (
          <div key={p.label} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: 11.5, color: 'var(--text-muted)',
          }}>
            <span style={{ minWidth: 180 }}>{p.label}</span>
            <div style={{
              flex: 1, height: 5, borderRadius: 3,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${p.grade !== null ? ((p.grade - 20) / 60) * 100 : 0}%`,
                height: '100%',
                background: p.grade !== null ? scoreColor(p.grade) : 'transparent',
              }} />
            </div>
            <span style={{
              fontVariantNumeric: 'tabular-nums', fontWeight: 700,
              color: p.grade !== null ? 'var(--text)' : 'var(--text-muted)',
              minWidth: 28, textAlign: 'right',
            }}>
              {p.grade ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Manual score card — number input bound to a 20-80 grade
   ─────────────────────────────────────────────────────────────────────────── */
function ManualScoreCard({
  label, hint, value, isCoach, onChange,
  optionList, selectedOptions, onToggleOption,
}: {
  label: string;
  hint: string;
  value: number | null;
  isCoach: boolean;
  onChange: (v: number | null) => void;
  /** Multi-select options for this category (e.g. ['Stuck','Stable','Drift']).
   *  Coaches can toggle when editing; non-coaches see active chips read-only. */
  optionList: string[];
  selectedOptions: string[];
  onToggleOption: (opt: string) => void;
}) {
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? ((value - 20) / 60) * 100 : 0;
  const [editing, setEditing] = useState(false);

  return (
    <div
      // Coach Grade card (Forward Move / Posture / Stability / Direction /
      // Stretch / Core / Slot / Timing) — Movement-Plot tone for visual
      // consistency with the rest of the profile bubbles.
      className={aStyles.innerPanel}
      style={{
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      {/* Tiny edit toggle in top-right corner (coach only) */}
      {isCoach && (
        <button
          type="button"
          onClick={() => setEditing(e => !e)}
          title={editing ? 'Done editing' : 'Edit grade'}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 22, height: 22, borderRadius: 5,
            background: editing ? 'rgba(126,182,255,0.18)' : 'rgba(255,255,255,0.04)',
            border: editing
              ? '1px solid rgba(126,182,255,0.55)'
              : '1px solid var(--border)',
            color: editing ? 'var(--accent-light)' : 'var(--text-muted)',
            fontSize: 11, lineHeight: 1, padding: 0,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
          }}
        >
          {editing ? '✓' : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                 strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11.5 2.5l2 2-8 8H3.5v-2z" />
              <path d="M10 4l2 2" />
            </svg>
          )}
        </button>
      )}

      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        paddingRight: isCoach ? 28 : 0, // leave room for edit button
      }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 26,
          color: tone, lineHeight: 1, letterSpacing: '-0.02em',
        }}>
          {value ?? '—'}
        </span>
      </div>

      <div style={{
        height: 6, borderRadius: 4,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: tone, transition: 'width 0.25s ease',
        }} />
      </div>

      {/* Multi-select option chips:
          - Editing (coach): every option toggleable
          - Display: only the currently-selected chips, read-only, hidden when none */}
      {isCoach && editing ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {optionList.map(opt => {
            const active = selectedOptions.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onToggleOption(opt)}
                style={{
                  padding: '4px 9px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: active ? '1px solid rgba(126,182,255,0.55)' : '1px solid var(--border)',
                  background: active
                    ? 'linear-gradient(135deg, rgba(126,182,255,0.28), rgba(61,139,253,0.16))'
                    : 'rgba(255,255,255,0.04)',
                  color: active ? '#cfe0ff' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : selectedOptions.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {selectedOptions.map(tag => (
            <span key={tag} style={{
              padding: '2px 8px',
              borderRadius: 5,
              fontSize: 10.5,
              fontWeight: 600,
              background: 'linear-gradient(135deg, rgba(126,182,255,0.22), rgba(61,139,253,0.10))',
              border: '1px solid rgba(126,182,255,0.40)',
              color: '#cfe0ff',
              whiteSpace: 'nowrap',
            }}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {isCoach && editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={20} max={80} step={5}
            value={value ?? 50}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={20} max={80} step={5}
            value={value ?? ''}
            placeholder="—"
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return onChange(null);
              const n = Number(v);
              if (!Number.isFinite(n)) return;
              onChange(Math.max(20, Math.min(80, Math.round(n / 5) * 5)));
            }}
            style={{
              width: 64,
              background: 'rgba(20,24,32,0.85)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '5px 8px',
              borderRadius: 7,
              fontSize: 12, fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
            }}
          />
          {value !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              title="Clear"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: 13,
              }}
            >×</button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Empty state
   ─────────────────────────────────────────────────────────────────────────── */
function EmptyState({ text, hint }: { text: string; hint: string }) {
  return (
    <div style={{
      padding: '28px 22px',
      border: '1px dashed var(--border)',
      borderRadius: 12,
      color: 'var(--text-muted)',
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 1.6,
    }}>
      {text}
      <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.85 }}>{hint}</div>
    </div>
  );
}
