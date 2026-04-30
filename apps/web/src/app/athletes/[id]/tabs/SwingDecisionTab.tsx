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

/* Decision metrics, grouped by pitch class */
const DECISION_GROUPS: { title: string; subtitle: string; rows: { key: string; flip?: boolean }[] }[] = [
  {
    title: 'Barrel Rate',
    subtitle: 'Hard, ideal-launch contact',
    rows: [
      { key: 'fb_barrel_pct' },
      { key: 'os_barrel_pct' },
      { key: 'overall_barrel_pct' },
    ],
  },
  {
    title: 'Whiff Rate',
    subtitle: 'Swings & misses · lower is better',
    rows: [
      { key: 'fb_whiff_pct',     flip: true },
      { key: 'os_whiff_pct',     flip: true },
      { key: 'overall_whiff_pct', flip: true },
    ],
  },
  {
    title: 'Chase Rate',
    subtitle: 'Out-of-zone swings · lower is better',
    rows: [
      { key: 'fb_chase_pct',     flip: true },
      { key: 'os_chase_pct',     flip: true },
      { key: 'overall_chase_pct', flip: true },
    ],
  },
];

const APPROACH_KEYS = [
  'overall_bb_pct',
  'overall_k_pct',
  'fb_in_zone_swing_pct',
  'os_in_zone_swing_pct',
  'overall_in_zone_swing_pct',
];

export function SwingDecisionTab({
  player, topMetrics, reports, isCoach,
}: TabProps) {
  const latestHitting = useMemo(() => getLatestReport(reports, HITTING_REPORT_TYPES), [reports]);

  // Composite Swing Decision grade — average of every populated decision metric grade
  const allDecisionKeys = useMemo(() => [
    ...DECISION_GROUPS.flatMap(g => g.rows.map(r => r.key)),
    ...APPROACH_KEYS,
  ], []);

  const compositeDecision = useMemo(() => {
    return averageGrades(allDecisionKeys.map(k => metricToGrade(topMetrics, k)));
  }, [topMetrics, allDecisionKeys]);

  const groupAvg = useMemo(() => {
    return DECISION_GROUPS.map(g => ({
      title: g.title,
      grade: averageGrades(g.rows.map(r => metricToGrade(topMetrics, r.key))),
    }));
  }, [topMetrics]);

  const hasAny = allDecisionKeys.some(k => topMetrics[k] !== undefined);

  return (
    <>
      {/* ── BIG 3 → SWING DECISION composite ── */}
      <Section>
        <SectionHeader
          icon="🎯"
          iconColor="teal"
          title="Swing Decision Grade"
          subtitle="Plate-discipline composite · barrel / whiff / chase rates plus walk · K · zone-swing"
        />
        <CompositeHero
          label="SWING DECISION"
          grade={compositeDecision}
          parts={[
            ...groupAvg,
            { title: 'Approach (BB / K / Zone)', grade: averageGrades(APPROACH_KEYS.map(k => metricToGrade(topMetrics, k))) },
          ].map(g => ({ label: g.title, grade: g.grade }))}
        />
      </Section>

      {!hasAny ? (
        <Section>
          <EmptyState
            text="No At-Bat Assessment data on file yet."
            hint={isCoach
              ? 'Upload a coach-tracked AB log (HitTrax, manual entry, or AB report) to populate barrel/whiff/chase rates.'
              : 'Decision metrics will appear once your coach uploads at-bat data.'}
          />
        </Section>
      ) : (
        <>
          {/* ── PER-PITCH BREAKDOWN: Barrel · Whiff · Chase ── */}
          {DECISION_GROUPS.map(group => (
            <Section key={group.title}>
              <SectionHeader
                icon={group.title === 'Barrel Rate' ? '💥' : group.title === 'Whiff Rate' ? '💨' : '🚷'}
                iconColor={group.title === 'Barrel Rate' ? 'gold' : group.title === 'Whiff Rate' ? 'teal' : 'green'}
                title={group.title}
                subtitle={group.subtitle}
              />
              <KpiGrid>
                {group.rows.map(({ key }) => {
                  const m = topMetrics[key];
                  const label = METRIC_LABELS[key] || key;
                  if (!m) return <KpiCard key={key} label={label} value="—" badge="No data" />;
                  const level = getBadgeLevel(key, m.value);
                  const grade = metricToGrade(topMetrics, key);
                  return (
                    <KpiCard
                      key={key}
                      label={label}
                      value={`${m.value.toFixed(1)}%`}
                      badge={grade !== null ? `Grade ${grade}` : (getBadgeText(level) || undefined)}
                      badgeLevel={level}
                    />
                  );
                })}
              </KpiGrid>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 18 }}>
                {group.rows.map(({ key }) => {
                  const m = topMetrics[key];
                  if (!m) return null;
                  const grade = metricToGrade(topMetrics, key);
                  if (grade === null) return null;
                  const level = getBadgeLevel(key, m.value);
                  return (
                    <ScoreBar
                      key={key}
                      label={METRIC_LABELS[key] || key}
                      value={`${m.value.toFixed(1)}%`}
                      percent={((grade - 20) / 60) * 100}
                      level={level as any}
                    />
                  );
                })}
              </div>
            </Section>
          ))}

          {/* ── APPROACH: Walk / Strikeout / In-Zone Swing rates ── */}
          <Section>
            <SectionHeader
              icon="📈"
              iconColor="green"
              title="Approach"
              subtitle="Walk · Strikeout · In-Zone Swing rates"
            />
            <KpiGrid>
              {APPROACH_KEYS.map(key => {
                const m = topMetrics[key];
                const label = METRIC_LABELS[key] || key;
                if (!m) return <KpiCard key={key} label={label} value="—" badge="No data" />;
                const level = getBadgeLevel(key, m.value);
                const grade = metricToGrade(topMetrics, key);
                return (
                  <KpiCard
                    key={key}
                    label={label}
                    value={`${m.value.toFixed(1)}%`}
                    badge={grade !== null ? `Grade ${grade}` : (getBadgeText(level) || undefined)}
                    badgeLevel={level}
                  />
                );
              })}
            </KpiGrid>
          </Section>
        </>
      )}

      {latestHitting?.notes && (
        <Section>
          <SectionHeader icon="📋" iconColor="green" title="Coaching Notes" />
          <NotesBox label="HITTING REPORT" notes={[{ text: latestHitting.notes }]} />
        </Section>
      )}
    </>
  );
}

/* ─── Shared composite hero (mirrors SwingTab.CompositeHero) ─── */
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
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.30em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
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
            <span style={{ minWidth: 200 }}>{p.label}</span>
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
