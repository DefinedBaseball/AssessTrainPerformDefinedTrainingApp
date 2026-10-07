'use client';

/* Education → Information: documents coaches share with Membership athletes
   (recruiting guides, nutrition and strength programs, ...).

   Files are served only through the members-only API, so opening one means
   fetching it with the signed-in token: PDFs and images open in a new tab
   for reading, everything else (Word / Excel / PowerPoint / ...) downloads
   and opens in the device's own app. */

import { useMemo, useRef, useState } from 'react';
import * as api from '@/lib/api';
import type { EduDocument, EduDocCategory } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '@/components/assessment/assessment.module.css';
import styles from './page.module.css';
import { tzOpt } from '@/lib/academy';

export const DOC_CATEGORIES: { id: EduDocCategory; label: string }[] = [
  { id: 'SKILL', label: 'Skill Training' },
  { id: 'PHYSICAL', label: 'Physical Training' },
  { id: 'RECRUITING', label: 'Recruiting' },
  { id: 'MENTAL', label: 'Mental/Visual' },
];
const categoryLabel = (id: string) => DOC_CATEGORIES.find((c) => c.id === id)?.label ?? id;

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.rtf,.pages,.numbers,.key,.png,.jpg,.jpeg,.webp';

function kindOf(fileName: string): { label: string; icon: string; viewable: boolean } {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { label: 'PDF', icon: '📕', viewable: true };
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return { label: 'Image', icon: '🖼️', viewable: true };
  if (['doc', 'docx', 'pages', 'rtf', 'txt'].includes(ext)) return { label: ext === 'txt' ? 'Text' : 'Document', icon: '📄', viewable: false };
  if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return { label: 'Spreadsheet', icon: '📊', viewable: false };
  if (['ppt', 'pptx', 'key'].includes(ext)) return { label: 'Presentation', icon: '📽️', viewable: false };
  return { label: 'File', icon: '📁', viewable: false };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function InformationView({
  documents, setDocuments, isCoach, search, setSearch,
}: {
  documents: EduDocument[];
  setDocuments: React.Dispatch<React.SetStateAction<EduDocument[]>>;
  isCoach: boolean;
  search: string;
  setSearch: (s: string) => void;
}) {
  const [category, setCategory] = useState<'ALL' | EduDocCategory>('ALL');
  const [showUpload, setShowUpload] = useState(false);
  const [editing, setEditing] = useState<EduDocument | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return documents.filter((d) =>
      (category === 'ALL' || d.category === category)
      && (!q || d.title.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q)
        || d.fileName.toLowerCase().includes(q)));
  }, [documents, category, search]);

  const open = async (doc: EduDocument) => {
    setError('');
    const viewable = kindOf(doc.fileName).viewable;
    /* Open the tab inside the click so the browser doesn't treat it as a
       pop-up; it is pointed at the file once it has downloaded. */
    const tab = viewable ? window.open('', '_blank') : null;
    setBusyId(doc.id);
    try {
      const blob = await api.fetchEduDocumentBlob(doc.id);
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      tab?.close();
      setError(err?.message || 'Could not open that document.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (doc: EduDocument) => {
    if (!window.confirm(`Delete "${doc.title}"? Athletes will no longer see it.`)) return;
    try {
      await api.deleteEduDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err: any) {
      setError(err?.message || 'Could not delete that document.');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Education Library"
        title="Information"
        titleAccent="Library"
        subtitle="Recruiting guides, training programs and other documents for members."
        actions={isCoach ? <button className={styles.addBtn} onClick={() => setShowUpload(true)}>+ Add Document</button> : undefined}
      />
      <div className={aStyles.profilePanel} style={{ marginTop: 16, padding: 20, display: 'flex', flexDirection: 'column' }}>
        <input className={styles.searchInput} placeholder="Search documents..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className={styles.filterRow} style={{ marginTop: 16 }}>
          <button className={`${styles.pill} ${category === 'ALL' ? styles.pillActive : ''}`} onClick={() => setCategory('ALL')}>
            All ({documents.length})
          </button>
          {DOC_CATEGORIES.map((c) => (
            <button key={c.id} className={`${styles.pill} ${category === c.id ? styles.pillActive : ''}`} onClick={() => setCategory(c.id)}>
              {c.label} ({documents.filter((d) => d.category === c.id).length})
            </button>
          ))}
        </div>

        {error && <div role="alert" className={styles.docError}>{error}</div>}

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            {documents.length === 0
              ? (isCoach ? 'No documents yet. Use + Add Document to share the first one.' : 'No documents have been shared yet.')
              : 'No documents match.'}
          </div>
        ) : (
          <div className={styles.docList}>
            {filtered.map((d) => {
              const k = kindOf(d.fileName);
              return (
                <div key={d.id} className={styles.docRow}>
                  <div className={styles.docIcon} aria-hidden="true">{k.icon}</div>
                  <div className={styles.docBody}>
                    <div className={styles.docTitle}>{d.title}</div>
                    {d.description && <div className={styles.docDesc}>{d.description}</div>}
                    <div className={styles.docMeta}>
                      <span className={styles.docBadge}>{categoryLabel(d.category)}</span>
                      <span>{k.label} · {formatSize(d.size)}</span>
                      <span>{new Date(d.createdAt).toLocaleDateString(undefined, { ...tzOpt(), month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <div className={styles.docActions}>
                    <button className={styles.docOpen} onClick={() => void open(d)} disabled={busyId === d.id}>
                      {busyId === d.id ? 'Opening…' : k.viewable ? 'Open' : 'Download'}
                    </button>
                    {isCoach && (
                      <>
                        <button className={`${styles.cardBtn} ${styles.cardBtnEdit}`} onClick={() => setEditing(d)} title="Edit details">&#9998;</button>
                        <button className={`${styles.cardBtn} ${styles.cardBtnDel}`} onClick={() => void remove(d)} title="Delete document">×</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showUpload && (
        <DocumentModal
          defaultCategory={category === 'ALL' ? 'SKILL' : category}
          onClose={() => setShowUpload(false)}
          onSaved={(doc) => { setDocuments((prev) => [doc, ...prev]); setShowUpload(false); }}
        />
      )}
      {editing && (
        <DocumentModal
          existing={editing}
          defaultCategory={editing.category}
          onClose={() => setEditing(null)}
          onSaved={(doc) => { setDocuments((prev) => prev.map((d) => (d.id === doc.id ? doc : d))); setEditing(null); }}
        />
      )}
    </>
  );
}

/** Upload a new document, or (with `existing`) edit its title / category /
 *  description. The file itself can't be swapped -- delete and re-upload. */
function DocumentModal({
  existing, defaultCategory, onClose, onSaved,
}: {
  existing?: EduDocument;
  defaultCategory: EduDocCategory;
  onClose: () => void;
  onSaved: (doc: EduDocument) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [category, setCategory] = useState<EduDocCategory>(existing?.category ?? defaultCategory);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setError('');
    if (!f) return;
    if (f.size > MAX_BYTES) { setError('Files can be up to 25 MB.'); return; }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const canSave = !saving && !!title.trim() && (existing ? true : !!file);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const doc = existing
        ? await api.updateEduDocument(existing.id, { title: title.trim(), category, description: description.trim() || null })
        : await api.uploadEduDocument(file!, { title: title.trim(), category, description: description.trim() });
      onSaved(doc);
    } catch (err: any) {
      setError(err?.message || 'Could not save the document.');
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{existing ? 'Edit Document' : 'Add Document'}</span>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          {!existing && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>File</label>
              <button type="button" className={styles.docPick} onClick={() => inputRef.current?.click()}>
                {file ? `${file.name} · ${formatSize(file.size)}` : 'Choose a file (PDF, Word, Excel, PowerPoint, image…)'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                style={{ display: 'none' }}
                onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = ''; }}
              />
            </div>
          )}
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Title</label>
            <input className={styles.fieldInput} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Recruiting Timeline for Juniors" maxLength={200} />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Category</label>
            <select className={styles.fieldInput} value={category} onChange={(e) => setCategory(e.target.value as EduDocCategory)}>
              {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Description (optional)</label>
            <textarea className={styles.fieldInput} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} placeholder="What it is and who it's for" style={{ resize: 'vertical' }} />
          </div>
          {error && <div role="alert" className={styles.docError}>{error}</div>}
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.btnCancel} onClick={onClose}>Cancel</button>
          <button className={styles.btnSave} onClick={() => void save()} disabled={!canSave}>
            {saving ? (existing ? 'Saving...' : 'Uploading...') : (existing ? 'Save' : 'Upload')}
          </button>
        </div>
      </div>
    </div>
  );
}
