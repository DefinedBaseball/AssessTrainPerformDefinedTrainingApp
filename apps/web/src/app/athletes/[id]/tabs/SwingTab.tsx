'use client';

import { rem } from '@/lib/rem';
import { useEffect, useMemo, useRef, useState } from 'react';
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

/* ── Shared Fastball-bubble surface style ──
   Matches the Pitching Fastball / Arsenal Card (`pitchReportBubbleStyle`)
   exactly: triple-layer gradient + soft white-rim border + 12px
   radius, **no box-shadow / hairlines / corner glow**. Applied to
   every chip / card inside the Hitting tab so the bubbles read
   identically to the Fastball bubble in Pitching.

   References the `--bubble-chrome-bg` CSS variable defined in
   globals.css so the surface auto-flips between the dark-mode
   triple-layer radial+linear gradient and the light-mode
   `#f3f3f3 → #e5e5e5` off-white linear gradient with no JS-side
   theme check needed. */
const MOVEMENT_PLOT_BUBBLE_BG = 'var(--bubble-chrome-bg)';

/* Exported so sibling tabs (HittingTab's in-snapshot Coach Reviews
   panel, etc.) can reuse the exact same warm-grey "Swing-bubble"
   surface for sub-bubbles instead of reinventing the gradient +
   border combo. */
export const movementPlotBubbleStyle: React.CSSProperties = {
  background: MOVEMENT_PLOT_BUBBLE_BG,
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  position: 'relative',
  /* Gentle drop shadow — same `0 4px 12px / 0.10` used by the
     Spray Chart bubble so every off-white movement-plot /
     pitch-report style bubble across Hitting + Pitching reads
     with the same subtle lift in light mode. */
  boxShadow: '0 5px 14px rgba(0, 0, 0, 0.21)',
};

/* Inner GREY bubble that wraps each Hitting-inputs sub-section
   (Coach Grades / Full Swing / Blast Motion / HitTrax) inside the
   outer Main blue bubble (`aStyles.profilePanel`). Wears the
   Movement-Plot warm-grey gradient + 14% white rim so the four
   sub-sections each get their own contained area, with the section
   header on the grey surface and the metric cards inside sitting
   on the Swing-bubble dark-navy color. */
const hittingSectionBubbleStyle: React.CSSProperties = {
  /* Warm-grey Movement-Plot / Curveball-bubble chrome — same color
     as `pitchReportBubbleStyle` (the Arsenal cards like Curveball /
     Fastball / Slider in the Pitching tab's Pitch Report). Lifts
     each Hitting Inputs section into the same warm-grey tone used
     across the Pitching tab's per-pitch bubbles. SectionHeader +
     HittingMetricTable sit directly on this surface (no inner
     wrapper). */
  background: MOVEMENT_PLOT_BUBBLE_BG,
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  /* Gentle drop shadow — matches `movementPlotBubbleStyle` +
     `pitchReportBubbleStyle` + the Spray Chart bubble for a
     consistent subtle lift across every white bubble in light. */
  boxShadow: '0 5px 14px rgba(0, 0, 0, 0.21)',
};

/* Dark-navy `.panel` chrome — same color as the Swing inner bubble.
   Applied inline to KpiCards and ManualScoreCards inside the
   Hitting-inputs sections so every metric tile reads in the same
   color as the Swing/QoC/Coach Diagnosis inner bubbles. */
const SWING_BUBBLE_CHROME: React.CSSProperties = {
  background:
    'radial-gradient(ellipse at 50% 35%,' +
    ' rgba(255, 255, 255, 0.04) 0%,' +
    ' transparent 60%),' +
    'rgba(10, 14, 20, 0.38)',
  border: '1px solid var(--border-light)',
  borderRadius: 10,
  boxShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.05),' +
    'inset 0 0 24px rgba(0, 0, 0, 0.35),' +
    '0 1px 2px rgba(0, 0, 0, 0.25)',
};

/* ── Player-Name (Command Deck) chip style ──
   Same chrome the page-hero `.commandDeck` carries — centered white
   radial highlight at 50% 35%, 12%-white border, 12px radius, and the
   layered inset shadow stack — MINUS the `::before` blue corner glow.
   Used for the chips under the Swing / Quality of Contact / Coach
   Diagnosis grade rows so they read with the same dark-navy depth
   as the Outfielder Snapshot callouts.
   The dark-navy base layer is rendered OPAQUE here (rgb(10,14,20)
   instead of rgba(10,14,20,0.38)) so the chip doesn't let the
   parent Hitting Grades bubble's lighter graphite color bleed
   through; the bubble underneath keeps its own surface unchanged. */
const COMMAND_DECK_CHIP_BG =
  'radial-gradient(ellipse at 50% 35%, rgba(255, 255, 255, 0.04) 0%, transparent 60%),' +
  'rgb(10, 14, 20)';

const commandDeckChipStyle: React.CSSProperties = {
  background: COMMAND_DECK_CHIP_BG,
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  boxShadow:
    'inset 0 1px 0 rgba(255, 255, 255, 0.05),' +
    'inset 0 0 24px rgba(0, 0, 0, 0.35),' +
    '0 1px 2px rgba(0, 0, 0, 0.25)',
  position: 'relative',
};

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
      <rect x="22" y="22" width="46" height="64" rx="3" fill="var(--text-bright)" />
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
      <circle cx="74" cy="62" r="18" fill="var(--text-bright)" stroke="#1a1f25" strokeWidth="3" />
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
      <g fill="var(--text-bright)">
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
        fill="var(--text-bright)"
      >FS</text>
      {/* "FULL SWING" footer */}
      <text
        x="50" y="86"
        textAnchor="middle"
        fontFamily="'Inter', 'Helvetica Neue', Arial, sans-serif"
        fontSize="11"
        fontWeight="700"
        letterSpacing="1.5"
        fill="var(--text-bright)"
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
      <rect x="0" y="0" width="100" height="100" rx="50" fill="var(--text-bright)" />
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

/* ── Break-&-Spin-style metric table ──
   Mirrors the Pitch Report's BreakTable in PitchingTab.tsx exactly:
   N equal `1fr` columns, a header row (Font D Satoshi 9 px / 600 /
   0.05em uppercase eyebrow) with a `var(--border)` bottom rule, and
   a data row (15 px / 700 / centered Satoshi values). Used to render
   the Coach Grades / Full Swing / Blast Motion / HitTrax metric
   grids inside the Hitting Inputs sections so each grey/blue bubble
   reads with the same tabular column design as Break & Spin in the
   Pitch Report. */
interface HittingMetricCell {
  label: string;
  /** Pre-formatted value (e.g. "72.4", "68%", "1.45", "—"). */
  display: string;
  /** Optional small-text unit suffix (rendered like Break & Spin's
   *  "mph" / "rpm" after the main value). */
  unit?: string;
  /** Optional value color override (tone-mapped from the metric's
   *  20-80 grade). */
  color?: string;
}

/* Split a multi-word label into two visually balanced lines by
   choosing the inter-word break that minimizes the absolute
   character-length difference between the two halves. Returns a
   single-element tuple for single-word labels (e.g. "Distance"),
   otherwise a [top, bottom] tuple. Used by the column header row
   below so every two-word+ label stacks on two lines by default —
   e.g. "Max Bat Speed" → ["Max Bat", "Speed"], "Avg Exit Velocity"
   → ["Avg Exit", "Velocity"], "Squared Up %" → ["Squared", "Up %"]. */
const UNIT_ONLY_TOKENS = new Set(['%', '°']);
function splitLabelBalanced(label: string): string[] {
  const trimmed = label.trim();
  const words = trimmed.split(/\s+/);
  if (words.length <= 1) return [trimmed];
  let bestSplit = -1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const leftStr = words.slice(0, i).join(' ');
    const rightStr = words.slice(i).join(' ');
    /* Reject splits where either half is JUST a unit symbol (`%` /
       `°`) — those produce labels like "Barrel" / "%" that read
       worse than the unbroken "Barrel %". Labels whose only viable
       split orphans a unit symbol (e.g. "Barrel %", "Whiff %",
       "Chase %") drop through this filter with no valid candidate
       and render as a single line. Multi-word labels with a unit
       suffix (e.g. "Squared Up %") still split at the non-unit
       boundary ("Squared" / "Up %"). */
    if (UNIT_ONLY_TOKENS.has(leftStr) || UNIT_ONLY_TOKENS.has(rightStr)) continue;
    const diff = Math.abs(leftStr.length - rightStr.length);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestSplit = i;
    }
  }
  if (bestSplit === -1) return [trimmed];
  return [
    words.slice(0, bestSplit).join(' '),
    words.slice(bestSplit).join(' '),
  ];
}

