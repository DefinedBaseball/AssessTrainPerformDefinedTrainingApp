'use client';

/* CSV / PDF / XLSX upload building blocks for reports.

   Shared by the in-tab upload window (ReportUploadsDialog) and the report
   modal. Moved here verbatim from ReportModal.tsx so there is one copy of
   the slot list, the upload card and the manual-entry inputs. */

import type React from 'react';
import { useRef } from 'react';
import { rem } from '@/lib/rem';
import rs from '@/components/assessment/report-form.module.css';

/* Same surface as ReportModal's reportInnerBubbleStyle, which the manual
   inputs borrowed while they lived there. */
const manualBubbleStyle: React.CSSProperties = {
  background: 'var(--defense-inner-bg)',
  border: '1px solid var(--border-light)',
  borderRadius: 10,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
};

export interface CsvSlot { key: string; label: string; subtitle: string; vendor: string; group?: 'swing' | 'decision'; kind?: 'csv' | 'pdf'; multi?: boolean; }

export const REPORT_CSV_SLOTS: Record<string, CsvSlot[]> = {
  // The HITTING report now bundles both swing and swing-decision data. The
  // `group` tag drives which subsection a slot renders in (swing / decision).
  HITTING: [
    { key: 'blast',     label: 'Swing Metrics',         subtitle: 'Blast Motion CSV',         vendor: 'Blast Motion', group: 'swing', multi: true },
    { key: 'fullswing', label: 'Batted Ball Metrics',   subtitle: 'Full Swing CSV',           vendor: 'Full Swing',   group: 'swing', multi: true },
    { key: 'hittrax',   label: 'Batted Ball — HitTrax', subtitle: 'HitTrax CSV',              vendor: 'HitTrax',      group: 'swing', multi: true },
    { key: 'atbat',     label: 'At-Bat Assessment',     subtitle: 'At-Bat Assessment XLSX',   vendor: 'AtBat',        group: 'decision' },
    /* `atbat_fullswing` + `atbat_hittrax` CSV slots retired in
       Phase 6 — at-bat batted-ball data is now captured live via
       the /live tools (Live Session → LIVE mode). The
       `atbat_fullswing` slot specifically used to drive the Swing
       Decision spray chart + Results bubble; that data now flows
       in through the LiveSessions `AtBat` / `Pitch` rows and is
       surfaced by the Hitting tab's new Live At-Bats section.
       The Swing-tab `fullswing` + `hittrax` slots above are kept
       — they continue to feed the assessment-side Spray Chart on
       the Swing sub-tab. */
  ],
  // Two ways to load pitch data into the same Pitching tab:
  //  • CSV/XLSX (default) → fully-interactive, pitch-linked plots.
  //  • Session-report PDF (fallback when no CSV is available) → table-driven,
  //    non-interactive plots. Either fills the tab; coaches pick whichever
  //    export they have on hand.
  PITCHING: [
    { key: 'trackman', label: 'Pitch Data', subtitle: 'TrackMan CSV', vendor: 'TrackMan', kind: 'csv', multi: true },
    { key: 'trackman_pdf', label: 'Pitch Data', subtitle: 'TrackMan Session Report', vendor: 'TrackMan', kind: 'pdf' },
  ],
  /* INFIELD uses a dedicated form — no CSV slots */
  /* OUTFIELD uses a dedicated form — no CSV slots */
  /* CATCHING uses a dedicated form — no CSV slots */
  STRENGTH: [{ key: 'vald', label: 'Strength & Conditioning', subtitle: 'VALD CSV', vendor: 'VALD' }],
  COGNITION: [
    { key: 'atbat', label: 'At-Bat Assessment', subtitle: 'At-Bat Assessment XLSX', vendor: 'AtBat' },
    { key: 'fullswing', label: 'Full Swing Data', subtitle: 'Full Swing CSV', vendor: 'Full Swing' },
    { key: 'vizual', label: 'Cognition Testing', subtitle: 'Vizual Edge CSV', vendor: 'Vizual Edge' },
  ],
};

/* ── Sub-components ── */

export interface UploadResult { status: 'success' | 'error' | 'processing'; message: string; rows?: number; metrics?: number; }

