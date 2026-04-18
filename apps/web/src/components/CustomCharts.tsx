'use client';

import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { ChartConfig, ChartEvaluation } from '@/lib/api';
import styles from './CustomCharts.module.css';

interface Props {
  section: string;
  playerId: string;
}

export function CustomCharts({ section, playerId }: Props) {
  const [configs, setConfigs] = useState<ChartConfig[]>([]);
  const [evaluations, setEvaluations] = useState<Record<string, ChartEvaluation>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfgs = await api.getChartConfigs(section);
        if (cancelled) return;

        // Filter to charts that should appear on THIS athlete's profile:
        // - playerScope === 'ALL' (default) → always included
        // - playerScope === 'INDIVIDUAL' → only when playerIds includes this playerId
        const visible = cfgs.filter((c) => {
          if (c.playerScope !== 'INDIVIDUAL') return true;
          if (!c.playerIds) return false;
          try {
            const ids = JSON.parse(c.playerIds);
            return Array.isArray(ids) && ids.includes(playerId);
          } catch {
            return false;
          }
        });

        setConfigs(visible);
        const results = await Promise.all(
          visible.map((c) => api.evaluateChartConfig(c.id, playerId).catch(() => null)),
        );
        if (cancelled) return;
        const map: Record<string, ChartEvaluation> = {};
        results.forEach((r, i) => { if (r) map[visible[i].id] = r; });
        setEvaluations(map);
      } catch {
        /* stay empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section, playerId]);

  if (loading || configs.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3 className={styles.title}>Custom Charts</h3>
        <span className={styles.badge}>{configs.length}</span>
      </div>
      <div className={styles.grid}>
        {configs.map((c) => (
          <CustomChartCard key={c.id} config={c} evaluation={evaluations[c.id] || null} />
        ))}
      </div>
    </div>
  );
}

function CustomChartCard({ config, evaluation }: { config: ChartConfig; evaluation: ChartEvaluation | null }) {
  const series = evaluation?.series || [];
  const hasData = series.some((s) => s.points.length > 0);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>{config.title}</div>
        <span className={styles.cardType}>{config.chartType}</span>
      </div>

      {!hasData ? (
        <div className={styles.empty}>No data in the selected range</div>
      ) : config.chartType === 'STAT_BUBBLE' ? (
        <StatBubbleView series={series} />
      ) : config.chartType === 'PERCENT_INCREASE' ? (
        <PercentIncreaseView series={series} />
      ) : config.chartType === 'BAR' ? (
        <BarView series={series} />
      ) : config.chartType === 'LINE' ? (
        <LineView series={series} />
      ) : config.chartType === 'SCATTER' ? (
        <ScatterView series={series} />
      ) : config.chartType === 'BUBBLE' ? (
        <ScatterView series={series} bubble />
      ) : config.chartType === 'MOVEMENT_PLOT' ? (
        <MovementPlotView series={series} />
      ) : config.chartType === 'ROLLING_AVG' ? (
        <LineView
          series={series}
          overlays={series.map((s, i) => ({
            points: computeMovingAverage(s.points, config.rollingWindow || 5, (config.rollingMode as 'SMA' | 'EMA') || 'SMA'),
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            dashed: true,
          }))}
        />
      ) : config.chartType === 'TRENDLINE' ? (
        <LineView
          series={series}
          overlays={series.map((s, i) => {
            const reg = linearRegression(s.points);
            return reg
              ? { points: reg.endpoints, color: SERIES_COLORS[i % SERIES_COLORS.length], dashed: true }
              : null;
          }).filter(Boolean) as any[]}
        />
      ) : config.chartType === 'TARGET_BAND' ? (
        <LineView series={series} band={{ min: config.targetMin ?? null, max: config.targetMax ?? null }} />
      ) : config.chartType === 'PERSONAL_BEST' ? (
        <LineView
          series={series}
          dimRaw
          overlays={series.map((s, i) => {
            if (s.points.length === 0) return null;
            const dir = (config.pbDirection as 'MAX' | 'MIN') || 'MAX';
            let best = s.points[0].value;
            const pb = s.points.map((p) => {
              if (dir === 'MAX' ? p.value > best : p.value < best) best = p.value;
              return { date: p.date, value: best };
            });
            return { points: pb, color: SERIES_COLORS[i % SERIES_COLORS.length], stepped: true };
          }).filter(Boolean) as any[]}
        />
      ) : config.chartType === 'STRIKE_ZONE_HEAT' ? (
        <StrikeZoneHeatView
          series={series}
          grid={(config.zoneGrid as '3x3' | '5x5') || '3x3'}
          metric={(config.zoneMetric as 'COUNT' | 'AVG' | 'WHIFF') || 'COUNT'}
        />
      ) : (
        <LineView series={series} />
      )}
    </div>
  );
}

function StatBubbleView({ series }: { series: ChartEvaluation['series'] }) {
  return (
    <div className={styles.bubbleRow}>
      {series.map((s) => {
        const latest = s.points[s.points.length - 1];
        return (
          <div key={`${s.source}::${s.metricType}`} className={styles.bubble}>
            <div className={styles.bubbleValue}>{latest ? latest.value.toFixed(1) : '—'}</div>
            <div className={styles.bubbleLabel}>{s.label}</div>
            <div className={styles.bubbleSub}>{s.source}</div>
          </div>
        );
      })}
    </div>
  );
}

function PercentIncreaseView({ series }: { series: ChartEvaluation['series'] }) {
  return (
    <div className={styles.bubbleRow}>
      {series.map((s) => {
        const first = s.points[0];
        const last = s.points[s.points.length - 1];
        const pct = first && last && first.value !== 0 ? ((last.value - first.value) / first.value) * 100 : null;
        const positive = (pct || 0) >= 0;
        return (
          <div key={`${s.source}::${s.metricType}`} className={styles.bubble}>
            <div className={`${styles.bubbleValue} ${positive ? styles.pos : styles.neg}`}>
              {pct == null ? '—' : `${positive ? '+' : ''}${pct.toFixed(1)}%`}
            </div>
            <div className={styles.bubbleLabel}>{s.label}</div>
            <div className={styles.bubbleSub}>
              {first && last ? `${first.value.toFixed(1)} → ${last.value.toFixed(1)}` : s.source}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BarView({ series }: { series: ChartEvaluation['series'] }) {
  const bars = series.map((s) => {
    const values = s.points.map((p) => p.value);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const max = values.length ? Math.max(...values) : 0;
    return { label: s.label, avg, max };
  });
  const scale = Math.max(...bars.map((b) => b.max), 1);

  return (
    <div className={styles.barWrap}>
      {bars.map((b) => (
        <div key={b.label} className={styles.barRow}>
          <div className={styles.barLabel}>{b.label}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(b.avg / scale) * 100}%` }} />
          </div>
          <div className={styles.barValue}>{b.avg.toFixed(1)}</div>
        </div>
      ))}
    </div>
  );
}

const SERIES_COLORS = ['#4682FF', '#D4AF37', '#34D399', '#E11D48', '#8B5CF6', '#F472B6'];

type OverlayLine = {
  points: Array<{ date: string; value: number }>;
  color: string;
  dashed?: boolean;
  stepped?: boolean;
};

function LineView({
  series, overlays = [], band, dimRaw = false,
}: {
  series: ChartEvaluation['series'];
  overlays?: OverlayLine[];
  band?: { min: number | null; max: number | null };
  dimRaw?: boolean;
}) {
  const W = 320;
  const H = 140;
  const PAD = 24;
  const rawPoints = series.flatMap((s) => s.points);
  const overlayPoints = overlays.flatMap((o) => o.points);
  const all = [...rawPoints, ...overlayPoints];
  if (all.length === 0) return <div className={styles.empty}>No points</div>;

  const xs = all.map((p) => new Date(p.date).getTime());
  const ys = all.map((p) => p.value);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (band) {
    if (band.min != null) yMin = Math.min(yMin, band.min);
    if (band.max != null) yMax = Math.max(yMax, band.max);
  }
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toX = (d: string) => PAD + ((new Date(d).getTime() - xMin) / xRange) * (W - PAD - 4);
  const toY = (v: number) => 4 + (1 - (v - yMin) / yRange) * (H - PAD - 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
      <line x1={PAD} y1={H - PAD} x2={W - 4} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
      <line x1={PAD} y1={4} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />

      {band && band.min != null && band.max != null && (
        <rect
          x={PAD}
          y={toY(Math.max(band.min, band.max))}
          width={W - PAD - 4}
          height={Math.abs(toY(band.min) - toY(band.max))}
          fill="rgba(52,211,153,0.14)"
          stroke="rgba(52,211,153,0.38)"
          strokeDasharray="3 4"
        />
      )}

      {series.map((s, i) => {
        if (s.points.length === 0) return null;
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const pts = s.points.map((p) => `${toX(p.date).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ');
        return (
          <g key={`raw-${i}`} opacity={dimRaw ? 0.45 : 1}>
            <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
            {s.points.map((p, j) => (
              <circle key={j} cx={toX(p.date)} cy={toY(p.value)} r="2.5" fill={color} />
            ))}
          </g>
        );
      })}

      {overlays.map((o, i) => {
        if (o.points.length === 0) return null;
        let d = '';
        if (o.stepped) {
          d = `M ${toX(o.points[0].date).toFixed(1)} ${toY(o.points[0].value).toFixed(1)}`;
          for (let k = 1; k < o.points.length; k++) {
            const x = toX(o.points[k].date);
            const py = toY(o.points[k - 1].value);
            const y = toY(o.points[k].value);
            d += ` L ${x.toFixed(1)} ${py.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
          }
        } else {
          d = o.points.map((p, k) => `${k === 0 ? 'M' : 'L'} ${toX(p.date).toFixed(1)} ${toY(p.value).toFixed(1)}`).join(' ');
        }
        return (
          <path
            key={`ov-${i}`}
            d={d}
            fill="none"
            stroke={o.color}
            strokeWidth="2.25"
            strokeDasharray={o.dashed ? '5 4' : undefined}
          />
        );
      })}

      <text x={PAD} y={H - 6} fontSize="9" fill="rgba(255,255,255,0.5)">{yMin.toFixed(0)}</text>
      <text x={PAD} y={10} fontSize="9" fill="rgba(255,255,255,0.5)">{yMax.toFixed(0)}</text>
    </svg>
  );
}

function ScatterView({ series, bubble = false }: { series: ChartEvaluation['series']; bubble?: boolean }) {
  return <LineView series={series} />;
}

/* ─── Advanced chart helpers ─────────────────────────────── */

function computeMovingAverage(
  points: Array<{ date: string; value: number }>,
  window: number,
  mode: 'SMA' | 'EMA',
): Array<{ date: string; value: number }> {
  if (points.length === 0 || window < 2) return [];
  if (mode === 'EMA') {
    const k = 2 / (window + 1);
    const out: Array<{ date: string; value: number }> = [];
    let ema = points[0].value;
    points.forEach((p, i) => {
      ema = i === 0 ? p.value : p.value * k + ema * (1 - k);
      out.push({ date: p.date, value: ema });
    });
    return out;
  }
  const out: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = points.slice(start, i + 1);
    out.push({ date: points[i].date, value: slice.reduce((a, b) => a + b.value, 0) / slice.length });
  }
  return out;
}

