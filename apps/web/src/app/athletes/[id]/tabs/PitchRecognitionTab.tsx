'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section,
  ScoreBar, NotesBox, VideoPlaceholder,
  ReportSelector, TabBarActions,
} from '@/components/assessment';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from '../page.module.css';
import {
  TabProps, METRIC_LABELS, TAB_METRICS,
  getBadgeLevel, getBadgeText, getTabMetrics,
  getReportVideoIds, getReportContentVideos,
  getReportUploadIds,
  type ReportSummary,
} from '../helpers';
import * as api from '@/lib/api';
import type { AtBat, AtBatPitch, AtBatAssessment, AtBatMetrics } from '@/lib/atbat-parser';

/* ── Pitch type colors ── */
const PITCH_TYPE_COLORS: Record<string, string> = {
  Fastball:  '#EF4444',
  Sinker:    '#F97316',
  Cutter:    '#A855F7',
  Slider:    '#EAB308',
  Curveball: '#22C55E',
  Changeup:  '#3B82F6',
  Sweeper:   '#EC4899',
  Splitter:  '#14B8A6',
};

/* ── Result colors ── */
const RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  'Barrel':              { bg: 'rgba(74,222,128,0.18)', text: '#4ADE80' },
  'Foul':                { bg: 'rgba(251,191,36,0.15)', text: '#FBBF24' },
  'Ball':                { bg: 'rgba(96,165,250,0.15)', text: '#60A5FA' },
  'Strike Looking':      { bg: 'rgba(248,113,113,0.12)', text: '#F87171' },
  'Swinging Strike':     { bg: 'rgba(248,113,113,0.18)', text: '#F87171' },
  'Pop-Out':             { bg: 'rgba(156,163,175,0.15)', text: '#9CA3AF' },
  'Ground-Out':          { bg: 'rgba(156,163,175,0.15)', text: '#9CA3AF' },
  'Walk':                { bg: 'rgba(96,165,250,0.18)', text: '#60A5FA' },
  'Strike Out Looking':  { bg: 'rgba(239,68,68,0.2)', text: '#EF4444' },
  'Strike Out Swinging': { bg: 'rgba(239,68,68,0.2)', text: '#EF4444' },
};

/* ── Conditional color constants ── */
const GREEN = '#4D9B6A';
const YELLOW = '#B09030';
const RED = '#B85454';
const BLUE = '#3B82F6';

/** Color logic for At-Bat assessment metrics */
const getAtBatColor = (metricType: 'barrel' | 'whiff' | 'zone_swing' | 'chase', value: number): string => {
  switch (metricType) {
    case 'barrel':
      if (value > 50) return GREEN;
      if (value >= 30) return YELLOW;
      return RED;
    case 'whiff':
      if (value <= 15) return GREEN;
      if (value <= 30) return YELLOW;
      return RED;
    case 'zone_swing':
      if (value > 70) return GREEN;
      if (value >= 40) return YELLOW;
      return RED;
    case 'chase':
      if (value < 15) return GREEN;
      if (value <= 25) return YELLOW;
      return RED;
  }
};

/** Pct-of-max helper */
const pctOfMax = (avg: number, max: number) => max > 0 ? (avg / max) * 100 : 0;

/** Color logic for Full Swing metrics (same as Swing/Batted Ball tab) */
const getFsMetricColor = (key: string, avg: number, max: number): string => {
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
    case 'squared_up_pct': {
      if (avg > 92) return GREEN;
      if (avg >= 80) return YELLOW;
      return RED;
    }
    case 'smash_factor': {
      if (avg > 1.4) return GREEN;
      if (avg >= 1.0) return YELLOW;
      return RED;
    }
    default: return BLUE;
  }
};

