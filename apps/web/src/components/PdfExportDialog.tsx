'use client';

/* The window every report "Download PDF" button opens.

   1. Pages — one box per report kind the athlete has (Hitting, Pitching,
      Catching, Infield, Outfield), each the most recent report of that kind
      unless the button that opened the window named a specific report (a
      tab's selected report, or a row in its report list). Ticking numbers
      the boxes 1, 2, 3… and the PDF's pages follow those numbers (the title
      page is always first); unticking closes the gap.
   2. Download — builds the PDF from the ticked pages and saves it.
   3. Email (coaches) — ticks for Player and Guardian (the addresses on
      file), then a Subject and Message, pre-filled from the "Assessment
      report" email in Settings and editable. Send first shows a PREVIEW of
      the exact PDF (and who / what subject it's going to); Send Email there
      sends it, closes the window and confirms on the page underneath.

   `usePdfExport` gives a tab an `open()` and the dialog element to render. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import type { ReportSummary } from '@/app/athletes/[id]/helpers';
import { buildReportPdf, latestReportsByType, saveBlob } from '@/lib/pdf';
import { tzOpt } from '@/lib/academy';
import styles from './PdfExportDialog.module.css';

type Recipient = 'player' | 'guardian';

const TYPE_LABEL: Record<string, string> = {
  HITTING: 'Hitting', PITCHING: 'Pitching', CATCHING: 'Catching', INFIELD: 'Infield', OUTFIELD: 'Outfield',
};

interface ExportPlayer {
  id: string;
  firstName: string;
  lastName: string;
  parentEmail?: string | null;
  user?: { email?: string | null } | null;
}

function PdfExportDialog({
  player, reports, isCoach, preselect, onClose, onSent,
}: {
  player: ExportPlayer & Record<string, any>;
  reports: ReportSummary[];
  isCoach: boolean;
  /** Reports to tick (and use for their kind) when the window opens. Empty
   *  = tick every kind the athlete has. */
  preselect: ReportSummary[];
  onClose: () => void;
  /** After a successful email: the confirmation to show once the window
   *  has closed. */
  onSent: (message: string) => void;
}) {
  /* One row per kind: the latest report, swapped for a named one. */
  const rows = useMemo(() => latestReportsByType(reports).map(
    (latest) => preselect.find((r) => r.reportType === latest.reportType) ?? latest,
  ), [reports, preselect]);
  /* Ticked kinds in tick order -- the PDF's page order. */
  const [order, setOrder] = useState<string[]>(() =>
    preselect.length > 0 ? preselect.map((r) => r.reportType) : rows.map((r) => r.reportType),
  );
  const chosen = order
    .map((type) => rows.find((r) => r.reportType === type))
    .filter((r): r is ReportSummary => !!r);
  const togglePage = (type: string) =>
    setOrder((o) => (o.includes(type) ? o.filter((t) => t !== type) : [...o, type]));

  const playerEmail = player.user?.email?.trim() || '';
  const guardianEmail = player.parentEmail?.trim() || '';
  const [emailOpen, setEmailOpen] = useState(false);
  const [to, setTo] = useState<Set<Recipient>>(new Set());
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [draftState, setDraftState] = useState<'idle' | 'loading' | 'ready'>('idle');

  /* Starting wording, fetched the first time Email opens. */
  useEffect(() => {
    if (!emailOpen || draftState !== 'idle') return;
    setDraftState('loading');
    api.getReportEmailDraft(player.id)
      .then((d) => { setSubject(d.subject); setMessage(d.message); })
      .catch(() => { setSubject(`${player.firstName}'s assessment report`); })
      .finally(() => setDraftState('ready'));
  }, [emailOpen, draftState, player.id, player.firstName]);
  const [busy, setBusy] = useState<'download' | 'preview' | 'email' | null>(null);
  /* The built PDF awaiting a final OK. `url` is an object URL for the
     preview frame, released when the preview closes. */
  const [preview, setPreview] = useState<{ blob: Blob; filename: string; url: string } | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  };

  const download = async () => {
    setBusy('download'); setError(''); setNotice('');
    try {
      const { blob, filename } = await buildReportPdf(player, chosen);
      saveBlob(blob, filename);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The PDF could not be built.');
      setBusy(null);
    }
  };

  /* Send: build the PDF and show it for a last look -- nothing is emailed yet. */
  const openPreview = async () => {
    setBusy('preview'); setError(''); setNotice('');
    try {
      const { blob, filename } = await buildReportPdf(player, chosen);
      setPreview({ blob, filename, url: URL.createObjectURL(blob) });
    } catch (e: any) {
      setError(e?.message || 'The PDF could not be built.');
    } finally {
      setBusy(null);
    }
  };

  /* Send Email (in the preview): email exactly the PDF that was previewed. */
  const confirmSend = async () => {
    if (!preview) return;
    setBusy('email'); setError(''); setNotice('');
    try {
      const pdfBase64 = await blobToBase64(preview.blob);
      const { results } = await api.emailReportPdf(player.id, {
        recipients: [...to], filename: preview.filename, pdfBase64, subject: subject.trim(), message,
      });
      const sent = results.filter((r) => r.sent).map((r) => r.email);
      const failed = results.filter((r) => !r.sent).map((r) => r.email);
      if (failed.length === 0) {
        onSent(`Report emailed to ${sent.join(' and ')}.`);
        onClose();
        return;
      }
      if (sent.length === 0) {
        setError('The email could not be sent. Email may not be set up on this server yet.');
      } else {
        setNotice(`Emailed to ${sent.join(' and ')}.`);
        setError(`Could not send to ${failed.join(' and ')}.`);
      }
    } catch (e: any) {
      setError(e?.message || 'The email could not be sent.');
    }
    setBusy(null);
  };

  const recipientList = ([['player', playerEmail], ['guardian', guardianEmail]] as const)
    .filter(([key]) => to.has(key))
    .map(([, email]) => email);

  const dateOf = (r: ReportSummary) =>
    new Date(r.createdAt).toLocaleDateString('en-US', { ...tzOpt(), month: 'short', day: 'numeric', year: 'numeric' });

  if (preview) {
    return (
      <div className={styles.overlay} onClick={() => { if (!busy) onClose(); }}>
        <div className={`${styles.dialog} ${styles.dialogWide}`} role="dialog" aria-modal="true" aria-label="Preview report email" onClick={(e) => e.stopPropagation()}>
          <div className={styles.head}>
            <div>
              <div className={styles.title}>Preview before sending</div>
              <div className={styles.sub}>Check the PDF, then send it.</div>
            </div>
            <button type="button" className={styles.close} onClick={onClose} disabled={!!busy} aria-label="Close">×</button>
          </div>

          <dl className={styles.summary}>
            <dt>To</dt><dd>{recipientList.join(', ')}</dd>
            <dt>Subject</dt><dd>{subject.trim()}</dd>
            <dt>Attachment</dt><dd>{preview.filename}</dd>
          </dl>

          <iframe className={styles.previewFrame} src={`${preview.url}#view=Fit`} title="PDF preview" />
          <a className={styles.previewLink} href={preview.url} target="_blank" rel="noopener noreferrer">
            Open the PDF in a new tab
          </a>

          <div className={styles.actions}>
            <button type="button" className={styles.secondary} onClick={() => { setPreview(null); setError(''); setNotice(''); }} disabled={!!busy}>
              Back
            </button>
            <button type="button" className={styles.primary} onClick={confirmSend} disabled={!!busy}>
              {busy === 'email' ? 'Sending…' : 'Send Email'}
            </button>
          </div>
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={() => { if (!busy) onClose(); }}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Download report PDF" onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <div>
            <div className={styles.title}>Report PDF</div>
            <div className={styles.sub}>{player.firstName} {player.lastName}</div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={!!busy} aria-label="Close">×</button>
        </div>

        <div className={styles.label}>Pages</div>
        {rows.length === 0 ? (
          <p className={styles.empty}>This athlete has no Hitting, Pitching or defensive reports yet.</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((r) => {
              const n = order.indexOf(r.reportType) + 1;
              return (
                <li key={r.reportType}>
                  <label className={styles.row}>
                    <input
                      type="checkbox"
                      className={styles.hiddenCheck}
                      checked={n > 0}
                      onChange={() => togglePage(r.reportType)}
                      disabled={!!busy}
                      aria-label={`${TYPE_LABEL[r.reportType] ?? r.reportType}${n > 0 ? `, page ${n}` : ''}`}
                    />
                    <span className={`${styles.orderBox} ${n > 0 ? styles.orderBoxOn : ''}`} aria-hidden="true">
                      {n > 0 ? n : ''}
                    </span>
                    <span className={styles.rowName}>{TYPE_LABEL[r.reportType] ?? r.reportType}</span>
                    <span className={styles.rowSub}>{dateOf(r)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={download} disabled={chosen.length === 0 || !!busy}>
            {busy === 'download' ? 'Building…' : 'Download'}
          </button>
          {isCoach && (
            <button
              type="button"
              className={`${styles.secondary} ${emailOpen ? styles.secondaryOn : ''}`}
              onClick={() => { setEmailOpen((o) => !o); setError(''); setNotice(''); }}
              disabled={!!busy}
              aria-expanded={emailOpen}
            >
              Email
            </button>
          )}
        </div>

        {isCoach && emailOpen && (
          <div className={styles.emailBox}>
            <div className={styles.label} style={{ marginTop: 0 }}>Send to</div>
            <ul className={styles.list}>
              {([
                ['player', 'Player', playerEmail, 'No email on file'],
                ['guardian', 'Guardian', guardianEmail, 'No guardian email on file'],
              ] as const).map(([key, name, email, missing]) => (
                <li key={key}>
                  <label className={`${styles.row} ${!email ? styles.rowOff : ''}`}>
                    <input
                      type="checkbox"
                      checked={to.has(key)}
                      onChange={() => setTo((s) => toggle(s, key))}
                      disabled={!email || !!busy}
                    />
                    <span className={styles.rowName}>{name}</span>
                    <span className={styles.rowSub}>{email || missing}</span>
                  </label>
                </li>
              ))}
            </ul>
            <label className={styles.label} htmlFor="report-email-subject">Subject</label>
            <input
              id="report-email-subject"
              className={styles.input}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder={draftState === 'loading' ? 'Loading…' : 'Subject'}
              disabled={!!busy || draftState === 'loading'}
            />
            <label className={styles.label} htmlFor="report-email-message">Message</label>
            <textarea
              id="report-email-message"
              className={`${styles.input} ${styles.textarea}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              rows={9}
              placeholder={draftState === 'loading' ? 'Loading…' : 'Write a message to go with the report'}
              disabled={!!busy || draftState === 'loading'}
            />
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={openPreview}
                disabled={to.size === 0 || chosen.length === 0 || !subject.trim() || draftState !== 'ready' || !!busy}
              >
                {busy === 'preview' ? 'Building preview…' : 'Build & Preview'}
              </button>
            </div>
          </div>
        )}

        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('The PDF could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** `open(reports?)` shows the window, ticking `reports` (or everything);
 *  render `dialog` somewhere in the tab. */
export function usePdfExport({ player, reports, isCoach }: {
  player: ExportPlayer & Record<string, any>;
  reports: ReportSummary[];
  isCoach: boolean;
}) {
  const [preselect, setPreselect] = useState<ReportSummary[] | null>(null);
  const [toast, setToast] = useState('');
  const open = useCallback((initial?: ReportSummary[] | null) => setPreselect(initial ?? []), []);
  const close = useCallback(() => setPreselect(null), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const dialog = (
    <>
      {preselect && (
        <PdfExportDialog
          player={player} reports={reports} isCoach={isCoach} preselect={preselect}
          onClose={close} onSent={setToast}
        />
      )}
      {toast && <div className={styles.toast} role="status">{toast}</div>}
    </>
  );
  return { open, dialog };
}
