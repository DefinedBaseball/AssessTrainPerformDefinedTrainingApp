'use client';

/**
 * PDF Builder Modal
 *
 * Drives the Player Summary tab's "Download PDF" flow with a small
 * editor:
 *   1. Title Page is auto-populated and locked at the top.
 *   2. The modal kicks off a capture pass on open via `onCapture`,
 *      grabbing every available section's screenshot upfront so the
 *      preview pane can paint actual, to-scale thumbnails (not
 *      placeholder boxes).
 *   3. Each available section gets an include checkbox + reorder
 *      controls + a vertical-position slider that decides where the
 *      screenshot sits on its page. The thumbnail in the preview is
 *      also DRAGGABLE — drag it up or down to set the same yOffset
 *      visually.
 *   4. Layouts can be saved as named presets in localStorage and
 *      restored later — useful for coaches who want a consistent
 *      report shape across players.
 *
 * On "Generate PDF" this hands the chosen layout + the cached
 * captures back to the parent, which assembles them into the final
 * PDF without doing a second capture pass.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './PdfBuilderModal.module.css';

export interface PdfSectionSpec {
  key: 'tool-grades' | 'hitting-snapshot' | 'infield-snapshot' | 'catching-snapshot' | 'outfield-snapshot' | 'pitch-report';
  title: string;
}

export interface PdfSectionConfig {
  key: PdfSectionSpec['key'];
  enabled: boolean;
  /** 0 = pinned to top of page, 0.5 = vertically centered, 1 = pinned
   *  to bottom. Applied as the section image's vertical alignment on
   *  its page when assembling the final PDF. Set via the slider or
   *  by dragging the thumbnail in the preview pane. */
  yOffset: number;
  /** Width of the section image as a fraction of the page's content
   *  area, 0.3-1.0. 1.0 fills the page width; smaller values shrink
   *  the screenshot proportionally (aspect ratio preserved). The
   *  image stays horizontally centered when scaled below 100%. */
  scale: number;
}

export interface PdfLayout {
  /** Ordered list of sections. Order in this array = order in PDF.
   *  Each entry's `enabled` controls whether it gets a page. */
  sections: PdfSectionConfig[];
}

export interface PdfPreset {
  id: string;
  name: string;
  layout: PdfLayout;
  /** ISO timestamp — newest first in pickers. */
  updatedAt: string;
}

export interface CapturedSnap {
  dataUrl: string;
  width: number;
  height: number;
  title: string;
}

/** All sections the builder knows about, in their canonical default order. */
const ALL_SECTIONS: PdfSectionSpec[] = [
  { key: 'tool-grades',       title: 'Tool Grades' },
  { key: 'hitting-snapshot',  title: 'Hitting Snapshot' },
  { key: 'infield-snapshot',  title: 'Infield Snapshot' },
  { key: 'catching-snapshot', title: 'Catching Snapshot' },
  { key: 'outfield-snapshot', title: 'Outfield Snapshot' },
  { key: 'pitch-report',      title: 'Pitch Report' },
];

const DEFAULT_LAYOUT: PdfLayout = {
  sections: ALL_SECTIONS.map(s => ({ key: s.key, enabled: true, yOffset: 0.5, scale: 1 })),
};

/* ─── localStorage preset store ─── */

const PRESETS_LS_KEY = 'pdev:pdfPresets';

function loadPresets(): PdfPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRESETS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is PdfPreset =>
      p && typeof p.id === 'string' && typeof p.name === 'string'
      && p.layout && Array.isArray(p.layout.sections),
    );
  } catch {
    return [];
  }
}

function savePresetsToStorage(presets: PdfPreset[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRESETS_LS_KEY, JSON.stringify(presets));
  } catch { /* quota / serialization error — non-fatal */ }
}

/* ─── Helpers ─── */

const titleOf = (key: PdfSectionSpec['key']): string =>
  ALL_SECTIONS.find(s => s.key === key)?.title ?? key;

function reconcileLayout(layout: PdfLayout): PdfLayout {
  const known = new Map(layout.sections.map(s => [s.key, s] as const));
  const reconciled: PdfSectionConfig[] = [];
  for (const seen of layout.sections) {
    if (ALL_SECTIONS.some(a => a.key === seen.key)) {
      /* Fill in any new fields added to PdfSectionConfig after a
         preset was saved. `scale` was added later — old presets
         persisted to localStorage may not include it. */
      reconciled.push({
        ...seen,
        scale: typeof seen.scale === 'number' ? seen.scale : 1,
      });
    }
  }
  for (const a of ALL_SECTIONS) {
    if (!known.has(a.key)) {
      reconciled.push({ key: a.key, enabled: false, yOffset: 0.5, scale: 1 });
    }
  }
  return { sections: reconciled };
}

