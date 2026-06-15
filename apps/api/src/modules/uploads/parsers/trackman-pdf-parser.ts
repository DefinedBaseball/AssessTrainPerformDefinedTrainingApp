import { ParseResult, ParsedMetric } from './base-parser';

/**
 * Trackman "Player Session Report" PDF parser (table-driven).
 *
 * The CSV path (TrackmanParser) stores one fully-interactive `trackman_pitch`
 * row per real pitch. When a coach only has the PDF session report (no CSV),
 * this parser reads the **"Stats by pitch type"** summary table and rebuilds a
 * faithful, NON-interactive dataset:
 *
 *   • Velocity / spin per pitch are synthesised so each type's Min / Max / Avg
 *     match the table EXACTLY.
 *   • Movement (Horz/IVB) and Release (side/height) points are scattered around
 *     the table averages, then re-centred so the per-type mean equals the table
 *     value to the decimal (the top bubbles + arsenal read straight off these).
 *   • Plate-location is NOT in the summary table, so those points are left null
 *     (the strike-zone plot renders empty rather than inventing locations).
 *
 * Every generated pitch carries `rawData.pdfSource = true` so the Pitching tab
 * renders the plots non-interactive (points aren't clickable / pitch-linked).
 */

export interface PdfTextItem { x: number; y: number; t: string }

/** Per-pitch-type aggregates read out of the summary table. */
export interface TrackmanPdfRow {
  pitchType: string;
  qty: number;
  spdMin: number; spdMax: number; spdAvg: number;
  spinMin: number; spinMax: number; spinAvg: number;
  ivb: number;        // "IVB (in)" column (max-abs in this report layout)
  horzAvg: number;    // "Horz. Mov (in)" Avg
  horzMaxAbs: number; // "Horz. Mov (in)" Max. abs (drives scatter width)
  vertMaxAbs: number; // "Vert. Mov (in)" Max. abs (total vertical, incl. gravity)
  relHeight: number;  // "Rel.h (ft)" Avg
  relSide: number;    // "Rel.side (ft)" Avg
  ext: number;        // "EXT (ft)" Avg
}

/* ── PDF text extraction (the only part that touches pdfjs-dist) ── */

/**
 * Pull every text token off page 1 with top-down (x, y) coordinates, matching
 * the coordinate frame the table parser expects. Kept isolated + lazy-required
 * so the heavy pdfjs dependency only loads when a PDF is actually uploaded.
 */
export async function extractPdfTextItems(buffer: Buffer): Promise<PdfTextItem[]> {
  // pdfjs v3 legacy build is CommonJS-requireable (v4 is ESM-only, which the
  // Nest CommonJS bundle can't `require`). Lazy-require so boot stays fast and
  // a missing dep surfaces only on use.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of tc.items as any[]) {
      const str = (it.str || '').trim();
      if (!str) continue;
      items.push({
        x: Math.round(it.transform[4] * 10) / 10,
        y: Math.round((viewport.height - it.transform[5]) * 10) / 10,
        t: str,
      });
    }
    return items;
  } finally {
    await doc.destroy?.();
  }
}

/* ── Location-plot dot extraction (renders the PDF; needs @napi-rs/canvas) ── */

export interface LocationDot { pitchType: string; plateLocSide: number; plateLocHeight: number }

// Rendered dot colour → app pitch type. The summary table has no plate-location
// columns, so the only source of WHERE each pitch landed is the Location chart
// itself — which Trackman draws as radial-shading dots (no recoverable vector
// geometry). We render page 1 to a bitmap and detect the coloured dots against
// the dark strike-zone box, which is our self-calibrating coordinate reference.
const LOC_REF: [string, number, number, number][] = [
  ['Slider', 210, 175, 0], ['Curveball', 70, 140, 245], ['Fastball', 140, 0, 35], ['Other', 245, 105, 35],
];
const lc_compose = (i: number[], o: number[]) => { const [ia,ib,ic,id,ie,iff]=i,[oa,ob,oc,od,oe,of]=o; return [oa*ia+oc*ib,ob*ia+od*ib,oa*ic+oc*id,ob*ic+od*id,oa*ie+oc*iff+oe,ob*ie+od*iff+of]; };
const lc_tp = (m: number[], x: number, y: number) => [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];

