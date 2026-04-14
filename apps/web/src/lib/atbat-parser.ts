/**
 * At-Bat Assessment XLSX Parser
 *
 * Parses the custom At-Bat Assessment Excel format:
 *   Sheet 1 "At-Bat Results":
 *     - A1: Player name
 *     - B1..U1: "At Bat 1" .. "At Bat 20"
 *     - Rows come in groups of 3 per pitch:
 *         "Pitch N Type"  | pitchType values per AB column
 *         "Ball -Strike"  | Ball or Strike per AB column
 *         "Result"        | result values per AB column
 *     - Up to 15 pitches per at-bat (45 data rows)
 *     - Empty cells = at-bat ended
 */

import * as XLSX from 'xlsx';

/* ── Types ── */

export interface AtBatPitch {
  pitchNumber: number;
  type: string;          // 'Fastball', 'Sinker', 'Cutter', 'Slider', 'Curveball', 'Changeup', etc.
  ballStrike: string;    // 'Ball' | 'Strike'
  result: string;        // 'Strike Looking', 'Swinging Strike', 'Ball', 'Foul', 'Barrel', 'Pop-Out', 'Ground-Out', 'Walk', 'Strike Out Looking', 'Strike Out Swinging'
}

export interface AtBat {
  number: number;
  pitches: AtBatPitch[];
  finalResult: string;
}

export interface AtBatMetrics {
  fbBarrelPct: number | null;
  fbWhiffPct: number | null;
  fbInZoneSwingPct: number | null;
  fbChasePct: number | null;
  osBarrelPct: number | null;
  osWhiffPct: number | null;
  osInZoneSwingPct: number | null;
  osChasePct: number | null;
  overallBarrelPct: number | null;
  overallBbPct: number | null;
  overallKPct: number | null;
  avgEv: number | null;
}

export interface AtBatAssessment {
  playerName: string;
  atBats: AtBat[];
  metrics: AtBatMetrics;
}

/* ── Constants ── */

const FB_TYPES = ['Fastball', 'Sinker'];
const OS_TYPES = ['Curveball', 'Slider', 'Sweeper', 'Cutter', 'Changeup', 'Splitter'];
const SWING_RESULTS = [
  'Swinging Strike', 'Foul', 'Barrel', 'Pop-Out', 'Ground-Out', 'Strike Out Swinging',
];

/* ── Parser ── */

export function parseAtBatXlsx(buffer: ArrayBuffer): AtBatAssessment {
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];

  if (!ws) throw new Error('No sheets found in the workbook');

  // Convert to 2D array (rows x cols)
  const data: (string | number | undefined)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: undefined,
  });

  if (!data || data.length < 4) {
    throw new Error('Invalid At-Bat Assessment file: insufficient data rows');
  }

  // Row 0: A1 = player name, B1+ = "At Bat 1", "At Bat 2", ...
  const playerName = String(data[0]?.[0] || '').trim();

  // Determine number of at-bats from header row
  const headerRow = data[0] || [];
  let numAtBatCols = 0;
  for (let i = 1; i < headerRow.length; i++) {
    const val = String(headerRow[i] || '').trim().toLowerCase();
    if (val.startsWith('at bat') || val.startsWith('ab')) {
      numAtBatCols = i; // track the last valid AB column index
    }
  }
  // If we found AB columns, numAtBatCols is the last index; count = numAtBatCols
  // Actually, let's just count all non-empty columns after A
  const abColCount = headerRow.filter((v, i) => i > 0 && v && String(v).trim()).length;

  // Parse at-bats
  const atBats: AtBat[] = [];

  for (let abIdx = 0; abIdx < abColCount; abIdx++) {
    const colIdx = abIdx + 1; // column B=1, C=2, etc.
    const pitches: AtBatPitch[] = [];

    // Rows come in groups of 3: Type, Ball-Strike, Result
    // Starting from row 1 (0-indexed)
    let rowIdx = 1;
    let pitchNum = 1;

    while (rowIdx + 2 < data.length && pitchNum <= 15) {
      const typeVal = String(data[rowIdx]?.[colIdx] ?? '').trim();
      const bsVal = String(data[rowIdx + 1]?.[colIdx] ?? '').trim();
      const resultVal = String(data[rowIdx + 2]?.[colIdx] ?? '').trim();

      // Empty type means no more pitches in this at-bat
      if (!typeVal) break;

      pitches.push({
        pitchNumber: pitchNum,
        type: typeVal,
        ballStrike: bsVal,
        result: resultVal,
      });

      pitchNum++;
      rowIdx += 3;
    }

    if (pitches.length > 0) {
      atBats.push({
        number: abIdx + 1,
        pitches,
        finalResult: pitches[pitches.length - 1].result,
      });
    }
  }

  const metrics = calculateMetrics(atBats);

  return { playerName, atBats, metrics };
}

