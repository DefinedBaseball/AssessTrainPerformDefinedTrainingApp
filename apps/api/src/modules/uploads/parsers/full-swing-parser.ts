import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * Full Swing Baseball CSV Parser
 *
 * Actual Full Swing export columns:
 *   PitchNo, Date, Time, Batter, BatterId, RelSpeed, SpinRate,
 *   ExitSpeed, Angle, Direction, BatSpeed, HitSpinRate, Distance,
 *   SmashFactor, PotSmashFactor, PotExitSpeed, SquaredUp,
 *   Environment, Mode, PitchDistance, LM FSID
 *
 * Key metrics we extract:
 *   ExitSpeed → max_exit_velo (mph)
 *   Angle → launch_angle (deg)
 *   Direction → spray_angle (deg)
 *   BatSpeed → bat_speed (mph)
 *   Distance → distance (ft)
 *   SmashFactor → smash_factor (ratio)
 *   SquaredUp → squared_up_pct (decimal 0-1, stored as %)
 */

const COLUMN_MAP: Record<string, { metric: string; unit: string; transform?: (v: number) => number }> = {
  // --- Actual Full Swing export columns ---
  'exitspeed':              { metric: 'max_exit_velo', unit: 'mph' },
  'angle':                  { metric: 'launch_angle', unit: 'deg' },
  'direction':              { metric: 'spray_angle', unit: 'deg' },
  'batspeed':               { metric: 'bat_speed', unit: 'mph' },
  'distance':               { metric: 'distance', unit: 'ft' },
  'smashfactor':            { metric: 'smash_factor', unit: '' },
  'squaredup':              { metric: 'squared_up_pct', unit: '%', transform: (v: number) => Math.round(v * 10000) / 100 },
  // --- Alternative column names (generic exports) ---
  'exit velocity (mph)':    { metric: 'max_exit_velo', unit: 'mph' },
  'exit velocity':          { metric: 'max_exit_velo', unit: 'mph' },
  'exit velo':              { metric: 'max_exit_velo', unit: 'mph' },
  'exit speed':             { metric: 'max_exit_velo', unit: 'mph' },
  'avg exit velocity':      { metric: 'avg_exit_velo', unit: 'mph' },
  'avg exit velo':          { metric: 'avg_exit_velo', unit: 'mph' },
  'launch angle (deg)':     { metric: 'launch_angle', unit: 'deg' },
  'launch angle':           { metric: 'launch_angle', unit: 'deg' },
  'la':                     { metric: 'launch_angle', unit: 'deg' },
  'distance (ft)':          { metric: 'distance', unit: 'ft' },
  'carry distance':         { metric: 'distance', unit: 'ft' },
  'hang time (s)':          { metric: 'hang_time', unit: 'sec' },
  'hang time':              { metric: 'hang_time', unit: 'sec' },
  'spray angle (deg)':      { metric: 'spray_angle', unit: 'deg' },
  'spray angle':            { metric: 'spray_angle', unit: 'deg' },
  'bat speed':              { metric: 'bat_speed', unit: 'mph' },
  'bat speed (mph)':        { metric: 'bat_speed', unit: 'mph' },
  'smash factor':           { metric: 'smash_factor', unit: '' },
  'barrel':                 { metric: 'barrel', unit: '' },
  'barrels':                { metric: 'barrel', unit: '' },
  'hard hit %':             { metric: 'hard_hit_pct', unit: '%' },
  'hard hit':               { metric: 'hard_hit_pct', unit: '%' },
  'squared up %':           { metric: 'squared_up_pct', unit: '%' },
  'squared up':             { metric: 'squared_up_pct', unit: '%' },
};

const FULLSWING_IDENTIFIERS = [
  'exitspeed', 'exit velocity', 'exit velo', 'launch angle',
  'distance', 'spray angle', 'hang time', 'full swing', 'barrel',
  'batspeed', 'smashfactor', 'squaredup', 'lm fsid', 'pitchno',
  'relspeed', 'potexitspeed', 'potsmashfactor', 'hitspinrate',
];

export class FullSwingParser implements VendorParser {
  source = 'FULL_SWING';

  detectConfidence(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    // Strong signal: LM FSID or BatterId are unique to Full Swing
    if (lower.some(h => h === 'lm fsid' || h === 'batterid' || h === 'pitchno')) {
      return 1;
    }
    const matches = FULLSWING_IDENTIFIERS.filter(id =>
      lower.some(h => h.includes(id))
    );
    // Distinguish from HitTrax: if headers contain "hittrax" give 0
    if (lower.some(h => h.includes('hittrax'))) return 0;
    return Math.min(matches.length / 3, 1);
  }

  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult {
    const success: ParsedMetric[] = [];
    const errors: ParseResult['errors'] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const playerName = this.findPlayerName(row);
      if (!playerName) {
        errors.push({ row: i + 1, message: 'No player name found', rawData: row });
        continue;
      }

      const rowDate = this.findDate(row) || recordedAt;

      for (const [csvCol, value] of Object.entries(row)) {
        const mapping = COLUMN_MAP[csvCol.toLowerCase().trim()];
        if (!mapping) continue;

        // Skip null/empty values (Full Swing uses literal "null" for misses)
        if (!value || value.trim() === '' || value.trim().toLowerCase() === 'null') continue;

        let num = parseFloat(value);
        if (isNaN(num)) continue;

        // Apply transform if needed (e.g., SquaredUp decimal → percentage)
        if (mapping.transform) {
          num = mapping.transform(num);
        }

        success.push({
          playerName,
          metricType: mapping.metric,
          value: Math.round(num * 100) / 100,
          unit: mapping.unit,
          recordedAt: rowDate,
          rawData: row,
        });
      }
    }

    return { success, errors, totalRows: rows.length };
  }

  private findPlayerName(row: Record<string, string>): string | null {
    const nameKeys = ['batter', 'player name', 'player', 'name', 'athlete', 'hitter'];
    for (const key of nameKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) return match[1].trim();
    }
    return null;
  }

  private findDate(row: Record<string, string>): Date | null {
    // Combine Date + Time columns for a unique timestamp per pitch
    let dateStr: string | null = null;
    let timeStr: string | null = null;

    for (const [k, v] of Object.entries(row)) {
      const lower = k.toLowerCase().trim();
      if (lower === 'date' || lower === 'session date') dateStr = v?.trim() || null;
      if (lower === 'time') timeStr = v?.trim() || null;
    }

    if (dateStr) {
      // Expand 2-digit year: "3/9/26" → "3/9/2026"
      const parts = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (parts) {
        const yr = parseInt(parts[3]);
        const fullYear = yr < 50 ? 2000 + yr : 1900 + yr;
        dateStr = `${parts[1]}/${parts[2]}/${fullYear}`;
      }

      const combined = timeStr ? `${dateStr} ${timeStr}` : dateStr;
      const d = new Date(combined);
      if (!isNaN(d.getTime())) return d;
    }

    return null;
  }
}
