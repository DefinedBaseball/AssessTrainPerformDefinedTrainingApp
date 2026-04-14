import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * HitTrax CSV Parser
 *
 * Expected columns (from HitTrax data export):
 *   Player, Date, Exit Velo, Launch Angle, Distance, Result,
 *   Strike Zone, Pitch Speed, Pitch Type, Hard Hit
 *
 * HitTrax is similar to Full Swing but often includes pitch info and
 * game simulation data. The key differentiator is "HitTrax" in headers
 * or columns like "Strike Zone" and "Pitch Speed".
 *
 * NOTE: Update COLUMN_MAP when you get a real HitTrax export.
 */

const COLUMN_MAP: Record<string, { metric: string; unit: string }> = {
  'exit velo':              { metric: 'max_exit_velo', unit: 'mph' },
  'exit velocity':          { metric: 'max_exit_velo', unit: 'mph' },
  'exit speed':             { metric: 'max_exit_velo', unit: 'mph' },
  'avg exit velo':          { metric: 'avg_exit_velo', unit: 'mph' },
  'launch angle':           { metric: 'launch_angle', unit: 'deg' },
  'la':                     { metric: 'launch_angle', unit: 'deg' },
  'distance':               { metric: 'distance', unit: 'ft' },
  'max distance':           { metric: 'max_distance', unit: 'ft' },
  'pitch speed':            { metric: 'pitch_speed', unit: 'mph' },
  'hard hit':               { metric: 'hard_hit_pct', unit: '%' },
  'hard hit %':             { metric: 'hard_hit_pct', unit: '%' },
  'line drive %':           { metric: 'line_drive_pct', unit: '%' },
  'ground ball %':          { metric: 'ground_ball_pct', unit: '%' },
  'fly ball %':             { metric: 'fly_ball_pct', unit: '%' },
  'points':                 { metric: 'hittrax_points', unit: '' },
  'batting avg':            { metric: 'batting_avg', unit: '' },
  'slg':                    { metric: 'slg', unit: '' },
};

const HITTRAX_IDENTIFIERS = [
  'hittrax', 'strike zone', 'pitch speed', 'pitch type',
  'exit velo', 'points', 'batting avg',
];

export class HitTraxParser implements VendorParser {
  source = 'HITTRAX';

  detectConfidence(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const matches = HITTRAX_IDENTIFIERS.filter(id =>
      lower.some(h => h.includes(id))
    );
    // Boost confidence if "hittrax" appears in any header
    const hasHitTrax = lower.some(h => h.includes('hittrax')) ? 0.5 : 0;
    return Math.min((matches.length / 3) + hasHitTrax, 1);
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

        const num = parseFloat(value);
        if (isNaN(num)) continue;

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
    const nameKeys = ['player', 'player name', 'name', 'athlete', 'hitter'];
    for (const key of nameKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) return match[1].trim();
    }
    return null;
  }

  private findDate(row: Record<string, string>): Date | null {
    const dateKeys = ['date', 'session date', 'timestamp', 'time'];
    for (const key of dateKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) {
        const d = new Date(match[1].trim());
        if (!isNaN(d.getTime())) return d;
      }
    }
    return null;
  }
}
