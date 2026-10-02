'use client';

/* In-tab report editing pieces.

   A report is created empty (type + name) and then filled in place on its
   tab rather than inside the report modal:
     - ReportFilesButton      header button that opens the CSV upload window
     - ReportVideoUploadButton Video-section button -> OS file picker -> the
                              background upload queue
     - SaveBar                dirty / saving / saved / error + Save button
     - CoachNotesInline       the private Coach Notes block (coach-only)

   Every save here goes through api.mergeReportContent, which merges on the
   server. A whole-content write from the browser could overwrite a change
   that landed after the page loaded -- most likely a video attaching while
   the coach was typing notes. */

import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { rem } from '@/lib/rem';
import { useAuth } from '@/lib/auth-context';
import { useUploadQueue } from '@/lib/upload-queue';
import type { ReportSummary } from '@/components/assessment/ReportSelector';
import { NoteBlock } from '../tabs/SwingTab';

/** Coaches who may write. VIEWER-level coaches are read-only (the API
 *  refuses their writes), so they get no edit controls at all. */
export function useCanEditReports(): boolean {
  const { isCoach, isViewer } = useAuth();
  return isCoach && !isViewer;
}

/* Chip-sized header control, matching the resting Live Results button and
   the report date chip it sits beside. */
const headerChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-light)',
  background: 'var(--bubble-chrome-bg)',
  color: 'var(--text-muted)',
  fontFamily: 'inherit',
  fontSize: rem(10),
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 'normal',
};

function UploadTrayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5V2.5" />
      <path d="M4.8 5.6L8 2.5l3.2 3.1" />
      <path d="M2.5 10v3.5h11V10" />
    </svg>
  );
}

/** Opens the CSV / PDF / XLSX upload window for the active report. */
export function ReportFilesButton({ onClick, title }: { onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={headerChipStyle}
      title={title ?? 'Upload data files to this report'}
      aria-label={title ?? 'Upload data files to this report'}
    >
      <UploadTrayIcon />
      Upload
    </button>
  );
}

/** Turns the report shown into its editable form, in place (Infield /
 *  Outfield / Catching). Sits beside the report date like Upload does. */
export function ReportEditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={headerChipStyle}
      title="Edit this report"
      aria-label="Edit this report"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11.5 2.5a1.6 1.6 0 0 1 2.3 2.3L5.5 13.1 2.5 14l.9-3z" />
        <path d="M10.3 3.7l2 2" />
      </svg>
      Edit
    </button>
  );
}

/**
 * Video upload for one report: opens the OS file picker and hands every
 * chosen clip to the background upload queue, which uploads them one at a
 * time and attaches each to the report as it lands. The page doesn't wait;
 * the Video section's pending cards show progress.
 */
export function ReportVideoUploadButton({
  report, playerId, category, section = 'swing',
}: {
  report: ReportSummary;
  playerId: string;
  /** Video category -- the report type, as the report modal used. */
  category: string;
  section?: 'swing' | 'decision';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { enqueue } = useUploadQueue();

  const onPick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list).filter((f) => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(f.name));
    if (files.length === 0) return;
    enqueue(files.map((file) => ({
      file,
      playerId,
      /* A single upload keeps its filename as the title -- the report
         modal's single-clip behaviour. */
      title: file.name.replace(/\.[^.]+$/, ''),
      category,
      section,
      reportId: report.id,
    })));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={headerChipStyle}
        title="Upload videos to this report"
        aria-label="Upload videos to this report"
      >
        <UploadTrayIcon />
        Upload Video
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }}
      />
    </>
  );
}

/** Save control for an inline-edited field. Disabled until there is
 *  something to save; reports failures inline instead of only logging. */
