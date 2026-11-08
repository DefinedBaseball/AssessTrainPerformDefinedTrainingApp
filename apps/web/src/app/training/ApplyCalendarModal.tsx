'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Apply Calendar — push one athlete's schedule onto a group.

   Scope: Apply Day / Week / Month / Entire Calendar, defaulting to the
   calendar view it was opened from (Day view → that day). Entire Calendar is
   everything from today on.

   Sits beside the Athlete selector. Offers the scheduled programs (athletes
   with days in a Settings → Programs program on their facility schedule),
   the athlete-type tags (Winter / Summer / Fall Program,
   Membership, Lesson, Remote) and every athlete individually; all are
   multi-select and they union together, so a coach can tick "Hitting
   Program" and then add a couple of one-offs.

   This writes to other people's calendars and REPLACES what is there on the
   copied dates, so it never fires straight off the Apply button — Apply
   opens a pop-up that asks which workout types (Hitting, Pitching, ...) to
   copy and names how many athletes it will touch. Ticking only some types
   copies just those and replaces just those on the targets; their other
   workouts on those dates are left alone.

   Every selected athlete who shares a program with the source (however
   they were picked) gets each workout on THEIR matching program day rather
   than the same date: the source's Week N / Day k (k-th of their picked
   weekdays, Mon–Sun) lands on the target's Day k. Jack's Monday Day 1 goes
   on a Tue/Thu hitter's Tuesday. Each workout type follows its own program
   (Hitting drills by Hitting days, S&C by Lifting days). The server does
   the matching (training.service applyCalendarToPlayers).

   "Replace from <start> on" (in the pop-up): also takes the applied workout
   types off every selected athlete from the start of the copied range
   onward, not just on the days they receive -- so a new 4-week plan fully
   replaces an old 8-week one. The pop-up shows a dry-run count of what is
   added and removed before anything is written, and one Undo reverses it.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { parseFacilitySchedule, programDaysOf } from '@/lib/facility-schedule';
import { useFacilityPrograms } from '@/lib/use-facility-programs';
import { TAB_LABELS, TAB_COLORS } from '@/lib/training-colors';
import { AthleteGroupList, useAthleteGroups } from './AthleteGroupPicker';
import styles from './page.module.css';

/** Workout types in calendar order, for the pop-up's checkboxes. */
const WORKOUT_ORDER = ['hitting', 'pitching', 'catching', 'infield', 'outfield', 'strength'];

/** "2026-04-01" → "Apr 1, 2026" — parsed as LOCAL midnight, never UTC. */
function formatFromDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export type ApplyScope = 'day' | 'week' | 'month' | 'all';
const SCOPES: { key: ApplyScope; label: string }[] = [
  { key: 'day', label: 'Apply Day' },
  { key: 'week', label: 'Apply Week' },
  { key: 'month', label: 'Apply Month' },
  { key: 'all', label: 'Apply Entire Calendar' },
];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dateOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The source dates a scope covers (Mon–Sun weeks, like the server). */
function scopeRange(scope: ApplyScope, anchor: string, fromDate: string): { from: string; to: string | null } {
  if (scope === 'day') return { from: anchor, to: anchor };
  if (scope === 'week') {
    const mon = dateOf(anchor);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: isoOf(mon), to: isoOf(sun) };
  }
  if (scope === 'month') {
    const a = dateOf(anchor);
    return { from: isoOf(new Date(a.getFullYear(), a.getMonth(), 1)), to: isoOf(new Date(a.getFullYear(), a.getMonth() + 1, 0)) };
  }
  return { from: fromDate, to: null };
}

