'use client';

import styles from './assessment.module.css';

interface AddReportButtonProps {
  /** Click handler — typically opens the New Report modal on the parent profile. */
  onClick?: () => void;
  /** Hide the button entirely (e.g. when not a coach). When undefined, button is shown. */
  show?: boolean;
  /** Label override. Defaults to "Add Report". */
  label?: string;
}

/* Standalone "+ Add Report" button rendered into TabBarActions. Mirrors the
   visual style of DownloadPdfButton so the two read as a coherent pair on
   every tab's action bar. */
export function AddReportButton({ onClick, show = true, label = 'Add Report' }: AddReportButtonProps) {
  if (!show || !onClick) return null;
  return (
    <button
      type="button"
      className={styles.addReportBtn}
      onClick={onClick}
      title={label}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
           stroke="currentColor" strokeWidth="1.7"
           strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3v10M3 8h10" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
