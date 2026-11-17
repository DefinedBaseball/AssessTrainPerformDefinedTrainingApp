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
   with _ROM for range-of-motion tests). Pure functions -- unit-tested.
   ───────────────────────────────────────────────────────────────────────── */

export const AVG_SUFFIX = '__avg';

export interface MetricMeta { label: string; unit: string; digits: number; better: 'high' | 'low' | null; group?: string }
export interface TestMeta { label: string; source: 'vald:forcedecks' | 'vald:dynamo'; metrics: Record<string, MetricMeta> }

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

export interface DynamoSummary { laterality?: string | null; [k: string]: unknown }
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
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase();

/** DynaMo movement + position -> our test code. 90/90 = shoulder abducted 90 deg (supine or seated). */
export function dynamoTestCode(t: Pick<DynamoTest, 'movement' | 'position' | 'testCategory'>): string {
  const movement = t.movement || 'Unknown';
  const position = t.position || '';
  const rom = t.testCategory === 'RangeofMotion' ? '_ROM' : '';
  let code: string;
  if (movement === 'GripSqueeze') code = 'GRIP';
  else if (movement === 'InternalRotation' || movement === 'ExternalRotation') {
    const base = movement === 'InternalRotation' ? 'IR' : 'ER';
    const ninety = /90DegreeShoulderAbduction/i.test(position);
    code = `${base}_${ninety ? '9090' : /Standing/i.test(position) ? 'STANDING' : snake(position) || 'OTHER'}`;
  } else {
    code = [snake(movement), snake(position)].filter(Boolean).join('_');
  }
  return (code + rom).slice(0, 30);
}

export function dynamoTestLabel(code: string): string {
  const known: Record<string, string> = {
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
  };
  return known[code] ?? code.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
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

/** One DynaMo test -> best (the max / quickest rep) + average per side, and the asymmetry %. */
export function aggregateDynamo(t: DynamoTest): { code: string; metrics: Record<string, number>; meta: Record<string, MetricMeta> } {
  const code = dynamoTestCode(t);
  const metrics: Record<string, number> = {};
  const meta: Record<string, MetricMeta> = {};
  for (const s of t.repetitionTypeSummaries || []) {
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
  const asym = (t.asymmetries || []).find((a) => typeof a?.valuePercentage === 'number');
  if (asym) {
    /* VALD gives one asymmetry per test (of force, or of range of motion on
       a range-of-motion test), so best and average are the same. */
    const rom = t.testCategory === 'RangeofMotion';
    const key = rom ? 'RANGE_OF_MOTION_ASYM' : 'PEAK_FORCE_ASYM';
    metrics[key] = round(asym.valuePercentage as number);
    metrics[key + AVG_SUFFIX] = metrics[key];
    meta[key] = { label: rom ? 'Range of Motion Asymmetry' : 'Peak Force Asymmetry', unit: '%', digits: 1, better: 'low', group: 'Asymmetry' };
  }
  return { code, metrics, meta };
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
  /** 'forcedecks' and/or 'dynamo'. */
  devices: string[];
  /** Test codes NOT to import (default: none -- every test type). */
  excludedTestTypes: string[];
  /** VALD group ids in the "Sport" category -- athlete in ANY of them. */
  sportIds: string[];
  /** Other VALD group ids -- athlete in ANY of them. */
  groupIds: string[];
  /** ForceDecks tag (attribute value) ids -- test carries ANY of them. DynaMo has no tags. */
  tagIds: string[];
  /** App athletes -- only these (empty = everyone). */
  playerIds: string[];
}

export function emptyFilters(): ValdFilters {
  return { devices: ['forcedecks', 'dynamo'], excludedTestTypes: [], sportIds: [], groupIds: [], tagIds: [], playerIds: [] };
}

const ids = (v: unknown, max = 500): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x)))].slice(0, max) : [];

/** Check filters from the settings page. */
export function cleanFilters(raw: any): ValdFilters {
  const devices = ids(raw?.devices).filter((d) => d === 'forcedecks' || d === 'dynamo');
  return {
    devices: devices.length ? devices : ['forcedecks', 'dynamo'],
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