/** "Mon, Nov 2" / "the week of Nov 2 – 8" / "November 2026" / "Nov 1 on". */
function scopePhrase(scope: ApplyScope, anchor: string, fromDate: string): string {
  const r = scopeRange(scope, anchor, fromDate);
  const short = (iso: string) => dateOf(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (scope === 'day') return dateOf(anchor).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (scope === 'week') return `the week of ${short(r.from)} – ${short(r.to!)}`;
  if (scope === 'month') return dateOf(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return `${formatFromDate(fromDate)} forward`;
}

export function ApplyCalendarModal({
  open,
  onClose,
  players,
  sourcePlayer,
  fromDate,
  anchorDate,
  view,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  players: Player[];
  sourcePlayer: Player | null | undefined;
  /** Today: where Entire Calendar starts. */
  fromDate: string;
  /** The date the calendar is showing -- the day / week / month to apply. */
  anchorDate: string;
  /** The calendar view; picks the default scope. */
  view: 'day' | 'week' | 'month';
  /** Summary line plus the id that can roll this apply back. */
  onApplied: (summary: string, logId: string) => void;
}) {
  const programs = useFacilityPrograms();
  const [scope, setScope] = useState<ApplyScope>(view);
  const groups = useAthleteGroups({ players, excludeId: sourcePlayer?.id, fromDate, programs });
  /* The "which workouts?" pop-up, and what is ticked in it. */
  const [confirming, setConfirming] = useState(false);
  const [pickedTabs, setPickedTabs] = useState<Set<string>>(new Set());
  const [replaceForward, setReplaceForward] = useState(false);
  /* Dry-run of the apply as currently set up in the pop-up. */
  const [impact, setImpact] = useState<{ key: string; added: number; removed: number; losing: number } | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  /* What the copy will actually carry. Fetched when the panel opens so the
     coach sees "3 days · 12 drills" BEFORE committing — the alternative was
     finding out via a server error after pressing Apply. */
  const [sourceRows, setSourceRows] = useState<api.ScheduledDrill[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /* The pop-up is portalled to <body>, outside wrapRef -- clicks in it must
     not count as "clicked away" and close the panel. */
  const popRef = useRef<HTMLDivElement>(null);

  /* Reset every time it opens: a stale selection from last time is exactly
     the kind of thing that quietly overwrites the wrong group. */
  useEffect(() => {
    if (!open) return;
    groups.reset();
    setConfirming(false);
    setReplaceForward(false);
    setError('');
    setScope(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open]);

  useEffect(() => {
    if (!open || !sourcePlayer) { setSourceRows(null); return; }
    let cancelled = false;
    setSourceRows(null);
    api.getScheduledDrills(sourcePlayer.id)
      .then(rows => { if (!cancelled) setSourceRows(rows); })
      .catch(() => { if (!cancelled) setSourceRows([]); });
    return () => { cancelled = true; };
  }, [open, sourcePlayer]);

  /* What the copy will carry for the chosen scope -- shown BEFORE committing
     ("3 days · 12 drills") rather than found out via a server error. */
  const preview = useMemo(() => {
    if (!sourceRows) return null;
    const r = scopeRange(scope, anchorDate, fromDate);
    const inRange = sourceRows.filter(x => x.date >= r.from && (r.to === null || x.date <= r.to));
    const byTab: Record<string, number> = {};
    for (const x of inRange) byTab[x.tab] = (byTab[x.tab] || 0) + 1;
    return { days: new Set(inRange.map(x => x.date)).size, drills: inRange.length, byTab };
  }, [sourceRows, scope, anchorDate, fromDate]);

  /* Programs the source has days in -- the only ones with a Day 1 to copy. */
  const sourceSchedule = useMemo(() => parseFacilitySchedule(sourcePlayer?.facilitySchedule), [sourcePlayer]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (wrapRef.current && !wrapRef.current.contains(t)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  const targetIds = groups.targetIds;
  const checkedSched = groups.checkedSched;

  /* Types the source actually has from the start date, in calendar order
     (anything unexpected goes last). */
  const sourceTabs = Object.keys(preview?.byTab ?? {}).sort((a, b) => {
    const ai = WORKOUT_ORDER.indexOf(a); const bi = WORKOUT_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const pickedDrills = sourceTabs.filter(t => pickedTabs.has(t)).reduce((n, t) => n + (preview?.byTab[t] ?? 0), 0);
  const chosenTabs = sourceTabs.filter(t => pickedTabs.has(t));

  /* The request both the dry run and the real apply send. Every type ticked
     = the original whole-day replace (no filter), so a full apply still
     clears a target's other workouts on those dates. */
  const applyBody = (): Parameters<typeof api.applyCalendarToPlayers>[0] | null => {
    if (!sourcePlayer || targetIds.length === 0 || chosenTabs.length === 0) return null;
    return {
      sourcePlayerId: sourcePlayer.id,
      targetPlayerIds: targetIds,
      fromDate,
      scope,
      anchorDate,
      programs: [...checkedSched],
      ...(chosenTabs.length < sourceTabs.length ? { tabs: chosenTabs } : {}),
      ...(replaceForward ? { replaceForward: true } : {}),
    };
  };
  const impactKey = confirming ? JSON.stringify(applyBody()) : '';

  /* Ask the server what this would add and remove -- exact, including
     program-day matching -- whenever the pop-up's choices change. */
  useEffect(() => {
    if (!confirming) { setImpact(null); return; }
    const body = applyBody();
    if (!body) { setImpact(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.previewApplyCalendar(body)
        .then(r => { if (!cancelled) setImpact({ key: impactKey, added: r.drillsWritten, removed: r.drillsRemoved, losing: r.playersLosingDrills }); })
        .catch(() => { if (!cancelled) setImpact(null); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- impactKey captures every input
  }, [impactKey]);
  const impactNow = impact && impact.key === impactKey ? impact : null;
  const wipeFromLabel = formatFromDate(scopeRange(scope, anchorDate, fromDate).from);
  const chosenWords = chosenTabs.map(t => TAB_LABELS[t] || t).join(' / ');

  if (!open) return null;

  const openPicker = () => {
    setPickedTabs(new Set(sourceTabs));
    setError('');
    setConfirming(true);
  };

  const handleApply = async () => {
    const body = applyBody();
    if (!body) return;
    setApplying(true);
    setError('');
    try {
      const res = await api.applyCalendarToPlayers(body);
      /* The server composes the summary now, so the banner and the log row
         can never disagree about what happened. */
      onApplied(res.summary, res.logId);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to apply the calendar');
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={styles.applyWrap} ref={wrapRef}>
      <div className={styles.applyPanel}>
        <div className={styles.applyHead}>
          <span className={styles.applyTitle}>Apply Calendar</span>
          <button type="button" className={styles.applyClose} onClick={onClose} aria-label="Close">×</button>
        </div>
        {/* What to copy: this day, its week, its month, or everything ahead. */}
        <div className={styles.applyScopeRow}>
          <select
            className={styles.applyScope}
            value={scope}
            onChange={(e) => { setScope(e.target.value as ApplyScope); setConfirming(false); }}
            aria-label="What to apply"
          >
            {SCOPES.map(sc => <option key={sc.key} value={sc.key}>{sc.label}</option>)}
          </select>
        </div>
        <div className={styles.applySub}>
          Copies {sourcePlayer ? `${sourcePlayer.firstName} ${sourcePlayer.lastName}’s` : 'this athlete’s'} schedule
          for <strong>{scopePhrase(scope, anchorDate, fromDate)}</strong>. Selected athletes have their
          drills replaced on the days they receive.
          {preview && (
            <span className={preview.days === 0 ? styles.applyNothing : styles.applyPreview}>
              {preview.days === 0
                ? ' Nothing is scheduled there — pick another scope or date.'
                : ` ${preview.days} day${preview.days === 1 ? '' : 's'} · ${preview.drills} drill${preview.drills === 1 ? '' : 's'}.`}
            </span>
          )}
        </div>

        {/* Action row sits ABOVE the list, not below it. Below, it was the
            last thing in a 330px panel anchored to a trigger near the right
            edge of the page — the Apply button rendered off-screen and the
            control looked like it simply did not exist. Top also means it
            never scrolls away as the athlete list grows. */}
        {error && <div className={styles.applyError}>{error}</div>}

        <div className={styles.applyActions}>
          <span className={styles.applyCount}>
            {targetIds.length} selected
          </span>
          <button
            type="button"
            className={styles.applyGo}
            disabled={targetIds.length === 0 || !sourcePlayer || !preview || preview.days === 0}
            title={preview?.days === 0 ? 'Nothing scheduled in this scope' : undefined}
            onClick={openPicker}
          >
            Apply
          </button>
        </div>

        <div className={styles.applyBody}>
          {/* The source needs days in a program for it to have a Day 1 /
              Day 2 to match, so programs it isn't in are greyed out. */}
          <AthleteGroupList
            groups={groups}
            programs={programs}
            excludeId={sourcePlayer?.id}
            onChange={() => setConfirming(false)}
            programUsable={(key) => {
              const srcDays = programDaysOf(sourceSchedule, key);
              const label = programs.find(p => p.key === key)?.label ?? 'program';
              return srcDays.length > 0
                ? { usable: true, title: `Matched by program day: ${srcDays.map((d, i) => `${d[0].toUpperCase()}${d.slice(1)} = Day ${i + 1}`).join(', ')}` }
                : { usable: false, title: `${sourcePlayer?.firstName ?? 'This athlete'} has no ${label} days to copy from` };
            }}
          />
        </div>

      </div>

      {/* ── Which workouts? ── the last step before anything is written. */}
      {confirming && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.applyPopOverlay}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !applying) setConfirming(false); }}
        >
          <div className={styles.applyPop} ref={popRef} role="dialog" aria-label="Choose workouts to apply">
            <div className={styles.applyPopTitle}>Apply which workouts?</div>
            <p className={styles.applyPopSub}>
              Copying {sourcePlayer ? `${sourcePlayer.firstName}’s` : 'this'} schedule for{' '}
              {scopePhrase(scope, anchorDate, fromDate)} to{' '}
              <strong>{targetIds.length} athlete{targetIds.length === 1 ? '' : 's'}</strong>. The ticked workouts
              are replaced on the days they receive; anything left unticked stays as it is on their calendars.
            </p>
            <p className={styles.applyPopSub}>
              Athletes who share a program with {sourcePlayer?.firstName ?? 'the source'} get each workout on their own
              matching program day: {sourcePlayer?.firstName ?? 'the source'}&rsquo;s Day 1 lands on their Day 1, Day 2 on
              their Day 2, in the same week. Everyone else gets the same dates.
            </p>
            <div className={styles.applyPopList}>
              {sourceTabs.map(tab => (
                <label key={tab} className={styles.applyPopItem}>
                  <input
                    type="checkbox"
                    className={styles.applyCheckbox}
                    checked={pickedTabs.has(tab)}
                    disabled={applying}
                    onChange={() => setPickedTabs(prev => { const n = new Set(prev); if (n.has(tab)) n.delete(tab); else n.add(tab); return n; })}
                  />
                  <span className={styles.applyPopDot} style={{ background: (TAB_COLORS[tab] || TAB_COLORS.hitting).text }} />
                  <span className={styles.applyItemName}>{TAB_LABELS[tab] || tab}</span>
                  <span className={styles.applyItemCount}>
                    {preview?.byTab[tab] ?? 0} drill{(preview?.byTab[tab] ?? 0) === 1 ? '' : 's'}
                  </span>
                </label>
              ))}
            </div>

            {/* Replace forward: the old plan comes off from the start date on,
                even on days the new plan doesn't touch. */}
            <label className={`${styles.applyPopItem} ${styles.replaceForward}`}>
              <input
                type="checkbox"
                className={styles.applyCheckbox}
                checked={replaceForward}
                disabled={applying}
                onChange={() => setReplaceForward(v => !v)}
              />
              <span className={styles.replaceForwardText}>
                <strong>Replace from {wipeFromLabel} on</strong>
                <span>
                  Also remove their existing {chosenWords || 'ticked'} workouts from {wipeFromLabel} forward,
                  even on days this plan doesn&rsquo;t cover. Their other workout types are left alone.
                </span>
              </span>
            </label>

            <div className={styles.applyImpact} aria-live="polite">
              {chosenTabs.length === 0 ? 'Tick at least one workout type.'
                : !impactNow ? 'Working out the changes…'
                  : <>
                      Adds <strong>{impactNow.added}</strong> drill{impactNow.added === 1 ? '' : 's'}
                      {' · '}removes <strong className={impactNow.removed ? styles.applyImpactRemove : undefined}>{impactNow.removed}</strong> existing
                      {impactNow.removed > 0 && <> from {impactNow.losing} athlete{impactNow.losing === 1 ? '' : 's'}</>}.
                      {' '}Undo is offered right after.
                    </>}
            </div>

            {error && <div className={styles.applyError}>{error}</div>}
            <div className={styles.applyPopActions}>
              <button type="button" className={styles.applyCancel} onClick={() => setConfirming(false)} disabled={applying}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.applyGo}
                onClick={handleApply}
                disabled={applying || pickedDrills === 0}
              >
                {applying ? 'Applying…' : `Apply ${pickedDrills} drill${pickedDrills === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
