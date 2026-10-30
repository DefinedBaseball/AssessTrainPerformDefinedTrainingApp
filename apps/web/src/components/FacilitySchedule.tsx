'use client';

/* Facility schedule picker -- the days of the week an athlete trains in the
 * building, a start time for each, and the dates the schedule runs. One card
 * per workout type (Hitting Program, Lesson, ...), each in its colour.
 *
 * Two ways in, both coach-only:
 *   - FacilityScheduleEditor sits in the Edit Profile form and saves with it;
 *   - FacilityScheduleButton is the clock on Upcoming Drills, which opens the
 *     same editor in a dialog that saves on its own.
 *
 * Data shape and colours: lib/facility-schedule.ts.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { rem } from '@/lib/rem';
import rs from '@/components/assessment/report-form.module.css';
import {
  type FacilitySlot, type WeekdayKey, WEEKDAYS, SCHEDULE_PROGRAMS,
  programColor, programLabel, parseFacilitySchedule, facilityScheduleProblem, defaultProgramFor,
} from '@/lib/facility-schedule';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newFacilitySlot(program: string): FacilitySlot {
  return { program, days: {}, startDate: todayIso(), endDate: '' };
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const QUARTERS = ['00', '15', '30', '45'];

/** Hour / minute / AM-PM drop-downs writing a 24h "HH:MM". Minutes come in
 *  15-minute steps; a stored time off those steps (from before this picker)
 *  keeps its own minute as an extra option rather than being moved. */
