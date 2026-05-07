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

    /* HitTrax exports one row per batted ball. Rather than store a row
       per ball, we accumulate the four metrics we care about and emit
       a single SESSION-LEVEL summary at the end:
         max_exit_velo → top Velo of the session
         avg_exit_velo → mean of every Velo
         launch_angle  → mean of every LA  (rendered as "Avg Launch Angle")
         distance      → mean of every Dist (rendered as "Avg Distance")
       Tagged at the latest row's date so topMetrics' "most recent value"
       lookup picks them up over older sessions. */
    const velos: number[] = [];
    const las: number[] = [];
    const dists: number[] = [];
    let lastDate: Date = recordedAt;
    let lastPlayerName = '_hittrax_upload_';

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

      const velo = veloRaw == null ? NaN : parseFloat(veloRaw);
      const la   = laRaw   == null ? NaN : parseFloat(laRaw);
      const dist = distRaw == null ? NaN : parseFloat(distRaw);

      if (Number.isFinite(velo)) {
        velos.push(velo);
        lastDate = rowDate;
        lastPlayerName = playerName;
      }
      if (Number.isFinite(la)) las.push(la);
      if (Number.isFinite(dist)) dists.push(dist);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const push = (metricType: string, value: number, unit: string) => {
      success.push({
        playerName: lastPlayerName,
        metricType,
        value: round(value),
        unit,
        recordedAt: lastDate,
        rawData: { type: 'session_summary' },
      });
    };

    /* Per-row values for max_exit_velo / launch_angle / distance.
       Each Metric row carries source='HITTRAX' (set by the upload
       pipeline) so the Hitting tab's HitTrax section can fetch
       HitTrax-only progress via the API's source filter, keeping
       Full Swing data out of the HitTrax section and vice versa. */
    velos.forEach((v) => push('max_exit_velo', v, 'mph'));
    las.forEach((v) => push('launch_angle', v, 'deg'));
    dists.forEach((v) => push('distance', v, 'ft'));

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
