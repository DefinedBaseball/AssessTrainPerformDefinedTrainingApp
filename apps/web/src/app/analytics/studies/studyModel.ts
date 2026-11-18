/* ─────────────────────────────────────────────────────────────────────────
   Studies: the study types, a study's settings, which athletes are in it
   and how they're grouped. Pure (no React).
   ───────────────────────────────────────────────────────────────────────── */
import type { StudyAthlete, StudyMeasure } from '@/lib/api';
import type { DateRange, Summary } from './studyMath';

export type StudyType = 'relationship' | 'drivers' | 'change' | 'beforeAfter' | 'groups' | 'profile' | 'trend';

export const STUDY_TYPES: { type: StudyType; title: string; question: string; chart: string }[] = [
  { type: 'relationship', title: 'Relationship', question: 'Does one number go with another? e.g. do athletes who jump higher hit the ball harder?', chart: 'Scatter + trend line' },
  { type: 'drivers', title: 'What goes with it?', question: 'Which numbers go with a result? e.g. which VALD results go with fastball velo?', chart: 'Ranked correlation bars' },
  { type: 'beforeAfter', title: 'Before / After', question: 'How did athletes change between two periods? e.g. what did the fall program do to 10-yard times?', chart: 'Slope chart' },
  { type: 'change', title: 'Change vs Change', question: 'Did gains go together? e.g. did athletes who gained jump height also gain exit velo?', chart: 'Scatter of changes' },
  { type: 'groups', title: 'Compare Groups', question: 'How do groups differ? e.g. Program vs Lesson athletes, 2027 vs 2028, pitchers vs hitters.', chart: 'Dots per group + averages' },
  { type: 'profile', title: 'Athlete vs Group', question: 'Where does one athlete stand in a group, measure by measure?', chart: 'Percentile bars' },
  { type: 'trend', title: 'Group Over Time', question: 'How is a group moving month to month? e.g. the 2028 class’s jump height.', chart: 'Monthly average + spread' },
];
export const TYPE_TITLE: Record<string, string> = Object.fromEntries(STUDY_TYPES.map((t) => [t.type, t.title]));

export interface Sel { id: string; summary: Summary }
/** Which athletes. Each row: any of the chosen; across rows: all. VALD groups /
 *  tags are matched to app athletes on the server (valdSets: id -> athlete ids). */
export interface Cohort { gradYears: number[]; positions: string[]; types: string[]; playerIds: string[]; valdGroups?: string[]; valdTags?: string[] }
export type ValdSets = Map<string, Set<string>>;
export type GroupBy = 'none' | 'gradYear' | 'position' | 'pitcher' | 'type' | 'custom';

export interface StudyConfig {
  x?: Sel;
  y?: Sel;
  target?: Sel;
  candidates?: string[];
  candSummary?: Summary;
  measure?: Sel;
  measures?: string[];
  cohort: Cohort;
  range: DateRange;
  a: DateRange;
  b: DateRange;
  groupBy?: GroupBy;
  groupA?: string[];
  groupB?: string[];
  athleteId?: string;
  /** Profile: compare with the athlete's grad year only. */
  sameClass?: boolean;
}

export interface Draft {
  id?: string;
  title: string;
  type: StudyType;
  conclusion: string;
  pinned: boolean;
  config: StudyConfig;
}

export const emptyCohort = (): Cohort => ({ gradYears: [], positions: [], types: [], playerIds: [], valdGroups: [], valdTags: [] });

export function newDraft(type: StudyType): Draft {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ago = (days: number) => iso(new Date(today.getTime() - days * 86_400_000));
  return {
    title: '',
    type,
    conclusion: '',
    pinned: false,
    config: {
      cohort: emptyCohort(),
      range: {},
      a: { from: ago(365), to: ago(183) },
      b: { from: ago(182), to: iso(today) },
      groupBy: type === 'groups' ? 'gradYear' : 'none',
      candidates: [],
      candSummary: 'best',
      measures: [],
      sameClass: true,
    },
  };
}

/** Every measure id a study needs data for. */
export function neededIds(d: Draft): string[] {
  const c = d.config;
  const ids: (string | undefined)[] = [];
  switch (d.type) {
    case 'relationship':
    case 'change':
      ids.push(c.x?.id, c.y?.id); break;
    case 'drivers':
      ids.push(c.target?.id, ...(c.candidates ?? [])); break;
    case 'beforeAfter':
    case 'groups':
    case 'trend':
      ids.push(c.measure?.id); break;
    case 'profile':
      ids.push(...(c.measures ?? [])); break;
  }
  return [...new Set(ids.filter((x): x is string => !!x))];
}

const PITCHER = /^(P|RHP|LHP|SP|RP)$/i;

/** "WINTER_PROGRAM" / "Winter_program" -> "Winter program". */
export const typeLabel = (t: string) => { const w = t.replace(/_/g, ' ').trim(); return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); };

