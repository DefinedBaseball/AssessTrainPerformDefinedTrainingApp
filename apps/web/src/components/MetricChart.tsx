'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';
import styles from './MetricChart.module.css';

interface DataPoint {
  value: number;
  recordedAt: string;
}

interface MetricChartProps {
  title: string;
  unit: string;
  data: DataPoint[];
  color?: string;
  showArea?: boolean;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatFullDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function CustomTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipValue}>
        {payload[0].value.toFixed(1)} <span>{unit}</span>
      </div>
      <div className={styles.tooltipDate}>{formatFullDate(label)}</div>
    </div>
  );
}

export function MetricChart({ title, unit, data, color = '#4A90D9', showArea = true }: MetricChartProps) {
  if (data.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
        </div>
        <div className={styles.empty}>No data points yet</div>
      </div>
    );
  }

  const sorted = [...data].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );

  const values = sorted.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];
  const first = values[0];
  const change = latest - first;
  const changePct = first !== 0 ? ((change / first) * 100).toFixed(1) : '—';

  const padding = (max - min) * 0.15 || 1;
  const yMin = Math.floor(min - padding);
  const yMax = Math.ceil(max + padding);

  const chartData = sorted.map(d => ({
    date: d.recordedAt,
    value: d.value,
  }));

  const ChartComponent = showArea ? AreaChart : LineChart;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          <span className={styles.unit}>{unit}</span>
        </div>
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statValue} style={{ color }}>{latest.toFixed(1)}</span>
            <span className={styles.statLabel}>Latest</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{max.toFixed(1)}</span>
            <span className={styles.statLabel}>Best</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{avg.toFixed(1)}</span>
            <span className={styles.statLabel}>Avg</span>
          </div>
          <div className={styles.stat}>
            <span
              className={styles.statValue}
              style={{ color: change >= 0 ? '#34C759' : '#FF3B30' }}
            >
              {change >= 0 ? '+' : ''}{change.toFixed(1)}
            </span>
            <span className={styles.statLabel}>Change</span>
          </div>
        </div>
      </div>

      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height={220}>
          {showArea ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#666"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                stroke="#666"
                fontSize={11}
                tickLine={false}
                tickFormatter={(v: number) => v.toFixed(0)}
              />
              <Tooltip content={<CustomTooltip unit={unit} />} />
              <ReferenceLine y={avg} stroke="#666" strokeDasharray="4 4" label="" />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2.5}
                fill={`url(#gradient-${title})`}
                dot={{ r: 4, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: color, stroke: '#fff', strokeWidth: 2 }}
              />
            </AreaChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="#2A2A2A" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#666"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                domain={[yMin, yMax]}
                stroke="#666"
                fontSize={11}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip unit={unit} />} />
              <ReferenceLine y={avg} stroke="#666" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2.5}
                dot={{ r: 4, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: color, stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