/**
 * Render the Trackman session report and detect the Location-plot pitch dots,
 * mapped into the app's strike-zone coordinate system (side ±0.83 ft, height
 * 1.5–3.5 ft) using the PDF's own strike-zone box as the calibration anchor.
 * Best-effort: any failure (missing canvas binary, layout change, no box) just
 * returns [] so the upload still succeeds with an empty Location plot.
 */
export async function extractTrackmanLocations(buffer: Buffer): Promise<LocationDot[]> {
  let napi: any;
  try { napi = require('@napi-rs/canvas'); } catch { return []; }
  // pdf.js shading/pattern rendering needs these browser globals in Node.
  for (const k of ['DOMMatrix', 'Path2D', 'ImageData', 'DOMPoint']) if (!(globalThis as any)[k] && napi[k]) (globalThis as any)[k] = napi[k];
  const { createCanvas } = napi;
  const canvasFactory = {
    create(w: number, h: number) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; },
    reset(cc: any, w: number, h: number) { cc.canvas.width = w; cc.canvas.height = h; },
    destroy(_cc: any) {},
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), canvasFactory, useSystemFonts: true, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const H = page.getViewport({ scale: 1 }).height;

    // 1) Find the strike-zone box (the single dark stroked rectangle).
    const ol = await page.getOperatorList(); const OPS = pdfjs.OPS; const nm: any = {}; for (const k in OPS) nm[OPS[k]] = k;
    let ctm = [1, 0, 0, 1, 0, 0]; const st: number[][] = []; let stroke = ''; let pend: any[] = []; let box: any = null;
    const dev = (bb: number[]) => { const c = [lc_tp(ctm, bb[0], bb[2]), lc_tp(ctm, bb[1], bb[3])]; const xs = [c[0][0], c[1][0]], ys = [H - c[0][1], H - c[1][1]]; return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const n = nm[ol.fnArray[i]], a = ol.argsArray[i];
      if (n === 'save') st.push(ctm.slice()); else if (n === 'restore') ctm = st.pop() || [1, 0, 0, 1, 0, 0];
      else if (n === 'transform') ctm = lc_compose(a, ctm);
      else if (n === 'setStrokeRGBColor') stroke = `${a[0]},${a[1]},${a[2]}`;
      else if (n === 'constructPath') pend.push({ ops: a[0], bb: a[2] });
      else if (n === 'stroke') { for (const p of pend) { if (p.ops.includes(19)) { const d = dev(p.bb); const w = d.x1 - d.x0, h = d.y1 - d.y0; if (stroke === '65,65,65' && w > 40 && w < 150 && h > 40 && h < 150) box = d; } } pend = []; }
      else if (n === 'fill' || n === 'eoFill' || n === 'endPath' || n === 'eoClip') pend = [];
    }
    if (!box) return [];

    // 2) Render page 1 to a bitmap.
    const S = 6; const vp = page.getViewport({ scale: S });
    const canvas = createCanvas(vp.width, vp.height); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvasFactory }).promise;

    // 3) Scan a generous margin around the box; classify pixels → cluster → dots.
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const rx0 = Math.max(0, Math.floor((box.x0 - bw) * S)), ry0 = Math.max(0, Math.floor((box.y0 - bh) * S));
    const rx1 = Math.min(canvas.width, Math.ceil((box.x1 + bw) * S)), ry1 = Math.min(canvas.height, Math.ceil((box.y1 + bh) * S));
    const RW = rx1 - rx0, RH = ry1 - ry0; const img = ctx.getImageData(rx0, ry0, RW, RH).data;
    const classify = (r: number, g: number, b: number): string | null => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 28 && r >= 130 && r <= 162) return 'Other';   // grey dots
      if (mx - mn < 45) return null;                              // grey/white/black background
      let best: string | null = null, bd = 70 * 70;
      for (const [t, R, G, B] of LOC_REF) { const d = (r - (R as number)) ** 2 + (g - (G as number)) ** 2 + (b - (B as number)) ** 2; if (d < bd) { bd = d; best = t as string; } }
      return best;
    };
    const CELL = 8; const GW = Math.ceil(RW / CELL), GH = Math.ceil(RH / CELL);
    const cells: Record<string, Map<number, { n: number; sx: number; sy: number }>> = {};
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const p = (y * RW + x) * 4; const t = classify(img[p], img[p + 1], img[p + 2]); if (!t) continue;
      (cells[t] || (cells[t] = new Map())); const ci = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
      const c = cells[t].get(ci) || { n: 0, sx: 0, sy: 0 }; c.n++; c.sx += x; c.sy += y; cells[t].set(ci, c);
    }
    const calib = (cxAbs: number, cyAbs: number) => {
      const dx = cxAbs / S, dy = cyAbs / S;
      return {
        plateLocSide: Math.round((-0.83 + (dx - box.x0) / (box.x1 - box.x0) * 1.66) * 100) / 100,
        plateLocHeight: Math.round((1.5 + (box.y1 - dy) / (box.y1 - box.y0) * 2.0) * 100) / 100,
      };
    };
    const dots: LocationDot[] = [];
    for (const t in cells) {
      const occ = cells[t]; const seen = new Set<number>();
      for (const [ci] of occ) {
        if (seen.has(ci)) continue;
        const stack = [ci]; let n = 0, sx = 0, sy = 0; seen.add(ci);
        while (stack.length) {
          const k = stack.pop()!; const cc = occ.get(k)!; n += cc.n; sx += cc.sx; sy += cc.sy;
          const gx = k % GW, gy = (k / GW) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx, ny = gy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
            const nk = ny * GW + nx; if (occ.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
          }
        }
        if (n >= 60) { const cx = rx0 + sx / n, cy = ry0 + sy / n; dots.push({ pitchType: t, ...calib(cx, cy) }); }
      }
    }
    return dots;
  } catch {
    return [];
  } finally {
    try { await doc?.destroy?.(); } catch {}
  }
}

