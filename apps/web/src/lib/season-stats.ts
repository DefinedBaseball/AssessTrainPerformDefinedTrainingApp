/* Season stats — the Player Summary "Stats" sub-tab.

   Typed in by the athlete or a coach, one row per school-year season, in up
   to four grids (Hitting / Pitching / Defense / Catching). Stored as one JSON
   blob on the Player row (`seasonStats`):

     { hitting:  { "2026": { "GP": "12", "AB": "40", ... }, ... },
       pitching: { ... }, defense: { ... }, catching: { ... } }

   Season keys are the START year of the school year ("2026" = 2026-27).
   Values are kept exactly as typed (".313", "45.1", "3/10", "48%"); the
   rate stats in CALCULATED fill in from the counting stats when their box
   is left blank, and a typed value always wins. The API keeps its own copy
   of the grid/stat keys (players.service.ts) -- keep the two in step. */

export type StatGridKey = 'hitting' | 'pitching' | 'defense' | 'catching';
export type SeasonRow = Record<string, string>;
export type GridStats = Record<string, SeasonRow>;
export type SeasonStats = Partial<Record<StatGridKey, GridStats>>;

export interface StatColumn { key: string; label: string; title: string; numeric?: boolean }

const c = (key: string, title: string, label = key): StatColumn => ({ key, label, title });

export const STAT_GRIDS: { key: StatGridKey; title: string; columns: StatColumn[] }[] = [
  {
    key: 'hitting',
    title: 'Hitting',
    columns: [
      c('GP', 'Games Played'), c('PA', 'Plate Appearances'), c('AB', 'At Bats'),
      c('AVG', 'Batting Average'), c('OBP', 'On-Base Percentage'), c('OPS', 'On-Base + Slugging'),
      c('SLG', 'Slugging Percentage'), c('H', 'Hits'), c('1B', 'Singles'), c('2B', 'Doubles'),
      c('3B', 'Triples'), c('HR', 'Home Runs'), c('RBI', 'Runs Batted In'), c('R', 'Runs'),
      c('BB', 'Walks'), c('K', 'Strikeouts'), c('HBP', 'Hit by Pitch'), c('SB', 'Stolen Bases'),
      c('CS', 'Caught Stealing'), c('SB%', 'Stolen Base Percentage'), c('LOB', 'Left on Base'),
      c('BABIP', 'Batting Average on Balls in Play'), c('GB%', 'Ground Ball Percentage'),
      c('LD%', 'Line Drive Percentage'), c('FB%', 'Fly Ball Percentage'),
      c('QAB%', 'Quality At-Bat Percentage'),
    ],
  },
  {
    key: 'pitching',
    title: 'Pitching',
    columns: [
      c('IP', 'Innings Pitched'), c('GP', 'Games Played'), c('H', 'Hits'), c('HR', 'Home Runs'),
      c('R', 'Runs'), c('ER', 'Earned Runs'), c('BB', 'Walks'), c('K', 'Strikeouts'),
      c('HBP', 'Hit by Pitch'), c('ERA', 'Earned Run Average'), c('WHIP', 'Walks + Hits per Inning Pitched'),
      c('BAA', 'Batting Average Against'), c('FIP', 'Fielding Independent Pitching'),
      c('S%', 'Strike Percentage'), c('FPS%', 'First-Pitch Strike Percentage'),
      c('FB%', 'Fly Ball Percentage'), c('LD%', 'Line Drive Percentage'),
      c('GB%', 'Ground Ball Percentage'), c('BABIP', 'Batting Average on Balls in Play'),
    ],
  },
  {
    key: 'defense',
    title: 'Defense',
    columns: [
      c('TC', 'Total Chances'), c('A', 'Assists'), c('PO', 'Putouts'),
      c('FLD%', 'Fielding Percentage'), c('E', 'Errors'), c('DP', 'Double Plays'),
    ],
  },
  {
    key: 'catching',
    title: 'Catching',
    columns: [
      c('INN', 'Innings Caught'), c('PB', 'Passed Balls'), c('WP', 'Wild Pitches'),
      c('SB/ATT', 'Stolen Bases / Attempts'), c('CS', 'Caught Stealing'),
      c('CS%', 'Caught Stealing Percentage'), c('PIK', 'Runners Picked Off'),
      c('CI', "Catcher's Interference"),
    ],
  },
];

