'use client';

/* The report's data-file upload window -- opened from the Upload button in
   a report's header (Hitting / Pitching).

   Same cards, same vendors and the same processing as the report modal's
   Data Imports section had: CSVs go to /uploads/csv, the TrackMan session
   report to /uploads/trackman-pdf, and the At-Bat XLSX is parsed in the
   browser. What changes is only where it happens: files are added to an
   EXISTING report, and the result is merged into that report's content
   server-side, so nothing else on the report (notes, attached videos) can
   be overwritten by this save. The report's metrics re-sync on the server
   exactly as they did when the modal saved. */

import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { parseAtBatXlsx } from '@/lib/atbat-parser';
import type { ReportSummary } from '@/components/assessment/ReportSelector';
import rs from '@/components/assessment/report-form.module.css';
import styles from './page.module.css';
import {
  type CsvSlot, REPORT_CSV_SLOTS, type UploadResult, type ExistingFile, type ExistingUpload,
  dedupeFiles, existingFilesOf, CsvUploadCard, ManualMetricBubbles, visibleSlots,
} from './report-uploads';
import {
  type ManualBattedBall, getManualBattedBall,
  type ManualSwingMetrics, getManualSwingMetrics,
  MANUAL_BATTED_BALL_FIELDS, MANUAL_SWING_METRIC_FIELDS,
  MANUAL_PITCH_TYPES, type ManualPitchMax, getManualPitchMax,
  type ManualHitTrax, getManualHitTrax, MANUAL_HITTRAX_FIELDS,
} from './helpers';
import { tzOpt } from '@/lib/academy';

const SOURCE_BY_VENDOR: Record<string, string> = {
  'Blast Motion': 'BLAST_MOTION', 'Full Swing': 'FULL_SWING', 'HitTrax': 'HITTRAX', 'HitTrax POI': 'HITTRAX_POI',
  'TrackMan': 'TRACKMAN', 'VALD': 'VALD', 'Vizual Edge': 'VIZUAL_EDGE',
  'Custom': 'AUTO_DETECT',
};

const EMPTY_SWING: ManualSwingMetrics = {
  max_bat_speed: null, avg_bat_speed: null,
  attack_angle: null, plane_angle: null,
  time_to_contact: null, on_plane_efficiency: null,
  connection_at_contact: null, rotational_acceleration: null, rotational_accel_g: null,
  plane_score: null, connection_score: null, rotation_score: null,
  early_connection: null, connection_at_impact: null,
};
/* Pitching's manual Max Velo boxes, one per pitch type. */
const PITCH_MAX_FIELDS = MANUAL_PITCH_TYPES.map(t => ({ key: t.key, label: `${t.label} Max`, unit: 'mph' }));
const emptyHitTrax = (): ManualHitTrax =>
  Object.fromEntries(MANUAL_HITTRAX_FIELDS.map(f => [f.key, null])) as ManualHitTrax;
const emptyBattedBall = (): ManualBattedBall =>
  Object.fromEntries(MANUAL_BATTED_BALL_FIELDS.map(f => [f.key, null])) as ManualBattedBall;

function parseContent(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { ...tzOpt(), month: 'short', day: 'numeric', year: 'numeric' });
}