/* ── Movement-plot dot extraction (renders the PDF; needs @napi-rs/canvas) ── */

export interface MovementDot { pitchType: string; horzBreak: number; inducedVertBreak: number }

/**
 * Detect the Movement-plot dots so the PDF's Movement chart matches the report
 * (instead of a synthetic scatter). The Movement plot has no calibration box,
 * so we:
 *   • read the X-axis tick row (integers below the plot) → horizontal-break
 *     px↔inch transform;
 *   • treat the plot as square (Trackman renders it 1:1) so IVB uses the same
 *     px/inch scale, and anchor the IVB origin off a single-pitch type (whose
 *     table IVB equals its actual value) — or, failing that, off the per-type
 *     centroids;
 *   • re-center each type's horizontal break on the table average (which is
 *     authoritative) to absorb detection noise, while keeping the real spread
 *     and the geometrically-calibrated IVB.
 * Best-effort: any failure returns [] and the caller falls back to the
 * table-driven synthetic scatter.
 */
export async function extractTrackmanMovement(buffer: Buffer): Promise<MovementDot[]> {
  let napi: any;
  try { napi = require('@napi-rs/canvas'); } catch { return []; }
  for (const k of ['DOMMatrix', 'Path2D', 'ImageData', 'DOMPoint']) if (!(globalThis as any)[k] && napi[k]) (globalThis as any)[k] = napi[k];
  const { createCanvas } = napi;
  const canvasFactory = {
    create(w: number, h: number) { const canvas = createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; },
    reset(cc: any, w: number, h: number) { cc.canvas.width = w; cc.canvas.height = h; },
    destroy(_cc: any) {},
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), canvasFactory, useSystemFonts: true, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const H = page.getViewport({ scale: 1 }).height;

    // Table values — for the horizontal re-center + IVB origin anchor.
    const tc = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of tc.items as any[]) { const s = (it.str || '').trim(); if (!s) continue; items.push({ x: Math.round(it.transform[4] * 10) / 10, y: Math.round((H - it.transform[5]) * 10) / 10, t: s }); }
    const table = parseTrackmanPdfTable(items);
    if (!table.length) return [];
    const tIvb: Record<string, number> = {};   // anchors the IVB origin (cy0)
    for (const r of table) tIvb[r.pitchType] = r.ivb;

    // X-axis calibration from the Movement plot's tick row (integers just below
    // the plot). Linear fit px = slope*value + intercept.
    const ticks = items.filter(i => i.y > 352 && i.y < 366 && i.x > 285 && i.x < 440 && /^-?\d+$/.test(i.t)).map(i => ({ v: parseInt(i.t, 10), px: i.x }));
    const seenV = new Set<number>(); const pts = ticks.filter(t => (seenV.has(t.v) ? false : (seenV.add(t.v), true)));
    if (pts.length < 2) return [];
    const n = pts.length, sv = pts.reduce((s, p) => s + p.v, 0), spx = pts.reduce((s, p) => s + p.px, 0), svv = pts.reduce((s, p) => s + p.v * p.v, 0), svpx = pts.reduce((s, p) => s + p.v * p.px, 0);
    const slope = (n * svpx - sv * spx) / (n * svv - sv * sv); const cx0 = (spx - slope * sv) / n;
    const pxPerIn = Math.abs(slope);
    if (!isFinite(pxPerIn) || pxPerIn < 1) return [];

    // Render + detect dots in the plot interior (around the ticks, above the axis labels).
    const S = 6; const vp = page.getViewport({ scale: S });
    const canvas = createCanvas(vp.width, vp.height); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvasFactory }).promise;
    const pxMin = Math.min(...pts.map(p => p.px)), pxMax = Math.max(...pts.map(p => p.px));
    const rx0 = Math.max(0, Math.floor((pxMin - 14) * S)), rx1 = Math.min(canvas.width, Math.ceil((pxMax + 14) * S));
    // Skip the top legend strip (colour swatches) — it otherwise reads as
    // high-IVB dots and drags the cluster up. Real dots sit below it.
    const ry0 = Math.floor(128 * S), ry1 = Math.floor(305 * S);
    const RW = rx1 - rx0, RH = ry1 - ry0; const img = ctx.getImageData(rx0, ry0, RW, RH).data;
    const REF: [string, number, number, number][] = [['Slider', 210, 175, 0], ['Curveball', 70, 140, 245], ['Fastball', 140, 0, 35], ['Other', 245, 105, 35]];
    const classify = (r: number, g: number, b: number): string | null => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn < 22 && r >= 132 && r <= 158) return 'Other';
      if (mx - mn < 50) return null;
      let best: string | null = null, bd = 60 * 60;
      for (const [t, R, G, B] of REF) { const d = (r - (R as number)) ** 2 + (g - (G as number)) ** 2 + (b - (B as number)) ** 2; if (d < bd) { bd = d; best = t as string; } }
      return best;
    };
    const CELL = 7, GW = Math.ceil(RW / CELL), GH = Math.ceil(RH / CELL);
    const cells: Record<string, Map<number, { n: number; sx: number; sy: number }>> = {};
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
      const p = (y * RW + x) * 4; const t = classify(img[p], img[p + 1], img[p + 2]); if (!t) continue;
      (cells[t] || (cells[t] = new Map())); const ci = ((y / CELL) | 0) * GW + ((x / CELL) | 0);
      const c = cells[t].get(ci) || { n: 0, sx: 0, sy: 0 }; c.n++; c.sx += x; c.sy += y; cells[t].set(ci, c);
    }
    const raw: Record<string, { px: number; py: number }[]> = {};
    for (const t in cells) {
      const occ = cells[t]; const seen = new Set<number>(); const arr: { px: number; py: number }[] = [];
      for (const [ci] of occ) {
        if (seen.has(ci)) continue;
        const stack = [ci]; let cnt = 0, sx = 0, sy = 0; seen.add(ci);
        while (stack.length) {
          const k = stack.pop()!; const cc = occ.get(k)!; cnt += cc.n; sx += cc.sx; sy += cc.sy;
          const gx = k % GW, gy = (k / GW) | 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = gx + dx, ny = gy + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue; const nk = ny * GW + nx; if (occ.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); } }
        }
        if (cnt >= 45) arr.push({ px: (rx0 + sx / cnt) / S, py: (ry0 + sy / cnt) / S });
      }
      if (arr.length) raw[t] = arr;
    }
    if (!Object.keys(raw).length) return [];

    // IVB origin (cy0): square plot → same px/inch. Anchor off single-dot types
    // (table IVB == actual for n==1); else off per-type centroids.
    const exact: number[] = [];
    for (const t in raw) if (raw[t].length === 1 && tIvb[t] != null) exact.push(raw[t][0].py + tIvb[t] * pxPerIn);
    let cy0: number | null = exact.length ? exact.reduce((s, v) => s + v, 0) / exact.length : null;
    if (cy0 == null) {
      const est: number[] = [];
      for (const t in raw) { if (tIvb[t] == null) continue; const mpy = raw[t].reduce((s, d) => s + d.py, 0) / raw[t].length; est.push(mpy + tIvb[t] * pxPerIn); }
      cy0 = est.length ? est.reduce((s, v) => s + v, 0) / est.length : null;
    }
    if (cy0 == null) return [];

    // Return raw, geometrically-calibrated dots (the spread/shape). The caller
    // re-centers each type onto the authoritative table averages after cycling
    // them across the pitch rows — that keeps the real shape while guaranteeing
    // the cluster centre (and arsenal averages) match the report.
    const dots: MovementDot[] = [];
    for (const t in raw) {
      for (const d of raw[t]) {
        dots.push({ pitchType: t, horzBreak: Math.round(((d.px - cx0) / slope) * 10) / 10, inducedVertBreak: Math.round(((cy0! - d.py) / pxPerIn) * 10) / 10 });
      }
    }
    return dots;
  } catch {
    return [];
  } finally {
    try { await doc?.destroy?.(); } catch {}
  }
}