/* ─── Draggable thumbnail subcomponent ───
 * Renders a captured section image inside a positioned wrapper.
 * The user can drag the image vertically inside the preview page;
 * dragging fires `onYOffsetChange` with the new 0-1 value. */

interface DraggableSectionPreviewProps {
  capture: CapturedSnap;
  yOffset: number;
  /** Image width as a fraction of the canvas width (0.3-1.0). */
  scale: number;
  onYOffsetChange: (next: number) => void;
}

function DraggableSectionPreview({
  capture,
  yOffset,
  scale,
  onYOffsetChange,
}: DraggableSectionPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startY: number; startOffset: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Compute the thumbnail's natural aspect-fit size inside the canvas.
  // Canvas is 11:8.5 landscape; the screenshot occupies `scale * 100%`
  // of the canvas width (centered) so the user's Size slider directly
  // governs how much real estate the section takes on the page.
  const aspect = capture.width / capture.height || 1;
  /* Canvas inner area allows up to 88% wide (matching the previous
     fixed margin). At scale=1 the thumb is 88% wide, at scale=0.5
     it's 44% wide, etc. */
  const widthPct = 88 * scale;
  /* Center the thumb horizontally inside the canvas. */
  const leftPct = (100 - widthPct) / 2;

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent | TouchEvent) => {
      if (!dragState.current || !wrapRef.current) return;
      const canvas = wrapRef.current.parentElement; // the page canvas
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const imgEl = wrapRef.current;
      const imgH = imgEl.getBoundingClientRect().height;
      const range = rect.height - imgH;
      if (range <= 0) return; // image too tall to drag
      const clientY = (e as MouseEvent).clientY ?? (e as TouchEvent).touches[0].clientY;
      const dy = clientY - dragState.current.startY;
      // Convert pixel delta to yOffset delta — drag covers the full
      // range (0 → 1) over the available `range` of pixels.
      const dOffset = dy / range;
      const next = Math.max(0, Math.min(1, dragState.current.startOffset + dOffset));
      onYOffsetChange(next);
    };
    const handleUp = () => {
      dragState.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [dragging, onYOffsetChange]);

  const handleDown = (e: React.MouseEvent | React.TouchEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragState.current = { startY: clientY, startOffset: yOffset };
    setDragging(true);
    // Prevent text selection during drag
    if ('preventDefault' in e) e.preventDefault();
  };

  return (
    <div
      ref={wrapRef}
      className={`${styles.previewThumb}${dragging ? ' ' + styles.previewThumbDragging : ''}`}
      style={{
        // Position the thumbnail vertically inside the page canvas.
        // top = yOffset * (canvasH - thumbH); since we don't know
        // thumbH at render, we use percentage-based top + transform
        // to pin the thumb's top edge to (yOffset * canvasH) for
        // yOffset=0 → top, 0.5 → middle, 1 → bottom of the canvas
        // (clamped by the thumb's own height).
        top: `${yOffset * 100}%`,
        transform: `translateY(${-yOffset * 100}%)`,
        aspectRatio: `${aspect}`,
        /* Horizontal extent driven by the Size slider — overrides
           the static left/right rules in `.previewThumb`. */
        left: `${leftPct}%`,
        right: 'auto',
        width: `${widthPct}%`,
      }}
      onMouseDown={handleDown}
      onTouchStart={handleDown}
      role="slider"
      aria-label={`Vertical position of ${capture.title}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(yOffset * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp')   { e.preventDefault(); onYOffsetChange(Math.max(0, yOffset - 0.02)); }
        if (e.key === 'ArrowDown') { e.preventDefault(); onYOffsetChange(Math.min(1, yOffset + 0.02)); }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={capture.dataUrl}
        alt={capture.title}
        draggable={false}
        className={styles.previewThumbImg}
      />
      <span className={styles.previewThumbGrip} aria-hidden="true">⇕</span>
    </div>
  );
}

/* ─── Modal ─── */

interface PdfBuilderModalProps {
  open: boolean;
  playerName: string;
  onClose: () => void;
  /** Captures every available section once when the modal opens. The
   *  modal stores the result and uses it both for preview thumbnails
   *  and for the final PDF assembly. */
  onCapture: () => Promise<Record<string, CapturedSnap>>;
  /** Called with the finalized layout + captured sections when the
   *  user clicks Generate. */
  onGenerate: (layout: PdfLayout, captures: Record<string, CapturedSnap>) => Promise<void>;
}

export function PdfBuilderModal({
  open,
  playerName,
  onClose,
  onCapture,
  onGenerate,
}: PdfBuilderModalProps) {
  const [layout, setLayout] = useState<PdfLayout>(DEFAULT_LAYOUT);
  const [presets, setPresets] = useState<PdfPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [newPresetName, setNewPresetName] = useState('');
  const [generating, setGenerating] = useState(false);

  /* Captures map — null until the initial capture pass finishes. */
  const [captures, setCaptures] = useState<Record<string, CapturedSnap> | null>(null);
  const [capturing, setCapturing] = useState(false);

  /* Keep the latest `onCapture` in a ref so the open-→-capture effect
     below only depends on `open` and never re-runs because the parent
     re-rendered (which happens A LOT during capture, since
     `setActiveTab` cycles the active tab on each section and forces a
     re-render that produces a new `onCapture` closure). Without this
     ref the effect would re-trigger capture on every parent render
     during capture → infinite "Generating PDF…" flicker loop. */
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; }, [onCapture]);

  // Load presets on open
  useEffect(() => {
    if (!open) return;
    setPresets(loadPresets());
  }, [open]);

  // Kick off the initial capture pass when the modal opens. We do this
  // ONCE per open transition; subsequent re-renders of the parent
  // don't re-trigger because we depend on `open` only and read
  // `onCapture` from a ref. Closing the modal resets the captures so
  // a re-open re-grabs fresh screenshots (in case the player's data
  // changed in the meantime).
  useEffect(() => {
    if (!open) {
      setCaptures(null);
      setCapturing(false);
      return;
    }
    let cancelled = false;
    setCapturing(true);
    setCaptures(null);
    onCaptureRef.current()
      .then((result) => {
        if (cancelled) return;
        setCaptures(result);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('PDF capture failed:', err);
        if (!cancelled) setCaptures({});
      })
      .finally(() => {
        if (!cancelled) setCapturing(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const updateSection = (key: PdfSectionSpec['key'], patch: Partial<PdfSectionConfig>) => {
    setLayout(l => ({
      sections: l.sections.map(s => s.key === key ? { ...s, ...patch } : s),
    }));
  };

  const moveSection = (key: PdfSectionSpec['key'], dir: -1 | 1) => {
    setLayout(l => {
      const idx = l.sections.findIndex(s => s.key === key);
      if (idx === -1) return l;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= l.sections.length) return l;
      const copy = l.sections.slice();
      const [item] = copy.splice(idx, 1);
      copy.splice(newIdx, 0, item);
      return { sections: copy };
    });
  };

  const enabledSections = useMemo(
    () => layout.sections.filter(s => s.enabled),
    [layout.sections],
  );

  /** Sections that actually rendered to a capture (some may have been
   *  skipped if the player doesn't have data for them, e.g. no infield
   *  assessment on a pure outfielder). */
  const captureKeys = useMemo(
    () => new Set(captures ? Object.keys(captures) : []),
    [captures],
  );

  const handleApplyPreset = (id: string) => {
    const p = presets.find(p => p.id === id);
    if (!p) return;
    setLayout(reconcileLayout(p.layout));
    setActivePresetId(p.id);
  };

  const handleSavePreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const next: PdfPreset = {
      id,
      name,
      layout,
      updatedAt: new Date().toISOString(),
    };
    const updated = [next, ...presets].slice(0, 24);
    setPresets(updated);
    savePresetsToStorage(updated);
    setActivePresetId(id);
    setNewPresetName('');
  };

  const handleOverwritePreset = () => {
    if (!activePresetId) return;
    const updated = presets.map(p =>
      p.id === activePresetId
        ? { ...p, layout, updatedAt: new Date().toISOString() }
        : p,
    );
    setPresets(updated);
    savePresetsToStorage(updated);
  };

  const handleDeletePreset = (id: string) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    savePresetsToStorage(updated);
    if (activePresetId === id) setActivePresetId(null);
  };

  const handleResetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
    setActivePresetId(null);
  };

  const handleGenerate = async () => {
    if (!captures || enabledSections.length === 0) return;
    setGenerating(true);
    try {
      await onGenerate(layout, captures);
      onClose();
    } finally {
      setGenerating(false);
    }
  };

  /** One-click default report. Skips the editor entirely:
   *    Page 1 → Cover Page (auto)
   *    Page 2 → Tool Grades (always for any player)
   *    Page 3 → Hitting Snapshot   (if captured)
   *    Page 4 → Pitching Snapshot  (if captured — 'pitch-report' key)
   *    Page 5 → Catching Snapshot  (if captured)
   *    Page 6 → Infield Snapshot   (if captured)
   *    Page 7 → Outfield Snapshot  (if captured)
   *  Sections without a capture (player doesn't have that position, or
   *  the corresponding tab isn't populated yet) are skipped, so a pure
   *  Catcher's report comes out as Cover → Tool Grades → Hitting →
   *  Catching, etc.
   *  Uses neutral defaults (yOffset 0.5, scale 1) — the user can
   *  still configure manually via the rest of the modal if they want
   *  something custom. */
  const DEFAULT_ORDER: PdfSectionSpec['key'][] = [
    'tool-grades',
    'hitting-snapshot',
    'pitch-report',
    'catching-snapshot',
    'infield-snapshot',
    'outfield-snapshot',
  ];

  const handleDefaultDownload = async () => {
    if (!captures) return;
    const defaultLayout: PdfLayout = {
      sections: DEFAULT_ORDER.map(key => ({
        key,
        enabled: !!captures[key],
        yOffset: 0.5,
        scale: 1,
      })),
    };
    if (!defaultLayout.sections.some(s => s.enabled)) {
      // Nothing captured — bail with a friendly alert instead of
      // generating an empty PDF.
      alert('No sections were available to capture for this player.');
      return;
    }
    setGenerating(true);
    try {
      await onGenerate(defaultLayout, captures);
      onClose();
    } finally {
      setGenerating(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="PDF Builder">
      <div className={styles.modal}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Build Player Summary PDF</h2>
            <p className={styles.subtitle}>
              Title page auto-populates. Pick sections, reorder them, and drag
              each preview to position the section on its page.
            </p>
          </div>
          <div className={styles.headerActions}>
            {/* One-click default report — emits the canonical Cover →
                Tool Grades → Hitting → Pitching → Catching → Infield →
                Outfield ordering, including only the sections that
                captured successfully (which already accounts for the
                player's selected positions + populated tabs). Disabled
                while the initial capture pass is still running. */}
            <button
              type="button"
              className={styles.defaultDownloadBtn}
              onClick={handleDefaultDownload}
              disabled={!captures || capturing || generating}
              title="Download a PDF using the default section order and layout."
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"
                   stroke="currentColor" strokeWidth="1.7"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 2v8M8 10l-3-3M8 10l3-3" />
                <path d="M2 12h12v2H2z" />
              </svg>
              <span>{generating ? 'Generating…' : 'Download Default Report'}</span>
            </button>
            <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {/* Body — two columns: section controls + preview */}
        <div className={styles.body}>
          {/* LEFT — section list */}
          <div className={styles.col}>
            <div className={styles.colHead}>
              <span>Sections</span>
              <button type="button" className={styles.linkBtn} onClick={handleResetLayout}>
                Reset
              </button>
            </div>

            {/* Title Page — locked first row */}
            <div className={styles.sectionRow + ' ' + styles.sectionRowLocked}>
              <div className={styles.sectionInfo}>
                <span className={styles.sectionLock} aria-hidden="true">🔒</span>
                <span className={styles.sectionTitle}>Title Page</span>
                <span className={styles.sectionMeta}>Auto-populated</span>
              </div>
            </div>

            {layout.sections.map((s, idx) => {
              const captured = captures?.[s.key];
              const captureMissing = captures !== null && !captured;
              return (
                <div
                  key={s.key}
                  className={`${styles.sectionRow}${s.enabled ? '' : ' ' + styles.sectionRowDisabled}`}
                >
                  <div className={styles.sectionInfo}>
                    <label className={styles.checkbox}>
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={e => updateSection(s.key, { enabled: e.target.checked })}
                        disabled={captureMissing}
                      />
                      <span className={styles.sectionTitle}>{titleOf(s.key)}</span>
                    </label>
                    {captureMissing && (
                      <span className={styles.sectionMeta}>No data</span>
                    )}
                  </div>
                  <div className={styles.sectionControls}>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => moveSection(s.key, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${titleOf(s.key)} up`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => moveSection(s.key, 1)}
                      disabled={idx === layout.sections.length - 1}
                      aria-label={`Move ${titleOf(s.key)} down`}
                    >
                      ↓
                    </button>
                  </div>

                  {s.enabled && !captureMissing && (
                    <>
                      <div className={styles.slider}>
                        <label className={styles.sliderLabel}>
                          Vertical position
                          <span className={styles.sliderValue}>
                            {Math.round(s.yOffset * 100)}%
                          </span>
                        </label>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(s.yOffset * 100)}
                          onChange={e => updateSection(s.key, { yOffset: Number(e.target.value) / 100 })}
                        />
                        <div className={styles.sliderTicks}>
                          <span>Top</span>
                          <span>Middle</span>
                          <span>Bottom</span>
                        </div>
                      </div>

                      {/* Size slider — drives how wide the section
                          image renders on its PDF page (and how big
                          the draggable preview thumbnail looks). The
                          preview updates instantly; the PDF picks up
                          the same value at Generate time. */}
                      <div className={styles.slider}>
                        <label className={styles.sliderLabel}>
                          Size
                          <span className={styles.sliderValue}>
                            {Math.round(s.scale * 100)}%
                          </span>
                        </label>
                        <input
                          type="range"
                          min={30}
                          max={100}
                          value={Math.round(s.scale * 100)}
                          onChange={e => updateSection(s.key, { scale: Number(e.target.value) / 100 })}
                        />
                        <div className={styles.sliderTicks}>
                          <span>Small</span>
                          <span>Medium</span>
                          <span>Full</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* RIGHT — preview pane */}
          <div className={styles.col}>
            <div className={styles.colHead}>
              <span>Preview</span>
              <span className={styles.tag}>
                {capturing ? 'Capturing…' : `${enabledSections.length + 1} page${enabledSections.length === 0 ? '' : 's'}`}
              </span>
            </div>

            <div className={styles.previewScroll}>
              {/* Page 1 — Title Page mock */}
              <div className={styles.previewPage}>
                <div className={styles.previewPageHead}>1 — Title Page</div>
                <div className={styles.previewPageCanvas}>
                  <div className={styles.titleMock}>
                    <div className={styles.titleMockName}>{playerName || '—'}</div>
                    <div className={styles.titleMockSub}>Player Summary</div>
                  </div>
                </div>
              </div>

              {/* Capture-in-progress placeholder */}
              {capturing && (
                <div className={styles.previewEmpty}>
                  <div className={styles.previewSpinner} aria-hidden="true" />
                  Capturing live previews from each tab… this will take a few seconds.
                </div>
              )}

              {/* Section pages with real screenshots */}
              {!capturing && enabledSections.map((s, i) => {
                const captured = captures?.[s.key];
                return (
                  <div key={s.key} className={styles.previewPage}>
                    <div className={styles.previewPageHead}>
                      {i + 2} — {titleOf(s.key)}
                    </div>
                    <div className={styles.previewPageCanvas}>
                      {captured ? (
                        <DraggableSectionPreview
                          capture={captured}
                          yOffset={s.yOffset}
                          scale={s.scale ?? 1}
                          onYOffsetChange={(next) => updateSection(s.key, { yOffset: next })}
                        />
                      ) : (
                        <div className={styles.previewMissing}>
                          No captured data for this section.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {!capturing && enabledSections.length === 0 && (
                <div className={styles.previewEmpty}>
                  No sections selected. Check at least one section on the left.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.presetArea}>
            <label className={styles.presetLabel}>Load Preset</label>
            <select
              className={styles.presetSelect}
              value={activePresetId ?? ''}
              onChange={e => {
                const v = e.target.value;
                if (v) handleApplyPreset(v);
                else { setActivePresetId(null); setLayout(DEFAULT_LAYOUT); }
              }}
            >
              <option value="">— Default —</option>
              {presets.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {activePresetId && (
              <>
                <button type="button" className={styles.smallBtn} onClick={handleOverwritePreset}>
                  Save changes
                </button>
                <button
                  type="button"
                  className={styles.smallBtnDanger}
                  onClick={() => handleDeletePreset(activePresetId)}
                >
                  Delete
                </button>
              </>
            )}

            <span className={styles.presetDivider} />

            <input
              type="text"
              className={styles.presetInput}
              placeholder="Save as new preset…"
              value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }}
            />
            <button
              type="button"
              className={styles.smallBtn}
              onClick={handleSavePreset}
              disabled={!newPresetName.trim()}
            >
              Save
            </button>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={handleGenerate}
              disabled={!captures || enabledSections.length === 0 || generating || capturing}
            >
              {generating ? 'Generating…' : capturing ? 'Capturing…' : 'Generate PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
