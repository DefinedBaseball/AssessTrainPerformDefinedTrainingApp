import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * Blast Motion CSV Parser
 *
 * Real Blast Connect export starts the actual data table at row 9 (rows 1-8
 * are session metadata: player name, date, location, etc.). The csv-
 * processing service auto-skips metadata rows by finding the first row with
 * 4+ comma-separated columns, which lands on the row-9 header line.
 *
 * Column → metric mapping (per-row values):
 *   H  Bat Speed (mph)              → max_bat_speed (MAX) + avg_bat_speed (MEAN)
 *   J  On Plane Efficiency (%)      → on_plane_efficiency (MEAN)
 *   K  Attack Angle (deg)           → attack_angle (MEAN)
 *   N  Vertical Bat Angle (deg)     → plane_angle / Tilt (MEAN)
 *   O  Power (kW)                   → power_output (MEAN)
 *   P  Time to Contact (sec)        → time_to_contact (MEAN)
 *      Peak Hand Speed (mph)        → peak_hand_speed (MEAN)
 *
 * Each session emits ONE summary row per metric (mean / max), tagged at the
 * session's most-recent date. The Hitting Snapshot's Blast section reads
 * those summary rows directly — no further aggregation needed downstream.
 */

const BLAST_IDENTIFIERS = [
  'bat speed', 'attack angle', 'time to contact',
  'on plane', 'rotational acceleration', 'early connection',
  'connection at impact', 'blast', 'vertical bat angle',
];

/** Header normaliser — trims, lowercases, and strips trailing unit suffix
 *  in parens so "Bat Speed (mph)" / "Bat Speed" both match the same key. */
