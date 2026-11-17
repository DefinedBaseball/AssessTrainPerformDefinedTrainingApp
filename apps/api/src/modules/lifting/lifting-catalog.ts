/* ─────────────────────────────────────────────────────────────────────────
   Lifting Dashboard -- the tests it knows about and its default layout.

   A test result is stored once, with its metrics under OUR keys (below),
   in the units noted here. VALD results are mapped onto these keys when
   they're imported (a result the catalog doesn't name is still kept, and
   mergeCatalog() lists it for the editor); typed results use them too.

   The dashboard itself is configurable (Settings -> Lifting): bubbles
   name a test, boxes name a metric of it (or a ratio of two metrics), with
   a label, unit, an optional display factor (e.g. cm -> in), decimals and
   which direction is better. One default layout for every athlete; an
   athlete can be given their own, which replaces it for them.
   Pure functions -- unit-tested.
   ───────────────────────────────────────────────────────────────────────── */

export interface CatalogMetric {
  key: string;
  label: string;
  unit: string;
  /** Heading the metric is listed under in the layout editor. */
  group?: string;
}
export interface CatalogTest {
  code: string;
  label: string;
  /** Where the result normally comes from ("other" = only seen in saved
   *  results, e.g. a VALD test this list doesn't name yet). */
  source: 'vald:forcedecks' | 'vald:dynamo' | 'manual' | 'other';
  metrics: CatalogMetric[];
}

/* Metric groups, in the order the editor lists them. */
export const METRIC_GROUPS = ['Main', 'Power', 'Velocity', 'Force', 'Impulse', 'Rate of Force', 'Timing', 'Left / Right', 'Asymmetry', 'More from results'];
const MORE = 'More from results';

const M = (key: string, label: string, unit: string, group = 'Main'): CatalogMetric => ({ key, label, unit, group });
/** A two-sided metric: whole-body value, left, right and asymmetry %. */
const LR = (key: string, label: string, unit: string, group: string): CatalogMetric[] => [
  M(key, label, unit, group),
  ...SIDES(key, label, unit),
];
/** Left, right and asymmetry % only (single-leg tests, etc.). */
const SIDES = (key: string, label: string, unit: string): CatalogMetric[] => [
  M(`${key}Left`, `${label} (Left)`, unit, 'Left / Right'),
  M(`${key}Right`, `${label} (Right)`, unit, 'Left / Right'),
  M(`${key}Asym`, `${label} Asymmetry`, '%', 'Asymmetry'),
];
/** First of each key wins (keeps the hand-picked label/group). */
const uniq = (list: CatalogMetric[]) => {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));
};

const JUMP_HEIGHTS = [
  M('jumpHeight', 'Jump Height', 'cm'),
  M('jumpHeightImpMom', 'Jump Height (Imp-Mom)', 'cm'),
  M('jumpHeightFlightTime', 'Jump Height (Flight Time)', 'cm'),
];
const BODY_WEIGHT = M('bodyWeight', 'Body Weight', 'kg');

