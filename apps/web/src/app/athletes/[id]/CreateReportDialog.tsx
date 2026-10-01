'use client';

/* "+ Report" -- create an empty report from a type and a name.

   Everything else (data files, notes, coach notes, videos) is filled in on
   the report's own tab afterwards. The same dialog renames an existing
   report from the pencil in the report dropdown; the type is locked then,
   because changing a report's type would leave its content describing the
   wrong kind of report. */

import type React from 'react';
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import type { ReportSummary } from '@/components/assessment/ReportSelector';
import rs from '@/components/assessment/report-form.module.css';
import styles from './page.module.css';
import { REPORT_TYPES, EyeVisibilityToggle } from './ReportModal';
import { REPORT_TYPE_TO_TAB } from './helpers';

export type CreateReportMode =
  | { kind: 'create'; initialType?: string }
  | { kind: 'rename'; report: ReportSummary };

export function CreateReportDialog({
  player, userId, mode, onClose, onCreated, onRenamed,
}: {
  player: Player;
  userId: string;
  mode: CreateReportMode;
  onClose: () => void;
  /** Called with the saved row so the page can open its tab and select it. */
  onCreated: (report: { id: string; reportType: string }) => void;
  onRenamed: () => void;
}) {
  const renaming = mode.kind === 'rename';
  const [reportType, setReportType] = useState<string>(
    renaming ? mode.report.reportType : (mode.initialType && REPORT_TYPES.some(t => t.id === mode.initialType) ? mode.initialType : ''),
  );
  const [name, setName] = useState(renaming ? (mode.report.title || '') : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!reportType) { setError('Choose a report type'); return; }
    if (!name.trim()) { setError('Name the report'); return; }
    setError('');
    setSaving(true);
    try {
      if (mode.kind === 'rename') {
        await api.mergeReportContent(mode.report.id, { title: name.trim() });
        onRenamed();
      } else {
        /* An empty report: `content` is required by the API, and '{}' is
           what every tab already treats as "no data yet". */
        const created = await api.createReport({
          playerId: player.id,
          createdById: userId,
          reportType,
          title: name.trim(),
          content: '{}',
        });
        onCreated({ id: created.id, reportType });
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || (renaming ? 'Could not rename the report.' : 'Could not create the report.'));
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = REPORT_TYPES.find(t => t.id === reportType)?.label ?? reportType;

  return (
    <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className={styles.modalContent} style={{ maxWidth: 640 }}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {renaming ? 'Rename Report' : 'New Report'} — {player.firstName} {player.lastName}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* The only control that hides a tab from the athlete -- it lived
                in the report modal's header, so it comes along. */}
            {reportType && REPORT_TYPE_TO_TAB[reportType] && (
              <EyeVisibilityToggle
                playerId={player.id}
                tabKey={REPORT_TYPE_TO_TAB[reportType]}
                tabLabel={typeLabel}
              />
            )}
            <button type="button" className={styles.modalClose} onClick={onClose} disabled={saving}>x</button>
          </div>
        </div>

        <form onSubmit={submit} className={styles.modalBody}>
          <div className={rs.fieldGroup}>
            <label className={rs.label}>Report Type</label>
            <div className={rs.chipRow}>
              {REPORT_TYPES.map(t => {
                const locked = renaming && t.id !== reportType;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={locked}
                    className={`${rs.chip} ${reportType === t.id ? rs.chipActive : ''}`}
                    title={renaming ? "A report's type can't be changed" : undefined}
                    style={locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    onClick={renaming ? undefined : () => { setReportType(t.id); setError(''); }}
                  >
                    <span className={rs.chipIcon}>{t.icon}</span>{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={rs.fieldGroup}>
            <label className={rs.label}>Report Name</label>
            <input
              type="text"
              className={rs.summaryInput}
              value={name}
              autoFocus
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Spring Assessment, Weekly Session 3..."
              style={{ width: '100%' }}
            />
          </div>

          {error && (
            <div role="alert" style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 13,
              border: '1px solid var(--red, #ef4444)', background: 'rgba(239,68,68,0.08)', color: 'var(--text)',
            }}>{error}</div>
          )}

          <div className={rs.submitRow}>
            <button type="submit" className={rs.submitBtn} disabled={saving}>
              {saving ? (renaming ? 'Saving…' : 'Creating…') : (renaming ? 'Save Name' : 'Create Report')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
