/* ─────────────────────────────────────────────────────────────────────────
   VALD -> Lifting Report: turning VALD's raw tests into stored results.

   Stored under VALD's OWN result names so the box editor lists exactly
   what VALD sends, with VALD's name, unit, decimals and better-direction:
     ForceDecks  <RESULT>            e.g. JUMP_HEIGHT_INCHES_IMP_MOM
                 <RESULT>_LEFT / _RIGHT / _ASYM   (limb results, and the
                                     leg of a single-leg trial)
     DynaMo      PEAK_FORCE_LEFT / _RIGHT / _ASYM, IMPULSE_..., RFD_... ...
   Every metric is kept as the session's BEST (the plain key) and its
   AVERAGE (key + "__avg") across the session's trials / reps.

   Test codes: ForceDecks uses VALD's test type (CMJ, SJ, PPU ...); DynaMo is
   movement + position (GRIP, IR_STANDING, IR_9090, ER_STANDING, ER_9090,
   KNEE_FLEXION_SEATED ..., _ROM for range-of-motion tests; a combined IR +
   ER test is stored as an IR and an ER session); SmartSpeed is SS_ + the
   drill's name, one session per athlete / drill / day.
   Pure functions -- unit-tested.
   ───────────────────────────────────────────────────────────────────────── */

export const AVG_SUFFIX = '__avg';

export interface MetricMeta { label: string; unit: string; digits: number; better: 'high' | 'low' | null; group?: string }
export interface TestMeta { label: string; source: 'vald:forcedecks' | 'vald:dynamo' | 'vald:smartspeed'; metrics: Record<string, MetricMeta> }

/** ForceDecks result definition (GET /resultdefinitions). */
export interface FdResultDef {
  resultIdString: string;
  resultName: string;
  resultUnitName?: string | null;
  numberOfDecimalPlaces?: number | null;
  trendDirection?: string | null;
  resultGroup?: string | null;
}
export interface FdResult { value: number; limb?: string | null; definition?: { result?: string; name?: string; unit?: string } }
export interface FdTrial { limb?: string | null; results?: FdResult[] }

/** Friendly names for VALD's ForceDecks test codes (others show the code). */
export const FD_TEST_LABELS: Record<string, string> = {
  CMJ: 'Countermovement Jump',
  SJ: 'Squat Jump',
  PPU: 'Plyo Push-up',
  PUSHUPT: 'Push-up',
  IMTP: 'Isometric Mid-Thigh Pull',
  IBSQT: 'ISO Belt Squat',
  SLJ: 'Single Leg Jump',
  LAH: 'Land and Hold',
  SHLDISOY: 'Shoulder ISO-Y',
  SHLDISOI: 'Shoulder ISO-I',
  SHLDISOT: 'Shoulder ISO-T',
  DJ: 'Drop Jump',
  HJ: 'Hop Test',
  SLCMJ: 'Single Leg CMJ',
  RSHIP: 'RSHIP',
  ABCMJ: 'Abalakov CMJ',
};

const LIMB_SUFFIX: Record<string, string> = { Left: '_LEFT', Right: '_RIGHT', Asym: '_ASYM' };
const LIMB_LABEL: Record<string, string> = { _LEFT: ' (Left)', _RIGHT: ' (Right)', _ASYM: ' Asymmetry' };

/** "Positive" -> higher is better; asymmetries are better closer to 0. */
function betterOf(trend: string | null | undefined, asym: boolean): MetricMeta['better'] {
  if (asym) return 'low';
  if (trend === 'Positive') return 'high';
  if (trend === 'Negative') return 'low';
  return null;
}

/** Best of a session's values: max / min by direction; an asymmetry's best is the one nearest 0. */
export function bestOf(values: number[], better: MetricMeta['better'], asym = false): number {
  if (asym) return values.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  if (better === 'low') return Math.min(...values);
  return Math.max(...values);
}

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * One ForceDecks session's trials -> best + average per result / limb.
 * A single-leg test reports each trial's leg on the trial (its results say
 * "Trial"), so those get the trial's _LEFT / _RIGHT.
 */
