'use client';

import { useMemo } from 'react';
import {
  KpiCard, KpiGrid, SectionHeader, Section, ScoreBar, NotesBox,
} from '@/components/assessment';
import {
  TabProps, METRIC_LABELS,
  getBadgeLevel, getBadgeText,
  averageGrades, metricToGrade, scoreColor,
  getLatestReport,
} from '../helpers';

const HITTING_REPORT_TYPES = ['HITTING'];

/* The seven outcome metrics that grade Quality of Contact */
const QOC_KEYS = [
  'avg_exit_velo',
  'squared_up_pct',
  'smash_factor',
  'overall_whiff_pct',
  'overall_barrel_pct',
  'launch_angle',
  'distance',
] as const;

/* Group metrics into "Damage" vs "Discipline" sub-bars in the hero */
const DAMAGE_KEYS  = ['avg_exit_velo', 'squared_up_pct', 'smash_factor', 'overall_barrel_pct'];
const SHAPE_KEYS   = ['launch_angle', 'distance'];
const CONTACT_KEYS = ['overall_whiff_pct'];

function fmtMetric(key: string, value: number): string {
  switch (key) {
    case 'avg_exit_velo':       return `${value.toFixed(1)} mph`;
    case 'squared_up_pct':
    case 'overall_whiff_pct':
    case 'overall_barrel_pct':  return `${value.toFixed(1)}%`;
    case 'smash_factor':        return value.toFixed(2);
    case 'launch_angle':        return `${value.toFixed(1)}°`;
    case 'distance':            return `${value.toFixed(0)} ft`;
    default:                    return value.toFixed(1);
  }
}

