import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * HitTrax CSV Parser
 *
 * Real HitTrax BP / cage export columns (verified against Sheldon
 * Johnson's BP.csv):
 *   #, AB, Date, Time Stamp, Pitch, Strike Zone, P. Type, Velo, LA,
 *   Dist, Res, Type, Horiz. Angle, Pts, Strike Zone Bottom,
 *   Strike Zone Top, Strike Zone Width, Vertical Distance,
 *   Horizontal Distance, POI X, POI Y, POI Z, Spray Chart X,
 *   Spray Chart Z, Fielded X, Fielded Z, Bat Material, User,
 *   Pitch Angle, Batting, Level, Opposing Player, Tag
 *
 * Each row is a single batted ball. We map every per-pitch numeric
 * column we care about; the upload pipeline aggregates max/avg per
 * metric_type downstream, so emitting one row per batted ball is fine.
 * Player name comes from the `User` column. Date is `Date` + `Time Stamp`.
 */

const HITTRAX_IDENTIFIERS = [
  'hittrax', 'strike zone', 'pitch speed', 'pitch type',
  'exit velo', 'points', 'batting avg',
  // Real BP export signatures — these column names together
  // (case-insensitive) are unique to HitTrax.
  'velo', 'la', 'dist', 'horiz. angle', 'pts',
  'spray chart x', 'fielded x', 'p. type', 'bat material',
];

export class HitTraxParser implements VendorParser {
  source = 'HITTRAX';

  detectConfidence(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    // Strong signature: HitTrax-only column combos.
    const hasReal =
      lower.includes('velo')
      && lower.includes('la')
      && lower.includes('dist')
      && lower.some(h => h === 'horiz. angle');
    if (hasReal) return 1;
    const matches = HITTRAX_IDENTIFIERS.filter(id =>
      lower.some(h => h.includes(id))
    );
    const hasHitTrax = lower.some(h => h.includes('hittrax')) ? 0.5 : 0;
    return Math.min((matches.length / 3) + hasHitTrax, 1);
  }

  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult {
    const success: ParsedMetric[] = [];
    const errors: ParseResult['errors'] = [];

    /* HitTrax exports one row per batted ball. We accumulate per-ball
       metrics that all share the SAME per-row unique timestamp:
         • max_exit_velo / launch_angle / distance  (the snapshot aggregates)
         • spray_x / spray_z / spray_angle / spray_dist / ball_type_code
       Sharing the timestamp is critical so the Spray Chart Metric Readout
       can pair a clicked dot's coordinates with the EV / LA / Dist from
       the SAME batted ball — previously the aggregates all used
       `lastDate` (the final row's date) while spray coords used a
       per-row unique offset, so the frontend pairing by recordedAt
       silently dropped EV / LA / Dist for every HitTrax dot. */
    let lastDate: Date = recordedAt;
    let lastPlayerName = '_hittrax_upload_';
    /* Type column → numeric code so the Metric.value column (numeric)
       can carry it. The spray chart maps these back to colors:
         1 = GB (red)
         2 = LD (blue)
         3 = FB (green) */
    const ballTypeCode = (raw: string | null): number | null => {
      if (!raw) return null;
      const t = raw.trim().toUpperCase();
      if (t === 'GB' || t === 'GROUND' || t === 'GROUND BALL') return 1;
      if (t === 'LD' || t === 'LINE DRIVE') return 2;
      if (t === 'FB' || t === 'FLY BALL' || t === 'FLY') return 3;
      return null;
    };

    /* Collect per-row metrics keyed by a unique synthetic timestamp
       (rowDate + millisecond offset) so the chart can pair every
       per-row metric — spray coords AND the EV / LA / Distance
       aggregates that drive the Metric Readout — by recordedAt at
       fetch time. Every metric a single batted ball produces shares
       this one `date`. */
    type PerRow = {
      // Aggregates (always present when present in the source row).
      velo: number;                 // mph — exit velocity (Velo column)
      la:   number | null;          // deg — launch angle (LA column)
      dist: number | null;          // ft  — carry distance (Dist column)
      // Spray landing coords (Cartesian preferred; polar fallback).
      x: number | null; z: number | null;
      angle: number | null; sprayDist: number | null;
      type: number | null;
      date: Date;                   // shared by every metric this row emits
    };
    const perRow: PerRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      /* `User` column is the operator/coach, not the hitter — ignored.
         Sentinel name lets the upload pipeline tag everything with the
         playerId selected at upload time. */
      const playerName = this.findPlayerName(row) || '_hittrax_upload_';
      const rowDate = this.findDate(row) || recordedAt;

      const veloRaw = this.findCellInsensitive(row, ['velo', 'exit velo', 'exit velocity', 'exit speed']);
      const laRaw   = this.findCellInsensitive(row, ['la', 'launch angle']);
      const distRaw = this.findCellInsensitive(row, ['dist', 'distance']);
      const sprayXRaw = this.findCellInsensitive(row, ['spray chart x', 'spray x']);
      const sprayZRaw = this.findCellInsensitive(row, ['spray chart z', 'spray z']);
      const horizAngleRaw = this.findCellInsensitive(row, ['horiz. angle', 'horiz angle', 'horizontal angle']);
      const typeRaw   = this.findCellInsensitive(row, ['type', 'hit type', 'ball type']);

      const velo = veloRaw == null ? NaN : parseFloat(veloRaw);
      const la   = laRaw   == null ? NaN : parseFloat(laRaw);
      const dist = distRaw == null ? NaN : parseFloat(distRaw);
      const sprayX = sprayXRaw == null ? NaN : parseFloat(sprayXRaw);
      const sprayZ = sprayZRaw == null ? NaN : parseFloat(sprayZRaw);
      const horizAngle = horizAngleRaw == null ? NaN : parseFloat(horizAngleRaw);

      /* Skip rows with Velo = 0 entirely. HitTrax records a row for every
         pitch — including takes / swings-and-misses where no ball was put
         in play. Those rows come through with Velo=0 (and typically LA=0,
         Dist=0) and would drag every average toward zero. We treat any
         row that didn't produce a batted ball as not-a-data-point for
         all three aggregates. */
      if (!Number.isFinite(velo) || velo === 0) continue;

      lastDate = rowDate;
      lastPlayerName = playerName;

      /* Per-row spray coords. We collect:
           • Cartesian X/Z from the Spray Chart X / Spray Chart Z columns
             (preferred for landing-position plotting),
           • Polar angle/distance fallback from Horiz. Angle + Dist (always
             present on real HitTrax exports — used when X/Z columns are
             missing or the row's Z is 0).
           • Ball type code (1/2/3) from the Type column.
         Spray coords are optional — a row may emit EV / LA / Dist
         without contributing a spray dot. */
      const hasCart  = Number.isFinite(sprayX) && Number.isFinite(sprayZ) && sprayZ > 0;
      const hasPolar = Number.isFinite(horizAngle) && Number.isFinite(dist) && dist > 0;

      // ONE synthetic per-row timestamp; every metric this row emits
      // (Velo, LA, Dist, spray_x, spray_z, …) shares this stamp so
      // the spray-chart consumer can pair them by recordedAt.
      const stamp = new Date(rowDate.getTime() + i);
      perRow.push({
        velo,
        la:   Number.isFinite(la)   ? la   : null,
        dist: Number.isFinite(dist) ? dist : null,
        x:        hasCart  ? sprayX     : null,
        z:        hasCart  ? sprayZ     : null,
        angle:    hasPolar ? horizAngle : null,
        sprayDist: hasPolar ? dist      : null,
        type: ballTypeCode(typeRaw),
        date: stamp,
      });
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    /* Per-row emission — every metric a single batted ball produces
       shares ONE recordedAt (the row's synthetic stamp), so the
       Spray Chart Metric Readout can pair a clicked dot's coords with
       the EV / LA / Dist from the SAME batted ball. Each Metric row
       carries source='HITTRAX' (set by the upload pipeline) so the
       Hitting tab's HitTrax section can fetch HitTrax-only progress
       via the API's source filter, keeping Full Swing data out of the
       HitTrax section and vice versa.

       Per-row metric inventory:
         max_exit_velo     — mph (Velo column; always present)
         launch_angle      — deg (LA column; optional)
         distance          — ft  (Dist column; optional)
         spray_x           — feet (Cartesian, signed: − = pull / + = oppo)
         spray_z           — feet from home plate
         spray_angle       — degrees (Horiz. Angle, polar fallback)
         spray_dist        — feet (Dist, polar fallback)
         ball_type_code    — 1=GB, 2=LD, 3=FB (when Type column present) */
    for (const r of perRow) {
      success.push({
        playerName: lastPlayerName,
        metricType: 'max_exit_velo',
        value: round(r.velo),
        unit: 'mph',
        recordedAt: r.date,
        rawData: { type: 'session_summary' },
      });
      if (r.la != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'launch_angle',
          value: round(r.la),
          unit: 'deg',
          recordedAt: r.date,
          rawData: { type: 'session_summary' },
        });
      }
      if (r.dist != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'distance',
          value: round(r.dist),
          unit: 'ft',
          recordedAt: r.date,
          rawData: { type: 'session_summary' },
        });
      }
      if (r.x != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'spray_x',
          value: round(r.x),
          unit: 'ft',
          recordedAt: r.date,
          rawData: { type: 'spray_coord' },
        });
      }
      if (r.z != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'spray_z',
          value: round(r.z),
          unit: 'ft',
          recordedAt: r.date,
          rawData: { type: 'spray_coord' },
        });
      }
      if (r.angle != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'spray_angle',
          value: round(r.angle),
          unit: 'deg',
          recordedAt: r.date,
          rawData: { type: 'spray_coord' },
        });
      }
      if (r.sprayDist != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'spray_dist',
          value: round(r.sprayDist),
          unit: 'ft',
          recordedAt: r.date,
          rawData: { type: 'spray_coord' },
        });
      }
      if (r.type != null) {
        success.push({
          playerName: lastPlayerName,
          metricType: 'ball_type_code',
          value: r.type, // 1=GB, 2=LD, 3=FB
          unit: '',
          recordedAt: r.date,
          rawData: { type: 'spray_coord' },
        });
      }
    }

    return { success, errors, totalRows: rows.length };
  }

  private findPlayerName(row: Record<string, string>): string | null {
    /* Real HitTrax `User` column is the OPERATOR (coach running the
       cage), not the hitter — intentionally excluded. We only look at
       columns that would carry the actual hitter's name in a custom
       or hand-massaged export. */
    const nameKeys = ['player', 'player name', 'name', 'athlete', 'hitter', 'batter'];
    for (const key of nameKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) return match[1].trim();
    }
    return null;
  }

  private findCellInsensitive(row: Record<string, string>, keys: string[]): string | null {
    for (const want of keys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === want);
      if (match && match[1] != null && match[1].trim() !== '') return match[1];
    }
    return null;
  }

  private findDate(row: Record<string, string>): Date | null {
    /* Real HitTrax export gives Date and Time Stamp separately —
       Time Stamp is a session offset like "0:5:1.581" so we ignore it
       for absolute timestamps and just use Date. */
    const dateKeys = ['date', 'session date'];
    for (const key of dateKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) {
        const raw = match[1].trim();
        // HitTrax format example: "5/4/2026 19:54:30.264"
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d;
        // Strip trailing time-zone-less ms-precision if Date() rejected it.
        const stripped = raw.replace(/\.\d+$/, '');
        const d2 = new Date(stripped);
        if (!isNaN(d2.getTime())) return d2;
      }
    }
    return null;
  }
}
