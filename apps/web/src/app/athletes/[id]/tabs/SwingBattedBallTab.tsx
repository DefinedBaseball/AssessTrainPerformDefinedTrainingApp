'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, ScalePips,
  VideoPlaceholder, NotesBox, ReportSelector, TabBarActions,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  toScoutingGrade, GRADE_RANGES,
  getReportVideoIds, getReportContentVideos,
  getReportUploadIds,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import { CustomCharts } from '@/components/CustomCharts';

/* ═══════════════════════════════════════════
   SPRAY CHART COMPONENT (SVG)
   Converts Direction (deg) + Distance (ft)
   into dots on a baseball field diagram.
   ═══════════════════════════════════════════ */

interface SprayDot {
  angle: number;         // spray angle in degrees (-45 to 45, 0 = center)
  distance: number;      // ft
  exitVelo?: number;     // mph
  launchAngle?: number;  // degrees
  batSpeed?: number;     // mph
  squaredUp?: number;    // percentage (0-100)
}

function SprayChart({ dots, selected, onSelect }: {
  dots: SprayDot[];
  selected: number | null;
  onSelect: (idx: number | null) => void;
}) {
  const W = 500;
  const H = 420;
  const cx = W / 2;
  const cy = H - 20;
  const maxDist = 420;
  const scale = (H - 50) / maxDist;

  const toXY = (angleDeg: number, dist: number): [number, number] => {
    const rad = ((90 - angleDeg) * Math.PI) / 180;
    const r = dist * scale;
    return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
  };

  const arcs = [150, 250, 350];
  const infieldR = 140 * scale;

  const dotColor = (ev?: number) => {
    if (!ev) return '#20808D';
    if (ev >= 95) return '#4ADE80';
    if (ev >= 85) return '#FBBF24';
    return '#F87171';
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 500, display: 'block', margin: '0 auto', cursor: 'default' }}>
      <defs>
        <radialGradient id="grassGrad" cx="50%" cy="100%" r="90%">
          <stop offset="0%" stopColor="#1a3a1a" />
          <stop offset="60%" stopColor="#163016" />
          <stop offset="100%" stopColor="#0f240f" />
        </radialGradient>
        <radialGradient id="dirtGrad" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="#5c4a32" />
          <stop offset="100%" stopColor="#4a3c28" />
        </radialGradient>
        <radialGradient id="warnGrad" cx="50%" cy="100%" r="90%">
          <stop offset="92%" stopColor="transparent" />
          <stop offset="93%" stopColor="rgba(90,70,45,0.25)" />
          <stop offset="100%" stopColor="rgba(90,70,45,0.35)" />
        </radialGradient>
        <clipPath id="fairClip">
          <path d={`M ${cx} ${cy} L ${cx - maxDist * scale} ${cy - maxDist * scale} A ${maxDist * scale} ${maxDist * scale} 0 0 1 ${cx + maxDist * scale} ${cy - maxDist * scale} Z`} />
        </clipPath>
      </defs>

      <rect width={W} height={H} fill="#0c1a0c" onClick={() => onSelect(null)} />

      <g clipPath="url(#fairClip)">
        <circle cx={cx} cy={cy} r={maxDist * scale} fill="url(#grassGrad)" />
        {[120, 180, 240, 300].map(d => {
          const r = d * scale;
          return (
            <path key={`mow${d}`}
              d={`M ${cx - r * Math.cos(Math.PI / 4)} ${cy - r * Math.sin(Math.PI / 4)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(Math.PI / 4)} ${cy - r * Math.sin(Math.PI / 4)}`}
              fill="none" stroke="rgba(255,255,255,0.025)" strokeWidth={12}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={maxDist * scale} fill="url(#warnGrad)" />
        <circle cx={cx} cy={cy} r={infieldR} fill="url(#dirtGrad)" />
        <circle cx={cx} cy={cy - infieldR * 0.42} r={infieldR * 0.48} fill="url(#grassGrad)" />
      </g>

      {[45, 135].map(deg => {
        const rad = (deg * Math.PI) / 180;
        const r = maxDist * scale;
        return (
          <line key={deg} x1={cx} y1={cy} x2={cx + r * Math.cos(rad)} y2={cy - r * Math.sin(rad)}
            stroke="rgba(255,255,255,0.25)" strokeWidth={1.5}
          />
        );
      })}

      {arcs.map(d => {
        const r = d * scale;
        return (
          <g key={d}>
            <path
              d={`M ${cx - r * Math.cos(Math.PI / 4)} ${cy - r * Math.sin(Math.PI / 4)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(Math.PI / 4)} ${cy - r * Math.sin(Math.PI / 4)}`}
              fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={0.75} strokeDasharray="6 4"
            />
            <text x={cx} y={cy - r - 5} fill="rgba(255,255,255,0.3)" fontSize={10} textAnchor="middle" fontWeight={500}>
              {d} ft
            </text>
          </g>
        );
      })}

      {(() => {
        const baseDist = 90 * scale * 0.72;
        const bases: [number, number][] = [
          [cx, cy - baseDist],
          [cx - baseDist * 0.7, cy - baseDist * 0.5],
          [cx + baseDist * 0.7, cy - baseDist * 0.5],
        ];
        return bases.map(([bx, by], i) => (
          <rect key={`base${i}`} x={bx - 3.5} y={by - 3.5} width={7} height={7}
            fill="#f0e6d0" stroke="rgba(255,255,255,0.3)" strokeWidth={0.5}
            transform={`rotate(45 ${bx} ${by})`}
          />
        ));
      })()}
      <polygon
        points={`${cx},${cy - 5} ${cx + 5},${cy - 2} ${cx + 4},${cy + 3} ${cx - 4},${cy + 3} ${cx - 5},${cy - 2}`}
        fill="#f0e6d0" stroke="rgba(255,255,255,0.3)" strokeWidth={0.5}
      />

      {dots.map((dot, i) => {
        const [x, y] = toXY(dot.angle, dot.distance);
        if (x < 0 || x > W || y < 0 || y > H) return null;
        const isSelected = selected === i;
        return (
          <circle key={i} cx={x} cy={y}
            r={isSelected ? 7 : 4.5}
            fill={dotColor(dot.exitVelo)}
            opacity={isSelected ? 1 : 0.85}
            stroke={isSelected ? '#fff' : 'rgba(0,0,0,0.4)'}
            strokeWidth={isSelected ? 2 : 0.75}
            style={{ cursor: 'pointer', transition: 'all 0.15s ease' }}
            onClick={e => { e.stopPropagation(); onSelect(isSelected ? null : i); }}
          />
        );
      })}

      <g transform="translate(10, 14)">
        <rect x={-4} y={-10} width={148} height={22} rx={4} fill="rgba(0,0,0,0.5)" />
        <circle cx={4} cy={0} r={4} fill="#4ADE80" />
        <text x={12} y={4} fill="rgba(255,255,255,0.7)" fontSize={9} fontWeight={500}>95+</text>
        <circle cx={44} cy={0} r={4} fill="#FBBF24" />
        <text x={52} y={4} fill="rgba(255,255,255,0.7)" fontSize={9} fontWeight={500}>85-94</text>
        <circle cx={92} cy={0} r={4} fill="#F87171" />
        <text x={100} y={4} fill="rgba(255,255,255,0.7)" fontSize={9} fontWeight={500}>&lt;85 mph</text>
      </g>
    </svg>
  );
}

/* BlastStatBox removed — Blast Motion now uses compact inline row */

/* ═══════════════════════════════════════════
   MAIN TAB
   ═══════════════════════════════════════════ */

const REPORT_TYPES = ['HITTING'];

export function SwingBattedBallTab({
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos,
}: TabProps) {
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);
  const swingMetrics = getTabMetrics(topMetrics, TAB_METRICS.swing);
  const battedMetrics = getTabMetrics(topMetrics, TAB_METRICS.battedBall);
  const hasSwing = Object.keys(swingMetrics).length > 0;
  const hasBatted = Object.keys(battedMetrics).length > 0;

  // Batted ball summary (avg/max from all sessions)
  const [bbSummary, setBbSummary] = useState<Record<string, { avg: number; max: number; min: number; count: number }>>({});
  // Blast Motion summary
  const [blastSummary, setBlastSummary] = useState<Record<string, { avg: number; max: number; min: number; count: number }>>({});
  // Spray chart data points
  const [sprayDots, setSprayDots] = useState<SprayDot[]>([]);
  // Selected dot + squared up filter
  const [selectedDot, setSelectedDot] = useState<number | null>(null);
  const [squaredUpFilter, setSquaredUpFilter] = useState(false);

  const filteredDots = useMemo(() => {
    if (!squaredUpFilter) return sprayDots;
    return sprayDots.filter(d => d.squaredUp != null && d.squaredUp >= 90);
  }, [sprayDots, squaredUpFilter]);

  // Reset selection when filter changes
  useEffect(() => { setSelectedDot(null); }, [squaredUpFilter]);

  // Extract uploadIds from the selected report for filtering
  const reportUploadIds = useMemo(() => getReportUploadIds(selectedReport), [selectedReport]);

  useEffect(() => {
    if (!player?.id) return;
    const ids = reportUploadIds.length > 0 ? reportUploadIds : undefined;
    // Fetch aggregated batted ball summary (Full Swing)
    api.getBattedBallSummary(player.id, 'FULL_SWING', ids).then(setBbSummary).catch(() => setBbSummary({}));
    // Fetch aggregated Blast Motion summary
    api.getBattedBallSummary(player.id, 'BLAST_MOTION', ids).then(setBlastSummary).catch(() => setBlastSummary({}));
    // Fetch raw session data for spray chart
    api.getSessionData(player.id, 'FULL_SWING', ['spray_angle', 'distance', 'max_exit_velo', 'launch_angle', 'bat_speed', 'squared_up_pct'], { uploadIds: ids })
      .then(data => {
        // Group data by recordedAt timestamp to pair all metrics per pitch
        const byTime = new Map<string, { angle?: number; distance?: number; exitVelo?: number; launchAngle?: number; batSpeed?: number; squaredUp?: number }>();
        for (const d of data) {
          const key = d.recordedAt;
          if (!byTime.has(key)) byTime.set(key, {});
          const entry = byTime.get(key)!;
          if (d.metricType === 'spray_angle') entry.angle = d.value;
          if (d.metricType === 'distance') entry.distance = d.value;
          if (d.metricType === 'max_exit_velo') entry.exitVelo = d.value;
          if (d.metricType === 'launch_angle') entry.launchAngle = d.value;
          if (d.metricType === 'bat_speed') entry.batSpeed = d.value;
          if (d.metricType === 'squared_up_pct') entry.squaredUp = d.value;
        }
        const dots: SprayDot[] = [];
        for (const entry of byTime.values()) {
          if (entry.angle !== undefined && entry.distance !== undefined && entry.distance > 0) {
            dots.push({
              angle: entry.angle, distance: entry.distance,
              exitVelo: entry.exitVelo, launchAngle: entry.launchAngle,
              batSpeed: entry.batSpeed, squaredUp: entry.squaredUp,
            });
          }
        }
        setSprayDots(dots);
      })
      .catch(() => setSprayDots([]));
  }, [player?.id, refreshKey, reportUploadIds]);

  const hasBlast = Object.keys(blastSummary).length > 0;
  const activeDot = selectedDot !== null ? filteredDots[selectedDot] : null;

  /* ── Recompute summary stats from filteredDots when Squared Up filter is active ── */
  const displaySummary = useMemo(() => {
    if (!squaredUpFilter) return bbSummary;
    const compute = (values: number[]) => {
      if (values.length === 0) return null;
      const sum = values.reduce((a, b) => a + b, 0);
      return { avg: sum / values.length, max: Math.max(...values), min: Math.min(...values), count: values.length };
    };
    const result: Record<string, { avg: number; max: number; min: number; count: number }> = {};
    const evs = filteredDots.map(d => d.exitVelo).filter((v): v is number => v != null);
    const las = filteredDots.map(d => d.launchAngle).filter((v): v is number => v != null);
    const bss = filteredDots.map(d => d.batSpeed).filter((v): v is number => v != null);
    const dists = filteredDots.map(d => d.distance).filter((v): v is number => v != null);
    const sqs = filteredDots.map(d => d.squaredUp).filter((v): v is number => v != null);
    const sfs = filteredDots.map(d => (d.exitVelo && d.batSpeed && d.batSpeed > 0) ? d.exitVelo / d.batSpeed : null).filter((v): v is number => v != null);
    const r = (k: string, vals: number[]) => { const c = compute(vals); if (c) result[k] = c; };
    r('max_exit_velo', evs); r('launch_angle', las); r('bat_speed', bss);
    r('distance', dists); r('smash_factor', sfs); r('squared_up_pct', sqs);
    return result;
  }, [squaredUpFilter, filteredDots, bbSummary]);

  const hasSummary = Object.keys(displaySummary).length > 0;

  // Scouting grade candidates
  const gradeKeys = ['max_bat_speed', 'avg_bat_speed', 'max_exit_velo', 'avg_exit_velo', 'bat_speed', 'smash_factor', 'distance'];
  const gradeable = gradeKeys.filter(k => topMetrics[k] && GRADE_RANGES[k]);

  /* ── Conditional color logic ── */
  const GREEN = '#4D9B6A';
  const YELLOW = '#B09030';
  const RED = '#B85454';
  const BLUE = '#3B82F6';
  const LIGHT_BLUE = '#7DD3FC';

  /** Pct-of-max helper: returns how much avg is as a % of max */
  const pctOfMax = (avg: number, max: number) => max > 0 ? (avg / max) * 100 : 0;

  const getMetricColor = (key: string, avg: number, max: number): string => {
    switch (key) {
      case 'max_exit_velo': {
        if (max <= 0) return BLUE;
        const pctDiff = ((max - avg) / max) * 100;
        if (pctDiff <= 15) return GREEN;
        if (pctDiff <= 20) return YELLOW;
        return RED;
      }
      case 'launch_angle': {
        if (avg >= 10 && avg <= 25) return GREEN;
        if ((avg >= 1 && avg < 10) || (avg > 25 && avg <= 30)) return YELLOW;
        return RED;
      }
      case 'bat_speed': {
        // Avg within 95% of max = green, 90-94.9% = yellow, <90% = red
        if (max <= 0) return BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 95) return GREEN;
        if (pct >= 90) return YELLOW;
        return RED;
      }
      case 'distance': {
        if (max <= 0) return BLUE;
        const pctDiff = ((max - avg) / max) * 100;
        if (pctDiff <= 30) return GREEN;
        if (pctDiff <= 40) return YELLOW;
        return RED;
      }
      case 'smash_factor': {
        if (avg > 1.4) return GREEN;
        if (avg >= 1.0) return YELLOW;
        return RED;
      }
      case 'squared_up_pct': {
        if (avg > 92) return GREEN;
        if (avg >= 80) return YELLOW;
        return RED;
      }
      default:
        return BLUE;
    }
  };

  /** Color logic for Blast Motion metrics */
  const getBlastColor = (key: string, avg: number, max: number): string => {
    switch (key) {
      case 'max_bat_speed': {
        if (max <= 0) return LIGHT_BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 95) return GREEN;
        if (pct >= 90) return YELLOW;
        return RED;
      }
      case 'peak_hand_speed': {
        if (max <= 0) return LIGHT_BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 90) return GREEN;
        if (pct >= 80) return YELLOW;
        return RED;
      }
      case 'attack_angle': {
        if (avg >= 5 && avg <= 15) return GREEN;
        if ((avg >= 0 && avg < 5) || (avg > 15 && avg <= 20)) return YELLOW;
        return RED;
      }
      case 'vertical_bat_angle': {
        if (avg >= 25 && avg <= 40) return GREEN;
        if ((avg >= 15 && avg < 25) || (avg > 40 && avg <= 45)) return YELLOW;
        return RED;
      }
      case 'on_plane_efficiency': {
        if (avg > 85) return GREEN;
        if (avg >= 70) return YELLOW;
        return RED;
      }
      case 'power_output': {
        if (max <= 0) return LIGHT_BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 85) return GREEN;
        if (pct >= 70) return YELLOW;
        return RED;
      }
      case 'time_to_contact': {
        if (avg <= 0.16) return GREEN;
        if (avg <= 0.19) return YELLOW;
        return RED;
      }
      default:
        return LIGHT_BLUE;
    }
  };

  /** Color logic for Report Notes scouting cards */
  const getReportCardColor = (key: string, value: number, avg: number, max: number): string => {
    switch (key) {
      case 'plane_score': {
        if (value >= 65 && value <= 80) return GREEN;
        if (value >= 50 && value < 65) return YELLOW;
        return RED;
      }
      case 'squared_up': {
        if (value > 92) return GREEN;
        if (value >= 80) return YELLOW;
        return RED;
      }
      case 'max_ev': {
        // Same as exit velo: avg within 15% of max = green
        if (max <= 0) return BLUE;
        const pctDiff = ((max - avg) / max) * 100;
        if (pctDiff <= 15) return GREEN;
        if (pctDiff <= 20) return YELLOW;
        return RED;
      }
      case 'bat_speed': {
        if (max <= 0) return BLUE;
        const pct = pctOfMax(avg, max);
        if (pct >= 95) return GREEN;
        if (pct >= 90) return YELLOW;
        return RED;
      }
      default:
        return BLUE;
    }
  };

  /* ── Summary stat definitions ── */
  const summaryStats = [
    { key: 'max_exit_velo', label: 'Exit Velocity', unit: 'mph' },
    { key: 'launch_angle',  label: 'Launch Angle',  unit: '°' },
    { key: 'bat_speed',     label: 'Bat Speed',     unit: 'mph' },
    { key: 'distance',      label: 'Distance',      unit: 'ft' },
    { key: 'smash_factor',  label: 'Smash Factor',  unit: '' },
    { key: 'squared_up_pct',label: 'Square-Up %',   unit: '%' },
  ];

  /* ── Selected-dot bubble definitions ── */
  const dotBubbles = [
    { label: 'Exit Velo',    value: activeDot?.exitVelo,    unit: 'mph', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Launch Angle', value: activeDot?.launchAngle, unit: '°',   color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Bat Speed',    value: activeDot?.batSpeed,    unit: 'mph', color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
    { label: 'Distance',     value: activeDot?.distance,    unit: 'ft',  color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' },
  ];

  return (
    <>
      {/* ── Report Selector (portaled into TabBar) ── */}
      <TabBarActions>
        <ReportSelector
          reports={reports}
          reportTypes={REPORT_TYPES}
          label="Swing / Batted Ball"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
      </TabBarActions>

      {/* ═══ COMBINED Batted Ball Data + Spray Chart ═══ */}
      <Section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <SectionHeader
            icon="📊"
            iconColor="gold"
            title="Batted Ball Data"
            subtitle={squaredUpFilter
              ? `${filteredDots.length} of ${sprayDots.length} squared-up balls · Full Swing`
              : sprayDots.length > 0
                ? `${sprayDots.length} batted balls · Full Swing`
                : 'Full Swing'
            }
          />
          {sprayDots.length > 0 && (
            <button
              onClick={() => setSquaredUpFilter(f => !f)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px',
                borderRadius: 10,
                border: squaredUpFilter ? '1.5px solid #4ADE80' : '1.5px solid var(--border)',
                background: squaredUpFilter ? 'rgba(74,222,128,0.10)' : 'transparent',
                color: squaredUpFilter ? '#4ADE80' : 'var(--text-muted)',
                fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                marginRight: 4,
              }}
            >
              <span style={{ fontSize: 14 }}>🎯</span>
              Squared Up
              {squaredUpFilter && (
                <span style={{
                  background: '#4ADE80', color: '#000', fontSize: 10, fontWeight: 700,
                  borderRadius: 8, padding: '1px 6px', marginLeft: 2,
                }}>
                  {filteredDots.length}
                </span>
              )}
            </button>
          )}
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          overflow: 'hidden',
        }}>

          {/* ── Summary Stats Row ── */}
          {hasSummary && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 0,
              borderBottom: '1px solid var(--border)',
            }}>
              {summaryStats.map((stat, i) => {
                const data = displaySummary[stat.key];
                if (!data) return (
                  <div key={stat.key} style={{
                    padding: '16px 12px',
                    textAlign: 'center',
                    borderRight: i < 5 ? '1px solid var(--border)' : 'none',
                    opacity: 0.35,
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
                      {stat.label}
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: 'var(--faint)' }}>—</div>
                  </div>
                );
                const statColor = getMetricColor(stat.key, data.avg, data.max);
                return (
                  <div key={stat.key} style={{
                    padding: '16px 12px',
                    textAlign: 'center',
                    borderRight: i < 5 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
                      {stat.label}
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: statColor, lineHeight: 1 }}>
                      {data.avg.toFixed(stat.key === 'smash_factor' ? 2 : 1)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>avg</div>
                    <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                      Max: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{data.max.toFixed(stat.key === 'smash_factor' ? 2 : 1)}</span>{stat.unit ? ` ${stat.unit}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Spray Chart ── */}
          <div style={{ padding: '20px 16px 12px' }}>
            {filteredDots.length > 0 ? (
              <SprayChart dots={filteredDots} selected={selectedDot} onSelect={setSelectedDot} />
            ) : sprayDots.length > 0 ? (
              /* Filter is on but no dots match */
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
                <div>No squared-up batted balls found (≥90%)</div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🏟️</div>
                <div>Spray chart will populate with Full Swing batted ball data</div>
                <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                  Upload a Full Swing CSV with Direction and Distance columns
                </div>
              </div>
            )}
          </div>

          {/* ── Selected Point Bubbles ── */}
          {activeDot && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 10,
            padding: '0 16px 16px',
            flexWrap: 'wrap',
          }}>
            {
              dotBubbles.map(b => (
                <div key={b.label} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  background: b.bg,
                  border: `1.5px solid ${b.color}`,
                  borderRadius: 14,
                  padding: '12px 20px',
                  minWidth: 100,
                  transition: 'all 0.2s ease',
                }}>
                  <span style={{
                    fontSize: 24,
                    fontWeight: 700,
                    fontFamily: "'DM Mono', monospace",
                    color: b.color,
                    lineHeight: 1,
                  }}>
                    {b.value != null ? b.value.toFixed(1) : '—'}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: b.color,
                    marginTop: 4,
                    opacity: 0.8,
                  }}>
                    {b.label}
                  </span>
                  {b.value != null && b.unit && (
                    <span style={{ fontSize: 9, color: 'var(--faint)', marginTop: 1 }}>{b.unit}</span>
                  )}
                </div>
              ))
            }
          </div>
          )}

          {/* ── Blast Motion Swing Metrics (inside same grey frame) ── */}
          {hasBlast && (() => {
            type BlastExtra = 'max' | 'range' | 'none';
            interface BlastItem {
              metricKey: string; label: string; avg: number; max: number; min: number;
              unit: string; decimals: number; extra: BlastExtra;
            }
            const blastItems: BlastItem[] = [];
            if (blastSummary.max_bat_speed) blastItems.push({ metricKey: 'max_bat_speed', label: 'Bat Speed', ...blastSummary.max_bat_speed, unit: 'mph', decimals: 1, extra: 'max' });
            if (blastSummary.peak_hand_speed) blastItems.push({ metricKey: 'peak_hand_speed', label: 'Hand Speed', ...blastSummary.peak_hand_speed, unit: 'mph', decimals: 1, extra: 'max' });
            if (blastSummary.attack_angle) blastItems.push({ metricKey: 'attack_angle', label: 'Attack Angle', ...blastSummary.attack_angle, unit: '°', decimals: 1, extra: 'range' });
            if (blastSummary.vertical_bat_angle) blastItems.push({ metricKey: 'vertical_bat_angle', label: 'Vert Bat Angle', ...blastSummary.vertical_bat_angle, unit: '°', decimals: 1, extra: 'range' });
            if (blastSummary.time_to_contact) blastItems.push({ metricKey: 'time_to_contact', label: 'Time to Contact', ...blastSummary.time_to_contact, unit: 'sec', decimals: 2, extra: 'range' });
            if (blastSummary.on_plane_efficiency) blastItems.push({ metricKey: 'on_plane_efficiency', label: 'On Plane Eff', ...blastSummary.on_plane_efficiency, unit: '%', decimals: 1, extra: 'max' });
            if (blastSummary.power_output) blastItems.push({ metricKey: 'power_output', label: 'Power Output', ...blastSummary.power_output, unit: 'kW', decimals: 2, extra: 'max' });
            if (blastItems.length === 0) return null;
            return (
              <>
                <div style={{
                  borderTop: '1px solid var(--border)',
                  padding: '10px 16px 6px',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ fontSize: 16 }}>🏏</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                    Blast Motion Swing Metrics
                  </span>
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${blastItems.length}, 1fr)`,
                  gap: 0,
                  borderTop: '1px solid var(--border)',
                }}>
                  {blastItems.map((item, i) => {
                    const itemColor = getBlastColor(item.metricKey, item.avg, item.max);
                    return (
                    <div key={item.label} style={{
                      padding: '12px 8px',
                      textAlign: 'center',
                      borderRight: i < blastItems.length - 1 ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{
                        fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
                        letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {item.label}
                      </div>
                      <div style={{
                        fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono', monospace",
                        color: itemColor, lineHeight: 1,
                      }}>
                        {item.avg.toFixed(item.decimals)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>
                        {item.unit} avg
                      </div>
                      {item.extra === 'max' && (
                        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                          Max: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{item.max.toFixed(item.decimals)}</span>{item.unit ? ` ${item.unit}` : ''}
                        </div>
                      )}
                      {item.extra === 'range' && (
                        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                          Range: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{item.min.toFixed(item.decimals)} – {item.max.toFixed(item.decimals)}</span>{item.unit ? ` ${item.unit}` : ''}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </>
            );
          })()}

        </div>
      </Section>

      {/* ── Report Notes (Scouting Grades + Coaching Notes combined) ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'Coaching notes will appear here after assessment review.', placeholder: true },
              { text: 'Bat speed trends, mechanical observations, and drill recommendations.', placeholder: true },
            ];

        // Scouting grade mini-cards: Plane Score, Squared Up %, Max EV, Bat Speed
        const planeAvg = blastSummary.plane_angle?.avg ?? null;
        const planeMax = blastSummary.plane_angle?.max ?? null;
        const sqUpAvg = bbSummary.squared_up_pct?.avg ?? blastSummary.squared_up_pct?.avg ?? null;
        const evMax = bbSummary.max_exit_velo?.max ?? null;
        const evAvg = bbSummary.max_exit_velo?.avg ?? null;
        const bsMax = blastSummary.max_bat_speed?.max ?? bbSummary.bat_speed?.max ?? null;
        const bsAvg = blastSummary.max_bat_speed?.avg ?? bbSummary.bat_speed?.avg ?? null;

        interface ReportCard {
          key: string; label: string; value: number | null; subLabel: string; subValue: number | null; unit: string;
        }
        const scoutingCards: ReportCard[] = [
          {
            key: 'plane_score', label: 'Plane Score',
            value: planeAvg, subLabel: 'Best', subValue: planeMax, unit: '',
          },
          {
            key: 'squared_up', label: 'Squared Up %',
            value: sqUpAvg, subLabel: '', subValue: null, unit: '%',
          },
          {
            key: 'max_ev', label: 'Max EV',
            value: evMax, subLabel: 'Avg', subValue: evAvg, unit: 'mph',
          },
          {
            key: 'bat_speed', label: 'Bat Speed',
            value: bsMax, subLabel: 'Avg', subValue: bsAvg, unit: 'mph',
          },
        ];
        const hasAnyGrade = scoutingCards.some(c => c.value !== null);

        return (
          <Section>
            <SectionHeader icon="📋" iconColor="green" title="Report Notes" />

            {/* Scouting Grade mini-window */}
            {hasAnyGrade && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 10,
                marginBottom: 14,
              }}>
                {scoutingCards.map(card => {
                  const cardColor = card.value !== null
                    ? getReportCardColor(card.key, card.value, card.subValue ?? 0, card.value)
                    : 'var(--faint)';
                  return (
                  <div key={card.label} style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                  }}>
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted)',
                    }}>
                      {card.label}
                    </span>
                    <span style={{
                      fontSize: 22,
                      fontWeight: 700,
                      fontFamily: "'DM Mono', monospace",
                      color: cardColor,
                    }}>
                      {card.value !== null ? card.value.toFixed(1) : '—'}
                    </span>
                    {card.value !== null && card.unit && (
                      <span style={{ fontSize: 9, color: 'var(--faint)' }}>{card.unit}</span>
                    )}
                    {card.subValue !== null && card.subLabel && (
                      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>
                        {card.subLabel}: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{card.subValue.toFixed(1)}</span>{card.unit ? ` ${card.unit}` : ''}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}

            <NotesBox label="SWING ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'HITTING'
        );
        const contentVideos = getReportContentVideos(selectedReport);
        const hasVideos = reportVideos.length > 0 || contentVideos.length > 0;
        return (
          <Section>
            <SectionHeader icon="🎬" iconColor="teal" title="Video" />
            {hasVideos ? (
              <div className={aStyles.twoCol}>
                {reportVideos.map(v => (
                  <VideoPlaceholder
                    key={v.id}
                    tag={v.category}
                    title={v.title}
                    subtitle={new Date(v.createdAt).toLocaleDateString()}
                    size="md"
                    videoUrl={v.originalUrl}
                  />
                ))}
                {reportVideos.length === 0 && contentVideos.map((v, i) => (
                  <VideoPlaceholder
                    key={`content-${i}`}
                    tag="HITTING"
                    title={v.name.replace(/\.[^.]+$/, '')}
                    subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`}
                    size="md"
                    videoUrl={v.url}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.emptyMsg}>No video data.</div>
            )}
          </Section>
        );
      })()}

      <CustomCharts section="HITTING" playerId={player.id} />

    </>
  );
}
