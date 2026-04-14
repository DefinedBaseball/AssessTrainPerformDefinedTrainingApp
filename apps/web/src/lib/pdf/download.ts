/**
 * PDF Download Utility — Generates and triggers download
 */
import { pdf } from '@react-pdf/renderer';
import React from 'react';

/**
 * Generate a PDF from a React element and trigger browser download
 */
export async function downloadPdf(
  element: React.ReactElement,
  filename: string,
): Promise<void> {
  const blob = await pdf(element).toBlob();
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
 * Format a filename for a report PDF
 */
export function pdfFilename(
  playerFirst: string,
  playerLast: string,
  reportType: string,
): string {
  const name = `${playerFirst}_${playerLast}`.replace(/\s+/g, '_');
  const type = reportType.replace(/\s+/g, '_');
  const date = new Date().toISOString().slice(0, 10);
  return `${name}_${type}_${date}.pdf`;
}

/**
 * Get formatted report date string
 */
export function reportDateStr(): string {
  return new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
