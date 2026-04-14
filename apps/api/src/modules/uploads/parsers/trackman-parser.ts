import { VendorParser, ParseResult, ParsedMetric } from './base-parser';

/**
 * Trackman CSV/XLSX Parser
 *
 * Handles real Trackman exports with 140+ columns.
 * Stores each pitch as a single 'trackman_pitch' metric with full rawData,
 * AND extracts aggregate summary metrics (fb_max_velo, spin_rate, etc.).
 *
 * Key columns from real Trackman data:
 *   PitcherId, Date, TaggedPitchType, RelSpeed, SpinRate, SpinAxis, Tilt,
 *   RelHeight, RelSide, Extension, VertBreak, InducedVertBreak, HorzBreak,
 *   PlateLocHeight, PlateLocSide, ZoneSpeed, EffectiveVelo,
 *   VertApprAngle, HorzApprAngle, PitchCall
 */

/* ── Column name normalization ── */
// Map various possible column header names to our canonical keys
const COLUMN_ALIASES: Record<string, string> = {
  // Pitch type
  'taggedpitchtype': 'pitchType',
  'tagged pitch type': 'pitchType',
  'autopitchtype': 'autoPitchType',
  'auto pitch type': 'autoPitchType',
  'pitch type': 'pitchType',
  'pitchtype': 'pitchType',

  // Velocity
  'relspeed': 'relSpeed',
  'rel speed': 'relSpeed',
  'release speed': 'relSpeed',
  'pitch speed': 'relSpeed',
  'velocity': 'relSpeed',
  'velo': 'relSpeed',
  'zonespeed': 'zoneSpeed',
  'zone speed': 'zoneSpeed',
  'effectivevelo': 'effectiveVelo',
  'effective velo': 'effectiveVelo',

  // Spin
  'spinrate': 'spinRate',
  'spin rate': 'spinRate',
  'spin rate (rpm)': 'spinRate',
  'spinaxis': 'spinAxis',
  'spin axis': 'spinAxis',
  'tilt': 'tilt',

  // Release point
  'relheight': 'relHeight',
  'rel height': 'relHeight',
  'release height': 'relHeight',
  'release height (ft)': 'relHeight',
  'relside': 'relSide',
  'rel side': 'relSide',
  'release side': 'relSide',
  'release side (ft)': 'relSide',
  'extension': 'extension',
  'extension (ft)': 'extension',

  // Break
  'horzbreak': 'horzBreak',
  'horz break': 'horzBreak',
  'horizontal break': 'horzBreak',
  'horizontal break (in)': 'horzBreak',
  'hb': 'horzBreak',
  'vertbreak': 'vertBreak',
  'vert break': 'vertBreak',
  'vertical break': 'vertBreak',
  'vertical break (in)': 'vertBreak',
  'inducedvertbreak': 'inducedVertBreak',
  'induced vertical break': 'inducedVertBreak',
  'induced vert break': 'inducedVertBreak',
  'ivb': 'inducedVertBreak',

  // Plate location
  'platelocheight': 'plateLocHeight',
  'plate loc height': 'plateLocHeight',
  'plateloczheight': 'plateLocHeight',
  'platelocside': 'plateLocSide',
  'plate loc side': 'plateLocSide',

  // Approach angle
  'vertapprange': 'vertApprAngle',
  'vertapprangl': 'vertApprAngle',
  'vert appr angle': 'vertApprAngle',
  'horzapprangl': 'horzApprAngle',
  'horzapprangle': 'horzApprAngle',
  'horz appr angle': 'horzApprAngle',

  // Game context
  'pitchcall': 'pitchCall',
  'pitch call': 'pitchCall',
  'pitcherid': 'pitcherId',
  'pitcher id': 'pitcherId',
  'pitcher': 'pitcher',
  'player': 'pitcher',
  'player name': 'pitcher',
  'name': 'pitcher',
  'athlete': 'pitcher',
  'pitchno': 'pitchNo',
  'pitch no': 'pitchNo',
  'pitcherthrows': 'pitcherThrows',
  'pitcher throws': 'pitcherThrows',
  'pitchhand': 'pitcherThrows',
  'pitch hand': 'pitcherThrows',
  'throws': 'pitcherThrows',

  // Date
  'date': 'date',
  'session date': 'date',
  'timestamp': 'date',
  'time': 'date',
};

const TRACKMAN_IDENTIFIERS = [
  'relspeed', 'spinrate', 'horzbreak', 'vertbreak', 'inducedvertbreak',
  'relheight', 'extension', 'taggedpitchtype', 'platelocheight',
  'spin rate', 'horizontal break', 'vertical break', 'release height',
  'extension', 'trackman', 'induced vertical', 'pitch type',
  'platelocside', 'spinaxis', 'tilt', 'pitcherid',
];