/** Shape of a previously-saved CSV upload, persisted into a report's
 *  content.csvUploads[slotKey] entry. We surface it in edit mode so the coach
 *  sees what's already attached and can remove or replace it. */
export interface ExistingFile { name?: string; uploadId: string; rows?: number; metrics?: number; }
export interface ExistingUpload { vendor: string; rows?: number; metrics?: number; uploadId?: string; uploadIds?: string[]; files?: ExistingFile[]; atBats?: number; playerName?: string; error?: string; pdf?: boolean; }

/** Dedupe Files by name+size so re-dropping the same export doesn't double it. */
export function dedupeFiles(arr: File[]): File[] {
  const seen = new Set<string>();
  const out: File[] = [];
  for (const f of arr) { const k = `${f.name}:${f.size}`; if (!seen.has(k)) { seen.add(k); out.push(f); } }
  return out;
}

/** Normalize any saved csvUploads slot entry into a flat list of saved files.
 *  Multi-file slots store `files[]` / `uploadIds[]`; legacy + single-file slots
 *  store one `uploadId`; client-parsed slots (At-Bat XLSX) carry no id at all
 *  but still need one summary row, so emit a synthetic empty-id row. */
export function existingFilesOf(entry: ExistingUpload | null): ExistingFile[] {
  if (!entry) return [];
  if (Array.isArray(entry.files) && entry.files.length) return entry.files;
  if (Array.isArray(entry.uploadIds) && entry.uploadIds.length) {
    return entry.uploadIds.filter(Boolean).map(id => ({ uploadId: id }));
  }
  if (entry.uploadId) return [{ uploadId: entry.uploadId, rows: entry.rows, metrics: entry.metrics }];
  return [{ uploadId: '' }];
}

