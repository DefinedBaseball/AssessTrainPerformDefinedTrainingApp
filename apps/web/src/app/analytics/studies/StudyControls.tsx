'use client';

/* Studies: the settings controls — measure picker (searchable, grouped),
   summary, dates, which athletes, athlete picker. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudyAthlete, StudyMeasure, StudyValdFilters } from '@/lib/api';
import pageStyles from '../page.module.css';
import s from './studies.module.css';
import { SUMMARY_LABEL, type DateRange, type Summary } from './studyMath';
import { typeLabel, type Cohort } from './studyModel';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Searchable, grouped measure picker. `onPickGroup` lets a whole group be added at once. */
export function MeasurePicker({ measures, value, onPick, onPickGroup, placeholder = 'Pick a measure…', exclude }: {
  measures: StudyMeasure[];
  value?: string;
  onPick: (id: string) => void;
  onPickGroup?: (ids: string[]) => void;
  placeholder?: string;
  exclude?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);
  const current = measures.find((m) => m.id === value);
  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const skip = new Set(exclude ?? []);
    const m = new Map<string, StudyMeasure[]>();
    let shown = 0;
    for (const x of measures) {
      if (skip.has(x.id)) continue;
      const hay = `${x.label} ${x.group} ${x.unit}`.toLowerCase();
      if (words.some((w) => !hay.includes(w))) continue;
      if (shown >= 300) break;
      shown += 1;
      (m.get(x.group) ?? m.set(x.group, []).get(x.group)!).push(x);
    }
    return [...m.entries()];
  }, [measures, q, exclude]);
  return (
    <div className={s.picker} ref={ref}>
      <input
        className={pageStyles.input}
        value={open ? q : current ? `${current.label}${current.unit ? ` (${current.unit})` : ''}` : ''}
        placeholder={current ? `${current.group} · ${current.label}` : placeholder}
        onFocus={() => { setOpen(true); setQ(''); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        title={current ? `${current.group} · ${current.label}` : undefined}
      />
      {current && !open && <div className={s.savedMeta} style={{ marginTop: 3 }}>{current.group}</div>}
      {open && (
        <div className={s.pickerList}>
          {groups.length === 0 && <div className={s.pickerGroup}>Nothing matches</div>}
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className={s.pickerGroup} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{g}</span>
                {onPickGroup && list.length > 1 && (
                  <button type="button" className={s.linkBtn} style={{ fontSize: 10 }} onClick={() => { onPickGroup(list.map((x) => x.id)); setOpen(false); }}>
                    Add all {list.length}
                  </button>
                )}
              </div>
              {list.map((x) => (
                <button key={x.id} type="button" className={`${s.pickerItem} ${x.id === value ? s.pickerItemActive : ''}`}
                  onClick={() => { onPick(x.id); setOpen(false); setQ(''); }}>
                  {x.label}{x.unit && <span className={s.pickerUnit}>{x.unit}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SummarySelect({ value, onChange, label = 'Each athlete’s' }: { value: Summary; onChange: (v: Summary) => void; label?: string }) {
  return (
    <label className={s.field}>
      {label}
      <select className={pageStyles.select} value={value} onChange={(e) => onChange(e.target.value as Summary)}>
        {(Object.keys(SUMMARY_LABEL) as Summary[]).map((k) => <option key={k} value={k}>{SUMMARY_LABEL[k]}</option>)}
      </select>
    </label>
  );
}

/** A measure + how each athlete's values become one number. */
export function MeasureField({ label, measures, value, onChange }: {
  label: string;
  measures: StudyMeasure[];
  value?: { id: string; summary: Summary };
  onChange: (v: { id: string; summary: Summary }) => void;
}) {
  return (
    <div className={s.field}>
      {label}
      <MeasurePicker measures={measures} value={value?.id} onPick={(id) => onChange({ id, summary: value?.summary ?? 'best' })} />
      {value && (
        <select className={pageStyles.select} value={value.summary} onChange={(e) => onChange({ ...value, summary: e.target.value as Summary })} aria-label="Which value per athlete">
          {(Object.keys(SUMMARY_LABEL) as Summary[]).map((k) => <option key={k} value={k}>{SUMMARY_LABEL[k]} value per athlete</option>)}
        </select>
      )}
    </div>
  );
}

export function DatesField({ label, value, onChange, presets = true }: { label: string; value: DateRange; onChange: (v: DateRange) => void; presets?: boolean }) {
  const today = new Date();
  const ago = (days: number) => iso(new Date(today.getTime() - days * 86_400_000));
  return (
    <div className={s.field}>
      {label}
      <div className={s.fieldRow}>
        <input type="date" className={pageStyles.input} value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value || null })} aria-label={`${label} from`} />
        <input type="date" className={pageStyles.input} value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value || null })} aria-label={`${label} to`} />
      </div>
      {presets && (
        <div className={s.chips}>
          <button type="button" className={`${s.chip} ${!value.from && !value.to ? s.chipOn : ''}`} onClick={() => onChange({})}>All time</button>
          <button type="button" className={s.chip} onClick={() => onChange({ from: ago(90), to: iso(today) })}>Last 90 days</button>
          <button type="button" className={s.chip} onClick={() => onChange({ from: ago(365), to: iso(today) })}>Last 12 months</button>
        </div>
      )}
    </div>
  );
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Which athletes: grad years, positions, athlete types, and/or specific athletes (empty = all). */
export function CohortField({ athletes, value, onChange, vald }: { athletes: StudyAthlete[]; value: Cohort; onChange: (c: Cohort) => void; vald?: StudyValdFilters | null }) {
  const vGroups = value.valdGroups ?? [];
  const vTags = value.valdTags ?? [];
  const valdCats = useMemo(() => {
    const m = new Map<string, StudyValdFilters['groups']>();
    for (const g of vald?.groups ?? []) m.set(g.category || 'Groups', [...(m.get(g.category || 'Groups') ?? []), g]);
    return [...m.entries()];
  }, [vald]);
  const tagTypes = useMemo(() => {
    const m = new Map<string, StudyValdFilters['tags']>();
    for (const t of vald?.tags ?? []) m.set(t.type || 'Tag', [...(m.get(t.type || 'Tag') ?? []), t]);
    return [...m.entries()];
  }, [vald]);
  const years = useMemo(() => [...new Set(athletes.map((a) => a.gradYear).filter((y): y is number => y != null))].sort((a, b) => a - b), [athletes]);
  const positions = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of athletes) for (const p of a.positions) count.set(p, (count.get(p) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [athletes]);
  const types = useMemo(() => [...new Set(athletes.flatMap((a) => a.athleteTypes))].sort(), [athletes]);
  const any = value.gradYears.length + value.positions.length + value.types.length + value.playerIds.length + vGroups.length + vTags.length > 0;
  return (
    <div className={s.field}>
      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
        Which athletes
        {any && <button type="button" className={s.linkBtn} onClick={() => onChange({ gradYears: [], positions: [], types: [], playerIds: [], valdGroups: [], valdTags: [] })}>Everyone</button>}
      </span>
      {years.length > 0 && (
        <div className={s.chips} aria-label="Grad years">
          {years.map((y) => <button key={y} type="button" className={`${s.chip} ${value.gradYears.includes(y) ? s.chipOn : ''}`} onClick={() => onChange({ ...value, gradYears: toggle(value.gradYears, y) })}>{y}</button>)}
        </div>
      )}
      {positions.length > 0 && (
        <div className={s.chips} aria-label="Positions">
          {positions.map((p) => <button key={p} type="button" className={`${s.chip} ${value.positions.includes(p) ? s.chipOn : ''}`} onClick={() => onChange({ ...value, positions: toggle(value.positions, p) })}>{p}</button>)}
        </div>
      )}
      {types.length > 0 && (
        <div className={s.chips} aria-label="Athlete types">
          {types.map((t) => <button key={t} type="button" className={`${s.chip} ${value.types.includes(t) ? s.chipOn : ''}`} onClick={() => onChange({ ...value, types: toggle(value.types, t) })}>{typeLabel(t)}</button>)}
        </div>
      )}
      {vald === undefined ? null : vald === null ? (
        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Loading VALD groups and tags…</span>
      ) : vald.configured && (
        <>
          {valdCats.map(([cat, list]) => (
            <div key={cat} className={s.chips} aria-label={`VALD ${cat}`}>
              <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, alignSelf: 'center', marginRight: 2 }}>VALD {cat}:</span>
              {list.map((g) => (
                <button key={g.id} type="button" title={`${g.playerIds.length} athletes in the app`}
                  className={`${s.chip} ${vGroups.includes(g.id) ? s.chipOn : ''}`}
                  onClick={() => onChange({ ...value, valdGroups: toggle(vGroups, g.id) })}>{g.name}</button>
              ))}
            </div>
          ))}
          {tagTypes.map(([type, list]) => (
            <div key={type} className={s.chips} aria-label={`VALD tag ${type}`}>
              <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, alignSelf: 'center', marginRight: 2 }}>VALD {type}:</span>
              {list.map((t) => (
                <button key={t.id} type="button" title={`${t.playerIds.length} athletes tested with this tag`}
                  className={`${s.chip} ${vTags.includes(t.id) ? s.chipOn : ''}`}
                  onClick={() => onChange({ ...value, valdTags: toggle(vTags, t.id) })}>{t.name}</button>
              ))}
            </div>
          ))}
        </>
      )}
      <AthletesField athletes={athletes} value={value.playerIds} onChange={(playerIds) => onChange({ ...value, playerIds })} placeholder="Only these athletes (optional)…" />
      <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
        Nothing picked in a row = no limit. A VALD tag picks the athletes with a ForceDecks test carrying it; VALD athletes not matched to the app can&rsquo;t be included.
      </span>
    </div>
  );
}

/** Multi-select athletes with search. */
export function AthletesField({ athletes, value, onChange, placeholder = 'Add athletes…', max }: {
  athletes: StudyAthlete[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [open]);
  const byId = useMemo(() => new Map(athletes.map((a) => [a.id, a])), [athletes]);
  const list = athletes.filter((a) => !value.includes(a.id) && a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  const full = max != null && value.length >= max;
  return (
    <div className={s.picker} ref={ref}>
      {value.length > 0 && (
        <div className={s.pills} style={{ marginBottom: 6 }}>
          {value.map((id) => (
            <span key={id} className={s.pill}>
              {byId.get(id)?.name ?? 'Athlete'}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove">×</button>
            </span>
          ))}
        </div>
      )}
      {!full && (
        <input className={pageStyles.input} value={q} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      )}
      {open && !full && (
        <div className={s.pickerList}>
          {list.length === 0 && <div className={s.pickerGroup}>No athletes match</div>}
          {list.map((a) => (
            <button key={a.id} type="button" className={s.pickerItem} onClick={() => { onChange([...value, a.id]); setQ(''); }}>
              {a.name}{a.gradYear ? <span className={s.pickerUnit}>{a.gradYear}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
