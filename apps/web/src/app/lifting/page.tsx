'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Lifting -- the strength coach's view of the whole group.

   Pick a bubble (CMJ, SJ, Grip...) and every athlete with a result for it
   is listed with each box's latest value and the change since their
   previous result (green better / red worse). Sort by any column; filter
   by program (defaults to the Lifting Program when there is one). A name
   opens that athlete's Physical tab.

   The bubbles and boxes are the same editable layout the athlete Lifting
   Dashboard uses (Settings -> Lifting Dashboard).
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { useFacilityPrograms } from '@/lib/use-facility-programs';
import { activeScheduledPrograms } from '@/lib/facility-schedule';
import { byTest, changeColor, fmt, fmtChange, fmtDate, kpiView, type KpiView } from '@/lib/lifting';
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import aStyles from '@/components/assessment/assessment.module.css';
import { EduHeader } from '../education/EduHeader';
import s from '@/components/lifting/lifting.module.css';

const ALL = '__all__';
const LIFTING_PROGRAM = 'LIFTING_PROGRAM';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function IconLifting() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 8v8M3.5 10v4M18 8v8M20.5 10v4M6 12h12" />
    </svg>
  );
}

export default function LiftingPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const programs = useFacilityPrograms();
  const [cfg, setCfg] = useState<api.LiftingConfigResponse | null>(null);
  const [team, setTeam] = useState<api.LiftingTeamRow[] | null>(null);
  const [players, setPlayers] = useState<api.Player[]>([]);
  const [error, setError] = useState('');
  const [bubbleId, setBubbleId] = useState<string | null>(null);
  const [program, setProgram] = useState<string | null>(null);
  /* Sort: 'name' | 'date' | kpi id; desc for numbers by default. */
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: 'name', desc: false });

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  useEffect(() => {
    if (isLoading || !user || !isCoach) return;
    Promise.all([api.getLiftingConfig(), api.getLiftingTeam(), api.getPlayers()])
      .then(([c, t, p]) => { setCfg(c); setTeam(t); setPlayers(p); })
      .catch((e) => setError(e?.message || 'Could not load the Lifting results'));
  }, [isLoading, user, isCoach]);

  /* Default program filter: the Lifting Program when it exists. */
  useEffect(() => {
    if (program != null || !programs.length) return;
    setProgram(programs.some((p) => p.key === LIFTING_PROGRAM) ? LIFTING_PROGRAM : ALL);
  }, [programs, program]);

  const bubble = useMemo(() => {
    const list = cfg?.config.bubbles ?? [];
    return list.find((b) => b.id === bubbleId) ?? list[0] ?? null;
  }, [cfg, bubbleId]);

  /* Each athlete's results, grouped by test. */
  const perPlayer = useMemo(() => {
    const m = new Map<string, api.LiftingTeamRow[]>();
    for (const r of team ?? []) {
      const list = m.get(r.playerId) ?? [];
      list.push(r);
      m.set(r.playerId, list);
    }
    return m;
  }, [team]);

  const rows = useMemo(() => {
    if (!bubble) return [];
    const today = todayIso();
    const out: { player: api.Player; date: string | null; kpis: KpiView[] }[] = [];
    for (const p of players) {
      if (program && program !== ALL && !activeScheduledPrograms(p.facilitySchedule, today).has(program)) continue;
      const tests = byTest(perPlayer.get(p.id) ?? []);
      const kpis = bubble.kpis.map((k) => kpiView(k, bubble.test, tests));
      if (!kpis.some((k) => k.latest != null)) continue;
      out.push({ player: p, date: tests.get(bubble.test)?.[0]?.recordedAt ?? null, kpis });
    }
    const dir = sort.desc ? -1 : 1;
    out.sort((a, b) => {
      if (sort.key === 'name') return dir * `${a.player.lastName} ${a.player.firstName}`.localeCompare(`${b.player.lastName} ${b.player.firstName}`);
      if (sort.key === 'date') return dir * (a.date ?? '').localeCompare(b.date ?? '');
      const va = a.kpis.find((k) => k.kpi.id === sort.key)?.latest;
      const vb = b.kpis.find((k) => k.kpi.id === sort.key)?.latest;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return dir * (va - vb);
    });
    return out;
  }, [bubble, players, perPlayer, program, sort]);

  const sortBy = (key: string) =>
    setSort((cur) => (cur.key === key ? { key, desc: !cur.desc } : { key, desc: key !== 'name' }));
  const arrow = (key: string) => (sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : '');

  if (isLoading || !user || !isCoach) return null;

  return (
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      <EduHeader
        tone="light"
        chipInline
        icon={<IconLifting />}
        eyebrow="Lifting"
        title="Lifting"
        accent="Dashboard"
        subtitle="Every athlete's latest VALD and lifting results, by test."
        actions={cfg?.canEdit ? (
          <Link href="/settings?tab=lifting" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>Edit layout →</Link>
        ) : undefined}
      />

      <div className={aStyles.profilePanel} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && <div className={s.empty} style={{ color: '#dc2626' }}>{error}</div>}
        {!error && (!cfg || !team) && <div className={s.empty}>Loading…</div>}
        {cfg && team && (
          <>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div className={s.chips} role="tablist" aria-label="Test">
                {cfg.config.bubbles.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="tab"
                    aria-selected={bubble?.id === b.id}
                    className={bubble?.id === b.id ? `${s.chip} ${s.chipOn}` : s.chip}
                    onClick={() => setBubbleId(b.id)}
                  >
                    {b.title}
                  </button>
                ))}
              </div>
              <select
                aria-label="Program"
                className={s.input}
                value={program ?? ALL}
                onChange={(e) => setProgram(e.target.value)}
                style={{ maxWidth: 220 }}
              >
                <option value={ALL}>All athletes</option>
                {programs.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>

            {bubble && rows.length === 0 && (
              <div className={s.empty}>
                No {bubble.title} results{program && program !== ALL ? ' for this program' : ''} yet.
                {program && program !== ALL && (
                  <> <button type="button" className={s.linkBtn} onClick={() => setProgram(ALL)}>Show all athletes</button></>
                )}
              </div>
            )}

            {bubble && rows.length > 0 && (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th onClick={() => sortBy('name')} aria-sort={sort.key === 'name' ? (sort.desc ? 'descending' : 'ascending') : 'none'}>Athlete{arrow('name')}</th>
                      <th onClick={() => sortBy('date')}>Tested{arrow('date')}</th>
                      {bubble.kpis.map((k) => (
                        <th key={k.id} onClick={() => sortBy(k.id)}>{k.label}{k.unit ? ` (${k.unit})` : ''}{arrow(k.id)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.player.id}>
                        <td>
                          <Link href={`/athletes/${r.player.id}?tab=strength`} style={{ fontWeight: 700, color: 'var(--text-bright)' }}>
                            {r.player.lastName}, {r.player.firstName}
                          </Link>
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{fmtDate(r.date)}</td>
                        {r.kpis.map((k) => (
                          <td key={k.kpi.id}>
                            <span style={{ fontWeight: 700 }}>{fmt(k.latest, k.kpi.digits)}</span>
                            {k.change != null && k.change !== 0 && (
                              <span style={{ marginLeft: 6, fontSize: '0.75rem', color: changeColor(k.improved) }}>{fmtChange(k.change, k.kpi.digits)}</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
