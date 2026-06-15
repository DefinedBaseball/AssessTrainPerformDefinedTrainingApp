'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
  AreaChart, Area,
} from 'recharts';
import {
  TabBarActions, EditProfileButton, ReportSelector, DownloadPdfButton, VideosIconButton,
  VideoPlayerModal, VideoBundleCard,
} from '@/components/assessment';
import { generateSummaryPdf } from '@/lib/pdf';
import {
  TabProps,
  scoreColor,
  computeAggregateScores,
  type AggregateSection,
  type AggregateBar,
} from '../helpers';
/* Shared tab/category color system — used by both this tab's
   Upcoming Drills panel and the Training (`/training`) page so the
   two surfaces render scheduled drills with identical color cues. */
import {
  TAB_LABELS, TAB_COLORS, LEGEND_CATEGORIES, getTabCatStyle,
  getVideoCategoryColors, TAB_ANCHOR_COLORS, TAB_ANCHOR_COLORS_DARK,
} from '@/lib/training-colors';
/* Multi-angle bundling — same helper the per-position video
   galleries use so the Player Summary's Videos panel reads with
   identical grouping behavior across the app. */
import { bundleVideos, normalizeVideoTitle, splitVideoTitle } from '@/lib/video-titles';
import styles from './PlayerSummaryTab.module.css';

/* ═══════════════════════════════════════════
   PALETTE — section colors matched to master's
   helpers.ts so the Summary tab matches the
   rest of the master-branch palette (monochrome
   graphite shell + green / blue / amber / purple
   / teal section identity colors).
   ═══════════════════════════════════════════ */

/* Unified app-wide section identity palette:
     Hitting           → Blue
     Pitching          → Orange
     Infield/Outfield  → Green
     Catching          → Turquoise
     S & C             → Red                                              */
const DOMAIN_PALETTE: Record<string, {
  main: string;
  soft: string;
  name: string;
}> = {
  hitting:           { main: '#3B82F6', soft: '#93c5fd', name: 'Hitting'  },
  pitching:          { main: '#F59E0B', soft: '#fcd34d', name: 'Pitching' },
  defense_infield:   { main: '#22C55E', soft: '#86efac', name: 'Infield'  },
  defense_catching:  { main: '#14B8A6', soft: '#5eead4', name: 'Catching' },
  defense_outfield:  { main: '#22C55E', soft: '#86efac', name: 'Outfield' },
  strength:          { main: '#EF4444', soft: '#fca5a5', name: 'S & C'    },
};

/* ═══════════════════════════════════════════
   SCALE HELPERS (20 → 80 scouting)
   ═══════════════════════════════════════════ */

const SCALE_MIN = 20;
const SCALE_MAX = 80;
const SCALE_RANGE = SCALE_MAX - SCALE_MIN; // 60

/** Map a 20-80 score to 0-100 percent on the bar track. */
function scoreToPct(score: number): number {
  const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, score));
  return ((clamped - SCALE_MIN) / SCALE_RANGE) * 100;
}

/** Pick a reasonable development target: +7 above current, capped at 70. */
function targetFor(score: number | null): number {
  if (score == null) return 50;
  return Math.min(70, Math.max(50, score + 7));
}

/** Average a section's populated bars, or null if none. */
function sectionAvg(section: AggregateSection): number | null {
  const scored = section.bars
    .map((b) => b.score)
    .filter((v): v is number => v !== null);
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
}

/* ═══════════════════════════════════════════
   CHART TOKENS — master is dark-only, so these
   are fixed (no theme hook).
   ═══════════════════════════════════════════ */

const CHART_TOKENS = {
  grid: 'rgba(255,255,255,0.06)',
  axis: '#6e767d',
  ref: 'rgba(255,255,255,0.25)',
  label: '#f1f4f6',
  tooltipBg: 'rgba(10,11,14,0.96)',
  tooltipBorder: 'rgba(255,255,255,0.14)',
  tooltipText: '#f1f4f6',
} as const;

/* ═══════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════ */

function DomainBar({
  label, color, score, target, subs,
}: {
  label: string;
  /** Section-identity color — used only for the small leading dot. */
  color: string;
  score: number | null;
  target: number;
  subs: AggregateBar[];
}) {
  const hasScore = score !== null;
  const fillPct = hasScore ? scoreToPct(score!) : 0;
  const targetPct = scoreToPct(target);

  // Bar fill & numeric score color both follow the unified score bands
  // (blue / white / green on black-test).
  const bandColor = hasScore ? scoreColor(score!) : '#6e767d';
  const bandSoft  = hasScore ? scoreColor(Math.max(20, score! - 10)) : '#6e767d';

  const subText = subs
    .map((b) => `${b.label} ${b.score ?? '—'}`)
    .join(' · ');

  return (
    <div className={styles.domainRow}>
      <div className={styles.domainMeta}>
        <div className={styles.domainName}>
          <span className={styles.dot} style={{ color, background: color }} />
          {label}
        </div>
        <div className={styles.score} style={hasScore ? { color: bandColor } : undefined}>
          {score ?? '—'} <small>/ 80</small>
        </div>
      </div>
      <div className={styles.barTrack}>
        <div className={styles.baseline} />
        <div
          className={styles.fill}
          style={{
            width: `${fillPct}%`,
            background: `linear-gradient(90deg, ${bandSoft}, ${bandColor})`,
            opacity: hasScore ? 1 : 0.25,
          }}
        />
        <div
          className={styles.target}
          style={{ left: `${targetPct}%`, opacity: hasScore ? 0.55 : 0.25 }}
        />
      </div>
      <div className={styles.barFooter}>
        <span>{subText || 'Sub-grades will populate with data'}</span>
        <span>{hasScore ? `Target ${target}` : 'No recent data'}</span>
      </div>
    </div>
  );
}

function FocusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className={styles.focus}>
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

/** Lightweight stand-in for AggregateBar so we can surface either a
 *  top-level bar or a leaf sub-metric (e.g. Coach Diagnosis manual scores)
 *  through the same Best Tool / Biggest Weakness card UI. */
interface BestWorstItem { label: string; score: number }

/** Per-section best/worst pulled from the most-relevant grading pool:
 *    • Hitting → the 8 Coach Diagnosis manual scores (Forward Move,
 *      Posture, Stability, Direction, Stretch, Core, Slot, Timing).
 *    • Pitching → mechanical delivery checkpoints if present, else the
 *      top-level bars.
 *    • Defense / S&C → top-level bars (no Coach Diagnosis equivalent).
 *  Returns null fields when the chosen pool has no graded entries. */
function bestWorstBar(section: AggregateSection): {
  best: BestWorstItem | null;
  worst: BestWorstItem | null;
} {
  // Pick the pool of items to compare. For Hitting we restrict to the
  // Coach Grades bar's sub-metrics so coaches see which manual grade
  // is best/worst rather than which composite bar.
  let pool: { label: string; score: number }[] = [];
  if (section.key === 'hitting') {
    const coachBar = section.bars.find((b) => b.key === 'hit_coach');
    pool = (coachBar?.subMetrics ?? [])
      .filter((sm): sm is typeof sm & { grade: number } => typeof sm.grade === 'number')
      .map((sm) => ({ label: sm.label, score: sm.grade }));
  } else {
    pool = section.bars
      .filter((b): b is AggregateBar & { score: number } => b.score != null)
      .map((b) => ({ label: b.label, score: b.score }));
  }

  if (pool.length === 0) return { best: null, worst: null };
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return {
    best,
    // If only one entry is graded, best === worst — leave worst null so
    // the UI doesn't repeat the same line twice.
    worst: best === worst ? null : worst,
  };
}

/** Parse `player.developmentNotes` (JSON string) into a section-keyed map.
 *  Always returns an object so the UI can index into it without null guards. */
function parseDevelopmentNotes(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  } catch { return {}; }
}

function SectionDevelopmentCard({
  section, palette, notes, dirty, isCoach, onChange,
  registerNotes, onNotesScroll, onNotesResizeEnd,
}: {
  section: AggregateSection;
  palette: { main: string; soft: string; name: string };
  notes: string;
  dirty: boolean;
  isCoach: boolean;
  onChange: (next: string) => void;
  /** Register the notes textarea for cross-card sync. */
  registerNotes?: (key: string, el: HTMLTextAreaElement | null) => void;
  /** Mirror scroll position to the sibling notes textareas. */
  onNotesScroll?: (sourceKey: string, scrollTop: number) => void;
  /** Called when the user finishes dragging the textarea's resize handle —
   *  parent snaps every sibling to the source's final height. */
  onNotesResizeEnd?: (sourceKey: string) => void;
}) {
  const { best, worst } = bestWorstBar(section);
  const bestColor  = best  ? scoreColor(best.score)  : 'var(--text-muted)';
  const worstColor = worst ? scoreColor(worst.score) : 'var(--text-muted)';
  // Section aggregate — average of every populated bar score in this
  // section. Renders inline in the card header (replaces the retired
  // overall total score on the snapshot bubble).
  const sectionScoreAvg = sectionAvg(section);
  const sectionScoreColor = sectionScoreAvg !== null ? scoreColor(sectionScoreAvg) : 'var(--text-muted)';
  return (
    <div
      className={styles.devSection}
      // Drive the accent stripe + tint + glow off the section's palette
      // color — every per-card style cue uses --section-tone so a color
      // change at the palette level propagates everywhere.
      style={{ ['--section-tone' as any]: palette.main }}
    >
      <div className={styles.devSectionHead}>
        <span className={styles.devSectionDot} style={{ background: palette.main }} />
        <span className={styles.devSectionTitle}>{palette.name}</span>
        {dirty && <span className={styles.devSectionDirty}>Unsaved</span>}
        <span className={styles.devSectionScore} style={{ color: sectionScoreColor }}>
          {sectionScoreAvg ?? '—'}
        </span>
      </div>
      {/* Best Tool / Biggest Weakness — wrapped in small bubble cards
          inside the section so they read as their own callouts. Side-by-side
          on wide cards, stacked when the section card narrows. */}
      <div className={styles.devBubbleRow}>
        <div className={styles.devBubble}>
          <span className={styles.devBubbleLabel}>Best Tool</span>
          <span className={styles.devBubbleValue}>
            {best ? best.label : '—'}
          </span>
          <span className={styles.devBubbleScore} style={{ color: best ? bestColor : 'var(--text-muted)' }}>
            {best ? best.score : '—'}
          </span>
        </div>
        <div className={styles.devBubble}>
          <span className={styles.devBubbleLabel}>Biggest Weakness</span>
          <span className={styles.devBubbleValue}>
            {worst ? worst.label : (best ? '—' : 'Awaiting data')}
          </span>
          <span className={styles.devBubbleScore} style={{ color: worst ? worstColor : 'var(--text-muted)' }}>
            {worst ? worst.score : '—'}
          </span>
        </div>
      </div>
      <div className={styles.devRow}>
        <span className={styles.devRowLabel}>Next Steps</span>
      </div>
      {isCoach ? (
        <textarea
          ref={(el) => registerNotes?.(section.key, el)}
          className={styles.devNotesInput}
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          // Mirror vertical scroll across sibling textareas so all four
          // panes track together while reading.
          onScroll={(e) => onNotesScroll?.(section.key, e.currentTarget.scrollTop)}
          // After the user finishes dragging the resize handle, snap
          // every sibling to the same height. Skipping the live-broadcast
          // approach avoids the per-frame layout jitter.
          onMouseUp={() => onNotesResizeEnd?.(section.key)}
          onTouchEnd={() => onNotesResizeEnd?.(section.key)}
          placeholder={`Drills, focus areas, programming notes for ${palette.name}…`}
          rows={3}
        />
      ) : (
        <div
          ref={(el) => registerNotes?.(section.key, el as unknown as HTMLTextAreaElement)}
          className={styles.devNotesView}
          onScroll={(e) => onNotesScroll?.(section.key, e.currentTarget.scrollTop)}
        >
          {notes || <span className={styles.devNotesEmpty}>No next-steps notes yet.</span>}
        </div>
      )}
    </div>
  );
}

