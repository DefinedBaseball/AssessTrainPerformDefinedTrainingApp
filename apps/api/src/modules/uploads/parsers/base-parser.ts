/**
 * Base interface for all vendor CSV parsers.
 * Each vendor parser implements this interface.
 *
 * To add a new vendor:
 *   1. Create a new file in this directory (e.g., rapsodo-parser.ts)
 *   2. Implement the VendorParser interface
 *   3. Register it in parser-registry.ts
 */

export interface ParsedMetric {
  playerName: string;      // raw name from CSV — matched to DB player
  metricType: string;       // normalized metric key (e.g., 'max_exit_velo')
  value: number;
  unit: string;
  recordedAt: Date;
  rawData: Record<string, any>;  // original row for debugging
}

export interface ParseResult {
  success: ParsedMetric[];
  errors: { row: number; message: string; rawData?: Record<string, any> }[];
  totalRows: number;
}

export interface VendorParser {
  source: string;
  /**
   * Detect whether a CSV belongs to this vendor by examining headers.
   * Returns a confidence score 0-1.
   */
  detectConfidence(headers: string[]): number;
  /**
   * Parse CSV rows into normalized metrics.
   */
  parse(rows: Record<string, string>[], recordedAt: Date): ParseResult;
}
