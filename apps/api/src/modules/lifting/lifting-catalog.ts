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
  /** VALD's decimals / better-direction, used to pre-fill a new box. */
  digits?: number;
  better?: 'high' | 'low' | null;
}
export interface CatalogTest {
  code: string;
  label: string;
  /** Where the result comes from ("other" = only seen in saved results). */
  source: 'vald:forcedecks' | 'vald:dynamo' | 'vald:smartspeed' | 'manual' | 'weight' | 'other';
  metrics: CatalogMetric[];
}

/* Metric groups, in the order the editor lists them (VALD's own result
   groups -- Takeoff, Landing, Eccentric ... -- sort after these). */
export const METRIC_GROUPS = ['Main', 'Left / Right', 'Asymmetry', 'More from results'];
const MORE = 'More from results';

const M = (key: string, label: string, unit: string, digits: number, better: CatalogMetric['better'], group = 'Main'): CatalogMetric =>
  ({ key, label, unit, digits, better, group });

/* What the editor offers before the first VALD pull: the results the default
   layout uses, under VALD's own names and units. A pull adds every result
   VALD sends (VALD names, units, decimals, direction) -- see mergeCatalog. */
const JUMP = [
  M('JUMP_HEIGHT_INCHES_IMP_MOM', 'Jump Height (Imp-Mom) in Inches', 'in', 1, 'high'),
  M('JUMP_HEIGHT_IMP_MOM', 'Jump Height (Imp-Mom)', 'cm', 1, 'high'),
  M('JUMP_HEIGHT_INCHES', 'Jump Height (Flight Time) in Inches', 'in', 1, 'high'),
  M('PEAK_TAKEOFF_POWER', 'Peak Power', 'W', 0, 'high'),
  M('BODYMASS_RELATIVE_TAKEOFF_POWER', 'Peak Power / BM', 'W/kg', 1, 'high'),
  M('CONCENTRIC_IMPULSE', 'Concentric Impulse', 'N s', 1, 'high'),
  M('PEAK_TAKEOFF_FORCE', 'Takeoff Peak Force', 'N', 0, 'high'),
  M('PEAK_TAKEOFF_FORCE_ASYM', 'Takeoff Peak Force Asymmetry', '%', 1, 'low', 'Asymmetry'),
  M('CONCENTRIC_IMPULSE_ASYM', 'Concentric Impulse Asymmetry', '%', 1, 'low', 'Asymmetry'),
];
const SIDES = (key: string, label: string, unit: string, digits: number, better: CatalogMetric['better']) => [
  M(`${key}_LEFT`, `${label} (Left)`, unit, digits, better, 'Left / Right'),
  M(`${key}_RIGHT`, `${label} (Right)`, unit, digits, better, 'Left / Right'),
];
const DYNAMO = [
  ...SIDES('PEAK_FORCE', 'Peak Force', 'N', 0, 'high'),
  M('PEAK_FORCE_ASYM', 'Peak Force Asymmetry', '%', 1, 'low', 'Asymmetry'),
];

/** Body Weight: not a stored test -- its results are the athlete's weight
 *  history (typed in, or ForceDecks weigh-ins from the VALD import). */
export const BODYWEIGHT_TEST = 'BODYWEIGHT';
export const BODYWEIGHT_METRIC = 'WEIGHT_LBS';