export function SaveBar({
  dirty, saving, savedAt, error, onSave, label = 'Save Notes', leading,
}: {
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
  onSave: () => void;
  label?: string;
  /** Optional content on the left of the row (e.g. a privacy note). */
  leading?: React.ReactNode;
}) {
  const active = dirty && !saving;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, flexWrap: 'wrap', marginTop: 8,
    }}>
      <div style={{ minWidth: 0 }}>{leading}</div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {error && <span role="alert" style={{ color: '#fda4af', fontSize: rem(11) }}>{error}</span>}
        {!error && savedAt && !dirty && <span style={{ color: '#86efac', fontSize: rem(11) }}>Saved.</span>}
        <button
          type="button"
          onClick={onSave}
          disabled={!active}
          style={{
            padding: '6px 14px',
            borderRadius: 7,
            background: dirty
              ? 'linear-gradient(135deg, rgba(74,222,128,0.30), rgba(74,222,128,0.18))'
              : 'rgba(255,255,255,0.04)',
            border: dirty ? '1px solid rgba(74,222,128,0.55)' : '1px solid var(--border)',
            color: dirty ? 'var(--text-bright)' : 'var(--text-muted)',
            fontSize: rem(11), fontWeight: 700, letterSpacing: '0.04em',
            cursor: active ? 'pointer' : 'not-allowed',
            opacity: saving ? 0.6 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : `💾 ${label}`}
        </button>
      </div>
    </div>
  );
}

/**
 * Save state for one inline field. `persisted` is what the report holds;
 * `save` writes the draft and calls `onSaved` so the page refetches. The
 * draft resets whenever `persisted` changes (another report selected, or
 * the refetch after a save).
 */
export function useInlineField(persisted: string, save: (value: string) => Promise<unknown>, onSaved?: () => void) {
  const [draft, setDraft] = useState(persisted);
  useEffect(() => { setDraft(persisted); }, [persisted]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const run = async () => {
    setSaving(true);
    setError(null);
    /* A rich-text box the coach cleared often still holds a stray <br>;
       that is empty, not a change. Saving it as '' (stored as null) and
       resetting the draft keeps the box from reading as unsaved forever. */
    const value = isBlankNote(draft) ? '' : draft;
    try {
      await save(value);
      setDraft(value);
      setSavedAt(Date.now());
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setSavedAt(null), 2200);
      onSaved?.();
    } catch (err: any) {
      setError(err?.message || 'Save failed — try again.');
    } finally {
      setSaving(false);
    }
  };

  return { draft, setDraft, dirty: draft !== persisted, saving, savedAt, error, save: run };
}

/** True for notes with no visible text (empty, or only tags / whitespace). */
export function isBlankNote(value: string | null | undefined): boolean {
  if (!value) return true;
  return value.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

/** Read one string key out of a report's content JSON. */
export function contentString(report: ReportSummary | null | undefined, key: string): string {
  if (!report?.content) return '';
  try {
    const c = JSON.parse(report.content);
    return typeof c?.[key] === 'string' ? c[key] : '';
  } catch {
    return '';
  }
}

/**
 * Private Coach Notes for one report, editable in place.
 *
 * Coach-only twice over: this renders nothing for players, and the API
 * strips `content.coachNotes` from every report a player receives -- hiding
 * it here alone would still ship the text to the athlete's browser.
 */
export function CoachNotesInline({
  report, onSaved, largeLabel = true, style,
}: {
  report: ReportSummary;
  onSaved?: () => void;
  largeLabel?: boolean;
  /** Overrides for the outer wrapper (default: 14px top margin). */
  style?: React.CSSProperties;
}) {
  const { isCoach } = useAuth();
  const canEdit = useCanEditReports();
  const persisted = useMemo(() => contentString(report, 'coachNotes'), [report]);
  const field = useInlineField(
    persisted,
    (value) => api.mergeReportContent(report.id, { set: { coachNotes: value ? value : null } }),
    onSaved,
  );

  if (!isCoach) return null;

  return (
    <div style={{ marginTop: 14, ...style }}>
      <NoteBlock
        label="Coach Notes"
        value={field.draft}
        onChange={field.setDraft}
        placeholder="Private coaching notes — strategy, reminders, things to work on. The athlete never sees this."
        editable={canEdit}
        rows={4}
        largeLabel={largeLabel}
      />
      {canEdit ? (
        <SaveBar
          dirty={field.dirty}
          saving={field.saving}
          savedAt={field.savedAt}
          error={field.error}
          onSave={() => void field.save()}
          label="Save Coach Notes"
          leading={<PrivateTag />}
        />
      ) : (
        <div style={{ marginTop: 8 }}><PrivateTag /></div>
      )}
    </div>
  );
}

function PrivateTag() {
  return (
    <span style={{ fontSize: rem(11), fontWeight: 600, color: 'var(--text-muted)' }}>
      🔒 Private · coaches only, not shown to the athlete
    </span>
  );
}