/* ForceDecks countermovement jump -- the results VALD reports for a CMJ. */
const CMJ_METRICS = uniq([
  ...JUMP_HEIGHTS,
  M('rsiModified', 'RSI-modified', 'm/s'),
  M('flightTimeContractionTime', 'Flight Time : Contraction Time', ''),
  M('countermovementDepth', 'Countermovement Depth', 'cm'),
  BODY_WEIGHT,
  M('peakPower', 'Peak Power', 'W', 'Power'),
  M('peakPowerBM', 'Peak Power / BM', 'W/kg', 'Power'),
  M('peakPowerAsym', 'Peak Power Asymmetry', '%', 'Asymmetry'),
  M('concentricMeanPower', 'Concentric Mean Power', 'W', 'Power'),
  M('concentricMeanPowerBM', 'Concentric Mean Power / BM', 'W/kg', 'Power'),
  M('eccentricPeakPower', 'Eccentric Peak Power', 'W', 'Power'),
  M('eccentricPeakPowerBM', 'Eccentric Peak Power / BM', 'W/kg', 'Power'),
  M('peakVelocity', 'Peak Takeoff Velocity', 'm/s', 'Velocity'),
  M('velocityAtPeakPower', 'Velocity at Peak Power', 'm/s', 'Velocity'),
  M('eccentricPeakVelocity', 'Eccentric Peak Velocity', 'm/s', 'Velocity'),
  M('peakForce', 'Peak Force', 'N', 'Force'),
  ...LR('concentricPeakForce', 'Concentric Peak Force', 'N', 'Force'),
  M('concentricPeakForceBM', 'Concentric Peak Force / BM', 'N/kg', 'Force'),
  ...LR('concentricMeanForce', 'Concentric Mean Force', 'N', 'Force'),
  ...LR('eccentricPeakForce', 'Eccentric Peak Force', 'N', 'Force'),
  ...LR('eccentricMeanForce', 'Eccentric Mean Force', 'N', 'Force'),
  M('forceAtZeroVelocity', 'Force at Zero Velocity', 'N', 'Force'),
  M('peakNetTakeoffForceBM', 'Peak Net Takeoff Force / BM', 'N/kg', 'Force'),
  ...LR('peakLandingForce', 'Peak Landing Force', 'N', 'Force'),
  ...LR('concentricImpulse', 'Concentric Impulse', 'N·s', 'Impulse'),
  ...LR('eccentricBrakingImpulse', 'Eccentric Braking Impulse', 'N·s', 'Impulse'),
  ...LR('eccentricDecelerationImpulse', 'Eccentric Deceleration Impulse', 'N·s', 'Impulse'),
  ...LR('landingImpulse', 'Landing Impulse', 'N·s', 'Impulse'),
  ...LR('eccentricBrakingRfd', 'Eccentric Braking RFD', 'N/s', 'Rate of Force'),
  M('eccentricBrakingRfdBM', 'Eccentric Braking RFD / BM', 'N/s/kg', 'Rate of Force'),
  ...LR('eccentricDecelerationRfd', 'Eccentric Deceleration RFD', 'N/s', 'Rate of Force'),
  M('landingRfd', 'Landing RFD', 'N/s', 'Rate of Force'),
  M('contractionTime', 'Contraction Time', 'ms', 'Timing'),
  M('eccentricDuration', 'Eccentric Duration', 'ms', 'Timing'),
  M('brakingPhaseDuration', 'Braking Phase Duration', 'ms', 'Timing'),
  M('concentricDuration', 'Concentric Duration', 'ms', 'Timing'),
  M('flightTime', 'Flight Time', 'ms', 'Timing'),
  M('timeToPeakForce', 'Time to Peak Force', 'ms', 'Timing'),
]);

const SJ_METRICS = uniq([
  ...JUMP_HEIGHTS,
  BODY_WEIGHT,
  M('peakPower', 'Peak Power', 'W', 'Power'),
  M('peakPowerBM', 'Peak Power / BM', 'W/kg', 'Power'),
  M('peakPowerAsym', 'Peak Power Asymmetry', '%', 'Asymmetry'),
  M('concentricMeanPower', 'Concentric Mean Power', 'W', 'Power'),
  M('peakVelocity', 'Peak Takeoff Velocity', 'm/s', 'Velocity'),
  M('velocityAtPeakPower', 'Velocity at Peak Power', 'm/s', 'Velocity'),
  M('peakForce', 'Peak Force', 'N', 'Force'),
  ...LR('concentricPeakForce', 'Concentric Peak Force', 'N', 'Force'),
  M('concentricPeakForceBM', 'Concentric Peak Force / BM', 'N/kg', 'Force'),
  ...LR('concentricMeanForce', 'Concentric Mean Force', 'N', 'Force'),
  ...LR('peakLandingForce', 'Peak Landing Force', 'N', 'Force'),
  ...LR('concentricImpulse', 'Concentric Impulse', 'N·s', 'Impulse'),
  ...LR('concentricRfd', 'Concentric RFD', 'N/s', 'Rate of Force'),
  M('concentricDuration', 'Concentric Duration', 'ms', 'Timing'),
  M('flightTime', 'Flight Time', 'ms', 'Timing'),
  M('timeToPeakForce', 'Time to Peak Force', 'ms', 'Timing'),
]);

