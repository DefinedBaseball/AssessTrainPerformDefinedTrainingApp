'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './assessment.module.css';

export interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabBarProps {
  tabs: Tab[];
  activeKey: string;
  onTabChange: (key: string) => void;
  /**
   * When true, every tab button is stretched to fill an equal share of
   * the available width. Useful for short, fixed-count sub-tab navs
   * (e.g. Swing / Swing Decision) where you want symmetric balance.
   * Off by default — the page-shell TabBar keeps natural button widths
   * so longer labels (e.g. "Player Summary") get the room they need.
   */
  fullWidth?: boolean;
  /**
   * Pinned to the FAR RIGHT of the tabs row itself (not the actions slot).
   * The actions slot wraps onto its own line below 640px; anything here
   * stays on the tab line at every width. Used by the profile for the
   * Videos jump button.
   */
  rightSlot?: ReactNode;
}

const TAB_BAR_ACTIONS_ID = 'pd-tab-bar-actions';

export function TabBar({ tabs, activeKey, onTabChange, fullWidth, rightSlot }: TabBarProps) {
  return (
    <div className={styles.tabBarOuter}>
      <div className={styles.tabBarInner}>
      {/* Row 1 — the tabs plus any rightSlot. Wrapping them together keeps
          the slot glued to the tab line when .tabBarInner wraps on phones. */}
      <div className={styles.tabBarRow}>
        <div
          className={styles.tabBar}
          /* Distribute tabs evenly when fullWidth is on. Inline-style
           * override (instead of a second CSS class) keeps the default
           * cascade intact — only this instance is affected. */
          style={fullWidth ? { display: 'flex' } : undefined}
        >
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`${styles.tabBtn} ${activeKey === tab.key ? styles.tabActive : ''}`}
              onClick={() => onTabChange(tab.key)}
              type="button"
              style={fullWidth ? { flex: 1, justifyContent: 'center' } : undefined}
            >
              {tab.icon ? <span className={styles.tabIcon} aria-hidden="true">{tab.icon}</span> : null}
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
          ))}
        </div>
        {rightSlot && <div className={styles.tabBarRight}>{rightSlot}</div>}
      </div>
        <div id={TAB_BAR_ACTIONS_ID} className={styles.tabBarActions} />
      </div>
    </div>
  );
}

/**
 * Portals its children into the TabBar's right-hand actions slot.
 * Use this in individual tab components to promote per-tab controls
 * (e.g. ReportSelector + DownloadPdfButton) up into the shared tab bar.
 */
export function TabBarActions({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(TAB_BAR_ACTIONS_ID));
  }, []);

  if (!target) return null;
  return createPortal(children, target);
}

interface TabPanelProps {
  active: boolean;
  children: React.ReactNode;
}

export function TabPanel({ active, children }: TabPanelProps) {
  if (!active) return null;
  return <div className={styles.tabPanel}>{children}</div>;
}
