'use client';

/* Report types + the tab show/hide eye. Split out of ReportModal so screens
   that only need these (the + Report dialog on the profile) don't pull the
   entire report editor into the profile page's first load. */

import { useEffect, useState } from 'react';
import { getHiddenTabs, setHiddenTabsForPlayer } from './helpers';

export const REPORT_TYPES = [
  // HITTING is the consolidated hitting report — it carries the swing
  // (blast/fullswing) section AND a swing-decision (at-bat) section in a single
  // form. The standalone AT_BAT_RESULTS chip was retired in favor of this.
  // SUMMARY is no longer a chip — it's reachable via the "Edit Profile"
  // button in the modal header. The branch still exists in render/submit.
  { id: 'HITTING', label: 'Hitting', icon: '🏏' },
  { id: 'PITCHING', label: 'Pitching', icon: '⚾' },
  { id: 'STRENGTH', label: 'Physical', icon: '💪' },
  // Defense cluster — Infield · Outfield · Catching grouped at the end
  { id: 'INFIELD', label: 'Infield', icon: '🧤' },
  { id: 'OUTFIELD', label: 'Outfield', icon: '🏃' },
  { id: 'CATCHING', label: 'Catching', icon: '🎯' },
];

/* ─── Eye visibility toggle ────────────────────────────────────────────
   Sits in the Report modal header (left of the close X). Reflects the
   visibility state of the currently-selected report type's matching
   profile tab. Click → toggle hidden/shown. The eye renders open when
   the tab is visible and slashed when it's hidden, mirroring the
   familiar password-field show/hide UX.

   Saved on the athlete (Player.hiddenTabs) via `setHiddenTabsForPlayer`,
   so every login -- the athlete's included -- sees the same tabs. A
   custom `player:hiddenTabsChanged` event fires on every save so the
   tab bar over in page.tsx re-reads the preference live (no full page
   refresh required). */
export function EyeVisibilityToggle({
  playerId, tabKey, tabLabel,
}: {
  playerId: string;
  tabKey: string;
  tabLabel: string;
}) {
  // Local mirror of the persisted state so the icon swap is immediate
  // when the user clicks — page.tsx still re-reads from localStorage
  // via the dispatched event.
  const [isHidden, setIsHidden] = useState<boolean>(() =>
    getHiddenTabs(playerId).includes(tabKey),
  );

  // Re-read whenever the report type changes (the `tabKey` prop swaps).
  // useState's initializer runs only once on mount, so without this the
  // eye would keep showing the previous tab's hidden state after the
  // user clicked a different Report Type chip.
  useEffect(() => {
    setIsHidden(getHiddenTabs(playerId).includes(tabKey));
  }, [playerId, tabKey]);

  // Keep in sync if another EyeVisibilityToggle (e.g. user opens the
  // modal twice in different orders) writes a new value. Listens to the
  // same event the tab bar listens to.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { playerId?: string } | undefined;
      if (!detail || detail.playerId === playerId) {
        setIsHidden(getHiddenTabs(playerId).includes(tabKey));
      }
    };
    window.addEventListener('player:hiddenTabsChanged', handler as EventListener);
    return () => window.removeEventListener('player:hiddenTabsChanged', handler as EventListener);
  }, [playerId, tabKey]);

  function toggle() {
    const current = getHiddenTabs(playerId);
    const next = current.includes(tabKey)
      ? current.filter(k => k !== tabKey)
      : [...current, tabKey];
    setIsHidden(next.includes(tabKey));
    /* Saved to the athlete on the server. A failed save is rolled back in
       the cache; re-read so the eye shows what actually stuck. */
    void setHiddenTabsForPlayer(playerId, next).catch(() => {
      setIsHidden(getHiddenTabs(playerId).includes(tabKey));
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isHidden
        ? `Click to show the ${tabLabel} tab on this player's profile`
        : `Click to hide the ${tabLabel} tab from this player's profile`}
      aria-pressed={isHidden}
      aria-label={isHidden ? `Show ${tabLabel} tab` : `Hide ${tabLabel} tab`}
      style={{
        background: 'var(--border)',
        color: isHidden ? '#fda4af' : '#86efac',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 8px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
      }}
    >
      {isHidden ? <EyeOffIconSvg /> : <EyeIconSvg />}
    </button>
  );
}

function EyeIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
