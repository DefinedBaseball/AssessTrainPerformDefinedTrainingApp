import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * HitTrax Point of Impact (POI) parser -- the older "HitTrax POI" upload card.
 *
 * Since 2026-11 the regular HitTrax card saves Point of Impact from the same
 * export (via poiFromRow below), so one upload fills the Spray Chart, Strike
 * Zone AND Point of Impact; the POI card only shows on reports that already
 * carry a POI-card file. This parser is kept so those files can still be read
 * and re-uploaded.
 *
 * One metric per batted ball, `poi_depth`, whose value is the inches in
 * front of the plate's front edge, with everything the Point of Impact chart
 * needs in rawData.
 *
 * The math (verified against two HitTrax sessions, every number matched):
 *   POI Z = depth from the BACK POINT of home plate (in). The plate is 17"
 *           deep, so  depth in front of the plate = POI Z - 17.
 *   POI X = side to side from the middle of the plate (in).
 *   POI Y = height off the ground at contact (in).
 *
 * Its own source (HITTRAX_POI) and metric type, so nothing here feeds the
 * batted-ball bubble, trends or leaderboards. Never auto-detected
 * (confidence 0): the headers are identical to the regular HitTrax export.
 */

const PLATE_DEPTH_IN = 17;

/** Exact (case-insensitive) header match -- `strike zone` must not grab
 *  `Strike Zone Bottom`, `type` must not grab `P. Type`. */
function cell(row: Record<string, string>, want: string): string | null {
  const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === want);
  return match && match[1] != null && match[1].trim() !== '' ? match[1] : null;
}

function num(row: Record<string, string>, key: string): number | null {
  const c = cell(row, key);
  if (c == null) return null;
  const n = parseFloat(c);
  return Number.isFinite(n) ? n : null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** True when an export has the Point of Impact columns at all. */
export function hasPoiColumns(rows: Record<string, string>[]): boolean {
  const headers = rows.length ? Object.keys(rows[0]).map((h) => h.toLowerCase().trim()) : [];
  return headers.includes('poi x') && headers.includes('poi z');
}

/**
 * One batted ball's Point of Impact from a HitTrax export row, or null when
 * the row has no contact (takes / misses come through with Velo 0) or no
 * POI columns. Shared by this parser and the regular HitTrax parser so both
 * cards read a swing identically -- the chart relies on that to drop a swing
 * found in both.
 */
export function poiFromRow(row: Record<string, string>): { depth: number; rawData: Record<string, unknown> } | null {
  const velo = num(row, 'velo');
  const x = num(row, 'poi x');
  const y = num(row, 'poi y');
  const z = num(row, 'poi z');
  if (velo == null || velo === 0 || x == null || z == null) return null;
  if (x === 0 && z === 0 && (y == null || y === 0)) return null;
  const zoneNum = parseInt((cell(row, 'strike zone') || '').trim(), 10);
  const bats = (cell(row, 'batting') || '').trim().toUpperCase();
  return {
    depth: round(z - PLATE_DEPTH_IN),
    rawData: {
      type: 'poi',
      x: round(x),
      y: y == null ? null : round(y),
      z: round(z),
      velo: round(velo),
      la: num(row, 'la'),
      dist: num(row, 'dist'),
      res: (cell(row, 'res') || '').trim() || null,
      ballType: (cell(row, 'type') || '').trim().toUpperCase() || null,
      zone: Number.isInteger(zoneNum) && zoneNum >= 1 && zoneNum <= 13 ? zoneNum : null,
      bats: bats.startsWith('L') ? 'L' : bats.startsWith('R') ? 'R' : null,
    },
  };
}

export class HitTraxPoiParser implements VendorParser {
  source = 'HITTRAX_POI';

  detectConfidence(): number {
    return 0;
  }

  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult {
    const success: ParsedMetric[] = [];
    const errors: ParseResult['errors'] = [];

    if (!hasPoiColumns(rows)) {
      throw new Error('This file has no POI X / POI Z columns. Upload the HitTrax export that includes Point of Impact.');
    }

    for (let i = 0; i < rows.length; i++) {
      const poi = poiFromRow(rows[i]);
      if (!poi) continue;
      const rowDate = this.findDate(rows[i]) || recordedAt;
      success.push({
        playerName: '_hittrax_upload_',
        metricType: 'poi_depth',
        value: poi.depth,
        unit: 'in',
        // Unique per-row stamp keeps the swings in CSV order.
        recordedAt: new Date(rowDate.getTime() + i),
        rawData: poi.rawData,
      });
    }

    return { success, errors, totalRows: rows.length };
  }

  private findDate(row: Record<string, string>): Date | null {
    const raw = cell(row, 'date');
    if (!raw) return null;
    const d = new Date(raw.trim());
    if (!isNaN(d.getTime())) return d;
    const d2 = new Date(raw.trim().replace(/\.\d+$/, ''));
    return isNaN(d2.getTime()) ? null : d2;
  }
}
