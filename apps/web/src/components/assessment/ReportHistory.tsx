'use client';

import { useState, useEffect } from 'react';
import * as api from '@/lib/api';
import styles from './assessment.module.css';

interface Report {
  id: string;
  reportType: string;
  title: string | null;
  notes: string | null;
  content: string;
  createdAt: string;
  createdBy: { id: string; email: string; role: string } | null;
}

interface ReportHistoryProps {
  playerId: string;
  reportTypes: string[];       // e.g. ['HITTING'] or ['INFIELD','OUTFIELD','CATCHING']
  label: string;               // e.g. "Swing / Batted Ball"
  isCoach: boolean;
  onDeleted?: () => void;      // callback after deletion to refresh parent
}

export function ReportHistory({ playerId, reportTypes, label, isCoach, onDeleted }: ReportHistoryProps) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    // Fetch reports for all matching types
    Promise.all(reportTypes.map(t => api.getPlayerReports(playerId, t)))
      .then(results => {
        const all = results.flat() as Report[];
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setReports(all);
      })
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [open, playerId, reportTypes.join(',')]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await api.deleteReport(id);
      setReports(prev => prev.filter(r => r.id !== id));
      setConfirmId(null);
      onDeleted?.();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete report');
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getEmailName = (email: string) => {
    return email.split('@')[0];
  };

  return (
    <div className={styles.reportHistory}>
      <button
        type="button"
        className={styles.allReportsBtn}
        onClick={() => setOpen(!open)}
      >
        All {label} Reports
        <span className={styles.allReportsBtnArrow}>{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className={styles.reportHistoryPanel}>
          {loading && <div className={styles.reportHistoryEmpty}>Loading reports...</div>}
          {!loading && reports.length === 0 && (
            <div className={styles.reportHistoryEmpty}>No previous reports found.</div>
          )}
          {!loading && reports.length > 0 && (
            <div className={styles.reportHistoryList}>
              {reports.map(r => (
                <div key={r.id} className={styles.reportHistoryItem}>
                  <div className={styles.reportHistoryInfo}>
                    <div className={styles.reportHistoryType}>
                      {r.title || r.reportType}
                    </div>
                    <div className={styles.reportHistoryMeta}>
                      {formatDate(r.createdAt)} at {formatTime(r.createdAt)}
                      {r.createdBy && <> &middot; {getEmailName(r.createdBy.email)}</>}
                    </div>
                    {r.notes && <div className={styles.reportHistoryNotes}>{r.notes}</div>}
                  </div>
                  {isCoach && (
                    <div className={styles.reportHistoryActions}>
                      {confirmId === r.id ? (
                        <div className={styles.reportDeleteConfirm}>
                          <span className={styles.reportDeleteMsg}>Delete?</span>
                          <button
                            type="button"
                            className={styles.reportDeleteYes}
                            onClick={() => handleDelete(r.id)}
                            disabled={deleting === r.id}
                          >
                            {deleting === r.id ? '...' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            className={styles.reportDeleteNo}
                            onClick={() => setConfirmId(null)}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.reportDeleteBtn}
                          onClick={() => setConfirmId(r.id)}
                          title="Delete report"
                        >
                          x
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