/* ── Pitch type normalization ── */
const PITCH_TYPE_MAP: Record<string, string> = {
  'fastball': 'Fastball',
  'four-seam': 'Fastball',
  'fourseam': 'Fastball',
  'four seam': 'Fastball',
  'ff': 'Fastball',
  'fa': 'Fastball',
  'sinker': 'Sinker',
  'two-seam': 'Sinker',
  'twoseam': 'Sinker',
  'si': 'Sinker',
  'ft': 'Sinker',
  'slider': 'Slider',
  'sl': 'Slider',
  'curveball': 'Curveball',
  'curve': 'Curveball',
  'cu': 'Curveball',
  'cb': 'Curveball',
  'changeup': 'ChangeUp',
  'change': 'ChangeUp',
  'ch': 'ChangeUp',
  'cutter': 'Cutter',
  'fc': 'Cutter',
  'ct': 'Cutter',
  'splitter': 'Splitter',
  'split': 'Splitter',
  'fs': 'Splitter',
  'knuckle': 'Knuckleball',
  'kn': 'Knuckleball',
  'sweeper': 'Sweeper',
  'sw': 'Sweeper',
};

function normalizePitchType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return PITCH_TYPE_MAP[lower] || raw.trim();
}

export class TrackmanParser implements VendorParser {
  source = 'TRACKMAN';

  detectConfidence(headers: string[]): number {
    const lower = headers.map(h => h.toLowerCase().trim());
    const matches = TRACKMAN_IDENTIFIERS.filter(id =>
      lower.some(h => h.includes(id) || h.replace(/\s+/g, '') === id)
    );
    return Math.min(matches.length / 4, 1);
  }

  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult {
    const success: ParsedMetric[] = [];
    const errors: ParseResult['errors'] = [];

    // Build column mapping for this specific CSV
    const columnMap = new Map<string, string>(); // csvHeader -> canonical key
    if (rows.length > 0) {
      for (const csvCol of Object.keys(rows[0])) {
        const alias = COLUMN_ALIASES[csvCol.toLowerCase().trim()];
        if (alias) columnMap.set(csvCol, alias);
      }
    }

    // Collect per-pitch data grouped by pitcher
    const pitcherPitches = new Map<string, Record<string, any>[]>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // Normalize the row using our column map
      const normalized: Record<string, any> = {};
      for (const [csvCol, value] of Object.entries(row)) {
        const canonical = columnMap.get(csvCol);
        if (canonical) {
          const trimmed = value?.trim();
          if (!trimmed) {
            normalized[canonical] = null;
          } else {
            const num = parseFloat(trimmed);
            normalized[canonical] = isNaN(num) ? trimmed : num;
          }
        }
      }

      // Get pitcher name or ID
      const pitcherName = this.findPlayerName(row, normalized);
      if (!pitcherName) {
        errors.push({ row: i + 1, message: 'No pitcher/player name found', rawData: row });
        continue;
      }

      // Get pitch type
      const pitchType = normalized.pitchType || normalized.autoPitchType || 'Unknown';

      // Get date
      const rowDate = this.findDate(row, normalized) || recordedAt;

      // Build the pitch data object
      const pitchData: Record<string, any> = {
        pitchType: normalizePitchType(String(pitchType)),
        relSpeed: normalized.relSpeed ?? null,
        spinRate: normalized.spinRate ?? null,
        spinAxis: normalized.spinAxis ?? null,
        tilt: normalized.tilt ?? null,
        relHeight: normalized.relHeight ?? null,
        relSide: normalized.relSide ?? null,
        extension: normalized.extension ?? null,
        vertBreak: normalized.vertBreak ?? null,
        inducedVertBreak: normalized.inducedVertBreak ?? null,
        horzBreak: normalized.horzBreak ?? null,
        plateLocHeight: normalized.plateLocHeight ?? null,
        plateLocSide: normalized.plateLocSide ?? null,
        zoneSpeed: normalized.zoneSpeed ?? null,
        effectiveVelo: normalized.effectiveVelo ?? null,
        vertApprAngle: normalized.vertApprAngle ?? null,
        horzApprAngle: normalized.horzApprAngle ?? null,
        pitchCall: normalized.pitchCall ?? null,
        pitchNo: normalized.pitchNo ?? null,
        pitcherThrows: normalized.pitcherThrows ?? null,
      };

      // Only store if we have at least velocity data
      if (pitchData.relSpeed === null) {
        errors.push({ row: i + 1, message: 'No velocity data found', rawData: row });
        continue;
      }

      // Store as trackman_pitch metric
      success.push({
        playerName: pitcherName,
        metricType: 'trackman_pitch',
        value: Math.round(pitchData.relSpeed * 100) / 100,
        unit: 'mph',
        recordedAt: rowDate,
        rawData: pitchData,
      });

      // Collect for aggregate computation
      if (!pitcherPitches.has(pitcherName)) pitcherPitches.set(pitcherName, []);
      pitcherPitches.get(pitcherName)!.push({ ...pitchData, date: rowDate });
    }