/* ── Metric Calculations ── */

function isSwing(result: string): boolean {
  return SWING_RESULTS.includes(result);
}

function isFB(type: string): boolean {
  return FB_TYPES.includes(type);
}

function isOS(type: string): boolean {
  return OS_TYPES.includes(type);
}

function pct(num: number, den: number): number | null {
  if (den === 0) return null;
  return (num / den) * 100;
}

export function calculateMetrics(atBats: AtBat[]): AtBatMetrics {
  const allPitches = atBats.flatMap(ab => ab.pitches);

  // ── Fastball metrics ──
  const fbPitches = allPitches.filter(p => isFB(p.type));
  const fbSwings = fbPitches.filter(p => isSwing(p.result));
  const fbStrikes = fbPitches.filter(p => p.ballStrike === 'Strike');
  const fbBalls = fbPitches.filter(p => p.ballStrike === 'Ball');

  // ── Offspeed metrics ──
  const osPitches = allPitches.filter(p => isOS(p.type));
  const osSwings = osPitches.filter(p => isSwing(p.result));
  const osStrikes = osPitches.filter(p => p.ballStrike === 'Strike');
  const osBalls = osPitches.filter(p => p.ballStrike === 'Ball');

  // ── Overall ──
  const allSwings = allPitches.filter(p => isSwing(p.result));
  const totalABs = atBats.length;
  const walks = atBats.filter(ab => ab.finalResult === 'Walk').length;
  const strikeouts = atBats.filter(ab =>
    ab.finalResult === 'Strike Out Looking' || ab.finalResult === 'Strike Out Swinging'
  ).length;

  return {
    // FB
    fbBarrelPct: pct(
      fbSwings.filter(p => p.result === 'Barrel').length,
      fbSwings.length,
    ),
    fbWhiffPct: pct(
      fbSwings.filter(p => p.result === 'Swinging Strike' || p.result === 'Strike Out Swinging').length,
      fbSwings.length,
    ),
    fbInZoneSwingPct: pct(
      fbStrikes.filter(p => isSwing(p.result)).length,
      fbStrikes.length,
    ),
    fbChasePct: pct(
      fbBalls.filter(p => isSwing(p.result)).length,
      fbBalls.length,
    ),
    // OS
    osBarrelPct: pct(
      osSwings.filter(p => p.result === 'Barrel').length,
      osSwings.length,
    ),
    osWhiffPct: pct(
      osSwings.filter(p => p.result === 'Swinging Strike' || p.result === 'Strike Out Swinging').length,
      osSwings.length,
    ),
    osInZoneSwingPct: pct(
      osStrikes.filter(p => isSwing(p.result)).length,
      osStrikes.length,
    ),
    osChasePct: pct(
      osBalls.filter(p => isSwing(p.result)).length,
      osBalls.length,
    ),
    // Overall
    overallBarrelPct: pct(
      allSwings.filter(p => p.result === 'Barrel').length,
      allSwings.length,
    ),
    overallBbPct: pct(walks, totalABs),
    overallKPct: pct(strikeouts, totalABs),
    avgEv: null, // Set separately from Full Swing data
  };
}