function normHeader(h: string): string {
  return h.toLowerCase().trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
}

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

    /* Pull all per-row numeric values for each tracked column. We accept
       multiple header aliases per metric (e.g. Blast versions sometimes
       drop the "(mph)" suffix or use "Plane Score" for On Plane
       Efficiency). The lookup is on the normalised header so trailing
       unit suffixes don't break the match. */
    /* Column → metric map. Real Blast Connect exports look like:
         Date, Equipment, Handedness, Swing Details,
         Plane Score, Connection Score, Rotation Score,
         Bat Speed (mph), Rotational Acceleration (g),
         On Plane Efficiency (%), Attack Angle (deg),
         Early Connection (deg), Connection at Impact (deg),
         Vertical Bat Angle (deg), Power (kW),
         Time to Contact (sec), Peak Hand Speed (mph), ...
       Critical: "Plane Score" (col E) and "On Plane Efficiency" (col J)
       are DIFFERENT columns — Plane Score is Blast's 0-100 swing-quality
       grade for the plane component, On Plane Efficiency is the % time
       on plane. Mapping both into on_plane_efficiency was averaging two
       unrelated columns together and producing nonsense. We use ONLY
       the "On Plane Efficiency" column for the Plane chip; Plane Score
       is ignored. Same intent for "vertical bat angle" → tilt
       (plane_angle); we don't conflate it with anything else. */
    const HEADER_TO_METRIC: Record<string, string> = {
      'bat speed':                'bat_speed_raw',     // → max + avg
      'attack angle':             'attack_angle',
      'time to contact':          'time_to_contact',
      'vertical bat angle':       'plane_angle',
      'on plane efficiency':      'on_plane_efficiency',
      'on plane eff':             'on_plane_efficiency',
      'power':                    'power_output',
      'peak hand speed':          'peak_hand_speed',
      'hand speed':               'peak_hand_speed',
      // Additional Blast columns surfaced in the Hitting Snapshot's Blast
      // bubble (averages). The composite Connection/Rotation Score columns and
      // the connection-degree readings use clean, dedicated metric keys that
      // match the frontend's SWING_METRIC_KEYS. NOTE: Rotational Acceleration
      // uses `rotational_accel_g` — deliberately NOT the legacy
      // `rotational_acceleration` / `connection_at_contact` keys, which are
      // overloaded as derived-score sources elsewhere in the app.
      'connection score':         'connection_score',
      'rotation score':           'rotation_score',
      'rotational acceleration':  'rotational_accel_g',
      'early connection':         'early_connection',
      'connection at impact':     'connection_at_impact',
    };

    // Bucket every numeric value per target metric. No swing filter, no
    // per-metric zero filter — coach spec is literally "the average of
    // all numbers in this column". Empty cells parse as NaN and are
    // skipped automatically; everything that parses as a number is in.
    const buckets: Record<string, number[]> = {};

    let lastDate: Date = recordedAt;
    let lastPlayerName = '_blast_upload_';

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const playerName = this.findPlayerName(row) || '_blast_upload_';
      const rowDate = this.findDate(row) || recordedAt;
      lastPlayerName = playerName;
      lastDate = rowDate;

      for (const [csvCol, value] of Object.entries(row)) {
        const key = normHeader(csvCol);
        const target = HEADER_TO_METRIC[key];
        if (!target) continue;
        const num = parseFloat(value);
        if (!Number.isFinite(num)) continue;
        if (!buckets[target]) buckets[target] = [];
        buckets[target].push(num);
      }
    }

    /* Emit ONE summary metric per target. Bat speed produces both
       max_bat_speed (the session's top swing) and avg_bat_speed (mean
       across every swing); everything else is the per-session mean. */
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const mean = (arr: number[]) => arr.reduce((s, n) => s + n, 0) / arr.length;
    const push = (metricType: string, value: number, unit: string) => {
      success.push({
        playerName: lastPlayerName,
        metricType,
        value: round2(value),
        unit,
        recordedAt: lastDate,
        rawData: { type: 'session_summary' },
      });
    };

    if (buckets.bat_speed_raw && buckets.bat_speed_raw.length > 0) {
      push('max_bat_speed', Math.max(...buckets.bat_speed_raw), 'mph');
      push('avg_bat_speed', mean(buckets.bat_speed_raw), 'mph');
    }
    if (buckets.attack_angle && buckets.attack_angle.length > 0) {
      push('attack_angle', mean(buckets.attack_angle), 'deg');
    }
    if (buckets.time_to_contact && buckets.time_to_contact.length > 0) {
      push('time_to_contact', mean(buckets.time_to_contact), 'sec');
    }
    if (buckets.plane_angle && buckets.plane_angle.length > 0) {
      push('plane_angle', mean(buckets.plane_angle), 'deg');
    }
    if (buckets.on_plane_efficiency && buckets.on_plane_efficiency.length > 0) {
      push('on_plane_efficiency', mean(buckets.on_plane_efficiency), '%');
    }
    if (buckets.power_output && buckets.power_output.length > 0) {
      push('power_output', mean(buckets.power_output), 'kW');
    }
    if (buckets.peak_hand_speed && buckets.peak_hand_speed.length > 0) {
      push('peak_hand_speed', mean(buckets.peak_hand_speed), 'mph');
    }
    // Blast bubble additions — session averages for the composite scores and
    // connection-degree readings (shown in the Hitting Snapshot's Blast bubble).
    if (buckets.connection_score && buckets.connection_score.length > 0) {
      push('connection_score', mean(buckets.connection_score), '');
    }
    if (buckets.rotation_score && buckets.rotation_score.length > 0) {
      push('rotation_score', mean(buckets.rotation_score), '');
    }
    if (buckets.rotational_accel_g && buckets.rotational_accel_g.length > 0) {
      push('rotational_accel_g', mean(buckets.rotational_accel_g), 'g');
    }
    if (buckets.early_connection && buckets.early_connection.length > 0) {
      push('early_connection', mean(buckets.early_connection), 'deg');
    }
    if (buckets.connection_at_impact && buckets.connection_at_impact.length > 0) {
      push('connection_at_impact', mean(buckets.connection_at_impact), 'deg');
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