export const LIFTING_CATALOG: CatalogTest[] = [
  { code: BODYWEIGHT_TEST, label: 'Body Weight', source: 'weight', metrics: [M(BODYWEIGHT_METRIC, 'Body Weight', 'lb', 0, null)] },
  { code: 'CMJ', label: 'Countermovement Jump', source: 'vald:forcedecks', metrics: JUMP },
  { code: 'SJ', label: 'Squat Jump', source: 'vald:forcedecks', metrics: JUMP },
  {
    code: 'SLJ', label: 'Single Leg Jump', source: 'vald:forcedecks',
    metrics: [...SIDES('JUMP_HEIGHT_INCHES_IMP_MOM', 'Jump Height (Imp-Mom) in Inches', 'in', 1, 'high'), ...SIDES('PEAK_TAKEOFF_POWER', 'Peak Power', 'W', 0, 'high')],
  },
  {
    code: 'PPU', label: 'Plyo Push-up', source: 'vald:forcedecks',
    metrics: [
      M('CONCENTRIC_IMPULSE', 'Concentric Impulse', 'N s', 1, 'high'),
      M('PEAK_TAKEOFF_FORCE', 'Takeoff Peak Force', 'N', 0, 'high'),
      M('PEAK_TAKEOFF_FORCE_ASYM', 'Takeoff Peak Force Asymmetry', '%', 1, 'low', 'Asymmetry'),
    ],
  },
  {
    code: 'PUSHUPT', label: 'Push-up', source: 'vald:forcedecks',
    metrics: [
      M('REPEAT_PEAK_FORCE', 'Peak Force', 'N', 1, 'high'),
      M('REPEAT_PEAK_FORCE_ASYM', 'Peak Force Asymmetry', '%', 1, 'low', 'Asymmetry'),
    ],
  },
  { code: 'GRIP', label: 'Grip Strength', source: 'vald:dynamo', metrics: DYNAMO },
  { code: 'IR_STANDING', label: 'Shoulder IR (Standing)', source: 'vald:dynamo', metrics: DYNAMO },
  { code: 'IR_9090', label: 'Shoulder IR (90/90)', source: 'vald:dynamo', metrics: DYNAMO },
  { code: 'ER_STANDING', label: 'Shoulder ER (Standing)', source: 'vald:dynamo', metrics: DYNAMO },
  { code: 'ER_9090', label: 'Shoulder ER (90/90)', source: 'vald:dynamo', metrics: DYNAMO },
  {
    code: 'MEDBALL', label: '6 lb Med Ball', source: 'manual',
    metrics: [M('velocity', 'Velocity', 'mph', 1, 'high')],
  },
];

/* ── Everything else VALD sends ──────────────────────────────────────── */

const ACRONYMS = new Set(['rfd', 'rsi', 'bm', 'bw', 'rom', 'ir', 'er', 'cmj', 'sj', 'dj', 'imtp', 'max', 'avg', 'ecc', 'con']);
const SMALL_WORDS = new Set(['to', 'at', 'of', 'ms', 'per']);

/** A metric key with no stored name: "eccentricBrakingRfdLeft" or
 *  "ECC_DECEL_RFD_LEFT" -> "Eccentric Braking RFD (Left)" / "Ecc Decel RFD (Left)". */
export function humanizeMetricKey(key: string): string {
  let side = '';
  let base = key;
  const m = /^(.*?)_?(Left|Right|Asym|LEFT|RIGHT|ASYM)$/.exec(key);
  if (m && m[1]) { base = m[1]; side = m[2].charAt(0) + m[2].slice(1).toLowerCase(); }
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
      return lower[0].toUpperCase() + lower.slice(1);
    });
  const label = words.join(' ');
  if (side === 'Asym') return `${label} Asymmetry`;
  return side ? `${label} (${side})` : label;
}

/** "ISO_SQUAT" -> "Iso Squat" (a test only seen in saved results). */
export function humanizeTestCode(code: string): string {
  return code.split('_').filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0] + w.slice(1).toLowerCase())).join(' ');
}

/** Names / units VALD gave each test's metrics on a pull (AppSetting). */
export interface ValdMeta {
  tests: Record<string, { label: string; source: 'vald:forcedecks' | 'vald:dynamo' | 'vald:smartspeed'; metrics: Record<string, { label: string; unit: string; digits: number; better: 'high' | 'low' | null; group?: string }> }>;
}

