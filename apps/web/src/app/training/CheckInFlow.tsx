'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Check-In — the athlete's bookend around a training day.

   Three states, driven entirely by what the server reports for TODAY:

     shouldPrompt          → the check-in modal (focus question)
     checkedIn && !finished → the Finish bar under the calendar
     finishing             → the reflection modal (two questions)

   "Today" is the athlete's LOCAL calendar day, matching how ScheduledDrill
   stores dates. It is deliberately not the date the calendar is scrolled to:
   checking in is an act about the session you are doing now, so scrolling
   back to last Tuesday must not offer to check you in for it.

   Eligibility comes from the schedule — no drills scheduled, no prompt — so
   this component renders nothing at all for an athlete with an empty day.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useState } from 'react';
import * as api from '@/lib/api';
import styles from './CheckInFlow.module.css';

/** Local YYYY-MM-DD. Never UTC — see the note above. */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function CheckInFlow({ playerId, viewDate, onChanged }: {
  playerId: string;
  /**
   * The day the calendar is currently showing, "YYYY-MM-DD".
   *
   * Check-in is always about TODAY, but the bars render inside the calendar,
   * so they have to know what is on screen: without this, today's "Session
   * complete" receipt sat under every date the athlete scrolled to and made
   * the whole week look finished.
   */
  viewDate: string;
  /** Fired after a check-in or finish lands, so the page can refresh. */
  onChanged?: () => void;
}) {
  const date = todayStr();
  /* Bars annotate the day on screen; the prompt is a modal about today and
     is deliberately NOT gated on this. */
  const viewingToday = viewDate === date;

  const [status, setStatus] = useState<api.CheckInStatus | null>(null);
  /* Deferred for THIS visit only — deliberately not persisted. Leaving the
     Training tab and coming back remounts this component, which is what puts
     the prompt back in front of the athlete. Nothing below renders until the
     status fetch lands, so starting false cannot flash the modal. */
  const [dismissed, setDismissed] = useState(false);
  const [focus, setFocus] = useState('');
  const [executedGoal, setExecutedGoal] = useState('');
  const [learned, setLearned] = useState('');
  const [finishing, setFinishing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!playerId) return;
    api.getCheckInStatus(playerId, date)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [playerId, date]);

  useEffect(() => { load(); }, [load]);

  if (!status || !status.scheduled) return null;

  const showPrompt = status.shouldPrompt && !dismissed;
  const showFinishBar = viewingToday && status.checkedIn && !status.finished;

  const submitCheckIn = async () => {
    if (!focus.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.checkIn({ playerId, date, focus });
      setFocus('');
      load();
      onChanged?.();
    } catch (e) {
      setError((e as Error)?.message || 'Could not check in');
    } finally {
      setBusy(false);
    }
  };

  const submitFinish = async () => {
    setBusy(true);
    setError('');
    try {
      await api.finishCheckIn({ playerId, date, executedGoal, learned });
      setFinishing(false);
      setExecutedGoal('');
      setLearned('');
      load();
      onChanged?.();
    } catch (e) {
      setError((e as Error)?.message || 'Could not finish the session');
    } finally {
      setBusy(false);
    }
  };

  /* Close the prompt and let the athlete get to their calendar. They will
     be asked again next time they open the tab, and every time after that,
     until they check in or the day ends. */
  const later = () => setDismissed(true);

  return (
    <>
      {/* ── Check-In prompt ──
          No overlay click-to-close: the two ways out are Check In and
          Check-In Later, so the choice is always explicit. */}
      {showPrompt && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.head}>
              <span className={styles.title}>Check In</span>
              <button type="button" className={styles.laterBtn} onClick={later}>
                Check-In Later
              </button>
            </div>
            <div className={styles.body}>
              <div className={styles.sub}>
                {status.drillCount} drill{status.drillCount === 1 ? '' : 's'} scheduled today.
              </div>
              <label className={styles.question} htmlFor="checkin-focus">
                What is one area of focus for today&rsquo;s session?
              </label>
              <textarea
                id="checkin-focus"
                className={styles.input}
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="e.g. staying through the ball on outside pitches"
                rows={3}
                autoFocus
              />
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <div className={styles.foot}>
              <button
                type="button"
                className={styles.primary}
                onClick={submitCheckIn}
                disabled={busy || !focus.trim()}
              >
                {busy ? 'Checking In…' : 'Check In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Finish bar ── only once checked in, and only until finished. */}
      {showFinishBar && !finishing && (
        <div className={styles.finishBar}>
          <div className={styles.finishText}>
            <span className={styles.finishLabel}>Checked in</span>
            {status.checkIn?.focus && (
              <span className={styles.finishFocus}>{status.checkIn.focus}</span>
            )}
          </div>
          <button type="button" className={styles.primary} onClick={() => setFinishing(true)}>
            Finish
          </button>
        </div>
      )}

      {/* ── Reflection ── */}
      {finishing && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.head}>
              <span className={styles.title}>Reflection</span>
              <button
                type="button"
                className={styles.laterBtn}
                onClick={() => setFinishing(false)}
              >
                Back
              </button>
            </div>
            <div className={styles.body}>
              {status.checkIn?.focus && (
                <div className={styles.recall}>
                  <span className={styles.recallLabel}>Today&rsquo;s focus</span>
                  <span className={styles.recallText}>{status.checkIn.focus}</span>
                </div>
              )}
              <label className={styles.question} htmlFor="checkin-executed">
                Did you execute your goal?
              </label>
              <textarea
                id="checkin-executed"
                className={styles.input}
                value={executedGoal}
                onChange={(e) => setExecutedGoal(e.target.value)}
                rows={3}
                autoFocus
              />
              <label className={styles.question} htmlFor="checkin-learned">
                What did you learn?
              </label>
              <textarea
                id="checkin-learned"
                className={styles.input}
                value={learned}
                onChange={(e) => setLearned(e.target.value)}
                rows={3}
              />
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <div className={styles.foot}>
              <button
                type="button"
                className={styles.primary}
                onClick={submitFinish}
                disabled={busy}
              >
                {busy ? 'Finishing…' : 'Finish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Done ── a quiet receipt, so the day reads as closed out.
          Today only: this describes today's session, and showing it while
          the athlete is looking at Thursday would claim Thursday is done. */}
      {viewingToday && status.finished && (
        <div className={`${styles.finishBar} ${styles.finishBarDone}`}>
          <span className={styles.finishLabel}>Session complete ✓</span>
        </div>
      )}
    </>
  );
}
