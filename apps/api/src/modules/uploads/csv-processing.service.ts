import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaderboardsService } from '../leaderboards/leaderboards.service';
import * as Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { detectParser, getParserBySource } from './parsers/parser-registry';
import { ParsedMetric } from './parsers/base-parser';

export interface CsvProcessingResult {
  uploadId: string;
  detectedSource: string;
  confidence: number;
  totalRows: number;
  metricsCreated: number;
  playersMatched: string[];   // player names successfully matched
  playersUnmatched: string[]; // player names not found in DB
  errors: { row: number; message: string }[];
}

@Injectable()
export class CsvProcessingService {
  private readonly logger = new Logger(CsvProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private leaderboardsService: LeaderboardsService,
  ) {}

  /**
   * Process an uploaded CSV file end-to-end:
   * 1. Parse CSV text with PapaParse
   * 2. Auto-detect or use specified vendor parser
   * 3. Extract metrics from rows
   * 4. Fuzzy-match player names to DB records
   * 5. Save metrics to database
   * 6. Return a summary report
   */
  async processCSV(
    csvText: string,
    uploadId: string,
    uploadedById: string,
    options?: {
      source?: string;       // manual vendor override
      recordedAt?: Date;     // fallback date if not in CSV
      playerId?: string;     // direct player assignment (skip name matching)
    },
  ): Promise<CsvProcessingResult> {
    const recordedAt = options?.recordedAt || new Date();

    // 1. Pre-process CSV to skip metadata header rows (e.g. Blast Connect exports)
    //    Finds the first line with 4+ comma-separated columns as the real header row
    const cleanedCsv = this.skipMetadataRows(csvText);

    const parsed = Papa.parse<Record<string, string>>(cleanedCsv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
    });

    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`CSV parse failed: ${parsed.errors[0].message}`);
    }

    const headers = parsed.meta.fields || [];
    const rows = parsed.data;

    // 2. Detect or select parser
    let parserSource: string;
    let confidence: number;
    let parser;

    if (options?.source) {
      parser = getParserBySource(options.source);
      if (!parser) {
        throw new Error(`Unknown vendor source: ${options.source}`);
      }
      parserSource = parser.source;
      confidence = 1;
    } else {
      const detection = detectParser(headers);
      if (!detection) {
        throw new Error(
          `Could not auto-detect CSV vendor. Headers: ${headers.slice(0, 10).join(', ')}. ` +
          `Try specifying the source manually.`,
        );
      }
      parser = detection.parser;
      parserSource = parser.source;
      confidence = detection.confidence;
    }

    this.logger.log(`Detected source: ${parserSource} (confidence: ${confidence})`);

    // 3. Parse rows into normalized metrics
    const parseResult = parser.parse(rows, recordedAt);

    // 4. Match player names to DB records (or use direct playerId)
    const matchedPlayers = new Set<string>();
    const unmatchedPlayers = new Set<string>();
    const metricsToInsert: {
      playerId: string;
      source: string;
      metricType: string;
      value: number;
      unit: string;
      recordedAt: Date;
      rawData: string;
      uploadId: string;
    }[] = [];

    if (options?.playerId) {
      // Direct assignment — skip name matching
      for (const metric of parseResult.success) {
        matchedPlayers.add(metric.playerName);
        metricsToInsert.push({
          playerId: options.playerId,
          source: parserSource,
          metricType: metric.metricType,
          value: metric.value,
          unit: metric.unit,
          recordedAt: metric.recordedAt,
          rawData: JSON.stringify(metric.rawData),
          uploadId,
        });
      }
    } else {
      const allPlayers = await this.prisma.player.findMany({
        select: { id: true, firstName: true, lastName: true },
      });
      const playerNameMap = this.buildPlayerNameMap(allPlayers);

      for (const metric of parseResult.success) {
        const playerId = this.matchPlayer(metric.playerName, playerNameMap);

        if (!playerId) {
          unmatchedPlayers.add(metric.playerName);
          continue;
        }

        matchedPlayers.add(metric.playerName);
        metricsToInsert.push({
          playerId,
          source: parserSource,
          metricType: metric.metricType,
          value: metric.value,
          unit: metric.unit,
          recordedAt: metric.recordedAt,
          rawData: JSON.stringify(metric.rawData),
          uploadId,
        });
      }
    }

    // 5. Batch insert metrics (filter out any with invalid values)
    const validMetrics = metricsToInsert.filter(m =>
      m.value != null && !isNaN(m.value) && isFinite(m.value)
    );

    let metricsCreated = 0;
    if (validMetrics.length > 0) {
      const result = await this.prisma.metric.createMany({
        data: validMetrics,
      });
      metricsCreated = result.count;
    }

    // 6. Update upload record
    const status = unmatchedPlayers.size > 0 && matchedPlayers.size > 0
      ? 'PARTIAL_FAILURE'
      : unmatchedPlayers.size > 0 && matchedPlayers.size === 0
        ? 'FAILED'
        : 'COMPLETED';

    await this.prisma.csvUpload.update({
      where: { id: uploadId },
      data: {
        source: parserSource,
        status,
        totalRows: parseResult.totalRows,
        successRows: metricsCreated,
        errorDetails: JSON.stringify({
          parseErrors: parseResult.errors,
          unmatchedPlayers: Array.from(unmatchedPlayers),
        }),
      },
    });

    // 7. Auto-recompute leaderboards for affected grad years
    if (metricsCreated > 0) {
      this.triggerLeaderboardRecompute(validMetrics.map(m => m.playerId)).catch(() => {});
    }

    return {
      uploadId,
      detectedSource: parserSource,
      confidence,
      totalRows: parseResult.totalRows,
      metricsCreated,
      playersMatched: Array.from(matchedPlayers),
      playersUnmatched: Array.from(unmatchedPlayers),
      errors: parseResult.errors,
    };
  }

  /**
   * Store an already-parsed ParseResult against a single player + upload.
   * Used by the Trackman PDF path (which parses a PDF rather than a CSV but
   * produces the same metric shape). Mirrors the direct-playerId branch of
   * processCSV: tag rows with the source + uploadId, drop invalid values,
   * batch-insert, and kick off a leaderboard recompute.
   */
  async storeParsedMetricsForPlayer(
    parseResult: ParsedMetric[],
    opts: { playerId: string; uploadId: string; source: string },
  ): Promise<number> {
    const toInsert = parseResult.map(m => ({
      playerId: opts.playerId,
      source: opts.source,
      metricType: m.metricType,
      value: m.value,
      unit: m.unit,
      recordedAt: m.recordedAt,
      rawData: JSON.stringify(m.rawData),
      uploadId: opts.uploadId,
    }));
    const valid = toInsert.filter(m => m.value != null && !isNaN(m.value) && isFinite(m.value));
    let created = 0;
    if (valid.length > 0) {
      created = (await this.prisma.metric.createMany({ data: valid })).count;
      this.triggerLeaderboardRecompute([opts.playerId]).catch(() => {});
    }
    return created;
  }

  /**
   * Look up the grad years for given player IDs and recompute their leaderboards.
   */
  private async triggerLeaderboardRecompute(playerIds: string[]) {
    try {
      const uniqueIds = [...new Set(playerIds)];
      const players = await this.prisma.player.findMany({
        where: { id: { in: uniqueIds } },
        select: { gradYear: true },
      });
      const gradYears = [...new Set(
        players.map(p => p.gradYear).filter((y): y is number => y !== null),
      )];

      for (const year of gradYears) {
        await this.leaderboardsService.recompute(year);
      }

      if (gradYears.length > 0) {
        this.logger.log(`Leaderboard auto-recomputed after CSV upload for grad years: ${gradYears.join(', ')}`);
      }
    } catch (err) {
      this.logger.warn(`Leaderboard auto-recompute after CSV failed: ${err}`);
    }
  }

  /**
   * Skip metadata/header rows that some vendors (e.g. Blast Connect) add
   * before the actual column headers. Looks for the first row that has
   * 4+ non-empty comma-separated fields — that's the real header.
   */
  private skipMetadataRows(csvText: string): string {
    const lines = csvText.split(/\r?\n/);

    // Quick check: if first line has 4+ columns, it's probably already clean
    const firstLineCols = this.countCsvColumns(lines[0] || '');
    if (firstLineCols >= 4) return csvText;

    // Find the real header row (first line with 4+ non-empty columns)
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const colCount = this.countCsvColumns(lines[i]);
      if (colCount >= 4) {
        this.logger.log(`Skipping ${i} metadata row(s) before actual headers`);
        return lines.slice(i).join('\n');
      }
    }

    // Couldn't find a valid header — return original
    return csvText;
  }

  /**
   * Count the number of non-empty columns in a CSV line.
   */
  private countCsvColumns(line: string): number {
    if (!line.trim()) return 0;
    // Use PapaParse for a single line to handle quoted fields correctly
    const result = Papa.parse(line, { header: false });
    const row = result.data[0] as string[] | undefined;
    if (!row) return 0;
    return row.filter(v => v && v.trim()).length;
  }

  /**
   * Build a lookup map from various name formats to player IDs.
   * Supports: "First Last", "Last, First", "first last" (case-insensitive).
   */
  private buildPlayerNameMap(
    players: { id: string; firstName: string; lastName: string }[],
  ): Map<string, string> {
    const map = new Map<string, string>();

    for (const p of players) {
      const first = p.firstName.toLowerCase().trim();
      const last = p.lastName.toLowerCase().trim();

      // "first last"
      map.set(`${first} ${last}`, p.id);
      // "last, first"
      map.set(`${last}, ${first}`, p.id);
      // "last first" (no comma)
      map.set(`${last} ${first}`, p.id);
      // Just last name (only if unique — overwrite means collision, handled below)
      if (!map.has(last)) {
        map.set(last, p.id);
      } else {
        // Multiple players with same last name — remove the ambiguous entry
        map.set(last, '__AMBIGUOUS__');
      }
    }

    return map;
  }

  /**
   * Match a CSV player name to a DB player ID.
   * Tries exact match first, then normalized/fuzzy matching.
   */
  private matchPlayer(
    csvName: string,
    nameMap: Map<string, string>,
  ): string | null {
    const normalized = csvName.toLowerCase().trim();

    // Direct match
    const direct = nameMap.get(normalized);
    if (direct && direct !== '__AMBIGUOUS__') return direct;

    // Try stripping extra whitespace and punctuation
    const cleaned = normalized.replace(/[^a-z\s,]/g, '').replace(/\s+/g, ' ').trim();
    const cleanedMatch = nameMap.get(cleaned);
    if (cleanedMatch && cleanedMatch !== '__AMBIGUOUS__') return cleanedMatch;

    // Try swapping "Last, First" → "First Last"
    if (cleaned.includes(',')) {
      const [last, first] = cleaned.split(',').map(s => s.trim());
      const swapped = `${first} ${last}`;
      const swappedMatch = nameMap.get(swapped);
      if (swappedMatch && swappedMatch !== '__AMBIGUOUS__') return swappedMatch;
    }

    return null;
  }
}