function linearRegression(points: Array<{ date: string; value: number }>) {
  if (points.length < 2) return null;
  const xs = points.map((p) => new Date(p.date).getTime());
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx) || 0;
  const a = (sy - b * sx) / n;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  return {
    slope: b,
    intercept: a,
    endpoints: [
      { date: new Date(xMin).toISOString(), value: a + b * xMin },
      { date: new Date(xMax).toISOString(), value: a + b * xMax },
    ],
  };
}

function MovementPlotView({ series }: { series: ChartEvaluation['series'] }) {
  const W = 320;
  const H = 200;
  const PAD = 26;
  const xSeries = series[0];
  const ySeries = series[1];
  if (!xSeries || !ySeries) return <div className={styles.empty}>Needs two columns</div>;

  const yMap = new Map(ySeries.points.map((p) => [p.date.slice(0, 10), p.value]));
  const pairs = xSeries.points
    .map((p) => {
      const y = yMap.get(p.date.slice(0, 10));
      return y != null ? { x: p.value, y } : null;
    })
    .filter(Boolean) as Array<{ x: number; y: number }>;

  if (pairs.length === 0) return <div className={styles.empty}>No overlapping dates</div>;

  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  const xMin = Math.min(0, ...xs);
  const xMax = Math.max(0, ...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(0, ...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const toX = (x: number) => PAD + ((x - xMin) / xRange) * (W - PAD - 4);
  const toY = (y: number) => 4 + (1 - (y - yMin) / yRange) * (H - PAD - 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
      <line x1={PAD} y1={H - PAD} x2={W - 4} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
      <line x1={PAD} y1={4} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" />
      {xMin <= 0 && xMax >= 0 && (
        <line x1={toX(0)} y1={4} x2={toX(0)} y2={H - PAD} stroke="rgba(255,255,255,0.20)" strokeDasharray="3 4" />
      )}
      {yMin <= 0 && yMax >= 0 && (
        <line x1={PAD} y1={toY(0)} x2={W - 4} y2={toY(0)} stroke="rgba(255,255,255,0.20)" strokeDasharray="3 4" />
      )}
      {pairs.map((p, i) => (
        <circle key={i} cx={toX(p.x)} cy={toY(p.y)} r="3.5" fill="#4682FF" fillOpacity="0.75" stroke="#D4AF37" strokeWidth="0.5" />
      ))}
    </svg>
  );
}

function StrikeZoneHeatView({
  series, grid, metric,
}: { series: ChartEvaluation['series']; grid: '3x3' | '5x5'; metric: 'COUNT' | 'AVG' | 'WHIFF' }) {
  const n = grid === '3x3' ? 3 : 5;
  const cells: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const sums: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const first = series[0];
  if (first) {
    first.points.forEach((p, i) => {
      const r = i % n;
      const c = Math.floor(i / n) % n;
      cells[r][c] += 1;
      sums[r][c] += p.value;
    });
  }
  const values = cells.map((row, r) => row.map((count, c) => {
    if (metric === 'COUNT') return count;
    if (metric === 'AVG') return count ? sums[r][c] / count : 0;
    return count ? 1 - Math.min(1, sums[r][c] / (count * Math.max(...sums.flat(), 1))) : 0;
  }));
  const maxV = Math.max(...values.flat(), 1);

  const size = 240;
  const cell = size / n;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={styles.svg} style={{ maxWidth: 240 }}>
      <rect x="0" y="0" width={size} height={size} fill="none" stroke="rgba(255,255,255,0.3)" />
      {values.map((row, r) =>
        row.map((v, c) => {
          const intensity = maxV ? v / maxV : 0;
          const hue = metric === 'WHIFF' ? 355 : 210;
          return (
            <g key={`${r}-${c}`}>
              <rect
                x={c * cell}
                y={r * cell}
                width={cell - 1}
                height={cell - 1}
                fill={`hsla(${hue},70%,55%,${0.12 + intensity * 0.6})`}
                stroke="rgba(255,255,255,0.08)"
              />
              <text
                x={c * cell + cell / 2}
                y={r * cell + cell / 2 + 3}
                textAnchor="middle"
                fontSize="10"
                fill="rgba(255,255,255,0.8)"
                fontFamily="DM Mono, monospace"
              >
                {metric === 'COUNT' ? v : v.toFixed(1)}
              </text>
            </g>
          );
        }),
      )}
    </svg>
  );
}
