'use client';

import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LabelList,
  AreaChart, Area,
} from 'recharts';
import {
  DownloadPdfButton, TabBarActions,
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
  hitting:  { main: '#4ADE80', soft: '#86efac', name: 'Hitting'  },
  pitching: { main: '#60A5FA', soft: '#93c5fd', name: 'Pitching' },
  defense:  { main: '#F59E0B', soft: '#fcd34d', name: 'Defense'  },
  vision:   { main: '#A78BFA', soft: '#c4b5fd', name: 'Vision'   },
  strength: { main: '#14B8A6', soft: '#5eead4', name: 'S & C'    },
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
  label, color, soft, score, target, subs,
}: {
  label: string;
  color: string;
  soft: string;
  score: number | null;
  target: number;
  subs: AggregateBar[];
}) {
  const hasScore = score !== null;
  const fillPct = hasScore ? scoreToPct(score!) : 0;
  const targetPct = scoreToPct(target);

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
        <div className={styles.score}>
          {score ?? '—'} <small>/ 80</small>
        </div>
      </div>
      <div className={styles.barTrack}>
        <div className={styles.baseline} />
        <div
          className={styles.fill}
          style={{
            width: `${fillPct}%`,
            background: `linear-gradient(90deg, ${soft}, ${color})`,
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

function SubgradeCompareChart({
  sections,
}: {
  sections: AggregateSection[];
}) {
  const tk = CHART_TOKENS;
  const data = useMemo(() => {
    return sections.flatMap((s) =>
      s.bars.map((b) => ({
        name: b.label,
        value: b.score ?? null,
        displayValue: b.score ?? 20,
        color: DOMAIN_PALETTE[s.key]?.main ?? '#9aa0a6',
        sectionLabel: s.label,
      })),
    );
  }, [sections]);

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
          width={120}
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
          formatter={(v: any, _n: any, item: any) => {
            const row = item?.payload;
            return [row?.value ?? '—', `${row?.sectionLabel} · ${row?.name}`];
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
   Hitting mechanics bar chart (middle-left panel)
   ═══════════════════════════════════════════ */

function HittingBarsChart({ section }: { section: AggregateSection | null }) {
  const tk = CHART_TOKENS;
  const data = useMemo(() => {
    if (!section) return [];
    return section.bars.map((b) => ({
      name: b.label,
      value: b.score ?? null,
      displayValue: b.score ?? 20,
    }));
  }, [section]);

  if (!section || data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', padding: '32px 12px', textAlign: 'center', fontSize: 13 }}>
        No hitting sub-grades yet.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 16, right: 12, bottom: 8, left: 0 }}>
        <CartesianGrid stroke={tk.grid} vertical={false} />
        <XAxis
          dataKey="name"
          stroke={tk.axis}
          fontSize={11}
          tickLine={false}
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
          formatter={(v: any, _n: any, item: any) => [item?.payload?.value ?? '—', 'Score']}
        />
        <Bar dataKey="displayValue" radius={[10, 10, 0, 0]} barSize={44}>
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
            style={{ fill: tk.label, fontSize: 13, fontWeight: 700 }}
            formatter={(v: any) => (v == null ? '—' : v)}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ═══════════════════════════════════════════
   Custom trend line (bottom-right)
   ═══════════════════════════════════════════ */

function TrendChart({
  data, unit, accent = '#E8AF34',
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
  player, topMetrics, reports, progressData,
}: TabProps) {
  const aggregate = useMemo(
    () => computeAggregateScores(player, reports, topMetrics),
    [player, reports, topMetrics],
  );

  const insights = useMemo(
    () => buildInsights(aggregate.sections, aggregate.overall),
    [aggregate],
  );

  const hittingSection = aggregate.sections.find((s) => s.key === 'hitting') ?? null;
  const hittingAvg = hittingSection ? sectionAvg(hittingSection) : null;

  // Pull the four KPI sub-grades from "Consistency" if present.
  const consistencyBar = hittingSection?.bars.find((b) => b.key === 'hit_consistency');

  // Build a trend dataset from the richest available progress metric.
  const trend = useMemo(() => {
    const candidates = [
      { key: 'avg_bat_speed', label: 'Avg Bat Speed', unit: 'mph', accent: '#E8AF34' },
      { key: 'max_exit_velo', label: 'Max Exit Velo', unit: 'mph', accent: '#60A5FA' },
      { key: 'max_bat_speed', label: 'Max Bat Speed', unit: 'mph', accent: '#E8AF34' },
      { key: 'fb_max_velo',   label: 'FB Max Velo',   unit: 'mph', accent: '#4ADE80' },
    ];
    for (const c of candidates) {
      const raw = progressData[c.key];
      if (raw && raw.length >= 2) {
        // Condense to one max per date for clean chart lines.
        const byDate: Record<string, number> = {};
        for (const d of raw) {
          const day = d.recordedAt.slice(0, 10);
          byDate[day] = Math.max(byDate[day] ?? -Infinity, d.value);
        }
        const points = Object.entries(byDate)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-8)
          .map(([day, value]) => ({
            label: new Date(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            value,
          }));
        return { ...c, points };
      }
    }
    return { key: '', label: 'Custom trend', unit: 'mph', accent: '#E8AF34', points: [] };
  }, [progressData]);

  return (
    <div className={styles.root}>
      {/* ── Download button portal ── */}
      <TabBarActions>
        <DownloadPdfButton
          label="Download PDF"
          onDownload={() => generateSummaryPdf(player, reports, topMetrics)}
        />
      </TabBarActions>

      {/* ══════════ HERO ══════════ */}
      <section className={styles.hero}>
        {/* Left: tool grades */}
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>Tool grades</div>
              <h2>Current vs target</h2>
            </div>
            <div className={styles.legendInline}>
              <span>
                <i className={styles.legendDot} style={{ background: 'rgba(255,255,255,0.8)' }} />
                Target
              </span>
              <span>
                <i className={styles.legendDot} style={{ background: '#6e767d' }} />
                50 baseline
              </span>
            </div>
          </div>
          <div className={styles.domainList}>
            {aggregate.sections.map((s) => {
              const avg = sectionAvg(s);
              const palette = DOMAIN_PALETTE[s.key] ?? DOMAIN_PALETTE.hitting;
              return (
                <DomainBar
                  key={s.key}
                  label={s.label}
                  color={palette.main}
                  soft={palette.soft}
                  score={avg}
                  target={targetFor(avg)}
                  subs={s.bars}
                />
              );
            })}
          </div>
        </div>

        {/* Right: big score + focus grid */}
        <div className={`${styles.panel} ${styles.noteCard}`}>
          <div>
            <div className={styles.eyebrow}>Development snapshot</div>
            <div className={styles.bigScore}>
              <div
                className={styles.bigScoreNum}
                style={aggregate.overall != null ? { color: scoreColor(aggregate.overall) } : undefined}
              >
                {aggregate.overall ?? '—'}
              </div>
              <div className={styles.bigScoreTag}>{insights.headline}</div>
            </div>
          </div>
          <div className={styles.focusGrid}>
            {insights.focus.map((f, i) => (
              <FocusCard key={i} title={f.title} body={f.body} />
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ MIDDLE ══════════ */}
      <section className={styles.middle}>
        {/* Left: hitting detail */}
        <div className={`${styles.panel} ${styles.playerCard}`}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>Hitting detail</div>
              <h2>Consistency focus card</h2>
            </div>
            <div className={styles.chips}>
              <span className={styles.chip}>
                Aggregate {hittingAvg ?? '—'} / 80
              </span>
              {hittingAvg != null && hittingAvg < 50 && (
                <span className={`${styles.chip} ${styles.chipWarn}`}>Priority area</span>
              )}
            </div>
          </div>

          <div className={styles.kpiGrid}>
            {(consistencyBar?.subMetrics ?? [
              { key: 'barrel_pct', label: 'Barrel %' },
              { key: 'squared_up_pct', label: 'Squared Up %' },
              { key: 'avg_to_max_ev', label: 'Avg to Max EV' },
              { key: 'whiff_pct', label: 'Whiff %' },
            ]).slice(0, 4).map((sm) => {
              const grade = (sm as any).grade as number | undefined;
              const isWhiff = sm.key === 'whiff_pct';
              const bad = isWhiff && grade != null && grade < 45;
              let trendCopy = 'Awaiting data';
              if (grade != null) {
                if (grade >= 60) trendCopy = 'Above program average';
                else if (grade >= 50) trendCopy = 'Trending steady';
                else if (bad) trendCopy = 'Above desired band';
                else trendCopy = 'Needs tighter spread';
              }
              return (
                <div key={sm.key} className={styles.kpi}>
                  <label className={styles.kpiLabel}>{sm.label}</label>
                  <strong className={styles.kpiValue}>{grade ?? '—'}</strong>
                  <div className={`${styles.kpiTrend}${bad ? ' ' + styles.kpiTrendBad : ''}`}>
                    {trendCopy}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.chartWrap}>
            <HittingBarsChart section={hittingSection} />
          </div>
        </div>

        {/* Right: decision matrix */}
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>Decision matrix</div>
              <h2>Approach quadrants</h2>
            </div>
          </div>
          <div className={styles.matrix}>
            <QuadCard
              tone={insights.best && insights.best.avg >= 50 ? 'good' : 'neutral'}
              title="Best carry tool"
              body={insights.best
                ? `${insights.best.section.label} is your current strongest tool — lean on it while you push the others up.`
                : 'Not enough data to identify your top tool yet.'}
              metricLabel={insights.best ? insights.best.section.label : '—'}
              metricValue={insights.best?.avg ?? null}
            />
            <QuadCard
              tone={insights.ready && insights.ready.avg >= 60 ? 'warn' : 'neutral'}
              title="Monitor load"
              body={insights.ready
                ? `${insights.ready.section.label} is mature enough to press intent — keep changes small so you preserve output.`
                : 'S&C baseline will unlock load recommendations.'}
              metricLabel={insights.ready ? insights.ready.section.label : '—'}
              metricValue={insights.ready?.avg ?? null}
            />
            <QuadCard
              tone={insights.worst && insights.worst.avg < 50 ? 'bad' : 'neutral'}
              title="High-friction zone"
              body={insights.worst
                ? `${insights.worst.section.label} is the clearest drag on the profile — prioritize the weakest sub-grade first.`
                : 'All tools are tracking close to target — stack reps to compound gains.'}
              metricLabel={insights.worst ? insights.worst.section.label : '—'}
              metricValue={insights.worst?.avg ?? null}
            />
            <QuadCard
              tone="neutral"
              title="Pending evaluation"
              body="Sections go live the moment a recent assessment is logged — complete a report to fill this card."
              metricLabel=""
              metricValue={null}
              muted
            />
          </div>
        </div>
      </section>

      {/* ══════════ BOTTOM ══════════ */}
      <section className={styles.bottom}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>Sub-grade compare</div>
              <h2>Skill bars on one scale</h2>
            </div>
            <div className={styles.legendInline}>
              <span>20–80 scouting scale</span>
            </div>
          </div>
          <div className={`${styles.chartWrap} ${styles.chartWrapTall}`}>
            <SubgradeCompareChart sections={aggregate.sections} />
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <div className={styles.tiny}>Custom trend</div>
              <h2>{trend.label}</h2>
            </div>
            <div className={styles.legendInline}>
              <span>
                <i className={styles.legendDot} style={{ background: trend.accent }} />
                {trend.label}
              </span>
            </div>
          </div>
          <div className={`${styles.chartWrap} ${styles.chartWrapTall}`}>
            <TrendChart data={trend.points} unit={trend.unit} accent={trend.accent} />
          </div>
        </div>
      </section>

      <div className={styles.footerNote}>
        Report view: baseline-anchored bars, target markers, and grouped insights. Scores fill in as reports and CSV
        uploads are logged.
      </div>
    </div>
  );
}
