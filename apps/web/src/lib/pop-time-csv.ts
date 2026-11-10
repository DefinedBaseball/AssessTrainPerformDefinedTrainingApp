/**
 * Read a catcher pop-time CSV (the throw-down device export):
 *
 *   #, Date, Time Stamp, Pitch, Throw, Pop, Exchg, Res, +/- Sec, Catcher
 *   1, 11/7/2026 09:24:10.867, 0:0:0.000, 30.8, 68.6, 2.10, 0.63, Safe, 0.09, Nolan
 *
 * Returns one entry per throw, in file order: pop time (s), exchange (s) and
 * throw velocity (mph), as the text the file had. Columns are found by
 * header name (case / spacing ignored), so a re-ordered export still reads.
 * Rows with no usable pop time (0.00 -- a misfire) are skipped and counted.
 */
export interface PopTimeThrow { pop: string; exchange: string; velocity: string }
export interface PopTimeCsv { throws: PopTimeThrow[]; skipped: number; catcher: string | null }

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

export function parsePopTimeCsv(text: string): PopTimeCsv {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('That file has no throws in it.');
  const header = splitCsvLine(lines[0]).map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const popI = col('pop', 'poptime', 'pop2b', 'poptime2b');
  const exI = col('exchg', 'exchange', 'exchangetime', 'exch', 'transfer');
  const veloI = col('throw', 'throwvelo', 'velocity', 'velo', 'armstrength', 'throwvelocity');
  const catcherI = col('catcher', 'player', 'name');
  if (popI < 0) throw new Error('No "Pop" column found -- is this a pop-time CSV?');

  const throws: PopTimeThrow[] = [];
  let skipped = 0;
  let catcher: string | null = null;
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const pop = c[popI] ?? '';
    const popN = parseFloat(pop);
    if (!Number.isFinite(popN) || popN <= 0) { skipped++; continue; }
    const pick = (i: number) => {
      if (i < 0) return '';
      const v = c[i] ?? '';
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? v : '';
    };
    throws.push({ pop, exchange: pick(exI), velocity: pick(veloI) });
    if (!catcher && catcherI >= 0 && c[catcherI]) catcher = c[catcherI];
  }
  if (throws.length === 0) throw new Error('No throws with a pop time were found in that file.');
  return { throws, skipped, catcher };
}

/**
 * One throwing metric with a CSV beside the typed attempts (HitTrax rule):
 *   - AVG is the CSV's average when the CSV has readings;
 *   - the best is the better of the CSV's and the typed best
 *     (lowest for pop / exchange, highest for velocity);
 *   - with no CSV readings, the typed numbers stand as before.
 * `typedWins` says the typed number beat the CSV's (shown as "(typed)").
 */
export function mergeTypedWithCsv(
  typedBest: number | null,
  typedAvg: number | null,
  csvValues: number[],
  higherIsBetter: boolean,
  digits: number,
): { best: number | null; avg: number | null; typedWins: boolean } {
  const vals = csvValues.filter((n) => Number.isFinite(n) && n > 0);
  if (vals.length === 0) return { best: typedBest, avg: typedAvg, typedWins: false };
  const csvBest = higherIsBetter ? Math.max(...vals) : Math.min(...vals);
  const typedWins = typedBest != null && (higherIsBetter ? typedBest > csvBest : typedBest < csvBest);
  return {
    best: typedWins ? typedBest : csvBest,
    avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(digits),
    typedWins,
  };
}