const DJ_METRICS = uniq([
  M('rsi', 'RSI (Flight Time / Contact Time)', ''),
  ...JUMP_HEIGHTS,
  BODY_WEIGHT,
  M('peakPower', 'Peak Power', 'W', 'Power'),
  M('peakPowerBM', 'Peak Power / BM', 'W/kg', 'Power'),
  M('lowerLimbStiffness', 'Lower-Limb Stiffness', 'N/m', 'Force'),
  ...LR('peakDropLandingForce', 'Peak Drop Landing Force', 'N', 'Force'),
  ...LR('peakLandingForce', 'Peak Landing Force', 'N', 'Force'),
  ...LR('concentricImpulse', 'Concentric Impulse', 'N·s', 'Impulse'),
  ...LR('eccentricBrakingImpulse', 'Eccentric Braking Impulse', 'N·s', 'Impulse'),
  M('contactTime', 'Contact Time', 'ms', 'Timing'),
  M('flightTime', 'Flight Time', 'ms', 'Timing'),
]);

const HOP_METRICS = uniq([
  M('rsiMean', 'RSI (Mean)', ''),
  M('rsiBest', 'RSI (Best)', ''),
  M('jumpHeightMean', 'Jump Height (Mean)', 'cm'),
  M('jumpHeightBest', 'Jump Height (Best)', 'cm'),
  BODY_WEIGHT,
  M('peakForceMean', 'Peak Force (Mean)', 'N', 'Force'),
  M('lowerLimbStiffness', 'Lower-Limb Stiffness', 'N/m', 'Force'),
  M('contactTimeMean', 'Contact Time (Mean)', 'ms', 'Timing'),
  M('flightTimeMean', 'Flight Time (Mean)', 'ms', 'Timing'),
]);

const SL_CMJ_METRICS = uniq([
  BODY_WEIGHT,
  ...SIDES('jumpHeight', 'Jump Height', 'cm'),
  ...SIDES('peakPower', 'Peak Power', 'W'),
  ...SIDES('peakPowerBM', 'Peak Power / BM', 'W/kg'),
  ...SIDES('concentricImpulse', 'Concentric Impulse', 'N·s'),
  ...SIDES('concentricPeakForce', 'Concentric Peak Force', 'N'),
  ...SIDES('eccentricBrakingRfd', 'Eccentric Braking RFD', 'N/s'),
  ...SIDES('peakLandingForce', 'Peak Landing Force', 'N'),
  ...SIDES('rsiModified', 'RSI-modified', 'm/s'),
  ...SIDES('contractionTime', 'Contraction Time', 'ms'),
]);

const IMTP_METRICS = uniq([
  ...LR('peakForce', 'Peak Vertical Force', 'N', 'Main'),
  M('peakForceBM', 'Peak Vertical Force / BM', 'N/kg'),
  M('netPeakForce', 'Net Peak Vertical Force', 'N'),
  M('netPeakForceBM', 'Net Peak Vertical Force / BM', 'N/kg'),
  BODY_WEIGHT,
  ...[50, 100, 150, 200, 250].map((ms) => M(`forceAt${ms}ms`, `Force at ${ms} ms`, 'N', 'Force')),
  ...[50, 100, 150, 200, 250].map((ms) => M(`rfd0to${ms}ms`, `RFD 0–${ms} ms`, 'N/s', 'Rate of Force')),
  M('impulse0to100ms', 'Impulse 0–100 ms', 'N·s', 'Impulse'),
  M('impulse0to200ms', 'Impulse 0–200 ms', 'N·s', 'Impulse'),
  M('timeToPeakForce', 'Time to Peak Force', 'ms', 'Timing'),
]);

