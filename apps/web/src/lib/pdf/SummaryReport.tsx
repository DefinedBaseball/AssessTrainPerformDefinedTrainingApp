/**
 * Summary PDF Report — Combines all sections into one document
 * Includes cover page + all tab reports
 */
import React from 'react';
import { Document } from '@react-pdf/renderer';
import { CoverPage } from './CoverPage';
import { HittingReportPages, type HittingPdfData } from './HittingReport';
import { PitchingReportPages, type PitchingPdfData } from './PitchingReport';
import { DefenseReportPages, type DefensePdfData } from './DefenseReport';
import { StrengthReportPages, type StrengthPdfData } from './StrengthReport';
import { VisionReportPages, type VisionPdfData } from './VisionReport';

export interface SummaryPdfData {
  player: any;
  hitting: HittingPdfData | null;
  pitching: PitchingPdfData | null;
  defense: DefensePdfData | null;
  strength: StrengthPdfData | null;
  vision: VisionPdfData | null;
  reportDate: string;
}

export function SummaryReportDocument({ data }: { data: SummaryPdfData }) {
  const { player, reportDate } = data;

  return (
    <Document
      title={`${player.firstName} ${player.lastName} — Player Assessment`}
      author="Summer Pro Assessment"
      subject="Complete Player Assessment Report"
    >
      {/* Cover Page */}
      <CoverPage
        player={player}
        reportTitle="Player Assessment"
        reportDate={reportDate}
      />

      {/* Hitting (Swing + At-Bat) */}
      {data.hitting && <HittingReportPages data={data.hitting} />}

      {/* Pitching */}
      {data.pitching && <PitchingReportPages data={data.pitching} />}

      {/* Defense (only if non-pitcher positions exist) */}
      {data.defense && <DefenseReportPages data={data.defense} />}

      {/* Strength & Conditioning */}
      {data.strength && <StrengthReportPages data={data.strength} />}

      {/* Vision */}
      {data.vision && <VisionReportPages data={data.vision} />}
    </Document>
  );
}