export function ReportUploadsDialog({
  player, userId, report, onClose, onSaved,
}: {
  player: Player;
  userId: string;
  report: ReportSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const reportType = report.reportType;
  const isHitting = reportType === 'HITTING';
  const isPitching = reportType === 'PITCHING';
  const slots: CsvSlot[] = REPORT_CSV_SLOTS[reportType] || [];

  /* The page's copy of the report can be minutes old; the upload window
     edits what is attached NOW, so it starts from a fresh read. */
  const [fresh, setFresh] = useState<ReportSummary | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    let alive = true;
    api.getReport(report.id)
      .then((r) => { if (alive) setFresh(r); })
      .catch((err: any) => { if (alive) setLoadError(err?.message || 'Could not load this report.'); });
    return () => { alive = false; };
  }, [report.id]);

  const [csvFiles, setCsvFiles] = useState<Record<string, File[]>>({});
  const [csvResults, setCsvResults] = useState<Record<string, UploadResult | null>>({});
  const [existing, setExisting] = useState<Record<string, ExistingUpload>>({});
  /* What was attached when the window opened -- how a removal is detected
     (the At-Bat block has to be cleared when its file is removed). */
  const [initialExisting, setInitialExisting] = useState<Record<string, ExistingUpload>>({});
  const [manualMode, setManualMode] = useState<Record<string, boolean>>({});
  const [manualSwing, setManualSwing] = useState<ManualSwingMetrics>(EMPTY_SWING);
  const [manualBb, setManualBb] = useState<ManualBattedBall>(emptyBattedBall);
  const [manualPitch, setManualPitch] = useState<ManualPitchMax>(() => getManualPitchMax(null));
  const [manualHt, setManualHt] = useState<ManualHitTrax>(emptyHitTrax);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /* Seed every piece of state from the fresh read, exactly as the modal
     did in edit mode. Manual mode only comes back ON when the report
     carries the explicit manualEntryModes marker. */
  useEffect(() => {
    if (!fresh) return;
    const c = parseContent(fresh.content);
    const uploads = (c.csvUploads && typeof c.csvUploads === 'object') ? { ...c.csvUploads } : {};
    setExisting(uploads);
    setInitialExisting(uploads);
    if (isHitting) {
      const m = c?.manualEntryModes || {};
      setManualMode({
        ...(m.fullswing ? { fullswing: true } : {}),
        ...(m.blast ? { blast: true } : {}),
        ...(m.hittrax ? { hittrax: true } : {}),
      });
      setManualHt(getManualHitTrax(fresh as any));
      setManualSwing(getManualSwingMetrics(fresh as any));
      setManualBb(getManualBattedBall(fresh as any));
    }
    if (isPitching) setManualPitch(getManualPitchMax(fresh as any));
  }, [fresh, isHitting, isPitching]);

  const stagedCount = useMemo(
    () => Object.values(csvFiles).reduce((n, arr) => n + (arr?.length || 0), 0),
    [csvFiles],
  );
  const dirty = touched || stagedCount > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || saving) return;
      if (dirty) setConfirmDiscard(true); else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, onClose]);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true); else onClose();
  };

  /* ── Card handlers (same rules as the modal's) ── */
  const handleSelect = (slot: CsvSlot, picked: File[]) => {
    if (picked.length === 0) return;
    if (slot.multi) {
      setCsvFiles(prev => ({ ...prev, [slot.key]: dedupeFiles([...(prev[slot.key] || []), ...picked]) }));
    } else {
      setCsvFiles(prev => ({ ...prev, [slot.key]: [picked[0]] }));
      /* A single-file slot: the staged file replaces whatever is saved. */
      setExisting(prev => { const n = { ...prev }; delete n[slot.key]; return n; });
      setTouched(true);
    }
    setCsvResults(prev => ({ ...prev, [slot.key]: null }));
  };
  const handleRemoveStaged = (slot: CsvSlot, idx: number) => {
    setCsvFiles(prev => {
      const arr = [...(prev[slot.key] || [])];
      arr.splice(idx, 1);
      return { ...prev, [slot.key]: arr };
    });
    setCsvResults(prev => ({ ...prev, [slot.key]: null }));
  };
  const handleRemoveExisting = (slot: CsvSlot, uploadId: string) => {
    setTouched(true);
    setExisting(prev => {
      const entry = prev[slot.key];
      if (!entry) return prev;
      const remaining = existingFilesOf(entry).filter(f => f.uploadId && f.uploadId !== uploadId);
      if (!slot.multi || !uploadId || remaining.length === 0) {
        const n = { ...prev }; delete n[slot.key]; return n;
      }
      return {
        ...prev,
        [slot.key]: {
          ...entry,
          files: remaining,
          uploadIds: remaining.map(f => f.uploadId),
          uploadId: remaining[0]?.uploadId,
          rows: remaining.reduce((s, f) => s + (f.rows || 0), 0),
          metrics: remaining.reduce((s, f) => s + (f.metrics || 0), 0),
        },
      };
    });
  };

  /* ── Save ──
     Upload every staged file, then merge the outcome into the report in
     one server-side write. A slot whose upload FAILS keeps its previously
     saved files and keeps the failed files staged, so Save can simply be
     pressed again; the slots that succeeded are saved either way. (The
     modal stored the error object in the slot, which dropped that slot's
     saved files.) */
  const save = async () => {
    setSaving(true);
    setSaveError('');
    const merged: Record<string, any> = { ...existing };
    let atBatData: any = null;
    let failures = 0;
    const stillStaged: Record<string, File[]> = {};

    for (const slot of slots) {
      const files = csvFiles[slot.key] || [];
      if (files.length === 0) continue;
      setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'processing', message: 'Uploading...' } }));
      try {
        if (slot.vendor === 'AtBat') {
          const parsed = parseAtBatXlsx(await files[0].arrayBuffer());
          atBatData = parsed;
          merged[slot.key] = { vendor: 'AtBat', atBats: parsed.atBats.length, playerName: parsed.playerName };
          const pitches = parsed.atBats.reduce((s: number, ab: any) => s + ab.pitches.length, 0);
          setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'success', message: `${parsed.atBats.length} at-bats parsed with ${pitches} total pitches`, rows: parsed.atBats.length } }));
          continue;
        }
        if (slot.kind === 'pdf') {
          const result = await api.uploadTrackmanPdf(files[0], userId, player.id);
          merged[slot.key] = { vendor: slot.vendor, rows: result.totalRows, metrics: result.metricsCreated, uploadId: result.uploadId, pdf: true };
          setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'success', message: `${result.metricsCreated} metrics from ${result.totalRows} pitches (${result.pitchTypes.join(', ')})`, rows: result.totalRows, metrics: result.metricsCreated } }));
          continue;
        }
        const uploaded: ExistingFile[] = [];
        for (const file of files) {
          const result = await api.uploadCSV(file, userId, SOURCE_BY_VENDOR[slot.vendor], player.id);
          uploaded.push({ name: file.name, uploadId: result.uploadId, rows: result.totalRows, metrics: result.metricsCreated });
        }
        /* Multi-file slots append to what the coach kept; single-file
           slots replace. */
        const kept = slot.multi ? existingFilesOf(existing[slot.key] || null).filter(f => f.uploadId) : [];
        const all = [...kept, ...uploaded];
        merged[slot.key] = slot.multi
          ? {
              vendor: slot.vendor,
              files: all,
              uploadIds: all.map(f => f.uploadId).filter(Boolean),
              uploadId: all[0]?.uploadId,
              rows: all.reduce((s, f) => s + (f.rows || 0), 0),
              metrics: all.reduce((s, f) => s + (f.metrics || 0), 0),
            }
          : { vendor: slot.vendor, uploadId: uploaded[0]?.uploadId, rows: uploaded[0]?.rows, metrics: uploaded[0]?.metrics };
        const rows = uploaded.reduce((s, r) => s + (r.rows || 0), 0);
        const metrics = uploaded.reduce((s, r) => s + (r.metrics || 0), 0);
        setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'success', message: uploaded.length > 1 ? `${uploaded.length} files · ${metrics} metrics from ${rows} rows` : `${metrics} metrics from ${rows} rows`, rows, metrics } }));
      } catch (err: any) {
        failures++;
        stillStaged[slot.key] = files;
        setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'error', message: err?.message || 'Upload failed' } }));
      }
    }

    const set: Record<string, unknown> = {
      csvUploads: Object.keys(merged).length > 0 ? merged : null,
    };
    if (isHitting) {
      /* At-Bat lifecycle, as in the modal: a new XLSX writes its block;
         a kept slot leaves it alone; a removed slot clears it so the
         snapshot stops showing at-bats that are no longer attached. */
      if (atBatData) set.atBatAssessment = atBatData;
      else if (!merged.atbat && initialExisting.atbat) set.atBatAssessment = null;

      set.manualBattedBall = manualMode.fullswing ? { ...manualBb } : emptyBattedBall();
      set.manualSwingMetrics = manualMode.blast ? { ...manualSwing } : { ...EMPTY_SWING };
      set.manualHitTrax = manualMode.hittrax ? { ...manualHt } : emptyHitTrax();
      set.manualEntryModes = { fullswing: !!manualMode.fullswing, blast: !!manualMode.blast, hittrax: !!manualMode.hittrax };
    }
    if (isPitching) {
      const typed = Object.fromEntries(Object.entries(manualPitch).filter(([, v]) => v != null && v > 0));
      set.manualPitchMax = Object.keys(typed).length ? typed : null;
    }

    try {
      await api.mergeReportContent(report.id, { set });
      setExisting(merged);
      setInitialExisting(merged);
      setCsvFiles(stillStaged);
      setTouched(false);
      onSaved();
      if (failures === 0) onClose();
      else setSaveError(`${failures === 1 ? 'One upload' : `${failures} uploads`} failed. Everything else was saved — fix or remove the failed file and press Save again.`);
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save to the report.');
    } finally {
      setSaving(false);
    }
  };

  const title = report.title?.trim() || `${reportType.charAt(0)}${reportType.slice(1).toLowerCase()} Report`;

  return (
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className={styles.modalContent} style={{ maxWidth: 1000 }}>
        <div className={styles.modalHeader}>
          <div style={{ minWidth: 0 }}>
            <h2 className={styles.modalTitle}>Upload Data — {title}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
              {player.firstName} {player.lastName} · {fmtDate(report.createdAt)}
            </div>
          </div>
          <button type="button" className={styles.modalClose} onClick={requestClose} disabled={saving}>x</button>
        </div>

        <div className={styles.modalBody}>
          {loadError ? (
            <div role="alert" style={{ color: 'var(--text)' }}>{loadError}</div>
          ) : !fresh ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : visibleSlots(slots, initialExisting).length === 0 ? (
            <div style={{ color: 'var(--text-muted)' }}>This report type has no data files to upload.</div>
          ) : (
            <div className={rs.section}>
              <div className={rs.sectionHeader}>
                <span className={rs.sectionIcon}>📊</span>
                <span className={rs.sectionTitle}>Data Imports</span>
                <span className={rs.sectionCount}>{visibleSlots(slots, initialExisting).length} {visibleSlots(slots, initialExisting).length === 1 ? 'source' : 'sources'}</span>
              </div>
              <div className={rs.csvGrid}>
                {/* Retired cards (HitTrax POI) only where the report already
                    has one of their files -- judged from what was attached
                    when the window opened, so removing the last file keeps
                    the card on screen until Save. */}
                {visibleSlots(slots, initialExisting).map(slot => {
                  /* Hitting's Blast, Full Swing and HitTrax cards offer
                     Manual Entry. */
                  const supportsManual = isHitting && (slot.key === 'blast' || slot.key === 'fullswing' || slot.key === 'hittrax');
                  const isManual = supportsManual && !!manualMode[slot.key];
                  const setSw = (key: keyof ManualSwingMetrics, raw: string) => {
                    setTouched(true);
                    setManualSwing(prev => ({ ...prev, [key]: raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : prev[key]) }));
                  };
                  const setBb = (key: keyof ManualBattedBall, raw: string) => {
                    setTouched(true);
                    setManualBb(prev => ({ ...prev, [key]: raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : prev[key]) }));
                  };
                  const setHt = (key: keyof ManualHitTrax, raw: string) => {
                    setTouched(true);
                    setManualHt(prev => ({ ...prev, [key]: raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : prev[key]) }));
                  };
                  const manualNode = isManual
                    ? (slot.key === 'blast'
                        ? <ManualMetricBubbles fields={MANUAL_SWING_METRIC_FIELDS} values={manualSwing} onChange={setSw} />
                        : slot.key === 'hittrax'
                          ? <ManualMetricBubbles fields={MANUAL_HITTRAX_FIELDS} values={manualHt} onChange={setHt} />
                          : <ManualMetricBubbles fields={MANUAL_BATTED_BALL_FIELDS} values={manualBb} onChange={setBb} />)
                    : undefined;
                  return (
                    <CsvUploadCard
                      key={slot.key}
                      slot={slot}
                      files={csvFiles[slot.key] || []}
                      uploadResult={csvResults[slot.key] || null}
                      existingUpload={existing[slot.key] || null}
                      onSelect={fs => handleSelect(slot, fs)}
                      onRemoveFile={idx => handleRemoveStaged(slot, idx)}
                      onRemoveExistingFile={id => handleRemoveExisting(slot, id)}
                      manualMode={isManual}
                      onToggleManual={supportsManual
                        ? () => { setTouched(true); setManualMode(prev => ({ ...prev, [slot.key]: !prev[slot.key] })); }
                        : undefined}
                      manualNode={manualNode}
                    />
                  );
                })}
              </div>
              {/* Manual Max Velo: kept alongside the TrackMan files, not
                  instead of them. Each pitch type shows the higher of this
                  and the file's best (Arsenal, PDF, Max FB Velo trend and
                  leaderboard). */}
              {isPitching && (
                <div style={{ marginTop: 14 }}>
                  <div className={rs.sectionHeader} style={{ marginBottom: 6 }}>
                    <span className={rs.sectionTitle}>Manual Max Velo</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                    Optional. A number here is used when it&rsquo;s higher than the uploaded file&rsquo;s best for that pitch.
                  </div>
                  <ManualMetricBubbles
                    fields={PITCH_MAX_FIELDS}
                    values={manualPitch}
                    onChange={(key, raw) => {
                      setTouched(true);
                      setManualPitch(prev => ({ ...prev, [key]: raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : prev[key]) }));
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {saveError && (
            <div role="alert" style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--red, #ef4444)', background: 'rgba(239,68,68,0.08)', color: 'var(--text)',
            }}>{saveError}</div>
          )}

          <div className={rs.submitRow}>
            {confirmDiscard ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Discard the files and changes you haven&rsquo;t saved?</span>
                <button type="button" onClick={onClose}
                  style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--text)', background: 'var(--text)', color: 'var(--bg, #0e1116)' }}>Yes</button>
                <button type="button" onClick={() => setConfirmDiscard(false)}
                  style={{ padding: '7px 18px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)' }}>No</button>
              </span>
            ) : (
              <button type="button" className={rs.submitBtn} onClick={() => void save()} disabled={saving || !fresh || !dirty}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
