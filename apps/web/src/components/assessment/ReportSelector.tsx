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
  /** When true, the bar text in the title slot is forced to the static
   *  `label` value instead of being replaced by the selected report's
   *  title. The meta line (creation date + author) still reflects the
   *  selected report so the coach can tell which one is active, and the
   *  click-to-edit behavior on the title button is preserved. Used by
   *  the Player Summary tab where the bar should always read
   *  "Player Summary" regardless of which report is currently picked. */
  lockLabel?: boolean;
  /** Optional priority list of report types used by the auto-select
   *  logic. When provided, the selector picks the latest report whose
   *  `reportType` appears first in this list, falling through to the
   *  next type if none of the earlier ones exist. Only kicks in when
   *  no selection is currently set (or the current selection has been
   *  filtered out) — manual picks from the dropdown always win.
   *  Used by the Player Summary tab: ['HITTING', 'PITCHING'] so a
   *  player who carries both types lands on their latest Hitting
   *  report first, and a pitcher-only player lands on Pitching. */
  preferredTypes?: string[];
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
  lockLabel = false,
  preferredTypes,
}: ReportSelectorProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  /** Date-range presets — "Last Report" = single most recent report; the rest
   *  are time windows (days back from now). days=null means no time filter.
   *  Order: Last Report → progressive windows → All Time at the bottom. */
  type RangeKey = 'lastReport' | 'all' | 'week' | 'month' | '3months' | '6months' | 'year';
  const RANGE_OPTIONS: { key: RangeKey; label: string; days: number | null }[] = [
    { key: 'lastReport', label: 'Last Report',   days: null },
    { key: 'week',       label: 'Last Week',     days: 7 },
    { key: 'month',      label: 'Last Month',    days: 30 },
    { key: '3months',    label: 'Last 3 Months', days: 90 },
    { key: '6months',    label: 'Last 6 Months', days: 180 },
    { key: 'year',       label: 'Last Year',     days: 365 },
    { key: 'all',        label: 'All Time',      days: null },
  ];
  /* Default to 'All Time' when a priority list is provided, so the
     priority pick can scan EVERY report for the preferred type.
     Without this, the default `'lastReport'` collapses the candidate
     pool to a single newest report — defeating the type filter if
     the global newest happens to be a non-preferred type (e.g. a
     Physical/STRENGTH report leaking into the Player Summary slot
     when the player also has Hitting on file). Falls back to the
     historical `'lastReport'` default whenever `preferredTypes` is
     absent so every other call site (HittingTab, PitchingTab, etc.)
     keeps the original behavior. */
  const [dateRange, setDateRange] = useState<RangeKey>(
    preferredTypes && preferredTypes.length > 0 ? 'all' : 'lastReport',
  );

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

  /** Pick the auto-default report from the filtered list, honoring
   *  `preferredTypes` if it was passed. The priority list is scanned
   *  in order — the first type that has at least one matching report
   *  wins; `matchingReports` is already sorted newest-first so the
   *  found report is automatically the latest of that type. Falls
   *  through to the global newest report when none of the preferred
   *  types are present. */
  const pickDefaultReport = useMemo(() => {
    if (matchingReports.length === 0) return null;
    if (preferredTypes && preferredTypes.length > 0) {
      for (const t of preferredTypes) {
        const hit = matchingReports.find(r => r.reportType === t);
        if (hit) return hit;
      }
    }
    return matchingReports[0];
  }, [matchingReports, preferredTypes]);

  // Auto-select preferred (or most recent) if no selection — or if the
  // current selection has been filtered out of the visible list.
  // Skipped in rangeOnly mode — that mode doesn't track an active report.
  useEffect(() => {
    if (rangeOnly) return;
    if (matchingReports.length === 0) {
      if (selectedId !== null) onSelect(null);
      return;
    }
    const current = selectedId ? matchingReports.find(r => r.id === selectedId) : null;
    if (!current && pickDefaultReport) {
      onSelect(pickDefaultReport);
    }
  }, [matchingReports, selectedId, rangeOnly, pickDefaultReport]);

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

  /* Fallback display target on the bar before the auto-select effect
     fires (or in the brief render where `selectedId` is still null).
     Prefers the same priority pick as the auto-select so the bar
     never momentarily shows a non-preferred report on first paint. */
  const selected = selectedId ? matchingReports.find(r => r.id === selectedId) : (pickDefaultReport ?? matchingReports[0]);

  if (typeFilteredReports.length === 0 && !rangeOnly) {
    // Truly empty — no reports of this type exist for the player at all.
    // (When type-matching reports DO exist but the date-range filter excludes
    //  them, we fall through to the populated branch so the user can still
    //  change the range from inside the dropdown. rangeOnly mode also falls
    //  through so the date picker stays visible regardless of report count.)
    //
    // For coaches with `onNewReport` wired, the bar is still interactive in
    // this state so they can open the dropdown and click "+ Report" — the
    // standalone "+ Add Report" button has been folded INTO this dropdown
    // as its first option.
    const canAdd = isCoach && !!onNewReport;
    return (
      <div className={styles.reportSelector} ref={dropRef}>
        <button
          type="button"
          className={`${styles.reportSelectorBar} ${open ? styles.reportSelectorBarOpen : ''}`}
          onClick={canAdd ? () => setOpen(o => !o) : undefined}
          disabled={!canAdd}
          style={!canAdd ? { cursor: 'default', opacity: 0.85 } : undefined}
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
            <span className={`${styles.reportSelectorArrow} ${open ? styles.reportSelectorArrowOpen : ''}`}>▼</span>
          </div>
        </button>
        {open && canAdd && (
          <div className={styles.reportSelectorDropdown}>
            <button
              type="button"
              className={styles.reportSelectorNewRow}
              onClick={(e) => {
                e.stopPropagation();
                onNewReport!();
                setOpen(false);
              }}
            >
              <span className={styles.reportSelectorNewIcon}>+</span>
              <span className={styles.reportSelectorNewText}>Report</span>
            </button>
          </div>
        )}
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
                  {/* `lockLabel` (used by the Player Summary tab) pins
                      the bar title to the static `label` so it always
                      reads "Player Summary" regardless of which report
                      is currently picked. The meta line below still
                      reflects the selected report so the coach can tell
                      which one is active, and the title click still
                      calls `onEdit(selected)` to open the report. */}
                  <span className={styles.reportSelectorTitle}>
                    {lockLabel
                      ? label
                      : (selected?.title || selected?.reportType?.replace(/_/g, ' ') || label)}
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
          {/* "+ Report" — coach-only action row pinned at the very top of
              the dropdown. Replaces the standalone "+ Add Report" button
              that previously sat in TabBarActions next to this selector. */}
          {isCoach && onNewReport && !rangeOnly && (
            <button
              type="button"
              className={styles.reportSelectorNewRow}
              onClick={(e) => {
                e.stopPropagation();
                onNewReport();
                setOpen(false);
                setConfirmId(null);
              }}
            >
              <span className={styles.reportSelectorNewIcon}>+</span>
              <span className={styles.reportSelectorNewText}>Report</span>
            </button>
          )}

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

          {/* ── List of individual reports — rendered beneath the
              range filter. Each row shows the report title, creation
              timestamp, creator, optional notes preview, and per-row
              Download (anyone) + Delete (coach) actions. Clicking a
              row activates that report on the surrounding tab. */}
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