export function aggregateForceDecks(trials: FdTrial[], defs: Map<string, FdResultDef>): { metrics: Record<string, number>; meta: Record<string, MetricMeta> } {
  const values = new Map<string, number[]>();
  const info = new Map<string, { result: string; suffix: string; name?: string; unit?: string }>();
  for (const trial of trials || []) {
    const trialLimb = trial?.limb === 'Left' || trial?.limb === 'Right' ? trial.limb : null;
    for (const r of trial?.results || []) {
      const result = r?.definition?.result;
      if (!result || typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
      const limb = r.limb && r.limb !== 'Trial' ? r.limb : trialLimb;
      const suffix = limb ? LIMB_SUFFIX[limb] ?? '' : '';
      const key = result + suffix;
      (values.get(key) ?? values.set(key, []).get(key)!).push(r.value);
      if (!info.has(key)) info.set(key, { result, suffix, name: r.definition?.name, unit: r.definition?.unit });
    }
  }
  const metrics: Record<string, number> = {};
  const meta: Record<string, MetricMeta> = {};
  for (const [key, vals] of values) {
    const i = info.get(key)!;
    const def = defs.get(i.result);
    const asym = i.suffix === '_ASYM';
    const better = betterOf(def?.trendDirection, asym);
    metrics[key] = round(bestOf(vals, better, asym));
    metrics[key + AVG_SUFFIX] = round(mean(vals));
    meta[key] = {
      label: (def?.resultName || i.name || i.result) + (LIMB_LABEL[i.suffix] ?? ''),
      unit: asym ? '%' : (def?.resultUnitName ?? i.unit ?? ''),
      digits: Math.min(4, Math.max(0, def?.numberOfDecimalPlaces ?? 1)),
      better,
      group: asym ? 'Asymmetry' : i.suffix ? 'Left / Right' : (def?.resultGroup || 'Main'),
    };
  }
  return { metrics, meta };
}

/* ── DynaMo ───────────────────────────────────────────────────────────── */

export interface DynamoSummary { laterality?: string | null; movement?: string | null; [k: string]: unknown }
export interface DynamoTest {
  id: string;
  athleteId: string;
  testCategory?: string | null;
  bodyRegion?: string | null;
  movement?: string | null;
  position?: string | null;
  startTimeUTC?: string | null;
  analysedDateUTC?: string | null;
  repetitionTypeSummaries?: DynamoSummary[] | null;
  asymmetries?: { movement?: string; valuePercentage?: number }[] | null;
  /** Combined IR + ER tests: VALD's own ratios per side. */
  ratios?: { laterality?: string; numeratorMovement?: string; denominatorMovement?: string; value?: number }[] | null;
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();
const words = (s: string) => s.replace(/^p(?=\d)/, '').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').trim();

const ROTATION: Record<string, string> = { InternalRotation: 'IR', ExternalRotation: 'ER' };
/** VALD's combined test: IR and ER of both arms in one session. Stored as
 *  two sessions (IR and ER), like the tests done one movement at a time. */
const COMBINED = 'InternalRotationExternalRotation';

/**
 * DynaMo test -> our test code. Grip = GRIP; shoulder IR / ER = IR_ / ER_ +
 * STANDING or 9090 (shoulder abducted 90 deg, supine or seated); anything
 * else = body region + movement + position (KNEE_FLEXION_SEATED,
 * SHOULDER_FLEXION_STANDING). Range-of-motion tests end _ROM. `movement`
 * overrides the test's own (one half of a combined IR + ER test).
 */
export function dynamoTestCode(t: Pick<DynamoTest, 'movement' | 'position' | 'testCategory' | 'bodyRegion'>, movement?: string): string {
  const mv = movement || t.movement || 'Unknown';
  const position = t.position || '';
  const rom = t.testCategory === 'RangeofMotion' ? '_ROM' : '';
  let code: string;
  if (mv === 'GripSqueeze') code = 'GRIP';
  else if (ROTATION[mv]) {
    const ninety = /90DegreeShoulderAbduction/i.test(position);
    code = `${ROTATION[mv]}_${ninety ? '9090' : /Standing/i.test(position) ? 'STANDING' : snake(position) || 'OTHER'}`;
  } else {
    code = [snake(t.bodyRegion || ''), snake(mv), snake(position)].filter(Boolean).join('_');
  }
  return code.slice(0, 30 - rom.length) + rom;
}

const KNOWN_DY: Record<string, string> = {
  GRIP: 'Grip Strength',
  IR_STANDING: 'Shoulder IR (Standing)',
  IR_9090: 'Shoulder IR (90/90)',
  ER_STANDING: 'Shoulder ER (Standing)',
  ER_9090: 'Shoulder ER (90/90)',
  GRIP_ROM: 'Grip Range of Motion',
  IR_STANDING_ROM: 'Shoulder IR ROM (Standing)',
  IR_9090_ROM: 'Shoulder IR ROM (90/90)',
  ER_STANDING_ROM: 'Shoulder ER ROM (Standing)',
  ER_9090_ROM: 'Shoulder ER ROM (90/90)',
  KNEE_FLEXION_SEATED: 'Knee Flexion (Seated)',
  KNEE_FLEXION_PRONE: 'Knee Flexion (Prone)',
  SHOULDER_FLEXION_STANDING_ROM: 'Shoulder Flexion ROM (Standing)',
};
/** The DynaMo test codes listed in the import filters before the first pull. */
export const KNOWN_DYNAMO_CODES = Object.keys(KNOWN_DY);

/** A test's name: the known ones, else "Knee Extension (Seated)" from VALD's fields. */
export function dynamoTestLabel(code: string, t?: Pick<DynamoTest, 'movement' | 'position' | 'testCategory' | 'bodyRegion'>, movement?: string): string {
  if (KNOWN_DY[code]) return KNOWN_DY[code];
  if (t) {
    const mv = movement || t.movement || '';
    const base = [t.bodyRegion && t.bodyRegion !== 'Hand' ? t.bodyRegion : '', words(mv)].filter(Boolean).join(' ');
    const rom = t.testCategory === 'RangeofMotion' ? ' ROM' : '';
    const pos = t.position ? ` (${words(t.position)})` : '';
    if (base) return base + rom + pos;
  }
  return code.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

/** DynaMo summary fields: [our key, label, unit, better, best field, average field]. */
const DY_FIELDS: [string, string, string, MetricMeta['better'], string, string][] = [
  ['PEAK_FORCE', 'Peak Force', 'N', 'high', 'maxForceNewtons', 'avgForceNewtons'],
  ['NET_PEAK_FORCE', 'Net Peak Force', 'N', 'high', 'maxNetPeakForceNewtons', 'avgNetPeakForceNewtons'],
  ['IMPULSE', 'Impulse', 'N s', 'high', 'maxImpulseNewtonSeconds', 'avgImpulseNewtonSeconds'],
  ['RFD', 'Rate of Force Development', 'N/s', 'high', 'maxRateOfForceDevelopmentNewtonsPerSecond', 'avgRateOfForceDevelopmentNewtonsPerSecond'],
  ['RFD_150MS', 'RFD 0-150 ms', 'N/s', 'high', 'maxRateOfForceDevelopment150msNewtonsPerSecond', 'avgRateOfForceDevelopment150msNewtonsPerSecond'],
  ['RFD_200MS', 'RFD 0-200 ms', 'N/s', 'high', 'maxRateOfForceDevelopment200msNewtonsPerSecond', 'avgRateOfForceDevelopment200msNewtonsPerSecond'],
  ['RFD_250MS', 'RFD 0-250 ms', 'N/s', 'high', 'maxRateOfForceDevelopment250msNewtonsPerSecond', 'avgRateOfForceDevelopment250msNewtonsPerSecond'],
  ['NET_FORCE_100MS', 'Net Force at 100 ms', 'N', 'high', 'maxNetForceAt100msNewtons', 'avgNetForceAt100msNewtons'],
  ['NET_FORCE_150MS', 'Net Force at 150 ms', 'N', 'high', 'maxNetForceAt150msNewtons', 'avgNetForceAt150msNewtons'],
  ['NET_FORCE_200MS', 'Net Force at 200 ms', 'N', 'high', 'maxNetForceAt200msNewtons', 'avgNetForceAt200msNewtons'],
  ['NET_IMPULSE_100MS', 'Net Impulse at 100 ms', 'N s', 'high', 'maxNetImpulseAt100msNewtonSeconds', 'avgNetImpulseAt100msNewtonSeconds'],
  ['NET_IMPULSE_150MS', 'Net Impulse at 150 ms', 'N s', 'high', 'maxNetImpulseAt150msNewtonSeconds', 'avgNetImpulseAt150msNewtonSeconds'],
  ['NET_IMPULSE_200MS', 'Net Impulse at 200 ms', 'N s', 'high', 'maxNetImpulseAt200msNewtonSeconds', 'avgNetImpulseAt200msNewtonSeconds'],
  ['TIME_TO_PEAK_FORCE', 'Time to Peak Force', 's', 'low', 'minTimeToPeakForceSeconds', 'avgTimeToPeakForceSeconds'],
  ['TIME_TO_80PCT_PEAK_FORCE', 'Time to 80% Peak Force', 's', 'low', 'minTimeTo80PercentPeakForceSeconds', 'avgTimeTo80PercentPeakForceSeconds'],
  ['RANGE_OF_MOTION', 'Range of Motion', '°', 'high', 'maxRangeOfMotionDegrees', 'avgRangeOfMotionDegrees'],
];
const SIDE: Record<string, string> = { LeftSide: '_LEFT', RightSide: '_RIGHT' };

export interface DynamoSession {
  /** Added to VALD's test id: '' for a normal test, ':IR' / ':ER' for the halves of a combined one. */
  idSuffix: string;
  code: string;
  label: string;
  metrics: Record<string, number>;
  meta: Record<string, MetricMeta>;
}

/** One movement's reps -> best (the max / quickest rep) + average per side, its asymmetry and VALD's ratios. */
function dynamoSession(t: DynamoTest, movement: string | null, idSuffix: string): DynamoSession {
  const code = dynamoTestCode(t, movement || undefined);
  const metrics: Record<string, number> = {};
  const meta: Record<string, MetricMeta> = {};
  const summaries = (t.repetitionTypeSummaries || []).filter((s) => !movement || !s?.movement || s.movement === movement);
  for (const s of summaries) {
    const side = SIDE[String(s?.laterality)] ?? '';
    for (const [key, label, unit, better, bestField, avgField] of DY_FIELDS) {
      const best = s[bestField];
      const avg = s[avgField];
      if (typeof best !== 'number' || !Number.isFinite(best)) continue;
      /* A field the test didn't measure reads 0 (force on a range-of-motion
         test, range of motion on a strength test) -- leave it out. */
      if (best === 0) continue;
      const k = key + side;
      metrics[k] = round(best);
      if (typeof avg === 'number' && Number.isFinite(avg)) metrics[k + AVG_SUFFIX] = round(avg);
      meta[k] = { label: label + (LIMB_LABEL[side] ?? ''), unit, digits: unit === 's' ? 3 : unit === '°' ? 1 : unit === 'N s' ? 1 : 0, better, group: side ? 'Left / Right' : 'Main' };
    }
  }
  /* One asymmetry per movement (of force, or of range of motion on a
     range-of-motion test), so best and average are the same. */
  const asym = (t.asymmetries || []).find((a) => typeof a?.valuePercentage === 'number' && (!movement || !a.movement || a.movement === movement));
  if (asym) {
    const rom = t.testCategory === 'RangeofMotion';
    const key = rom ? 'RANGE_OF_MOTION_ASYM' : 'PEAK_FORCE_ASYM';
    metrics[key] = round(asym.valuePercentage as number);
    metrics[key + AVG_SUFFIX] = metrics[key];
    meta[key] = { label: rom ? 'Range of Motion Asymmetry' : 'Peak Force Asymmetry', unit: '%', digits: 1, better: 'low', group: 'Asymmetry' };
  }
  /* VALD's own ratios (combined IR + ER tests): ER:IR on the ER session, IR:ER on the IR one. */
  if (movement && ROTATION[movement]) {
    const me = ROTATION[movement];
    const other = me === 'IR' ? 'ER' : 'IR';
    for (const r of t.ratios || []) {
      if (r?.numeratorMovement !== movement || typeof r.value !== 'number' || !Number.isFinite(r.value)) continue;
      const side = SIDE[String(r.laterality)] ?? '';
      const k = `${me}_${other}_RATIO${side}`;
      metrics[k] = round(r.value);
      metrics[k + AVG_SUFFIX] = metrics[k];
      meta[k] = { label: `${me}:${other} Ratio${LIMB_LABEL[side] ?? ''}`, unit: '', digits: 2, better: null, group: 'Ratio' };
    }
  }
  return { idSuffix, code, label: dynamoTestLabel(code, t, movement || undefined), metrics, meta };
}

/** One DynaMo test -> its session(s): a combined IR + ER test becomes an IR and an ER session. */
export function aggregateDynamo(t: DynamoTest): DynamoSession[] {
  if (t.movement === COMBINED) {
    return ['InternalRotation', 'ExternalRotation'].map((mv) => dynamoSession(t, mv, `:${ROTATION[mv]}`));
  }
  return [dynamoSession(t, null, '')];
}

/* ── SmartSpeed (timing gates) ────────────────────────────────────────── */

export interface SmartSpeedRep {
  id: string;
  profileId: string;
  testDateUtc: string;
  testName?: string | null;
  isValid?: boolean | null;
  runningSummaryFields?: {
    totalTimeSeconds?: number | null;
    velocityFields?: { peakVelocityMetersPerSecond?: number | null; meanVelocityMetersPerSecond?: number | null } | null;
    gateSummaryFields?: Record<string, number | null> | null;
  } | null;
}

/** "10yd Sprint" -> SS_10YD_SPRINT. */
export function smartSpeedTestCode(testName: string | null | undefined): string {
  return ('SS_' + (snake(String(testName || '')) || 'TEST')).slice(0, 30);
}

/* Faster than this means the gates were set for a different distance than
   the test says (e.g. a "100yd" test run over 10 yd) -- the velocity is
   meaningless then, so it's left out. */
const MAX_HUMAN_SPEED = 13; // m/s
const SPLITS = ['splitOne', 'splitTwo', 'splitThree', 'splitFour'];

/**
 * One athlete's reps of one SmartSpeed drill on one day -> a session:
 * total time (best = fastest), each split when the drill has more than one,
 * peak / mean velocity when they make sense, and the rep count.
 */
export function aggregateSmartSpeed(reps: SmartSpeedRep[]): { metrics: Record<string, number>; meta: Record<string, MetricMeta> } {
  const metrics: Record<string, number> = {};
  const meta: Record<string, MetricMeta> = {};
  const valid = reps.filter((r) => r?.isValid !== false && (r.runningSummaryFields?.totalTimeSeconds ?? 0) > 0);
  const put = (key: string, vals: number[], m: MetricMeta) => {
    if (!vals.length) return;
    metrics[key] = round(bestOf(vals, m.better));
    metrics[key + AVG_SUFFIX] = round(mean(vals));
    meta[key] = m;
  };
  put('TOTAL_TIME', valid.map((r) => r.runningSummaryFields!.totalTimeSeconds as number), { label: 'Total Time', unit: 's', digits: 3, better: 'low', group: 'Main' });
  const splitCount = Math.max(0, ...valid.map((r) => SPLITS.filter((k) => (r.runningSummaryFields?.gateSummaryFields?.[k] ?? 0) > 0).length));
  if (splitCount > 1) {
    SPLITS.slice(0, splitCount).forEach((k, i) => {
      const vals = valid.map((r) => r.runningSummaryFields?.gateSummaryFields?.[k]).filter((v): v is number => typeof v === 'number' && v > 0);
      put(`SPLIT_${i + 1}`, vals, { label: `Split ${i + 1}`, unit: 's', digits: 3, better: 'low', group: 'Splits' });
    });
  }
  const speed = (f: 'peakVelocityMetersPerSecond' | 'meanVelocityMetersPerSecond') =>
    valid.map((r) => r.runningSummaryFields?.velocityFields?.[f]).filter((v): v is number => typeof v === 'number' && v > 0 && v <= MAX_HUMAN_SPEED);
  put('PEAK_VELOCITY', speed('peakVelocityMetersPerSecond'), { label: 'Peak Velocity', unit: 'm/s', digits: 2, better: 'high', group: 'Main' });
  put('MEAN_VELOCITY', speed('meanVelocityMetersPerSecond'), { label: 'Mean Velocity', unit: 'm/s', digits: 2, better: 'high', group: 'Main' });
  if (valid.length) {
    metrics.REPS = valid.length;
    meta.REPS = { label: 'Reps', unit: '', digits: 0, better: null, group: 'Main' };
  }
  return { metrics, meta };
}

/** A day in the academy's time zone ("YYYY-MM-DD"); UTC when none is set. */
export function localDay(at: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/* ── Bodyweight from ForceDecks ───────────────────────────────────────── */

/* Tests the athlete stands on the plates for, so the weigh-in is their
   bodyweight. Upper-body tests (push-ups, shoulder ISO) only weigh what's
   on the plates, and loaded tests may include the load. */
const BODYWEIGHT_TESTS = new Set(['CMJ', 'SJ', 'ABCMJ', 'DJ', 'HJ', 'SLJ', 'SLCMJ', 'IMTP', 'LAH']);

/** A ForceDecks weigh-in (kg) -> whole pounds, or null when it isn't a real
 *  bodyweight (0 = none taken; a test not stood on with both feet). */
export function weighInLbs(kg: unknown, testType?: string): number | null {
  if (testType !== undefined && !BODYWEIGHT_TESTS.has(String(testType).toUpperCase())) return null;
  if (typeof kg !== 'number' || !Number.isFinite(kg) || kg <= 0) return null;
  const lbs = Math.round(kg * 2.2046226218);
  return lbs >= 50 && lbs <= 500 ? lbs : null;
}

/* ── Matching VALD profiles to the roster ─────────────────────────────── */

export interface RosterPlayer { id: string; firstName: string; lastName: string; birthDate: string | null; athleteCode: string | null }
export interface ValdProfile { profileId: string; givenName?: string | null; familyName?: string | null; dateOfBirth?: string | null; externalId?: string | null }
export type MatchResult =
  | { playerId: string; by: 'externalId' | 'nameBirthday' }
  | { playerId: null; reason: 'no-match' | 'birthday-missing-in-app' | 'birthday-different' | 'several-matches' };

export const normName = (s: string | null | undefined) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
const dayOf = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '');

/** External ID (VALD) = the app's Athlete ID first; otherwise first + last name AND birthday. */
export function matchProfile(p: ValdProfile, roster: RosterPlayer[]): MatchResult {
  const ext = String(p.externalId || '').trim().toUpperCase();
  if (ext) {
    const byCode = roster.filter((r) => r.athleteCode && r.athleteCode.toUpperCase() === ext);
    if (byCode.length === 1) return { playerId: byCode[0].id, by: 'externalId' };
  }
  const name = normName(p.givenName) + '|' + normName(p.familyName);
  const sameName = roster.filter((r) => normName(r.firstName) + '|' + normName(r.lastName) === name);
  if (!sameName.length) return { playerId: null, reason: 'no-match' };
  const dob = dayOf(p.dateOfBirth);
  const both = sameName.filter((r) => dob && dayOf(r.birthDate) === dob);
  if (both.length === 1) return { playerId: both[0].id, by: 'nameBirthday' };
  if (both.length > 1) return { playerId: null, reason: 'several-matches' };
  return { playerId: null, reason: sameName.some((r) => !r.birthDate) ? 'birthday-missing-in-app' : 'birthday-different' };
}

/* ── Filters ──────────────────────────────────────────────────────────── */

export interface ValdFilters {
  /** 'forcedecks', 'dynamo' and / or 'smartspeed'. */
  devices: string[];
  /** Test codes NOT to import (default: none -- every test type). */
  excludedTestTypes: string[];
  /** VALD group ids in the "Sport" category -- athlete in ANY of them. */
  sportIds: string[];
  /** Other VALD group ids -- athlete in ANY of them. */
  groupIds: string[];
  /** ForceDecks tag (attribute value) ids -- test carries ANY of them. DynaMo / SmartSpeed have no tags. */
  tagIds: string[];
  /** App athletes -- only these (empty = everyone). */
  playerIds: string[];
}

export const VALD_DEVICES = ['forcedecks', 'dynamo', 'smartspeed'];

export function emptyFilters(): ValdFilters {
  return { devices: [...VALD_DEVICES], excludedTestTypes: [], sportIds: [], groupIds: [], tagIds: [], playerIds: [] };
}

const ids = (v: unknown, max = 500): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, max) : [];

/** Check filters from the settings page. */
export function cleanFilters(raw: any): ValdFilters {
  const devices = ids(raw?.devices).filter((d) => VALD_DEVICES.includes(d));
  return {
    devices: devices.length ? devices : [...VALD_DEVICES],
    excludedTestTypes: ids(raw?.excludedTestTypes, 200).map((s) => s.toUpperCase()),
    sportIds: ids(raw?.sportIds),
    groupIds: ids(raw?.groupIds),
    tagIds: ids(raw?.tagIds),
    playerIds: ids(raw?.playerIds, 2000),
  };
}

/** A ForceDecks test passes the tag filter when no tags are chosen or it carries one of them. */
export function passesTags(attributes: { attributeValueId?: string }[] | null | undefined, tagIds: string[]): boolean {
  if (!tagIds.length) return true;
  return (attributes || []).some((a) => a?.attributeValueId && tagIds.includes(a.attributeValueId));
}
