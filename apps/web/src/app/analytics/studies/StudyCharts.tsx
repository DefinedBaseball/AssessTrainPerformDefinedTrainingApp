'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Studies charts (plain SVG, scale to the card's width). One axis each,
   thin marks, hover tooltips, every dot clickable (opens the athlete).
   Colours: --s1/--s2/--s3 from studies.module.css (validated palette);
   text always in ink tokens, never series colours.
   ───────────────────────────────────────────────────────────────────────── */
import { useId, useRef, useState } from 'react';
import s from './studies.module.css';

const W = 640;
const PAD = { l: 56, r: 18, t: 14, b: 44 };

/** Nice axis ticks covering [min, max]. */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => span / x <= count + 0.5) ?? mag * 10;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[0] > min) out.unshift(start - step);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

const tickText = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100));

interface Tip { x: number; y: number; title: string; lines: string[] }

/** Tooltip in container pixels from SVG viewBox coordinates. */
function useTip(height: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (vx: number, vy: number, title: string, lines: string[]) => {
    const box = ref.current?.getBoundingClientRect();
    const k = box ? box.width / W : 1;
    setTip({ x: vx * k, y: vy * k, title, lines });
  };
  const node = tip ? (
    <div className={s.tooltip} style={{ left: tip.x, top: tip.y }}>
      <strong>{tip.title}</strong>
      {tip.lines.map((l, i) => <div key={i} className={i ? s.tooltipSub : undefined}>{l}</div>)}
    </div>
  ) : null;
  void height;
  return { ref, show, hide: () => setTip(null), node };
}

