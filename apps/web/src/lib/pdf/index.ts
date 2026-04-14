/**
 * PDF Report Module — barrel export
 */

// Core utilities
export { downloadPdf, pdfFilename, reportDateStr } from './download';

// Theme & Components
export { colors, s, badgeColors, barColor } from './theme';

// Cover Page
export { CoverPage } from './CoverPage';

// Individual Report Components (used as Document children)
export { HittingReportPages } from './HittingReport';
export type { HittingPdfData } from './HittingReport';

export { PitchingReportPages } from './PitchingReport';
export type { PitchingPdfData, ArsenalRow } from './PitchingReport';

export { DefenseReportPages } from './DefenseReport';
export type { DefensePdfData } from './DefenseReport';

export { StrengthReportPages } from './StrengthReport';
export type { StrengthPdfData } from './StrengthReport';

export { VisionReportPages } from './VisionReport';
export type { VisionPdfData } from './VisionReport';

// Summary (combined) Report
export { SummaryReportDocument } from './SummaryReport';
export type { SummaryPdfData } from './SummaryReport';

// Generator functions (fetch data + build + download)
export {
  generateHittingPdf,
  generatePitchingPdf,
  generateDefensePdf,
  generateStrengthPdf,
  generateVisionPdf,
  generateSummaryPdf,
} from './generators';
