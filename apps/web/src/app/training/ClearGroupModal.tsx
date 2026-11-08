'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Clear for a Group — take chosen workout types off several athletes at once
   ("the old hitting plan off everyone in the Hitting Program from Monday
   on"). Opened from the Clear menu.

   Workout types are required (never an accidental wipe of every type), the
   range is From → To (To blank = everything after), and athletes are picked
   the same way as Apply Calendar (programs / athlete types / names). The
   server dry-runs the exact count before the coach confirms, and the
   result is logged so the banner's Undo restores every drill.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { useFacilityPrograms } from '@/lib/use-facility-programs';
import { TAB_LABELS, TAB_COLORS } from '@/lib/training-colors';
import { AthleteGroupList, useAthleteGroups } from './AthleteGroupPicker';
import styles from './page.module.css';

const WORKOUT_ORDER = ['hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength'];

export function ClearGroupModal({
  open,
  onClose,
  players,
  defaultStart,
  onCleared,
}: {
  open: boolean;
  onClose: () => void;
  players: Player[];
  /** Today: where the range starts unless the coach changes it. */
  defaultStart: string;
  onCleared: (summary: string, logId: string) => void;
}) {
  const programs = useFacilityPrograms();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState('');
  const groups = useAthleteGroups({ players, fromDate: startDate || defaultStart, programs, includeLocked: true });
  const [tabs, setTabs] = useState<Set<string>>(new Set());
  const [impact, setImpact] = useState<{ key: string; drills: number; players: number; byTab: Record<string, number> } | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /* Fresh every time: a stale selection is exactly how the wrong group gets wiped. */
  useEffect(() => {
    if (!open) return;
    groups.reset();
    setTabs(new Set());
    setStartDate(defaultStart);
    setEndDate('');
    setArmed(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(startDate) && (!endDate || endDate >= startDate);
  const body = open && datesOk && tabs.size > 0 && groups.targetIds.length > 0
    ? { playerIds: groups.targetIds, tabs: [...tabs], startDate, ...(endDate ? { endDate } : {}) }
    : null;
  const key = body ? JSON.stringify(body) : '';

  /* Exact count from the server whenever the choices change. */
  useEffect(() => {
    setArmed(false);
    if (!body) { setImpact(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.clearScheduleGroup({ ...body, dryRun: true })
        .then(r => { if (!cancelled) setImpact({ key, drills: r.drills, players: r.players, byTab: r.byTab }); })
        .catch(() => { if (!cancelled) setImpact(null); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures every input
  }, [key]);
  const impactNow = impact && impact.key === key ? impact : null;

  if (!open || typeof document === 'undefined') return null;

  const toggleTab = (t: string) => setTabs(prev => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const run = async () => {
    if (!body) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.clearScheduleGroup(body);
      if (res.summary && res.logId) onCleared(res.summary, res.logId);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to clear');
      setArmed(false);
    } finally {
      setBusy(false);
    }
  };

  const hint = tabs.size === 0 ? 'Tick at least one workout type.'
    : !datesOk ? 'Check the dates — the end can’t be before the start.'
      : groups.targetIds.length === 0 ? 'Pick a program, athlete type or athletes below.'
        : !impactNow ? 'Counting…'
          : impactNow.drills === 0 ? 'Nothing of those types is scheduled for them in that range.'
            : null;

  return createPortal(
    <div
      className={styles.applyPopOverlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className={`${styles.applyPop} ${styles.clearGroupPop}`} role="dialog" aria-label="Clear workouts for a group">
        <div className={styles.applyHead} style={{ padding: 0, marginBottom: 6 }}>
          <span className={styles.applyPopTitle} style={{ margin: 0 }}>Clear for a Group</span>
          <button type="button" className={styles.applyClose} onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>
        <p className={styles.applyPopSub}>
          Removes the ticked workout types from every selected athlete in the date range. Other workout
          types stay. Undo is offered right after.
        </p>

        <div className={styles.applyGroupLabel} style={{ paddingLeft: 0 }}>Workout Types</div>
        <div className={styles.clearGroupTypes}>
          {WORKOUT_ORDER.map(t => (
            <label key={t} className={styles.applyPopItem}>
              <input type="checkbox" className={styles.applyCheckbox} checked={tabs.has(t)} onChange={() => toggleTab(t)} disabled={busy} />
              <span className={styles.applyPopDot} style={{ background: (TAB_COLORS[t] || TAB_COLORS.hitting).text }} />
              <span className={styles.applyItemName}>{TAB_LABELS[t] || t}</span>
            </label>
          ))}
        </div>

        <div className={styles.applyGroupLabel} style={{ paddingLeft: 0 }}>Dates</div>
        <div className={styles.clearGroupDates}>
          <label>
            <span>From</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} />
          </label>
          <label>
            <span>To <em>(blank = no end)</em></span>
            <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} disabled={busy} />
          </label>
        </div>

        <div className={styles.clearGroupList}>
          <AthleteGroupList groups={groups} programs={programs} includeLocked />
        </div>

        <div className={styles.applyImpact} aria-live="polite">
          {hint ?? (
            <>
              Removes <strong className={styles.applyImpactRemove}>{impactNow!.drills}</strong> drill{impactNow!.drills === 1 ? '' : 's'} from{' '}
              <strong>{impactNow!.players}</strong> athlete{impactNow!.players === 1 ? '' : 's'}
              {' '}({Object.entries(impactNow!.byTab).map(([t, n]) => `${TAB_LABELS[t] || t} ${n}`).join(' · ')}).
            </>
          )}
        </div>

        {error && <div className={styles.applyError}>{error}</div>}
        <div className={styles.applyPopActions}>
          <button type="button" className={styles.applyCancel} onClick={armed ? () => setArmed(false) : onClose} disabled={busy}>
            {armed ? 'Back' : 'Cancel'}
          </button>
          <button
            type="button"
            className={styles.clearGo}
            disabled={busy || !impactNow || impactNow.drills === 0}
            onClick={armed ? run : () => setArmed(true)}
          >
            {busy ? 'Clearing…'
              : armed ? `Confirm — remove ${impactNow?.drills ?? 0}`
                : `Remove ${impactNow?.drills ?? 0} drill${impactNow?.drills === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