function HittingMetricTable({ items, singleRow = false, compact = false, hideLabelDivider = false, singleLineLabels = false, flushEdges = false, rows: explicitRows }: { items: HittingMetricCell[]; singleRow?: boolean; compact?: boolean; hideLabelDivider?: boolean;
  /** Pre-split rows of items — when provided, the component renders
   *  exactly these rows instead of auto-splitting `items` based on
   *  the >5 heuristic. Used by the Blast Motion section to pin
   *  specific metrics (Plane Score / Connection Score / Early
   *  Connection / Connection at Impact) onto a second row regardless
   *  of total item count. `items` is still required (used for the
   *  empty-state early return + as the canonical source of the
   *  combined cell list) but is ignored for layout when
   *  `explicitRows` is set. */
  rows?: HittingMetricCell[][];
  /** Opts the column-header row out of the default two-line label
   *  rendering (the `splitLabelBalanced` stack). Each label renders
   *  on a single line regardless of word count. Used by Coach
   *  Diagnosis where every label is short enough (≤ 8 chars) that
   *  forcing a one-line layout reads cleaner than a stacked split. */
  singleLineLabels?: boolean;
  /** Drops the internal 10-px left/right row padding to 0 so the
   *  leftmost column hugs the table's left edge and the rightmost
   *  hugs the right edge. The caller is expected to pair this with
   *  a negative horizontal margin (or position the table inside a
   *  full-width container) to extend the strip past whatever
   *  surrounding chrome it sits in. Used by the GradeRow chip
   *  strips so Max Bat Speed / Power sit close to the bubble's
   *  outer edges. */
  flushEdges?: boolean;
}) {
  if (items.length === 0) return null;
  /* `compact` shrinks both the header and value text to the original
     Break & Spin Pitch-Report sizes (9 px header / 15 px value / 9 px
     unit). The default expanded sizes (11.88 / 19.8 / 11.88) — i.e.
     the canonical Break & Spin 9-px baseline scaled +32 % — are used
     by the Hitting Inputs sections (Coach Grades / Full Swing /
     Blast Motion / HitTrax). The GradeRow chip tables pass
     `compact={true}` so their per-metric strip reads at the same
     tiny size as the Pitching tab's Break & Spin table. */
  const headerFont = rem(compact ? 9 : 11.88);
  /* Compact value bumped 15 → 16.5 (+10 %) so the numbers in the
     GradeRow chip tables read a touch larger than the canonical
     Break & Spin 15 px baseline. Headers + units stay at 9 px so the
     label-vs-value type contrast widens slightly. */
  const valueFont = rem(compact ? 16.5 : 19.8);
  const unitFont = rem(compact ? 9 : 11.88);
  const headerStyle: React.CSSProperties = {
    fontFamily: 'inherit',
    fontSize: headerFont,
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--text-bright)',
    textAlign: 'center',
    /* Line-height bumped 1 → 1.1 so two-line labels (the default
       rendering for any multi-word label) stack with a small
       breathing gap between the two stacked words. Single-line
       labels still read flush with the rule below — only the
       inter-line spacing within a stacked label is affected. */
    lineHeight: 1.1,
    /* `pre-line` collapses every horizontal whitespace run to one
       space but preserves newline characters as line breaks — so
       the balanced `\n` we inject between the two halves of a
       split label renders as a real two-line block. */
    whiteSpace: 'pre-line',
    /* Anchor the stacked label to the BOTTOM of its grid cell so
       single-line labels (e.g. "Distance") sit on the same visual
       baseline as the SECOND line of two-line labels, keeping the
       row's "label-glyph → rule" gap consistent across columns. */
    alignSelf: 'end',
  };
  const cellStyle: React.CSSProperties = {
    textAlign: 'center',
    fontFamily: 'inherit',
    fontWeight: 700,
    fontSize: valueFont,
    color: 'var(--text)',
    /* Line-height pinned at 1 so the number glyph's top edge sits
       flush with the data row's padding-top — eliminates the
       default line-height halo that pushed the visible number
       down away from the white rule above. Pair with the label
       above: both glyphs now sit symmetrically across the rule. */
    lineHeight: 1,
  };
  const unitStyle: React.CSSProperties = {
    fontSize: unitFont,
    fontWeight: 500,
    color: 'var(--text-muted)',
    marginLeft: 3,
  };

  /* Items > 5 wrap into two logical sub-tables stacked vertically —
     the same "two-row" rhythm the chip grid used to do for 8-chip
     GradeRows (Swing / Quality of Contact / Coach Diagnosis). Each
     sub-table renders its own header row + data row + bottom border,
     so the column count adapts cleanly (8 items → 4+4, 6 items → 3+3,
     odd counts split as ceil/floor). Tables ≤ 5 items render as a
     single full-width row.
     Callers can force a single full-width row regardless of count
     by passing `singleRow={true}` — used by the Hitting Inputs
     sections (Coach Grades / Full Swing / Blast Motion / HitTrax)
     so up to 8 metrics populate one line before wrapping. */
  /* `explicitRows` overrides the auto-split heuristic entirely —
     the caller pre-computed exactly which cells land on each row. */
  const rows: HittingMetricCell[][] = explicitRows
    ? explicitRows.filter(r => r.length > 0)
    : !singleRow && items.length > 5
      ? (() => {
          const half = Math.ceil(items.length / 2);
          return [items.slice(0, half), items.slice(half)];
        })()
      : [items];

  const renderRow = (rowItems: HittingMetricCell[], rowKey: string | number) => {
    const cols = `repeat(${rowItems.length}, minmax(0, 1fr))`;
    /* Horizontal row padding — 10 px by default; 0 when `flushEdges`
       is on so the leftmost / rightmost grid columns sit hard against
       the table's outer left/right edges (the GradeRow chip strips
       use this so Max Bat Speed / Power read closer to the bubble
       edges). */
    const edge = flushEdges ? 0 : 10;
    return (
      <div key={rowKey} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: cols,
          /* Padding-bottom 10 → 5 — together with the data row's
             padding-top 10 → 5 below, this halves the label-to-number
             vertical gap. The white rule (border-bottom) still sits
             between the two; only the breathing room around it
             shrinks. Suppressed via `hideLabelDivider` for callers
             that don't want a rule under the column labels (e.g. the
             HitTrax section's table). */
          padding: `6px ${edge}px 5px ${edge}px`,
          borderBottom: hideLabelDivider ? undefined : '1px solid var(--border)',
          gap: 8,
        }}>
          {rowItems.map((it) => (
            <span key={it.label} style={headerStyle}>
              {/* Two-line label by default — the balanced splitter
                 picks the inter-word break that produces the most
                 visually even two halves; single-word labels render
                 unchanged on one line. The `\n` is honored as a
                 real line break thanks to `whiteSpace: 'pre-line'`
                 on `headerStyle`. `singleLineLabels` skips the
                 splitter entirely so every label renders on ONE
                 line (used by Coach Diagnosis). */}
              {singleLineLabels ? it.label : splitLabelBalanced(it.label).join('\n')}
            </span>
          ))}
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: cols,
          /* Padding-top 10 → 5 to halve the label-to-number gap (see
             header row above). Padding-bottom stays 10 so the white
             rule below the numbers keeps its breathing room. */
          padding: `5px ${edge}px 10px ${edge}px`,
          alignItems: 'center',
          gap: 8,
          borderBottom: '1px solid var(--border)',
        }}>
          {rowItems.map((it) => (
            <span
              key={it.label}
              style={it.color ? { ...cellStyle, color: it.color } : cellStyle}
            >
              {/* Ghost-balance — an INVISIBLE duplicate of the unit
                 ("mph", "ft", "°", etc.) placed BEFORE the value so
                 the visible unit AFTER doesn't push the value's
                 visual centre to the left of the grid cell. Reserves
                 the same horizontal space on the left that the real
                 unit occupies on the right, keeping the data value
                 centred in the column regardless of unit length.
                 `visibility: hidden` keeps its size in the layout
                 but hides the glyph; `aria-hidden` keeps screen
                 readers from announcing it twice. */}
              {it.unit && (
                <span
                  aria-hidden="true"
                  style={{ ...unitStyle, visibility: 'hidden' }}
                >
                  {it.unit}
                </span>
              )}
              {it.display}
              {/* Real unit — rendered in the muted grey
                 (`var(--text-muted)`) defined in `unitStyle` above.
                 Explicit override of any inherited tone colour the
                 parent cell carries (Blast Motion / Full Swing /
                 HitTrax data rows recolour the parent span to the
                 grade tone — green / yellow / red — and without this
                 the unit would inherit that tone). */}
              {it.unit && (
                <span style={{ ...unitStyle, color: 'var(--text-muted)' }}>
                  {it.unit}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => renderRow(r, i))}
    </div>
  );
}

/* The Blast / Full-Swing metrics that contribute to the Swing grade.
   Per latest spec: Connection → Power (column O Power kW); Rotation →
   Peak Hand Speed (column Peak Hand Speed mph). Max Bat sits next to
   Avg Bat Spd so the snapshot shows both top-line speed numbers
   alongside the mechanics chips. */
const SWING_METRIC_KEYS = [
  'max_bat_speed',
  'avg_bat_speed',
  'attack_angle',
  'plane_angle',
  'time_to_contact',
  'on_plane_efficiency',
  'power_output',
  'peak_hand_speed',
  /* Blast CSV spec additions — composite scores + connection-degree
     readings. These flow through `SWING_METRIC_KEYS` so they show
     in the Swing GradeRow chip strip + the Blast Motion Inputs
     section per the Blast Motion App Logic spec sheet (Row 4 +
     Row 5). The `metricToGrade` helper returns null for keys
     without scoring bands; the chip then renders with the value
     in neutral (no tone) colour, which is correct for raw degree
     and composite-score readings. */
  'plane_score',
  'connection_score',
  'rotation_score',
  'early_connection',
  'connection_at_impact',
  'rotational_accel_g',   // Blast CSV "Rotational Acceleration (g)" average
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
  /* Order: Stride, Counter, Posture, Stability, Slot, Path, Direction,
     Timing — same as the Coach Diagnosis chip strip on the Hitting
     Snapshot so both views read in the same sequence AND the same
     label text. `forwardMove` was retired from the UI per spec; the
     ManualSwingScores type still carries the field (existing reports
     with a saved `forwardMove` grade still load cleanly), it's just
     no longer rendered as a Coach-grade column / chip. Label
     rotation — keys unchanged so saved scores survive:
       stretch     → "Counter"     (was "Stretch")
       stability   → "Slot"
       core        → "Stability"
       slot        → "Path"
     `stride` is a brand-new Coach Grade slot — pre-launch stride
     length & direction. Null on legacy reports. Sits at the head of
     the row since it's the first checkpoint chronologically in the
     swing sequence (stride → counter → posture → ...). */
  { key: 'stride',      label: 'Stride',       hint: 'Stride length & direction from load to launch.',            options: ['Short', 'Long', 'Square', 'Open'] },
  { key: 'stretch',     label: 'Counter',      hint: 'Length & separation between hips and shoulders at launch.', options: ['Rhythmic', 'Good', 'Stuck', 'None'] },
  { key: 'posture',     label: 'Posture',      hint: 'Spine angle from set-up through contact.',                  options: ['Tall', 'Hinged', 'Forward', 'Back'] },
  { key: 'core',        label: 'Stability',    hint: 'Balance and base — head-still through finish.',             options: ['+Stack', '-Stack', '+Lead Leg', '-Lead Leg'] },
  { key: 'slot',        label: 'Path',         hint: 'Bat-path / barrel route through the zone.',                 options: ['Steep', 'Flat', 'Uphill'] },
  { key: 'direction',   label: 'Direction',    hint: 'Bat path & body line working through the ball.',            options: ['Pull', 'Center', 'Oppo'] },
  { key: 'timing',      label: 'Timing',       hint: 'On-time launch — load → stride → swing in rhythm with the pitch.', options: ['Early', 'Late', 'On-Time', 'Inconsistent'] },
  /* `stability` relabeled "Slot" → "Adjust" + moved to the end (next to
     Timing). Data key unchanged so saved scores survive. */
  { key: 'stability',   label: 'Adjust', hint: 'In-swing adjustability — barrel/slot adjustment to the pitch.', options: ['Steep', 'Flat', 'Uphill'] },
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
  /** Strict per-active-report slot/manual presence flags. Each Hitting
   *  Snapshot section uses these to decide whether to render — derived
   *  ONLY from the active report's csvUploads + manual entries, never
   *  from carry-forward or other sources (e.g. at-bat XLSX). */
  hasActiveFullSwingData: boolean;
  hasActiveBlastData: boolean;
  hasActiveHitTraxData: boolean;
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
    hasActiveFullSwingData, hasActiveBlastData, hasActiveHitTraxData,
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
    /* Strict per-active-report scoping: each section reads ONLY metrics
       attached to the active HITTING report's CSV uploads. If the active
       report has no uploads, every aggregate stays empty and the
       corresponding section is hidden. */
    if (reportUploadIds.length === 0) {
      setHittraxVelos([]); setHittraxLAs([]); setHittraxDists([]);
      setFullswingVelos([]); setFullswingLAs([]); setFullswingDists([]);
      return;
    }
    api.getPlayerMetrics(player.id, { uploadIds: reportUploadIds })
      .then((metrics: any[]) => {
        if (cancelled) return;
        const htV: number[] = [], htLA: number[] = [], htD: number[] = [];
        const fsV: number[] = [], fsLA: number[] = [], fsD: number[] = [];
        for (const m of metrics) {
          if (!Number.isFinite(m.value)) continue;
          if (m.source === 'HITTRAX') {
            if (m.metricType === 'max_exit_velo') htV.push(m.value);
            else if (m.metricType === 'launch_angle') htLA.push(m.value);
            else if (m.metricType === 'distance') htD.push(m.value);
          } else if (m.source === 'FULL_SWING') {
            if (m.metricType === 'max_exit_velo') fsV.push(m.value);
            else if (m.metricType === 'launch_angle') fsLA.push(m.value);
            else if (m.metricType === 'distance') fsD.push(m.value);
          }
        }
        setHittraxVelos(htV.filter(v => v !== 0));
        setHittraxLAs(htLA);
        setHittraxDists(htD);
        setFullswingVelos(fsV.filter(v => v !== 0));
        setFullswingLAs(fsLA);
        setFullswingDists(fsD);
      })
      .catch(() => {
        if (cancelled) return;
        setHittraxVelos([]); setHittraxLAs([]); setHittraxDists([]);
        setFullswingVelos([]); setFullswingLAs([]); setFullswingDists([]);
      });
    return () => { cancelled = true; };
  }, [player?.id, refreshKey, reportUploadIds]);

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
  /* Strict per-active-report visibility: each section renders ONLY if the
     active report carries data for that section (CSV upload OR manual
     entry). At-bat XLSX, carry-forward from older reports, and other
     vendors' data CANNOT light up a section. */
  const hasCoachGrades = MANUAL_KEYS.some(({ key }) => manual[key] != null)
    || (manualOptions && Object.values(manualOptions).some(arr => (arr?.length ?? 0) > 0));
  const hasFullSwing = hasActiveFullSwingData;
  const hasBlast     = hasActiveBlastData;
  const hasHitTrax   = hasActiveHitTraxData;
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
        {/* Outer bubble wrapping Coach Grades + Full Swing + Blast Motion +
            HitTrax — shared profilePanel chrome (matches Player Summary).
            Now a flex column so each section's grey bubble sits with a
            16 px gap between them (replaced the old divider-line
            pattern). */}
        <div data-pdf-section="hitting-inputs" className={aStyles.profilePanel} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        <div style={hittingSectionBubbleStyle}>
        <SectionHeader
          icon={<CoachGradesIcon />}
          iconColor="green"
          title="Coach Grades"
          compact
          align="left"
        />

        {/* Break-&-Spin-style table — 8 columns, one per coach grade.
            Header row is the label (Fwd Move / Posture / Slot / etc.)
            and the data row shows each 20-80 grade in the per-band
            tone color. `singleLineLabels` matches the Coach Diagnosis
            GradeRow on the Hitting Snapshot so "Fwd Move" reads on
            one line here (instead of being split into "Fwd / Move"
            by the default balanced-splitter behaviour). */}
        <HittingMetricTable
          singleRow
          hideLabelDivider
          singleLineLabels
          items={MANUAL_KEYS.map(({ key, label }) => {
            const value = manual[key];
            return {
              label,
              display: value != null ? String(value) : '—',
              color: value != null ? scoreColor(value) : undefined,
            };
          })}
        />
        </div>
        ); })()}

        {/* ── FULL SWING — only when QoC metrics have data */}
        {hasFullSwing && (() => {
          renderedSections++;
          return (
        <div style={hittingSectionBubbleStyle}>
        <SectionHeader
          icon={<FullSwingLogo />}
          iconColor="gold"
          title="Full Swing"
          compact
          align="left"
        />
        {(() => {
          /* `%` and `°` are passed as the `unit` field (not glued
             into `display`) so they render in the muted-grey `unitStyle`
             instead of inheriting the value cell's tone colour — same
             treatment the `mph` / `ft` suffixes already had. */
          const fmt = (key: string, value: number): { display: string; unit?: string } => {
            switch (key) {
              case 'avg_exit_velo':
              case 'max_exit_velo':       return { display: value.toFixed(1), unit: 'mph' };
              case 'squared_up_pct':
              case 'full_swing_miss_pct':
              case 'overall_whiff_pct':
              case 'overall_barrel_pct':  return { display: value.toFixed(1), unit: '%' };
              case 'launch_angle':        return { display: value.toFixed(1), unit: 'deg' };
              case 'distance':            return { display: value.toFixed(0), unit: 'ft' };
              default:                    return { display: value.toFixed(1) };
            }
          };
          /* For metrics that BOTH HitTrax and Full Swing emit
             (avg_exit_velo / max_exit_velo / launch_angle / distance),
             ONLY use the Full-Swing-source-only override — never fall back
             to topMetricsWithMiss, since that pool contains HitTrax data
             for the same keys and would leak it into this section.
             For everything else (squared_up_pct, smash_factor, etc., which
             only Full Swing emits), fall through to topMetricsWithMiss. */
          const FULLSWING_ONLY_KEYS = new Set([
            'avg_exit_velo', 'max_exit_velo', 'launch_angle', 'distance',
          ]);
          const fsResolve = (k: string): { value: number; unit: string } | undefined => {
            if (fullswingOverride[k] !== undefined) return fullswingOverride[k];
            // Shared keys: never bleed in HitTrax data via topMetrics.
            if (FULLSWING_ONLY_KEYS.has(k)) return undefined;
            return topMetricsWithMiss[k];
          };
          return (
            <HittingMetricTable
              singleRow
              hideLabelDivider
              items={QOC_KEYS.map(k => {
                const m = fsResolve(k);
                /* Prefer SHORT_LABELS so the Full Swing column
                   headers read with the SAME label text the
                   Quality-of-Contact GradeRow uses on the Hitting
                   Snapshot (and so the two-line balanced splitter
                   produces the same line breaks across both views). */
                const label = SHORT_LABELS[k] || METRIC_LABELS[k] || k;
                if (!m) return { label, display: '—' };
                const grade = metricToGrade(
                  { [k]: { value: m.value, unit: m.unit, recordedAt: '' } } as any,
                  k,
                );
                const f = fmt(k, m.value);
                return {
                  label,
                  display: f.display,
                  unit: f.unit,
                  color: grade !== null ? scoreColor(grade) : undefined,
                };
              })}
            />
          );
        })()}
        </div>
        ); })()}

        {/* ── BLAST MOTION — only when at least one swing metric grade is set */}
        {hasBlast && (() => {
          renderedSections++;
          return (
        <div style={hittingSectionBubbleStyle}>
        <SectionHeader
          icon={<BlastLogo />}
          iconColor="teal"
          title="Blast Motion"
          compact
          align="left"
        />

        {(() => {
          /* Per the Blast Motion CSV spec, this section surfaces
             every Swing metric that has data — keys with no value
             are skipped. Then the items are PARTITIONED into two
             explicit rows:
               Row 1: every metric NOT in BLAST_ROW2_KEYS
               Row 2: Connection Score, Plane Score, Early Connection,
                      Connection at Impact
             The Swing GradeRow chip strip above renders a fixed list
             of six chips; this bubble is the comprehensive view. */
          const BLAST_ROW2_KEYS = new Set<string>([
            'plane_score',
            'connection_score',
            'rotation_score',
            'early_connection',
            'connection_at_impact',
          ]);
          const buildItem = (k: typeof SWING_METRIC_KEYS[number]): HittingMetricCell => {
            const m = topMetricsWithMiss[k];
            const grade = metricGrades[k];
            const label = SHORT_LABELS[k] || SCORE_LABEL_OVERRIDES[k] || METRIC_LABELS[k] || k;
            if (!m) return { label, display: '—' };
            const display = k === 'time_to_contact'
              ? m.value.toFixed(2)
              : m.value.toFixed(1);
            const isAngle = k === 'plane_angle' || k === 'attack_angle'
              || k === 'early_connection' || k === 'connection_at_impact';
            const unit = isAngle
              ? 'deg'
              : (m.unit === '°' ? 'deg' : (m.unit || undefined));
            return {
              label,
              display,
              unit,
              color: grade !== null ? scoreColor(grade) : undefined,
            };
          };
          const populated = SWING_METRIC_KEYS.filter(k => !!topMetricsWithMiss[k]);
          const row1Keys = populated.filter(k => !BLAST_ROW2_KEYS.has(k));
          const row2Keys = populated.filter(k => BLAST_ROW2_KEYS.has(k));
          const row1Items = row1Keys.map(buildItem);
          const row2Items = row2Keys.map(buildItem);
          const combinedItems = [...row1Items, ...row2Items];
          /* If row 2 is empty (no spec-row-2 keys have data) just
             render the single row 1 — `rows` only kicks in when we
             actually have row-2 content. */
          return (
            <HittingMetricTable
              singleRow={row2Items.length === 0}
              hideLabelDivider
              items={combinedItems}
              rows={row2Items.length > 0 ? [row1Items, row2Items] : undefined}
            />
          );
        })()}
        </div>
        ); })()}

        {/* ── HITTRAX — only when at least one HitTrax metric has data */}
        {hasHitTrax && (() => {
          renderedSections++;
          return (
        <div style={hittingSectionBubbleStyle}>
        <SectionHeader
          icon={<HitTraxLogo />}
          iconColor="red"
          title="HitTrax"
          compact
          align="left"
        />

        {(() => {
          /* Same number formatting as the Full Swing card so values read
             consistently across both sections. `°` passed as `unit`
             (not glued onto `display`) so it renders in the muted-grey
             unit style instead of the tone-coloured value style. */
          const fmt = (key: string, value: number): { display: string; unit?: string } => {
            switch (key) {
              case 'avg_exit_velo':
              case 'max_exit_velo':  return { display: value.toFixed(1), unit: 'mph' };
              case 'launch_angle':   return { display: value.toFixed(1), unit: 'deg' };
              case 'distance':       return { display: value.toFixed(0), unit: 'ft' };
              default:               return { display: value.toFixed(1) };
            }
          };
          return (
            <HittingMetricTable
              singleRow
              hideLabelDivider
              items={HITTRAX_KEYS.map(k => {
                const m = hitTraxValues[k];
                /* Pull labels from SHORT_LABELS so the HitTrax column
                   headers read with the SAME label text the
                   Quality-of-Contact GradeRow uses on the Hitting
                   Snapshot. Previous behaviour glued "AVG " prefixes
                   onto Launch Angle / Distance to signal that HitTrax
                   shows session means, but the user spec now wants
                   the Inputs sections to share label text + line
                   breaks with the Snapshot row above. */
                const label = SHORT_LABELS[k] || METRIC_LABELS[k] || k;
                if (!m) return { label, display: '—' };
                /* Synthetic single-entry topMetrics so metricToGrade
                   sees the same averaged value the table displays. */
                const grade = metricToGrade(
                  { [k]: { value: m.value, unit: m.unit, recordedAt: '' } } as any,
                  k,
                );
                const f = fmt(k, m.value);
                return {
                  label,
                  display: f.display,
                  unit: f.unit,
                  color: grade !== null ? scoreColor(grade) : undefined,
                };
              })}
            />
          );
        })()}
        </div>
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
/* Quality of Contact chip strip — 8 metrics (4 chips × 2 rows after the
   layout bump). Smash Factor (SmashFactor column from Full Swing CSV)
   was added per spec; it averages across all swings the same way EV /
   Sq-Up / Barrel do. */
const QOC_KEYS = [
  'avg_exit_velo', 'max_exit_velo', 'squared_up_pct', 'smash_factor',
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
    case 'max_bat_speed':           return value.toFixed(1);
    case 'avg_bat_speed':           return value.toFixed(1);
    case 'time_to_contact':         return value.toFixed(2);
    case 'on_plane_efficiency':     return `${value.toFixed(0)}%`;
    case 'connection_at_contact':   return value.toFixed(0);
    case 'rotational_acceleration': return value.toFixed(1);
    case 'power_output':            return value.toFixed(2);
    case 'peak_hand_speed':         return value.toFixed(1);
    case 'avg_exit_velo':
    case 'max_exit_velo':           return value.toFixed(1);
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

/* Long-form chip labels for the Swing / Quality of Contact / Coach
   Diagnosis rows in the Hitting Snapshot. The bubble chrome that
   used to wrap each chip was retired, freeing horizontal room for
   these descriptive names. Labels can wrap to a second line on
   narrow widths thanks to the chip column's flexible text layout.
   The underlying data keys are unchanged so all downstream wiring
   (scoring, PDFs, charts, etc.) still resolves the same way. */
const SHORT_LABELS: Record<string, string> = {
  // Swing mechanics
  max_bat_speed: 'Max Bat Speed',
  avg_bat_speed: 'Avg Bat Speed',
  attack_angle: 'Attack Angle',
  plane_angle: 'Vert Bat Angle',
  time_to_contact: 'Time to Contact',
  on_plane_efficiency: 'Plane Score',
  power_output: 'Power (Kwh)',
  peak_hand_speed: 'Hand Speed',
  connection_at_contact: 'Conn', // legacy alias kept for backward compat
  rotational_acceleration: 'Rot', // legacy alias kept for backward compat
  /* New Blast CSV-spec metrics — these chip labels render in the
     Swing chip strip and the Blast Motion Inputs section whenever
     a manual entry (or future CSV column) provides a value. Labels
     spelled out in full per coach spec (no abbreviations); the
     `splitLabelBalanced` helper handles wrapping for narrow columns. */
  plane_score: 'Plane Score',
  connection_score: 'Connection Score',
  rotation_score: 'Rotation Score',
  early_connection: 'Early Connection',
  connection_at_impact: 'Connection at Impact',
  // Manual / Coach Diagnosis
  manual_forwardMove: 'Fwd Move',
  manual_posture: 'Posture',
  /* Chip short-labels for the Coach Diagnosis row — same data-key
     rotation as the full labels above. `Stable` (was the abbreviation
     for stability) is now `Slot`; `Core` becomes `Stability`; `Slot`
     becomes `Path`. */
  manual_stability: 'Adjust',
  manual_direction: 'Direction',
  manual_stretch: 'Counter',
  manual_core: 'Stability',
  manual_slot: 'Path',
  manual_timing: 'Timing',
  manual_stride: 'Stride',
  // QoC
  avg_exit_velo: 'Avg Exit Velocity',
  max_exit_velo: 'Max Exit Velocity',
  squared_up_pct: 'Squared Up %',
  smash_factor: 'Smash Factor',
  full_swing_miss_pct: 'Miss %',
  /* `overall_whiff_pct` is defined in the Swing Decision section
     below so it carries the long-form "Whiff %" label everywhere
     it's referenced (no duplicate key here). */
  overall_barrel_pct: 'Barrel %',
  launch_angle: 'Launch Angle',
  /* Two-word label so the balanced splitter naturally stacks
     "(Feet)" beneath "Distance" — matches the "Top / unit" two-
     line treatment used by the rest of the Quality of Contact /
     HitTrax column labels (e.g. "Max Exit / Velocity"). */
  distance: 'Distance (Feet)',
  // Swing Decision — long-form, percent-suffixed labels so each chip
  // reads as a full stat name across the wider Swing Decision rows.
  /* "Fastball" / "Off-Speed" prefixes retired from these labels —
     the parent GradeRow ("Fastballs" / "Offspeed" bubble titles)
     already disambiguates which pitch family each chip strip
     refers to, so the chip labels can be the short stat names. */
  fb_barrel_pct: 'Barrel %',
  os_barrel_pct: 'Barrel %',
  fb_whiff_pct: 'Whiff %',
  os_whiff_pct: 'Whiff %',
  fb_chase_pct: 'Chase %',
  os_chase_pct: 'Chase %',
  overall_whiff_pct: 'Whiff %',
  overall_chase_pct: 'Chase %',
  overall_bb_pct: 'BB %',
  overall_k_pct: 'K %',
  /* Results-row keys — Groundball % and Fly Ball %. Tracked via
     placeholder metric keys (`ground_ball_pct` / `fly_ball_pct`) that
     can be populated by future CSV/manual entries. Until then the
     chips render with their proper labels and a "—" value.
     A non-breaking space ( ) keeps "Groundball" and "%" pinned
     to the same line — without it the chip's natural word-wrap
     dropped the "%" onto a second row. */
  ground_ball_pct: 'GB %',
  fly_ball_pct: 'FB %',
  line_drive_pct: 'LD %',
  fb_in_zone_swing_pct: 'FB Zone Swing',
  os_in_zone_swing_pct: 'OS Zone Swing',
  overall_in_zone_swing_pct: 'Zone Swing',
};

export function HittingGradeStack({
  topMetrics, manual, metricGrades, isCoach,
  diagnosisNotes, setDiagnosisNotes,
  subTabBar,
  subTab = 'swing',
  qocOverride,
  omitResultsRow = false,
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
  /** Optional per-source overrides for the QoC chips. When a key is present
   *  here, it replaces the matching entry from `topMetrics` in the QoC row,
   *  so the Hitting Snapshot can show HitTrax-source averages (matching the
   *  HitTrax section) when HitTrax data exists, falling back to Full Swing
   *  source averages, then to topMetrics for any keys not in the override. */
  qocOverride?: Record<string, { value: number; unit: string }>;
  /** When true and `subTab === 'decision'`, the Results GradeRow is
   *  omitted from this stack. HittingTab uses this to lift Results
   *  out of the right-column grade list and render it below the
   *  Spray Chart in the left column instead. */
  omitResultsRow?: boolean;
}) {
  // Swing row — show raw metric values (chip color still derived from the 20-80 grade)
  /* Per the Blast Motion CSV spec sheet (Row 4 = Swing Bubble),
     the Swing GradeRow chip strip shows exactly SIX metrics:
       1. Max Bat Speed
       2. Avg Bat Speed
       3. Attack Angle
       4. Vert Bat Angle  (data key: `plane_angle`)
       5. Time to Contact
       6. Power           (data key: `power_output` — the merge
                            below aliases the manual "Power (Kwh)"
                            entry stored under `rotational_acceleration`
                            into this slot)
     The Hitting Inputs / Blast Motion section iterates the full
     SWING_METRIC_KEYS list with a per-key has-data filter so it
     shows every metric the report actually carries data for. */
  const SWING_GRADEROW_KEYS = [
    'max_bat_speed',
    'avg_bat_speed',
    'attack_angle',
    'plane_angle',
    'time_to_contact',
    'power_output',
  ] as const;
  const swingChips = SWING_GRADEROW_KEYS.map(k => {
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
  // Source-aware: an override map (HitTrax-first, then Full Swing) replaces
  // the matching topMetrics entries so the snapshot's EV / LA / Dist match
  // the HitTrax section when HitTrax data is loaded, and the Full Swing card
  // when only Full Swing data is loaded.
  const qocSourceMetrics: Record<string, { value: number; unit: string; recordedAt: string }> = qocOverride
    ? Object.entries(qocOverride).reduce((acc, [k, v]) => {
        acc[k] = { ...v, recordedAt: topMetrics[k]?.recordedAt ?? new Date().toISOString() };
        return acc;
      }, { ...topMetrics } as Record<string, { value: number; unit: string; recordedAt: string }>)
    : topMetrics;
  // GradeRow chip strip drops `overall_barrel_pct` ("Barrel %") and
  // `full_swing_miss_pct` ("Miss %") so the Quality of Contact
  // strip surfaces only the six core metrics requested. The Hitting
  // Inputs / Full Swing section still iterates the full QOC_KEYS
  // list — only this Snapshot strip is trimmed.
  const QOC_GRADEROW_KEYS = QOC_KEYS.filter(
    (k) => k !== 'overall_barrel_pct' && k !== 'full_swing_miss_pct',
  );
  const qocChips = QOC_GRADEROW_KEYS.map(k => {
    const m = qocSourceMetrics[k];
    return {
      key: k,
      label: SHORT_LABELS[k] || k,
      grade: metricToGrade(qocSourceMetrics, k),
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
  /* Swing-Decision groups bundled by PITCH-FAMILY (per latest spec):
       Fastballs   — FB Barrel, FB Whiff, FB Chase
       Offspeed    — OS Barrel, OS Whiff, OS Chase
       Overall     — Overall Barrel, Overall Whiff, Overall Chase
       Decision    — FB Zone Swing, OS Zone Swing, Overall Zone Swing,
                     Overall Chase   (K% removed — it now lives in the
                                       Results row below)
       Results     — Barrel %, GB %, FB %, K %, BB %
     Reads more naturally than the old "by stat" grouping (all barrels
     together, all whiffs together, etc.). */
  const fastballGroup = buildGroup(['fb_barrel_pct', 'fb_whiff_pct', 'fb_chase_pct']);
  const offspeedGroup = buildGroup(['os_barrel_pct', 'os_whiff_pct', 'os_chase_pct']);
  const overallGroup  = buildGroup(['overall_barrel_pct', 'overall_whiff_pct', 'overall_chase_pct']);
  const decisionGroup = buildGroup(['fb_in_zone_swing_pct', 'os_in_zone_swing_pct', 'overall_in_zone_swing_pct', 'overall_chase_pct']);
  const resultsGroup  = buildGroup(['overall_barrel_pct', 'ground_ball_pct', 'fly_ball_pct', 'line_drive_pct', 'overall_k_pct', 'overall_bb_pct']);

  // Coach Diagnosis row — all 8 manual scores. Labels rotate per the
  // latest spec (data keys unchanged so saved scores stay attached):
  //   stability → "Slot"
  //   core      → "Stable"  (was "Core")
  //   slot      → "Path"    (was "Slot")
  /* Order (post-Fwd-Move retirement): Counter, Posture, Stability,
     Slot, Path, Direction, Timing. Same data keys as before — only
     the visual order changes. `manual_forwardMove` was removed from
     this chip strip per spec; the `manual.forwardMove` grade still
     lives on the ManualSwingScores type and persists through save
     cycles, it's just no longer surfaced in the Coach Diagnosis
     row. Mirror change in MANUAL_KEYS keeps Coach Grades aligned. */
  const diagnosisChips: { key: string; label: string; grade: number | null }[] = [
    { key: 'manual_stride',      label: 'Stride',     grade: manual.stride },
    { key: 'manual_stretch',     label: 'Counter',    grade: manual.stretch },
    { key: 'manual_posture',     label: 'Posture',    grade: manual.posture },
    { key: 'manual_core',        label: 'Stability',  grade: manual.core },
    { key: 'manual_slot',        label: 'Path',       grade: manual.slot },
    { key: 'manual_direction',   label: 'Direction',  grade: manual.direction },
    { key: 'manual_timing',      label: 'Timing',     grade: manual.timing },
    { key: 'manual_stability',   label: 'Adjust', grade: manual.stability },
  ];
  const diagnosisComposite = averageGrades(diagnosisChips.map(c => c.grade));

  return (
    <div
      // Hitting Grades wrapper — bubble chrome retired. The wrapper
      // is now a transparent flex column that holds the label, the
      // sub-tab nav, and the three GradeRow bubbles (Swing / Quality
      // of Contact / Coach Diagnosis). Each row carries its OWN
      // Movement-Plot bubble chrome via `GradeRow` below so the
      // three grade groups read as three separate bubbles stacked
      // in the column.
      //
      // `minHeight: 100%` was previously here to make the stack fill
      // the snapshot's right column (so its bottom edge aligned with
      // the spray chart's bottom on the left). It's been retired now
      // that the per-report Coach Reviews panel sits BELOW this stack
      // in the right column — that panel's own `flex: 1` consumes
      // whatever vertical space the stack doesn't, landing the
      // column's bottom flush with the spray chart on the left.
      // Leaving minHeight here would force this stack to consume the
      // ENTIRE column height and push Coach Reviews into overflow
      // below the snapshot bubble.
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        width: '100%',
      }}
    >
      {/* Hitting Grades eyebrow label retired — the sub-tab nav
          (Swing / Swing Decision) now reads as the leading row of
          the stack, with the three grade bubbles directly underneath. */}
      {subTabBar /* Swing / Swing Decision sub-tab nav sits below the label. */}

      {subTab === 'decision' ? (
        <>
          {/* Results — pinned to the TOP of the Swing Decision stack
              so its strip of "what actually happened at the plate"
              metrics (Barrel %, GB %, FB %, K %, BB %) leads the
              column. Rendered in `metricsOnly` mode: no composite
              grade number, no progress bar — just the label + the
              5-chip strip — so the bubble height matches the Spray
              Chart's Ball Readout sibling that sits at the top of
              the left column. Suppressed when `omitResultsRow` is
              set — HittingTab lifts this row into the left column
              (below the SprayChartView) for the Swing Decision
              view so the spray chart sits directly above the
              results-summary strip it analyses. */}
          {!omitResultsRow && (
            <GradeRow label="Results" grade={resultsGroup.composite} chips={resultsGroup.chips} metricsOnly singleLineLabels />
          )}
          {/* Decision lifted above Fastballs per spec — the
             composite-decision number now leads the right-column
             stack so the coach sees the at-a-glance plate-discipline
             score before drilling into the per-pitch-family chips
             below. Progress bar retired on all four rows
             (`hideProgressBar`) — the per-chip values already tell
             the breakdown story; the bar was visual redundancy. */}
          <GradeRow label="Decision"  grade={decisionGroup.composite} chips={decisionGroup.chips} hideProgressBar />
          <GradeRow label="Fastballs" grade={fastballGroup.composite} chips={fastballGroup.chips} hideProgressBar />
          <GradeRow label="Offspeed"  grade={offspeedGroup.composite} chips={offspeedGroup.chips} hideProgressBar />
          <GradeRow label="Overall"   grade={overallGroup.composite}  chips={overallGroup.chips}  hideProgressBar />
        </>
      ) : (
        <>
          <GradeRow label="Swing"              grade={swingComposite}     chips={swingChips} hideProgressBar />
          <GradeRow label="Quality of Contact" grade={qocComposite}       chips={qocChips} hideProgressBar />
          <GradeRow label="Mechanical Grades"  grade={diagnosisComposite} chips={diagnosisChips} singleLineLabels hideProgressBar />
          {/* Diagnosis Notes moved out of this bubble — it now lives directly
              under the entire Spray Chart + Grade Stack row in HittingTab so
              it has the full Snapshot width to breathe. */}
        </>
      )}
    </div>
  );
}

/* Standalone "Results" GradeRow — rebuilt from `topMetrics` +
   `metricGrades` so HittingTab can render it under the Spray Chart
   in the Swing Decision view's left column. Same `metricsOnly`
   treatment, same chip ordering (Barrel % / GB % / FB % / K % /
   BB %) as the row that used to lead the GradeStack column. */
export function SwingDecisionResultsRow({
  topMetrics, metricGrades, noOuterChrome = false,
}: {
  topMetrics: Record<string, { value: number; unit: string; recordedAt: string }>;
  metricGrades: Record<string, number | null>;
  /** Forwarded to GradeRow so the Results row can render WITHOUT
   *  its warm-grey bubble chrome when hosted inside a parent
   *  bubble (e.g., the combined Results + Spray bubble in the
   *  Decision view). */
  noOuterChrome?: boolean;
}) {
  const RESULTS_KEYS = ['overall_barrel_pct', 'ground_ball_pct', 'fly_ball_pct', 'line_drive_pct', 'overall_k_pct', 'overall_bb_pct'] as const;
  const chips = RESULTS_KEYS.map(k => {
    const m = topMetrics[k];
    return {
      key: k,
      label: SHORT_LABELS[k] || k,
      grade: metricToGrade(topMetrics, k),
      display: m ? formatRawChip(k, m.value) : undefined,
    };
  });
  const composite = averageGrades(chips.map(c => c.grade));
  /* Suppress `metricGrades` unused warning by referencing it for the
     chip color (matches the GradeStack build pattern). */
  void metricGrades;
  return <GradeRow label="Results" grade={composite} chips={chips} metricsOnly singleLineLabels noOuterChrome={noOuterChrome} />;
}

export function NoteBlock({
  label, value, onChange, placeholder, editable, fill = false, rows, largeLabel = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  editable: boolean;
  /** Make the block grow to fill remaining height of its flex parent. */
  fill?: boolean;
  /** Override the default textarea row count (only used when !fill). */
  rows?: number;
  /** Swap the label from the small Font-D eyebrow (9.5 px / 0.22em
   *  tracking / weight 700) to the larger Font-B title (1rem / 0.025em
   *  tight tracking / weight 600 / brighter white). Used by the
   *  Hitting Notes block so its label visually matches the Pitching
   *  Notes label in the Pitching tab. */
  largeLabel?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      paddingBottom: fill ? 0 : 12,
      borderBottom: fill ? 'none' : '1px solid var(--border)',
      flex: fill ? '1 1 auto' : '0 0 auto',
      minHeight: 0,
    }}>
      <span style={largeLabel
        ? {
            /* Font B — matches the "Pitching Notes" eyebrow in
               PitchingTab.tsx exactly. */
            fontFamily: 'inherit', fontSize: '1rem',
            fontStyle: 'normal', fontWeight: 600,
            letterSpacing: '-0.025em', textTransform: 'uppercase',
            color: 'var(--text-bright)', lineHeight: 1.05,
          }
        : {
            fontSize: rem(9.5), fontWeight: 700, letterSpacing: '0.22em',
            textTransform: 'uppercase', color: 'var(--text-bright)',
          }
      }>
        {label}
      </span>
      {editable ? (
        <RichEditableNote
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          minHeight={(rows ?? 2) * 22 + 24}
          fill={fill}
        />
      ) : (
        <div
          /* Render HTML so Bold / Italic / Underline applied in the report
             modal's notes editor render correctly here too. Plain-text
             notes (no tags) read through unchanged. */
          dangerouslySetInnerHTML={{ __html: value || '<em style="color:var(--text-muted)">No notes yet.</em>' }}
          style={{
            fontSize: rem(14), lineHeight: 1.55,
            color: 'var(--text)',
            padding: fill ? '10px 12px' : '6px 2px',
            /* Theme-aware Notes surface — `--notes-bg` resolves to
               dark-navy in dark mode and the off-white
               `--bubble-chrome-bg` gradient in light mode so the
               Notes block matches Swing / Spray Chart / Metric
               Readout in the Hitting Snapshot. */
            background: fill ? 'var(--notes-bg)' : 'transparent',
            border: fill ? '1px solid var(--border)' : 'none',
            borderRadius: fill ? 7 : 0,
            flex: fill ? '1 1 auto' : '0 0 auto',
            minHeight: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        />
      )}
    </div>
  );
}

/* Rich contenteditable note — Bold / Italic / Underline toolbar above a
   contenteditable surface. Stores HTML in `value`; mirrors the report
   modal's RichNotesEditor so a note edited in either place reads back
   identically. Heights aren't clipped — the surface auto-grows with
   content. */
function RichEditableNote({
  value, onChange, placeholder, minHeight, fill,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  minHeight: number;
  fill: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // Sync external value changes into the surface without clobbering the
  // caret on every keystroke.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  const exec = (cmd: 'bold' | 'italic' | 'underline') => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand(cmd);
    onChange(el.innerHTML);
  };

  /* Text-size control — mirrors the report modal's RichTextEditor Size
     dropdown. execCommand('fontSize', 1-7) wraps the current selection
     (or the next typed text if nothing is selected) in a sized tag.
     2 = Small, 3 = Normal, 5 = Large, 6 = XL. Persists in the note HTML
     so it renders at the chosen size on the read-only display too. */
  const applyFontSize = (size: string) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand('fontSize', false, size);
    onChange(el.innerHTML);
  };

  const ToolbarBtn = ({
    cmd, label, style,
  }: { cmd: 'bold' | 'italic' | 'underline'; label: string; style: React.CSSProperties }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}
      style={{
        width: 28, height: 24, borderRadius: 4,
        border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.04)',
        color: 'var(--text)', fontSize: rem(12), lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...style,
      }}
      aria-label={cmd}
    >{label}</button>
  );

  const isEmpty = !value || value === '<br>' || value.replace(/<[^>]+>/g, '').trim() === '';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      flex: fill ? '1 1 auto' : '0 0 auto',
      minHeight: 0,
    }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <ToolbarBtn cmd="bold"      label="B" style={{ fontWeight: 800 }} />
        <ToolbarBtn cmd="italic"    label="I" style={{ fontStyle: 'italic' }} />
        <ToolbarBtn cmd="underline" label="U" style={{ textDecoration: 'underline' }} />
        {/* Text-size control — Small / Normal / Large / XL. Applies to the
            selection, or to the next text typed if nothing is selected. */}
        <select
          aria-label="Text size"
          defaultValue=""
          onMouseDown={(e) => { e.preventDefault(); ref.current?.focus(); }}
          onChange={(e) => { if (e.target.value) applyFontSize(e.target.value); e.currentTarget.value = ''; }}
          style={{
            height: 24, borderRadius: 4, padding: '0 4px', marginLeft: 2,
            border: '1px solid var(--border)', background: 'rgba(255,255,255,0.04)',
            color: 'var(--text)', fontSize: rem(12), cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <option value="" disabled>Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="5">Large</option>
          <option value="6">XL</option>
        </select>
      </div>
      <div style={{ position: 'relative', flex: fill ? '1 1 auto' : '0 0 auto' }}>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            /* Theme-aware Notes editor surface — `--notes-bg`
               resolves to dark-navy in dark mode and the off-white
               `--bubble-chrome-bg` gradient in light mode so the
               editor matches Swing / Spray Chart / Metric Readout
               in the Hitting Snapshot when the coach is typing. */
            background: 'var(--notes-bg)',
            border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 7,
            padding: '10px 12px',
            color: 'var(--text)',
            fontSize: rem(14), lineHeight: 1.55,
            minHeight,
            outline: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            transition: 'border-color 0.12s ease',
          }}
        />
        {isEmpty && (
          <div style={{
            position: 'absolute', top: 10, left: 12,
            color: 'var(--text-muted)', fontStyle: 'italic',
            pointerEvents: 'none', fontSize: rem(14), lineHeight: 1.55,
          }}>
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}

/* Textarea that auto-grows with content — height tracks scrollHeight on
   every keystroke so nothing the coach types ever gets clipped or hidden
   behind a scrollbar. Manual vertical drag is also enabled so the coach
   can stretch it further if they want. */
function AutoGrowTextarea({
  value, onChange, placeholder, rows, fill,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  rows: number;
  fill: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Recompute height whenever the text changes (initial mount included).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset to auto first so shrinking also works (otherwise scrollHeight
    // only ever grows). Then set to the actual content height.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={fill ? undefined : rows}
      style={{
        background: 'rgba(20,24,32,0.85)',
        border: '1px solid var(--border)',
        color: 'var(--text)',
        padding: '10px 12px',
        borderRadius: 7,
        fontSize: rem(14),
        lineHeight: 1.55,
        // No internal scrollbar — height auto-fits the content.
        resize: 'vertical',
        overflow: 'hidden',
        fontFamily: 'inherit',
        minHeight: fill ? 0 : 52,
        flex: fill ? '1 1 auto' : '0 0 auto',
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  );
}

function GradeRow({
  label, grade, chips, metricsOnly = false, singleLineLabels = false, hideProgressBar = false, noOuterChrome = false,
}: {
  label: string;
  grade: number | null;
  chips: { key: string; label: string; grade: number | null; display?: string }[];
  /** When true, render only the row label + the underlying-metric
   *  chips — the composite grade number and the score progress bar
   *  are hidden. Used for the Swing-Decision "Results" row where the
   *  underlying %s tell the story on their own. */
  metricsOnly?: boolean;
  /** When true, suppresses ONLY the progress bar — composite grade
   *  number, title row, and chip table all still render. Used by the
   *  Decision / Fastballs / Offspeed / Overall rows on the Swing
   *  Decision view per spec: the per-pitch-family chips already
   *  visualise the breakdown, so the bar is redundant. */
  hideProgressBar?: boolean;
  /** Drop the warm-grey Movement-Plot bubble chrome on the outer
   *  wrapper (background gradient + border + radius). The parent
   *  supplies the bubble surface in this mode, so the GradeRow
   *  becomes a transparent layout container that hosts the title
   *  row + accent rule + chip table on the parent's surface. */
  noOuterChrome?: boolean;
  /** Forwards to `HittingMetricTable` so each column-header label
   *  renders on a single line instead of the balanced two-line
   *  stack. Used by the Coach Diagnosis row where the labels are
   *  short enough (≤ 8 chars) that a one-liner reads cleaner. */
  singleLineLabels?: boolean;
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
      // Each GradeRow wears the canonical Movement-Plot bubble
      // chrome — same warm-grey gradient the Pitch Report Arsenal
      // cards (Curveball / Fastball / etc.) use, so the Swing /
      // Quality of Contact / Coach Diagnosis bubbles read in the
      // same color across the Hitting and Pitching tabs.
      // When `noOuterChrome` is on (combined Results + Spray bubble
      // in the Swing Decision view), the chrome is dropped and the
      // GradeRow becomes a transparent layout container — the
      // surrounding parent bubble supplies the warm-grey surface.
      ...(noOuterChrome ? {} : movementPlotBubbleStyle),
      display: 'flex',
      flexDirection: 'column',
      /* When metricsOnly is on (Results row), the bubble has no
         composite-grade number + progress bar, so the contents are
         shorter. Drop the inner gap and use a slightly tighter
         vertical padding. Fixed `height: 96` + `overflow: hidden`
         RETIRED — that was matching the Metric Readout sibling that
         used to sit at the top of the left column. With the readout
         replaced by this Results row, the bubble shrink-wraps to
         its natural content height so the chip strip's column
         labels AND values both fully render. */
      /* Symmetric 10 px padding on top and bottom was the original
         design so the spacing between the outer grey GradeRow and
         the inner Swing bubble was identical on both sides. The
         TOP padding is now halved (10 → 5) per coach-spec — the
         label ("SWING" / "QUALITY OF CONTACT" / "COACH DIAGNOSIS")
         was sitting too deep below the bubble's top edge and the
         coach wanted that gap cut in half. Bottom padding stays at
         10 / 12 so the chip table still has full breathing room
         above the bubble's lower edge. Combined with the inner
         bubble's halved top-padding below, total top whitespace
         drops from 20 px → 10 px. */
      /* `hideProgressBar` rows (Decision / Fastballs / Offspeed /
         Overall on the Swing Decision view) borrow the same tighter
         gap + padding the `metricsOnly` Results bubble uses so all
         five Decision-view rows render at matching vertical size.
         `noOuterChrome` mode (combined Results + Spray bubble)
         drops the padding + minHeight — the parent bubble owns
         spacing in that context, so the Results section sits flush
         with the top of the combined surface. */
      gap: (metricsOnly || hideProgressBar) ? 4 : 10,
      padding: noOuterChrome
        ? 0
        : (metricsOnly || hideProgressBar) ? '5px 14px 12px' : '5px 14px 10px',
      /* Fixed minimum height for all Decision-view bubbles so the
         Results row (single-line labels, naturally shorter chip
         table) doesn't appear shorter than the Decision / Fastballs
         / Offspeed / Overall rows (multi-word labels that wrap to
         two lines via the balanced splitter, taller chip table).
         Picks the taller natural height as the floor — bubbles with
         single-line labels get a touch of extra vertical breathing
         room rather than being squeezed. Dropped in `noOuterChrome`
         mode — the combined Results + Spray bubble shrinks the
         Results section to its natural content height so the chart
         below gets the freed vertical space. */
      minHeight: noOuterChrome ? undefined : (metricsOnly || hideProgressBar) ? 130 : undefined,
      /* `flexGrow` retired here so the outer GradeRow shrink-wraps
         to its content — same treatment as the inner Swing bubble
         just above. Previously the outer wrapper stretched (via
         flexGrow: 1) to share vertical space with siblings in the
         GradeStack column; with the inner bubble no longer stretching
         either, the outer's flexGrow left visible empty grey space
         between the inner bubble's bottom and the outer's bottom
         border. Both bubbles now collapse to their natural content
         height so the outer's bottom sits right below the inner's
         bottom + the symmetric 10 px padding. */
    }}>
      {/* Inner bubble — wraps the ENTIRE header (label + composite
          grade + accent hairline) AND the chart content (progress
          bar + chips). Background stacks 10 % black on top of the
          5 % white wash, so the inner bubble shifts ~10 % darker
          than its previous state to match the matching trim on the
          outer GradeRow wrapper (also dropped 10 %). The two-tier
          hierarchy (outer slightly darker grey → inner slightly
          lighter graphite) stays intact at the new darker baseline.
          Border + top-edge glint + tiny drop shadow kept so the
          bubble still reads as a contained surface. */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        /* Inner-bubble gap follows the same `metricsOnly ||
           hideProgressBar` rule the outer wrapper uses so the
           Decision-view rows match the Results bubble's internal
           rhythm exactly (4 px between title row → accent rule →
           chip table). */
        gap: (metricsOnly || hideProgressBar) ? 4 : 8,
        /* Bottom padding 10 px so the bubble's bottom edge sits
           exactly 10 px below the new white line under the numbers —
           matching the 10 px the numbers themselves sit above and
           below their bounding lines. `flexGrow` retired here so the
           inner bubble SHRINK-WRAPS to its content; previously the
           bubble stretched to fill the outer GradeRow's height,
           which left visible empty space between the new white line
           and the bubble's bottom border.

           TOP padding halved (10 → 5) per coach-spec to pull the
           "SWING" / "QUALITY OF CONTACT" / "COACH DIAGNOSIS" label
           up closer to the bubble's top edge. Combined with the
           outer wrapper's halved top padding above (also 10 → 5),
           the label-to-bubble-top whitespace drops from 20 px → 10
           px — exactly half. */
        padding: '5px 12px 10px',
        /* Inner bubble chrome (background + border + box-shadow)
           retired — the layer collapses into a plain container so
           only the outer grey GradeRow wraps the GradeRow content.
           White rules (accent line under the label header, lines
           above and below the numbers in the chip table) are
           preserved. To revert: restore the previous background /
           border / box-shadow trio with the 10 % black overlay over
           5 % white wash. */
        minHeight: 0,
      }}>
        {/* Header row — label on the LEFT, inline accent hairline
            running across the middle, composite grade on the RIGHT.
            Mirrors the Pitch Report header pattern: the trailing
            hairline sits inside this row (between label and grade)
            instead of as a separate sibling below.
            `metricsOnly` (Results row) switches the row to
            `alignItems: 'center'` so the title text sits at the row's
            vertical centre — the hairline below then uses
            `alignSelf: 'center'` to land EXACTLY on the title's
            mid-line. Normal mode keeps `baseline` so the title and
            the 26-px composite grade share a baseline. */}
        <div style={{
          display: 'flex',
          alignItems: metricsOnly ? 'center' : 'baseline',
          gap: 10,
        }}>
          <span style={{
            /* GradeRow label (Swing / Quality of Contact / Coach
               Diagnosis on the Hitting Snapshot) — matched to the
               Break & Spin title style in the Pitching tab:
               Satoshi inherit, 1 rem (16 px), weight 600 normal,
               -0.025em letter-spacing, uppercase, white,
               line-height 1.05. Was previously 17.6 px. */
            fontFamily: 'inherit',
            fontSize: '1rem', fontWeight: 600, fontStyle: 'normal',
            letterSpacing: '-0.025em', textTransform: 'uppercase',
            color: 'var(--text-bright)', lineHeight: 1.05,
          }}>
            {label}
          </span>
          {/* In-row hairline — flex-grows between the label and grade.
              Normal mode: `alignSelf: flex-end` + `marginBottom: 12`
              lands the rule at the title's mid-line (≈ half the cap
              height of the 26 px grade font).
              `metricsOnly` (Results row): no grade reference height,
              so `alignSelf: center` puts the rule at the row's
              vertical centre, which (with the row's `alignItems:
              center` above) coincides exactly with the title text's
              vertical centre. */}
          <div
            aria-hidden="true"
            style={{
              flex: 1,
              height: 1,
              background: 'var(--border)',
              alignSelf: metricsOnly ? 'center' : 'flex-end',
              marginBottom: metricsOnly ? 0 : 12,
            }}
          />
          {/* Composite grade — visible in normal mode, INVISIBLE
             placeholder in `metricsOnly` mode (Results row). The
             placeholder still occupies the row's vertical space so
             the title row height stays identical across all
             Decision-view bubbles (Results / Decision / Fastballs
             / Offspeed / Overall), guaranteeing the bubbles stack
             at the exact same height in both columns. */}
          {!metricsOnly ? (
            <span style={{
              fontVariantNumeric: 'tabular-nums', fontWeight: 800,
              fontSize: rem(26), color: tone, letterSpacing: '-0.02em', lineHeight: 1,
            }}>
              {grade ?? '—'}
            </span>
          ) : (
            <span aria-hidden="true" style={{
              fontVariantNumeric: 'tabular-nums', fontWeight: 800,
              fontSize: rem(26), letterSpacing: '-0.02em', lineHeight: 1,
              visibility: 'hidden',
            }}>—</span>
          )}
        </div>

        {/* Big bar — 14 px tall, opaque fill so the score reads at a
            glance. Suppressed in metrics-only mode (Results row) where
            only the chips tell the story, OR when the caller passes
            `hideProgressBar` (Swing Decision view's Decision /
            Fastballs / Offspeed / Overall rows — the per-pitch-family
            chips below already visualise the breakdown). */}
        {!metricsOnly && !hideProgressBar && (
        <div style={{
          position: 'relative',
          /* Bar slimmed 14 → 8 (~ 43 % thinner) so the GradeRow's
             progress strip reads as a delicate accent line between
             the title row and the chip table instead of a chunky
             slab. `borderRadius` halved 7 → 4 to keep the pill
             ends in proportion with the new height. */
          height: 8, borderRadius: 4,
          background: 'var(--border)',
          border: '1px solid var(--border-strong)',
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
        )}

      {/* White rule between the progress bar and the column labels —
          the third horizontal line in the GradeRow's six-line spec
          (line 1: title + hairline + grade, line 2: progress bar,
          line 3: this rule, line 4: labels, line 5: numbers, line 6:
          table border-bottom).
          `metricsOnly` mode no longer suppresses this rule — the
          Results bubble (Swing Decision view) wants a white accent
          line above the chip labels (Barrel % / GB % / FB % / K % /
          BB %) so the row reads as a contained sub-section beneath
          the "Results" title. The progress bar is still suppressed
          via the `!metricsOnly` gate further up, so this rule
          immediately follows the title-row hairline in
          metricsOnly mode. */}
      <div
        aria-hidden="true"
        style={{ height: 1, background: 'var(--border)' }}
      />

      {/* Underlying metric chips — Break-&-Spin style table with
          `hideLabelDivider` so there's no extra rule between the
          column labels and the numbers (matches the Blast Motion /
          Coach Grades / Full Swing / HitTrax layout in the Hitting
          Inputs sections). The rule above (between bar and labels)
          is the line 3 in the spec; the table's own `border-bottom`
          on the data row is line 6.
          `compact` retired — the Snapshot chip strips now read at
          the SAME font sizes the Coach Grades / Full Swing / Blast
          Motion / HitTrax column tables use (label 11.88 px / value
          19.8 px / unit 11.88 px), so the Snapshot's Swing / Quality
          of Contact / Coach Diagnosis numbers visually match the
          Inputs sections below them.
          Wrapped in a negative-margin div + `flushEdges` so the
          leftmost column (Max Bat Speed / Avg Exit Velocity / Fwd
          Move) sits hard against the bubble's outer left edge and
          the rightmost (Power / Distance / Timing) hugs the right —
          spreading the chip strip past the inner bubble's 12 px
          horizontal padding for ~24 px of extra horizontal extent.
          The 1fr columns auto-rebalance the middle spacing. */}
      <div style={{ marginLeft: -12, marginRight: -12 }}>
      <HittingMetricTable
        singleRow
        hideLabelDivider
        flushEdges
        singleLineLabels={singleLineLabels}
        items={chips.map((c) => {
          const hasData = c.display !== undefined || c.grade !== null;
          const shown = c.display !== undefined
            ? c.display
            : (c.grade !== null ? String(c.grade) : '—');
          return {
            label: c.label,
            display: shown,
            color: hasData && c.grade !== null ? scoreColor(c.grade) : undefined,
          };
        })}
      />
      </div>{/* /flush-edges wrapper around the chip strip */}
      </div>{/* /toolGraphBubble-style inner blue bubble */}
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
          fontSize: rem(10), fontWeight: 700, letterSpacing: '0.30em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
        }}>
          {label}
        </span>
        <div style={{
          fontSize: rem(64), fontWeight: 800, lineHeight: 1,
          color: tone,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.04em',
        }}>
          {grade ?? '—'}
        </div>
        <span style={{ fontSize: rem(10.5), color: 'var(--text-muted)', letterSpacing: '0.16em' }}>
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
            fontSize: rem(11.5), color: 'var(--text-muted)',
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
      // Stretch / Core / Slot / Timing) — full Movement-Plot bubble
      // chrome (triple-gradient background + white-rim border + soft
      // outer shadow) so the eight Coach Grade cards read in the same
      // Bubble chrome retired — Coach Grade cards now sit
      // transparently on the inner blue bubble that wraps them
      // (mirroring the Swing GradeRow chip pattern). Padding kept
      // so each card still has breathing room within the grid.
      style={{
        position: 'relative',
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
            fontSize: rem(11), lineHeight: 1, padding: 0,
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

      {/* Label + value stacked vertically and centered as a single
          cluster — matches the KpiCard layout pattern so every
          metric tile in the Hitting Inputs sections reads the same
          way (label centered above its number). */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        paddingRight: isCoach ? 28 : 0, // leave room for edit button
      }}>
        <span style={{
          /* Font D — small all-caps Satoshi eyebrow, matching the
             KpiCard `.kpiLabel` spec exactly. */
          fontFamily: 'inherit',
          fontSize: rem(9), fontWeight: 600, letterSpacing: '0.05em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
          lineHeight: 1.2,
          textAlign: 'center',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: rem(26),
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

      {/* Secondary descriptor chips retired — coach grades now show
          just the label, grade number, and bar without the descriptor
          tag row. Descriptor tags still persist in content.manualOptions
          for older reports but are no longer rendered on the dashboard. */}

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
              fontSize: rem(12), fontWeight: 700,
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
                color: 'var(--text-muted)', fontSize: rem(13),
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
      fontSize: rem(13),
      textAlign: 'center',
      lineHeight: 1.6,
    }}>
      {text}
      <div style={{ marginTop: 6, fontSize: rem(11.5), opacity: 0.85 }}>{hint}</div>
    </div>
  );
}