    // Compute aggregate summary metrics per pitcher
    for (const [pitcherName, pitches] of pitcherPitches) {
      const date = pitches[0].date;

      // Fastball-only aggregates
      const fastballs = pitches.filter(p =>
        ['Fastball', 'Sinker', 'Cutter'].includes(p.pitchType)
      );

      if (fastballs.length > 0) {
        const fbVelos = fastballs.map(p => p.relSpeed).filter((v: number) => v != null);
        if (fbVelos.length > 0) {
          success.push({
            playerName: pitcherName,
            metricType: 'fb_max_velo',
            value: Math.round(Math.max(...fbVelos) * 100) / 100,
            unit: 'mph',
            recordedAt: date,
            rawData: { source: 'trackman_aggregate', pitchCount: fbVelos.length },
          });
          success.push({
            playerName: pitcherName,
            metricType: 'fb_avg_velo',
            value: Math.round((fbVelos.reduce((a: number, b: number) => a + b, 0) / fbVelos.length) * 100) / 100,
            unit: 'mph',
            recordedAt: date,
            rawData: { source: 'trackman_aggregate', pitchCount: fbVelos.length },
          });
        }
      }

      // Overall aggregates
      const allSpinRates = pitches.map(p => p.spinRate).filter((v: number) => v != null);
      if (allSpinRates.length > 0) {
        success.push({
          playerName: pitcherName,
          metricType: 'spin_rate',
          value: Math.round((allSpinRates.reduce((a: number, b: number) => a + b, 0) / allSpinRates.length)),
          unit: 'rpm',
          recordedAt: date,
          rawData: { source: 'trackman_aggregate', pitchCount: allSpinRates.length },
        });
      }

      const hBreaks = pitches.map(p => p.horzBreak).filter((v: number) => v != null);
      if (hBreaks.length > 0) {
        success.push({
          playerName: pitcherName,
          metricType: 'h_break',
          value: Math.round((hBreaks.reduce((a: number, b: number) => a + b, 0) / hBreaks.length) * 100) / 100,
          unit: 'in',
          recordedAt: date,
          rawData: { source: 'trackman_aggregate', pitchCount: hBreaks.length },
        });
      }

      const vBreaks = pitches.map(p => p.inducedVertBreak ?? p.vertBreak).filter((v: number) => v != null);
      if (vBreaks.length > 0) {
        success.push({
          playerName: pitcherName,
          metricType: 'v_break',
          value: Math.round((vBreaks.reduce((a: number, b: number) => a + b, 0) / vBreaks.length) * 100) / 100,
          unit: 'in',
          recordedAt: date,
          rawData: { source: 'trackman_aggregate', pitchCount: vBreaks.length },
        });
      }

      const relHeights = pitches.map(p => p.relHeight).filter((v: number) => v != null);
      if (relHeights.length > 0) {
        success.push({
          playerName: pitcherName,
          metricType: 'release_height',
          value: Math.round((relHeights.reduce((a: number, b: number) => a + b, 0) / relHeights.length) * 100) / 100,
          unit: 'ft',
          recordedAt: date,
          rawData: { source: 'trackman_aggregate', pitchCount: relHeights.length },
        });
      }

      const extensions = pitches.map(p => p.extension).filter((v: number) => v != null);
      if (extensions.length > 0) {
        success.push({
          playerName: pitcherName,
          metricType: 'extension',
          value: Math.round((extensions.reduce((a: number, b: number) => a + b, 0) / extensions.length) * 100) / 100,
          unit: 'ft',
          recordedAt: date,
          rawData: { source: 'trackman_aggregate', pitchCount: extensions.length },
        });
      }
    }

    return { success, errors, totalRows: rows.length };
  }

  private findPlayerName(row: Record<string, string>, normalized: Record<string, any>): string | null {
    // Try name-based columns first
    const nameKeys = ['pitcher', 'player', 'player name', 'name', 'athlete', 'pitcherfullname'];
    for (const key of nameKeys) {
      const match = Object.entries(row).find(([k]) => k.toLowerCase().trim() === key);
      if (match && match[1].trim()) return match[1].trim();
    }

    // Fall back to PitcherId — used in real Trackman data
    if (normalized.pitcherId) {
      return `Pitcher_${normalized.pitcherId}`;
    }

    return null;
  }

  private findDate(row: Record<string, string>, normalized: Record<string, any>): Date | null {
    // Check normalized date first
    if (normalized.date && typeof normalized.date === 'string') {
      const d = new Date(normalized.date);
      if (!isNaN(d.getTime())) return d;
    }

    // Try common date column names
    const dateKeys = ['date', 'session date', 'timestamp', 'time', 'gamedate', 'game date'];
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
