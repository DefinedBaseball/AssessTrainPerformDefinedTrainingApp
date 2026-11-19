import { ParseResult, ParsedMetric } from './base-parser';
import { normalizePitchType } from './trackman-parser';

/**
 * TrackMan session-report PDF — REAL per-pitch data (pure, unit-testable).
 *
 * Newer TrackMan reports carry two things the old summary-only parse ignored:
 *
 *   1. A "Pitches in session" table (page 2+) with one row per pitch — speed,
 *      total spin, tilt, IVB, horizontal break, extension, release height/side,
 *      spin efficiency. The pitch TYPE isn't text: it's the colour of the dot at
 *      the start of each row, decoded through the report's own legends.
 *   2. The page-1 Movement / Location / Release charts drawn as VECTOR dots,
 *      in pitch order. We read each dot's exact position from the PDF drawing
 *      commands and convert it with the chart's own grid lines + axis labels —
 *      no bitmap render, so it's cheap and can't run the 512 MB API out of RAM.
 *
 * Location has no column in the table, so it only exists on the chart. The
 * chart omits pitches TrackMan couldn't locate, so its dots are matched to
 * pitches in order within each pitch type (exact for every coloured type; for
 * a long run of one type, which pitch of that run a dot belongs to can be off
 * by a few — the plotted picture is still exactly the report's).
 */

export interface PdfTextItem { x: number; y: number; t: string; w?: number; h?: number }
/** A filled round dot (top-down coords, PDF points). `color` = "r,g,b". */
export interface PdfDot { x: number; y: number; d: number; color: string }
/** A straight axis-aligned stroked line (top-down coords). */
export interface PdfLine { x0: number; y0: number; x1: number; y1: number; color: string }
export interface PdfPage { items: PdfTextItem[]; dots: PdfDot[]; lines: PdfLine[] }

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const isNumTok = (t: string) => /^[-−]?\d+(?:\.\d+)?$/.test(t);
const numOf = (t: string) => parseFloat(t.replace('−', '-'));
const centreX = (i: PdfTextItem) => i.x + (i.w ?? 0) / 2;
const centreY = (i: PdfTextItem) => i.y - 0.35 * (i.h ?? 7);

/* ── Value parsing ── */

