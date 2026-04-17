'use client';

import type { ReactNode } from 'react';
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

export function TabBar({ tabs, activeKey, onTabChange }: TabBarProps) {
  return (
    <div className={styles.tabBarOuter}>
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
    </div>
  );
}

interface TabPanelProps {
  active: boolean;
  children: React.ReactNode;
}

export function TabPanel({ active, children }: TabPanelProps) {
  if (!active) return null;
  return <div className={styles.tabPanel}>{children}</div>;
}
