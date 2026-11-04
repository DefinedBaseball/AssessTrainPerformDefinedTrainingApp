import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * HitTrax Point of Impact (POI) parser — the "HitTrax POI" upload card.
 *
 * Same HitTrax export as the regular HitTrax card, read for a different
 * job: WHERE the ball was hit relative to home plate. One metric per batted
 * ball, `poi_depth`, whose value is the inches in front of the plate's front
 * edge, with everything the Point of Impact chart needs in rawData.
 *
 * The math (verified against two HitTrax sessions, every number matched):
 *   POI Z = depth from the BACK POINT of home plate (in). The plate is 17"
 *           deep, so  depth in front of the plate = POI Z - 17.
 *   POI X = side to side from the middle of the plate (in).
 *   POI Y = height off the ground at contact (in).
 *
 * Deliberately its own source (HITTRAX_POI) and its own metric type, so a
 * coach can upload the same file to both cards without double-counting:
 * nothing here feeds the batted-ball bubble, trends or leaderboards.
 *
 * Never auto-detected (confidence 0): the headers are identical to the
 * regular HitTrax export, so it is only used when the POI card names it.
 */

const PLATE_DEPTH_IN = 17;

export class HitTraxPoiParser implements VendorParser {
  source = 'HITTRAX_POI';

  detectConfidence(): number {
    return 0;
  }

  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult {
    const success: ParsedMetric[] = [];
    const errors: ParseResult['errors'] = [];

    const headers = rows.length ? Object.keys(rows[0]).map(h => h.toLowerCase().trim()) : [];
    if (!headers.includes('poi x') || !headers.includes('poi z')) {
      throw new Error('This file has no POI X / POI Z columns. Upload the HitTrax export that includes Point of Impact.');
    }

    const num = (row: Record<string, string>, key: string): number | null => {
      const cell = this.cell(row, key);
      if (cell == null) return null;
      const n = parseFloat(cell);
      return Number.isFinite(n) ? n : null;
    };
    const round = (n: number) => Math.round(n * 100) / 100;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const velo = num(row, 'velo');
      const x = num(row, 'poi x');
      const y = num(row, 'poi y');
      const z = num(row, 'poi z');
      /* Takes / misses come through with Velo 0 and no contact point. */
      if (velo == null || velo === 0 || x == null || z == null) continue;
      if (x === 0 && z === 0 && (y == null || y === 0)) continue;

      const rowDate = this.findDate(row) || recordedAt;
      const zoneNum = parseInt((this.cell(row, 'strike zone') || '').trim(), 10);
      const bats = (this.cell(row, 'batting') || '').trim().toUpperCase();

      success.push({
        playerName: '_hittrax_upload_',
        metricType: 'poi_depth',
        value: round(z - PLATE_DEPTH_IN),
        unit: 'in',
        // Unique per-row stamp keeps the swings in CSV order.
        recordedAt: new Date(rowDate.getTime() + i),
        rawData: {
          type: 'poi',
          x: round(x),
          y: y == null ? null : round(y),
          z: round(z),
          velo: round(velo),
          la: num(row, 'la'),
          dist: num(row, 'dist'),
          res: (this.cell(row, 'res') || '').trim() || null,
          ballType: (this.cell(row, 'type') || '').trim().toUpperCase() || null,
          zone: Number.isInteger(zoneNum) && zoneNum >= 1 && zoneNum <= 13 ? zoneNum : null,
          bats: bats.startsWith('L') ? 'L' : bats.startsWith('R') ? 'R' : null,
        },
      });
    }

    return { success, errors, totalRows: rows.length };
  }

  /** Exact (case-insensitive) header match — `strike zone` must not grab
   *  `Strike Zone Bottom`, `type` must not grab `P. Type`. */
  private cell(row: Record<string, string>, want: string): string | null {
    const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === want);
    return match && match[1] != null && match[1].trim() !== '' ? match[1] : null;
  }

  private findDate(row: Record<string, string>): Date | null {
    const raw = this.cell(row, 'date');
    if (!raw) return null;
    const d = new Date(raw.trim());
    if (!isNaN(d.getTime())) return d;
    const d2 = new Date(raw.trim().replace(/\.\d+$/, ''));
    return isNaN(d2.getTime()) ? null : d2;
  }
}
