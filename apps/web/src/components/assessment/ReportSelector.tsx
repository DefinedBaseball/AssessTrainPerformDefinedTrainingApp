'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import * as api from '@/lib/api';
import styles from './assessment.module.css';

export interface ReportSummary {
  id: string;
  reportType: string;
  title?: string | null;
  notes: string | null;
  videoIds: string | null;
  content: string | null;
  createdAt: string;
  createdBy: { id: string; email: string; role: string } | null;
}

interface ReportSelectorProps {
  reports: ReportSummary[];
  reportTypes: string[];
  label: string;
  isCoach: boolean;
  selectedId: string | null;
  onSelect: (report: ReportSummary | null) => void;
  onDeleted?: () => void;
}

export function ReportSelector({
  reports,
  reportTypes,
  label,
  isCoach,
  selectedId,
  onSelect,
  onDeleted,
}: ReportSelectorProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Filter & sort matching reports
  // When reportTypes is empty, skip type filtering (use all provided reports)
  const matchingReports = useMemo(() => {
    const filtered = reportTypes.length > 0
      ? reports.filter(r => reportTypes.includes(r.reportType))
      : reports;
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reports, reportTypes]);

  // Auto-select most recent if no selection (or selection no longer in list)
  useEffect(() => {
    if (matchingReports.length === 0) {
      if (selectedId !== null) onSelect(null);
      return;
    }
    const current = selectedId ? matchingReports.find(r => r.id === selectedId) : null;
    if (!current) {
      onSelect(matchingReports[0]);
    }
  }, [matchingReports, selectedId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await api.deleteReport(id);
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

  const getEmailName = (email: string) => email.split('@')[0];

  const selected = selectedId ? matchingReports.find(r => r.id === selectedId) : matchingReports[0];

  if (matchingReports.length === 0) {
    return (
      <div className={styles.reportSelector}>
        <div className={styles.reportSelectorBar}>
          <span className={styles.reportSelectorLabel}>{label} Reports</span>
          <span className={styles.reportSelectorEmpty}>No reports yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.reportSelector} ref={dropRef}>
      {/* ── Selector Bar ── */}
      <button
        type="button"
        className={`${styles.reportSelectorBar} ${open ? styles.reportSelectorBarOpen : ''}`}
        onClick={() => { setOpen(o => !o); setConfirmId(null); }}
      >
        <div className={styles.reportSelectorLeft}>
          <span className={styles.reportSelectorIcon}>📋</span>
          <div className={styles.reportSelectorInfo}>
            <span className={styles.reportSelectorTitle}>
              {selected?.title || selected?.reportType?.replace(/_/g, ' ') || label}
            </span>
            <span className={styles.reportSelectorMeta}>
              {selected ? `${formatDate(selected.createdAt)} at ${formatTime(selected.createdAt)}` : ''}
              {selected?.createdBy && ` · ${getEmailName(selected.createdBy.email)}`}
            </span>
          </div>
        </div>
        <div className={styles.reportSelectorRight}>
          <span className={styles.reportSelectorCount}>
            {matchingReports.length} report{matchingReports.length !== 1 ? 's' : ''}
          </span>
          <span className={`${styles.reportSelectorArrow} ${open ? styles.reportSelectorArrowOpen : ''}`}>
            ▼
          </span>
        </div>
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className={styles.reportSelectorDropdown}>
          {matchingReports.map(r => {
            const isActive = r.id === selected?.id;
            return (
              <div
                key={r.id}
                className={`${styles.reportSelectorItem} ${isActive ? styles.reportSelectorItemActive : ''}`}
              >
                <button
                  type="button"
                  className={styles.reportSelectorItemBtn}
                  onClick={() => {
                    onSelect(r);
                    setOpen(false);
                    setConfirmId(null);
                  }}
                >
                  <div className={styles.reportSelectorItemInfo}>
                    <div className={styles.reportSelectorItemTitle}>
                      {isActive && <span className={styles.reportSelectorCheck}>✓</span>}
                      {r.title || r.reportType?.replace(/_/g, ' ')}
                    </div>
                    <div className={styles.reportSelectorItemMeta}>
                      {formatDate(r.createdAt)} at {formatTime(r.createdAt)}
                      {r.createdBy && <> · {getEmailName(r.createdBy.email)}</>}
                    </div>
                    {r.notes && (
                      <div className={styles.reportSelectorItemNotes}>{r.notes}</div>
                    )}
                  </div>
                </button>

                {isCoach && (
                  <div className={styles.reportSelectorItemActions}>
                    {confirmId === r.id ? (
                      <div className={styles.reportDeleteConfirm}>
                        <span className={styles.reportDeleteMsg}>Delete?</span>
                        <button
                          type="button"
                          className={styles.reportDeleteYes}
                          onClick={(e) => { e.stopPropagation(); handleDelete(r.id); }}
                          disabled={deleting === r.id}
                        >
                          {deleting === r.id ? '...' : 'Yes'}
                        </button>
                        <button
                          type="button"
                          className={styles.reportDeleteNo}
                          onClick={(e) => { e.stopPropagation(); setConfirmId(null); }}
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={styles.reportDeleteBtn}
                        onClick={(e) => { e.stopPropagation(); setConfirmId(r.id); }}
                        title="Delete report"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
