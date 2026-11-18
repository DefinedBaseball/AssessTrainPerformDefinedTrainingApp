/* ─────────────────────────────────────────────────────────────────────────
   Studies (Data -> Studies): the measures a study can use, and how a
   measure id names its data. Pure -- unit-tested.

     report:<key>               an assessment result: one value per saved
                                report (the Player Summary trend points --
                                Metric rows with source REPORT_<id>)
     lift:<TEST>:<KEY>          a Lifting Report result (VALD or typed):
                                the session's best
     lift:<TEST>:<KEY>:avg      ... the session's average
     weight                     bodyweight (weight history: typed + VALD)
     checkin:feel|sleep|eat     check-in ratings (1-5)
     stat:<grid>:<key>          a Season Stats sheet value (e.g. stat:hitting:AVG);
                                the page computes these from each athlete's
                                sheet (the formulas live in web lib/season-stats)

   A study fetches each measure's raw points for every athlete; the page
   summarises them (latest / best / average ...) and does the statistics.
   ───────────────────────────────────────────────────────────────────────── */

export interface StudyMeasure {
  id: string;
  label: string;
  unit: string;
  /** Heading in the picker, e.g. "Hitting" or "VALD ForceDecks · CMJ". */
  group: string;
  better: 'high' | 'low' | null;
  digits: number;
}

/** Assessment results (report metric keys) with their names. */
export const REPORT_MEASURES: { key: string; label: string; unit: string; group: string; better: 'high' | 'low' | null; digits: number }[] = [
  { key: 'max_exit_velo', label: 'Max Exit Velo', unit: 'mph', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'avg_exit_velo', label: 'Avg Exit Velo', unit: 'mph', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'max_bat_speed', label: 'Max Bat Speed', unit: 'mph', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'avg_bat_speed', label: 'Avg Bat Speed', unit: 'mph', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'bat_speed', label: 'Bat Speed (Full Swing)', unit: 'mph', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'squared_up_pct', label: 'Squared Up %', unit: '%', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'smash_factor', label: 'Smash Factor', unit: '', group: 'Hitting', better: 'high', digits: 2 },
  { key: 'launch_angle', label: 'Launch Angle', unit: '°', group: 'Hitting', better: null, digits: 1 },
  { key: 'attack_angle', label: 'Attack Angle', unit: '°', group: 'Hitting', better: null, digits: 1 },
  { key: 'plane_angle', label: 'Plane Angle', unit: '°', group: 'Hitting', better: null, digits: 1 },
  { key: 'distance', label: 'Distance', unit: 'ft', group: 'Hitting', better: 'high', digits: 0 },
  { key: 'time_to_contact', label: 'Time to Contact', unit: 's', group: 'Hitting', better: 'low', digits: 3 },
  { key: 'rotational_accel_g', label: 'Rotational Acceleration', unit: 'g', group: 'Hitting', better: 'high', digits: 1 },
  { key: 'fb_max_velo', label: 'FB Max Velo', unit: 'mph', group: 'Pitching', better: 'high', digits: 1 },
  { key: 'fb_avg_velo', label: 'FB Avg Velo', unit: 'mph', group: 'Pitching', better: 'high', digits: 1 },
  { key: 'spin_rate', label: 'Spin Rate', unit: 'rpm', group: 'Pitching', better: null, digits: 0 },
  { key: 'h_break', label: 'Horizontal Break', unit: 'in', group: 'Pitching', better: null, digits: 1 },
  { key: 'v_break', label: 'Induced Vertical Break', unit: 'in', group: 'Pitching', better: null, digits: 1 },
  { key: 'release_height', label: 'Release Height', unit: 'ft', group: 'Pitching', better: null, digits: 2 },
  { key: 'extension', label: 'Extension', unit: 'ft', group: 'Pitching', better: 'high', digits: 2 },
  { key: 'infield_velo', label: 'Infield Velo', unit: 'mph', group: 'Defense & Speed', better: 'high', digits: 1 },
  { key: 'outfield_velo', label: 'Outfield Velo', unit: 'mph', group: 'Defense & Speed', better: 'high', digits: 1 },
  { key: 'catcher_velo', label: 'Catcher Velo', unit: 'mph', group: 'Defense & Speed', better: 'high', digits: 1 },
  { key: 'pop_time', label: 'Pop Time', unit: 's', group: 'Defense & Speed', better: 'low', digits: 2 },
  { key: 'exchange_time', label: 'Exchange Time', unit: 's', group: 'Defense & Speed', better: 'low', digits: 2 },
  { key: 'sprint_60', label: '60 Yard Sprint', unit: 's', group: 'Defense & Speed', better: 'low', digits: 2 },
  { key: 'sprint_10', label: '10 Yard Sprint', unit: 's', group: 'Defense & Speed', better: 'low', digits: 2 },
  { key: 'jump_height', label: 'Jump Height (report)', unit: 'in', group: 'Physical (reports)', better: 'high', digits: 1 },
  { key: 'broad_jump', label: 'Broad Jump', unit: 'in', group: 'Physical (reports)', better: 'high', digits: 1 },
  { key: 'squat_max', label: 'Squat Max', unit: 'lb', group: 'Physical (reports)', better: 'high', digits: 0 },
  { key: 'bench_max', label: 'Bench Max', unit: 'lb', group: 'Physical (reports)', better: 'high', digits: 0 },
  { key: 'deadlift_max', label: 'Deadlift Max', unit: 'lb', group: 'Physical (reports)', better: 'high', digits: 0 },
];

