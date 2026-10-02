'use client';

/* 20–80 grade entry as a typed number instead of a drag bar.

   The report forms' grade sliders (DefenseGradeSlider, DefenseOverallSlider,
   CoachGradeItem) read GradeInputModeContext: the report modal leaves it at
   'slider', and the in-tab report editor sets 'number' so the same forms
   take typed grades -- the coach-requested behaviour for Infield, Outfield
   and Catching. One switch at the editor rather than a prop threaded
   through every form. */

import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { rem } from '@/lib/rem';
import { scoreColor } from '../helpers';

export type GradeInputMode = 'slider' | 'number';
export const GradeInputModeContext = createContext<GradeInputMode>('slider');
export const useGradeInputMode = (): GradeInputMode => useContext(GradeInputModeContext);

export const GRADE_MIN = 20;
export const GRADE_MAX = 80;

/** Clamp a typed grade into 20–80 and round to a whole number. Blank stays
 *  blank (ungraded). Non-numbers are treated as blank. */
export function normalizeGrade(raw: string): string {
  const t = raw.trim();
  if (t === '') return '';
  const n = Number(t);
  if (!Number.isFinite(n)) return '';
  return String(Math.min(GRADE_MAX, Math.max(GRADE_MIN, Math.round(n))));
}

/**
 * A 20–80 grade box. Holds the raw text while the coach types (so "6" on
 * the way to "65" isn't clamped to 20 mid-keystroke) and commits the
 * clamped value on blur or Enter.
 */
export function GradeNumberInput({
  value, onChange, ariaLabel,
}: {
  /** '' = ungraded. */
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const n = text.trim() === '' ? null : Number(text);
  const valid = n === null || (Number.isFinite(n) && n >= GRADE_MIN && n <= GRADE_MAX);
  const tone = n !== null && valid ? scoreColor(Math.round(n)) : 'var(--text)';

  const commit = () => {
    const next = normalizeGrade(text);
    setText(next);
    if (next !== value) onChange(next);
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
      <input
        type="number"
        inputMode="numeric"
        min={GRADE_MIN}
        max={GRADE_MAX}
        step={1}
        value={text}
        placeholder="—"
        aria-label={ariaLabel}
        title={`${GRADE_MIN}–${GRADE_MAX}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        style={{
          width: 64,
          padding: '4px 8px',
          borderRadius: 6,
          border: `1px solid ${valid ? 'var(--border-light)' : 'var(--red, #ef4444)'}`,
          background: 'var(--surface-bright, transparent)',
          color: tone,
          fontWeight: 800,
          fontSize: rem(16),
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'center',
          fontFamily: 'inherit',
        }}
      />
      <span style={{ fontSize: rem(10), color: 'var(--text-muted)' }}>/{GRADE_MAX}</span>
    </span>
  );
}
