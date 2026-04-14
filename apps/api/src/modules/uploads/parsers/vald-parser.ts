import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * VALD Performance CSV Parser
 *
 * Supports ForceDecks (jump testing), NordBord (hamstring),
 * and ForceFrame (isometric strength) exports.
 *
 * Expected columns vary by device:
 *   ForceDecks: Athlete, Date, Jump Height (cm), RSI Modified,
 *     Peak Force (N), Peak Power (W), Braking RFD (N/s)
 *   NordBord: Athlete, Date, Left Max Force (N), Right Max Force (N),
 *     Imbalance (%)
 *   ForceFrame: Athlete, Date, Test, Left Force (N), Right Force (N)
 */

const COLUMN_MAP: Record<string, { metric: string; unit: string }> = {
  // ForceDecks — Jump Testing
  'jump height (cm)':         { metric: 'jump_height', unit: 'cm' },
  'jump height':              { metric: 'jump_height', unit: 'cm' },
  'cmj height':               { metric: 'jump_height', unit: 'cm' },
  'rsi modified':             { metric: 'rsi_modified', unit: '' },
  'rsi-mod':                  { metric: 'rsi_modified', unit: '' },
  'rsi':                      { metric: 'rsi_modified', unit: '' },
  'peak force (n)':           { metric: 'peak_force', unit: 'N' },
  'peak force':               { metric: 'peak_force', unit: 'N' },
  'peak landing force':       { metric: 'peak_landing_force', unit: 'N' },
  'peak landing force (n)':   { metric: 'peak_landing_force', unit: 'N' },
  'peak power (w)':           { metric: 'peak_power', unit: 'W' },
  'peak power':               { metric: 'peak_power', unit: 'W' },
  'concentric peak power':    { metric: 'peak_power', unit: 'W' },
  'braking rfd (n/s)':        { metric: 'braking_rfd', unit: 'N/s' },
  'braking rfd':              { metric: 'braking_rfd', unit: 'N/s' },
  'eccentric braking rfd':    { metric: 'braking_rfd', unit: 'N/s' },
  'force at zero velocity':   { metric: 'force_at_zero_velocity', unit: 'N' },
  'force at zero velocity (n)': { metric: 'force_at_zero_velocity', unit: 'N' },
  'contraction time (ms)':    { metric: 'contraction_time', unit: 'ms' },
  'contraction time':         { metric: 'contraction_time', unit: 'ms' },
  'eccentric duration (ms)':  { metric: 'eccentric_duration', unit: 'ms' },
  'eccentric duration':       { metric: 'eccentric_duration', unit: 'ms' },
  'concentric duration (ms)': { metric: 'concentric_duration', unit: 'ms' },
  'concentric duration':      { metric: 'concentric_duration', unit: 'ms' },

  // NordBord — Hamstring Testing
  'left max force (n)':       { metric: 'nord_left_force', unit: 'N' },
  'left max force':           { metric: 'nord_left_force', unit: 'N' },
  'left force (n)':           { metric: 'nord_left_force', unit: 'N' },
  'right max force (n)':      { metric: 'nord_right_force', unit: 'N' },
  'right max force':          { metric: 'nord_right_force', unit: 'N' },
  'right force (n)':          { metric: 'nord_right_force', unit: 'N' },
  'imbalance (%)':            { metric: 'nord_imbalance', unit: '%' },
  'imbalance':                { metric: 'nord_imbalance', unit: '%' },
  'avg force (n)':            { metric: 'nord_avg_force', unit: 'N' },
  'avg force':                { metric: 'nord_avg_force', unit: 'N' },

  // ForceFrame — Isometric Strength
  'left force':               { metric: 'iso_left_force', unit: 'N' },
  'right force':              { metric: 'iso_right_force', unit: 'N' },
  'peak torque (nm)':         { metric: 'peak_torque', unit: 'Nm' },
  'peak torque':              { metric: 'peak_torque', unit: 'Nm' },
};

const VALD_IDENTIFIERS = [
  'jump height', 'rsi modified', 'peak force', 'peak power',
  'braking rfd', 'nordbord', 'forcedecks', 'forceframe',
  'left max force', 'right max force', 'imbalance', 'vald',
];

export class ValdParser implements VendorParser {
  source = 'VALD';

  detectConfidence(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const matches = VALD_IDENTIFIERS.filter(id =>
      lower.some(h => h.includes(id))
    );
    // Boost if "vald", "forcedecks", "nordbord", or "forceframe" appears
    const hasBrand = lower.some(h =>
      h.includes('vald') || h.includes('forcedecks') ||
      h.includes('nordbord') || h.includes('forceframe')
    ) ? 0.5 : 0;
    return Math.min((matches.length / 3) + hasBrand, 1);
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
    const nameKeys = ['athlete', 'athlete name', 'player', 'player name', 'name'];
    for (const key of nameKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) return match[1].trim();
    }
    return null;
  }

  private findDate(row: Record<string, string>): Date | null {
    const dateKeys = ['date', 'test date', 'session date', 'timestamp'];
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