export function QualityOfContactTab({
  player, topMetrics, reports, isCoach,
}: TabProps) {
  const latestHitting = useMemo(() => getLatestReport(reports, HITTING_REPORT_TYPES), [reports]);

  const allGrades = useMemo(() =>
    QOC_KEYS.map(k => metricToGrade(topMetrics, k)), [topMetrics]);

  const compositeQoC = useMemo(() => averageGrades(allGrades), [allGrades]);
  const damageGrade   = useMemo(() => averageGrades(DAMAGE_KEYS.map(k => metricToGrade(topMetrics, k))), [topMetrics]);
  const shapeGrade    = useMemo(() => averageGrades(SHAPE_KEYS.map(k => metricToGrade(topMetrics, k))), [topMetrics]);
  const contactGrade  = useMemo(() => averageGrades(CONTACT_KEYS.map(k => metricToGrade(topMetrics, k))), [topMetrics]);

  const hasAny = QOC_KEYS.some(k => topMetrics[k] !== undefined);

  return (
    <>
      {/* ── BIG 3 → QUALITY OF CONTACT composite ── */}
      <Section>
        <SectionHeader
          icon="💥"
          iconColor="gold"
          title="Quality of Contact Grade"
          subtitle="Outcome composite · how well the bat hits the ball when it does"
        />
        <CompositeHero
          label="QUALITY OF CONTACT"
          grade={compositeQoC}
          parts={[
            { label: 'Damage  (EV · Squared-Up · Smash · Barrel)', grade: damageGrade },
            { label: 'Ball Shape  (Launch Angle · Distance)',       grade: shapeGrade },
            { label: 'Contact  (Whiff Rate)',                       grade: contactGrade },
          ]}
        />
      </Section>

      {/* Outcome metrics live on the Swing sub-tab as the "Full Swing" section. */}

      {/* ── BATTED-BALL SCATTER (lightweight EV × LA plot) ── */}
      <Section>
        <SectionHeader
          icon="🎯"
          iconColor="green"
          title="Damage Window"
          subtitle="Exit Velo × Launch Angle — barrel zone shaded"
        />
        <DamageWindow
          ev={topMetrics['avg_exit_velo']?.value ?? null}
          la={topMetrics['launch_angle']?.value ?? null}
          maxEv={topMetrics['max_exit_velo']?.value ?? null}
          smash={topMetrics['smash_factor']?.value ?? null}
        />
      </Section>

      {latestHitting?.notes && (
        <Section>
          <SectionHeader icon="📋" iconColor="green" title="Coaching Notes" />
          <NotesBox label="HITTING REPORT" notes={[{ text: latestHitting.notes }]} />
        </Section>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Damage Window — minimalist EV × LA plot with the barrel sweet-spot shaded.
   Uses the player's avg + max EV at the displayed launch angle.
   ─────────────────────────────────────────────────────────────────────────── */
function DamageWindow({
  ev, la, maxEv, smash,
}: { ev: number | null; la: number | null; maxEv: number | null; smash: number | null }) {
  // Plot bounds: EV 60-115, LA -10 to 45
  const W = 520, H = 280;
  const padL = 56, padR = 18, padT = 16, padB = 36;
  const evMin = 60, evMax = 115;
  const laMin = -10, laMax = 45;
  const x = (e: number) => padL + ((e - evMin) / (evMax - evMin)) * (W - padL - padR);
  const y = (l: number) => padT + (1 - (l - laMin) / (laMax - laMin)) * (H - padT - padB);

  // Barrel zone (rough Statcast sweet-spot: EV 98+, LA 8-32)
  const barrelLeft = x(98), barrelTop = y(32), barrelRight = x(115), barrelBot = y(8);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 14,
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* grid */}
        {[60, 70, 80, 90, 100, 110].map(e => (
          <g key={`vx-${e}`}>
            <line x1={x(e)} y1={padT} x2={x(e)} y2={H - padB}
              stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x={x(e)} y={H - padB + 16} textAnchor="middle"
              fontSize="10" fill="rgba(255,255,255,0.45)"
              fontFamily="'DM Mono', ui-monospace, monospace" letterSpacing="0.06em">{e}</text>
          </g>
        ))}
        {[-10, 0, 10, 20, 30, 40].map(l => (
          <g key={`vy-${l}`}>
            <line x1={padL} y1={y(l)} x2={W - padR} y2={y(l)}
              stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x={padL - 10} y={y(l) + 4} textAnchor="end"
              fontSize="10" fill="rgba(255,255,255,0.45)"
              fontFamily="'DM Mono', ui-monospace, monospace" letterSpacing="0.06em">{l}°</text>
          </g>
        ))}

        {/* Barrel sweet-spot */}
        <rect
          x={barrelLeft}
          y={barrelTop}
          width={barrelRight - barrelLeft}
          height={barrelBot - barrelTop}
          fill="rgba(74,222,128,0.10)"
          stroke="rgba(74,222,128,0.45)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        <text x={(barrelLeft + barrelRight) / 2} y={barrelTop - 6}
          textAnchor="middle" fontSize="10" fontWeight="700"
          letterSpacing="0.18em" fill="rgba(74,222,128,0.85)"
          fontFamily="'DM Mono', ui-monospace, monospace">
          BARREL ZONE
        </text>

        {/* axis labels */}
        <text x={W / 2} y={H - 6} textAnchor="middle"
          fontSize="10" fill="rgba(255,255,255,0.55)"
          fontFamily="'DM Mono', ui-monospace, monospace" letterSpacing="0.18em" fontWeight="700">
          EXIT VELO (mph)
        </text>
        <text x={14} y={H / 2} textAnchor="middle"
          fontSize="10" fill="rgba(255,255,255,0.55)"
          fontFamily="'DM Mono', ui-monospace, monospace" letterSpacing="0.18em" fontWeight="700"
          transform={`rotate(-90 14 ${H / 2})`}>
          LAUNCH ANGLE
        </text>

        {/* Plot dots */}
        {ev !== null && la !== null && (() => {
          const ax = x(ev);
          const ay = y(la);
          return (
            <g>
              <circle cx={ax} cy={ay} r="14" fill="rgba(126,182,255,0.20)" />
              <circle cx={ax} cy={ay} r="6.5"
                fill="#7eb6ff" stroke="#fff" strokeWidth="1.4" />
              <text x={ax + 12} y={ay - 8}
                fontSize="10.5" fill="#cfe0ff" fontWeight="700"
                fontFamily="'DM Mono', ui-monospace, monospace">
                AVG · {ev.toFixed(1)}mph @ {la.toFixed(1)}°
              </text>
            </g>
          );
        })()}
        {maxEv !== null && la !== null && (() => {
          const ax = x(maxEv);
          const ay = y(la);
          return (
            <g>
              <circle cx={ax} cy={ay} r="11" fill="rgba(255,217,61,0.18)" />
              <circle cx={ax} cy={ay} r="5"
                fill="#ffd93d" stroke="rgba(0,0,0,0.4)" strokeWidth="1" />
              <text x={ax + 10} y={ay + 14}
                fontSize="10" fill="#ffd93d" fontWeight="700"
                fontFamily="'DM Mono', ui-monospace, monospace">
                MAX · {maxEv.toFixed(1)}mph
              </text>
            </g>
          );
        })()}

        {ev === null && la === null && (
          <text x={W / 2} y={H / 2} textAnchor="middle"
            fontSize="13" fill="rgba(255,255,255,0.45)"
            fontFamily="'DM Mono', ui-monospace, monospace" letterSpacing="0.10em">
            No batted-ball data on file
          </text>
        )}
      </svg>

      {smash !== null && (
        <div style={{
          marginTop: 8, fontSize: 11, color: 'var(--text-muted)',
          textAlign: 'right', letterSpacing: '0.10em',
        }}>
          AVG SMASH FACTOR <span style={{
            fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--text)',
          }}>{smash.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}

/* ─── Composite hero ─── */
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
      display: 'grid', gridTemplateColumns: 'minmax(180px, 240px) 1fr', gap: 24,
      padding: '22px 26px',
      background: 'linear-gradient(135deg, rgba(126,182,255,0.06), rgba(61,139,253,0.02))',
      border: '1px solid rgba(126,182,255,0.25)',
      borderRadius: 14, alignItems: 'center',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.30em', textTransform: 'uppercase', color: 'var(--text-bright)' }}>
          {label}
        </span>
        <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color: tone, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em' }}>
          {grade ?? '—'}
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.16em' }}>/80 · 20-80 SCALE</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ position: 'relative', height: 14, borderRadius: 9, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, width: `${pct}%`, background: `linear-gradient(90deg, ${tone}55, ${tone})`, transition: 'width 0.35s ease' }} />
        </div>
        {parts.map(p => (
          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span style={{ minWidth: 260 }}>{p.label}</span>
            <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ width: `${p.grade !== null ? ((p.grade - 20) / 60) * 100 : 0}%`, height: '100%', background: p.grade !== null ? scoreColor(p.grade) : 'transparent' }} />
            </div>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: p.grade !== null ? 'var(--text)' : 'var(--text-muted)', minWidth: 28, textAlign: 'right' }}>
              {p.grade ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text, hint }: { text: string; hint: string }) {
  return (
    <div style={{
      padding: '28px 22px', border: '1px dashed var(--border)', borderRadius: 12,
      color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', lineHeight: 1.6,
    }}>
      {text}
      <div style={{ marginTop: 6, fontSize: 11.5, opacity: 0.85 }}>{hint}</div>
    </div>
  );
}