/** `2'1"` → 2.083 · `6'` → 6 · `10"` → 0.833 · `-1'2"` → -1.167 · `-` → null. */
export function parseFtIn(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace('−', '-');
  if (!s || s === '-' || s === '--') return null;
  const m = s.match(/^(-)?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*(?:(\d+(?:\.\d+)?)\s*")?$/);
  if (m && (m[2] != null || m[3] != null)) {
    const v = (m[2] ? parseFloat(m[2]) : 0) + (m[3] ? parseFloat(m[3]) / 12 : 0);
    return m[1] ? -v : v;
  }
  return isNumTok(s) ? numOf(s) : null;
}

/** "12:45" / "1:15" → normalised "H:MM" (1–12), else null. */
export function parseTilt(raw: string | null | undefined): string | null {
  const m = (raw || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  if (h < 0 || h > 12 || mm > 59) return null;
  return `${h === 0 ? 12 : h}:${String(mm).padStart(2, '0')}`;
}

const plainNum = (raw: string): number | null => {
  const s = raw.trim().replace('%', '').replace('−', '-');
  return isNumTok(s) ? numOf(s) : null;
};

/* ── Colour → pitch type (from the report's own legends) ── */

/**
 * Every dot that has a word label just to its right (legends, summary-table
 * rows) votes colour → label. Majority wins per colour.
 */
export function buildColorMap(pages: PdfPage[]): Record<string, string> {
  const votes: Record<string, Record<string, number>> = {};
  for (const pg of pages) {
    for (const d of pg.dots) {
      let best: PdfTextItem | null = null;
      for (const it of pg.items) {
        const dx = it.x - d.x;
        if (dx < 1 || dx > 14 || Math.abs(centreY(it) - d.y) > 4) continue;
        if (!/^[A-Za-z][A-Za-z\- ]{1,24}$/.test(it.t)) continue;
        if (!best || it.x < best.x) best = it;
      }
      if (!best) continue;
      const label = normalizePitchType(best.t);
      (votes[d.color] ||= {})[label] = (votes[d.color][label] || 0) + 1;
    }
  }
  const map: Record<string, string> = {};
  for (const c in votes) map[c] = Object.entries(votes[c]).sort((a, b) => b[1] - a[1])[0][0];
  return map;
}

const typeOf = (color: string, map: Record<string, string>) => map[color] || 'Other';

/* ── "Pitches in session" table ── */

type ColKey = 'speed' | 'spin' | 'tilt' | 'ivb' | 'hb' | 'vb' | 'ext' | 'relH' | 'relS' | 'spinEff' | 'axis';
const HEADER_KEYS: [RegExp, ColKey][] = [
  [/^(pitch\s*speed|velo(city)?|rel(ease)?\.?\s*speed|speed)$/, 'speed'],
  [/^(total\s*spin|spin\s*rate|spin)$/, 'spin'],
  [/^tilt$/, 'tilt'],
  [/^(i\.?\s*vert\.?\s*mov\.?|ivb|induced\s*vert(ical)?\.?\s*(break|mov(ement)?\.?))$/, 'ivb'],
  [/^(horz?\.?\s*mov\.?|horz?(izontal)?\.?\s*break|hb)$/, 'hb'],
  [/^(vert\.?\s*mov\.?|vert(ical)?\.?\s*break|vb)$/, 'vb'],
  [/^(extension|ext\.?)$/, 'ext'],
  [/^(release\s*height|rel\.?\s*h(eight)?\.?)$/, 'relH'],
  [/^(release\s*side|rel\.?\s*side)$/, 'relS'],
  [/^spin\s*eff(iciency|\.)?$/, 'spinEff'],
  [/^spin\s*axis$/, 'axis'],
];
const headerKey = (t: string): ColKey | null => {
  const s = t.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const [re, k] of HEADER_KEYS) if (re.test(s)) return k;
  return null;
};

interface Col { key: ColKey; x: number; unit: string }
export interface TablePitch {
  pitchNo: number;
  pitchType: string;
  relSpeed: number | null; spinRate: number | null; tilt: string | null; spinAxis: number | null;
  inducedVertBreak: number | null; horzBreak: number | null; vertBreak: number | null;
  extension: number | null; relHeight: number | null; relSide: number | null;
  spinEfficiency: number | null;
}

function convert(key: ColKey, raw: string, unit: string): number | string | null {
  const u = unit.toLowerCase();
  if (key === 'tilt') return parseTilt(raw);
  if (key === 'ext' || key === 'relH' || key === 'relS') {
    if (/['"’”′″]/.test(raw)) return parseFtIn(raw);
    const v = plainNum(raw);
    return v == null ? null : u === 'm' ? v * 3.28084 : u === 'cm' ? v / 30.48 : v;
  }
  const v = plainNum(raw);
  if (v == null) return null;
  if (key === 'speed' && /km/.test(u)) return v * 0.621371;
  if ((key === 'ivb' || key === 'hb' || key === 'vb') && u === 'cm') return v / 2.54;
  return v;
}

/** Parse the per-pitch table across every page (header may repeat per page). */
export function parsePitchTable(pages: PdfPage[], colorMap: Record<string, string>): TablePitch[] {
  const out = new Map<number, TablePitch>();
  let cols: Col[] | null = null;
  for (const pg of pages) {
    // Header line = the y with the most recognised column names (≥ 4).
    const hdr = pg.items.map(it => ({ it, key: headerKey(it.t) })).filter(h => h.key);
    const byY = new Map<number, typeof hdr>();
    for (const h of hdr) {
      const yk = [...byY.keys()].find(y => Math.abs(y - h.it.y) < 3) ?? h.it.y;
      (byY.get(yk) || byY.set(yk, []).get(yk)!).push(h);
    }
    const line = [...byY.values()].sort((a, b) => b.length - a.length)[0];
    let headerY = -Infinity;
    if (line && line.length >= 4) {
      headerY = Math.max(...line.map(h => h.it.y));
      cols = line.map(h => {
        // Units sit on the line just below each header name, same x.
        const u = pg.items.find(it => Math.abs(it.x - h.it.x) < 4 && it.y > h.it.y + 3 && it.y < h.it.y + 16);
        return { key: h.key as ColKey, x: h.it.x, unit: u ? u.t : '' };
      });
    }
    if (!cols) continue;
    const rowsOnPage = pg.items.filter(it => /^#\d+$/.test(it.t) && it.y > headerY);
    for (const r of rowsOnPage) {
      const cells = pg.items.filter(it => it !== r && Math.abs(it.y - r.y) < 3 && it.x > r.x + 8);
      const vals: Partial<Record<ColKey, number | string | null>> = {};
      for (const c of cells) {
        let best: Col | null = null, bd = 26;
        for (const col of cols) { const dd = Math.abs(c.x - col.x); if (dd < bd) { bd = dd; best = col; } }
        if (best && vals[best.key] === undefined) vals[best.key] = convert(best.key, c.t, best.unit);
      }
      // Pitch type = colour of the dot just left of "#n" on this row.
      const dot = pg.dots
        .filter(d => d.x < r.x + 2 && r.x - d.x < 30 && Math.abs(d.y - centreY(r)) < 6)
        .sort((a, b) => Math.abs(a.y - centreY(r)) - Math.abs(b.y - centreY(r)))[0];
      const n = parseInt(r.t.slice(1), 10);
      const num = (k: ColKey) => (typeof vals[k] === 'number' ? (vals[k] as number) : null);
      out.set(n, {
        pitchNo: n,
        pitchType: dot ? typeOf(dot.color, colorMap) : 'Other',
        relSpeed: num('speed') != null ? round(num('speed')!, 1) : null,
        spinRate: num('spin') != null ? Math.round(num('spin')!) : null,
        tilt: typeof vals.tilt === 'string' ? vals.tilt : null,
        spinAxis: num('axis'),
        inducedVertBreak: num('ivb') != null ? round(num('ivb')!, 1) : null,
        horzBreak: num('hb') != null ? round(num('hb')!, 1) : null,
        vertBreak: num('vb') != null ? round(num('vb')!, 1) : null,
        extension: num('ext') != null ? round(num('ext')!, 2) : null,
        relHeight: num('relH') != null ? round(num('relH')!, 2) : null,
        relSide: num('relS') != null ? round(num('relS')!, 2) : null,
        spinEfficiency: num('spinEff') != null ? Math.round(num('spinEff')!) : null,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.pitchNo - b.pitchNo);
}

/* ── Vector charts ── */

export interface ChartDot { pitchType: string; x: number; y: number }
export interface TrackmanCharts { movement: ChartDot[]; location: ChartDot[]; release: ChartDot[] }

/** Least-squares value = a·px + b from (px, value) pairs (needs 2 distinct px). */
function fit(pairs: { px: number; v: number }[]): ((px: number) => number) | null {
  const uniq = pairs.filter((p, i) => pairs.findIndex(q => q.v === p.v) === i);
  if (uniq.length < 2) return null;
  const n = uniq.length, sx = uniq.reduce((s, p) => s + p.px, 0), sv = uniq.reduce((s, p) => s + p.v, 0);
  const sxx = uniq.reduce((s, p) => s + p.px * p.px, 0), sxv = uniq.reduce((s, p) => s + p.px * p.v, 0);
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const a = (n * sxv - sx * sv) / den, b = (sv - a * sx) / n;
  if (!isFinite(a) || Math.abs(a) < 1e-6) return null;
  return (px: number) => a * px + b;
}

/**
 * Read one chart: region from its title down to the next chart title in the
 * same column; X calibrated off the bottom label row snapped to vertical grid
 * lines, Y off the right-hand labels snapped to horizontal grid lines.
 */
function readChart(pg: PdfPage, title: PdfTextItem, titles: PdfTextItem[], colorMap: Record<string, string>): ChartDot[] {
  const below = titles.filter(t => t !== title && Math.abs(t.x - title.x) < 40 && t.y > title.y + 20).map(t => t.y);
  const right = titles.filter(t => t.x > title.x + 40).map(t => t.x);
  const rx0 = title.x - 6, rx1 = Math.min(title.x + 290, ...right.map(x => x - 4));
  const ry0 = title.y - 2, ry1 = below.length ? Math.min(...below) - 4 : title.y + 240;
  const inR = (x: number, y: number) => x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
  const vLines = pg.lines.filter(l => Math.abs(l.x1 - l.x0) < 0.5 && l.y1 - l.y0 > 20 && inR(l.x0, (l.y0 + l.y1) / 2));
  const hLines = pg.lines.filter(l => Math.abs(l.y1 - l.y0) < 0.5 && l.x1 - l.x0 > 20 && inR((l.x0 + l.x1) / 2, l.y0));
  if (vLines.length < 2 || hLines.length < 2) return [];
  const plotY0 = Math.min(...vLines.map(l => l.y0)), plotY1 = Math.max(...vLines.map(l => l.y1));
  const plotX0 = Math.min(...hLines.map(l => l.x0)), plotX1 = Math.max(...hLines.map(l => l.x1));
  const nums = pg.items.filter(it => isNumTok(it.t) && inR(it.x, it.y));

  // X labels: the baseline row with the most labels sitting on vertical lines.
  const snapV = (it: PdfTextItem) => vLines.find(l => Math.abs(l.x0 - centreX(it)) < 6);
  const rows = new Map<number, PdfTextItem[]>();
  for (const it of nums) {
    if (!snapV(it)) continue;
    const k = [...rows.keys()].find(y => Math.abs(y - it.y) < 1.5) ?? it.y;
    (rows.get(k) || rows.set(k, []).get(k)!).push(it);
  }
  const xRow = [...rows.values()].sort((a, b) => b.length - a.length)[0] || [];
  const fx = fit(xRow.map(it => ({ px: snapV(it)!.x0, v: numOf(it.t) })));
  // Y labels: right-hand labels centred on a horizontal grid line.
  const yPairs: { px: number; v: number }[] = [];
  for (const it of nums) {
    if (xRow.includes(it) || it.x < plotX1 - 30) continue;
    const l = hLines.find(h => Math.abs(h.y0 - centreY(it)) < 2.5);
    if (l) yPairs.push({ px: l.y0, v: numOf(it.t) });
  }
  const fy = fit(yPairs);
  if (!fx || !fy) return [];

  return pg.dots
    .filter(d => d.d >= 3 && d.d <= 14 && d.x >= plotX0 - 8 && d.x <= plotX1 + 8 && d.y >= plotY0 - 8 && d.y <= plotY1 + 8 && inR(d.x, d.y))
    .map(d => ({ pitchType: typeOf(d.color, colorMap), x: round(fx(d.x), 2), y: round(fy(d.y), 2) }));
}

export function readTrackmanCharts(pages: PdfPage[], colorMap: Record<string, string>): TrackmanCharts {
  const res: TrackmanCharts = { movement: [], location: [], release: [] };
  for (const pg of pages) {
    const titles = pg.items.filter(it => /^(movement|location|release)$/i.test(it.t));
    for (const t of titles) {
      const key = t.t.toLowerCase() as keyof TrackmanCharts;
      if (res[key].length) continue;
      try { res[key] = readChart(pg, t, titles, colorMap); } catch { res[key] = []; }
    }
  }
  return res;
}

/**
 * Match chart dots to pitches. Same length + same type sequence → 1:1 by
 * index. Otherwise walk both in order, each dot taking the next pitch of its
 * type (charts skip pitches they couldn't plot, e.g. untracked locations).
 */
export function alignDots<T extends { pitchType: string }>(pitches: { pitchType: string }[], dots: T[]): (T | null)[] {
  const res: (T | null)[] = pitches.map(() => null);
  if (dots.length === pitches.length && dots.every((d, i) => d.pitchType === pitches[i].pitchType)) {
    dots.forEach((d, i) => { res[i] = d; });
    return res;
  }
  let i = 0;
  for (const d of dots) {
    let j = i;
    while (j < pitches.length && (res[j] || pitches[j].pitchType !== d.pitchType)) j++;
    if (j >= pitches.length) { j = pitches.findIndex((p, k) => !res[k] && p.pitchType === d.pitchType); if (j < 0) continue; }
    else i = j + 1;
    res[j] = d;
  }
  return res;
}

/* ── Result ── */

/**
 * Build the ParseResult from the per-pitch table + charts. Returns null when
 * the PDF has no per-pitch table (caller falls back to the summary table).
 */
export function buildTrackmanPdfPerPitch(pages: PdfPage[], recordedAt: Date, playerName = 'TrackMan PDF'): ParseResult | null {
  const colorMap = buildColorMap(pages);
  const table = parsePitchTable(pages, colorMap).filter(p => p.relSpeed != null);
  if (!table.length) return null;
  const charts = readTrackmanCharts(pages, colorMap);
  const locs = alignDots(table, charts.location);
  const rels = alignDots(table, charts.release);
  const movs = alignDots(table, charts.movement);

  const success: ParsedMetric[] = [];
  const pitches: Record<string, any>[] = [];
  table.forEach((t, i) => {
    const pitch = {
      pitchType: t.pitchType,
      relSpeed: t.relSpeed,
      spinRate: t.spinRate,
      spinAxis: t.spinAxis,
      tilt: t.tilt,
      // Release: the chart's dot is signed + finer than the table's whole inches.
      relHeight: rels[i] ? rels[i]!.y : t.relHeight,
      relSide: rels[i] ? rels[i]!.x : t.relSide,
      extension: t.extension,
      vertBreak: t.vertBreak,
      // Movement: the table's 0.1" values are authoritative; chart fills gaps.
      inducedVertBreak: t.inducedVertBreak ?? (movs[i] ? round(movs[i]!.y, 1) : null),
      horzBreak: t.horzBreak ?? (movs[i] ? round(movs[i]!.x, 1) : null),
      plateLocHeight: locs[i] ? locs[i]!.y : null,
      plateLocSide: locs[i] ? locs[i]!.x : null,
      spinEfficiency: t.spinEfficiency,
      zoneSpeed: null, effectiveVelo: null,
      vertApprAngle: null, horzApprAngle: null,
      pitchCall: null, pitchNo: t.pitchNo, pitcherThrows: null,
      pdfSource: true,
      pdfPerPitch: true,   // real per-pitch values (vs. the summary-table rebuild)
    };
    pitches.push(pitch);
    success.push({ playerName, metricType: 'trackman_pitch', value: pitch.relSpeed as number, unit: 'mph', recordedAt, rawData: pitch });
  });
  pushAggregates(success, pitches, recordedAt, playerName);
  return { success, errors: [], totalRows: pitches.length };
}

/** Aggregate summary metrics — same set the CSV parser emits, for parity. */
export function pushAggregates(success: ParsedMetric[], pitches: Record<string, any>[], recordedAt: Date, playerName: string) {
  if (!pitches.length) return;
  const agg = (metricType: string, value: number, unit: string, count: number) =>
    success.push({ playerName, metricType, value, unit, recordedAt, rawData: { source: 'trackman_pdf_aggregate', pitchCount: count } });
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const vals = (list: Record<string, any>[], k: string) => list.map(p => p[k]).filter((x): x is number => typeof x === 'number' && isFinite(x));
  const fb = vals(pitches.filter(p => ['Fastball', 'Sinker', 'Cutter'].includes(p.pitchType)), 'relSpeed');
  if (fb.length) {
    agg('fb_max_velo', round(Math.max(...fb), 2), 'mph', fb.length);
    agg('fb_avg_velo', round(mean(fb), 2), 'mph', fb.length);
  }
  const spins = vals(pitches, 'spinRate');
  if (spins.length) agg('spin_rate', Math.round(mean(spins)), 'rpm', spins.length);
  const hb = vals(pitches, 'horzBreak');
  if (hb.length) agg('h_break', round(mean(hb), 2), 'in', hb.length);
  const ivb = vals(pitches, 'inducedVertBreak');
  if (ivb.length) agg('v_break', round(mean(ivb), 2), 'in', ivb.length);
  const rh = vals(pitches, 'relHeight');
  if (rh.length) agg('release_height', round(mean(rh), 2), 'ft', rh.length);
  const ex = vals(pitches, 'extension');
  if (ex.length) agg('extension', round(mean(ex), 2), 'ft', ex.length);
}
