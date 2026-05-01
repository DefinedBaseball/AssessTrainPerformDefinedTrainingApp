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
  /** When provided and isCoach, shows a "+ New Report" row inside the dropdown
   *  (and in the empty state) that invokes this handler. */
  onNewReport?: () => void;
  /** When provided, each report row gets a small Download button that calls
   *  this handler with the report — used by tabs to generate a PDF tied to
   *  that specific report. */
  onDownload?: (report: ReportSummary) => void;
  /** When provided, clicking the report name on the bar opens this report
   *  for editing (the ▼ arrow on the far right always toggles the list). */
  onEdit?: (report: ReportSummary) => void;
  /** When true, the dropdown becomes a pure date-range picker — no list of
   *  individual reports, no per-row download/delete. The bar shows the
   *  currently-selected range label instead of a report title. */
  rangeOnly?: boolean;
}

export function ReportSelector({
  reports,
  reportTypes,
  label,
  isCoach,
  selectedId,
  onSelect,
  onDeleted,
  onNewReport,
  onDownload,
  onEdit,
  rangeOnly = false,
}: ReportSelectorProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  /** Date-range presets — "Last Report" = single most recent report; the rest
   *  are time windows (days back from now). days=null means no time filter. */
  type RangeKey = 'lastReport' | 'all' | 'week' | 'month' | '3months' | '6months' | 'year';
  const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
    { key: 'lastReport', label: 'Last Report',   days: null },
    { key: 'all',        label: 'All Time',      days: null },
    { key: 'week',       label: 'Last Week',     days: 7 },
    { key: 'month',      label: 'Last Month',    days: 30 },
    { key: '3months',    label: 'Last 3 Months', days: 90 },
    { key: '6months',    label: 'Last 6 Months', days: 180 },
    { key: 'year',       label: 'Last Year',     days: 365 },
  ];
  const [dateRange, setDateRange] = useState<RangeKey>('lastReport');

  // Filter by report type first, then sort newest-first.
  const typeFilteredReports = useMemo(() => {
    const filtered = reportTypes.length > 0
      ? reports.filter(r => reportTypes.includes(r.reportType))
      : reports;
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reports, reportTypes]);

  // Apply the date-range preset on top of the type filter.
  //   lastReport → single newest report (or empty if none on file)
  //   all        → every report (no time cutoff)
  //   N days     → reports newer than now − N days
  const matchingReports = useMemo(() => {
    if (dateRange === 'lastReport') {
      return typeFilteredReports.length > 0 ? [typeFilteredReports[0]] : [];
    }
    const def = RANGE_OPTIONS.find(o => o.key === dateRange);
    if (!def || def.days === null) return typeFilteredReports;
    const cutoff = Date.now() - def.days * 24 * 60 * 60 * 1000;
    return typeFilteredReports.filter(r => new Date(r.createdAt).getTime() >= cutoff);
  }, [typeFilteredReports, dateRange]);

  // Auto-select most recent if no selection (or selection no longer in list).
  // Skipped in rangeOnly mode — that mode doesn't track an active report.
  useEffect(() => {
    if (rangeOnly) return;
    if (matchingReports.length === 0) {
      if (selectedId !== null) onSelect(null);
      return;
    }
    const current = selectedId ? matchingReports.find(r => r.id === selectedId) : null;
    if (!current) {
      onSelect(matchingReports[0]);
    }
  }, [matchingReports, selectedId, rangeOnly]);

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

  if (typeFilteredReports.length === 0 && !rangeOnly) {
    // Truly empty — no reports of this type exist for the player at all.
    // (When type-matching reports DO exist but the date-range filter excludes
    //  them, we fall through to the populated branch so the user can still
    //  change the range from inside the dropdown. rangeOnly mode also falls
    //  through so the date picker stays visible regardless of report count.)
    return (
      <div className={styles.reportSelector}>
        <button
          type="button"
          className={styles.reportSelectorBar}
          disabled
          style={{ cursor: 'default', opacity: 0.85 }}
        >
          <div className={styles.reportSelectorLeft}>
            <span className={styles.reportSelectorIcon}>📋</span>
            <div className={styles.reportSelectorInfo}>
              <span className={styles.reportSelectorTitle}>{label}</span>
              <span className={styles.reportSelectorMeta}>No reports yet</span>
            </div>
          </div>
          <div className={styles.reportSelectorRight}>
            <span className={styles.reportSelectorCount}>0 reports</span>
            <span className={styles.reportSelectorArrow}>▼</span>
          </div>
        </button>
      </div>
    );
  }

  const activeRangeLabel = RANGE_OPTIONS.find(o => o.key === dateRange)?.label ?? 'All Time';

  return (
    <div className={styles.reportSelector} ref={dropRef}>
      {/* ── Selector Bar (split into two click targets) ── */}
      <div className={`${styles.reportSelectorBar} ${open ? styles.reportSelectorBarOpen : ''}`}>
        {rangeOnly ? (
          // Range-only mode — single click target opens the date-range picker.
          <button
            type="button"
            className={styles.reportSelectorTitleBtn}
            onClick={() => { setOpen(o => !o); setConfirmId(null); }}
            title="Filter by date range"
            aria-expanded={open}
            style={{ flex: 1 }}
          >
            <div className={styles.reportSelectorLeft}>
              <span className={styles.reportSelectorIcon}>📅</span>
              <div className={styles.reportSelectorInfo}>
                <span className={styles.reportSelectorTitle}>{label}</span>
                <span className={styles.reportSelectorMeta}>{activeRangeLabel}</span>
              </div>
            </div>
          </button>
        ) : (
          <>
            {/* LEFT — coach: clicking the title/meta opens the selected
                  report for editing. Player / non-coach: only toggles the
                  dropdown so they can browse but never enter the edit flow. */}
            <button
              type="button"
              className={styles.reportSelectorTitleBtn}
              onClick={() => {
                if (isCoach && selected && onEdit) {
                  onEdit(selected);
                  setOpen(false);
                  setConfirmId(null);
                } else {
                  setOpen(o => !o);
                  setConfirmId(null);
                }
              }}
              title={isCoach && selected && onEdit ? 'Edit this report' : 'Open report list'}
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
            </button>
            {/* RIGHT — the count chip + arrow toggles the dropdown of past reports. */}
            <button
              type="button"
              className={styles.reportSelectorArrowBtn}
              onClick={() => { setOpen(o => !o); setConfirmId(null); }}
              title="Browse past reports"
              aria-expanded={open}
            >
              <span className={styles.reportSelectorCount}>
                {matchingReports.length} report{matchingReports.length !== 1 ? 's' : ''}
              </span>
              <span className={`${styles.reportSelectorArrow} ${open ? styles.reportSelectorArrowOpen : ''}`}>
                ▼
              </span>
            </button>
          </>
        )}
        {rangeOnly && (
          <button
            type="button"
            className={styles.reportSelectorArrowBtn}
            onClick={() => { setOpen(o => !o); setConfirmId(null); }}
            title="Filter by date range"
            aria-expanded={open}
          >
            <span className={`${styles.reportSelectorArrow} ${open ? styles.reportSelectorArrowOpen : ''}`}>
              ▼
            </span>
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {open && (
        <div className={styles.reportSelectorDropdown}>
          {/* Date-range presets — vertical dropdown list of options. Picks the
              report set used by the rest of the tab (filter by upload date). */}
          <div className={styles.reportSelectorRangeMenu}>
            <span className={styles.reportSelectorRangeMenuLabel}>Filter by</span>
            {RANGE_OPTIONS.map(opt => {
              const active = dateRange === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  className={`${styles.reportSelectorRangeOption} ${active ? styles.reportSelectorRangeOptionActive : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDateRange(opt.key);
                    setConfirmId(null);
                    // Close after selecting in rangeOnly mode (it's the only thing in the dropdown).
                    if (rangeOnly) setOpen(false);
                  }}
                >
                  <span className={styles.reportSelectorRangeOptionCheck} aria-hidden="true">
                    {active ? '✓' : ''}
                  </span>
                  <span className={styles.reportSelectorRangeOptionLabel}>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* "+ New Report" row removed — the AddReportButton sits beside the
              bar in TabBarActions and is the canonical entry point. */}

          {matchingReports.length === 0 && !rangeOnly && (
            <div className={styles.reportSelectorRangeEmpty}>
              No reports in this date range.
            </div>
          )}
          {!rangeOnly && matchingReports.map(r => {
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

                {/* Per-row actions: Download (anyone) + Delete (coach only) */}
                {(onDownload || isCoach) && (
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
                      <>
                        {onDownload && (
                          <button
                            type="button"
                            className={styles.reportDownloadBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDownload(r);
                              setOpen(false);
                            }}
                            title="Download this report as a PDF"
                          >
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none"
                              stroke="currentColor" strokeWidth="1.6"
                              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M8 2v9" />
                              <path d="M4.5 7.5L8 11l3.5-3.5" />
                              <path d="M3 13.5h10" />
                            </svg>
                          </button>
                        )}
                        {isCoach && (
                          <button
                            type="button"
                            className={styles.reportDeleteBtn}
                            onClick={(e) => { e.stopPropagation(); setConfirmId(r.id); }}
                            title="Delete report"
                          >
                            ×
                          </button>
                        )}
                      </>
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