const PLYO_PUSHUP_METRICS = uniq([
  M('impulse', 'Impulse', 'N·s'),
  M('peakForce', 'Peak Force', 'N'),
  M('asymmetry', 'Asymmetry', '%', 'Asymmetry'),
  M('pushupHeight', 'Push-up Height', 'cm'),
  M('peakForceBM', 'Peak Force / BM', 'N/kg'),
  BODY_WEIGHT,
  M('peakForceLeft', 'Peak Force (Left)', 'N', 'Left / Right'),
  M('peakForceRight', 'Peak Force (Right)', 'N', 'Left / Right'),
  ...LR('concentricPeakForce', 'Concentric Peak Force', 'N', 'Force'),
  ...LR('eccentricPeakForce', 'Eccentric Peak Force', 'N', 'Force'),
  ...LR('peakLandingForce', 'Peak Landing Force', 'N', 'Force'),
  ...LR('concentricImpulse', 'Concentric Impulse', 'N·s', 'Impulse'),
  ...LR('eccentricBrakingImpulse', 'Eccentric Braking Impulse', 'N·s', 'Impulse'),
  ...LR('eccentricDecelerationRfd', 'Eccentric Deceleration RFD', 'N/s', 'Rate of Force'),
  M('contractionTime', 'Contraction Time', 'ms', 'Timing'),
  M('concentricDuration', 'Concentric Duration', 'ms', 'Timing'),
  M('flightTime', 'Flight Time', 'ms', 'Timing'),
]);

const PUSHUP_METRICS = uniq([
  M('peakForce', 'Peak Force', 'N'),
  M('asymmetry', 'Asymmetry', '%', 'Asymmetry'),
  M('peakForceBM', 'Peak Force / BM', 'N/kg'),
  M('meanForce', 'Mean Force', 'N'),
  M('impulse', 'Impulse', 'N·s'),
  BODY_WEIGHT,
  M('peakForceLeft', 'Peak Force (Left)', 'N', 'Left / Right'),
  M('peakForceRight', 'Peak Force (Right)', 'N', 'Left / Right'),
  ...LR('concentricPeakForce', 'Concentric Peak Force', 'N', 'Force'),
  ...LR('concentricImpulse', 'Concentric Impulse', 'N·s', 'Impulse'),
  M('timeToPeakForce', 'Time to Peak Force', 'ms', 'Timing'),
]);

/* DynaMo -- every movement reports the same results per side. */
const dynamoMetrics = (): CatalogMetric[] => uniq([
  M('peakForce', 'Peak Force', 'N'),
  M('peakForceLeft', 'Peak Force (Left)', 'N', 'Left / Right'),
  M('peakForceRight', 'Peak Force (Right)', 'N', 'Left / Right'),
  M('asymmetry', 'Asymmetry', '%', 'Asymmetry'),
  M('peakForceBM', 'Peak Force / BM', 'N/kg'),
  ...SIDES('peakForceBM', 'Peak Force / BM', 'N/kg'),
  ...LR('avgForce', 'Average Force', 'N', 'Force'),
  ...LR('maxRfd', 'Max RFD', 'N/s', 'Rate of Force'),
  ...LR('impulse', 'Impulse', 'N·s', 'Impulse'),
  ...LR('timeToPeakForce', 'Time to Peak Force', 'ms', 'Timing'),
]);

const ROM_METRICS = uniq([
  ...SIDES('irRom', 'IR Range of Motion', '°'),
  ...SIDES('erRom', 'ER Range of Motion', '°'),
  ...SIDES('totalArc', 'Total Arc', '°'),
]);

/** Stored units: jump height cm, power W, power/BM W/kg, impulse N*s,
 *  force N, asymmetry %, durations ms, velocity m/s (med ball mph).
 *  The first metrics of each test keep the keys the default layout uses. */
