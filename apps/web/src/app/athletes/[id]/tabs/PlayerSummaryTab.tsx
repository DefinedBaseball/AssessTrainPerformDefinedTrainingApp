'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as api from '@/lib/api';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
  AreaChart, Area,
} from 'recharts';
import {
  TabBarActions, AddReportButton, EditProfileButton, ReportSelector,
} from '@/components/assessment';
import { generateSummaryPdf } from '@/lib/pdf';
import {
  TabProps,
  scoreColor,
  computeAggregateScores,
  type AggregateSection,
  type AggregateBar,
} from '../helpers';
import styles from './PlayerSummaryTab.module.css';

/* ═══════════════════════════════════════════
   PALETTE — section colors matched to master's
   helpers.ts so the Summary tab matches the
   rest of the master-branch palette (monochrome
   graphite shell + green / blue / amber / purple
   / teal section identity colors).
   ═══════════════════════════════════════════ */

const DOMAIN_PALETTE: Record<string, {
  main: string;
  soft: string;
  name: string;
}> = {
  hitting:           { main: '#4ADE80', soft: '#86efac', name: 'Hitting'  },
  pitching:          { main: '#60A5FA', soft: '#93c5fd', name: 'Pitching' },
  // Defense was split into per-position sections to mirror the player's
  // top-level Infield / Catching / Outfield tabs.
  defense_infield:   { main: '#F59E0B', soft: '#fcd34d', name: 'Infield'  },
  defense_catching:  { main: '#F59E0B', soft: '#fcd34d', name: 'Catching' },
  defense_outfield:  { main: '#F59E0B', soft: '#fcd34d', name: 'Outfield' },
  strength:          { main: '#14B8A6', soft: '#5eead4', name: 'S & C'    },
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
 *  Conditioning ("Physical") in the modular sub-grade compare chart. */
type CompareDomain = 'hitting' | 'pitching' | 'defense';

const COMPARE_OPTIONS: { key: CompareDomain; label: string }[] = [
  { key: 'hitting',  label: 'Hitting' },
  { key: 'pitching', label: 'Pitching' },
  { key: 'defense',  label: 'Defense' },
];

/** Pick the relevant aggregate sections for the chosen comparison domain.
 *  Defense pulls from every per-position split (defense_infield / catching /
 *  outfield) so the chart shows whatever the player carries. */
function sectionsForDomain(sections: AggregateSection[], domain: CompareDomain): AggregateSection[] {
  if (domain === 'hitting')  return sections.filter((s) => s.key === 'hitting');
  if (domain === 'pitching') return sections.filter((s) => s.key === 'pitching');
  return sections.filter((s) =>
    s.key === 'defense_infield' || s.key === 'defense_catching' || s.key === 'defense_outfield',
  );
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
            fontSize: 12,
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
            style={{ fill: tk.label, fontSize: 11, fontWeight: 700 }}
            formatter={(v: any) => (v == null ? '—' : v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ═══════════════════════════════════════════
   Section sub-grade bar chart — driven by the
   Tool Grades bubble click-selection.
   ═══════════════════════════════════════════ */

function SectionBarsChart({ section }: { section: AggregateSection | null }) {
  const tk = CHART_TOKENS;
  /* Flatten every sub-metric across every bar in the section so the chart
     shows the *leaf* grades (what actually rolls up into each group score),
     while the KPI bubbles above already surface the group totals. */
  const data = useMemo(() => {
    if (!section) return [];
    return section.bars.flatMap((b) =>
      b.subMetrics.map((sm) => ({
        name: sm.label,
        group: b.label,
        value: sm.grade ?? null,
        displayValue: sm.grade ?? 20,
      })),
    );
  }, [section]);

  if (!section || data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '32px 12px', textAlign: 'center', fontSize: 13 }}>
        No {section?.label.toLowerCase() ?? 'section'} sub-grades yet.
      </div>
    );
  }

  /* With many sub-metrics, angle x-axis labels and shrink the bars so
     everything fits without collisions. */
  const many = data.length > 5;
  const barSize = many ? Math.max(18, Math.round(260 / data.length)) : 44;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 12, bottom: many ? 36 : 8, left: 0 }}>
        <CartesianGrid stroke={tk.grid} vertical={false} />
        <XAxis
          dataKey="name"
          stroke={tk.axis}
          fontSize={10}
          tickLine={false}
          interval={0}
          angle={many ? -28 : 0}
          textAnchor={many ? 'end' : 'middle'}
          height={many ? 50 : 30}
        />
        <YAxis
          domain={[20, 80]}
          ticks={[20, 30, 40, 50, 60, 70, 80]}
          stroke={tk.axis}
          fontSize={11}
          tickLine={false}
        />
        <ReferenceLine y={50} stroke={tk.ref} strokeDasharray="5 5" />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          contentStyle={{
            background: tk.tooltipBg,
            border: `1px solid ${tk.tooltipBorder}`,
            borderRadius: 10,
            fontSize: 12,
            color: tk.tooltipText,
          }}
          formatter={(_v: any, _n: any, item: any) => [
            item?.payload?.value ?? '—',
            item?.payload?.group ?? 'Score',
          ]}
        />
        <Bar dataKey="displayValue" radius={[8, 8, 0, 0]} barSize={barSize}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.value == null ? '#9aa0a6' : scoreColor(d.value)}
              fillOpacity={d.value == null ? 0.25 : 1}
            />
          ))}
          <LabelList
            dataKey="value"
            position="top"
            style={{ fill: tk.label, fontSize: 12, fontWeight: 700 }}
            formatter={(v: any) => (v == null ? '—' : v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ═══════════════════════════════════════════
   Modular metric trend — picks a metric from
   progressData and renders historical averages
   per report date as a smooth area chart.
   ═══════════════════════════════════════════ */

/** Domains the metric selector groups options under, plus a per-domain
 *  accent color the line + area shading uses. Keeps the selector readable
 *  for both coaches and athletes scanning a long metric list. */
const TREND_DOMAINS: { label: string; accent: string; metrics: { key: string; label: string; unit: string }[] }[] = [
  {
    label: 'Hitting', accent: '#4ADE80',
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
    ],
  },
  {
    label: 'Defense', accent: '#F59E0B',
    metrics: [
      { key: 'infield_velo',  label: 'Infield Velo',  unit: 'mph' },
      { key: 'outfield_velo', label: 'Outfield Velo', unit: 'mph' },
      { key: 'catcher_velo',  label: 'Catcher Velo',  unit: 'mph' },
      { key: 'pop_time',      label: 'Pop Time',      unit: 's' },
      { key: 'exchange_time', label: 'Exchange Time', unit: 's' },
    ],
  },
  {
    label: 'Pitching', accent: '#60A5FA',
    metrics: [
      { key: 'fb_max_velo', label: 'FB Max Velo', unit: 'mph' },
      { key: 'spin_rate',   label: 'Spin Rate',   unit: 'rpm' },
    ],
  },
  {
    label: 'Physical', accent: '#14B8A6',
    metrics: [
      { key: 'sprint_60',    label: '60-yd Sprint', unit: 's' },
      { key: 'jump_height',  label: 'Vert Jump',    unit: 'in' },
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
          <div className={styles.tiny}>Metric trend</div>
          <h2>{current ? current.metric.label : 'Historical averages'}</h2>
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
      <div style={{ color: 'var(--text-muted)', padding: '32px 12px', textAlign: 'center', fontSize: 13 }}>
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
      <AreaChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: -10 }}>
        <defs>
          <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
            <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={tk.grid} />
        <XAxis dataKey="label" stroke={tk.axis} fontSize={11} tickLine={false} />
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
            fontSize: 12,
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
   MAIN COMPONENT
   ═══════════════════════════════════════════ */

export function PlayerSummaryTab({
  player, topMetrics, reports, progressData, isCoach, onNewReport, onEditReport, onEditProfile, onRefresh,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<import('../helpers').ReportSummary | null>(null);
  const aggregate = useMemo(
    () => computeAggregateScores(player, reports, topMetrics),
    [player, reports, topMetrics],
  );

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
     alongside Physical bars. Default to Hitting so position players see
     something on first paint; pitchers can flip to Pitching. */
  const [compareDomain, setCompareDomain] = useState<CompareDomain>('hitting');

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

  /* Detail-card selection: the user can click a row in the Tool-Grades
     bubble to swap the "Detail focus card" (below it) between Hitting,
     Pitching, Defense, Vision, and S&C. Default to Hitting; fall back to
     the first available section if Hitting isn't present. */
  const [selectedKey, setSelectedKey] =
    useState<AggregateSection['key']>('hitting');
  const selectedSection =
    aggregate.sections.find((s) => s.key === selectedKey) ??
    aggregate.sections.find((s) => s.key === 'hitting') ??
    aggregate.sections[0] ??
    null;
  const selectedAvg = selectedSection ? sectionAvg(selectedSection) : null;

  // (The static "richest available metric" trend lookup was retired —
  // MetricTrendPanel below renders progressData directly with its own
  // dropdown for metric selection.)

  return (
    <div className={styles.root}>
      {/* ── Tab actions: Add Report + Reports dropdown (per-report download) ── */}
      <TabBarActions>
        <AddReportButton onClick={onNewReport} show={isCoach} />
        <EditProfileButton onClick={onEditProfile} show={!isCoach} />
        <ReportSelector
          reports={reports}
          reportTypes={[]}
          label="Player Reports"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
          onNewReport={onNewReport}
          onEdit={onEditReport}
          onDownload={(r) => generateSummaryPdf(player, [r], topMetrics)}
          rangeOnly
        />
      </TabBarActions>

      {/* ══════════ HERO ══════════ */}
      <section className={styles.hero}>
        {/* Development snapshot — leads the hero. Header carries the
            section-by-section "Best Tool / Biggest Weakness / Next Steps"
            cards below. The Save controls sit inline with the eyebrow so
            coaches don't have to scroll past every card to save edits. */}
        <div className={`${styles.panel} ${styles.noteCard}`}>
          <div className={styles.devHeader}>
            <div className={styles.eyebrow}>Development snapshot</div>
            {/* Save controls live inline (coach only). Reset is hidden
                when nothing's been edited so the bar stays tight.
                The overall total score was retired in favor of per-section
                scores rendered inside each card below. */}
            {isCoach && aggregate.sections.length > 0 && (
              <div className={styles.devHeaderSave}>
                {devSaveError && <span className={styles.devSaveError}>{devSaveError}</span>}
                {devSaveOk && <span className={styles.devSaveOk}>Saved</span>}
                {devDirty && (
                  <button type="button" onClick={() => setDevNotes(persistedDevNotes)}
                    className={styles.devResetBtn}>
                    Reset
                  </button>
                )}
                <button type="button" onClick={saveDevNotes} disabled={!devDirty || savingDev}
                  className={styles.devSaveBtn}
                  style={{ opacity: !devDirty || savingDev ? 0.6 : 1 }}>
                  {savingDev ? 'Saving…' : 'Save Next Steps'}
                </button>
              </div>
            )}
          </div>
          <div className={styles.devGrid}>
            {aggregate.sections.map((s) => {
              const palette = DOMAIN_PALETTE[s.key] ?? { main: '#94a3b8', soft: '#cbd5e1', name: s.label };
              const noteValue = devNotes[s.key] ?? '';
              const persistedValue = persistedDevNotes[s.key] ?? '';
              return (
                <SectionDevelopmentCard
                  key={s.key}
                  section={s}
                  palette={palette}
                  notes={noteValue}
                  dirty={noteValue !== persistedValue}
                  isCoach={isCoach}
                  onChange={(next) => setDevNotes((prev) => ({ ...prev, [s.key]: next }))}
                  registerNotes={registerNotes}
                  onNotesScroll={onNotesScroll}
                  onNotesResizeEnd={syncNotesHeight}
                />
              );
            })}
            {aggregate.sections.length === 0 && (
              <div style={{ color: 'var(--text-muted)', padding: 12, fontSize: 13 }}>
                No Tool Grades sections yet — add a position to the player profile.
              </div>
            )}
          </div>
        </div>

        {/* Left: condensed tool grades bubble — compact multi-row bar graph */}
        <div className={`${styles.panel} ${styles.toolBubble}`}>
          <div className={styles.toolBubbleHead}>
            <div>
              <div className={styles.tiny}>Tool grades</div>
            </div>
            <div className={styles.legendInline}>
              <span>20-80 Scale</span>
            </div>
          </div>
          <div className={styles.toolBarList}>
            {aggregate.sections.map((s) => {
              const avg = sectionAvg(s);
              const palette = DOMAIN_PALETTE[s.key] ?? DOMAIN_PALETTE.hitting;
              const hasScore = avg !== null;
              const bandColor = hasScore ? scoreColor(avg!) : '#6e767d';
              const target = targetFor(avg);
              const fillPct = hasScore ? scoreToPct(avg!) : 0;
              const targetPct = scoreToPct(target);
              const isSelected = selectedSection?.key === s.key;
              return (
                <div
                  key={s.key}
                  className={`${styles.toolBarRow}${isSelected ? ' ' + styles.toolBarRowActive : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedKey(s.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedKey(s.key);
                    }
                  }}
                >
                  <div className={styles.toolBarMain}>
                    <div className={styles.toolBarLabel}>
                      <span
                        className={styles.dot}
                        style={{ color: palette.main, background: palette.main }}
                      />
                      {s.label}
                    </div>
                    <div className={styles.toolBarTrack}>
                      <div className={styles.toolBarBaseline} />
                      <div
                        className={styles.toolBarFill}
                        style={{
                          width: `${fillPct}%`,
                          background: bandColor,
                          opacity: hasScore ? 1 : 0.25,
                        }}
                      />
                      <div
                        className={styles.toolBarTarget}
                        style={{ left: `${targetPct}%`, opacity: hasScore ? 0.55 : 0.25 }}
                      />
                    </div>
                    <div
                      className={styles.toolBarScore}
                      style={hasScore ? { color: bandColor } : undefined}
                    >
                      {avg ?? '—'}
                    </div>
                  </div>
                  {s.bars.length > 0 && (
                    <div className={styles.toolSubRow}>
                      {s.bars.map((b) => {
                        const hasSub = b.score !== null;
                        const subColor = hasSub ? scoreColor(b.score!) : '#6e767d';
                        const subPct = hasSub ? scoreToPct(b.score!) : 0;
                        return (
                          <div key={b.key} className={styles.toolSubItem}>
                            <span className={styles.toolSubLabel}>{b.label}</span>
                            <div className={styles.toolSubTrack}>
                              <div
                                className={styles.toolSubFill}
                                style={{
                                  width: `${subPct}%`,
                                  background: subColor,
                                  opacity: hasSub ? 1 : 0.2,
                                }}
                              />
                            </div>
                            <span
                              className={styles.toolSubScore}
                              style={hasSub ? { color: subColor } : undefined}
                            >
                              {b.score ?? '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected-section detail card — driven by the Tool-Grades bubble. */}
        <div className={`${styles.panel} ${styles.playerCard}`}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>
                {(selectedSection?.label ?? 'Section')} detail
              </div>
              <h2>Sub-grade breakdown</h2>
            </div>
            <div className={styles.chips}>
              <span className={styles.chip}>
                Aggregate {selectedAvg ?? '—'} / 80
              </span>
              {selectedAvg != null && selectedAvg < 50 && (
                <span className={`${styles.chip} ${styles.chipWarn}`}>Priority area</span>
              )}
            </div>
          </div>

          {/* Bubbles are now flex-proportional so each group card spans
              exactly over its own sub-metric columns in the chart below.
              Horizontal padding matches the chart's YAxis gutter (≈60px)
              and right-side margin (12px) so columns line up. */}
          <div className={styles.kpiRow}>
            {(selectedSection?.bars ?? []).map((bar) => {
              const grade = bar.score;
              let trendCopy = 'Awaiting data';
              let bad = false;
              if (grade != null) {
                if (grade >= 60) trendCopy = 'Above program average';
                else if (grade >= 50) trendCopy = 'Trending steady';
                else if (grade >= 40) trendCopy = 'Needs tighter spread';
                else { trendCopy = 'Below desired band'; bad = true; }
              }
              // Width weight = number of leaf sub-metrics in this bar.
              // Fallback to 1 so groups without sub-metrics still render.
              const weight = Math.max(1, bar.subMetrics.length);
              // Unified scoreColor for the group score, matching the chart bars
              // and Tool-Grades bubble.
              const kpiColor = grade != null ? scoreColor(grade) : undefined;
              return (
                <div
                  key={bar.key}
                  className={styles.kpi}
                  style={{ flex: `${weight} ${weight} 0` }}
                >
                  <label className={styles.kpiLabel}>{bar.label}</label>
                  <strong
                    className={styles.kpiValue}
                    style={kpiColor ? { color: kpiColor } : undefined}
                  >
                    {grade ?? '—'}
                  </strong>
                  <div className={`${styles.kpiTrend}${bad ? ' ' + styles.kpiTrendBad : ''}`}>
                    {trendCopy}
                  </div>
                </div>
              );
            })}
            {(!selectedSection || selectedSection.bars.length === 0) && (
              <div className={styles.kpi} style={{ flex: '1 1 0' }}>
                <label className={styles.kpiLabel}>No sub-grades</label>
                <strong className={styles.kpiValue}>—</strong>
                <div className={styles.kpiTrend}>Awaiting assessment</div>
              </div>
            )}
          </div>

          <div className={styles.chartWrap}>
            <SectionBarsChart section={selectedSection} />
          </div>
        </div>

      </section>

      {/* (Decision matrix / Approach quadrants section retired —
          replaced by the per-section Development snapshot cards above.) */}

      {/* ══════════ BOTTOM ══════════
          Two modular charts:
          1. Sub-grade compare — Physical vs (Hitting | Pitching | Defense),
             chosen via the dropdown in the panel header.
          2. Metric trend — historical averages for any populated metric,
             grouped by domain in the dropdown. */}
      <section className={styles.bottom}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>Sub-grade compare</div>
              <h2>Physical vs {COMPARE_OPTIONS.find((o) => o.key === compareDomain)?.label ?? '—'}</h2>
            </div>
            <select
              className={styles.chartSelect}
              value={compareDomain}
              onChange={(e) => setCompareDomain(e.target.value as CompareDomain)}
            >
              {COMPARE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>Physical vs {o.label}</option>
              ))}
            </select>
          </div>
          <div className={`${styles.chartWrap} ${styles.chartWrapTall}`}>
            <SubgradeCompareChart sections={aggregate.sections} compareDomain={compareDomain} />
          </div>
        </div>

        <div className={styles.panel}>
          <MetricTrendPanel progressData={progressData} />
        </div>
      </section>

      <div className={styles.footerNote}>
        Report view: baseline-anchored bars, target markers, and grouped insights. Scores fill in as reports and CSV
        uploads are logged.
      </div>
    </div>
  );
}
