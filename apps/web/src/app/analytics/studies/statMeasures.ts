/* ─────────────────────────────────────────────────────────────────────────
   Season stats as Studies / Comparison measures: "stat:<grid>:<key>",
   e.g. stat:hitting:AVG. One point per athlete per season, dated the
   season's start (first Monday on or after Aug 13). The value is what the
   Stats sheet shows -- typed, or calculated from the counting stats when
   left blank (lib/season-stats statValue), so the formulas live in one place.
   ───────────────────────────────────────────────────────────────────────── */
import type { StudyData, StudyMeasure, StudyPoint } from '@/lib/api';
import { STAT_GRIDS, parseSeasonStats, seasonStartDate, statValue, type StatGridKey } from '@/lib/season-stats';

/* Lower is better for these (per grid). */
const LOWER: Record<StatGridKey, Set<string>> = {
  hitting: new Set(['K', 'CS', 'LOB']),
  pitching: new Set(['H', 'HR', 'R', 'ER', 'BB', 'HBP', 'ERA', 'WHIP', 'BAA', 'FIP', 'BABIP', 'LD%', 'FB%']),
  defense: new Set(['E']),
  catching: new Set(['PB', 'WP', 'CI']),
};
/* No better direction (volume / mix). */
const NEUTRAL = new Set(['GP', 'PA', 'AB', 'IP', 'TC', 'INN', 'GB%', 'SB/ATT']);
const THREE = new Set(['AVG', 'OBP', 'OPS', 'SLG', 'BABIP', 'BAA', 'FLD%']);
const TWO = new Set(['ERA', 'WHIP', 'FIP']);
const TEXT_ONLY = new Set(['SB/ATT']);

const GRID_TITLE: Record<StatGridKey, string> = { hitting: 'Hitting', pitching: 'Pitching', defense: 'Defense', catching: 'Catching' };

export function statMeasures(): StudyMeasure[] {
  return STAT_GRIDS.flatMap((g) => g.columns.filter((c) => !TEXT_ONLY.has(c.key)).map((c) => ({
    id: `stat:${g.key}:${c.key}`,
    label: `${c.key === c.title ? c.key : `${c.title} (${c.key})`}`,
    unit: c.key.endsWith('%') ? '%' : '',
    group: `Season Stats · ${GRID_TITLE[g.key]}`,
    better: NEUTRAL.has(c.key) ? null : LOWER[g.key].has(c.key) ? 'low' as const : 'high' as const,
    digits: THREE.has(c.key) ? 3 : TWO.has(c.key) ? 2 : c.key === 'IP' ? 1 : 0,
  })));
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "48%" -> 48, ".313" -> 0.313, IP "45.1" -> 45.33 (baseball thirds). */
function toNumber(key: string, raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  if (key === 'IP' || key === 'INN') {
    const m = v.match(/^(\d+)(?:\.([012]))?$/);
    if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 3 : 0);
  }
  const n = Number(v.replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

/** Fill series[stat:...] from the athletes' Stats sheets (sent by the API when a stat measure is asked for). */
export function fillStatSeries(data: StudyData, ids: string[]): StudyData {
  const wanted = ids.filter((id) => id.startsWith('stat:'));
  if (!wanted.length) return data;
  const series = { ...data.series };
  for (const id of wanted) {
    const [, grid, key] = id.split(':') as [string, StatGridKey, string];
    const pts: StudyPoint[] = [];
    data.athletes.forEach((a, i) => {
      const sheet = parseSeasonStats(a.seasonStats ?? null)[grid] ?? {};
      for (const [season, row] of Object.entries(sheet)) {
        const year = Number(season);
        if (!Number.isInteger(year)) continue;
        const v = toNumber(key, statValue(grid, key, row || {}).value);
        if (v != null) pts.push([i, iso(seasonStartDate(year)), v]);
      }
    });
    pts.sort((x, y) => x[0] - y[0] || x[1].localeCompare(y[1]));
    series[id] = pts;
  }
  return { ...data, series };
}