export const LIFTING_CATALOG: CatalogTest[] = [
  { code: 'CMJ', label: 'Countermovement Jump', source: 'vald:forcedecks', metrics: CMJ_METRICS },
  { code: 'SJ', label: 'Squat Jump', source: 'vald:forcedecks', metrics: SJ_METRICS },
  { code: 'DJ', label: 'Drop Jump', source: 'vald:forcedecks', metrics: DJ_METRICS },
  { code: 'HJ', label: 'Hop Test', source: 'vald:forcedecks', metrics: HOP_METRICS },
  { code: 'SLCMJ', label: 'Single Leg CMJ', source: 'vald:forcedecks', metrics: SL_CMJ_METRICS },
  { code: 'IMTP', label: 'Isometric Mid-Thigh Pull', source: 'vald:forcedecks', metrics: IMTP_METRICS },
  { code: 'PLYO_PUSHUP', label: 'Plyo Push-up', source: 'vald:forcedecks', metrics: PLYO_PUSHUP_METRICS },
  { code: 'PUSHUP', label: 'Push-up', source: 'vald:forcedecks', metrics: PUSHUP_METRICS },
  { code: 'GRIP', label: 'Grip Strength', source: 'vald:dynamo', metrics: dynamoMetrics() },
  { code: 'IR', label: 'Shoulder IR', source: 'vald:dynamo', metrics: dynamoMetrics() },
  { code: 'ER', label: 'Shoulder ER', source: 'vald:dynamo', metrics: dynamoMetrics() },
  { code: 'HIP_ADD', label: 'Hip Adduction', source: 'vald:dynamo', metrics: dynamoMetrics() },
  { code: 'HIP_ABD', label: 'Hip Abduction', source: 'vald:dynamo', metrics: dynamoMetrics() },
  { code: 'SHOULDER_ROM', label: 'Shoulder Range of Motion', source: 'vald:dynamo', metrics: ROM_METRICS },
  {
    code: 'MEDBALL', label: '6 lb Med Ball', source: 'manual',
    metrics: [M('velocity', 'Velocity', 'mph')],
  },
];

/* ── Anything else VALD sends ─────────────────────────────────────────── */

const ACRONYMS = new Set(['rfd', 'rsi', 'bm', 'rom', 'ir', 'er', 'cmj', 'sj', 'dj', 'imtp', 'max', 'avg']);
const SMALL_WORDS = new Set(['to', 'at', 'of', 'ms', 'per']);

/** "eccentricBrakingRfdLeft" -> "Eccentric Braking RFD (Left)". */
export function humanizeMetricKey(key: string): string {
  let side = '';
  let base = key;
  const m = /^(.*?)(Left|Right|Asym)$/.exec(key);
  if (m && m[1]) { base = m[1]; side = m[2]; }
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower === 'max' || lower === 'avg' ? lower[0].toUpperCase() + lower.slice(1) : lower.toUpperCase();
      if (SMALL_WORDS.has(lower)) return lower;
      return w[0].toUpperCase() + w.slice(1);
    });
  const label = words.join(' ');
  if (side === 'Asym') return `${label} Asymmetry`;
  return side ? `${label} (${side})` : label;
}

/** "ISO_SQUAT" -> "Iso Squat" (a test only seen in saved results). */
export function humanizeTestCode(code: string): string {
  return code.split('_').filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0] + w.slice(1).toLowerCase())).join(' ');
}

/** The editor's list: the catalog plus every test and metric that saved
 *  results hold which the catalog doesn't name -- so whatever VALD sends
 *  can be picked for a box, even before this list knows about it. */
export function mergeCatalog(base: CatalogTest[], seen: Map<string, Set<string>>): CatalogTest[] {
  const out = base.map((t) => ({ ...t, metrics: [...t.metrics] }));
  for (const [code, keys] of seen) {
    let t = out.find((x) => x.code === code);
    if (!t) {
      t = { code, label: humanizeTestCode(code), source: 'other', metrics: [] };
      out.push(t);
    }
    const have = new Set(t.metrics.map((m) => m.key));
    const extra = [...keys].filter((k) => !have.has(k)).sort();
    for (const k of extra) t.metrics.push({ key: k, label: humanizeMetricKey(k), unit: '', group: MORE });
  }
  return out;
}

