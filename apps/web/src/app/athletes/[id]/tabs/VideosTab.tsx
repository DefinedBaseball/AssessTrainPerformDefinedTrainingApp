'use client';

import { useState } from 'react';
import type { ReportSummary } from '../helpers';
import { TabBarActions, AddReportButton, EditProfileButton, ReportSelector } from '@/components/assessment';
import type { TabProps } from '../helpers';
import { CoachingLibrary } from './CoachingLibrary';
import { CoachingStudio } from './CoachingStudio';

const SUB_TABS = [
  { key: 'library', label: 'Library' },
  { key: 'studio',  label: 'Coaching Studio' },
] as const;

type SubKey = (typeof SUB_TABS)[number]['key'];

export function VideosTab(props: TabProps) {
  const [sub, setSub] = useState<SubKey>('library');
  const [selectedReport, setSelectedReport] = useState<ReportSummary | null>(null);

  return (
    <>
      <TabBarActions>
        <AddReportButton onClick={props.onNewReport} show={props.isCoach} />
        <EditProfileButton onClick={props.onEditProfile} show={!props.isCoach} />
        <ReportSelector
          reports={props.reports}
          reportTypes={['COACHING']}
          label="Coaching"
          isCoach={props.isCoach}
          selectedId={selectedReport?.id ?? null}
          onSelect={setSelectedReport}
          onDeleted={props.onRefresh}
          onNewReport={props.onNewReport}
          onEdit={props.onEditReport}
        />
      </TabBarActions>

      {/* Sub-tab bar */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--border)',
        marginBottom: 24,
      }}>
        {SUB_TABS.map(t => {
          const isActive = sub === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setSub(t.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                color: isActive ? 'var(--accent-light)' : 'var(--text-muted)',
                fontSize: 13,
                fontWeight: 600,
                padding: '10px 22px',
                cursor: 'pointer',
                transition: 'color 0.15s ease, border-color 0.15s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {sub === 'library' && (
        <CoachingLibrary
          {...props}
          onOpenStudio={() => setSub('studio')}
        />
      )}
      {sub === 'studio' && (
        <CoachingStudio
          {...props}
          onSaved={() => setSub('library')}
        />
      )}
    </>
  );
}