/* ── Seasons ─────────────────────────────────────────────────────────────
   A season runs on the school year: it starts on the first Monday on or
   after August 13 and ends the day before the next one starts --
   2026-27 = Aug 17 2026 → Aug 15 2027, 2027-28 starts Aug 16 2027,
   2028-29 starts Aug 14 2028, 2029-30 starts Aug 13 2029. */
export const SEASON_START_EARLIEST_DAY = 13; // August 13

export function seasonStartDate(startYear: number): Date {
  const d = new Date(startYear, 7, SEASON_START_EARLIEST_DAY);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
}

/** Start year of the season `date` falls in. */
export function seasonForDate(date: Date = new Date()): number {
  const y = date.getFullYear();
  return date >= seasonStartDate(y) ? y : y - 1;
}

export function seasonLabel(startYear: number | string): string {
  const y = Number(startYear);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/* ── Typed values ─────────────────────────────────────────────────────── */

/** Characters a stat box accepts: digits, ".", "%", "/" and "-". */
export function sanitizeStatInput(raw: string): string {
  return raw.replace(/[^0-9.%/\-]/g, '').slice(0, 10);
}

function num(row: SeasonRow, key: string): number | null {
  const raw = (row[key] ?? '').replace('%', '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Innings in baseball notation: 45.1 = 45⅓, 45.2 = 45⅔. */
function innings(row: SeasonRow, key: string): number | null {
  const raw = (row[key] ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d+)(?:\.([012]))?$/);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 3 : 0);
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const avg3 = (x: number) => (x >= 1 ? x.toFixed(3) : x.toFixed(3).replace(/^0/, ''));
const dec2 = (x: number) => x.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ok = (x: number | null): x is number => x !== null && Number.isFinite(x);

/* Rate stats that fill in from the counting stats when left blank. */
const CALCULATED: Record<StatGridKey, Record<string, (r: SeasonRow) => string | null>> = {
  hitting: {
    AVG: (r) => {
      const h = num(r, 'H'), ab = num(r, 'AB');
      return ok(h) && ok(ab) && ab > 0 ? avg3(h / ab) : null;
    },
    OBP: (r) => {
      const h = num(r, 'H'), ab = num(r, 'AB');
      if (!ok(h) || !ok(ab)) return null;
      const bb = num(r, 'BB') ?? 0, hbp = num(r, 'HBP') ?? 0;
      const den = ab + bb + hbp;
      return den > 0 ? avg3((h + bb + hbp) / den) : null;
    },
    SLG: (r) => {
      const tb = totalBases(r), ab = num(r, 'AB');
      return ok(tb) && ok(ab) && ab > 0 ? avg3(tb / ab) : null;
    },
    OPS: (r) => {
      const obp = Number(statValue('hitting', 'OBP', r).value);
      const slg = Number(statValue('hitting', 'SLG', r).value);
      const both = statValue('hitting', 'OBP', r).value && statValue('hitting', 'SLG', r).value;
      return both && Number.isFinite(obp) && Number.isFinite(slg) ? avg3(obp + slg) : null;
    },
    /* The academy's definition: H / (AB − K). */
    BABIP: (r) => {
      const h = num(r, 'H'), ab = num(r, 'AB'), k = num(r, 'K');
      if (!ok(h) || !ok(ab) || !ok(k)) return null;
      const den = ab - k;
      return den > 0 ? avg3(h / den) : null;
    },
    'SB%': (r) => {
      const sb = num(r, 'SB'), cs = num(r, 'CS');
      if (!ok(sb)) return null;
      const att = sb + (cs ?? 0);
      return att > 0 ? pct(sb / att) : null;
    },
  },
  pitching: {
    ERA: (r) => {
      const er = num(r, 'ER'), ip = innings(r, 'IP');
      return ok(er) && ok(ip) && ip > 0 ? dec2((er * 9) / ip) : null;
    },
    WHIP: (r) => {
      const h = num(r, 'H'), bb = num(r, 'BB'), ip = innings(r, 'IP');
      return ok(h) && ok(ip) && ip > 0 ? dec2((h + (bb ?? 0)) / ip) : null;
    },
  },
  defense: {
    'FLD%': (r) => {
      const po = num(r, 'PO'), a = num(r, 'A'), e = num(r, 'E');
      if (!ok(po) && !ok(a)) return null;
      const good = (po ?? 0) + (a ?? 0);
      const tc = good + (e ?? 0);
      return tc > 0 ? avg3(good / tc) : null;
    },
  },
  catching: {
    'CS%': (r) => {
      const cs = num(r, 'CS');
      const m = (r['SB/ATT'] ?? '').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
      if (!ok(cs) || !m) return null;
      const att = Number(m[2]);
      return att > 0 ? pct(cs / att) : null;
    },
  },
};

/** Singles = H − 2B − 3B − HR when 1B is blank. */
function totalBases(r: SeasonRow): number | null {
  const d = num(r, '2B') ?? 0, t = num(r, '3B') ?? 0, hr = num(r, 'HR') ?? 0;
  let s = num(r, '1B');
  if (!ok(s)) {
    const h = num(r, 'H');
    if (!ok(h)) return null;
    s = h - d - t - hr;
    if (s < 0) return null;
  }
  return s + 2 * d + 3 * t + 4 * hr;
}

export function isCalculated(grid: StatGridKey, key: string): boolean {
  return !!CALCULATED[grid][key];
}

/** What a cell shows: the typed value, or the calculated one when blank. */
export function statValue(grid: StatGridKey, key: string, row: SeasonRow): { value: string; calculated: boolean } {
  const typed = (row[key] ?? '').trim();
  if (typed) return { value: typed, calculated: false };
  const calc = CALCULATED[grid][key]?.(row) ?? null;
  return calc ? { value: calc, calculated: true } : { value: '', calculated: false };
}

/** Parse the stored blob; anything malformed reads as empty. */
export function parseSeasonStats(raw: string | null | undefined): SeasonStats {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Drop blank values and seasons with nothing typed in them. */
export function cleanSeasonStats(stats: SeasonStats): SeasonStats {
  const out: SeasonStats = {};
  for (const g of STAT_GRIDS) {
    const seasons = stats[g.key] ?? {};
    const kept: GridStats = {};
    for (const [season, row] of Object.entries(seasons)) {
      const vals: SeasonRow = {};
      for (const col of g.columns) {
        const v = (row?.[col.key] ?? '').trim();
        if (v) vals[col.key] = v;
      }
      if (Object.keys(vals).length) kept[season] = vals;
    }
    if (Object.keys(kept).length) out[g.key] = kept;
  }
  return out;
}

/** Grids an athlete gets, by position -- the same rule as the profile tabs
 *  (Hitting for anyone who isn't only a pitcher). */
export function gridsForPositions(positions: string | null | undefined): StatGridKey[] {
  const list = (positions || '').split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return ['hitting'];
  const out: StatGridKey[] = [];
  if (list.some((p) => p !== 'P')) out.push('hitting');
  if (list.includes('P')) out.push('pitching');
  if (list.some((p) => ['1B', '2B', '3B', 'SS', 'INF', 'LF', 'CF', 'RF', 'OF'].includes(p))) out.push('defense');
  if (list.includes('C')) out.push('catching');
  return out;
}