function Axes({ xs, ys, sx, sy, h, xTitle, yTitle, xCategorical }: {
  xs: number[]; ys: number[]; sx: (v: number) => number; sy: (v: number) => number; h: number; xTitle?: string; yTitle?: string; xCategorical?: boolean;
}) {
  return (
    <g>
      {ys.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth={1} />
          <text x={PAD.l - 8} y={sy(v) + 4} textAnchor="end" className={s.axisText}>{tickText(v)}</text>
        </g>
      ))}
      {!xCategorical && xs.map((v) => (
        <text key={`x${v}`} x={sx(v)} y={h - PAD.b + 18} textAnchor="middle" className={s.axisText}>{tickText(v)}</text>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={h - PAD.b} y2={h - PAD.b} stroke="var(--axis)" strokeWidth={1} />
      {xTitle && <text x={(PAD.l + W - PAD.r) / 2} y={h - 6} textAnchor="middle" className={s.axisTitle}>{xTitle}</text>}
      {yTitle && <text x={14} y={(PAD.t + h - PAD.b) / 2} textAnchor="middle" className={s.axisTitle} transform={`rotate(-90 14 ${(PAD.t + h - PAD.b) / 2})`}>{yTitle}</text>}
    </g>
  );
}

export interface DotPoint { id: string; label: string; x: number; y: number; group?: number; sub?: string }

/** Scatter: one dot per athlete, optional fit line. Up to 3 groups (colour + legend). */
export function ScatterChart({ points, xTitle, yTitle, fmtX, fmtY, line, groups, onPick, height = 380 }: {
  points: DotPoint[];
  xTitle: string;
  yTitle: string;
  fmtX: (v: number) => string;
  fmtY: (v: number) => string;
  line?: { slope: number; intercept: number } | null;
  groups?: string[];
  onPick?: (id: string) => void;
  height?: number;
}) {
  const h = height;
  const tip = useTip(h);
  const clipId = `clip${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const xv = points.map((p) => p.x), yv = points.map((p) => p.y);
  const xt = ticks(Math.min(...xv), Math.max(...xv));
  const yt = ticks(Math.min(...yv), Math.max(...yv));
  const [x0, x1] = [xt[0], xt[xt.length - 1]];
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => h - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (h - PAD.t - PAD.b);
  const color = (g?: number) => `var(--s${(g ?? 0) + 1})`;
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      {groups && groups.length > 1 && (
        <div className={s.legend}>
          {groups.map((g, i) => <span key={g} data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: color(i) }} />{g}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label={`${yTitle} against ${xTitle}`} onMouseLeave={tip.hide}>
        <Axes xs={xt} ys={yt} sx={sx} sy={sy} h={h} xTitle={xTitle} yTitle={yTitle} />
        {line && (
          <line x1={sx(x0)} y1={sy(line.slope * x0 + line.intercept)} x2={sx(x1)} y2={sy(line.slope * x1 + line.intercept)}
            stroke="var(--ink-3)" strokeWidth={2} strokeDasharray="6 5" clipPath={`url(#${clipId})`} />
        )}
        <defs><clipPath id={clipId}><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={h - PAD.t - PAD.b} /></clipPath></defs>
        {points.map((p) => (
          <g key={p.id} style={{ cursor: onPick ? 'pointer' : undefined }}
            onMouseEnter={() => tip.show(sx(p.x), sy(p.y), p.label, [`${xTitle}: ${fmtX(p.x)}`, `${yTitle}: ${fmtY(p.y)}`, ...(p.sub ? [p.sub] : [])])}
            onClick={() => onPick?.(p.id)}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={12} fill="transparent" />
            <circle cx={sx(p.x)} cy={sy(p.y)} r={5} fill={color(p.group)} stroke="var(--surface)" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {tip.node}
    </div>
  );
}

/** Ranked correlation bars around 0 (What goes with it?). Blue = positive, orange = negative. */
export function RankedBars({ rows, onPick }: {
  rows: { id: string; label: string; r: number; n: number; p: number }[];
  onPick?: (id: string) => void;
}) {
  const rowH = 26;
  const labelW = 230;
  const h = rows.length * rowH + 30;
  const tip = useTip(h);
  /* 44px either side of the bars for the r values. */
  const mid = labelW + 44 + (W - labelW - 88) / 2;
  const half = (W - labelW - 88) / 2;
  const bx = (r: number) => mid + r * half;
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      <div className={s.legend}>
        <span data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: 'var(--s1)' }} />Goes up together</span>
        <span data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: 'var(--s2)' }} />One up, other down</span>
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label="Correlation of each measure" onMouseLeave={tip.hide}>
        {[-1, -0.5, 0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={bx(v)} x2={bx(v)} y1={4} y2={h - 22} stroke={v === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
            <text x={bx(v)} y={h - 6} textAnchor="middle" className={s.axisText}>{v}</text>
          </g>
        ))}
        {rows.map((row, i) => {
          const y = 8 + i * rowH;
          const x = Math.min(bx(0), bx(row.r));
          const w = Math.max(2, Math.abs(bx(row.r) - bx(0)));
          return (
            <g key={row.id} style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(row.id)}
              onMouseEnter={() => tip.show(bx(row.r), y, row.label, [`r = ${row.r.toFixed(2)} · ${row.n} athletes`, row.p < 0.05 ? 'Unlikely to be chance (p < 0.05)' : 'Could be chance (p ≥ 0.05)'])}>
              <rect x={0} y={y - 2} width={W} height={rowH - 2} fill="transparent" />
              <text x={labelW - 10} y={y + 13} textAnchor="end" className={s.axisText} style={{ fill: 'var(--ink-2)' }}>
                {row.label.length > 34 ? row.label.slice(0, 33) + '…' : row.label}
              </text>
              <rect x={x} y={y + 3} width={w} height={rowH - 10} rx={4} fill={row.r >= 0 ? 'var(--s1)' : 'var(--s2)'} opacity={row.p < 0.05 ? 1 : 0.45} />
              <text x={row.r >= 0 ? x + w + 6 : x - 6} y={y + 13} textAnchor={row.r >= 0 ? 'start' : 'end'} className={s.valueText}>{row.r.toFixed(2)}</text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

/** Before / after: a line per athlete from the "before" value to the "after" value. */
export function SlopeChart({ rows, beforeLabel, afterLabel, fmt, onPick }: {
  /** improved: null = no change. */
  rows: { id: string; label: string; before: number; after: number; improved: boolean | null }[];
  beforeLabel: string;
  afterLabel: string;
  fmt: (v: number) => string;
  onPick?: (id: string) => void;
}) {
  const h = 380;
  const tip = useTip(h);
  const all = rows.flatMap((r) => [r.before, r.after]);
  const yt = ticks(Math.min(...all), Math.max(...all));
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const sy = (v: number) => h - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (h - PAD.t - PAD.b);
  const xA = PAD.l + 90, xB = W - PAD.r - 90;
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      <div className={s.legend}>
        <span data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: 'var(--s1)' }} />Improved</span>
        <span data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: 'var(--s2)' }} />Got worse</span>
        {rows.some((r) => r.improved === null) && <span data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: 'var(--s-muted)' }} />No change</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label="Before and after per athlete" onMouseLeave={tip.hide}>
        <Axes xs={[]} ys={yt} sx={(v) => v} sy={sy} h={h} xCategorical />
        <text x={xA} y={h - PAD.b + 20} textAnchor="middle" className={s.axisTitle}>{beforeLabel}</text>
        <text x={xB} y={h - PAD.b + 20} textAnchor="middle" className={s.axisTitle}>{afterLabel}</text>
        {rows.map((r) => {
          const c = r.improved === null ? 'var(--s-muted)' : r.improved ? 'var(--s1)' : 'var(--s2)';
          return (
            <g key={r.id} style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(r.id)}
              onMouseEnter={() => tip.show((xA + xB) / 2, Math.min(sy(r.before), sy(r.after)), r.label, [`${beforeLabel}: ${fmt(r.before)}`, `${afterLabel}: ${fmt(r.after)}`, `Change: ${fmt(r.after - r.before)}`])}>
              <line x1={xA} y1={sy(r.before)} x2={xB} y2={sy(r.after)} stroke="transparent" strokeWidth={10} />
              <line x1={xA} y1={sy(r.before)} x2={xB} y2={sy(r.after)} stroke={c} strokeWidth={2} opacity={0.85} />
              <circle cx={xA} cy={sy(r.before)} r={4} fill={c} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={xB} cy={sy(r.after)} r={4} fill={c} stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

/** Group comparison: every athlete a dot in their group's column, with the group mean and ± 1 spread. */
export function StripChart({ groups, yTitle, fmt, onPick }: {
  groups: { name: string; mean: number; sd: number; values: { id: string; label: string; v: number }[] }[];
  yTitle: string;
  fmt: (v: number) => string;
  onPick?: (id: string) => void;
}) {
  const h = 380;
  const tip = useTip(h);
  const all = groups.flatMap((g) => g.values.map((v) => v.v));
  const yt = ticks(Math.min(...all), Math.max(...all));
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const sy = (v: number) => h - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (h - PAD.t - PAD.b);
  const colW = (W - PAD.l - PAD.r) / Math.max(1, groups.length);
  const cx = (i: number) => PAD.l + colW * (i + 0.5);
  /* Deterministic jitter so dots don't sit on top of each other. */
  const spread = Math.min(44, colW * 0.32);
  const jitter = (k: number) => (((k * 37) % 17) / 16 - 0.5) * spread;
  /* Dots on the left of the column, the average + spread marker on the right. */
  const dotX = (i: number, k: number) => cx(i) - spread * 0.55 + jitter(k);
  const markX = (i: number) => cx(i) + Math.min(34, colW * 0.22);
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label={`${yTitle} by group`} onMouseLeave={tip.hide}>
        <Axes xs={[]} ys={yt} sx={(v) => v} sy={sy} h={h} yTitle={yTitle} xCategorical />
        {groups.map((g, i) => (
          <g key={g.name}>
            <text x={cx(i)} y={h - PAD.b + 18} textAnchor="middle" className={s.axisTitle}>{g.name.length > 18 ? g.name.slice(0, 17) + '…' : g.name}</text>
            <text x={cx(i)} y={h - PAD.b + 32} textAnchor="middle" className={s.axisText}>n = {g.values.length}</text>
            {g.values.map((v, k) => (
              <g key={v.id} style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(v.id)}
                onMouseEnter={() => tip.show(dotX(i, k), sy(v.v), v.label, [`${yTitle}: ${fmt(v.v)}`, g.name])}>
                <circle cx={dotX(i, k)} cy={sy(v.v)} r={11} fill="transparent" />
                <circle cx={dotX(i, k)} cy={sy(v.v)} r={4.5} fill="var(--s1)" opacity={0.7} stroke="var(--surface)" strokeWidth={1.5} />
              </g>
            ))}
            {Number.isFinite(g.mean) && (
              <g pointerEvents="none">
                {Number.isFinite(g.sd) && <line x1={markX(i)} x2={markX(i)} y1={sy(Math.max(y0, g.mean - g.sd))} y2={sy(Math.min(y1, g.mean + g.sd))} stroke="var(--ink-2)" strokeWidth={2} />}
                <line x1={markX(i) - 10} x2={markX(i) + 10} y1={sy(g.mean)} y2={sy(g.mean)} stroke="var(--ink)" strokeWidth={3} strokeLinecap="round" />
              </g>
            )}
          </g>
        ))}
      </svg>
      <div className={s.legend}><span data-legend-item className={s.legendItem}>Dots = athletes · short bar = group average · line through it = ± 1 spread (standard deviation)</span></div>
      {tip.node}
    </div>
  );
}

/** Group trend: monthly group average per group with a ± spread band (3 groups at most). */
export function TrendChart({ groups, yTitle, fmt }: {
  groups: { name: string; points: { month: string; mean: number; sd: number; n: number }[] }[];
  yTitle: string;
  fmt: (v: number) => string;
}) {
  const h = 360;
  const tip = useTip(h);
  /* Real time: every month from the first to the last, data or not. */
  const mIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const present = [...new Set(groups.flatMap((g) => g.points.map((p) => p.month)))].sort();
  const months: string[] = [];
  if (present.length) {
    for (let k = mIndex(present[0]); k <= mIndex(present[present.length - 1]); k++) months.push(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`);
  }
  const vals = groups.flatMap((g) => g.points.flatMap((p) => [p.mean - (p.sd || 0), p.mean + (p.sd || 0)]));
  const yt = ticks(Math.min(...vals), Math.max(...vals));
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const sy = (v: number) => h - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (h - PAD.t - PAD.b);
  const sx = (m: string) => PAD.l + (months.length < 2 ? (W - PAD.l - PAD.r) / 2 : (months.indexOf(m) / (months.length - 1)) * (W - PAD.l - PAD.r));
  const label = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  const every = Math.max(1, Math.ceil(months.length / 8));
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      {groups.length > 1 && (
        <div className={s.legend}>
          {groups.map((g, i) => <span key={g.name} data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: `var(--s${i + 1})` }} />{g.name}</span>)}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label={`${yTitle} by month`}
        onMouseLeave={() => { tip.hide(); setHover(null); }}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const vx = ((e.clientX - box.left) / box.width) * W;
          let best = present[0];
          for (const m of present) if (Math.abs(sx(m) - vx) < Math.abs(sx(best) - vx)) best = m;
          if (!best) return;
          setHover(best);
          const lines = groups.map((g) => { const p = g.points.find((x) => x.month === best); return `${g.name}: ${p ? `${fmt(p.mean)} (n ${p.n})` : '—'}`; });
          const top = Math.min(...groups.map((g) => { const p = g.points.find((x) => x.month === best); return p ? sy(p.mean) : h; }));
          tip.show(sx(best), top, label(best), lines);
        }}>
        <Axes xs={[]} ys={yt} sx={(v) => v} sy={sy} h={h} yTitle={yTitle} xCategorical />
        {months.map((m, i) => (i % every === 0 ? <text key={m} x={sx(m)} y={h - PAD.b + 18} textAnchor="middle" className={s.axisText}>{label(m)}</text> : null))}
        {hover && <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={h - PAD.b} stroke="var(--axis)" strokeWidth={1} />}
        {groups.map((g, gi) => {
          const c = `var(--s${gi + 1})`;
          const pts = g.points;
          if (!pts.length) return null;
          const band = pts.map((p) => `${sx(p.month)},${sy(p.mean + p.sd)}`).join(' ') + ' ' + [...pts].reverse().map((p) => `${sx(p.month)},${sy(p.mean - p.sd)}`).join(' ');
          return (
            <g key={g.name} pointerEvents="none">
              {pts.length > 1 && <polygon points={band} fill={c} opacity={0.12} />}
              <polyline points={pts.map((p) => `${sx(p.month)},${sy(p.mean)}`).join(' ')} fill="none" stroke={c} strokeWidth={2} />
              {pts.map((p) => <circle key={p.month} cx={sx(p.month)} cy={sy(p.mean)} r={hover === p.month ? 5 : 3.5} fill={c} stroke="var(--surface)" strokeWidth={2} />)}
            </g>
          );
        })}
      </svg>
      <div className={s.legend}><span data-legend-item className={s.legendItem}>Line = group average per month · band = ± 1 spread between athletes</span></div>
      {tip.node}
    </div>
  );
}

/** Athlete profile: percentile bars (0-100) against the comparison group; 50 = middle of the group. */
export function PercentileBars({ rows }: { rows: { id: string; label: string; pct: number; value: string; n: number }[] }) {
  const rowH = 30;
  const labelW = 230;
  const h = rows.length * rowH + 30;
  const tip = useTip(h);
  const x0 = labelW, x1 = W - 70;
  const bx = (p: number) => x0 + (p / 100) * (x1 - x0);
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label="Percentile in the group" onMouseLeave={tip.hide}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={bx(v)} x2={bx(v)} y1={4} y2={h - 22} stroke={v === 50 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} strokeDasharray={v === 50 ? '4 4' : undefined} />
            <text x={bx(v)} y={h - 6} textAnchor="middle" className={s.axisText}>{v}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 8 + i * rowH;
          return (
            <g key={r.id} onMouseEnter={() => tip.show(bx(r.pct), y, r.label, [`${r.value}`, `Better than ${Math.round(r.pct)}% of ${r.n} athletes`])}>
              <rect x={0} y={y - 2} width={W} height={rowH - 2} fill="transparent" />
              <text x={labelW - 10} y={y + 15} textAnchor="end" className={s.axisText} style={{ fill: 'var(--ink-2)' }}>
                {r.label.length > 34 ? r.label.slice(0, 33) + '…' : r.label}
              </text>
              <rect x={x0} y={y + 4} width={Math.max(3, bx(r.pct) - x0)} height={rowH - 12} rx={4} fill="var(--s1)" />
              <text x={bx(r.pct) + 6} y={y + 15} className={s.valueText}>{Math.round(r.pct)}</text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

/** Head-to-head: one line per athlete over time (6 athletes at most), crosshair tooltip. */
export function AthleteLines({ lines, yTitle, fmt }: {
  lines: { id: string; name: string; points: { day: string; value: number }[] }[];
  yTitle: string;
  fmt: (v: number) => string;
}) {
  const h = 340;
  const tip = useTip(h);
  const [hover, setHover] = useState<number | null>(null);
  const t = (day: string) => Date.parse(`${day}T12:00:00Z`);
  const all = lines.flatMap((l) => l.points);
  if (!all.length) return null;
  const tMin = Math.min(...all.map((p) => t(p.day))), tMax = Math.max(...all.map((p) => t(p.day)));
  const yt = ticks(Math.min(...all.map((p) => p.value)), Math.max(...all.map((p) => p.value)));
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const sx = (ms: number) => PAD.l + (tMax === tMin ? (W - PAD.l - PAD.r) / 2 : ((ms - tMin) / (tMax - tMin)) * (W - PAD.l - PAD.r));
  const sy = (v: number) => h - PAD.b - ((v - y0) / (y1 - y0 || 1)) * (h - PAD.t - PAD.b);
  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((f) => tMin + f * (tMax - tMin));
  const dateText = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
  return (
    <div className={s.viz} ref={tip.ref} data-viz>
      <div className={s.legend}>
        {lines.map((l, i) => <span key={l.id} data-legend-item className={s.legendItem}><span className={s.legendSwatch} style={{ background: `var(--s${i + 1})` }} />{l.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${h}`} className={s.chartSvg} role="img" aria-label={`${yTitle} over time`}
        onMouseLeave={() => { tip.hide(); setHover(null); }}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const vx = ((e.clientX - box.left) / box.width) * W;
          const ms = tMin + ((vx - PAD.l) / (W - PAD.l - PAD.r)) * (tMax - tMin);
          setHover(Math.max(tMin, Math.min(tMax, ms)));
          const near = lines.map((l) => {
            let best: { day: string; value: number } | null = null;
            for (const p of l.points) if (t(p.day) <= ms + 43_200_000 && (!best || t(p.day) > t(best.day))) best = p;
            return `${l.name}: ${best ? `${fmt(best.value)} (${dateText(t(best.day))})` : '—'}`;
          });
          tip.show(Math.max(PAD.l, Math.min(W - PAD.r, vx)), PAD.t + 10, dateText(ms), near);
        }}>
        <Axes xs={[]} ys={yt} sx={(v) => v} sy={sy} h={h} yTitle={yTitle} xCategorical />
        {xLabels.map((ms, i) => <text key={i} x={sx(ms)} y={h - PAD.b + 18} textAnchor="middle" className={s.axisText}>{dateText(ms)}</text>)}
        {hover != null && <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={h - PAD.b} stroke="var(--axis)" strokeWidth={1} />}
        {lines.map((l, i) => (
          <g key={l.id} pointerEvents="none">
            <polyline points={l.points.map((p) => `${sx(t(p.day))},${sy(p.value)}`).join(' ')} fill="none" stroke={`var(--s${i + 1})`} strokeWidth={2} />
            {l.points.map((p, k) => <circle key={k} cx={sx(t(p.day))} cy={sy(p.value)} r={3.5} fill={`var(--s${i + 1})`} stroke="var(--surface)" strokeWidth={2} />)}
          </g>
        ))}
      </svg>
      <div className={s.legend}><span data-legend-item className={s.legendItem}>Tooltip = each athlete&rsquo;s latest value up to that date</span></div>
      {tip.node}
    </div>
  );
}