function TimeSelect({ value, onChange }: { value: string; onChange: (hhmm: string) => void }) {
  const [h24, m] = value.split(':');
  const hNum = Number(h24) || 0;
  const pm = hNum >= 12;
  const h12 = hNum % 12 || 12;
  const minutes = QUARTERS.includes(m) ? QUARTERS : [...QUARTERS, m].sort();
  const emit = (hour12: number, minute: string, isPm: boolean) => {
    const h = (hour12 % 12) + (isPm ? 12 : 0);
    onChange(`${String(h).padStart(2, '0')}:${minute}`);
  };
  /* Compact: three fixed 46px bubbles, so three days fit on one row of the
     pop-up. The arrow is shrunk and tucked in to leave room for ":45". */
  const sel: React.CSSProperties = {
    padding: '9px 15px 9px 7px', backgroundPosition: 'right 5px center', backgroundSize: 9,
    fontSize: rem(13), minWidth: 0, width: '100%',
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 46px)', gap: 6 }}>
      <select className={rs.summarySelect} style={sel} aria-label="Hour" value={h12}
        onChange={(e) => emit(Number(e.target.value), m, pm)}>
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <select className={rs.summarySelect} style={sel} aria-label="Minutes" value={m}
        onChange={(e) => emit(h12, e.target.value, pm)}>
        {minutes.map((mm) => <option key={mm} value={mm}>:{mm}</option>)}
      </select>
      <select className={rs.summarySelect} style={sel} aria-label="AM or PM" value={pm ? 'PM' : 'AM'}
        onChange={(e) => emit(h12, m, e.target.value === 'PM')}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

/** Colour key for the facility days -- every workout type, so it reads the
 *  same on every athlete. Sits beside the clock on Upcoming Workouts. */
export function FacilityLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
      {SCHEDULE_PROGRAMS.map((p) => (
        <span key={p.key} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: rem(11), fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap',
        }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: p.color }} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

export function FacilityScheduleEditor({
  value,
  onChange,
  defaultProgram,
}: {
  value: FacilitySlot[];
  onChange: (next: FacilitySlot[]) => void;
  /** Program a new card starts on -- the athlete's own program tag. */
  defaultProgram: string;
}) {
  const patch = (i: number, fields: Partial<FacilitySlot>) =>
    onChange(value.map((s, j) => (j === i ? { ...s, ...fields } : s)));

  const toggleDay = (i: number, day: WeekdayKey) => {
    const days = { ...value[i].days };
    if (days[day] !== undefined) {
      delete days[day];
    } else {
      /* A new day starts on the time already used most recently on this
         card, since program days usually share a start time. */
      const times = Object.values(days).filter(Boolean) as string[];
      days[day] = times[times.length - 1] || '16:00';
    }
    patch(i, { days });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {value.length === 0 && (
        <div style={{ fontSize: rem(13), color: 'var(--text-muted)' }}>
          No facility schedule yet.
        </div>
      )}
      {value.map((slot, i) => {
        const color = programColor(slot.program);
        const picked = WEEKDAYS.filter((d) => slot.days[d.key] !== undefined);
        return (
          <div
            key={i}
            style={{
              display: 'grid', gap: 12, padding: 12, borderRadius: 14,
              border: '1px solid var(--border)', borderLeft: `4px solid ${color}`,
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span aria-hidden style={{ width: 12, height: 12, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
              <select
                className={rs.summarySelect}
                value={slot.program}
                onChange={(e) => patch(i, { program: e.target.value })}
                aria-label="Program"
                style={{ flex: '1 1 180px', minWidth: 0 }}
              >
                {SCHEDULE_PROGRAMS.map((p) => (
                  <option key={p.key} value={p.key}>{programLabel(p.key)}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                style={{
                  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
                  borderRadius: 10, padding: '6px 10px', fontSize: rem(12), fontWeight: 600, cursor: 'pointer',
                }}
              >Remove</button>
            </div>

            <div className={rs.summaryField}>
              <label className={rs.summaryLabel}>Days of the Week</label>
              <div className={rs.posChipRow}>
                {WEEKDAYS.map((d) => {
                  const on = slot.days[d.key] !== undefined;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      className={rs.posChip}
                      aria-pressed={on}
                      onClick={() => toggleDay(i, d.key)}
                      style={on ? { background: color, borderColor: color, color: '#fff' } : undefined}
                    >{d.short}</button>
                  );
                })}
              </div>
            </div>

            {picked.length > 0 && (
              <div className={rs.summaryField}>
                <label className={rs.summaryLabel}>Start Time</label>
                <div className={rs.summaryGrid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {picked.map((d) => (
                    <div key={d.key} role="group" aria-label={`${d.label} start time`} style={{ display: 'grid', gap: 4 }}>
                      <span style={{ fontSize: rem(12), fontWeight: 700, color }}>{d.label}</span>
                      <TimeSelect
                        value={slot.days[d.key] || '16:00'}
                        onChange={(t) => patch(i, { days: { ...slot.days, [d.key]: t } })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={rs.summaryGrid} style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              <div className={rs.summaryField}>
                <label className={rs.summaryLabel}>Starts</label>
                <input
                  type="date"
                  className={rs.summaryInput}
                  value={slot.startDate || ''}
                  onChange={(e) => patch(i, { startDate: e.target.value || null })}
                />
              </div>
              <div className={rs.summaryField}>
                <label className={rs.summaryLabel}>End Date</label>
                <input
                  type="date"
                  className={rs.summaryInput}
                  value={slot.endDate}
                  min={slot.startDate || undefined}
                  onChange={(e) => patch(i, { endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div>
        <button
          type="button"
          className={rs.posChip}
          onClick={() => onChange([...value, newFacilitySlot(defaultProgram)])}
        >+ Add Schedule</button>
      </div>
    </div>
  );
}

/** The clock on Upcoming Drills: opens the editor in a dialog that saves on
 *  its own. Renders nothing for anyone but a coach. */
export function FacilityScheduleButton({
  playerId,
  playerName,
  raw,
  athleteTypes,
  onSaved,
}: {
  playerId: string;
  playerName: string;
  raw: string | null | undefined;
  athleteTypes: string | null | undefined;
  onSaved: (raw: string | null) => void;
}) {
  const { isCoach, isViewer } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FacilitySlot[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The dialog is portalled to <body>, which only exists client-side. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!isCoach || isViewer) return null;

  const defaultProgram = defaultProgramFor(athleteTypes);

  const start = () => {
    const current = parseFacilitySchedule(raw);
    setDraft(current.length ? current : [newFacilitySlot(defaultProgram)]);
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    const problem = facilityScheduleProblem(draft);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api.setFacilitySchedule(playerId, draft);
      onSaved(res.facilitySchedule.length ? JSON.stringify(res.facilitySchedule) : null);
      setOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Could not save the schedule.');
    } finally {
      setSaving(false);
    }
  };

  const title = `Set ${playerName}'s facility days and times`;

  return (
    <>
      <button
        type="button"
        onClick={start}
        title={title}
        aria-label={title}
        style={{
          border: '1px solid var(--border)', background: 'transparent', borderRadius: 8,
          padding: '3px 7px', fontSize: rem(14), lineHeight: 'normal', cursor: 'pointer',
        }}
      >🕒</button>
      {open && mounted && createPortal(
        <div
          style={{
            /* Same layer as the profile-reminder dialog: above the Edit
               Profile modal, below the fullscreen video player. */
            position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,0.6)',
            display: 'grid', placeItems: 'center', padding: 18,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !saving) setOpen(false); }}
        >
          <div style={{
            width: 'min(672px, 100%)', maxHeight: 'calc(100dvh - 36px)', overflowY: 'auto',
            borderRadius: 12, padding: 18,
            background: 'var(--panel-bg-light, #14181f)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: rem(15), fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
              Facility Schedule
            </div>
            <p style={{ fontSize: rem(12.5), lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 14px' }}>
              The days {playerName} trains in the facility and the start time for each.
            </p>
            <FacilityScheduleEditor value={draft} onChange={setDraft} defaultProgram={defaultProgram} />
            {error && (
              <div role="alert" style={{ marginTop: 12, fontSize: rem(12.5), color: '#ef4444', fontWeight: 600 }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: rem(12.5), fontWeight: 700,
                  cursor: 'pointer', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)',
                }}
              >Cancel</button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                style={{
                  padding: '7px 18px', borderRadius: 8, fontSize: rem(12.5), fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer', border: '1px solid var(--text)',
                  background: 'var(--text)', color: 'var(--bg, #0e1116)',
                }}
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