/** The editor's list: the catalog, plus every test and metric VALD has sent
 *  (with VALD's names and units, from the stored meta), plus any other key
 *  saved results hold -- so whatever VALD sends can be picked for a box.
 *  "__avg" twins are not listed: every box shows the best AND the average. */
export function mergeCatalog(base: CatalogTest[], seen: Map<string, Set<string>>, meta?: ValdMeta | null): CatalogTest[] {
  const out = base.map((t) => ({ ...t, metrics: [...t.metrics] }));
  const ensure = (code: string, label?: string, source?: CatalogTest['source']) => {
    let t = out.find((x) => x.code === code);
    if (!t) {
      t = { code, label: label || humanizeTestCode(code), source: source || 'other', metrics: [] };
      out.push(t);
    }
    return t;
  };
  for (const [code, tm] of Object.entries(meta?.tests || {})) {
    const t = ensure(code, tm.label, tm.source);
    const have = new Set(t.metrics.map((m) => m.key));
    const extra = Object.entries(tm.metrics || {}).filter(([k]) => !have.has(k)).sort((a, b) => a[1].label.localeCompare(b[1].label));
    for (const [k, m] of extra) t.metrics.push({ key: k, label: m.label, unit: m.unit, digits: m.digits, better: m.better, group: m.group || 'Main' });
  }
  for (const [code, keys] of seen) {
    const t = ensure(code);
    const have = new Set(t.metrics.map((m) => m.key));
    const extra = [...keys].filter((k) => !have.has(k) && !k.endsWith('__avg')).sort();
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

const kpi = (id: string, label: string, metric: string, unit: string, digits: number, better: LiftingKpi['better']): LiftingKpi =>
  ({ id, label, metric, unit, factor: 1, digits, better });
const ratio = (id: string, label: string, side: 'LEFT' | 'RIGHT', er: string, ir: string): LiftingKpi => ({
  id, label, unit: '', factor: 1, digits: 2, better: null,
  ratio: { num: { test: er, metric: `PEAK_FORCE_${side}` }, den: { test: ir, metric: `PEAK_FORCE_${side}` } },
});

/** The layout the strength coach asked for (2026-11-16, VALD names 2026-11-17).
 *  Boxes use VALD's own results and units; each shows the session's best and
 *  average. Jump height = Imp-Mom in inches; IR / ER both positions, both arms. */
export function defaultLiftingConfig(): LiftingConfig {
  return {
    version: 1,
    bubbles: [
      { id: 'bodyweight', title: 'Body Weight', test: BODYWEIGHT_TEST, kpis: [kpi('bw', 'Body Weight', BODYWEIGHT_METRIC, 'lb', 0, null)] },
      {
        id: 'cmj', title: 'CMJ', test: 'CMJ',
        kpis: [
          kpi('cmj-jh', 'Jump Height (Imp-Mom)', 'JUMP_HEIGHT_INCHES_IMP_MOM', 'in', 1, 'high'),
          kpi('cmj-pp', 'Peak Power', 'PEAK_TAKEOFF_POWER', 'W', 0, 'high'),
          kpi('cmj-ppbm', 'Peak Power / BM', 'BODYMASS_RELATIVE_TAKEOFF_POWER', 'W/kg', 1, 'high'),
          kpi('cmj-asym', 'Takeoff Peak Force Asymmetry', 'PEAK_TAKEOFF_FORCE_ASYM', '%', 1, 'low'),
        ],
      },
      {
        id: 'sj', title: 'SJ', test: 'SJ',
        kpis: [
          kpi('sj-jh', 'Jump Height (Imp-Mom)', 'JUMP_HEIGHT_INCHES_IMP_MOM', 'in', 1, 'high'),
          kpi('sj-pp', 'Peak Power', 'PEAK_TAKEOFF_POWER', 'W', 0, 'high'),
          kpi('sj-ci', 'Concentric Impulse', 'CONCENTRIC_IMPULSE', 'N s', 1, 'high'),
        ],
      },
      {
        id: 'slj', title: 'Single Leg Jump', test: 'SLJ',
        kpis: [
          kpi('slj-jh-l', 'Jump Height (Left)', 'JUMP_HEIGHT_INCHES_IMP_MOM_LEFT', 'in', 1, 'high'),
          kpi('slj-jh-r', 'Jump Height (Right)', 'JUMP_HEIGHT_INCHES_IMP_MOM_RIGHT', 'in', 1, 'high'),
        ],
      },
      {
        id: 'plyo', title: 'Plyo Push-up', test: 'PPU', note: 'Advanced athletes',
        kpis: [
          kpi('plyo-imp', 'Concentric Impulse', 'CONCENTRIC_IMPULSE', 'N s', 1, 'high'),
          kpi('plyo-pf', 'Takeoff Peak Force', 'PEAK_TAKEOFF_FORCE', 'N', 0, 'high'),
          kpi('plyo-asym', 'Takeoff Peak Force Asymmetry', 'PEAK_TAKEOFF_FORCE_ASYM', '%', 1, 'low'),
        ],
      },
      {
        id: 'pushup', title: 'Push-up', test: 'PUSHUPT', note: 'Novice athletes',
        kpis: [
          kpi('pu-pf', 'Peak Force', 'REPEAT_PEAK_FORCE', 'N', 1, 'high'),
          kpi('pu-asym', 'Peak Force Asymmetry', 'REPEAT_PEAK_FORCE_ASYM', '%', 1, 'low'),
        ],
      },
      {
        id: 'grip', title: 'Grip Strength', test: 'GRIP',
        kpis: [
          kpi('grip-l', 'Peak Force (Left)', 'PEAK_FORCE_LEFT', 'N', 0, 'high'),
          kpi('grip-r', 'Peak Force (Right)', 'PEAK_FORCE_RIGHT', 'N', 0, 'high'),
        ],
      },
      {
        id: 'ir-standing', title: 'IR (Standing)', test: 'IR_STANDING',
        kpis: [
          kpi('irs-l', 'Peak Force (Left)', 'PEAK_FORCE_LEFT', 'N', 0, 'high'),
          kpi('irs-r', 'Peak Force (Right)', 'PEAK_FORCE_RIGHT', 'N', 0, 'high'),
        ],
      },
      {
        id: 'er-standing', title: 'ER (Standing)', test: 'ER_STANDING',
        kpis: [
          kpi('ers-l', 'Peak Force (Left)', 'PEAK_FORCE_LEFT', 'N', 0, 'high'),
          kpi('ers-r', 'Peak Force (Right)', 'PEAK_FORCE_RIGHT', 'N', 0, 'high'),
          ratio('ers-ratio-l', 'ER:IR (Left)', 'LEFT', 'ER_STANDING', 'IR_STANDING'),
          ratio('ers-ratio-r', 'ER:IR (Right)', 'RIGHT', 'ER_STANDING', 'IR_STANDING'),
        ],
      },
      {
        id: 'ir-9090', title: 'IR (90/90)', test: 'IR_9090',
        kpis: [
          kpi('ir9-l', 'Peak Force (Left)', 'PEAK_FORCE_LEFT', 'N', 0, 'high'),
          kpi('ir9-r', 'Peak Force (Right)', 'PEAK_FORCE_RIGHT', 'N', 0, 'high'),
        ],
      },
      {
        id: 'er-9090', title: 'ER (90/90)', test: 'ER_9090',
        kpis: [
          kpi('er9-l', 'Peak Force (Left)', 'PEAK_FORCE_LEFT', 'N', 0, 'high'),
          kpi('er9-r', 'Peak Force (Right)', 'PEAK_FORCE_RIGHT', 'N', 0, 'high'),
          ratio('er9-ratio-l', 'ER:IR (Left)', 'LEFT', 'ER_9090', 'IR_9090'),
          ratio('er9-ratio-r', 'ER:IR (Right)', 'RIGHT', 'ER_9090', 'IR_9090'),
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
