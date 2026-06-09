'use client';

import styles from './assessment.module.css';

interface EditProfileButtonProps {
  /** Click handler — opens the player profile edit form (Summary modal). */
  onClick?: () => void;
  /** Hide the button entirely (e.g. for coaches viewing a player). */
  show?: boolean;
  /** Label override. Defaults to "Edit Profile". */
  label?: string;
}

/**
 * "Edit Profile" button rendered into TabBarActions. Uses the SAME icon-only
 * square chrome as the Download PDF button (`.downloadPdfBtn`) — same size
 * and neutral color — so the action row reads as a consistent set of icon
 * buttons. The "Edit Profile" label lives in the tooltip / aria-label.
 */
export function EditProfileButton({ onClick, show = true, label = 'Edit Profile' }: EditProfileButtonProps) {
  if (!show || !onClick) return null;
  return (
    <button
      type="button"
      className={styles.downloadPdfBtn}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
           stroke="currentColor" strokeWidth="1.7"
           strokeLinecap="round" strokeLinejoin="round">
        {/* pencil-edit glyph */}
        <path d="M11.5 2.5l2 2-8 8H3.5v-2z" />
        <path d="M10 4l2 2" />
      </svg>
    </button>
  );
}
