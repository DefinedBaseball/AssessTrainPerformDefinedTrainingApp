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
}

const TAB_BAR_ACTIONS_ID = 'pd-tab-bar-actions';

export function TabBar({ tabs, activeKey, onTabChange }: TabBarProps) {
  return (
    <div className={styles.tabBarOuter}>
      <div className={styles.tabBarInner}>
        <div className={styles.tabBar}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`${styles.tabBtn} ${activeKey === tab.key ? styles.tabActive : ''}`}
              onClick={() => onTabChange(tab.key)}
              type="button"
            >
              {tab.icon ? <span className={styles.tabIcon} aria-hidden="true">{tab.icon}</span> : null}
              <span className={styles.tabLabel}>{tab.label}</span>
            </button>
          ))}
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
