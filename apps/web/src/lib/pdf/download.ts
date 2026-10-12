/**
 * PDF Download Utility — Generates and triggers download
 */
import { pdf } from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';
import React from 'react';
import { tzDayKey, tzOpt } from '@/lib/academy';

/**
 * Generate a PDF from a React element and trigger browser download.
 * The element must be a react-pdf `<Document>` — typed explicitly because
 * React 19's `ReactElement` defaults its props to `unknown`, which no longer
 * implicitly satisfies `pdf()`'s `ReactElement<DocumentProps>` parameter.
 */
export async function downloadPdf(
  element: React.ReactElement<DocumentProps>,
  filename: string,
): Promise<void> {
  saveBlob(await pdf(element).toBlob(), filename);
}

/** Render a react-pdf <Document> to a PDF Blob without saving it. */
export async function renderPdf(element: React.ReactElement<DocumentProps>): Promise<Blob> {
  return pdf(element).toBlob();
}

/** Hand a finished PDF to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke after a delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * Format a filename for a report PDF. `date` is the assessment's own date
 * (defaults to today), as a day in the academy's time zone -- toISOString
 * would hand an evening download tomorrow's UTC date.
 */
export function pdfFilename(
  playerFirst: string,
  playerLast: string,
  reportType: string,
  date?: string | Date | null,
): string {
  const name = `${playerFirst}_${playerLast}`.replace(/\s+/g, '_');
  const type = reportType.replace(/\s+/g, '_');
  return `${name}_${type}_${tzDayKey(toDate(date))}.pdf`;
}

/**
 * The date printed on a report: the assessment's own date when there is
 * one (a June report downloaded in October still says June), else today.
 */
export function reportDateStr(date?: string | Date | null): string {
  return toDate(date).toLocaleDateString('en-US', {
    ...tzOpt(),
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Newest createdAt among the given reports (the date a multi-report PDF
 *  speaks for), or null when there are none. */
export function latestReportDate(reports: Array<{ createdAt: string } | null | undefined>): string | null {
  const times = reports
    .map((r) => (r ? new Date(r.createdAt).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function toDate(date?: string | Date | null): Date {
  const d = date ? new Date(date) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