function QuadCard({
  tone, title, body, metricLabel, metricValue, muted,
}: {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  title: string;
  body: string;
  metricLabel: string;
  metricValue: number | null;
  muted?: boolean;
}) {
  const toneClass =
    tone === 'good' ? styles.quadGood :
    tone === 'warn' ? styles.quadWarn :
    tone === 'bad'  ? styles.quadBad  : '';

  return (
    <div className={`${styles.quad} ${toneClass}`}>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
      <div className={muted ? styles.quadMetricMuted : styles.quadMetric}>
        {metricLabel} {metricValue ?? '—'}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   INSIGHT GENERATION — copy for the focus grid
   & quadrants, derived from the real sections.
   ═══════════════════════════════════════════ */

function buildInsights(sections: AggregateSection[], overall: number | null) {
  const withAvg = sections
    .map((s) => ({ section: s, avg: sectionAvg(s) }))
    .filter((e): e is { section: AggregateSection; avg: number } => e.avg !== null);

  const sortedDesc = [...withAvg].sort((a, b) => b.avg - a.avg);
  const best = sortedDesc[0];
  const worst = sortedDesc[sortedDesc.length - 1];

  const ready = sortedDesc.find((e) => e.avg >= 60) ?? best;

  // Focus cards
  const focus = [
    best
      ? {
          title: 'Best carry tool',
          body: `${best.section.label} grades at ${best.avg}, giving you a stable base to build the rest of the profile around.`,
        }
      : { title: 'Best carry tool', body: 'Not enough data yet — add a recent assessment to surface your top tool.' },
    worst && best && worst !== best
      ? {
          title: 'Biggest gap',
          body: `${worst.section.label} sits at ${worst.avg}, the furthest from the target band and the clearest place to focus reps.`,
        }
      : { title: 'Biggest gap', body: 'Every section is tracking close to its target — keep stacking consistent reps.' },
    ready
      ? {
          title: 'Ready cue',
          body: `${ready.section.label} is the most mature area, so you can press intent here without worrying about physical capacity.`,
        }
      : { title: 'Ready cue', body: 'Establish a baseline assessment to unlock ready cues and training recommendations.' },
    worst
      ? {
          title: 'Next action',
          body: `Prioritize the sub-grades that are dragging ${worst.section.label.toLowerCase()} down rather than chasing the headline number.`,
        }
      : { title: 'Next action', body: 'Log a full report to auto-generate your next development action.' },
  ];

  // Short overall headline
  const headline =
    overall == null
      ? 'Assessment pending — a completed report unlocks this view.'
      : overall >= 60
        ? 'Profile reads as competitive now, with room to grow in the lowest-scoring area.'
        : overall >= 50
          ? 'Playable now, with the fastest gains available in the lowest-scoring area.'
          : 'Developing profile — focus reps on the weakest tool to lift the overall grade.';

  return { focus, headline, best, worst, ready };
}

/* ═══════════════════════════════════════════
   Horizontal sub-grade compare (Recharts)
   ═══════════════════════════════════════════ */

/** The non-physical comparison domain rendered alongside Strength &
 *  Conditioning ("Physical") in the modular sub-grade compare chart.
 *  Each defense position is its own option so a Catcher gets
 *  "Physical vs Catching", an Infielder gets "Physical vs Infield",
 *  and an Outfielder gets "Physical vs Outfield" — instead of
 *  collapsing all three into a single "Defense" rollup. */
type CompareDomain =
  | 'hitting'
  | 'pitching'
  | 'defense_infield'
  | 'defense_catching'
  | 'defense_outfield';

const DOMAIN_LABELS: Record<CompareDomain, string> = {
  hitting:           'Hitting',
  pitching:          'Pitching',
  defense_infield:   'Infield',
  defense_catching:  'Catching',
  defense_outfield:  'Outfield',
};
const DOMAIN_ORDER: CompareDomain[] = [
  'hitting', 'pitching', 'defense_infield', 'defense_catching', 'defense_outfield',
];

/** Pick the relevant aggregate sections for the chosen comparison domain.
 *  Now a 1-to-1 lookup since defense is split per-position. */
function sectionsForDomain(sections: AggregateSection[], domain: CompareDomain): AggregateSection[] {
  return sections.filter((s) => s.key === domain);
}

function SubgradeCompareChart({
  sections, compareDomain,
}: {
  sections: AggregateSection[];
  compareDomain: CompareDomain;
}) {
  const tk = CHART_TOKENS;
  const data = useMemo(() => {
    const physicalSections = sections.filter((s) => s.key === 'strength');
    const partnerSections  = sectionsForDomain(sections, compareDomain);
    const buildRows = (group: 'Physical' | 'Skill', srcs: AggregateSection[]) =>
      srcs.flatMap((s) =>
        s.bars.map((b) => ({
          name: b.label,
          value: b.score ?? null,
          displayValue: b.score ?? 20,
          color: b.score != null ? scoreColor(b.score) : '#9aa0a6',
          sectionLabel: s.label,
          group,
        })),
      );
    return [
      ...buildRows('Physical', physicalSections),
      ...buildRows('Skill', partnerSections),
    ];
  }, [sections, compareDomain]);

  if (data.length === 0) {
    return <div style={{ color: 'var(--text-muted)', padding: 20 }}>No sub-grades yet.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 8, right: 28, bottom: 8, left: 12 }}
      >
        <CartesianGrid horizontal={false} stroke={tk.grid} />
        <XAxis
          type="number"
          domain={[20, 80]}
          ticks={[20, 30, 40, 50, 60, 70, 80]}
          stroke={tk.axis}
          fontSize={11}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          stroke={tk.axis}
          fontSize={11}
          tickLine={false}
          width={140}
        />
        <ReferenceLine x={50} stroke={tk.ref} strokeDasharray="5 5" />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          contentStyle={{
            background: tk.tooltipBg,
            border: `1px solid ${tk.tooltipBorder}`,
            borderRadius: 10,
            fontSize: rem(12),
            color: tk.tooltipText,
          }}
          formatter={(_v: any, _n: any, item: any) => {
            const row = item?.payload;
            return [row?.value ?? '—', `${row?.group} · ${row?.sectionLabel} · ${row?.name}`];
          }}
        />
        <Bar dataKey="displayValue" radius={[6, 6, 6, 6]} barSize={16}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.color}
              fillOpacity={d.value == null ? 0.2 : 1}
            />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            style={{ fill: tk.label, fontSize: rem(11), fontWeight: 700 }}
            formatter={(v: any) => (v == null ? '—' : v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* `SectionBarsChart` retired — it powered the per-bar mini chart grid
   inside the "Sub-Grade Breakdown" panel, which has been removed from
   the Player Summary hero stack. Tool Grades stands alone now. */

/* ═══════════════════════════════════════════
   Modular metric trend — picks a metric from
   progressData and renders historical averages
   per report date as a smooth area chart.
   ═══════════════════════════════════════════ */

/** Per-pitch-type metrics shared across every pitching optgroup. The
 *  Metric Trend selector groups these under each pitch type so a pitcher
 *  sees "4-Seam Fastball → Max Velocity / Avg Velocity / H-Break / IVB
 *  / Spin Rate / Spin Efficiency", "Slider → ...", etc. */
const PITCH_TREND_METRICS = [
  { suffix: 'max_velo', label: 'Max Velocity',    unit: 'mph' },
  { suffix: 'avg_velo', label: 'Avg Velocity',    unit: 'mph' },
  { suffix: 'h_break',  label: 'H-Break',         unit: 'in' },
  { suffix: 'ivb',      label: 'IVB',             unit: 'in' },
  { suffix: 'spin',     label: 'Spin',            unit: 'rpm' },
  { suffix: 'spin_eff', label: 'Spin Efficiency', unit: '%' },
] as const;

/** Pitch types tracked in the Metric Trend dropdown. Keys mirror the
 *  display names used by PITCH_DISPLAY in PitchingTab; backend can
 *  populate progressData entries like `fastball_max_velo`,
 *  `slider_avg_velo`, etc. and they'll appear automatically once the
 *  player has historical points for that key. */
const PITCH_TREND_TYPES: { label: string; keyPrefix: string }[] = [
  { label: '4-Seam Fastball', keyPrefix: 'fastball' },
  { label: 'Sinker',          keyPrefix: 'sinker' },
  { label: 'Cutter',          keyPrefix: 'cutter' },
  { label: 'Slider',          keyPrefix: 'slider' },
  { label: 'Sweeper',         keyPrefix: 'sweeper' },
  { label: 'Curveball',       keyPrefix: 'curveball' },
  { label: 'Changeup',        keyPrefix: 'changeup' },
  { label: 'Splitter',        keyPrefix: 'splitter' },
];

/** Domains the metric selector groups options under, plus a per-domain
 *  accent color the line + area shading uses. Keeps the selector readable
 *  for both coaches and athletes scanning a long metric list. */
const TREND_DOMAINS: { label: string; accent: string; metrics: { key: string; label: string; unit: string }[] }[] = [
  {
    label: 'Hitting', accent: '#3B82F6',
    metrics: [
      { key: 'max_exit_velo', label: 'Max Exit Velo', unit: 'mph' },
      { key: 'avg_exit_velo', label: 'Avg Exit Velo', unit: 'mph' },
      { key: 'max_bat_speed', label: 'Max Bat Speed', unit: 'mph' },
      { key: 'avg_bat_speed', label: 'Avg Bat Speed', unit: 'mph' },
      { key: 'bat_speed',     label: 'Bat Speed',     unit: 'mph' },
      { key: 'smash_factor',  label: 'Smash Factor',  unit: '' },
      { key: 'launch_angle',  label: 'Launch Angle',  unit: '°' },
      { key: 'attack_angle',  label: 'Attack Angle',  unit: '°' },
      { key: 'distance',      label: 'Distance',      unit: 'ft' },
      { key: 'squared_up_pct',label: 'Squared Up %',  unit: '%' },
      { key: 'plane_angle',   label: 'Plane Angle',   unit: '°' },
    ],
  },
  {
    label: 'Defense', accent: '#22C55E',
    metrics: [
      { key: 'infield_velo',  label: 'Infield Velo',  unit: 'mph' },
      { key: 'outfield_velo', label: 'Outfield Velo', unit: 'mph' },
      { key: 'catcher_velo',  label: 'Catcher Velo',  unit: 'mph' },
      { key: 'pop_time',      label: 'Pop Time',      unit: 's' },
      { key: 'exchange_time', label: 'Exchange Time', unit: 's' },
    ],
  },
  /* Each pitch type gets its own optgroup with the 6 standard pitch
     metrics. Builds 8 × 6 = 48 entries; the populated filter only
     surfaces ones with actual recorded history so the dropdown stays
     compact for pitchers who only carry a couple of pitch types. */
  {
    label: 'Pitching', accent: '#F59E0B',
    metrics: [
      { key: 'fb_max_velo', label: 'Fastball Max Velo', unit: 'mph' },
      { key: 'fb_avg_velo', label: 'Fastball Avg Velo', unit: 'mph' },
      { key: 'spin_rate',   label: 'Spin Rate',         unit: 'rpm' },
      { key: 'h_break',     label: 'Horizontal Break',  unit: 'in' },
      { key: 'v_break',     label: 'Vertical Break',    unit: 'in' },
    ],
  },
  {
    label: 'Physical', accent: '#EF4444',
    metrics: [
      { key: 'sprint_60',    label: '60-yd Sprint',   unit: 's' },
      { key: 'sprint_10',    label: '10 Yard Sprint', unit: 's' },
      { key: 'jump_height',  label: 'Vert Jump',      unit: 'in' },
      { key: 'broad_jump',   label: 'Broad Jump',   unit: 'in' },
      { key: 'squat_max',    label: 'Squat Max',    unit: 'lb' },
      { key: 'bench_max',    label: 'Bench Max',    unit: 'lb' },
      { key: 'deadlift_max', label: 'Deadlift Max', unit: 'lb' },
    ],
  },
];

interface TrendPoint { label: string; value: number }

/** Bin a metric's raw progress points into one daily average so the line
 *  reads as historical session averages rather than every individual rep.
 *  Falls back to the most-recent N points so the X-axis stays scannable. */
function buildTrendPoints(raw: { value: number; recordedAt: string }[] | undefined, max = 12): TrendPoint[] {
  if (!raw || raw.length === 0) return [];
  const byDay: Record<string, { sum: number; count: number }> = {};
  for (const d of raw) {
    const day = d.recordedAt.slice(0, 10);
    const cur = byDay[day] ?? { sum: 0, count: 0 };
    cur.sum += d.value;
    cur.count += 1;
    byDay[day] = cur;
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-max)
    .map(([day, agg]) => ({
      label: new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value: Math.round((agg.sum / agg.count) * 100) / 100,
    }));
}

/** Modular metric-history chart with a domain-grouped metric selector.
 *  Coaches and athletes can switch which historical average renders without
 *  leaving the Player Summary. */
function MetricTrendPanel({
  progressData,
}: {
  progressData: Record<string, { value: number; recordedAt: string }[]>;
}) {
  // List of (domain, metric) pairs the player actually has data for.
  // Building the selector off of populated keys keeps it from listing
  // empty options. Falls back to the first populated metric on first render.
  const populated = useMemo(() => {
    const out: { domain: typeof TREND_DOMAINS[number]; metric: typeof TREND_DOMAINS[number]['metrics'][number] }[] = [];
    for (const dom of TREND_DOMAINS) {
      for (const m of dom.metrics) {
        if (progressData[m.key] && progressData[m.key].length > 0) {
          out.push({ domain: dom, metric: m });
        }
      }
    }
    return out;
  }, [progressData]);

  const [selectedKey, setSelectedKey] = useState<string>(() => populated[0]?.metric.key ?? '');
  // If the populated list changes (refresh / edit) and the current pick
  // disappeared, fall back to the first available again.
  useEffect(() => {
    if (populated.length === 0) { setSelectedKey(''); return; }
    if (!populated.some((p) => p.metric.key === selectedKey)) {
      setSelectedKey(populated[0].metric.key);
    }
  }, [populated, selectedKey]);

  const current = populated.find((p) => p.metric.key === selectedKey);
  const points  = useMemo(() => buildTrendPoints(progressData[selectedKey]), [progressData, selectedKey]);

  return (
    <>
      <div className={styles.sectionTitle}>
        <div>
          {/* Swapped — "Metric Trend" leads as the big italic title and
              the populated metric label sits below it as the small eyebrow. */}
          <h2>Metric Trend</h2>
          <div className={styles.tiny}>{current ? current.metric.label : 'Historical averages'}</div>
        </div>
        <select
          className={styles.chartSelect}
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
          disabled={populated.length === 0}
        >
          {populated.length === 0 && <option value="">No metric history yet</option>}
          {TREND_DOMAINS.map((dom) => {
            const opts = dom.metrics.filter((m) => progressData[m.key] && progressData[m.key].length > 0);
            if (opts.length === 0) return null;
            return (
              <optgroup key={dom.label} label={dom.label}>
                {opts.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
      </div>
      <div className={`${styles.chartWrap} ${styles.chartWrapTall}`}>
        <TrendChart
          data={points}
          unit={current?.metric.unit ?? ''}
          accent={current?.domain.accent ?? '#60A5FA'}
        />
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════
   Custom trend line (bottom-right)
   ═══════════════════════════════════════════ */

function TrendChart({
  data, unit, accent = '#60A5FA',
}: {
  data: { label: string; value: number }[];
  unit: string;
  accent?: string;
}) {
  const tk = CHART_TOKENS;

  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '32px 12px', textAlign: 'center', fontSize: rem(13) }}>
        No trend data captured yet.
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.25 || 1;
  const yMin = Math.floor(min - pad);
  const yMax = Math.ceil(max + pad);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={tk.grid} />
        {/* Multiple tightening levers stack here to cut the gap
            between the chart's bottom edge and the X-axis date
            labels roughly in half:
              - `axisLine={false}` removes the horizontal axis line
              - `tickLine={false}` removes the per-tick spurs
              - `tickMargin={2}` halves the default tick-to-label gap
              - `height={16}` shrinks the X-axis area itself so the
                label sits much closer to the chart's plot bottom. */}
        <XAxis
          dataKey="label"
          stroke={tk.axis}
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickMargin={2}
          height={16}
        />
        <YAxis
          domain={[yMin, yMax]}
          stroke={tk.axis}
          fontSize={11}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: tk.tooltipBg,
            border: `1px solid ${tk.tooltipBorder}`,
            borderRadius: 10,
            fontSize: rem(12),
            color: tk.tooltipText,
          }}
          formatter={(v: any) => [`${v} ${unit}`, '']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={accent}
          strokeWidth={2.5}
          fill="url(#trendAreaGrad)"
          dot={{ r: 4, fill: accent, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: accent, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ═══════════════════════════════════════════
   UpcomingDrillsPanel — weekly day-tab snapshot of scheduled drills
   for this athlete. Closes the loop between the coach's calendar
   (/program /training) and the athlete's profile: drills the coach
   schedules show up here, picked by day-of-week.

   UI shape: a row of 7 day-of-week tabs spanning today → +6 days,
   each labeled with the weekday name + the calendar date. Clicking
   a tab swaps the body to that day's drills, rendered as the same
   color-coded category cards the Training day-column uses. Today is
   pre-selected on mount.

   Data: still fetches a 14-day window so we always have at least a
   week of forward coverage even when today is late-week. The 7-day
   tab strip is computed from local "today" so the dates align with
   the coach's wall calendar instead of UTC midnight.
   ═══════════════════════════════════════════ */

/** Format a local Date as YYYY-MM-DD using its LOCAL year/month/day —
 *  matches the date keys produced by the coach's /training scheduler
 *  (which also writes dates as local). Using `.toISOString().slice(0,10)`
 *  would shift west-of-UTC users by a day. */
function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Canonical column order for the Upcoming Drills day-grid. Only tabs
   in this list with at least one drill on the SELECTED day surface as
   columns — position-based filtering was retired in favor of the more
   direct "has scheduled work that day" check (the data itself is the
   source of truth, and an empty column adds noise without information). */
const UPCOMING_DRILL_TABS: readonly { key: string; label: string }[] = [
  { key: 'hitting',  label: TAB_LABELS.hitting },
  { key: 'pitching', label: TAB_LABELS.pitching },
  { key: 'catching', label: TAB_LABELS.catching },
  { key: 'infield',  label: TAB_LABELS.infield },
  { key: 'outfield', label: TAB_LABELS.outfield },
  { key: 'strength', label: TAB_LABELS.strength },
];

function UpcomingDrillsPanel({ playerId }: { playerId: string }) {
  const [items, setItems] = useState<api.ScheduledDrill[]>([]);
  const [loading, setLoading] = useState(true);

  /* The 7-day tab strip: today + the next 6 days. Computed once on
     mount so it doesn't drift if the user leaves the page open across
     midnight. */
  const weekDates = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return toLocalIsoDate(d);
    });
  }, []);

  /* Selected day — defaults to today (index 0 of weekDates). Coaches
     can click any other tab to advance the snapshot forward in the
     week. */
  const [selectedDate, setSelectedDate] = useState<string>(weekDates[0]);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    /* Fetch the full 14-day window from the server so the tab strip
       always has data even when the user opens the panel late in the
       week (and to leave headroom if we add prev/next week nav). */
    const start = weekDates[0];
    const end = (() => {
      const d = new Date(start + 'T00:00:00');
      d.setDate(d.getDate() + 14);
      return toLocalIsoDate(d);
    })();
    setLoading(true);
    api.getScheduledDrills(playerId, { startDate: start, endDate: end })
      .then(rows => {
        if (cancelled) return;
        // Sort by date+time ascending (server should already, but be defensive)
        const sorted = [...rows].sort((a, b) => {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return a.time.localeCompare(b.time);
        });
        setItems(sorted);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [playerId, weekDates]);

  /* Drills scheduled on the currently-selected day, already time-sorted
     above. */
  const selectedDrills = useMemo(
    () => items.filter(it => it.date === selectedDate),
    [items, selectedDate],
  );

  /* Tabs to surface as columns on the selected day — only those with
     at least one scheduled drill. Order follows `UPCOMING_DRILL_TABS`
     so the lineup reads Hitting → Pitching → Catching → Infield →
     Outfield → S & C whenever multiple tabs have work scheduled. */
  const populatedTabs = useMemo(() => {
    const present = new Set(selectedDrills.map(d => d.tab));
    return UPCOMING_DRILL_TABS.filter(t => present.has(t.key));
  }, [selectedDrills]);

  /* Per-day drill counts — surfaced as small chips on each tab so a
     coach can scan the week at a glance and see which days have
     scheduled work. Uses local-date keys so the math lines up with
     the tab strip's `weekDates`. */
  const countByDate = useMemo(() => {
    const map: Record<string, number> = {};
    for (const it of items) {
      map[it.date] = (map[it.date] || 0) + 1;
    }
    return map;
  }, [items]);

  /** Long-form date for the selected-day header (e.g. "Mon, Nov 4"). */
  const formatDateLong = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    });
  };

  /** Short weekday + numeric-day for the tab labels. */
  const formatTabDay = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    const md = `${d.getMonth() + 1}/${d.getDate()}`;
    return { weekday, md };
  };

  return (
    /* Inner padding retired here — the parent `.panel` (1.4rem all
       around) already owns the bubble's top/side spacing, so the
       title sits at the Tool-Grades-canonical 22.4 px below the
       bubble's top edge instead of being inset twice. */
    <div>
      {/* Header now follows the shared Tool Grades rhythm via the
          PlayerSummary `.sectionTitle` rule: italic Brown-display
          title + full-width 1px accent line + 0.85rem gap before
          the first inner content. The previous mono-eyebrow
          "Upcoming Drills · Next 14 Days" was the only Summary
          panel with non-conforming title chrome. */}
      <div className={styles.sectionTitle}>
        <h2 className={styles.panelTitle}>Upcoming Drills</h2>
      </div>

      {/* ── Day-of-week tab strip ──────────────────────────────────
          7 day buttons spanning today → +6 days. Each button shows
          the weekday name on top and the M/D date below. The selected
          tab gets the bright fill + accent border; tabs with zero
          drills scheduled drop to a muted treatment so coaches can
          see the week's busy days at a glance. */}
      <div
        role="tablist"
        aria-label="Day of week"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 6,
          marginBottom: 14,
        }}
      >
        {weekDates.map((iso) => {
          const { weekday, md } = formatTabDay(iso);
          const isSelected = iso === selectedDate;
          const isToday = iso === weekDates[0];
          const count = countByDate[iso] || 0;
          const hasDrills = count > 0;
          return (
            <button
              key={iso}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setSelectedDate(iso)}
              style={{
                /* Selected: bright filled chip. Unselected with drills:
                   subtle dark chip. Unselected with no drills: faded
                   so the week-level overview reads at a glance.
                   Selected chip uses `var(--bubble-chrome-bg)` so it
                   auto-flips between the dark-mode white gradient
                   and the light-mode off-white #f3f3f3 → #e5e5e5
                   gradient in lockstep with every other movement-
                   plot / pitch-report bubble across the app. */
                background: isSelected
                  ? 'var(--bubble-chrome-bg)'
                  : hasDrills
                    ? 'rgba(255,255,255,0.035)'
                    : 'transparent',
                border: isSelected
                  ? '1px solid var(--border-light)'
                  : '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 4px 6px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                /* Selected text uses `var(--text-bright)` instead of a
                   hardcoded white so it auto-flips to near-black in
                   light mode — otherwise the selected chip's white
                   text was invisible against the off-white
                   `--bubble-chrome-bg` background in light theme.
                   Unselected days (both has-drills + no-drills) use
                   `var(--text-muted)` so the day labels read as a
                   subdued grey — selected day stays high-contrast
                   while the rest of the week sits visually back. */
                color: isSelected
                  ? 'var(--text-bright)'
                  : 'var(--text-muted)',
                transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease',
                position: 'relative',
              }}
            >
              <span style={{
                fontSize: rem(10), fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.10em',
                /* TODAY badge sits IN PLACE of the weekday text on
                   today's tab so a coach instantly orients to "where
                   am I in the week" without scanning dates. */
              }}>
                {isToday ? 'TODAY' : weekday}
              </span>
              <span style={{
                fontSize: rem(13), fontWeight: 700,
                fontFamily: "'DM Mono', ui-monospace, monospace",
                letterSpacing: '0.02em',
              }}>
                {md}
              </span>
              {/* Drill-count chip — only renders on days with at
                  least one scheduled drill. Sits in the top-right
                  corner so it doesn't disrupt the weekday/date
                  vertical rhythm. */}
              {count > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  minWidth: 14, height: 14,
                  padding: '0 4px',
                  borderRadius: 7,
                  background: isSelected
                    ? 'rgba(255,255,255,0.20)'
                    : 'rgba(95, 245, 223, 0.18)',
                  /* Count text uses `var(--text-bright)` when selected
                     so it flips to near-black in light mode (white on
                     the white selected bubble was invisible). */
                  color: isSelected ? 'var(--text-bright)' : '#5FF5DF',
                  fontSize: rem(9), fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  letterSpacing: 0,
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Selected-day body ─────────────────────────────────────
          Header row sits above a multi-column grid where each visible
          tab (Hitting / Pitching / Catching / Infield / Outfield /
          S&C — filtered by player positions) gets its own column.
          Mirrors the Daily Training day-grid: tab name + count chip
          on top of each column, then the category cards for that
          tab+day stacked vertically inside the column. */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: rem(13) }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Selected-day header — long-form date + drill count. */}
          <div style={{
            fontSize: rem(12), fontWeight: 700,
            color: 'var(--text-bright)',
            letterSpacing: '0.06em',
            paddingBottom: 4,
            borderBottom: '1px solid var(--border)',
          }}>
            {formatDateLong(selectedDate)}
            <span style={{
              fontSize: rem(10), color: 'var(--text-muted)', fontWeight: 600,
              marginLeft: 8, letterSpacing: '0.04em',
            }}>
              {selectedDrills.length} drill{selectedDrills.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Tab-grid body — one column per POPULATED tab (i.e. tabs
              with at least one drill on the selected day). Tabs with
              no scheduled work that day are hidden entirely so the
              grid only carries information-bearing columns. Uses
              `minmax(0, 1fr)` so columns can shrink narrower than
              their content (keeps long category names from
              overflowing the panel). */}
          {populatedTabs.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${populatedTabs.length}, minmax(0, 1fr))`,
            gap: 8,
            alignItems: 'start',
          }}>
            {populatedTabs.map(({ key: tabKey, label: tabLabel }) => {
              const tabDrills = selectedDrills.filter(d => d.tab === tabKey);
              const tabColor = TAB_COLORS[tabKey] || TAB_COLORS.hitting;

              /* Group this column's drills by category in canonical
                 order so Movement Prep sits on top, Live / Cool Down
                 / Post-Throw at the bottom (matches the Training
                 day-column ordering). */
              const groups = new Map<string, api.ScheduledDrill[]>();
              for (const d of tabDrills) {
                const cat = d.category || 'Other';
                const arr = groups.get(cat) ?? [];
                arr.push(d);
                groups.set(cat, arr);
              }
              const orderedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
                const cats = LEGEND_CATEGORIES[tabKey] || [];
                const ai = cats.indexOf(a);
                const bi = cats.indexOf(b);
                if (ai === -1 && bi === -1) return a.localeCompare(b);
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
              });

              return (
                <div
                  key={tabKey}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  {/* Column header — tab label CENTERED on the column
                      with the drill count chip pinned to the right via
                      absolute positioning so the title can sit
                      perfectly centered without being pushed off-axis
                      by the chip's width.

                      Per coach-spec `.upcomingTabHeader` renders this
                      row as a SOLID pill filled with the tab's accent
                      color (Hitting blue / Pitching orange / Catching
                      teal / …) with WHITE label text in BOTH themes —
                      the colored pill anchors each column and matches
                      the unified "filled pill + colored title +
                      colored divider" Upcoming Drills structure. */}
                  <div
                    className={styles.upcomingTabHeader}
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      paddingBottom: 4,
                      borderBottom: `1px solid ${tabColor.text}`,
                      ['--tab-accent' as any]: tabColor.text,
                    }}
                  >
                    <span
                      className={styles.upcomingTabHeaderTitle}
                      style={{
                        fontSize: rem(11), fontWeight: 700,
                        color: tabColor.text,
                        textTransform: 'uppercase',
                        letterSpacing: '0.10em',
                        textAlign: 'center',
                      }}
                    >
                      {tabLabel}
                    </span>
                    <span
                      className={styles.upcomingTabHeaderCount}
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: rem(9), fontWeight: 700,
                        background: tabColor.bg,
                        color: tabColor.text,
                        padding: '1px 6px',
                        borderRadius: 4,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {tabDrills.length}
                    </span>
                  </div>

                  {/* Column body — color-coded category cards (same
                      chrome the Training page uses). No empty-state
                      branch needed since `populatedTabs` already
                      guarantees this column has at least one drill. */}
                  {orderedGroups.map(([category, groupItems]) => {
                    const catStyle = getTabCatStyle(tabKey, category);
                    /* Per-tab anchor shades used to color every category
                       title in this column. Light theme uses the deeper
                       "core activity" shade (Hitting → Machine, Pitching
                       → Bullpen, …) so the titles read confidently
                       against the white card. Dark theme uses the
                       "Drills" tone (one step lighter) so the titles
                       contrast well against the dark panel without
                       fading into it. The hairline divider beneath each
                       title still steps through the per-category
                       gradient in both themes. */
                    const tabAnchor = TAB_ANCHOR_COLORS[tabKey] || catStyle.dot;
                    const tabAnchorDark = TAB_ANCHOR_COLORS_DARK[tabKey] || catStyle.dot;
                    return (
                      <div
                        key={category}
                        /* Surface the category dot color via a CSS
                           custom property so the theme-aware drill
                           card rule in PlayerSummaryTab.module.css
                           can blend it against transparent at
                           different percentages per theme — keeping
                           the dark-mode subtle tint while bumping
                           the light-mode tint so the blue / orange
                           / green / etc. category color actually
                           reads through on the off-white panel. */
                        className={styles.drillCard}
                        style={{
                          /* Both `--drill-cat-color` (solid dot color)
                             and `--drill-cat-bg` (the subtle rgba(...,
                             0.13) dark-theme tint) are surfaced as CSS
                             custom properties on the wrapper. The
                             `.drillCard` CSS class then picks the
                             right background per theme:
                               • dark mode → `var(--drill-cat-bg)`
                                  (subtle rgba tint).
                               • light mode → `color-mix` of the dot
                                  color at 75 %.
                             Background is set via CSS instead of inline
                             so the light-theme override actually wins
                             — inline styles otherwise beat the
                             `[data-theme="light"] .drillCard` rule.

                             `--drill-tab-anchor` carries the LIGHT-theme
                             per-tab anchor (Machine blue / Bullpen
                             orange / …) and `--drill-tab-anchor-dark`
                             carries the DARK-theme per-tab anchor
                             (Drills shade — one step lighter for dark-
                             panel contrast). Both are used for the
                             title text + count chip — see
                             PlayerSummaryTab.module.css. */
                          ['--drill-cat-color' as any]: catStyle.dot,
                          ['--drill-cat-bg' as any]: catStyle.bg,
                          ['--drill-tab-anchor' as any]: tabAnchor,
                          ['--drill-tab-anchor-dark' as any]: tabAnchorDark,
                          borderLeft: `3px solid ${catStyle.dot}`,
                          borderRadius: 6,
                          padding: '8px 10px 8px 12px',
                          minWidth: 0,
                        }}
                      >
                        {/* Category title CENTERED on the drill card
                            with the item-count chip pinned absolute-
                            right so the title stays perfectly centered
                            against the card width regardless of count
                            chip width.

                            Per coach-spec the drill card has NO tinted
                            background fill in either theme — the body
                            sits flush on the panel surface (panel grey
                            in dark, white in light). The title text +
                            count chip carry the per-TAB anchor shade
                            (`--drill-tab-anchor`) in both themes, and
                            the divider below uses the per-CATEGORY
                            shade (`--drill-cat-color`) so the lightest
                            → darkest gradient is preserved on the
                            divider line as a subtle category cue. */}
                        <div className={styles.drillCardHeader} style={{
                          position: 'relative',
                          display: 'flex', alignItems: 'baseline',
                          justifyContent: 'center', gap: 6,
                          marginBottom: 4,
                        }}>
                          <span style={{
                            /* Font + style matches the Pitching tab's
                               Break & Spin table column headers (the
                               "Pitch" / "Avg Velo" / "H-Break" / etc.
                               header row): Satoshi (`fontFamily:
                               inherit`), 9 px / weight 600, 0.05em
                               tracking, uppercase. Color = the parent
                               tab's accent in DARK theme; light theme
                               flips it to the per-category shade via
                               `--drill-cat-color`. */
                            fontFamily: 'inherit',
                            fontSize: rem(9),
                            fontWeight: 600,
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                            color: tabColor.text,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'center',
                          }}
                          className={styles.drillCardHeaderTitle}
                          >
                            {category}
                          </span>
                          <span style={{
                            position: 'absolute',
                            right: 0,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: rem(9), fontWeight: 700,
                            color: 'var(--text-muted)',
                            letterSpacing: '0.06em',
                          }}
                          className={styles.drillCardHeaderCount}
                          >
                            {groupItems.length}
                          </span>
                        </div>

                        {/* Divider between category title and drill
                            list — picks up the per-CATEGORY color via
                            `--drill-cat-color` in BOTH themes so the
                            Movement Prep → Live gradient still steps
                            visibly across the column even though every
                            title above uses the unified tab anchor
                            shade. */}
                        <div
                          aria-hidden="true"
                          className={styles.drillCardDivider}
                          style={{
                            height: 1,
                            marginBottom: 4,
                          }}
                        />

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {groupItems.map(d => (
                            /* Drill row — just the centered drill name.
                               Per-drill time stamps retired from this
                               panel per coach-spec; the Daily Training
                               page still shows full timestamps for
                               coaches who need the schedule grid. */
                            <div key={d.id} style={{
                              display: 'flex', alignItems: 'baseline',
                              justifyContent: 'center',
                              color: 'var(--text)',
                              padding: '2px 0',
                              minWidth: 0,
                            }}>
                              <span style={{
                                /* Font + style matches the Pitching tab's
                                   Break & Spin table column headers
                                   (the "Pitch" / "Avg Velo" / etc. header
                                   row): Satoshi (`fontFamily: inherit`),
                                   9 px / weight 600 / 0.05em tracking /
                                   uppercase. Color inherits from the
                                   parent flex container above. */
                                fontFamily: 'inherit',
                                fontSize: rem(9),
                                fontWeight: 600,
                                letterSpacing: '0.05em',
                                textTransform: 'uppercase',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textAlign: 'center',
                              }}>{d.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          )}

          {/* When the day has no scheduled drills at all, surface a
              friendly empty message in place of the grid so coaches
              aren't left guessing whether the data loaded. */}
          {selectedDrills.length === 0 && (
            <div style={{
              color: 'var(--text-muted)', fontSize: rem(13),
              fontStyle: 'italic',
              paddingTop: 4,
            }}>
              No drills scheduled for {formatDateLong(selectedDate)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   PlayerVideosPanel — gallery of every video uploaded for this athlete.
   Surfaces the existing api.getPlayerVideos endpoint that was being
   fetched but never rendered anywhere except the Coaching Library
   sub-tab. Click any thumbnail → opens the existing VideoPlayerModal
   which now has loading + error states for dead URLs.
   ═══════════════════════════════════════════ */
function PlayerVideosPanel({ playerId, reports }: { playerId: string; reports?: any[] }) {
  const [videos, setVideos] = useState<api.Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<api.Video | null>(null);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    setLoading(true);
    api.getPlayerVideos(playerId)
      .then(rows => {
        if (cancelled) return;
        // Newest-first; READY status only so we don't surface uploads
        // that are still processing (avoids the broken-video state).
        const ready = rows
          .filter(v => v.status === 'READY')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setVideos(ready);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setVideos([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [playerId]);

  return (
    /* Inner padding retired here — the parent `.panel` (1.4rem all
       around) already owns the bubble's top/side spacing, so the
       title sits at the Tool-Grades-canonical 22.4 px below the
       bubble's top edge instead of being inset twice. */
    <div>
      {/* Header now follows the shared Tool Grades rhythm via the
          PlayerSummary `.sectionTitle` rule: italic Brown-display
          title + full-width 1px accent line + 0.85rem gap before
          the first video tile. The "X on file" tally rides as a
          mono count chip on the right of the title row to mirror
          the Trends panels' count-chip pattern. */}
      <div className={styles.sectionTitle}>
        <h2 className={styles.panelTitle}>Videos</h2>
        {videos.length > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: rem(10.5), fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>{videos.length} on file</span>
        )}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: rem(13) }}>Loading…</div>
      ) : videos.length === 0 ? (
        <div style={{
          color: 'var(--text-muted)', fontSize: rem(13), fontStyle: 'italic',
        }}>
          No videos uploaded yet. Coaches can attach swing / pitching /
          defense videos via the Add Report button.
        </div>
      ) : (
        /* Per-category preview rows — one row per non-empty position
           bucket (Hitting / Pitching / Infield / Outfield / Catching /
           S & C), each showing the last 5 videos in that bucket.
           Replaces the previous unified scroll-gallery that mixed
           every category together. Each row renders via VideoBundleCard
           (so multi-angle Training clips collapse to a single tile +
           count badge) and bundles videos before slicing so a bundle
           counts as one of the five surfaced. */
        (() => {
          const CATEGORY_BUCKETS: { key: string; label: string; matches: (cat: string) => boolean }[] = [
            { key: 'HITTING',  label: 'Hitting',  matches: (c) => c === 'HITTING' },
            { key: 'PITCHING', label: 'Pitching', matches: (c) => c === 'PITCHING' },
            { key: 'INFIELD',  label: 'Infield',  matches: (c) => c === 'INFIELD' || c === 'FIELDING' },
            { key: 'OUTFIELD', label: 'Outfield', matches: (c) => c === 'OUTFIELD' },
            { key: 'CATCHING', label: 'Catching', matches: (c) => c === 'CATCHING' },
            { key: 'STRENGTH', label: 'S & C',    matches: (c) => c === 'WORKOUT_DEMO' || c === 'STRENGTH' },
          ];
          const rows = CATEGORY_BUCKETS.map((bucket) => {
            const bucketVideos = videos.filter((v) => bucket.matches((v.category || '').toUpperCase()));
            if (bucketVideos.length === 0) return null;
            /* Bundle BEFORE slicing so a multi-angle Training clip
               counts as one of the five rather than each angle
               eating a slot. The bundleVideos helper preserves the
               input order; `videos` is already sorted newest-first
               above, so the resulting bundles are newest-first too. */
            const bundles = bundleVideos(bucketVideos).slice(0, 5);
            return { bucket, bundles };
          /* Use `NonNullable<typeof r>` instead of re-stating the
             returned shape — the previous explicit type tried to
             use `ReturnType<typeof bundleVideos>` which resolved to
             `VideoBundle<api.Video>[]` while the actual data is
             `VideoBundle<GalleryVideo>[]` (since `videos` is the
             gallery-shape array, not the API shape). That mismatch
             made the predicate fail TS strict checking even though
             the runtime cast was fine. NonNullable just strips the
             `| null` from the union, preserving the original shape. */
          }).filter((r): r is NonNullable<typeof r> => r !== null);

          if (rows.length === 0) {
            return (
              <div style={{
                color: 'var(--text-muted)', fontSize: rem(13), fontStyle: 'italic',
              }}>
                No videos uploaded yet.
              </div>
            );
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {rows.map(({ bucket, bundles }) => (
                <div key={bucket.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Category eyebrow — uppercase Brown-display label
                      matching the page's other section title rhythm,
                      with the count chip on the right showing how
                      many clips this bucket contains in total (not
                      just the visible five). */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}>
                    <div style={{
                      fontSize: rem(11.5), fontWeight: 700,
                      letterSpacing: '0.16em', textTransform: 'uppercase',
                      color: 'var(--text-bright)',
                    }}>
                      {bucket.label}
                    </div>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: rem(10), fontWeight: 700,
                      letterSpacing: '0.14em', textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}>
                      {videos.filter((v) => bucket.matches((v.category || '').toUpperCase())).length} on file
                    </span>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                    gap: 12,
                  }}>
                    {bundles.map((b) => {
                      const cardVideos = b.videos.map((v) => ({
                        id: v.id,
                        title: v.title,
                        category: v.category,
                        createdAt: v.createdAt,
                        originalUrl: v.hlsUrl || v.originalUrl,
                      }));
                      return (
                        <VideoBundleCard
                          key={b.key}
                          videos={cardVideos}
                          size="md"
                          playerId={playerId}
                          recordingCategory={b.videos[0].category}
                          /* Forward the athlete's full report list so the
                             bundle modal's Record-and-save flow surfaces
                             the "Attach to Report" dropdown here too —
                             every per-tab Coach Reviews / Videos bubble
                             across the app gets the same UX so coaches
                             can attach a recorded review to a report
                             regardless of which gallery they opened the
                             bundle from. */
                          reports={reports}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()
      )}
      {active && (active.originalUrl || active.hlsUrl) && (
        <VideoPlayerModal
          videoUrl={(active.hlsUrl || active.originalUrl) as string}
          title={active.title}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════
   TRENDS SECTION
   Position-aware grid of growth-trend mini-charts. Renders one card
   per metric the athlete has data for, gated by the player's
   positions:
     • Default (always)  — Exit Velocity, Bat Speed, Distance, Barrel %,
                           Attack Angle, Plane Angle, Time to Contact,
                           60 Yard Dash
     • Catcher           — Pop Time, Exchange Time, Defensive Velocity
     • Infielder         — Defensive Velocity (infield_velo)
     • Outfielder        — Defensive Velocity (outfield_velo)
     • Pitcher           — Pitch Velocities + Breaks per pitch type +
                           Running averages for extension, release side,
                           release height
   Each card uses the same `TrendChart` line component as the existing
   Metric Trend panel, sized down for the grid.
   ═══════════════════════════════════════════════════════════════════ */

interface TrendCardSpec {
  key: string;
  label: string;
  unit: string;
  accent: string;
}

interface TrendSubgroup {
  /** Sub-section label inside a category (e.g. each pitch type
   *  inside the Pitching bubble). */
  label: string;
  cards: TrendCardSpec[];
}

interface TrendCategory {
  /** Section label (e.g. "Hitting", "Pitching", "Catching") shown at
   *  the top of the dark-navy bubble that wraps this category's
   *  metric cards. */
  label: string;
  /** Per-category accent color used on the metric cards inside this
   *  category — line color in the trend chart + latest-reading badge
   *  text. */
  accent: string;
  /** Flat list of cards — used when the category has no internal
   *  grouping (Hitting / Catching / Infield / Outfield / Athletic). */
  cards?: TrendCardSpec[];
  /** Grouped layout — used for Pitching where each pitch type gets
   *  its own labeled sub-row inside the category bubble, each row
   *  containing the 4 per-pitch metrics (Max Velo / Avg Velo / Avg
   *  Spin / Avg IVB-HB). */
  subgroups?: TrendSubgroup[];
}

/** Builds an ORDERED list of trend categories relevant to this
 *  player. Each category becomes its own dark-navy bubble in the
 *  TrendsSection; inside that bubble, the individual metric cards
 *  (one per `TrendCardSpec`) live as dark-grey inner cards. */
function getTrendCategoriesForPlayer(
  player: { positions?: string | null },
  progressData: Record<string, { value: number; recordedAt: string }[]>,
): TrendCategory[] {
  const positions = (player.positions || '')
    .split(',').map((p) => p.trim()).filter(Boolean);
  const INF_CODES = ['1B', '2B', '3B', 'SS', 'INF'];
  const OF_CODES  = ['LF', 'CF', 'RF', 'OF'];
  const isCatcher    = positions.includes('C');
  const isInfielder  = positions.some((p) => INF_CODES.includes(p));
  const isOutfielder = positions.some((p) => OF_CODES.includes(p));
  const isPitcher    = positions.includes('P');

  const categories: TrendCategory[] = [];

  /* ── Hitting (always, every athlete) ──
     Barrel % and Time to Contact retired from this list per the
     latest spec; Squared Up % remains as the new addition. */
  categories.push({
    label: 'Hitting',
    accent: '#3B82F6',
    cards: [
      { key: 'max_exit_velo',      label: 'Max Exit Velocity', unit: 'mph', accent: '#3B82F6' },
      { key: 'avg_exit_velo',      label: 'Avg Exit Velocity', unit: 'mph', accent: '#3B82F6' },
      { key: 'max_bat_speed',      label: 'Max Bat Speed',     unit: 'mph', accent: '#3B82F6' },
      { key: 'bat_speed',          label: 'Bat Speed',         unit: 'mph', accent: '#3B82F6' },
      { key: 'distance',           label: 'Distance',          unit: 'ft',  accent: '#3B82F6' },
      { key: 'squared_up_pct',     label: 'Squared Up %',      unit: '%',   accent: '#3B82F6' },
      { key: 'attack_angle',       label: 'Attack Angle',      unit: '°',   accent: '#3B82F6' },
      { key: 'plane_angle',        label: 'Plane Angle',       unit: '°',   accent: '#3B82F6' },
    ],
  });

  /* ── Pitching (pitcher only) — ROW PER PITCH TYPE.
     Each pitch type gets its own subgroup (Fastball, Sinker, Cutter,
     Slider, Curveball, ChangeUp, Sweeper, Splitter), and inside that
     subgroup the 4 standard charts: Max Velo, Avg Velo, Avg Spin,
     Avg IVB/HB. */
  if (isPitcher) {
    /* Trackman's parser emits aggregate keys (fb_max_velo, spin_rate,
       h_break, v_break …) rather than per-pitch-type keys, so the trend
       cards track those directly — one point per report. */
    categories.push({
      label: 'Pitching',
      accent: '#F59E0B',
      cards: [
        { key: 'fb_max_velo', label: 'Fastball Max Velo', unit: 'mph', accent: '#F59E0B' },
        { key: 'fb_avg_velo', label: 'Fastball Avg Velo', unit: 'mph', accent: '#F59E0B' },
        { key: 'spin_rate',   label: 'Spin Rate',         unit: 'rpm', accent: '#F59E0B' },
        { key: 'h_break',     label: 'Horizontal Break',  unit: 'in',  accent: '#F59E0B' },
        { key: 'v_break',     label: 'Vertical Break',    unit: 'in',  accent: '#F59E0B' },
      ],
    });
  }

  /* ── Catching (catcher only) ── */
  if (isCatcher) {
    categories.push({
      label: 'Catching',
      accent: '#22C55E',
      cards: [
        { key: 'catcher_velo',  label: 'Catcher Velocity', unit: 'mph', accent: '#22C55E' },
        { key: 'pop_time',      label: 'Pop Time',         unit: 's',   accent: '#22C55E' },
        { key: 'exchange_time', label: 'Exchange Time',    unit: 's',   accent: '#22C55E' },
      ],
    });
  }

  /* ── Infield (infielder only) ── */
  if (isInfielder) {
    categories.push({
      label: 'Infield',
      accent: '#22C55E',
      cards: [
        { key: 'infield_velo', label: 'Infield Velocity', unit: 'mph', accent: '#22C55E' },
        { key: 'sprint_60',    label: '60-yard Dash',     unit: 's',   accent: '#22C55E' },
        { key: 'sprint_10',    label: '10 Yard Sprint',   unit: 's',   accent: '#22C55E' },
      ],
    });
  }

  /* ── Outfield (outfielder only) ── */
  if (isOutfielder) {
    categories.push({
      label: 'Outfield',
      accent: '#22C55E',
      cards: [
        { key: 'outfield_velo', label: 'Outfield Velocity', unit: 'mph', accent: '#22C55E' },
        { key: 'sprint_60',     label: '60-yard Dash',      unit: 's',   accent: '#22C55E' },
        { key: 'sprint_10',     label: '10 Yard Sprint',    unit: 's',   accent: '#22C55E' },
      ],
    });
  }

  /* Density filter retired — every category, every subgroup, and
     every card is now shown regardless of whether the underlying
     metric has any history yet. Cards with no data render their
     TrendChart in an empty state with a "—" latest reading, so the
     full structure (new metrics like Squared Up %, Avg Spin, Avg
     IVB/HB, Acceleration) is visible immediately even before the
     CSV / Trackman pipelines start emitting those keys. The previous
     filter was hiding all the newly-added cards because they don't
     have data yet. */
  return categories;
}

function TrendsSection({
  player,
  progressData,
  topMetrics,
}: {
  player: { positions?: string | null };
  progressData: Record<string, { value: number; recordedAt: string }[]>;
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>;
}) {
  const categories = useMemo(
    () => getTrendCategoriesForPlayer(player, progressData),
    [player, progressData],
  );

  if (categories.length === 0) {
    return (
      <div style={{
        padding: '32px 24px',
        background:
          'radial-gradient(ellipse at 50% 35%, rgba(255,255,255,0.04) 0%, transparent 60%), rgba(10, 14, 20, 0.38)',
        border: '1px solid var(--border-light)',
        borderRadius: 14,
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: rem(13),
      }}>
        No growth history available yet. Trends fill in as CSV uploads + assessment
        reports accumulate over time.
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      /* Gap tightened 18 → 12 to compensate for the removed
         "Growth trends" eyebrow inside each panel — each bubble is
         now slightly less tall, so a smaller between-bubble gap
         keeps the overall Trends list visually balanced. */
      gap: 12,
    }}>
      {categories.map((cat) => (
        <section
          key={cat.label}
          /* `.panel` is the shared dark-navy bubble chrome already
             used by every other panel on the Player Summary tab
             (Tool Grades, Sub-Grade Breakdown, Sub-Grade Compare,
             Metric Trend, Upcoming Drills, Player Videos). Reusing
             the class keeps the Trends view visually identical to the
             rest of the Current Grades view it shares the page with. */
          className={styles.panel}
        >
          {/* Category header — italic display title (`.panelTitle`)
              matches every other section header on the Player Summary
              page. A small mono count chip sits on the right. The
              "Growth trends" eyebrow under the title was retired —
              the category title alone reads clearly. */}
          <div className={styles.sectionTitle}>
            <div>
              <h2 className={styles.panelTitle}>{cat.label}</h2>
            </div>
            {(() => {
              /* Count chip — sums flat cards or every subgroup's cards
                 depending on which layout this category uses. */
              const count = cat.subgroups
                ? cat.subgroups.reduce((n, sg) => n + sg.cards.length, 0)
                : (cat.cards?.length ?? 0);
              return (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: rem(10.5), fontWeight: 700,
                  letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}>
                  {count} metric{count === 1 ? '' : 's'}
                </span>
              );
            })()}
          </div>

          {/* Either a single grid of cards (Hitting / Catching /
              Infield / Outfield) OR a stack of labeled subgroups —
              each subgroup is one pitch type, rendered as its own
              row of 4 cards (Max Velo / Avg Velo / Avg Spin / Avg
              IVB-HB). */}
          {cat.subgroups ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {cat.subgroups.map((sg) => (
                <div key={sg.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Subgroup label — pitch type name + faint hairline */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      fontSize: rem(11.5), fontWeight: 800,
                      letterSpacing: '0.16em', textTransform: 'uppercase',
                      color: 'var(--text-bright)',
                    }}>
                      {sg.label}
                    </span>
                    <span style={{
                      flex: 1, height: 1,
                      background: `linear-gradient(90deg, ${cat.accent}40, transparent)`,
                    }} />
                  </div>
                  {/* Always 4 columns inside a subgroup so each pitch
                      type's row reads as Max Velo · Avg Velo · Avg
                      Spin · Avg IVB-HB across the bubble width. */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 10,
                  }}>
                    {sg.cards.map((c) => (
                      <TrendMetricCard
                        key={c.key}
                        spec={c}
                        points={buildTrendPoints(progressData[c.key])}
                        latest={topMetrics[c.key]}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12,
            }}>
              {(cat.cards ?? []).map((c) => (
                <TrendMetricCard
                  key={c.key}
                  spec={c}
                  points={buildTrendPoints(progressData[c.key])}
                  latest={topMetrics[c.key]}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/** A single dark-grey metric card with its label, latest reading, and
 *  a mini TrendChart. Extracted so both the flat-grid and
 *  subgroup-row layouts can reuse the same card chrome. */
function TrendMetricCard({
  spec,
  points,
  latest,
}: {
  spec: TrendCardSpec;
  points: TrendPoint[];
  latest: { value: number; unit: string; recordedAt: string } | undefined;
}) {
  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 8,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        paddingBottom: 5,
      }}>
        <span style={{
          fontSize: rem(11), fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'var(--text-bright)',
          overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {spec.label}
        </span>
        <span style={{
          fontSize: rem(13.5), fontWeight: 800, color: spec.accent,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          {latest ? latest.value.toFixed(1) : '—'}
          {' '}
          <span style={{
            fontSize: rem(10), fontWeight: 500, color: 'var(--text-muted)',
          }}>{spec.unit}</span>
        </span>
      </div>
      <div style={{ height: 110 }}>
        <TrendChart
          data={points}
          unit={spec.unit}
          accent={spec.accent}
        />
      </div>
    </div>
  );
}

export function PlayerSummaryTab({
  player, topMetrics, reports, progressData, isCoach, onNewReport, onEditReport, onEditProfile, onRefresh,
  onCaptureSummaryPdf, onOpenVideos, visibleTabKeys,
}: TabProps & {
  /** Provided by the parent profile page. Triggers the capture-based
   *  Player Summary PDF flow (Title Page + Tool Grades + Hitting /
   *  Infield / Catching / Outfield snapshots + Pitch Report,
   *  each populated from direct screenshots of the live in-app
   *  sections rather than from a re-rendered PDF template). */
  onCaptureSummaryPdf?: () => Promise<void>;
  /** Tab keys currently surfaced in the profile tab bar (e.g.
   *  ['summary', 'hitting', 'pitching']). Used by the Tool Grades
   *  panel below to filter `aggregate.sections` so only the tabs
   *  the coach actually sees at the top populate as cards. When
   *  omitted, all aggregate sections render (backwards-compat for
   *  any caller that hasn't been updated). */
  visibleTabKeys?: readonly string[];
}) {
  const [selectedReport, setSelectedReport] = useState<import('../helpers').ReportSummary | null>(null);
  /* Summary-page sub-tab: "Current Grades" (the existing dashboard
     content) or "Trends" (a position-aware grid of growth-trend
     mini-charts). The two tabs render in a dark-navy bar at the top
     of the page matching the Tool Grades panel's chrome. */
  const [summarySubTab, setSummarySubTab] = useState<'current' | 'trends'>('current');
  /* Live At-Bats for this athlete — feeds the Hitting → Swing
     Decision Tool Grades bar via `computeAggregateScores`'s fourth
     argument. Fetched here in addition to the parent profile page so
     the Player Summary tab keeps its own up-to-date data when
     mounted directly (e.g. PDF builder previews) and doesn't depend
     on the parent's at-bat fetch having completed. */
  const [liveAtBats, setLiveAtBats] = useState<api.AtBatDetail[]>([]);
  useEffect(() => {
    if (!player?.id) return;
    let cancelled = false;
    api.listAtBats({ hitterId: player.id, limit: 500 })
      .then((rows) => { if (!cancelled) setLiveAtBats(rows); })
      .catch(() => { if (!cancelled) setLiveAtBats([]); });
    return () => { cancelled = true; };
  }, [player?.id]);
  const aggregate = useMemo(
    () => computeAggregateScores(player, reports, topMetrics, liveAtBats),
    [player, reports, topMetrics, liveAtBats],
  );

  /* ── Trackman pitch history for the Metric Trend per-pitch-type
        options. Pulled once per player and rolled up into synthetic
        progressData entries keyed by `<pitchTypePrefix>_<metric>`
        (e.g. `fastball_max_velo`, `slider_avg_velo`) so the Metric
        Trend dropdown can chart them without backend changes. */
  const [pitchHistory, setPitchHistory] = useState<api.TrackmanPitch[]>([]);
  useEffect(() => {
    if (!player?.id) return;
    let cancelled = false;
    api.getTrackmanPitches(player.id)
      .then((rows) => { if (!cancelled) setPitchHistory(rows); })
      .catch(() => { if (!cancelled) setPitchHistory([]); });
    return () => { cancelled = true; };
  }, [player?.id]);

  const pitchProgressData = useMemo(() => {
    if (pitchHistory.length === 0) return {} as Record<string, { value: number; recordedAt: string }[]>;
    /** TrackmanPitch.pitchType → key prefix used by TREND_DOMAINS. */
    const TYPE_TO_PREFIX: Record<string, string> = {
      Fastball:  'fastball',
      Sinker:    'sinker',
      Cutter:    'cutter',
      Slider:    'slider',
      Sweeper:   'sweeper',
      Curveball: 'curveball',
      ChangeUp:  'changeup',
      Splitter:  'splitter',
    };
    /* Bucket pitches by (pitch type, calendar day). For each bucket
       compute Max Velo, Avg Velo, Avg H-Break, Avg IVB, Avg Spin Rate.
       Spin Efficiency isn't on TrackmanPitch (no gyro angle / active
       spin field) so it stays empty until the backend provides it. */
    type DayBucket = {
      relSpeeds: number[];
      hBreaks: number[];
      ivbs: number[];
      spins: number[];
      day: string;
    };
    const byTypeDay = new Map<string, Map<string, DayBucket>>();
    for (const p of pitchHistory) {
      const prefix = TYPE_TO_PREFIX[p.pitchType];
      if (!prefix) continue;
      const day = (p.recordedAt || '').slice(0, 10);
      if (!day) continue;
      let dayMap = byTypeDay.get(prefix);
      if (!dayMap) { dayMap = new Map(); byTypeDay.set(prefix, dayMap); }
      let b = dayMap.get(day);
      if (!b) { b = { relSpeeds: [], hBreaks: [], ivbs: [], spins: [], day }; dayMap.set(day, b); }
      if (p.relSpeed != null) b.relSpeeds.push(p.relSpeed);
      if (p.horzBreak != null) b.hBreaks.push(p.horzBreak);
      if (p.inducedVertBreak != null) b.ivbs.push(p.inducedVertBreak);
      if (p.spinRate != null) b.spins.push(p.spinRate);
    }
    const avg = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;
    const out: Record<string, { value: number; recordedAt: string }[]> = {};
    byTypeDay.forEach((dayMap, prefix) => {
      const days = [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day));
      const max = (k: keyof DayBucket, days: DayBucket[]) =>
        days.flatMap((d) => Array.isArray(d[k]) ? (d[k] as number[]) : []);
      // Per-day max velo (best pitch that day)
      out[`${prefix}_max_velo`] = days.flatMap((d) => d.relSpeeds.length > 0
        ? [{ value: Math.max(...d.relSpeeds), recordedAt: d.day + 'T00:00:00.000Z' }]
        : []);
      out[`${prefix}_avg_velo`] = days.flatMap((d) => d.relSpeeds.length > 0
        ? [{ value: +avg(d.relSpeeds).toFixed(1), recordedAt: d.day + 'T00:00:00.000Z' }]
        : []);
      out[`${prefix}_h_break`] = days.flatMap((d) => d.hBreaks.length > 0
        ? [{ value: +avg(d.hBreaks).toFixed(1), recordedAt: d.day + 'T00:00:00.000Z' }]
        : []);
      out[`${prefix}_ivb`] = days.flatMap((d) => d.ivbs.length > 0
        ? [{ value: +avg(d.ivbs).toFixed(1), recordedAt: d.day + 'T00:00:00.000Z' }]
        : []);
      out[`${prefix}_spin`] = days.flatMap((d) => d.spins.length > 0
        ? [{ value: Math.round(avg(d.spins)), recordedAt: d.day + 'T00:00:00.000Z' }]
        : []);
      // Drop empty arrays (populated filter expects at least 1 entry)
      void max; // silence unused-var if Prettier strips the helper
    });
    Object.keys(out).forEach((k) => { if (out[k].length === 0) delete out[k]; });
    return out;
  }, [pitchHistory]);

  /* Merge backend-served progress data with the synthetic per-pitch-type
     rollups so Metric Trend's `populated` filter sees both sources. */
  const mergedProgressData = useMemo(() => ({
    ...progressData,
    ...pitchProgressData,
  }), [progressData, pitchProgressData]);

  const insights = useMemo(
    () => buildInsights(aggregate.sections, aggregate.overall),
    [aggregate],
  );

  /* ── Development snapshot — Next Steps notes per Tool Grades section ──
     Persisted as a JSON map at player.developmentNotes (key = aggregate
     section key, value = coach-entered free text). Local edit copy starts
     from the saved map and falls back to the latest persisted value when
     the player record refreshes. */
  const persistedDevNotes = useMemo(
    () => parseDevelopmentNotes((player as any).developmentNotes),
    [player],
  );
  const [devNotes, setDevNotes] = useState<Record<string, string>>(persistedDevNotes);
  useEffect(() => { setDevNotes(persistedDevNotes); }, [persistedDevNotes]);
  const devDirty = useMemo(() => {
    const allKeys = new Set([...Object.keys(persistedDevNotes), ...Object.keys(devNotes)]);
    for (const k of allKeys) {
      if ((persistedDevNotes[k] ?? '') !== (devNotes[k] ?? '')) return true;
    }
    return false;
  }, [persistedDevNotes, devNotes]);
  const [savingDev, setSavingDev] = useState(false);
  const [devSaveOk, setDevSaveOk] = useState(false);
  const [devSaveError, setDevSaveError] = useState<string | null>(null);

  /* Sub-grade compare panel — pick which non-physical domain to render
     alongside Physical bars. The dropdown only offers domains the player
     actually carries (i.e. has a Tool Grades section for), so a Pitcher
     only sees "Physical vs Pitching", a Catcher sees "Physical vs Hitting"
     + "Physical vs Catching", an Infielder sees Hitting + Infield, etc. */
  const availableCompareOptions = useMemo<{ key: CompareDomain; label: string }[]>(() => {
    const present = new Set(
      aggregate.sections.map((s) => s.key).filter((k) => k !== 'strength'),
    );
    return DOMAIN_ORDER
      .filter((d) => present.has(d))
      .map((d) => ({ key: d, label: DOMAIN_LABELS[d] }));
  }, [aggregate.sections]);
  const [compareDomain, setCompareDomain] = useState<CompareDomain>(
    () => (availableCompareOptions[0]?.key ?? 'hitting'),
  );
  /* Auto-snap the selection to a domain that's actually present whenever
     positions change (e.g. coach edits the player profile). Avoids leaving
     the dropdown showing "Hitting" for a pitcher-only player. */
  useEffect(() => {
    if (availableCompareOptions.length === 0) return;
    if (!availableCompareOptions.some((o) => o.key === compareDomain)) {
      setCompareDomain(availableCompareOptions[0].key);
    }
  }, [availableCompareOptions, compareDomain]);

  /* Cross-card sync for the Development snapshot's "Next Steps" textareas.
     The user drags ONE card's resize handle freely (no live broadcast,
     which caused layout jitter). On mouse-up the final height is snapped
     to every sibling so the row ends up at the same height. Scroll
     position is mirrored live so the four panes track together. */
  const notesRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const isSyncingRef = useRef(false);

  const registerNotes = useCallback((key: string, el: HTMLTextAreaElement | null) => {
    if (!el) {
      notesRefs.current.delete(key);
    } else {
      notesRefs.current.set(key, el);
    }
  }, []);

  /** Snap every other notes textarea to match the source's current height —
   *  fired on mouse-up after a manual resize so the row aligns without
   *  the per-frame glitching a live ResizeObserver caused. */
  const syncNotesHeight = useCallback((sourceKey: string) => {
    const source = notesRefs.current.get(sourceKey);
    if (!source) return;
    const h = source.style.height || `${source.clientHeight}px`;
    notesRefs.current.forEach((el, key) => {
      if (key === sourceKey || !el) return;
      el.style.height = h;
    });
  }, []);

  const onNotesScroll = useCallback((sourceKey: string, scrollTop: number) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    notesRefs.current.forEach((el, key) => {
      if (key === sourceKey || !el) return;
      if (el.scrollTop !== scrollTop) el.scrollTop = scrollTop;
    });
    requestAnimationFrame(() => { isSyncingRef.current = false; });
  }, []);

  async function saveDevNotes() {
    setSavingDev(true);
    setDevSaveError(null);
    setDevSaveOk(false);
    try {
      // Strip empty entries so an unset section drops out of the JSON.
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(devNotes)) {
        if (v && v.trim().length > 0) cleaned[k] = v;
      }
      await api.updatePlayer(player.id, { developmentNotes: JSON.stringify(cleaned) } as any);
      setDevSaveOk(true);
      onRefresh?.();
    } catch (e) {
      setDevSaveError((e as Error).message || 'Save failed');
    } finally {
      setSavingDev(false);
      setTimeout(() => setDevSaveOk(false), 2200);
    }
  }


  /* Detail-card selection retired — the "Sub-Grade Breakdown" panel
     that consumed `selectedKey` / `selectedSection` / `selectedAvg`
     was removed from the hero stack per spec, so the click-to-select
     state went with it. The Tool Grades cards now render flat (no
     active highlight) since there's nothing to swap into. */

  // (The static "richest available metric" trend lookup was retired —
  // MetricTrendPanel below renders progressData directly with its own
  // dropdown for metric selection.)

  return (
    <div className={styles.root}>
      {/* ── Tab actions: Reports dropdown (per-report download, with "+ Report"
          as the first dropdown row) ── */}
      <TabBarActions>
        {/* "+ Add Report" button retired — it now lives as the first
            row inside the ReportSelector dropdown below. */}
        {/* Edit Profile is available to coaches AND players (was non-coach
            only) so coaches can edit player info from the reports tab. */}
        <EditProfileButton onClick={onEditProfile} show />
        {/* Top-level Download PDF — assembles the Player Summary PDF
            via DIRECT screenshots of the live in-app sections:
              1. Title Page (cover)
              2. Tool Grades       (captured from THIS tab)
              3. Hitting Snapshot  (captured from the Hitting tab)
              4. Infield Snapshot  (captured from the Infield tab)
              5. Catching Snapshot (captured from the Catching tab)
              6. Outfield Snapshot (captured from the Outfield tab)
              7. Pitch Report      (captured from the Pitching tab)
            Driven by `onCaptureSummaryPdf` which lives on the parent
            page so it can switch `activeTab` between renders. Sections
            without a live DOM marker for this player are skipped
            silently. Disabled when the parent didn't pass a handler. */}
        <DownloadPdfButton
          onDownload={onCaptureSummaryPdf ?? (async () => { /* no-op */ })}
          disabled={!onCaptureSummaryPdf}
        />
        {/* Videos jump — next to Download PDF, replaces standalone tab. */}
        <VideosIconButton onClick={onOpenVideos} />
        {/* Player Summary report selector now behaves identically to the
            per-position tabs (Hitting / Pitching / Defense / S&C):
            clicking the title text opens the selected report in the
            ReportModal for editing via `onEdit`. The previous
            `rangeOnly` configuration limited the dropdown to a date-
            range picker only — clicking the title did nothing useful.
            `lockLabel` keeps the bar text pinned to "Player Summary"
            (instead of letting it swap to the selected report's
            title) since this tab is the overall summary view, not a
            single report. The meta line beneath still reflects the
            selected report so the coach can tell which one is active.
            `reportTypes={[]}` keeps the selector type-agnostic so
            EVERY report on the player is offered (Hitting + Pitching
            + Defense + S&C all show up in the dropdown).
            `preferredTypes={['HITTING','PITCHING']}` tells the auto-
            select to pick the latest HITTING report first (so a
            two-way player lands on hitting on first paint) and fall
            through to the latest PITCHING report when no hitting
            report exists (so a pitcher-only player still lands on a
            real report instead of e.g. an S&C entry). When neither
            type exists the selector falls all the way through to the
            global newest report. */}
        <ReportSelector
          reports={reports}
          reportTypes={[]}
          label="Player Summary"
          lockLabel
          preferredTypes={['HITTING', 'PITCHING']}
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateSummaryPdf(player, [r], topMetrics)}
        />
      </TabBarActions>

      {/* ══════════ SUMMARY SUB-TABS ══════════
          Top-of-page tab bar between "Current Grades" (the existing
          dashboard view) and "Trends" (a position-aware grid of
          growth-trend mini-charts). Chrome matches the Tool Grades
          panel: dark navy + radial highlight + soft white-rim
          border, accent-blue underline on the active tab.

          Lives on `.subTabBar` (defined in PlayerSummaryTab.module
          .css) so the light-theme override below can flip the
          background to `--panel-bg-light` in lockstep with the
          rest of the bubble system. Inline-styled originally; the
          inline style couldn't be overridden via CSS so it stayed
          dark-navy on light mode. */}
      <div className={styles.subTabBar}>
        {[
          { key: 'current' as const, label: 'Current Grades' },
          { key: 'trends'  as const, label: 'Trends' },
        ].map((t) => {
          const active = summarySubTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSummarySubTab(t.key)}
              style={{
                /* Same chrome model as the global Player Summary
                   TabBar (`.tabBtn` / `.tabActive`) and the Hitting
                   Snapshot's Swing / Swing Decision toggle: muted
                   inactive color, bright white active color, white-
                   gradient-with-glow underline pinned to the bottom.
                   Typography matches `.panelTitle` (the "Tool Grades"
                   header style) — italic display font, 23px, weight
                   600 — so these sub-tab labels read in the same
                   voice as the section titles below them. */
                flex: 1,
                position: 'relative',
                padding: '10px 16px',
                background: 'transparent',
                border: 'none',
                borderRadius: 10,
                color: active ? 'var(--text)' : 'var(--text-muted)',
                fontFamily: 'var(--font-display)',
                /* Trimmed 23 → 13.8 (a 40% reduction) so the
                   sub-tab labels sit as understated nav elements
                   rather than competing with the section titles
                   (`.panelTitle`) below at 23px. Same italic display
                   voice, just smaller. */
                fontSize: rem(13.8),
                fontWeight: 600,
                fontStyle: 'italic',
                letterSpacing: '-0.025em',
                lineHeight: 1.05,
                textTransform: 'none',
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              }}
            >
              {t.label}
              {/* Active underline — fade-in/fade-out gradient whose
                  center color uses `var(--tool-grades-line)` so the
                  underline reads at the SAME color as the Tool
                  Grades title hairline (white 23 % in dark theme,
                  black 18 % in light theme). The transparent ends
                  preserve the soft-edge bar look the design had
                  with the original hardcoded white gradient. */}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: 2,
                  height: 2,
                  borderRadius: '2px 2px 0 0',
                  background: active
                    ? 'linear-gradient(90deg, transparent, var(--tool-grades-line) 50%, transparent)'
                    : 'transparent',
                  boxShadow: active ? '0 0 12px rgba(255,255,255,0.5)' : 'none',
                  transition: 'background 0.15s ease, box-shadow 0.15s ease',
                }}
              />
            </button>
          );
        })}
      </div>

      {summarySubTab === 'trends' ? (
        <TrendsSection
          player={player}
          progressData={mergedProgressData}
          topMetrics={topMetrics}
        />
      ) : (
      <>

      {/* ══════════ HERO ══════════ */}
      <section className={styles.hero}>
        {/* Development Snapshot section retired — Tool Grades now leads
            the hero stack. */}

        {/* Left: condensed tool grades bubble — compact multi-row bar graph.
            `data-pdf-section` marker lets the Player Summary "Download PDF"
            handler find this exact DOM node and capture it as an image
            via html2canvas, then embed the screenshot in the assembled PDF. */}
        <div data-pdf-section="tool-grades" className={`${styles.panel} ${styles.toolBubble}`}>
          <div className={styles.toolBubbleHead}>
            <div>
              {/* Uppercase casing now lives on the shared
                  `.panelTitle` rule itself, so this h2 inherits it
                  the same way Sub-Grade Breakdown / Upcoming Drills /
                  Videos / every per-category video header do. The
                  earlier inline style override is gone. */}
              <h2 className={styles.panelTitle}>Tool Grades</h2>
            </div>
            {/* Title-midline hairline — same rhythm the Pitch Report
                and every SectionHeader-driven bubble use: a 1 px
                accent line that runs from immediately after the
                title block to just before the "20-80 Scale" legend
                on the right, vertically centered on the title's
                mid-line via `align-self: flex-end` + `marginBottom`
                ≈ half the 23 px title height. */}
            <div
              aria-hidden="true"
              style={{
                flex: 1,
                height: 1,
                /* 50% darker than the standard `var(--border)` — see
                   `--tool-grades-line` in globals.css. Applied only
                   to the two Tool Grades accent lines (this inline
                   hairline + `.toolBubbleHead` border-bottom). */
                background: 'var(--tool-grades-line)',
                alignSelf: 'flex-end',
                marginBottom: 12,
              }}
            />
            <div className={styles.legendInline}>
              <span>20-80 Scale</span>
            </div>
          </div>
          {/* Each section renders as an upright bar-chart card:
              total score on top, section label, then a row of vertical
              bars — one per underlying sub-grade. The card lineup is
              now filtered by `visibleTabKeys` so Tool Grades only
              populates the sections whose tabs actually appear at the
              top of the profile (position-aware + Eye-toggle-aware).
              A hitter who hid the Catching / Infield / Outfield / S&C
              tabs via the Eye toggle in the Report modal will see ONLY
              the Hitting card here. When `visibleTabKeys` is absent
              (legacy caller), the full section list renders as before. */}
          {(() => {
            const visibleSections = aggregate.sections.filter(
              (s) => !visibleTabKeys || visibleTabKeys.includes(s.key),
            );
            return (
          <div
            className={styles.toolGraphGrid}
            /* Force the cards to fill the entire Tool Grades bar
               width regardless of count. The base CSS uses
               `repeat(auto-fit, minmax(140px, 1fr))` which leaves
               leftover gutter when there are only 1–2 cards (the
               minmax min keeps each card at 140px and the
               remaining tracks collapse). Overriding to
               `repeat(<count>, 1fr)` makes each visible card take
               an equal share of the row, so a single Hitting card
               stretches to the full width and two cards each take
               half — same way the Daily Training day-grid scales
               per-column. The Notes grid below uses the same
               `repeat(<count>, 1fr)` so each Notes column sits
               directly under its paired Tool Grades card. */
            style={visibleSections.length > 0
              ? { gridTemplateColumns: `repeat(${visibleSections.length}, minmax(0, 1fr))` }
              : undefined}
          >
            {visibleSections.map((s) => {
              /* Tool Grades — show every bar for each section. The HITTING
                 section's three bars are Swing / Quality of Contact /
                 Mechanical Grades (the `hit_coach` key, which now averages
                 the coach swing-mechanics grades). It used to be filtered
                 out of the chart back when there was a separate Swing
                 Decision bar; now it IS a primary bar and must show. */
              const visibleSection = s;
              const avg = sectionAvg(visibleSection);
              // `palette` (DOMAIN_PALETTE[s.key]) used to drive the
              // leading colored dot in the section label. That dot was
              // retired, so the palette lookup is gone — the per-bar
              // tone now comes from `scoreColor(b.score)` and the total
              // tone from `scoreColor(avg)` (the band color).
              const hasScore = avg !== null;
              const bandColor = hasScore ? scoreColor(avg!) : '#6e767d';
              return (
                <div
                  key={s.key}
                  // `data-section` exposes the section key as a CSS hook
                  // so per-section styling (e.g. the off-white-with-
                  // tiny-gradient on the Hitting card, the heavier
                  // chrome on the Pitching card) can target a single
                  // card without refactoring the shared chrome.
                  data-section={s.key}
                  className={styles.toolGraphCard}
                >
                  {/* Inner blue bubble retired per spec — the section
                      label, accent hairline, aggregate total, and bar
                      chart now render directly on the outer grey card.
                      One bubble (the outer Tool Grades panel) wraps
                      everything; each section card carries only its
                      own grey chrome with no nested blue accent. */}
                  <div className={styles.toolGraphLabel}>
                    {s.label}
                  </div>

                  <div className={styles.toolGraphRule} aria-hidden />

                  <div className={styles.toolGraphTotal} style={hasScore ? { color: bandColor } : undefined}>
                    {avg ?? '—'}
                  </div>

                  <div className={styles.toolGraphBars}>
                    {visibleSection.bars.map((b) => {
                      const hasSub = b.score !== null;
                      const subColor = hasSub ? scoreColor(b.score!) : '#6e767d';
                      const subHeightPct = hasSub ? scoreToPct(b.score!) : 0;
                      return (
                        <div key={b.key} className={styles.toolGraphBarCol}>
                          <span
                            className={styles.toolGraphBarScore}
                            style={hasSub ? { color: subColor } : undefined}
                          >
                            {b.score ?? '—'}
                          </span>
                          <div className={styles.toolGraphBarTrack}>
                            <div
                              className={styles.toolGraphBarFill}
                              style={{
                                height: `${subHeightPct}%`,
                                background: subColor,
                                color: subColor,
                                opacity: hasSub ? 1 : 0.2,
                              }}
                            />
                          </div>
                          <span className={styles.toolGraphBarLabel} title={b.label}>
                            {b.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
            );
          })()}

        {/* ── Notes (per Tool Grades section) ──
            Nested INSIDE the Tool Grades panel above (the closing
            </div> for that panel now lives at the end of this block)
            so the two render as a single connected bubble: Tool
            Grades cards on top, a hairline divider, then a matching
            grid of Notes columns beneath. The per-column grid mirrors
            Tool Grades' `repeat(<count>, 1fr)` layout so each Notes
            sub-bubble sits directly under its paired Tool Grades
            card above. Filter mirrors `visibleTabKeys` so hiding a
            tab via the Eye toggle drops both the Tool Grades card
            AND its Notes column in lockstep.
            Persisted via the canonical per-section `developmentNotes`
            JSON map. One Save bar at the bottom commits the whole
            map via `saveDevNotes`.
            On the player app the entire Notes section (divider +
            header + grid) is hidden when no visible section has a
            saved note — the Tool Grades cards above still render so
            the bubble doesn't collapse, just shows the grades alone. */}
        {(() => {
          const notesSections = aggregate.sections.filter(
            (s) => !visibleTabKeys || visibleTabKeys.includes(s.key),
          );
          if (notesSections.length === 0) return null;
          const playerHasAnyNote = notesSections.some(
            (s) => (persistedDevNotes[s.key] ?? '').trim().length > 0,
          );
          if (!isCoach && !playerHasAnyNote) return null;
          return (
            <>
              {/* Divider line between Tool Grades and Notes — now
                  rendered with the IDENTICAL CSS rule the Tool
                  Grades header uses for its own underline:
                  `.toolBubbleHead` carries `border-bottom: 1px solid
                  var(--tool-grades-line)` + `padding-bottom: 0.7rem`.
                  We reuse the same class on an empty placeholder div
                  so the line picks up the exact same border treatment
                  (color, weight, sub-pixel rendering) and inherits
                  any future styling tweaks to the Tool Grades rule
                  automatically. The 0.7rem padding-bottom inside this
                  empty head replicates the same breathing room that
                  sits between the "Tool Grades" title and its
                  underline above. */}
              <div className={styles.toolBubbleHead} aria-hidden="true" />
              {/* Per-section grid — column count matches Tool Grades so
                  each Notes column sits directly under its paired
                  Tool Grades card above. */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${notesSections.length}, minmax(0, 1fr))`,
                  gap: 12,
                }}
              >
                {notesSections.map((s) => {
                  const value = devNotes[s.key] ?? '';
                  const persisted = persistedDevNotes[s.key] ?? '';
                  // On the player view, hide individual sections that
                  // have no saved text so the row only shows the
                  // sections the coach has actually annotated.
                  if (!isCoach && persisted.trim().length === 0) return null;
                  return (
                    <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div
                        style={{
                          fontSize: rem(11),
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {/* Append " Notes" so each column reads as its
                            own scoped label (e.g. "HITTING NOTES",
                            "PITCHING NOTES") now that the global
                            "Notes" h2 above the grid was retired. */}
                        {s.label} Notes
                      </div>
                      {isCoach ? (
                        /* Coach textarea wears `--notes-bg` (the same
                           token NoteBlock + RichEditableNote use). In
                           light theme this is `--bubble-chrome-bg`
                           (#eaeaea near-white) so the inner card
                           matches the Hitting Tool Grades card +
                           every Hitting Snapshot interior bubble. */
                        <textarea
                          value={value}
                          onChange={(e) =>
                            setDevNotes((m) => ({ ...m, [s.key]: e.target.value }))
                          }
                          placeholder={`What we're working on for ${s.label}…`}
                          rows={4}
                          style={{
                            width: '100%',
                            minHeight: 96,
                            resize: 'vertical',
                            background: 'var(--notes-bg)',
                            color: 'var(--text)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            fontFamily: 'inherit',
                            fontSize: rem(13.5),
                            lineHeight: 1.5,
                            boxSizing: 'border-box',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            whiteSpace: 'pre-wrap',
                            color: 'var(--text)',
                            fontSize: rem(13.5),
                            lineHeight: 1.55,
                            background: 'var(--notes-bg)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            padding: '10px 12px',
                          }}
                        >
                          {persisted}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Coach-only Save bar — one button commits the entire
                  per-section JSON map. Reuses the established
                  `.devSaveBtn` / `.devResetBtn` chrome + flash-
                  confirmation pattern that already lives in the
                  CSS module. */}
              {isCoach && (
                <div className={styles.devSaveBar}>
                  {devSaveError && (
                    <span className={styles.devSaveError}>{devSaveError}</span>
                  )}
                  {devSaveOk && (
                    <span className={styles.devSaveOk}>Saved</span>
                  )}
                  <button
                    type="button"
                    className={styles.devResetBtn}
                    disabled={!devDirty || savingDev}
                    onClick={() => setDevNotes(persistedDevNotes)}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className={styles.devSaveBtn}
                    disabled={!devDirty || savingDev}
                    onClick={saveDevNotes}
                  >
                    {savingDev ? 'Saving…' : 'Save Notes'}
                  </button>
                </div>
              )}
            </>
          );
        })()}
        </div>{/* /merged Tool Grades + Notes panel */}

        {/* Sub-Grade Breakdown / "<Section> Breakdown" panel retired
            per spec — the per-bar mini-chart grid below Tool Grades was
            removed entirely. Tool Grades now stands alone as the
            top-of-hero scoring bubble, with no per-section detail
            expander beneath it. */}

        {/* Upcoming Drills — full-width hero panel. Now sits directly
            under the Tool Grades bubble since the Sub-Grade Breakdown
            panel that used to live between them was retired. */}
        <div className={styles.panel}>
          <UpcomingDrillsPanel playerId={player.id} />
        </div>

        {/* Player Videos — same full-width treatment as Upcoming
            Drills above it. */}
        <div className={styles.panel}>
          <PlayerVideosPanel playerId={player.id} reports={reports} />
        </div>

      </section>

      {/* Sub-Grade Compare + Metric Trend panels retired. Upcoming
          Drills + Player Videos moved up into the hero stack so they
          sit full-width under Sub-Grade Breakdown — see above. */}

      <div className={styles.footerNote}>
        Report view: baseline-anchored bars, target markers, and grouped insights. Scores fill in as reports and CSV
        uploads are logged.
      </div>
      </>
      )}
    </div>
  );
}