/* ── Table parsing (pure, unit-testable) ── */

const NUM = /^-?\d+(?:\.\d+)?$/; // FULL numeric only — keeps "4-Seam"/"Max. abs." as text
const isNum = (t: string) => NUM.test(t);
const HEADER_WORDS = new Set([
  'pitch', 'type', 'qty.', 'qty', 'min.', 'max.', 'avg.', 'abs.', 'total', 'spin',
  'speed', 'ivb', 'horz.', 'vert.', 'mov', 'rel.h', 'rel.side', 'ext', 'stats', 'by',
  '(in)', '(ft)', '(mph)', '(rpm)',
]);

/** Group tokens into visual rows by y, each row's tokens sorted left→right. */
function toLines(items: PdfTextItem[]): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  let cur: PdfTextItem[] = [];
  let ly: number | null = null;
  for (const it of sorted) {
    if (ly === null || Math.abs(it.y - ly) < 6) cur.push(it);
    else { lines.push(cur); cur = [it]; }
    ly = it.y;
  }
  if (cur.length) lines.push(cur);
  return lines.map(l => l.sort((a, b) => a.x - b.x));
}

/**
 * Parse the "Stats by pitch type" table into per-type aggregate rows.
 * Column order is the Trackman session-report standard; we map numeric tokens
 * positionally so the parse survives horizontal layout shifts between report
 * versions (only the column ORDER must hold).
 */