export function CsvUploadCard({
  slot, files, uploadResult, existingUpload, onSelect, onRemoveFile, onRemoveExistingFile,
  manualMode, onToggleManual, manualNode,
}: {
  slot: CsvSlot; files: File[]; uploadResult: UploadResult | null;
  existingUpload?: ExistingUpload | null;
  onSelect: (fs: File[]) => void;
  onRemoveFile: (idx: number) => void;
  onRemoveExistingFile: (uploadId: string) => void;
  /** When true, the card renders manualNode in place of the drop zone. */
  manualMode?: boolean;
  onToggleManual?: () => void;
  manualNode?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const supportsManual = !!onToggleManual;
  const isMulti = !!slot.multi;
  // PDF slots (Trackman session report) accept a .pdf instead of a CSV/XLSX.
  const isPdf = slot.kind === 'pdf';
  const acceptAttr = isPdf ? '.pdf' : '.csv,.xlsx,.xls';
  const fileRe = isPdf ? /\.pdf$/i : /\.(csv|xlsx?)$/i;
  const noun = isPdf ? 'PDF' : 'CSV';
  const staged = files || [];
  const existingFiles = manualMode ? [] : existingFilesOf(existingUpload || null);
  // Multi-file slots keep the drop zone visible so more files can be added;
  // single-file slots hide it once a file is staged (a saved file still shows
  // it so the coach can drop a replacement).
  const showDropZone = !manualMode && (isMulti || staged.length === 0);
  const hasAny = staged.length > 0 || existingFiles.length > 0;
  const dropText = isMulti
    ? (hasAny ? `Drop another ${noun} or click to add` : `Drop ${noun}s here or click to browse`)
    : (existingFiles.length > 0 ? `Drop ${noun} to replace, or click to browse` : `Drop ${noun} here or click to browse`);
  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    let valid = Array.from(list).filter(f => fileRe.test(f.name));
    if (!isMulti) valid = valid.slice(0, 1);
    if (valid.length) onSelect(valid);
  };
  return (
    <div className={rs.csvCard}>
      <div className={rs.csvCardHeader}>
        <div>
          <div className={rs.csvCardTitle}>{slot.label}</div>
          <div className={rs.csvCardSub}>{slot.subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {supportsManual && (
            <button
              type="button"
              onClick={onToggleManual}
              title={manualMode ? 'Switch back to CSV upload' : 'Type values in manually instead of uploading a CSV'}
              style={{
                padding: '4px 10px',
                fontSize: rem(11),
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                borderRadius: 6,
                border: `1px solid ${manualMode ? 'var(--accent)' : 'var(--border-light)'}`,
                background: manualMode
                  ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                  : 'transparent',
                color: manualMode ? 'var(--accent-light)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {manualMode ? '✓ Manual' : 'Manual Entry'}
            </button>
          )}
          <span className={rs.csvVendorBadge}>{slot.vendor}</span>
        </div>
      </div>
      {manualMode ? (
        <div style={{ marginTop: 8 }}>{manualNode}</div>
      ) : (
        <>
          {/* Saved uploads (edit mode) — one row per attached file so a coach
              can remove an individual file from a multi-file slot. */}
          {existingFiles.map((ef, i) => (
            <div key={ef.uploadId || `saved-${i}`} className={rs.fileInfo} style={{ marginBottom: 8 }}>
              <div className={rs.fileName}>
                <span className={rs.fileIcon}>📎</span>
                {ef.name || `${existingUpload!.vendor} ${noun}`}
                <span className={rs.fileSize}>
                  {existingUpload?.atBats != null
                    ? `(${existingUpload.atBats} at-bats)`
                    : ef.rows != null
                      ? `(${ef.rows} rows${ef.metrics != null ? ` · ${ef.metrics} metrics` : ''})`
                      : '(saved)'}
                </span>
              </div>
              <button type="button" className={rs.removeBtn} onClick={() => onRemoveExistingFile(ef.uploadId)}>Remove</button>
            </div>
          ))}
          {/* Newly-staged files (not yet uploaded) */}
          {staged.map((f, i) => (
            <div key={`${f.name}-${f.size}-${i}`} className={rs.fileInfo} style={{ marginBottom: 8 }}>
              <div className={rs.fileName}>
                <span className={rs.fileIcon}>✅</span>{f.name}
                <span className={rs.fileSize}>({(f.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button type="button" className={rs.removeBtn} onClick={() => onRemoveFile(i)}>Remove</button>
            </div>
          ))}
          {uploadResult && (
            <div
              className={`${rs.uploadResult} ${uploadResult.status === 'success' ? rs.uploadSuccess : uploadResult.status === 'error' ? rs.uploadError : ''}`}
              style={{ marginBottom: showDropZone ? 8 : 0 }}
            >
              {uploadResult.message}
            </div>
          )}
          {/* Drop zone — for multi slots always visible (add more); for single
              slots visible until a file is staged. */}
          {showDropZone && (
            <div className={rs.dropZone} onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); pickFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}>
              <span className={rs.dropIcon}>{isPdf ? '📕' : '📄'}</span>
              <span className={rs.dropText}>{dropText}</span>
              <input ref={inputRef} type="file" accept={acceptAttr} multiple={isMulti} style={{ display: 'none' }}
                onChange={e => { pickFiles(e.target.files); e.target.value = ''; }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Bubble-styled manual-entry inputs for a single slot (Blast / Full Swing). */
export function ManualMetricBubbles<T extends Record<string, number | null>>({
  fields, values, onChange,
}: {
  fields: { key: keyof T; label: string; unit: string; step?: number }[];
  values: T;
  onChange: (key: keyof T, raw: string) => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: 8,
    }}>
      {fields.map(f => (
        <div key={String(f.key)} style={{
          ...manualBubbleStyle,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <span style={{
            fontSize: rem(10), fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>{f.label}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <input
              type="number"
              step={f.step ?? 0.1}
              placeholder="—"
              value={values[f.key] == null ? '' : String(values[f.key])}
              onChange={e => onChange(f.key, e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-bright)',
                fontSize: rem(18),
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                outline: 'none',
                padding: 0,
                minWidth: 0,
              }}
            />
            {f.unit && (
              <span style={{
                fontFamily: "'DM Mono', ui-monospace, monospace",
                fontSize: rem(10), fontWeight: 600,
                color: 'var(--text-muted)',
                letterSpacing: '0.06em',
              }}>{f.unit}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