export interface MetricRef { test: string; metric: string }
export interface LiftingKpi {
  id: string;
  label: string;
  /** A metric of the bubble's own test... */
  metric?: string;
  /** ...or a ratio of two metrics (each from its test's latest result). */
  ratio?: { num: MetricRef; den: MetricRef };
  unit: string;
  /** Shown value = stored value x factor (e.g. 0.3937 for cm -> in). */
  factor: number;
  digits: number;
  better: 'high' | 'low' | null;
}
export interface LiftingBubble {
  id: string;
  title: string;
  /** Test code from the catalog (or any code typed results use). */
  test: string;
  /** Optional note under the title, e.g. "Advanced athletes". */
  note?: string;
  kpis: LiftingKpi[];
}
export interface LiftingConfig { version: 1; bubbles: LiftingBubble[] }

const CM_TO_IN = 0.393701;
const kpi = (id: string, label: string, metric: string, unit: string, digits: number, better: LiftingKpi['better'], factor = 1): LiftingKpi =>
  ({ id, label, metric, unit, factor, digits, better });

/** The layout the strength coach asked for (2026-11-16). */
export function defaultLiftingConfig(): LiftingConfig {
  return {
    version: 1,
    bubbles: [
      {
        id: 'cmj', title: 'CMJ', test: 'CMJ',
        kpis: [
          kpi('cmj-jh', 'Jump Height', 'jumpHeight', 'in', 1, 'high', CM_TO_IN),
          kpi('cmj-pp', 'Peak Power', 'peakPower', 'W', 0, 'high'),
          kpi('cmj-ppbm', 'Peak Power / BM', 'peakPowerBM', 'W/kg', 1, 'high'),
          kpi('cmj-asym', 'Peak Power Asymmetry', 'peakPowerAsym', '%', 1, 'low'),
        ],
      },
      {
        id: 'sj', title: 'SJ', test: 'SJ',
        kpis: [
          kpi('sj-jh', 'Jump Height', 'jumpHeight', 'in', 1, 'high', CM_TO_IN),
          kpi('sj-pp', 'Peak Power', 'peakPower', 'W', 0, 'high'),
          kpi('sj-ci', 'Concentric Impulse', 'concentricImpulse', 'N·s', 1, 'high'),
        ],
      },
      {
        id: 'plyo', title: 'Plyo Push-up', test: 'PLYO_PUSHUP', note: 'Advanced athletes',
        kpis: [
          kpi('plyo-imp', 'Impulse', 'impulse', 'N·s', 1, 'high'),
          kpi('plyo-pf', 'Peak Force', 'peakForce', 'N', 0, 'high'),
          kpi('plyo-asym', 'Asymmetry', 'asymmetry', '%', 1, 'low'),
        ],
      },
      {
        id: 'pushup', title: 'Push-up', test: 'PUSHUP', note: 'Novice athletes',
        kpis: [
          kpi('pu-pf', 'Peak Force', 'peakForce', 'N', 0, 'high'),
          kpi('pu-asym', 'Asymmetry', 'asymmetry', '%', 1, 'low'),
        ],
      },
      { id: 'grip', title: 'Grip Strength', test: 'GRIP', kpis: [kpi('grip-pf', 'Peak Force', 'peakForce', 'N', 0, 'high')] },
      { id: 'ir', title: 'IR', test: 'IR', kpis: [kpi('ir-pf', 'Peak Force', 'peakForce', 'N', 0, 'high')] },
      {
        id: 'er', title: 'ER', test: 'ER',
        kpis: [
          kpi('er-pf', 'Peak Force', 'peakForce', 'N', 0, 'high'),
          {
            id: 'er-ir', label: 'ER:IR Ratio', unit: '', factor: 1, digits: 2, better: null,
            ratio: { num: { test: 'ER', metric: 'peakForce' }, den: { test: 'IR', metric: 'peakForce' } },
          },
        ],
      },
      { id: 'medball', title: '6 lb Med Ball', test: 'MEDBALL', kpis: [kpi('mb-velo', 'Velocity', 'velocity', 'mph', 1, 'high')] },
    ],
  };
}

/* ── Validation of a saved layout ─────────────────────────────────────── */

const TEST_RE = /^[A-Z0-9_]{1,30}$/;
const METRIC_RE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

const text = (v: unknown, max: number, what: string, allowEmpty = false): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s && !allowEmpty) throw new Error(`${what} is required`);
  if (s.length > max) throw new Error(`${what} is too long (${max} max)`);
  return s;
};