/** Athletes the cohort filters let in (each filter: any of the chosen; empty = everyone). */
export function cohortMembers(athletes: StudyAthlete[], c: Cohort, vald?: ValdSets | null): Set<number> {
  const out = new Set<number>();
  const inAny = (ids: string[] | undefined, athleteId: string) => !ids?.length || !vald || ids.some((id) => vald.get(id)?.has(athleteId));
  athletes.forEach((a, i) => {
    if (!inAny(c.valdGroups, a.id) || !inAny(c.valdTags, a.id)) return;
    if (c.playerIds.length && !c.playerIds.includes(a.id)) return;
    if (c.gradYears.length && (a.gradYear == null || !c.gradYears.includes(a.gradYear))) return;
    if (c.positions.length && !a.positions.some((p) => c.positions.includes(p))) return;
    if (c.types.length && !a.athleteTypes.some((t) => c.types.includes(t))) return;
    out.add(i);
  });
  return out;
}

/** Split the cohort into named groups. An athlete with two athlete types counts in both. */
export function groupAthletes(athletes: StudyAthlete[], members: Set<number>, by: GroupBy, groupA: string[] = [], groupB: string[] = []): { name: string; members: Set<number> }[] {
  const groups = new Map<string, Set<number>>();
  const put = (name: string, i: number) => (groups.get(name) ?? groups.set(name, new Set()).get(name)!).add(i);
  for (const i of members) {
    const a = athletes[i];
    switch (by) {
      case 'none': put('Selected athletes', i); break;
      case 'gradYear': put(a.gradYear ? `Class of ${a.gradYear}` : 'No grad year', i); break;
      case 'position': put(a.positions[0] || 'No position', i); break;
      case 'pitcher': put(a.positions.some((p) => PITCHER.test(p)) ? 'Pitchers' : 'Position players', i); break;
      case 'type':
        if (!a.athleteTypes.length) put('No type', i);
        for (const t of a.athleteTypes) put(typeLabel(t), i);
        break;
      case 'custom':
        if (groupA.includes(a.id)) put('Group A', i);
        if (groupB.includes(a.id)) put('Group B', i);
        break;
    }
  }
  const list = [...groups.entries()].map(([name, m]) => ({ name, members: m }));
  if (by === 'gradYear') list.sort((x, y) => x.name.localeCompare(y.name));
  else if (by === 'custom') list.sort((x, y) => x.name.localeCompare(y.name));
  else list.sort((x, y) => y.members.size - x.members.size);
  return list;
}

export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  none: 'No groups',
  gradYear: 'Grad year',
  position: 'Primary position',
  pitcher: 'Pitchers vs position players',
  type: 'Athlete type (Program / Lesson …)',
  custom: 'Pick two groups',
};

/** Ready-made studies, offered when their measures have data. */
export function starterStudies(measures: StudyMeasure[]): Draft[] {
  const has = new Set(measures.map((m) => m.id));
  const pick = (...ids: string[]) => ids.find((id) => has.has(id));
  const out: Draft[] = [];
  const jump = pick('lift:CMJ:JUMP_HEIGHT_INCHES_IMP_MOM', 'lift:CMJ:JUMP_HEIGHT_IMP_MOM', 'report:jump_height');
  const power = pick('lift:CMJ:BODYMASS_RELATIVE_TAKEOFF_POWER', 'lift:CMJ:PEAK_TAKEOFF_POWER');
  const ev = pick('report:max_exit_velo');
  const velo = pick('report:fb_max_velo');
  if (jump && ev) {
    const d = newDraft('relationship');
    d.title = 'CMJ jump height vs max exit velo';
    d.config.x = { id: jump, summary: 'best' };
    d.config.y = { id: ev, summary: 'best' };
    out.push(d);
  }
  if (power && velo) {
    const d = newDraft('relationship');
    d.title = 'CMJ power vs fastball velo';
    d.config.x = { id: power, summary: 'best' };
    d.config.y = { id: velo, summary: 'best' };
    out.push(d);
  }
  if (velo) {
    const cands = [
      jump, power, pick('lift:CMJ:PEAK_TAKEOFF_POWER'), pick('lift:SJ:JUMP_HEIGHT_INCHES_IMP_MOM'), pick('lift:PPU:CONCENTRIC_IMPULSE'),
      pick('lift:GRIP:PEAK_FORCE_RIGHT'), pick('lift:GRIP:PEAK_FORCE_LEFT'), pick('lift:IR_STANDING:PEAK_FORCE_RIGHT'), pick('lift:ER_STANDING:PEAK_FORCE_RIGHT'),
      pick('lift:SS_10YD_SPRINT:TOTAL_TIME'), pick('weight'),
    ].filter((x): x is string => !!x);
    if (cands.length >= 2) {
      const d = newDraft('drivers');
      d.title = 'What goes with fastball velo?';
      d.config.target = { id: velo, summary: 'best' };
      d.config.candidates = [...new Set(cands)];
      out.push(d);
    }
  }
  if (ev && has.has('stat:hitting:AVG')) {
    const d = newDraft('relationship');
    d.title = 'Max exit velo vs batting average';
    d.config.x = { id: ev, summary: 'best' };
    d.config.y = { id: 'stat:hitting:AVG', summary: 'latest' };
    out.push(d);
  }
  if (ev && has.has('weight')) {
    const d = newDraft('relationship');
    d.title = 'Body weight vs max exit velo';
    d.config.x = { id: 'weight', summary: 'latest' };
    d.config.y = { id: ev, summary: 'best' };
    out.push(d);
  }
  if (jump) {
    const d = newDraft('trend');
    d.title = 'Jump height by class, month to month';
    d.config.measure = { id: jump, summary: 'best' };
    d.config.groupBy = 'gradYear';
    out.push(d);
  }
  return out;
}