/* ── Metric display card ── */
function MetricPctCard({ label, value, higherIsBetter, color }: {
  label: string; value: number | null; higherIsBetter?: boolean; color?: string;
}) {
  let levelColor = 'var(--text-muted)';
  if (value !== null && higherIsBetter !== undefined) {
    // Simple coloring: green=good, yellow=mid, red=bad
    const good = higherIsBetter ? value >= 20 : value <= 20;
    const mid = higherIsBetter ? value >= 10 : value <= 35;
    levelColor = good ? '#4ADE80' : mid ? '#FBBF24' : '#F87171';
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--text-muted)', textAlign: 'center',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono', monospace",
        color: value !== null ? (color || levelColor) : 'var(--faint)',
      }}>
        {value !== null ? `${value.toFixed(1)}%` : '—'}
      </div>
    </div>
  );
}

/* ── At-Bat detail row ── */
function AtBatDetail({ atBat }: { atBat: AtBat }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '12px 0',
    }}>
      {atBat.pitches.map((p, i) => {
        const pitchColor = PITCH_TYPE_COLORS[p.type] || '#6B7280';
        const resultStyle = RESULT_COLORS[p.result] || { bg: 'rgba(107,114,128,0.15)', text: '#6B7280' };
        const isFinalPitch = i === atBat.pitches.length - 1;
        return (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: '32px 1fr 80px 1fr',
            alignItems: 'center',
            gap: 10,
            padding: '6px 10px',
            background: isFinalPitch ? 'rgba(255,255,255,0.03)' : 'transparent',
            borderRadius: 6,
            borderLeft: isFinalPitch ? '3px solid var(--accent)' : '3px solid transparent',
          }}>
            {/* Pitch number */}
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--faint)',
              fontFamily: "'DM Mono', monospace",
            }}>
              #{p.pitchNumber}
            </span>

            {/* Pitch type pill */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: pitchColor, flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {p.type}
              </span>
            </div>

            {/* Ball/Strike */}
            <span style={{
              fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
              color: p.ballStrike === 'Strike' ? '#F87171' : '#60A5FA',
              textAlign: 'center',
            }}>
              {p.ballStrike}
            </span>

            {/* Result badge */}
            <span style={{
              fontSize: 11, fontWeight: 600,
              padding: '3px 8px', borderRadius: 6,
              background: resultStyle.bg, color: resultStyle.text,
              textAlign: 'center', whiteSpace: 'nowrap',
            }}>
              {p.result}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN TAB
   ═══════════════════════════════════════════ */

const AT_BAT_REPORT_TYPES = ['AT_BAT_RESULTS', 'COGNITION'];

export function PitchRecognitionTab({
  player, topMetrics, isCoach, onRefresh, refreshKey, reports, videos: playerVideos,
}: TabProps) {
  const recMetrics = getTabMetrics(topMetrics, TAB_METRICS.pitchRec);
  const hasRecData = Object.keys(recMetrics).length > 0;

  // Build a filtered list: reports matching type OR containing atBatAssessment data
  const atBatReports = useMemo(() => {
    return reports.filter(r => {
      if (AT_BAT_REPORT_TYPES.includes(r.reportType)) return true;
      // Also include any report that contains atBatAssessment content
      if (r.content) {
        try {
          const parsed = JSON.parse(r.content);
          if (parsed.atBatAssessment) return true;
        } catch { /* skip */ }
      }
      return false;
    });
  }, [reports]);

  // Selected report
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  // Full Swing batted ball summary (for Avg EV)
  const [fsSummary, setFsSummary] = useState<Record<string, { avg: number; max: number; min: number; count: number }>>({});

  // At-Bat Assessment data from the selected report
  const [atBatData, setAtBatData] = useState<AtBatAssessment | null>(null);
  const [expandedAB, setExpandedAB] = useState<number | null>(null);
  const [atBatLogOpen, setAtBatLogOpen] = useState(false);

  // Extract uploadIds from the selected report for filtering
  const reportUploadIds = useMemo(() => getReportUploadIds(selectedReport), [selectedReport]);

  // Fetch Full Swing data (filtered by report when selected)
  useEffect(() => {
    if (!player?.id) return;
    const ids = reportUploadIds.length > 0 ? reportUploadIds : undefined;
    api.getBattedBallSummary(player.id, 'FULL_SWING', ids).then(setFsSummary).catch(() => setFsSummary({}));
  }, [player?.id, refreshKey, reportUploadIds]);

  // Extract at-bat data from the selected report
  useEffect(() => {
    if (!selectedReport?.content) { setAtBatData(null); return; }
    try {
      const parsed = JSON.parse(selectedReport.content);
      if (parsed.atBatAssessment) {
        setAtBatData(parsed.atBatAssessment as AtBatAssessment);
        return;
      }
    } catch { /* skip */ }
    setAtBatData(null);
  }, [selectedReport]);

  // Compute metrics (with Avg EV from Full Swing data)
  const metrics: AtBatMetrics | null = useMemo(() => {
    if (!atBatData) return null;
    const m = { ...atBatData.metrics };
    // Attach avg EV from Full Swing if available
    if (fsSummary.max_exit_velo) {
      m.avgEv = fsSummary.max_exit_velo.avg;
    }
    return m;
  }, [atBatData, fsSummary]);

  const hasAtBats = atBatData && atBatData.atBats.length > 0;
  const hasFsData = Object.keys(fsSummary).length > 0;

  // Pitch count summaries for header info
  const pitchSummary = useMemo(() => {
    if (!atBatData) return null;
    const allPitches = atBatData.atBats.flatMap(ab => ab.pitches);
    const fbCount = allPitches.filter(p => ['Fastball', 'Sinker'].includes(p.type)).length;
    const osCount = allPitches.filter(p => ['Curveball', 'Slider', 'Sweeper', 'Cutter', 'Changeup', 'Splitter'].includes(p.type)).length;
    return {
      totalPitches: allPitches.length,
      totalABs: atBatData.atBats.length,
      fbCount,
      osCount,
    };
  }, [atBatData]);

  return (
    <>
      {/* ── Report Selector (portaled into TabBar) ── */}
      <TabBarActions>
        <ReportSelector
          reports={atBatReports}
          reportTypes={[]}
          label="At-Bat Results"
          isCoach={isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={onRefresh}
        />
      </TabBarActions>

      {/* ── At-Bat Assessment Metrics ── */}
      <Section>
        <SectionHeader
          icon="📊"
          iconColor="teal"
          title="At-Bat Assessment"
          subtitle={pitchSummary
            ? `${pitchSummary.totalABs} ABs \u00b7 ${pitchSummary.totalPitches} pitches`
            : 'Calculated from at-bat data'
          }
        />
        {metrics ? (
          <>
            {/* FB Metrics Row */}
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: '#EF4444', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }} />
                Fastball ({pitchSummary?.fbCount || 0} pitches)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <MetricPctCard label="FB Barrel%" value={metrics.fbBarrelPct} color={metrics.fbBarrelPct !== null ? getAtBatColor('barrel', metrics.fbBarrelPct) : undefined} />
                <MetricPctCard label="FB Whiff%" value={metrics.fbWhiffPct} color={metrics.fbWhiffPct !== null ? getAtBatColor('whiff', metrics.fbWhiffPct) : undefined} />
                <MetricPctCard label="FB In-Zone Swing%" value={metrics.fbInZoneSwingPct} color={metrics.fbInZoneSwingPct !== null ? getAtBatColor('zone_swing', metrics.fbInZoneSwingPct) : undefined} />
                <MetricPctCard label="FB Chase%" value={metrics.fbChasePct} color={metrics.fbChasePct !== null ? getAtBatColor('chase', metrics.fbChasePct) : undefined} />
              </div>
            </div>

            {/* OS Metrics Row */}
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: '#3B82F6', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3B82F6' }} />
                Off-Speed ({pitchSummary?.osCount || 0} pitches)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <MetricPctCard label="OS Barrel%" value={metrics.osBarrelPct} color={metrics.osBarrelPct !== null ? getAtBatColor('barrel', metrics.osBarrelPct) : undefined} />
                <MetricPctCard label="OS Whiff%" value={metrics.osWhiffPct} color={metrics.osWhiffPct !== null ? getAtBatColor('whiff', metrics.osWhiffPct) : undefined} />
                <MetricPctCard label="OS In-Zone Swing%" value={metrics.osInZoneSwingPct} color={metrics.osInZoneSwingPct !== null ? getAtBatColor('zone_swing', metrics.osInZoneSwingPct) : undefined} />
                <MetricPctCard label="OS Chase%" value={metrics.osChasePct} color={metrics.osChasePct !== null ? getAtBatColor('chase', metrics.osChasePct) : undefined} />
              </div>
            </div>

            {/* Overall Metrics Row */}
            <div>
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--accent-light)', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-light)' }} />
                Overall
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <MetricPctCard label="Barrel%" value={metrics.overallBarrelPct} color={metrics.overallBarrelPct !== null ? getAtBatColor('barrel', metrics.overallBarrelPct) : undefined} />
                <MetricPctCard label="BB%" value={metrics.overallBbPct} higherIsBetter={true} />
                <MetricPctCard label="K%" value={metrics.overallKPct} higherIsBetter={false} />
                {/* Avg EV - not a percentage */}
                <div style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: '14px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.06em', color: 'var(--text-muted)', textAlign: 'center',
                  }}>
                    Avg EV
                  </div>
                  <div style={{
                    fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono', monospace",
                    color: metrics.avgEv !== null ? '#FBBF24' : 'var(--faint)',
                  }}>
                    {metrics.avgEv !== null ? metrics.avgEv.toFixed(1) : '—'}
                  </div>
                  {metrics.avgEv !== null && (
                    <span style={{ fontSize: 9, color: 'var(--faint)' }}>mph</span>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyMsg}>
            No at-bat assessment data available.
            <span className={styles.emptyHint}>
              {isCoach
                ? 'Upload an At-Bat Assessment XLSX from the New Report modal (At-Bat Results type).'
                : 'Ask your coach to upload at-bat assessment data.'}
            </span>
          </div>
        )}
      </Section>

      {/* ── Full Swing Data Section ── */}
      <Section>
        <SectionHeader
          icon="🏏"
          iconColor="gold"
          title="Full Swing Data"
          subtitle={hasFsData ? 'Batted ball metrics from Full Swing' : undefined}
        />
        {hasFsData ? (() => {
          const fsStats: { key: string; label: string; unit: string; decimals: number; extra: 'max' | 'range' }[] = [
            { key: 'max_exit_velo', label: 'Exit Velocity', unit: 'mph', decimals: 1, extra: 'max' },
            { key: 'launch_angle',  label: 'Launch Angle',  unit: '°',   decimals: 1, extra: 'range' },
            { key: 'bat_speed',     label: 'Bat Speed',     unit: 'mph', decimals: 1, extra: 'max' },
            { key: 'distance',      label: 'Distance',      unit: 'ft',  decimals: 0, extra: 'max' },
            { key: 'squared_up_pct',label: 'Square-Up %',   unit: '%',   decimals: 1, extra: 'max' },
          ];
          const available = fsStats.filter(s => fsSummary[s.key]);
          return (
            <div style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: `repeat(${available.length}, 1fr)`,
              gap: 0,
            }}>
              {available.map((stat, i) => {
                const data = fsSummary[stat.key];
                const statColor = getFsMetricColor(stat.key, data.avg, data.max);
                return (
                  <div key={stat.key} style={{
                    padding: '16px 12px',
                    textAlign: 'center',
                    borderRight: i < available.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 6 }}>
                      {stat.label}
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: statColor, lineHeight: 1 }}>
                      {data.avg.toFixed(stat.decimals)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>avg</div>
                    {stat.extra === 'max' && (
                      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                        Max: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{data.max.toFixed(stat.decimals)}</span>{stat.unit ? ` ${stat.unit}` : ''}
                      </div>
                    )}
                    {stat.extra === 'range' && (
                      <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 4 }}>
                        Range: <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{data.min.toFixed(stat.decimals)} – {data.max.toFixed(stat.decimals)}</span>{stat.unit ? ` ${stat.unit}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })() : (
          <div className={styles.emptyMsg}>
            No Full Swing data available.
            <span className={styles.emptyHint}>
              {isCoach
                ? 'Upload Full Swing data via an At-Bat Results or Hitting report to populate this section.'
                : 'Ask your coach to upload Full Swing data.'}
            </span>
          </div>
        )}
      </Section>

      {/* ── At-Bat Log (Collapsible section with dropdown per AB) ── */}
      <Section>
        <button
          onClick={() => setAtBatLogOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            width: '100%', background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'inherit', padding: 0, textAlign: 'left',
          }}
        >
          <SectionHeader
            icon="📝"
            iconColor="green"
            title="At-Bat Log"
            subtitle={hasAtBats ? `${atBatData!.atBats.length} at-bats recorded` : undefined}
          />
          {hasAtBats && (
            <span style={{
              fontSize: 16, color: 'var(--faint)', marginLeft: 'auto',
              transform: atBatLogOpen ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.25s ease',
              flexShrink: 0,
            }}>
              ▼
            </span>
          )}
        </button>
        {hasAtBats && atBatLogOpen ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {atBatData!.atBats.map(ab => {
              const isOpen = expandedAB === ab.number;
              const lastPitch = ab.pitches[ab.pitches.length - 1];
              const resultStyle = RESULT_COLORS[ab.finalResult] || { bg: 'rgba(107,114,128,0.15)', text: '#6B7280' };

              // Build count string (B-S)
              let balls = 0, strikes = 0;
              for (const p of ab.pitches) {
                if (p.ballStrike === 'Ball' && !['Foul'].includes(p.result)) balls++;
                else if (p.ballStrike === 'Strike' || p.result === 'Foul') {
                  if (strikes < 2 || p.result !== 'Foul') strikes++;
                  else if (p.result === 'Foul' && strikes >= 2) { /* foul w/ 2 strikes doesn't increment */ }
                }
              }

              return (
                <div key={ab.number} style={{
                  background: 'var(--surface)',
                  border: isOpen ? '1px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 10,
                  overflow: 'hidden',
                  transition: 'border-color 0.2s ease',
                }}>
                  {/* Header row (always visible) */}
                  <button
                    onClick={() => setExpandedAB(isOpen ? null : ab.number)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '50px 1fr auto auto 30px',
                      alignItems: 'center',
                      gap: 12,
                      width: '100%',
                      padding: '12px 16px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    {/* AB number */}
                    <span style={{
                      fontSize: 13, fontWeight: 800, color: 'var(--accent)',
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      AB {ab.number}
                    </span>

                    {/* Pitch type summary mini-dots */}
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                      {ab.pitches.map((p, i) => (
                        <span
                          key={i}
                          title={`#${p.pitchNumber}: ${p.type} - ${p.result}`}
                          style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: PITCH_TYPE_COLORS[p.type] || '#6B7280',
                            opacity: 0.85,
                          }}
                        />
                      ))}
                      <span style={{ fontSize: 10, color: 'var(--faint)', marginLeft: 4 }}>
                        {ab.pitches.length}p
                      </span>
                    </div>

                    {/* Result badge */}
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      padding: '4px 10px', borderRadius: 6,
                      background: resultStyle.bg, color: resultStyle.text,
                      whiteSpace: 'nowrap',
                    }}>
                      {ab.finalResult}
                    </span>

                    {/* Count */}
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                      fontFamily: "'DM Mono', monospace",
                    }}>
                      {/* empty - just spacing */}
                    </span>

                    {/* Chevron */}
                    <span style={{
                      fontSize: 14, color: 'var(--faint)',
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                      transition: 'transform 0.2s ease',
                    }}>
                      ▼
                    </span>
                  </button>

                  {/* Expanded pitch-by-pitch detail */}
                  {isOpen && (
                    <div style={{
                      borderTop: '1px solid var(--border)',
                      padding: '4px 12px 8px',
                    }}>
                      <AtBatDetail atBat={ab} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : !hasAtBats ? (
          <div className={styles.emptyMsg} style={{ marginTop: 12 }}>
            No at-bat log data.
            <span className={styles.emptyHint}>
              {isCoach
                ? 'Upload an At-Bat Assessment XLSX from the New Report modal (At-Bat Results type).'
                : 'Ask your coach to upload at-bat data.'}
            </span>
          </div>
        ) : null}
      </Section>

      {/* ── Recognition Scores (Vizual Edge etc.) ── */}
      {hasRecData && (
        <Section>
          <SectionHeader icon="👁️" iconColor="teal" title="Recognition Scores" subtitle="Pitch identification accuracy" />
          <KpiGrid>
            {TAB_METRICS.pitchRec.map(key => {
              const m = recMetrics[key];
              if (!m) return null;
              const level = getBadgeLevel(key, m.value);
              return (
                <KpiCard
                  key={key}
                  label={METRIC_LABELS[key] || key}
                  value={key === 'ab_iq' ? m.value.toFixed(0) : `${m.value.toFixed(1)}%`}
                  unit={key === 'ab_iq' ? 'grade' : undefined}
                  badge={getBadgeText(level) || undefined}
                  badgeLevel={level}
                />
              );
            })}
          </KpiGrid>

          {/* Score Bars */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {recMetrics.pitch_rec_fb && (
              <ScoreBar
                label="Fastball Recognition"
                value={`${recMetrics.pitch_rec_fb.value.toFixed(1)}%`}
                percent={recMetrics.pitch_rec_fb.value}
                level={getBadgeLevel('pitch_rec_fb', recMetrics.pitch_rec_fb.value) as any}
              />
            )}
            {recMetrics.pitch_rec_os && (
              <ScoreBar
                label="Off-Speed Recognition"
                value={`${recMetrics.pitch_rec_os.value.toFixed(1)}%`}
                percent={recMetrics.pitch_rec_os.value}
                level={getBadgeLevel('pitch_rec_os', recMetrics.pitch_rec_os.value) as any}
              />
            )}
            {recMetrics.pitch_rec_overall && (
              <ScoreBar
                label="Overall Recognition"
                value={`${recMetrics.pitch_rec_overall.value.toFixed(1)}%`}
                percent={recMetrics.pitch_rec_overall.value}
                level={getBadgeLevel('pitch_rec_overall', recMetrics.pitch_rec_overall.value) as any}
              />
            )}
          </div>
        </Section>
      )}

      {/* ── Coaching Notes ── */}
      {(() => {
        const notesArr = selectedReport?.notes
          ? [{ text: selectedReport.notes }]
          : [
              { text: 'At-bat tendencies, pitch recognition observations, and approach notes.', placeholder: true },
              { text: 'Recommended drills and focus areas.', placeholder: true },
            ];
        return (
          <Section>
            <SectionHeader icon="📋" iconColor="gold" title="Coaching Notes" />
            <NotesBox label="AT-BAT ASSESSMENT" notes={notesArr} />
          </Section>
        );
      })()}

      {/* ── Video ── */}
      {(() => {
        const videoIds = getReportVideoIds(selectedReport);
        const reportVideos = playerVideos.filter(v =>
          videoIds.includes(v.id) || v.category === 'AT_BAT_RESULTS' || v.category === 'COGNITION'
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
                    key={v.id} tag={v.category} title={v.title}
                    subtitle={new Date(v.createdAt).toLocaleDateString()} size="md"
                    videoUrl={v.originalUrl}
                  />
                ))}
                {reportVideos.length === 0 && contentVideos.map((v, i) => (
                  <VideoPlaceholder
                    key={`content-${i}`} tag="AT-BAT"
                    title={v.name.replace(/\.[^.]+$/, '')}
                    subtitle={`${(v.size / 1024 / 1024).toFixed(1)} MB`} size="md"
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

    </>
  );
}
