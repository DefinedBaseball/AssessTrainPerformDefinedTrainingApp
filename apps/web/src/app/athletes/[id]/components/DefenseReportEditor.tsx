'use client';

/* In-tab editor for an Infield / Outfield / Catching report.

   "Edit" in the report header swaps the report's display for this form,
   in place; Save writes it back and returns to the display. The forms are
   the report modal's own (exported from ReportModal), so the data written
   is exactly what the modal wrote:

     catching  catchingAssessment + catchingFormData
     infield   infieldAssessment  + infieldFormData  + infieldCoachGrades
     outfield  outfieldAssessment + outfieldFormData + outfieldCoachGrades

   Saved through the server-side merge, so notes, coach notes and attached
   videos on the report are never touched by this save. Grades are typed
   (20–80) here -- GradeInputModeContext switches the forms' sliders to
   number boxes; the modal keeps its sliders. */

import type React from 'react';
import { useMemo, useState } from 'react';
import * as api from '@/lib/api';
import { rem } from '@/lib/rem';
import type { ReportSummary } from '@/components/assessment/ReportSelector';
import aStyles from '@/components/assessment/assessment.module.css';
import {
  CatchingForm, InfieldForm, OutfieldForm, CoachGradesSection,
  emptyCatchingForm, emptyInfieldForm, emptyOutfieldForm,
  buildCatchingContent, buildInfieldContent, buildOutfieldContent,
  type CatchingFormData, type InfieldFormData, type OutfieldFormData,
} from '../ReportModal';
import {
  DEFENSE_COACH_GRADE_SECTIONS, getDefenseCoachGrades,
  type DefenseCoachGrades, type DefensePosition,
} from '../helpers';
import { GradeInputModeContext } from './GradeNumberInput';

const TITLE: Record<DefensePosition, string> = {
  infield: 'Infield', outfield: 'Outfield', catching: 'Catching',
};

function parseContent(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

const btn = (primary: boolean, enabled = true): React.CSSProperties => ({
  padding: '7px 18px', borderRadius: 8, fontSize: rem(12.5), fontWeight: 700,
  cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.55,
  border: primary ? '1px solid var(--text)' : '1px solid var(--border)',
  background: primary ? 'var(--text)' : 'transparent',
  color: primary ? 'var(--bg, #0e1116)' : 'var(--text-secondary)',
  fontFamily: 'inherit',
});

export function DefenseReportEditor({
  position, report, onCancel, onSaved,
}: {
  position: DefensePosition;
  report: ReportSummary;
  onCancel: () => void;
  /** Called after a successful save (the page refetches). */
  onSaved: () => void;
}) {
  const content = useMemo(() => parseContent(report.content), [report.content]);
  const formKey = `${position}FormData`;
  const assessmentKey = `${position}Assessment`;

  /* The form loads from the raw blob the modal saved beside the parsed
     assessment. A report saved before that blob existed (an older layout)
     has an assessment but no blob: its values can't be loaded, so the form
     opens blank and Save asks before replacing them. */
  const isLegacy = !content[formKey] && !!content[assessmentKey];

  const initialForm = useMemo(() => {
    if (content[formKey]) return content[formKey];
    return position === 'catching' ? emptyCatchingForm()
      : position === 'infield' ? emptyInfieldForm()
      : emptyOutfieldForm();
  }, [content, formKey, position]);
  const initialGrades = useMemo(
    () => (position === 'catching' ? {} : getDefenseCoachGrades(report, position)),
    [report, position],
  );

  const [form, setForm] = useState<any>(initialForm);
  const [grades, setGrades] = useState<DefenseCoachGrades>(initialGrades);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<null | 'discard' | 'replace'>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(initialForm)
    || JSON.stringify(grades) !== JSON.stringify(initialGrades);

  const doSave = async () => {
    setConfirm(null);
    setSaving(true);
    setError('');
    try {
      const set: Record<string, unknown> =
        position === 'catching'
          ? {
              catchingAssessment: buildCatchingContent(form as CatchingFormData),
              catchingFormData: form,
            }
          : position === 'infield'
            ? {
                infieldAssessment: buildInfieldContent(form as InfieldFormData),
                infieldFormData: form,
                infieldCoachGrades: grades,
              }
            : {
                outfieldAssessment: buildOutfieldContent(form as OutfieldFormData),
                outfieldFormData: form,
                outfieldCoachGrades: grades,
              };
      await api.mergeReportContent(report.id, { set });
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Could not save this report.');
    } finally {
      setSaving(false);
    }
  };

  const requestSave = () => (isLegacy ? setConfirm('replace') : void doSave());
  const requestCancel = () => (dirty ? setConfirm('discard') : onCancel());

  const actions = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
      {confirm === 'discard' ? (
        <>
          <span style={{ fontSize: rem(12.5), color: 'var(--text-secondary)' }}>Discard your changes?</span>
          <button type="button" style={btn(true)} onClick={onCancel}>Yes</button>
          <button type="button" style={btn(false)} onClick={() => setConfirm(null)}>No</button>
        </>
      ) : confirm === 'replace' ? (
        <>
          <span style={{ fontSize: rem(12.5), color: 'var(--text-secondary)' }}>Replace this report&rsquo;s existing values?</span>
          <button type="button" style={btn(true)} onClick={() => void doSave()}>Yes</button>
          <button type="button" style={btn(false)} onClick={() => setConfirm(null)}>No</button>
        </>
      ) : (
        <>
          <button type="button" style={btn(false, !saving)} onClick={requestCancel} disabled={saving}>Cancel</button>
          <button type="button" style={btn(true, !saving && dirty)} onClick={requestSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className={aStyles.profilePanel} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: rem(16), fontWeight: 700, fontStyle: 'italic', textTransform: 'uppercase',
            letterSpacing: '-0.01em', color: 'var(--text-bright)',
          }}>
            Editing {TITLE[position]} Report
          </div>
          <div style={{ fontSize: rem(12), color: 'var(--text-muted)', marginTop: 2 }}>
            {report.title?.trim() || `${TITLE[position]} Report`} · {new Date(report.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        </div>
        {actions}
      </div>

      {isLegacy && (
        <div role="note" style={{
          padding: '10px 12px', borderRadius: 8, fontSize: rem(12.5), lineHeight: 1.5,
          border: '1px solid rgba(234,179,8,0.55)', background: 'rgba(234,179,8,0.10)', color: 'var(--text)',
        }}>
          This report was saved in an older format, so its values can&rsquo;t be loaded into the editor.
          The form starts blank, and saving replaces what this report currently shows.
        </div>
      )}

      <GradeInputModeContext.Provider value="number">
        {position === 'catching' && <CatchingForm data={form} setData={setForm} />}
        {position === 'infield' && <InfieldForm data={form} setData={setForm} />}
        {position === 'outfield' && <OutfieldForm data={form} setData={setForm} />}
        {position !== 'catching' && (
          <CoachGradesSection
            title="Throwing Grades"
            sections={DEFENSE_COACH_GRADE_SECTIONS}
            grades={grades as any}
            setGrades={setGrades as any}
          />
        )}
      </GradeInputModeContext.Provider>

      {error && (
        <div role="alert" style={{
          padding: '8px 12px', borderRadius: 8, fontSize: rem(12.5),
          border: '1px solid var(--red, #ef4444)', background: 'rgba(239,68,68,0.08)', color: 'var(--text)',
        }}>{error}</div>
      )}
      {actions}
    </div>
  );
}
