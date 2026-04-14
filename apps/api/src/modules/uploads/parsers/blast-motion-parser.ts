import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * Blast Motion CSV Parser
 *
 * Expected columns (from Blast Connect export):
 *   Player Name, Date, Bat Speed (mph), Peak Hand Speed (mph),
 *   Attack Angle (deg), Time to Contact (s), Vertical Bat Angle (deg),
 *   On Plane Efficiency (%), Rotational Acceleration (g),
 *   Early Connection (%), Connection at Impact (%)
 *
 * NOTE: Column names may vary by Blast firmware version.
 * If your CSV has different headers, update the COLUMN_MAP below.
 */

const COLUMN_MAP: Record<string, { metric: string; unit: string }> = {
  'bat speed (mph)':           { metric: 'max_bat_speed', unit: 'mph' },
  'bat speed':                 { metric: 'max_bat_speed', unit: 'mph' },
  'avg bat speed':             { metric: 'avg_bat_speed', unit: 'mph' },
  'avg bat speed (mph)':       { metric: 'avg_bat_speed', unit: 'mph' },
  'peak hand speed (mph)':     { metric: 'peak_hand_speed', unit: 'mph' },
  'peak hand speed':           { metric: 'peak_hand_speed', unit: 'mph' },
  'hand speed (mph)':          { metric: 'peak_hand_speed', unit: 'mph' },
  'attack angle (deg)':        { metric: 'attack_angle', unit: 'deg' },
  'attack angle':              { metric: 'attack_angle', unit: 'deg' },
  'time to contact (s)':       { metric: 'time_to_contact', unit: 'sec' },
  'time to contact (sec)':     { metric: 'time_to_contact', unit: 'sec' },
  'time to contact':           { metric: 'time_to_contact', unit: 'sec' },
  'vertical bat angle (deg)':  { metric: 'vertical_bat_angle', unit: 'deg' },
  'vertical bat angle':        { metric: 'vertical_bat_angle', unit: 'deg' },
  'on plane efficiency (%)':   { metric: 'on_plane_efficiency', unit: '%' },
  'on plane efficiency':       { metric: 'on_plane_efficiency', unit: '%' },
  'on plane eff':              { metric: 'on_plane_efficiency', unit: '%' },
  'rotational acceleration (g)': { metric: 'rotational_accel', unit: 'g' },
  'rotational acceleration':   { metric: 'rotational_accel', unit: 'g' },
  'early connection (%)':      { metric: 'early_connection', unit: '%' },
  'early connection':          { metric: 'early_connection', unit: '%' },
  'early connection (deg)':    { metric: 'early_connection', unit: 'deg' },
  'connection at impact (%)':  { metric: 'connection_at_impact', unit: '%' },
  'connection at impact':      { metric: 'connection_at_impact', unit: '%' },
  'connection at impact (deg)': { metric: 'connection_at_impact', unit: 'deg' },
  'plane score':               { metric: 'plane_angle', unit: 'deg' },
  'plane angle':               { metric: 'plane_angle', unit: 'deg' },
  'power (kw)':                { metric: 'power_output', unit: 'kW' },
  'power':                     { metric: 'power_output', unit: 'kW' },
};

const BLAST_IDENTIFIERS = [
  'bat speed', 'attack angle', 'time to contact',
  'on plane', 'rotational acceleration', 'early connection',
  'connection at impact', 'blast',
];

export class BlastMotionParser implements VendorParser {
  source = 'BLAST_MOTION';

  detectConfidence(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const matches = BLAST_IDENTIFIERS.filter(id =>
      lower.some(h => h.includes(id))
    );
    return Math.min(matches.length / 3, 1);
  }

  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult {
    const success: ParsedMetric[] = [];
    const errors: ParseResult['errors'] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Use player name from CSV if present, otherwise use fallback
      // (csv-processing service will override with direct playerId when provided)
      const playerName = this.findPlayerName(row) || '_blast_upload_';

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
    const nameKeys = ['player name', 'player', 'name', 'athlete', 'athlete name'];
    for (const key of nameKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) return match[1].trim();
    }
    return null;
  }

  private findDate(row: Record<string, string>): Date | null {
    const dateKeys = ['date', 'session date', 'timestamp'];
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