function ref(v: any, what: string): MetricRef {
  const test = typeof v?.test === 'string' ? v.test.trim().toUpperCase() : '';
  const metric = typeof v?.metric === 'string' ? v.metric.trim() : '';
  if (!TEST_RE.test(test)) throw new Error(`${what}: pick a test`);
  if (!METRIC_RE.test(metric)) throw new Error(`${what}: pick a metric`);
  return { test, metric };
}

/** Check a layout from the editor. Throws an Error naming the problem. */
export function validateLiftingConfig(raw: unknown): LiftingConfig {
  const bubblesIn = (raw as any)?.bubbles;
  if (!Array.isArray(bubblesIn)) throw new Error('Layout needs a list of bubbles');
  if (bubblesIn.length > 30) throw new Error('30 bubbles at most');
  const seen = new Set<string>();
  const bubbles = bubblesIn.map((b: any, bi: number): LiftingBubble => {
    const title = text(b?.title, 60, `Bubble ${bi + 1} name`);
    const test = typeof b?.test === 'string' ? b.test.trim().toUpperCase() : '';
    if (!TEST_RE.test(test)) throw new Error(`"${title}": pick a test`);
    const id = typeof b?.id === 'string' && ID_RE.test(b.id) && !seen.has(b.id) ? b.id : `b${bi}-${Date.now().toString(36)}`;
    seen.add(id);
    if (!Array.isArray(b?.kpis) || !b.kpis.length) throw new Error(`"${title}": add at least one box`);
    if (b.kpis.length > 12) throw new Error(`"${title}": 12 boxes at most`);
    const kseen = new Set<string>();
    const kpis = b.kpis.map((k: any, ki: number): LiftingKpi => {
      const label = text(k?.label, 60, `"${title}" box ${ki + 1} name`);
      const kid = typeof k?.id === 'string' && ID_RE.test(k.id) && !kseen.has(k.id) ? k.id : `${id}-k${ki}`;
      kseen.add(kid);
      const factor = typeof k?.factor === 'number' && Number.isFinite(k.factor) && k.factor > 0 && k.factor < 1e6 ? k.factor : 1;
      const digits = Number.isInteger(k?.digits) && k.digits >= 0 && k.digits <= 4 ? k.digits : 1;
      const better = k?.better === 'high' || k?.better === 'low' ? k.better : null;
      const unit = text(k?.unit, 12, `"${label}" unit`, true);
      if (k?.ratio) {
        return { id: kid, label, unit, factor, digits, better, ratio: { num: ref(k.ratio.num, `"${label}" top`), den: ref(k.ratio.den, `"${label}" bottom`) } };
      }
      const metric = typeof k?.metric === 'string' ? k.metric.trim() : '';
      if (!METRIC_RE.test(metric)) throw new Error(`"${label}": pick a metric`);
      return { id: kid, label, unit, factor, digits, better, metric };
    });
    const note = text(b?.note, 60, `"${title}" note`, true);
    return { id, title, test, ...(note ? { note } : {}), kpis };
  });
  return { version: 1, bubbles };
}

/* ── Typed results ─────────────────────────────────────────────────────── */

/** Check a typed result's metrics: { key: finite number }, 1-30 of them. */
export function validateMetrics(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Enter at least one value');
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!METRIC_RE.test(k)) throw new Error(`Unknown metric "${k}"`);
    if (v === null || v === '' || v === undefined) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || Math.abs(n) > 1e7) throw new Error(`"${k}" must be a number`);
    out[k] = n;
  }
  if (!Object.keys(out).length) throw new Error('Enter at least one value');
  if (Object.keys(out).length > 30) throw new Error('Too many values');
  return out;
}

/** A list of athlete ids for a many-athletes change: unique, 1-300. */
export function validatePlayerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error('Pick at least one athlete');
  const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean))];
  if (!ids.length) throw new Error('Pick at least one athlete');
  if (ids.length > 300) throw new Error('300 athletes at most at once');
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('Unknown athlete');
  return ids;
}

export const TEST_CODE_RE = TEST_RE;
