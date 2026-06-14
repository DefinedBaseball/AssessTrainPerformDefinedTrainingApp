'use client';

/* ScheduleDownloadModal — opens from the Training calendar toolbar (next to
   the Month/Week/Day buttons). The coach/player picks which type calendars
   to include (Hitting / Pitching / Catching / Infield / Outfield / S&C) and
   a span (Day / Week / Month), then downloads a PDF: a next-7-days drill-type
   strip on top, then one calendar per selected type with that day's drills. */

import { useState } from 'react';
import * as api from '@/lib/api';
import { useTheme } from '@/lib/theme-context';
import { downloadPdf } from '@/lib/pdf/download';
import { SchedulePdf, scheduleFetchRange, type ScheduleScope } from '@/lib/pdf/SchedulePdf';

const TYPES: { key: string; label: string; color: string }[] = [
  { key: 'hitting',  label: 'Hitting',  color: '#1E5DA0' },
  { key: 'pitching', label: 'Pitching', color: '#F59E0B' },
  { key: 'catching', label: 'Catching', color: '#14B8A6' },
  { key: 'infield',  label: 'Infield',  color: '#38A850' },
  { key: 'outfield', label: 'Outfield', color: '#88B838' },
  { key: 'strength', label: 'S & C',    color: '#EF4444' },
];
const SCOPES: { key: ScheduleScope; label: string }[] = [
  { key: 'day',   label: 'Day' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
];

interface Props {
  playerId: string;
  playerName: string;
  onClose: () => void;
}

export function ScheduleDownloadModal({ playerId, playerName, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>(TYPES.map((t) => t.key));
  const [scope, setScope] = useState<ScheduleScope>('week');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Theme-aware palette so the modal + its buttons read correctly in both
     light and dark mode (the app's `--panel-bg` token doesn't exist, so the
     surface is resolved explicitly here). */
  const isLight = useTheme().theme === 'light';
  const C = {
    panel: isLight ? '#ffffff' : '#12161d',
    border: isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)',
    text: isLight ? '#1a1f25' : '#f1f4f6',
    muted: isLight ? '#565c63' : '#8b95a1',
    activeBlueBg: 'rgba(96,165,250,0.18)',
    activeBlueBorder: 'rgba(96,165,250,0.55)',
    activeBlueText: isLight ? '#1f5fd1' : '#cfe0ff',
  };

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const download = async () => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const today = new Date();
      const { startDate, endDate } = scheduleFetchRange(today, scope);
      const drills = await api.getScheduledDrills(playerId, { startDate, endDate });
      const events = (Array.isArray(drills) ? drills : []).map((d) => ({
        date: d.date, tab: d.tab, category: d.category, name: d.name, time: d.time,
      }));
      const safeName = playerName.replace(/\s+/g, '_') || 'Player';
      const date = today.toISOString().slice(0, 10);
      await downloadPdf(
        <SchedulePdf playerName={playerName} events={events} selectedTabs={selected} scope={scope} today={today} />,
        `${safeName}_Schedule_${scope}_${date}.pdf`,
      );
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to generate the schedule PDF.');
      setBusy(false);
    }
  };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div style={{
        width: 'min(440px, 100%)', background: C.panel, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 14, padding: 20,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Download Schedule</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 22, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>{playerName}</div>

        {/* Type pickers */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>Calendars</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
          {TYPES.map((t) => {
            const on = selected.includes(t.key);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => toggle(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${on ? t.color : C.border}`,
                  background: on ? `${t.color}22` : 'transparent',
                  color: C.text, cursor: 'pointer', fontSize: 13, textAlign: 'left',
                }}
              >
                <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, background: on ? t.color : 'transparent', border: `2px solid ${t.color}` }} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Span */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>Span</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
          {SCOPES.map((sc) => {
            const on = scope === sc.key;
            return (
              <button
                key={sc.key}
                type="button"
                onClick={() => setScope(sc.key)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8,
                  border: `1px solid ${on ? C.activeBlueBorder : C.border}`,
                  background: on ? C.activeBlueBg : 'transparent',
                  color: on ? C.activeBlueText : C.muted, cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                {sc.label}
              </button>
            );
          })}
        </div>

        {error && <div style={{ color: isLight ? '#b42318' : '#fca5a5', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          <button
            onClick={download}
            disabled={busy || selected.length === 0}
            style={{
              padding: '9px 18px', borderRadius: 8, border: `1px solid ${C.activeBlueBorder}`,
              background: C.activeBlueBg, color: C.activeBlueText,
              cursor: busy || selected.length === 0 ? 'not-allowed' : 'pointer', opacity: busy || selected.length === 0 ? 0.6 : 1,
              fontSize: 13, fontWeight: 700,
            }}
          >
            {busy ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}
