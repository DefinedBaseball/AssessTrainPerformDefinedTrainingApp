'use client';

/* ─────────────────────────────────────────────────────────────────────────
   TemplatePicker — small centered modal for applying / managing saved
   schedule templates ("Pitching Day A"). Shared by the Training calendar
   (apply to the selected player + day) and the Program board (apply to an
   athlete's column for the session date). Coach-only surfaces render it;
   the endpoints are COACH-gated server-side as well.

   The picker owns fetching + deletion; APPLYING is the caller's job (the
   caller knows the target player/date/tab) via onApply(template, items).
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { parseTemplateItems, type ScheduleTemplate, type ScheduleTemplateItem } from '@/lib/api';

const TAB_LABELS: Record<string, string> = {
  hitting: 'Hitting', pitching: 'Pitching', catching: 'Catching',
  infield: 'Infield', outfield: 'Outfield', strength: 'S&C',
};

/* ── SaveTemplateModal ──
   Styled replacement for the v1 window.prompt flow: names the template,
   shows what's being snapshotted, and confirms the save inline ("✓ Saved")
   before auto-closing. The caller owns the actual API write via onSave so
   this stays a dumb, reusable shell. */
export function SaveTemplateModal({
  open, sportLabel, itemCount, sectionCount, onClose, onSave,
}: {
  open: boolean;
  sportLabel: string;
  itemCount: number;
  sectionCount: number;
  onClose: () => void;
  /** Persist the template; throw to surface an inline error. */
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh state every time the modal opens.
  useEffect(() => {
    if (open) { setName(''); setSaving(false); setSaved(false); setError(null); }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setSaved(true);
      setTimeout(onClose, 1100);
    } catch (e: any) {
      setError(e?.message || 'Failed to save template');
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(6, 8, 14, 0.62)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={saved ? undefined : onClose}
    >
      <div
        style={{
          width: 'min(380px, 94vw)',
          background: 'var(--surface-bright, var(--surface))',
          border: '1px solid var(--border-bright, var(--border))',
          borderRadius: 14, padding: '16px 16px 14px',
          boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-bright, var(--text))' }}>
            Save as Template
          </div>
          {!saved && (
            <button type="button" onClick={onClose}
              style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
              aria-label="Close">×</button>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          {sportLabel} · {itemCount} drill{itemCount !== 1 ? 's' : ''} · {sectionCount} section{sectionCount !== 1 ? 's' : ''}
        </div>

        {saved ? (
          <div style={{ padding: '18px 0 10px', textAlign: 'center', color: 'var(--green, #22c55e)', fontSize: 14, fontWeight: 700 }}>
            ✓ Template “{name.trim()}” saved
          </div>
        ) : (
          <>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder='e.g. "Pitching Day A"'
              maxLength={60}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '9px 11px', borderRadius: 9,
                border: '1px solid var(--border)',
                background: 'var(--surface)', color: 'var(--text-bright, var(--text))',
                fontSize: 13.5, outline: 'none', marginBottom: 10,
              }}
            />
            {error && (
              <div style={{ fontSize: 11.5, color: 'var(--red, #ef4444)', marginBottom: 8 }}>{error}</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" onClick={onClose}
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="button" onClick={submit} disabled={!name.trim() || saving}
                style={{
                  border: '1px solid var(--accent, #3d8bfd)',
                  color: '#fff', background: 'var(--accent, #3d8bfd)',
                  borderRadius: 8, padding: '6px 16px', fontSize: 12, fontWeight: 700,
                  cursor: !name.trim() || saving ? 'default' : 'pointer',
                  opacity: !name.trim() || saving ? 0.55 : 1,
                }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function TemplatePicker({
  open, tab, title, onClose, onApply, applying = false,
}: {
  open: boolean;
  /** When set, only templates for this sport tab are listed. */
  tab?: string;
  /** Header line — tells the coach WHERE the template will be applied,
   *  e.g. "Apply to Henry Adams — Jul 8". */
  title: string;
  onClose: () => void;
  onApply: (template: ScheduleTemplate, items: ScheduleTemplateItem[]) => void;
  /** Caller sets true while its apply call is in flight — disables rows. */
  applying?: boolean;
}) {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setConfirmId(null);
    api.getScheduleTemplates(tab)
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, [open, tab]);

  if (!open) return null;

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await api.deleteScheduleTemplate(id);
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch { /* row stays; next open refetches */ }
    finally { setDeleting(null); setConfirmId(null); }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(6, 8, 14, 0.62)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(440px, 94vw)', maxHeight: '78vh', overflowY: 'auto',
          background: 'var(--surface-bright, var(--surface))',
          border: '1px solid var(--border-bright, var(--border))',
          borderRadius: 14, padding: '16px 16px 12px',
          boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-bright, var(--text))' }}>
            Schedule Templates
          </div>
          <button type="button" onClick={onClose}
            style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
            aria-label="Close">×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{title}</div>

        {loading ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
        ) : templates.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.6 }}>
            No templates yet{tab ? ` for ${TAB_LABELS[tab] || tab}` : ''}.<br />
            Build a day on the Training calendar, then use “Save as template” on that sport&apos;s column.
          </div>
        ) : (
          templates.map(t => {
            const items = parseTemplateItems(t);
            const sections = [...new Set(items.map(i => i.category))];
            return (
              <div key={t.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 10px', borderRadius: 10, marginBottom: 6,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-bright, var(--text))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {TAB_LABELS[t.tab] || t.tab} · {items.length} drill{items.length !== 1 ? 's' : ''} · {sections.length} section{sections.length !== 1 ? 's' : ''}
                  </div>
                </div>
                {confirmId === t.id ? (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Delete?</span>
                    <button type="button" disabled={deleting === t.id}
                      onClick={() => handleDelete(t.id)}
                      style={{ border: '1px solid var(--red, #ef4444)', color: 'var(--red, #ef4444)', background: 'transparent', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
                      {deleting === t.id ? '…' : 'Yes'}
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)}
                      style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'transparent', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
                      No
                    </button>
                  </span>
                ) : (
                  <>
                    <button type="button" disabled={applying}
                      onClick={() => onApply(t, items)}
                      style={{
                        border: '1px solid var(--accent, #3d8bfd)', color: 'var(--accent, #3d8bfd)',
                        background: 'transparent', borderRadius: 8, padding: '4px 12px',
                        fontSize: 11.5, fontWeight: 700, cursor: applying ? 'default' : 'pointer',
                        opacity: applying ? 0.5 : 1,
                      }}>
                      {applying ? 'Applying…' : 'Apply'}
                    </button>
                    <button type="button" onClick={() => setConfirmId(t.id)}
                      title="Delete template" aria-label="Delete template"
                      style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', fontSize: 15, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