export const OTHER_MEASURES: StudyMeasure[] = [
  { id: 'weight', label: 'Body Weight', unit: 'lb', group: 'Body', better: null, digits: 0 },
  { id: 'checkin:feel', label: 'Check-in: How they feel', unit: '/5', group: 'Check-ins', better: 'high', digits: 1 },
  { id: 'checkin:sleep', label: 'Check-in: Sleep', unit: '/5', group: 'Check-ins', better: 'high', digits: 1 },
  { id: 'checkin:eat', label: 'Check-in: Eating', unit: '/5', group: 'Check-ins', better: 'high', digits: 1 },
];

export type ParsedMeasure =
  | { kind: 'report'; key: string }
  | { kind: 'lift'; test: string; key: string; avg: boolean }
  | { kind: 'weight' }
  | { kind: 'checkin'; field: 'feelRating' | 'sleepRating' | 'eatRating' }
  | { kind: 'stat'; grid: string; key: string };

const CHECKIN: Record<string, 'feelRating' | 'sleepRating' | 'eatRating'> = { feel: 'feelRating', sleep: 'sleepRating', eat: 'eatRating' };

/** A measure id -> what to read, or null when it isn't one. */
export function parseMeasureId(id: unknown): ParsedMeasure | null {
  if (typeof id !== 'string' || id.length > 120) return null;
  if (id === 'weight') return { kind: 'weight' };
  let m = /^report:([a-z0-9_]{1,60})$/.exec(id);
  if (m) return { kind: 'report', key: m[1] };
  m = /^lift:([A-Z0-9_]{1,30}):([A-Za-z][A-Za-z0-9_]{0,59})(:avg)?$/.exec(id);
  if (m) return { kind: 'lift', test: m[1], key: m[2], avg: !!m[3] };
  m = /^checkin:(feel|sleep|eat)$/.exec(id);
  if (m) return { kind: 'checkin', field: CHECKIN[m[1]] };
  m = /^stat:(hitting|pitching|defense|catching):([A-Za-z0-9%/]{1,8})$/.exec(id);
  if (m) return { kind: 'stat', grid: m[1], key: m[2] };
  return null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The data request from the page: measure ids (1-40, unique, valid) and an optional date range. */
export function cleanDataRequest(raw: any): { ids: string[]; from: string | null; to: string | null } {
  const list = Array.isArray(raw?.measures) ? raw.measures : [];
  const ids = [...new Set(list.filter((x: unknown) => parseMeasureId(x) !== null) as string[])].slice(0, 40);
  if (!ids.length) throw new Error('Pick at least one measure');
  const from = typeof raw?.from === 'string' && DAY_RE.test(raw.from) ? raw.from : null;
  const to = typeof raw?.to === 'string' && DAY_RE.test(raw.to) ? raw.to : null;
  if (from && to && from > to) throw new Error('The start date is after the end date');
  return { ids, from, to };
}

export const STUDY_TYPES = ['relationship', 'drivers', 'change', 'beforeAfter', 'groups', 'profile', 'trend'] as const;

/** A saved study from the page: title, type and its settings (kept as the page sent them). */
export function cleanStudy(raw: any): { title: string; type: string; config: string; conclusion: string | null } {
  const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
  if (!title) throw new Error('Give the study a title');
  if (title.length > 120) throw new Error('Title is too long (120 max)');
  const type = typeof raw?.type === 'string' && (STUDY_TYPES as readonly string[]).includes(raw.type) ? raw.type : '';
  if (!type) throw new Error('Unknown study type');
  if (!raw?.config || typeof raw.config !== 'object' || Array.isArray(raw.config)) throw new Error('Study settings are missing');
  const config = JSON.stringify(raw.config);
  if (config.length > 20_000) throw new Error('Study settings are too large');
  const conclusion = typeof raw?.conclusion === 'string' ? raw.conclusion.trim().slice(0, 4000) || null : null;
  return { title, type, config, conclusion };
}
