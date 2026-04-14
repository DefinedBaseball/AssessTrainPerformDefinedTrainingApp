import { VendorParser, ParseResult } from './base-parser';
import { BlastMotionParser } from './blast-motion-parser';
import { FullSwingParser } from './full-swing-parser';
import { HitTraxParser } from './hittrax-parser';
import { TrackmanParser } from './trackman-parser';
import { ValdParser } from './vald-parser';

/**
 * Parser Registry
 *
 * Auto-detects which vendor a CSV belongs to by running
 * detectConfidence() on all registered parsers and picking
 * the highest-scoring one.
 *
 * To add a new vendor:
 *   1. Create the parser (implements VendorParser)
 *   2. Add it to the PARSERS array below
 */

const PARSERS: VendorParser[] = [
  new BlastMotionParser(),
  new FullSwingParser(),
  new HitTraxParser(),
  new TrackmanParser(),
  new ValdParser(),
];

export interface DetectionResult {
  parser: VendorParser;
  confidence: number;
}

/**
 * Detect the best parser for the given CSV headers.
 * Returns null if no parser scores above the minimum threshold.
 */
export function detectParser(
  headers: string[],
  minConfidence = 0.3,
): DetectionResult | null {
  let best: DetectionResult | null = null;

  for (const parser of PARSERS) {
    const confidence = parser.detectConfidence(headers);
    if (confidence >= minConfidence && (!best || confidence > best.confidence)) {
      best = { parser, confidence };
    }
  }

  return best;
}

/**
 * Get a specific parser by source name (e.g., 'TRACKMAN').
 * Use when the coach manually selects the vendor.
 */
export function getParserBySource(source: string): VendorParser | null {
  return PARSERS.find(p => p.source === source.toUpperCase()) || null;
}

/**
 * Get all registered parser source names.
 */
export function getRegisteredSources(): string[] {
  return PARSERS.map(p => p.source);
}
