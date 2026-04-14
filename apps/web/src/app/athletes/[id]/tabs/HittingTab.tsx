'use client';

import { useState } from 'react';
import { SwingBattedBallTab } from './SwingBattedBallTab';
import { PitchRecognitionTab } from './PitchRecognitionTab';
import { DownloadPdfButton } from '@/components/assessment';
import { generateHittingPdf } from '@/lib/pdf';
import type { TabProps } from '../helpers';

const SUB_TABS = [
  { key: 'swing', label: 'Swing / Batted Ball' },
  { key: 'pitch-rec', label: 'At-Bat Results' },
] as const;

type SubTabKey = (typeof SUB_TABS)[number]['key'];

export function HittingTab(props: TabProps) {
  const [subTab, setSubTab] = useState<SubTabKey>('swing');

  return (
    <>
      {/* ── Download Button ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <DownloadPdfButton
          label="Download Hitting PDF"
          onDownload={() => generateHittingPdf(props.player, props.reports, props.topMetrics)}
        />
      </div>

      {/* ── Sub-tab bar ── */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid var(--border)',
        marginBottom: 24,
      }}>
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setSubTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: subTab === t.key
                ? '2px solid var(--accent)'
                : '2px solid transparent',
              color: subTab === t.key ? 'var(--accent-light)' : 'var(--text-muted)',
              fontSize: 13,
              fontWeight: 600,
              padding: '10px 20px',
              cursor: 'pointer',
              transition: 'color 0.15s ease, border-color 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sub-tab content ── */}
      {subTab === 'swing' && <SwingBattedBallTab {...props} />}
      {subTab === 'pitch-rec' && <PitchRecognitionTab {...props} />}
    </>
  );
}