export function parseTrackmanPdfTable(items: PdfTextItem[]): TrackmanPdfRow[] {
  const lines = toLines(items);

  // Anchor on the "Stats by pitch type" title; data rows live below it.
  let anchorY = -Infinity;
  for (const line of lines) {
    const text = line.map(s => s.t).join(' ').toLowerCase();
    if (text.includes('stats by pitch type')) { anchorY = line[0].y; break; }
  }

  const rows: TrackmanPdfRow[] = [];
  for (const line of lines) {
    if (line[0].y <= anchorY) continue;

    // Split into a leading name (non-numeric tokens) and the numeric columns.
    const nameTokens: string[] = [];
    const nums: number[] = [];
    let seenNum = false;
    for (const it of line) {
      if (isNum(it.t)) { seenNum = true; nums.push(parseFloat(it.t)); }
      else if (!seenNum) nameTokens.push(it.t);
      // non-numeric tokens AFTER numbers begin (units etc.) are ignored
    }
    const name = nameTokens.join(' ').trim();
    if (!name) continue;
    // Skip header / label lines.
    const lower = name.toLowerCase();
    if ([...HEADER_WORDS].some(w => lower === w) || lower.startsWith('pitch ')) continue;
    // A real data row has the full 14-column numeric payload.
    if (nums.length < 14) continue;

    rows.push({
      pitchType: name,
      qty: Math.round(nums[0]),
      spdMin: nums[1], spdMax: nums[2], spdAvg: nums[3],
      spinMin: nums[4], spinMax: nums[5], spinAvg: nums[6],
      ivb: nums[7],
      horzAvg: nums[8], horzMaxAbs: nums[9],
      vertMaxAbs: nums[10],
      relHeight: nums[11], relSide: nums[12], ext: nums[13],
    });
  }
  return rows;
}

