'use client';

/* DobPicker — a custom date-of-birth picker that replaces the native
   <input type="date">. The native picker's year list scrolls slowly and its
   speed isn't controllable; this one uses three scroll columns (Month / Day /
   Year) whose wheel scroll runs at 2× speed. Emits a YYYY-MM-DD string, so
   it's a drop-in for the old input (same value/onChange contract). */

import { useEffect, useMemo, useRef, useState } from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate(); // month1 is 1-12
}
function pad(n: number): string { return String(n).padStart(2, '0'); }

interface Props {
  value: string;                       // YYYY-MM-DD or ''
  onChange: (v: string) => void;
  placeholder?: string;
}

/** A scrollable, selectable column. Wheel scroll is doubled (and the page is
 *  kept from scrolling) via a native non-passive listener. */
function Column({ items, selected, onPick, width }: {
  items: { label: string; value: number }[];
  selected: number | null;
  onPick: (v: number) => void;
  width: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); el.scrollTop += e.deltaY * 2; };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Scroll the selected row into view when it changes / on mount.
  useEffect(() => {
    const el = ref.current;
    if (!el || selected == null) return;
    const node = el.querySelector('[data-selected="true"]') as HTMLElement | null;
    if (node) el.scrollTop = node.offsetTop - el.clientHeight / 2 + node.clientHeight / 2;
  }, [selected]);

  return (
    <div
      ref={ref}
      style={{ width, maxHeight: 168, overflowY: 'auto', scrollbarWidth: 'thin' }}
    >
      {items.map((it) => {
        const on = it.value === selected;
        return (
          <button
            key={it.value}
            type="button"
            data-selected={on}
            onClick={() => onPick(it.value)}
            style={{
              display: 'block', width: '100%', textAlign: 'center', padding: '6px 4px',
              border: 'none', cursor: 'pointer', fontSize: 13, borderRadius: 6,
              background: on ? 'rgba(61,139,253,0.20)' : 'transparent',
              color: on ? 'var(--text-bright)' : 'var(--text)',
              fontWeight: on ? 700 : 400,
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

type Sel = { y: number | null; mo: number | null; d: number | null };
function parseValue(value: string): Sel {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : { y: null, mo: null, d: null };
}

export function DobPicker({ value, onChange, placeholder = 'Select birthday' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* Local selection so partial picks (e.g. month chosen, day not yet) are
     retained — `onChange` only fires once all three are set. Re-synced if the
     value is changed from outside. */
  const [sel, setSel] = useState<Sel>(() => parseValue(value));
  useEffect(() => { setSel(parseValue(value)); }, [value]);

  const curYear = new Date().getFullYear();
  const years = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    for (let y = curYear; y >= curYear - 80; y--) out.push({ label: String(y), value: y });
    return out;
  }, [curYear]);
  const months = MONTHS.map((label, i) => ({ label, value: i + 1 }));
  const dayCount = sel.y && sel.mo ? daysInMonth(sel.y, sel.mo) : 31;
  const days = Array.from({ length: dayCount }, (_, i) => ({ label: String(i + 1), value: i + 1 }));

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (patch: Partial<Sel>) => {
    // Runs from an onClick (event handler) — safe to call the parent's
    // onChange here. (Calling it inside a setState updater would fire a
    // parent setState during render — the React warning we hit before.)
    const next: Sel = { ...sel, ...patch };
    if (next.y && next.mo && next.d) {
      const max = daysInMonth(next.y, next.mo);
      if (next.d > max) next.d = max;       // clamp e.g. Feb 31 → Feb 28/29
      onChange(`${next.y}-${pad(next.mo)}-${pad(next.d)}`);
    }
    setSel(next);
  };

  const display = sel.y && sel.mo && sel.d
    ? `${MONTHS[sel.mo - 1]} ${sel.d}, ${sel.y}`
    : '';

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', padding: '9px 11px', borderRadius: 10,
          border: '1px solid var(--border-light)', background: 'var(--surface-bright)',
          color: display ? 'var(--text)' : 'var(--text-muted)',
          fontFamily: 'inherit', fontSize: 14, textAlign: 'left', cursor: 'pointer',
        }}
      >
        {display || placeholder}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 6px)', left: 0,
            background: 'var(--surface-bright)', border: '1px solid var(--border-light)',
            borderRadius: 10, padding: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            display: 'flex', gap: 4, minWidth: 240,
          }}
        >
          <Column items={months} selected={sel.mo} width={70}
            onPick={(mo) => pick({ mo })} />
          <Column items={days} selected={sel.d} width={54}
            onPick={(d) => pick({ d })} />
          <Column items={years} selected={sel.y} width={72}
            onPick={(y) => pick({ y })} />
        </div>
      )}
    </div>
  );
}