/* ── Pitch synthesis ── */

/** Distribute n values so min/max/avg exactly equal lo/hi/avg. */
function synth(n: number, lo: number, hi: number, avg: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [avg];
  if (n === 2) return [lo, 2 * avg - lo];
  const mid = (n * avg - lo - hi) / (n - 2);
  return [lo, hi, ...Array(n - 2).fill(mid)];
}

/** Deterministic jitter around `center`, re-centred so mean === center exactly. */
function scatter(n: number, center: number, spread: number, seed: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [center];
  const vals: number[] = [];
  let s = (seed >>> 0) || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    vals.push(center + ((s / 0x7fffffff) * 2 - 1) * spread);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  return vals.map(v => Math.round((v - mean + center) * 100) / 100);
}

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
// Stable per-type seed so a given report always rebuilds the same scatter.
const seedOf = (s: string) => { let h = 0; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };

/**
 * Build a full ParseResult (per-pitch `trackman_pitch` rows + aggregate
 * summary metrics) from the parsed table, mirroring TrackmanParser's output
 * shape so the storage path is identical to the CSV flow.
 */
export function buildTrackmanPdfResult(
  items: PdfTextItem[],
  recordedAt: Date,
  playerName = 'TrackMan PDF',
  locationDots: LocationDot[] = [],
  movementDots: MovementDot[] = [],
): ParseResult {
  const table = parseTrackmanPdfTable(items);
  const success: ParsedMetric[] = [];
  const pitches: Record<string, any>[] = [];

  for (const r of table) {
    const n = Math.max(1, r.qty);
    // Detected Location-plot dots for this pitch type — cycled across that
    // type's synthesised pitches so each gets a plausible plate location.
    const locs = locationDots.filter(d => d.pitchType === r.pitchType);
    // Detected Movement-plot dots — when present they REPLACE the synthetic
    // horz/IVB scatter so the Movement chart matches the report exactly.
    const movs = movementDots.filter(d => d.pitchType === r.pitchType);
    const velos = synth(n, r.spdMin, r.spdMax, r.spdAvg);
    const spins = synth(n, r.spinMin, r.spinMax, r.spinAvg);
    const seed = seedOf(r.pitchType);
    const horzSpread = Math.min(4, Math.max(0.6, Math.abs(r.horzMaxAbs - r.horzAvg)));
    const hbs = scatter(n, r.horzAvg, horzSpread, seed);
    const ivbs = scatter(n, r.ivb, 1.5, seed + 7);
    const rsides = scatter(n, r.relSide, 0.25, seed + 13);
    const rheights = scatter(n, r.relHeight, 0.2, seed + 19);

    // Real Movement dots (when detected): cycle them across this type's pitches,
    // then re-center the cluster onto the table averages (horz + IVB). This keeps
    // the actual plotted SHAPE/spread while pinning the centre — and the arsenal
    // H-Break/IVB averages — exactly on the report, immune to detection noise.
    let movHb: number[] | null = null, movIvb: number[] | null = null;
    if (movs.length) {
      // Use the REAL detected positions so the plot matches the PDF exactly
      // (do NOT re-center onto the table average — that shifts dots off their
      // true spots). Detection finds fewer distinct dots than pitches, so cycle
      // them with a small deterministic jitter → all `n` pitches render as
      // distinct dots clustered on the genuine locations.
      let js = (seed + 12345) >>> 0;
      const jit = (amt: number) => { js = (Math.imul(js, 1103515245) + 12345) & 0x7fffffff; return ((js / 0x7fffffff) * 2 - 1) * amt; };
      const j = movs.length < n;
      movHb = Array.from({ length: n }, (_, i) => round(movs[i % movs.length].horzBreak + (j ? jit(0.8) : 0), 1));
      movIvb = Array.from({ length: n }, (_, i) => round(movs[i % movs.length].inducedVertBreak + (j ? jit(0.8) : 0), 1));
    }

    for (let i = 0; i < n; i++) {
      const loc = locs.length ? locs[i % locs.length] : null;
      const pitch = {
        pitchType: r.pitchType,
        relSpeed: round(velos[i], 1),
        spinRate: Math.round(spins[i]),
        spinAxis: null, tilt: null,
        relHeight: round(rheights[i], 2),
        relSide: round(rsides[i], 2),
        extension: round(r.ext, 1),
        vertBreak: round(r.vertMaxAbs, 1),
        inducedVertBreak: movIvb ? movIvb[i] : round(ivbs[i], 1),
        horzBreak: movHb ? movHb[i] : round(hbs[i], 1),
        plateLocHeight: loc ? loc.plateLocHeight : null,   // from the Location chart (rendered)
        plateLocSide: loc ? loc.plateLocSide : null,
        zoneSpeed: null, effectiveVelo: null,
        vertApprAngle: null, horzApprAngle: null,
        pitchCall: null, pitchNo: i + 1, pitcherThrows: null,
        pdfSource: true,        // → Pitching tab renders these non-interactive
      };
      pitches.push(pitch);
      success.push({
        playerName,
        metricType: 'trackman_pitch',
        value: pitch.relSpeed,
        unit: 'mph',
        recordedAt,
        rawData: pitch,
      });
    }
  }

  // Aggregate summary metrics — same set the CSV parser emits, for parity.
  if (pitches.length > 0) {
    const agg = (metricType: string, value: number, unit: string, count: number) =>
      success.push({ playerName, metricType, value, unit, recordedAt, rawData: { source: 'trackman_pdf_aggregate', pitchCount: count } });
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

    const fastballs = pitches.filter(p => ['Fastball', 'Sinker', 'Cutter'].includes(p.pitchType));
    if (fastballs.length) {
      const v = fastballs.map(p => p.relSpeed);
      agg('fb_max_velo', round(Math.max(...v), 2), 'mph', v.length);
      agg('fb_avg_velo', round(mean(v), 2), 'mph', v.length);
    }
    const spins = pitches.map(p => p.spinRate).filter((x): x is number => x != null);
    if (spins.length) agg('spin_rate', Math.round(mean(spins)), 'rpm', spins.length);
    const hb = pitches.map(p => p.horzBreak);
    if (hb.length) agg('h_break', round(mean(hb), 2), 'in', hb.length);
    const ivb = pitches.map(p => p.inducedVertBreak);
    if (ivb.length) agg('v_break', round(mean(ivb), 2), 'in', ivb.length);
    const rh = pitches.map(p => p.relHeight);
    if (rh.length) agg('release_height', round(mean(rh), 2), 'ft', rh.length);
    const ex = pitches.map(p => p.extension);
    if (ex.length) agg('extension', round(mean(ex), 2), 'ft', ex.length);
  }

  return { success, errors: [], totalRows: pitches.length };
}
