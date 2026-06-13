'use client';

import { rem } from '@/lib/rem';
import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { parseAtBatXlsx } from '@/lib/atbat-parser';
import rs from '@/components/assessment/report-form.module.css';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useTheme } from '@/lib/theme-context';
import styles from './page.module.css';
import { StrengthConditioningForm, emptyScForm } from './StrengthConditioningForm';
import type { SCContent } from './tabs/StrengthConditioningTab';
import {
  type ManualSwingScores, getManualSwingScores,
  type ManualSwingOptions, getManualSwingOptions,
  type ManualBattedBall, getManualBattedBall,
  type ManualSwingMetrics, getManualSwingMetrics,
  MANUAL_BATTED_BALL_FIELDS, MANUAL_SWING_METRIC_FIELDS,
  type PitchingGrades, type PitchingGradeEntry, getPitchingGrades,
  type PitchingGradeItemConfig, type PitchingGradeSectionConfig,
  PITCHING_GRADE_SECTIONS, pitchingGradeKey,
  type DefenseCoachGrades, type DefensePosition,
  DEFENSE_COACH_GRADE_SECTIONS, getDefenseCoachGrades,
  scoreColor,
  getHiddenTabs, setHiddenTabsForPlayer, REPORT_TYPE_TO_TAB,
  normalizePositionsForSave,
} from './helpers';

/* ── Constants ── */

const REPORT_TYPES = [
  // HITTING is the consolidated hitting report — it carries the swing
  // (blast/fullswing) section AND a swing-decision (at-bat) section in a single
  // form. The standalone AT_BAT_RESULTS chip was retired in favor of this.
  // SUMMARY is no longer a chip — it's reachable via the "Edit Profile"
  // button in the modal header. The branch still exists in render/submit.
  { id: 'HITTING', label: 'Hitting', icon: '🏏' },
  { id: 'PITCHING', label: 'Pitching', icon: '⚾' },
  { id: 'STRENGTH', label: 'Physical', icon: '💪' },
  // Defense cluster — Infield · Outfield · Catching grouped at the end
  { id: 'INFIELD', label: 'Infield', icon: '🧤' },
  { id: 'OUTFIELD', label: 'Outfield', icon: '🏃' },
  { id: 'CATCHING', label: 'Catching', icon: '🎯' },
];

const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'Utility'];

/* ─── Eye visibility toggle ────────────────────────────────────────────
   Sits in the Report modal header (left of the close X). Reflects the
   visibility state of the currently-selected report type's matching
   profile tab. Click → toggle hidden/shown. The eye renders open when
   the tab is visible and slashed when it's hidden, mirroring the
   familiar password-field show/hide UX.

   Stored in localStorage via `getHiddenTabs` / `setHiddenTabsForPlayer`
   keyed by playerId, so the toggle persists across modal opens. A
   custom `player:hiddenTabsChanged` event fires on every save so the
   tab bar over in page.tsx re-reads the preference live (no full page
   refresh required). */
function EyeVisibilityToggle({
  playerId, tabKey, tabLabel,
}: {
  playerId: string;
  tabKey: string;
  tabLabel: string;
}) {
  // Local mirror of the persisted state so the icon swap is immediate
  // when the user clicks — page.tsx still re-reads from localStorage
  // via the dispatched event.
  const [isHidden, setIsHidden] = useState<boolean>(() =>
    getHiddenTabs(playerId).includes(tabKey),
  );

  // Re-read whenever the report type changes (the `tabKey` prop swaps).
  // useState's initializer runs only once on mount, so without this the
  // eye would keep showing the previous tab's hidden state after the
  // user clicked a different Report Type chip.
  useEffect(() => {
    setIsHidden(getHiddenTabs(playerId).includes(tabKey));
  }, [playerId, tabKey]);

  // Keep in sync if another EyeVisibilityToggle (e.g. user opens the
  // modal twice in different orders) writes a new value. Listens to the
  // same event the tab bar listens to.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { playerId?: string } | undefined;
      if (!detail || detail.playerId === playerId) {
        setIsHidden(getHiddenTabs(playerId).includes(tabKey));
      }
    };
    window.addEventListener('player:hiddenTabsChanged', handler as EventListener);
    return () => window.removeEventListener('player:hiddenTabsChanged', handler as EventListener);
  }, [playerId, tabKey]);

  function toggle() {
    const current = getHiddenTabs(playerId);
    const next = current.includes(tabKey)
      ? current.filter(k => k !== tabKey)
      : [...current, tabKey];
    setHiddenTabsForPlayer(playerId, next);
    setIsHidden(next.includes(tabKey));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isHidden
        ? `Click to show the ${tabLabel} tab on this player's profile`
        : `Click to hide the ${tabLabel} tab from this player's profile`}
      aria-pressed={isHidden}
      aria-label={isHidden ? `Show ${tabLabel} tab` : `Hide ${tabLabel} tab`}
      style={{
        background: 'var(--border)',
        color: isHidden ? '#fda4af' : '#86efac',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 8px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
      }}
    >
      {isHidden ? <EyeOffIconSvg /> : <EyeIconSvg />}
    </button>
  );
}

function EyeIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIconSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

/* Inline button styles used by the Club Team / College inline "add new" panels. */
const quickBtnPrimary: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: rem(12),
  fontWeight: 700,
  cursor: 'pointer',
};
const quickBtnSecondary: React.CSSProperties = {
  background: 'var(--border)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: rem(12),
  fontWeight: 600,
  cursor: 'pointer',
};

function buildHeightOptions(): string[] {
  const opts: string[] = [];
  for (let ft = 4; ft <= 7; ft++) {
    for (let inc = 0; inc < 12; inc++) {
      if (ft === 7 && inc > 0) break;
      opts.push(`${ft}'${inc}"`);
    }
  }
  return opts;
}
const HEIGHT_OPTIONS = buildHeightOptions();

function heightToInches(h: string): number | null {
  const m = h.match(/^(\d+)'(\d+)"$/);
  if (!m) return null;
  return parseInt(m[1]) * 12 + parseInt(m[2]);
}

interface CsvSlot { key: string; label: string; subtitle: string; vendor: string; group?: 'swing' | 'decision'; }

const REPORT_CSV_SLOTS: Record<string, CsvSlot[]> = {
  // The HITTING report now bundles both swing and swing-decision data. The
  // `group` tag drives which subsection a slot renders in (swing / decision).
  HITTING: [
    { key: 'blast',     label: 'Swing Metrics',         subtitle: 'Blast Motion CSV',         vendor: 'Blast Motion', group: 'swing' },
    { key: 'fullswing', label: 'Batted Ball Metrics',   subtitle: 'Full Swing CSV',           vendor: 'Full Swing',   group: 'swing' },
    { key: 'hittrax',   label: 'Batted Ball — HitTrax', subtitle: 'HitTrax CSV',              vendor: 'HitTrax',      group: 'swing' },
    { key: 'atbat',     label: 'At-Bat Assessment',     subtitle: 'At-Bat Assessment XLSX',   vendor: 'AtBat',        group: 'decision' },
    /* `atbat_fullswing` + `atbat_hittrax` CSV slots retired in
       Phase 6 — at-bat batted-ball data is now captured live via
       the /live tools (Live Session → LIVE mode). The
       `atbat_fullswing` slot specifically used to drive the Swing
       Decision spray chart + Results bubble; that data now flows
       in through the LiveSessions `AtBat` / `Pitch` rows and is
       surfaced by the Hitting tab's new Live At-Bats section.
       The Swing-tab `fullswing` + `hittrax` slots above are kept
       — they continue to feed the assessment-side Spray Chart on
       the Swing sub-tab. */
  ],
  PITCHING: [{ key: 'trackman', label: 'Pitch Data', subtitle: 'TrackMan CSV', vendor: 'TrackMan' }],
  /* INFIELD uses a dedicated form — no CSV slots */
  /* OUTFIELD uses a dedicated form — no CSV slots */
  /* CATCHING uses a dedicated form — no CSV slots */
  STRENGTH: [{ key: 'vald', label: 'Strength & Conditioning', subtitle: 'VALD CSV', vendor: 'VALD' }],
  COGNITION: [
    { key: 'atbat', label: 'At-Bat Assessment', subtitle: 'At-Bat Assessment XLSX', vendor: 'AtBat' },
    { key: 'fullswing', label: 'Full Swing Data', subtitle: 'Full Swing CSV', vendor: 'Full Swing' },
    { key: 'vizual', label: 'Cognition Testing', subtitle: 'Vizual Edge CSV', vendor: 'Vizual Edge' },
  ],
};

/* ── Sub-components ── */

interface UploadResult { status: 'success' | 'error' | 'processing'; message: string; rows?: number; metrics?: number; }

/** Shape of a previously-saved CSV upload, persisted into a report's
 *  content.csvUploads[slotKey] entry. We surface it in edit mode so the coach
 *  sees what's already attached and can remove or replace it. */
interface ExistingUpload { vendor: string; rows?: number; metrics?: number; uploadId?: string; atBats?: number; playerName?: string; error?: string; }

function CsvUploadCard({
  slot, file, uploadResult, existingUpload, onSelect, onRemove, onRemoveExisting,
  manualMode, onToggleManual, manualNode,
}: {
  slot: CsvSlot; file: File | null; uploadResult: UploadResult | null;
  existingUpload?: ExistingUpload | null;
  onSelect: (f: File) => void; onRemove: () => void;
  onRemoveExisting?: () => void;
  /** When true, the card renders manualNode in place of the drop zone. */
  manualMode?: boolean;
  onToggleManual?: () => void;
  manualNode?: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showExisting = !file && !!existingUpload && !manualMode;
  const supportsManual = !!onToggleManual;
  return (
    <div className={rs.csvCard}>
      <div className={rs.csvCardHeader}>
        <div>
          <div className={rs.csvCardTitle}>{slot.label}</div>
          <div className={rs.csvCardSub}>{slot.subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {supportsManual && (
            <button
              type="button"
              onClick={onToggleManual}
              title={manualMode ? 'Switch back to CSV upload' : 'Type values in manually instead of uploading a CSV'}
              style={{
                padding: '4px 10px',
                fontSize: rem(11),
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                borderRadius: 6,
                border: `1px solid ${manualMode ? 'var(--accent)' : 'var(--border-light)'}`,
                background: manualMode
                  ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
                  : 'transparent',
                color: manualMode ? 'var(--accent-light)' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {manualMode ? '✓ Manual' : 'Manual Entry'}
            </button>
          )}
          <span className={rs.csvVendorBadge}>{slot.vendor}</span>
        </div>
      </div>
      {manualMode ? (
        <div style={{ marginTop: 8 }}>{manualNode}</div>
      ) : file ? (
        <div className={rs.fileInfo}>
          <div className={rs.fileName}>
            <span className={rs.fileIcon}>✅</span>{file.name}
            <span className={rs.fileSize}>({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
          <button type="button" className={rs.removeBtn} onClick={onRemove}>Remove</button>
          {uploadResult && (
            <div className={`${rs.uploadResult} ${uploadResult.status === 'success' ? rs.uploadSuccess : uploadResult.status === 'error' ? rs.uploadError : ''}`}>
              {uploadResult.message}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Saved upload row (edit mode) — shows above the drop zone so the
              coach can see what's already attached, remove it, or upload a
              fresh file (which replaces the saved entry on save). */}
          {showExisting && (
            <div className={rs.fileInfo} style={{ marginBottom: 8 }}>
              <div className={rs.fileName}>
                <span className={rs.fileIcon}>📎</span>
                {existingUpload!.vendor} CSV
                <span className={rs.fileSize}>
                  {existingUpload!.atBats != null
                    ? `(${existingUpload!.atBats} at-bats)`
                    : existingUpload!.rows != null
                      ? `(${existingUpload!.rows} rows · ${existingUpload!.metrics ?? 0} metrics)`
                      : '(saved)'}
                </span>
              </div>
              <button type="button" className={rs.removeBtn} onClick={() => onRemoveExisting?.()}>Remove</button>
            </div>
          )}
          {/* Drop zone — always visible, even when a saved CSV is already on
              file. Selecting/dropping a new file replaces the saved entry on
              save (since each slot holds a single CSV). */}
          <div className={rs.dropZone} onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f && /\.(csv|xlsx?)$/i.test(f.name)) { if (showExisting) onRemoveExisting?.(); onSelect(f); }
            }}
            onClick={() => inputRef.current?.click()}>
            <span className={rs.dropIcon}>📄</span>
            <span className={rs.dropText}>
              {showExisting ? 'Drop CSV to replace, or click to browse' : 'Drop CSV here or click to browse'}
            </span>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) { if (showExisting) onRemoveExisting?.(); onSelect(f); }
                e.target.value = '';
              }} />
          </div>
        </>
      )}
    </div>
  );
}

/* Bubble-styled manual-entry inputs for a single slot (Blast / Full Swing). */
function ManualMetricBubbles<T extends Record<string, number | null>>({
  fields, values, onChange,
}: {
  fields: { key: keyof T; label: string; unit: string; step?: number }[];
  values: T;
  onChange: (key: keyof T, raw: string) => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
      gap: 8,
    }}>
      {fields.map(f => (
        <div key={String(f.key)} style={{
          ...reportInnerBubbleStyle,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <span style={{
            fontSize: rem(10), fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>{f.label}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <input
              type="number"
              step={f.step ?? 0.1}
              placeholder="—"
              value={values[f.key] == null ? '' : String(values[f.key])}
              onChange={e => onChange(f.key, e.target.value)}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-bright)',
                fontSize: rem(18),
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
                outline: 'none',
                padding: 0,
                minWidth: 0,
              }}
            />
            {f.unit && (
              <span style={{
                fontFamily: "'DM Mono', ui-monospace, monospace",
                fontSize: rem(10), fontWeight: 600,
                color: 'var(--text-muted)',
                letterSpacing: '0.06em',
              }}>{f.unit}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Pending video upload entry staged in the Report modal.
 * • `bundleId` is set when the user drops the file into the
 *   right-side "Bundle" drop zone — all files dropped together
 *   share the same bundleId so the upload pass can tag them with a
 *   common Training-style title prefix and bundle-detection
 *   downstream groups them as a single multi-angle clip.
 * • `bundleId` is undefined for files dropped into the standard
 *   left-side "Single" zone; those upload as independent clips.
 */
interface VideoEntry { id: string; file: File; bundleId?: string; }
/** A video that's already been uploaded and attached to the report (edit
 *  mode). Remove it to drop the link from this report on save.
 *  `section` tags which subsection of a HITTING report the video belongs to —
 *  legacy entries without the field default to the swing subsection. */
interface ExistingVideo { id?: string; name: string; size: number; url?: string; section?: 'swing' | 'decision'; }

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VideoSection({ videos, setVideos, existingVideos, setExistingVideos, relatedVideos }: {
  videos: VideoEntry[]; setVideos: (v: VideoEntry[]) => void;
  existingVideos?: ExistingVideo[]; setExistingVideos?: (v: ExistingVideo[]) => void;
  /* Read-only clips tied to this report by category (Coach Reviews, in-app
     recordings, uploads) — shown for parity with the profile report sections.
     Display-only: never edited or folded into the saved videoIds. */
  relatedVideos?: ExistingVideo[];
}) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const singleInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  /* "Single" drop — each file becomes its own independent video.
     bundleId stays undefined so the upload pass titles them with
     just the filename and they surface as singleton tiles. */
  const handleSingleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setVideos([
      ...videos,
      ...Array.from(files).map(f => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
      })),
    ]);
  };

  /* "Bundle" drop — every file in this drop event shares ONE
     bundleId so they upload with a common Training-style title
     prefix and bundle-detection downstream groups them as a
     single multi-angle clip. Each subsequent drop creates a new
     bundleId (separate bundle). */
  const handleBundleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const bundleId = `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setVideos([
      ...videos,
      ...Array.from(files).map(f => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        bundleId,
      })),
    ]);
  };

  const existing = existingVideos ?? [];
  const related = relatedVideos ?? [];
  const totalCount = existing.length + videos.length + related.length;

  /* Group pending bundle videos by bundleId so each bundle renders
     as one chip with its file list nested inside, matching the
     intent that bundle uploads are visually one unit even before
     they hit the server. */
  const singleVideos = videos.filter(v => !v.bundleId);
  const bundleGroups = (() => {
    const map = new Map<string, VideoEntry[]>();
    for (const v of videos) {
      if (!v.bundleId) continue;
      const arr = map.get(v.bundleId) ?? [];
      arr.push(v);
      map.set(v.bundleId, arr);
    }
    return Array.from(map.entries()); // [bundleId, files[]]
  })();

  return (
    <div
      className={rs.section}
      /* Light theme — wrap the Video section in the same slate
         outer-bubble chrome the Pitching delivery sections + the
         "Pitch Data" CSV card wear, so the Video block reads as a
         sibling bubble of the rest of the report. Dark theme keeps
         the bare flex column (no extra chrome). */
      style={isLight ? {
        background: 'var(--panel-bg-light)',
        border: '1px solid rgba(0, 0, 0, 0.10)',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 6px 18px rgba(15, 20, 30, 0.08)',
      } : undefined}
    >
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>🎬</span>
        <span className={rs.sectionTitle}>Videos</span>
        {totalCount > 0 && (
          <span className={rs.sectionCount}>
            {totalCount} {totalCount === 1 ? 'file' : 'files'}
          </span>
        )}
      </div>

      {/* Pending file list — single videos + bundle groups */}
      {(existing.length > 0 || related.length > 0 || singleVideos.length > 0 || bundleGroups.length > 0) && (
        <div className={rs.videoList}>
          {existing.map((v, i) => (
            <div key={v.id || `existing-${i}`} className={rs.videoItem}>
              <span className={rs.videoFileIcon}>📎</span>
              <div className={rs.videoFileInfo}>
                <div className={rs.videoFileName}>{v.name}</div>
                <div className={rs.videoFileMeta}>{formatFileSize(v.size)} · saved</div>
              </div>
              <button type="button" className={rs.videoRemove}
                onClick={() => setExistingVideos?.(existing.filter((_, idx) => idx !== i))}>x</button>
            </div>
          ))}
          {/* Read-only "related" clips — videos tied to this report by category
              (Coach Reviews, in-app recordings, uploads), matching what the
              profile report sections show. No remove control; not saved here. */}
          {related.map((v, i) => (
            <div key={v.id || `related-${i}`} className={rs.videoItem} style={{ opacity: 0.9 }}>
              <span className={rs.videoFileIcon}>🎬</span>
              <div className={rs.videoFileInfo}>
                <div className={rs.videoFileName}>{v.name}</div>
                <div className={rs.videoFileMeta}>In this report · view only</div>
              </div>
            </div>
          ))}
          {singleVideos.map(v => (
            <div key={v.id} className={rs.videoItem}>
              <span className={rs.videoFileIcon}>🎥</span>
              <div className={rs.videoFileInfo}>
                <div className={rs.videoFileName}>{v.file.name}</div>
                <div className={rs.videoFileMeta}>{formatFileSize(v.file.size)}</div>
              </div>
              <button type="button" className={rs.videoRemove}
                onClick={() => setVideos(videos.filter(x => x.id !== v.id))}>x</button>
            </div>
          ))}
          {/* Bundle groups — render the bundle's files indented under
              a bundle header so the user sees the grouping at a glance. */}
          {bundleGroups.map(([bundleId, entries], gi) => (
            <div
              key={bundleId}
              style={{
                border: '1px dashed rgba(96,165,250,0.45)',
                borderRadius: 8,
                padding: 8,
                background: 'rgba(96,165,250,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: rem(10), fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#60A5FA',
              }}>
                <span>📚 Bundle {gi + 1} — {entries.length} angle{entries.length === 1 ? '' : 's'}</span>
                <button
                  type="button"
                  onClick={() => setVideos(videos.filter(x => x.bundleId !== bundleId))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#60A5FA',
                    cursor: 'pointer',
                    fontSize: rem(12),
                  }}
                  aria-label="Remove bundle"
                >
                  remove bundle
                </button>
              </div>
              {entries.map((v, i) => (
                <div key={v.id} className={rs.videoItem} style={{ marginLeft: 0 }}>
                  <span className={rs.videoFileIcon}>🎥</span>
                  <div className={rs.videoFileInfo}>
                    <div className={rs.videoFileName}>{v.file.name}</div>
                    <div className={rs.videoFileMeta}>
                      Angle {i + 1} · {formatFileSize(v.file.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={rs.videoRemove}
                    onClick={() => setVideos(videos.filter(x => x.id !== v.id))}
                  >x</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* TWO drop zones, side by side — left for single videos,
          right for multi-angle bundles. Each drop event in the
          bundle zone creates one bundle group; the left zone
          uploads files as independent clips. */}
      <div style={{ display: 'flex', gap: 10 }}>
        <div
          className={rs.videoDropZone}
          style={{ flex: 1 }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleSingleFiles(e.dataTransfer.files); }}
          onClick={() => singleInputRef.current?.click()}
        >
          <span className={rs.dropIcon}>🎬</span>
          <span className={rs.dropText}>Single videos</span>
          <span className={rs.videoFormats}>Drop files to upload as individual clips</span>
          <input
            ref={singleInputRef}
            type="file"
            accept="video/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleSingleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>

        <div
          className={rs.videoDropZone}
          style={{
            flex: 1,
            borderStyle: 'dashed',
            borderColor: 'rgba(96,165,250,0.55)',
            background: 'rgba(96,165,250,0.04)',
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleBundleFiles(e.dataTransfer.files); }}
          onClick={() => bundleInputRef.current?.click()}
        >
          <span className={rs.dropIcon}>📚</span>
          <span className={rs.dropText}>Multi-angle bundle</span>
          <span className={rs.videoFormats}>Drop together — uploads as one bundled clip</span>
          <input
            ref={bundleInputRef}
            type="file"
            accept="video/*"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleBundleFiles(e.target.files); e.target.value = ''; }}
          />
        </div>
      </div>
    </div>
  );
}

interface SummaryData {
  firstName: string; lastName: string; positions: string[]; bats: string; throws: string;
  height: string; weight: string; gradYear: string; birthDate: string; highSchool: string;
  clubTeam: string; pbrNational: string; pbrState: string; pbrPosition: string; pgScore: string;
  collegeCommit: string; logoFile: File | null;
  playingLevelGoal: string; goals: string;
}

function SummaryForm({ data, setData }: { data: SummaryData; setData: (d: SummaryData) => void }) {
  const logoInputRef = useRef<HTMLInputElement>(null);
  const update = (fields: Partial<SummaryData>) => setData({ ...data, ...fields });
  const togglePosition = (pos: string) => {
    const next = data.positions.includes(pos) ? data.positions.filter(p => p !== pos) : [...data.positions, pos];
    update({ positions: next });
  };

  // Club Teams + Colleges sourced from the coach Settings page.
  const [clubTeams, setClubTeams] = useState<api.ClubTeam[]>([]);
  const [colleges, setColleges] = useState<api.College[]>([]);
  const [clubSaving, setClubSaving] = useState(false);
  const [collegeSaving, setCollegeSaving] = useState(false);
  const [clubDraft, setClubDraft] = useState<{ name: string; logoUrl: string; websiteUrl: string } | null>(null);
  const [collegeDraft, setCollegeDraft] = useState<{ name: string; logoUrl: string; websiteUrl: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [ct, co] = await Promise.all([api.getClubTeams(), api.getColleges()]);
        setClubTeams(ct);
        setColleges(co);
      } catch {
        /* list is non-critical — form still works with the current text value */
      }
    })();
  }, []);

  const SELECT_ADD_NEW = '__add_new__';

  async function createClub() {
    if (!clubDraft || !clubDraft.name.trim()) return;
    setClubSaving(true);
    try {
      const created = await api.createClubTeam({
        name: clubDraft.name.trim(),
        logoUrl: clubDraft.logoUrl.trim() || null,
        websiteUrl: clubDraft.websiteUrl.trim() || null,
      });
      setClubTeams((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      update({ clubTeam: created.name });
      setClubDraft(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to add club team');
    } finally {
      setClubSaving(false);
    }
  }

  async function createCollege() {
    if (!collegeDraft || !collegeDraft.name.trim()) return;
    setCollegeSaving(true);
    try {
      const created = await api.createCollege({
        name: collegeDraft.name.trim(),
        logoUrl: collegeDraft.logoUrl.trim() || null,
        websiteUrl: collegeDraft.websiteUrl.trim() || null,
      });
      setColleges((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      update({ collegeCommit: created.name });
      setCollegeDraft(null);
    } catch (e: any) {
      alert(e?.message || 'Failed to add college');
    } finally {
      setCollegeSaving(false);
    }
  }

  return (
    <div className={rs.summaryForm}>
      <div className={rs.section}>
        <div className={rs.sectionHeader}><span className={rs.sectionIcon}>👤</span><span className={rs.sectionTitle}>Player Information</span></div>
        <div className={rs.summaryGrid}>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>First Name</label>
            <input type="text" className={rs.summaryInput} value={data.firstName} onChange={e => update({ firstName: e.target.value })} placeholder="First name" />
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Last Name</label>
            <input type="text" className={rs.summaryInput} value={data.lastName} onChange={e => update({ lastName: e.target.value })} placeholder="Last name" />
          </div>
        </div>
        <div className={rs.summaryField}>
          <label className={rs.summaryLabel}>Position(s)</label>
          <div className={rs.posChipRow}>
            {/* Render chips for the union of the local POSITIONS set
                AND any positions already stored on the player. This
                surfaces legacy umbrella codes (INF / OF / UTIL) that
                the New Player form writes but this picker's local
                POSITIONS list doesn't include — otherwise they'd stay
                in the stored value invisibly and pollute the PDF cover
                (e.g. a player saved as "OF" via the New Player form
                + "SS,2B,3B" added here would silently render "INF · OF"
                on the cover). Active legacy chips can be clicked off
                here just like any other position. */}
            {Array.from(new Set([...POSITIONS, ...data.positions])).map(pos => (
              <button key={pos} type="button" className={`${rs.posChip} ${data.positions.includes(pos) ? rs.posChipActive : ''}`}
                onClick={() => togglePosition(pos)}>{pos}</button>
            ))}
          </div>
        </div>
        <div className={rs.summaryGrid}>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Bats</label>
            <select className={rs.summarySelect} value={data.bats} onChange={e => update({ bats: e.target.value })}>
              <option value="">Select...</option><option value="R">R</option><option value="L">L</option><option value="S">S</option>
            </select>
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Throws</label>
            <select className={rs.summarySelect} value={data.throws} onChange={e => update({ throws: e.target.value })}>
              <option value="">Select...</option><option value="R">R</option><option value="L">L</option>
            </select>
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Height</label>
            <select className={rs.summarySelect} value={data.height} onChange={e => update({ height: e.target.value })}>
              <option value="">Select...</option>
              {HEIGHT_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Weight (lbs)</label>
            <input type="number" className={rs.summaryInput} value={data.weight} onChange={e => update({ weight: e.target.value })} placeholder="185" />
          </div>
        </div>
        <div className={rs.summaryGrid}>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Grad Year</label>
            <select className={rs.summarySelect} value={data.gradYear} onChange={e => update({ gradYear: e.target.value })}>
              <option value="">Select...</option>
              {Array.from({ length: 15 }, (_, i) => 2026 + i).map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Birthday</label>
            <input type="date" className={rs.summaryInput} value={data.birthDate} onChange={e => update({ birthDate: e.target.value })} />
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>High School</label>
            <input type="text" className={rs.summaryInput} value={data.highSchool} onChange={e => update({ highSchool: e.target.value })} placeholder="High school name" />
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Club Team</label>
            <select
              className={rs.summarySelect}
              value={data.clubTeam && clubTeams.some(c => c.name === data.clubTeam) ? data.clubTeam : (data.clubTeam ? '' : '')}
              onChange={(e) => {
                if (e.target.value === SELECT_ADD_NEW) {
                  setClubDraft({ name: '', logoUrl: '', websiteUrl: '' });
                } else {
                  update({ clubTeam: e.target.value });
                }
              }}
            >
              <option value="">None</option>
              {clubTeams.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
              <option value={SELECT_ADD_NEW}>+ Add new club team…</option>
            </select>
            {data.clubTeam && !clubTeams.some(c => c.name === data.clubTeam) && (
              <div style={{ fontSize: rem(11), color: 'var(--muted)', marginTop: 4 }}>
                Legacy value "{data.clubTeam}" — pick from the list to normalize.
              </div>
            )}
            {clubDraft && (
              <div
                style={{
                  marginTop: 8, padding: 10,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  display: 'grid', gap: 6,
                }}
              >
                <input
                  className={rs.summaryInput}
                  placeholder="Club team name"
                  value={clubDraft.name}
                  onChange={(e) => setClubDraft({ ...clubDraft, name: e.target.value })}
                  autoFocus
                />
                <input
                  className={rs.summaryInput}
                  placeholder="Logo URL (optional)"
                  value={clubDraft.logoUrl}
                  onChange={(e) => setClubDraft({ ...clubDraft, logoUrl: e.target.value })}
                />
                <input
                  className={rs.summaryInput}
                  placeholder="Website URL (optional)"
                  value={clubDraft.websiteUrl}
                  onChange={(e) => setClubDraft({ ...clubDraft, websiteUrl: e.target.value })}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setClubDraft(null)} disabled={clubSaving} style={quickBtnSecondary}>Cancel</button>
                  <button type="button" onClick={createClub} disabled={clubSaving || !clubDraft.name.trim()} style={quickBtnPrimary}>
                    {clubSaving ? 'Saving…' : 'Add Team'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={rs.section}>
        <div className={rs.sectionHeader}><span className={rs.sectionIcon}>🎯</span><span className={rs.sectionTitle}>Goals & Aspirations</span></div>
        <div className={rs.summaryGrid}>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Playing Level Goal</label>
            <select className={rs.summarySelect} value={data.playingLevelGoal} onChange={e => update({ playingLevelGoal: e.target.value })}>
              <option value="">Select...</option>
              {['High School', 'College', 'D3', 'D2', 'D1', 'Professional'].map(lv => <option key={lv} value={lv}>{lv}</option>)}
            </select>
          </div>
        </div>
        <div className={rs.summaryField}>
          <label className={rs.summaryLabel}>Goals</label>
          <textarea
            className={rs.summaryInput}
            value={data.goals}
            onChange={e => update({ goals: e.target.value })}
            placeholder="Your personal goals…"
            rows={4}
            style={{ resize: 'vertical', minHeight: 80 }}
          />
        </div>
      </div>

      <div className={rs.section}>
        <div className={rs.sectionHeader}><span className={rs.sectionIcon}>🏆</span><span className={rs.sectionTitle}>Rankings & Scores</span></div>
        <div className={rs.summaryGrid}>
          <div className={rs.summaryField}><label className={rs.summaryLabel}>PBR National</label><input type="text" className={rs.summaryInput} value={data.pbrNational} onChange={e => update({ pbrNational: e.target.value })} placeholder="National ranking" /></div>
          <div className={rs.summaryField}><label className={rs.summaryLabel}>PBR State</label><input type="text" className={rs.summaryInput} value={data.pbrState} onChange={e => update({ pbrState: e.target.value })} placeholder="State ranking" /></div>
          <div className={rs.summaryField}><label className={rs.summaryLabel}>PBR Position</label><input type="text" className={rs.summaryInput} value={data.pbrPosition} onChange={e => update({ pbrPosition: e.target.value })} placeholder="Position ranking" /></div>
          <div className={rs.summaryField}><label className={rs.summaryLabel}>PG Score</label><input type="text" className={rs.summaryInput} value={data.pgScore} onChange={e => update({ pgScore: e.target.value })} placeholder="Perfect Game score" /></div>
        </div>
      </div>

      <div className={rs.section}>
        <div className={rs.sectionHeader}><span className={rs.sectionIcon}>🎓</span><span className={rs.sectionTitle}>College Commitment</span></div>
        <div className={rs.summaryGrid}>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>Committed To</label>
            <select
              className={rs.summarySelect}
              value={data.collegeCommit && colleges.some(c => c.name === data.collegeCommit) ? data.collegeCommit : (data.collegeCommit ? '' : '')}
              onChange={(e) => {
                if (e.target.value === SELECT_ADD_NEW) {
                  setCollegeDraft({ name: '', logoUrl: '', websiteUrl: '' });
                } else {
                  update({ collegeCommit: e.target.value });
                }
              }}
            >
              <option value="">Uncommitted</option>
              {colleges.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
              <option value={SELECT_ADD_NEW}>+ Add new college…</option>
            </select>
            {data.collegeCommit && !colleges.some(c => c.name === data.collegeCommit) && (
              <div style={{ fontSize: rem(11), color: 'var(--muted)', marginTop: 4 }}>
                Legacy value "{data.collegeCommit}" — pick from the list to normalize.
              </div>
            )}
            {collegeDraft && (
              <div
                style={{
                  marginTop: 8, padding: 10,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  display: 'grid', gap: 6,
                }}
              >
                <input
                  className={rs.summaryInput}
                  placeholder="College name"
                  value={collegeDraft.name}
                  onChange={(e) => setCollegeDraft({ ...collegeDraft, name: e.target.value })}
                  autoFocus
                />
                <input
                  className={rs.summaryInput}
                  placeholder="Logo URL (optional)"
                  value={collegeDraft.logoUrl}
                  onChange={(e) => setCollegeDraft({ ...collegeDraft, logoUrl: e.target.value })}
                />
                <input
                  className={rs.summaryInput}
                  placeholder="Website URL (optional)"
                  value={collegeDraft.websiteUrl}
                  onChange={(e) => setCollegeDraft({ ...collegeDraft, websiteUrl: e.target.value })}
                />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setCollegeDraft(null)} disabled={collegeSaving} style={quickBtnSecondary}>Cancel</button>
                  <button type="button" onClick={createCollege} disabled={collegeSaving || !collegeDraft.name.trim()} style={quickBtnPrimary}>
                    {collegeSaving ? 'Saving…' : 'Add College'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className={rs.summaryField}>
            <label className={rs.summaryLabel}>One-off Logo (optional)</label>
            <div className={rs.logoUpload} onClick={() => logoInputRef.current?.click()}>
              {data.logoFile ? (
                <div className={rs.logoFileInfo}><span>🖼️</span><span className={rs.logoFileName}>{data.logoFile.name}</span>
                  <button type="button" className={rs.removeBtn} onClick={e => { e.stopPropagation(); update({ logoFile: null }); }}>Remove</button></div>
              ) : (<span className={rs.logoPlaceholder}>Click to upload logo</span>)}
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) update({ logoFile: f }); e.target.value = ''; }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Catching Assessment Form ── */

interface ThrowingRow {
  attempts: string[];  // 8 string values
  notes: string;
}

interface GradeRow {
  grade: string;
  notes: string;
}

/** Strike-zone cell color: 0=red (bad), 1=white (avg), 2=green (good).
 *  9 cells fill the inner strike zone (top-to-bottom, left-to-right);
 *  16 cells fill the border ring around it (top row, bottom row,
 *  then left column rows 1-3, then right column rows 1-3). */
type ZoneVal = 0 | 1 | 2;

interface CatchingFormData {
  throwing: {
    popTime2B: ThrowingRow;
    exchangeTime: ThrowingRow;
    velocity: ThrowingRow;
    /* Shuffle velocity (mph) — speed generated through the catcher's
       shuffle/exchange before the throw. Measured like `velocity`
       (averaged attempts). */
    shuffleVelocity: ThrowingRow;
    /* Coach-graded throwing sub-skills — render in the dashboard's
     * Underlying Stats → Throwing row alongside Pop Time / Exchange /
     * Arm Strength. Coaches enter 20-80 here.
     *
     * The original three (footwork / transfer / accuracy) were
     * extended with the four delivery-mechanics checkpoints that
     * used to live in the standalone Coach Grades section beneath
     * the catching report: armPath / footStrike / rotationSeq /
     * decel. Keys match `DEFENSE_COACH_GRADE_SECTIONS` so the
     * vocabulary stays consistent across position reports. */
    footwork: GradeRow;
    transfer: GradeRow;
    accuracy: GradeRow;
    armPath: GradeRow;
    footStrike: GradeRow;
    rotationSeq: GradeRow;
    decel: GradeRow;
    overallGrade: string;
  };
  receiving: {
    /** Click-to-shade per-zone quality — drives the dashboard's strike-zone
     *  heat map. 9 inner cells + 16 border cells (5x5 grid total). */
    zoneColors: ZoneVal[];        // length 9
    borderZoneColors: ZoneVal[];  // length 16
    quietHands: GradeRow;
    stanceSetup: GradeRow;
    /* Coaches Grade — six receiving sub-skills rendered next to the
     * strike-zone heat map in the dashboard's Catching Snapshot. Coaches
     * type 20-80 grades here; the snapshot reads them straight off
     * `receiving.<key>.grade`. */
    load: GradeRow;
    path: GradeRow;
    accuracy: GradeRow;
    turn: GradeRow;
    presentation: GradeRow;
    timing: GradeRow;
    overallGrade: string;
  };
  blocking: {
    /** Positional blocking range grades — replaces the single "range" entry
     *  with Block Left / Block Center / Block Right (mirrors the dashboard's
     *  positional blocking annotations). */
    blockLeft: GradeRow;
    blockCenter: GradeRow;
    blockRight: GradeRow;
    accuracy: GradeRow;
    gloveBodyAngle: GradeRow;
    recoverySpeed: GradeRow;
    overallGrade: string;
  };
}

const EMPTY_THROWING_ROW: ThrowingRow = { attempts: ['','','','','','','',''], notes: '' };
const EMPTY_GRADE_ROW: GradeRow = { grade: '', notes: '' };

function emptyCatchingForm(): CatchingFormData {
  return {
    throwing: {
      popTime2B: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      exchangeTime: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      velocity: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      shuffleVelocity: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      footwork: { ...EMPTY_GRADE_ROW },
      transfer: { ...EMPTY_GRADE_ROW },
      accuracy: { ...EMPTY_GRADE_ROW },
      armPath: { ...EMPTY_GRADE_ROW },
      footStrike: { ...EMPTY_GRADE_ROW },
      rotationSeq: { ...EMPTY_GRADE_ROW },
      decel: { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
    receiving: {
      // Default every zone cell to "average" (1) so the grid renders
      // legibly before the coach has shaded any cell.
      zoneColors: Array(9).fill(1) as ZoneVal[],
      borderZoneColors: Array(16).fill(1) as ZoneVal[],
      quietHands: { ...EMPTY_GRADE_ROW },
      stanceSetup: { ...EMPTY_GRADE_ROW },
      load:         { ...EMPTY_GRADE_ROW },
      path:         { ...EMPTY_GRADE_ROW },
      accuracy:     { ...EMPTY_GRADE_ROW },
      turn:         { ...EMPTY_GRADE_ROW },
      presentation: { ...EMPTY_GRADE_ROW },
      timing:       { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
    blocking: {
      blockLeft: { ...EMPTY_GRADE_ROW },
      blockCenter: { ...EMPTY_GRADE_ROW },
      blockRight: { ...EMPTY_GRADE_ROW },
      accuracy: { ...EMPTY_GRADE_ROW },
      gloveBodyAngle: { ...EMPTY_GRADE_ROW },
      recoverySpeed: { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
  };
}

function buildCatchingContent(data: CatchingFormData) {
  const parseAttempts = (row: ThrowingRow) => {
    const nums = row.attempts.map(a => { const n = parseFloat(a); return isNaN(n) ? null : n; });
    const valid = nums.filter((n): n is number => n !== null);
    return {
      attempts: nums,
      best: valid.length > 0 ? Math.min(...valid) : null,
      avg: valid.length > 0 ? +(valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(2) : null,
      notes: row.notes,
    };
  };
  const parseVeloAttempts = (row: ThrowingRow) => {
    const nums = row.attempts.map(a => { const n = parseFloat(a); return isNaN(n) ? null : n; });
    const valid = nums.filter((n): n is number => n !== null);
    return {
      attempts: nums,
      best: valid.length > 0 ? Math.max(...valid) : null,  // higher velo is better
      avg: valid.length > 0 ? +(valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(1) : null,
      notes: row.notes,
    };
  };
  const parseGrade = (row: GradeRow) => ({
    grade: row.grade ? parseInt(row.grade) || null : null,
    notes: row.notes,
  });
  /* Compute the section "Overall" grade as the integer average of
     a set of sub-skill grades. Returns null when no sub-skill in
     the set carries a value (the dashboard will render "—" in
     that case rather than a stale stored overall). The manual
     `data.X.overallGrade` field is ignored on save — overall is
     now a pure derivation of the underlying coach grades, matching
     what the modal renders in the AVG read-only slider. */
  const averageOf = (values: (number | null)[]): number | null => {
    const valid = values.filter((v): v is number => v != null);
    if (valid.length === 0) return null;
    return Math.max(20, Math.min(80, Math.round(valid.reduce((s, v) => s + v, 0) / valid.length)));
  };
  const throwing = {
    popTime2B: parseAttempts(data.throwing.popTime2B),
    exchangeTime: parseAttempts(data.throwing.exchangeTime),
    velocity: parseVeloAttempts(data.throwing.velocity),
    shuffleVelocity: parseVeloAttempts(data.throwing.shuffleVelocity),
    // Coach grades — drive the dashboard's Throwing Underlying Stats row.
    footwork: parseGrade(data.throwing.footwork),
    transfer: parseGrade(data.throwing.transfer),
    accuracy: parseGrade(data.throwing.accuracy),
    armPath: parseGrade(data.throwing.armPath),
    footStrike: parseGrade(data.throwing.footStrike),
    rotationSeq: parseGrade(data.throwing.rotationSeq),
    decel: parseGrade(data.throwing.decel),
    overallGrade: null as number | null,
  };
  throwing.overallGrade = averageOf([
    throwing.footwork.grade,
    throwing.transfer.grade,
    throwing.accuracy.grade,
    throwing.armPath.grade,
    throwing.footStrike.grade,
    throwing.rotationSeq.grade,
    throwing.decel.grade,
  ]);
  const receiving = {
    // Strike-zone shading drives the dashboard's heat map. The 9 inner
    // cells map to the strike zone; the 16 border cells map to balls
    // around the zone.
    zoneColors: data.receiving.zoneColors,
    borderZoneColors: data.receiving.borderZoneColors,
    quietHands: parseGrade(data.receiving.quietHands),
    stanceSetup: parseGrade(data.receiving.stanceSetup),
    // Six Coaches Grade sub-skills — drive the side panel next to the
    // strike-zone heat map on the dashboard.
    load:         parseGrade(data.receiving.load),
    path:         parseGrade(data.receiving.path),
    accuracy:     parseGrade(data.receiving.accuracy),
    turn:         parseGrade(data.receiving.turn),
    presentation: parseGrade(data.receiving.presentation),
    timing:       parseGrade(data.receiving.timing),
    overallGrade: null as number | null,
  };
  /* Receiving overall = average of the six core sub-skills shown
     on the dashboard's side panel (Load / Path / Accuracy / Turn /
     Presentation / Timing). The two legacy umbrella grades
     (Quiet Hands, Stance & Setup) are intentionally excluded so
     the saved overall matches the AVG slider in the modal. */
  receiving.overallGrade = averageOf([
    receiving.path.grade,
    receiving.accuracy.grade,
    receiving.turn.grade,
    receiving.presentation.grade,
    receiving.timing.grade,
  ]);
  // Positional blocking grades — Block Left / Center / Right replace the
  // single "range" entry. Other blocking skills (accuracy / glove-body
  // angle / recovery speed) stay as-is.
  const blocking = {
    blockLeft: parseGrade(data.blocking.blockLeft),
    blockCenter: parseGrade(data.blocking.blockCenter),
    blockRight: parseGrade(data.blocking.blockRight),
    accuracy: parseGrade(data.blocking.accuracy),
    gloveBodyAngle: parseGrade(data.blocking.gloveBodyAngle),
    recoverySpeed: parseGrade(data.blocking.recoverySpeed),
    overallGrade: null as number | null,
  };
  blocking.overallGrade = averageOf([
    blocking.blockLeft.grade,
    blocking.blockCenter.grade,
    blocking.blockRight.grade,
    blocking.accuracy.grade,
    blocking.gloveBodyAngle.grade,
    blocking.recoverySpeed.grade,
  ]);
  return { throwing, receiving, blocking };
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: rem(13), fontFamily: "'DM Mono', monospace",
  background: 'var(--surface2, rgba(255,255,255,0.06))', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', textAlign: 'center', outline: 'none',
};
const gradeInputStyle: React.CSSProperties = {
  ...inputStyle, width: 70, fontSize: rem(15), fontWeight: 700, textAlign: 'center',
};
const notesInputStyle: React.CSSProperties = {
  ...inputStyle, textAlign: 'left', flex: 1, minWidth: 100,
};

/* ─────────────────────────────────────────────────────────────────────────────
   RichNotesEditor — contenteditable notes box with a Bold / Italic / Underline
   toolbar for the HITTING report's main Notes field. Stores HTML in `value`;
   the read side (Hitting Snapshot's NoteBlock + the PDF generators) renders
   the HTML back out so the formatting persists. Existing plain-text notes
   keep working — anything without HTML tags reads through as-is.
   ───────────────────────────────────────────────────────────────────────── */
function RichNotesEditor({
  value, onChange, placeholder, minHeight = 220,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // Sync value INTO the editor only when the prop changes externally (not
  // on every keystroke — that would reset the caret to the beginning).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  const exec = (cmd: 'bold' | 'italic' | 'underline') => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    document.execCommand(cmd);
    onChange(el.innerHTML);
  };

  const ToolbarBtn = ({
    cmd, label, style,
  }: { cmd: 'bold' | 'italic' | 'underline'; label: string; style: React.CSSProperties }) => (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}
      style={{
        width: 32, height: 28, borderRadius: 4,
        border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.04)',
        color: 'var(--text)',
        fontSize: rem(13), lineHeight: 1, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...style,
      }}
      aria-label={cmd}
    >
      {label}
    </button>
  );

  const isEmpty = !value || value === '<br>' || value.replace(/<[^>]+>/g, '').trim() === '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Toolbar — Bold / Italic / Underline */}
      <div style={{ display: 'flex', gap: 4 }}>
        <ToolbarBtn cmd="bold"      label="B" style={{ fontWeight: 800 }} />
        <ToolbarBtn cmd="italic"    label="I" style={{ fontStyle: 'italic' }} />
        <ToolbarBtn cmd="underline" label="U" style={{ textDecoration: 'underline' }} />
      </div>
      {/* Editable surface */}
      <div style={{ position: 'relative' }}>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            background: 'rgba(20,24,32,0.85)',
            border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 7,
            padding: '12px 14px',
            color: 'var(--text)',
            fontSize: rem(14), lineHeight: 1.55,
            minHeight,
            outline: 'none',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            transition: 'border-color 0.12s ease',
          }}
        />
        {isEmpty && (
          <div style={{
            position: 'absolute', top: 12, left: 14,
            color: 'var(--text-muted)', fontStyle: 'italic',
            pointerEvents: 'none', fontSize: rem(14), lineHeight: 1.55,
          }}>
            {placeholder}
          </div>
        )}
      </div>
    </div>
  );
}
const sectionTitleStyle: React.CSSProperties = {
  /* Matches the Pitching report's section header (`rs.sectionTitle`):
     15px / weight 700 / `var(--text)`, emoji icon inline at the same
     size. Was a 12px uppercase accent-colored label; switched so every
     report form's section titles (Catching Throwing / Receiving /
     Blocking, etc.) read identically to the Pitching delivery-section
     headers in both themes. */
  fontSize: rem(15), fontWeight: 700, color: 'var(--text)',
  marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
};
const headerCellStyle: React.CSSProperties = {
  fontSize: rem(10), fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-muted)', textAlign: 'center', padding: '6px 4px',
};
const metricLabelStyle: React.CSSProperties = {
  fontSize: rem(12), fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', padding: '8px 0',
};
const mlbRefStyle: React.CSSProperties = {
  fontSize: rem(10), color: 'var(--faint)', textAlign: 'center', padding: '6px 4px',
};
const overallRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
  padding: '12px 16px', background: 'rgba(32,128,141,0.08)', borderRadius: 8,
  border: '1px solid rgba(32,128,141,0.2)',
};

/* ── Shared report-form bubble chrome ──
   One color system for every report type's form (Hitting, Pitching,
   Catching, Infield, Outfield, Physical) so the modal reads
   consistently: each MAIN section is a slate "Hitting Snapshot" panel
   and the bubbles inside it wear the off-white "swing" surface.

   Both styles ride the theme-aware defense tokens, which already flip
   per [data-theme]:
     • outer  `--defense-outer-bg`  → slate `#dee1e5` (light) / navy
       radial (dark) — identical to the Pitching delivery panels.
     • inner  `--defense-inner-bg`  → off-white `#eaeaea` (light) /
       warm-grey glass (dark) — the Swing / arsenal-card surface.
   Because they're CSS vars, the inline styles pick up the theme
   automatically (no useTheme plumbing per component). The outer
   shadow flips via `--report-outer-shadow` (clean drop in light,
   inset depth in dark). */
const reportOuterBubbleStyle: React.CSSProperties = {
  background: 'var(--defense-outer-bg)',
  border: '1px solid var(--border-light)',
  borderRadius: 12,
  padding: 16,
  boxShadow: 'var(--report-outer-shadow)',
};
const reportInnerBubbleStyle: React.CSSProperties = {
  background: 'var(--defense-inner-bg)',
  border: '1px solid var(--border-light)',
  borderRadius: 10,
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
};

/* ─────────────────────────────────────────────────────────────────────────────
   CatchingZoneEditor — 5×5 interactive strike-zone shading grid for the
   catching report. Inner 3×3 = strike zone (zoneColors[9]); outer 16 cells
   = border / ball zones (borderZoneColors[16]). Click any cell to cycle
   Avg → Good → Bad. Mirrors the dashboard's StrikeZoneHeatMap5x5 visual.
   ───────────────────────────────────────────────────────────────────────── */
const ZONE_FILLS_LOCAL: Record<ZoneVal, string> = {
  0: '#F87171', // bad — red
  1: 'rgba(255,255,255,0.18)', // average — neutral
  2: '#4ADE80', // good — green
};
const ZONE_TONE: Record<ZoneVal, string> = { 0: 'Bad', 1: 'Avg', 2: 'Good' };

function CatchingZoneEditor({
  zoneColors, borderZoneColors, onToggleInner, onToggleBorder,
}: {
  zoneColors: ZoneVal[];
  borderZoneColors: ZoneVal[];
  onToggleInner: (idx: number) => void;
  onToggleBorder: (idx: number) => void;
}) {
  /* Cell sizing — inner 3×3 stays full-size for a comfortable click
   * target; outer ring is noticeably thinner so the strike-zone
   * hierarchy reads at a glance. Matches the dashboard's
   * StrikeZoneHeatMap5x5 sizing ratio but with larger absolute values
   * since this version is clickable. */
  const COL_WIDTHS  = [40, 56, 56, 56, 40]; // sum = 248
  const ROW_HEIGHTS = [46, 64, 64, 64, 46]; // sum = 284
  const gridW = COL_WIDTHS.reduce((s, n) => s + n, 0);
  const gridH = ROW_HEIGHTS.reduce((s, n) => s + n, 0);

  /* Canvas leaves room below the grid for the home-plate reference
   * AND the legend strip rendered outside the SVG. */
  const W = 320;
  const H = 360;
  const ox = (W - gridW) / 2;
  const oy = 20;

  // Cumulative column-x / row-y origins for non-uniform cell sizes.
  const colX: number[] = [];
  COL_WIDTHS.reduce((acc, w) => { colX.push(acc); return acc + w; }, ox);
  const rowY: number[] = [];
  ROW_HEIGHTS.reduce((acc, h) => { rowY.push(acc); return acc + h; }, oy);

  const strikeX = colX[1];
  const strikeY = rowY[1];
  const strikeW = COL_WIDTHS[1] + COL_WIDTHS[2] + COL_WIDTHS[3];
  const strikeH = ROW_HEIGHTS[1] + ROW_HEIGHTS[2] + ROW_HEIGHTS[3];

  // Map (row, col) in the 5×5 grid to either the inner zoneColors slot or
  // the borderZoneColors slot (top row → bottom row → left col → right col).
  const slotAt = (row: number, col: number): { kind: 'inner' | 'border'; idx: number } => {
    const isStrike = row >= 1 && row <= 3 && col >= 1 && col <= 3;
    if (isStrike) {
      return { kind: 'inner', idx: (row - 1) * 3 + (col - 1) };
    }
    let idx = -1;
    if (row === 0) idx = col;
    else if (row === 4) idx = 5 + col;
    else if (col === 0) idx = 10 + (row - 1);
    else /* col === 4 */ idx = 13 + (row - 1);
    return { kind: 'border', idx };
  };

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const { kind, idx } = slotAt(r, c);
      const v = (kind === 'inner' ? zoneColors[idx] : borderZoneColors[idx]) ?? 1;
      const x = colX[c];
      const y = rowY[r];
      const w = COL_WIDTHS[c];
      const h = ROW_HEIGHTS[r];
      const isStrike = kind === 'inner';
      const onClick = () => kind === 'inner' ? onToggleInner(idx) : onToggleBorder(idx);
      cells.push(
        <g key={`${r}-${c}`} onClick={onClick} style={{ cursor: 'pointer' }}>
          <rect
            x={x} y={y} width={w} height={h}
            fill={ZONE_FILLS_LOCAL[v as ZoneVal]}
            stroke="var(--border)"
            strokeWidth={isStrike ? 0.7 : 0.5}
            rx={2}
            opacity={isStrike ? 0.95 : 0.55}
          />
          {/* Tone label — smaller in the border ring so it still fits
              in the thinner cells. */}
          <text
            x={x + w / 2}
            y={y + h / 2 + 4}
            textAnchor="middle"
            fontSize={isStrike ? 10 : 8}
            fontFamily="'DM Mono', monospace"
            fontWeight={700}
            fill="var(--text-muted)"
            letterSpacing="0.06em"
            pointerEvents="none"
          >
            {ZONE_TONE[v as ZoneVal]}
          </text>
        </g>,
      );
    }
  }

  /* Home-plate reference — pentagonal SVG path centered horizontally
   * under the strike zone, oriented from the catcher's view (flat top
   * faces the strike zone, point tucks downward toward the catcher).
   * The dashboard's StrikeZoneHeatMap5x5 carries the same icon for
   * orientation consistency. */
  const plateTopY = oy + gridH + 14;
  const plateH = 26;
  const plateCx = strikeX + strikeW / 2;
  const plateLeft = strikeX;
  const plateRight = strikeX + strikeW;
  const plateBottom = plateTopY + plateH;
  const platePath = `
    M ${plateLeft} ${plateTopY}
    L ${plateRight} ${plateTopY}
    L ${plateRight} ${plateTopY + plateH * 0.42}
    L ${plateCx} ${plateBottom}
    L ${plateLeft} ${plateTopY + plateH * 0.42}
    Z
  `;

  return (
    <div style={{
      padding: '10px 12px',
      // Was near-black; re-toned to a softer graphite so the strike-zone
      // editor reads with the neutral profile palette.
      background: 'rgba(110,118,125,0.10)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
           style={{ display: 'block', width: '100%', height: 'auto', maxWidth: 360, margin: '0 auto' }}>
        {cells}
        {/* Bold strike-zone outline around the inner 3×3 */}
        <rect
          x={strikeX} y={strikeY}
          width={strikeW} height={strikeH}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={2}
          rx={2}
          pointerEvents="none"
        />
        {/* Strike-zone label inside outline (top center) */}
        <text x={W / 2} y={strikeY + 14} textAnchor="middle"
              fontSize={9} fontFamily="'DM Mono', monospace" fontWeight={700}
              fill="rgba(255,255,255,0.70)" letterSpacing="0.22em" pointerEvents="none">
          STRIKE ZONE
        </text>
        {/* Home plate — catcher's view reference, faint fill + outline. */}
        <path
          d={platePath}
          fill="var(--border)"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          pointerEvents="none"
        />
        <text x={plateCx} y={plateTopY + plateH * 0.42 + 4} textAnchor="middle"
              fontSize={7} fontFamily="'DM Mono', monospace" fontWeight={700}
              fill="var(--text-muted)" letterSpacing="0.20em" pointerEvents="none">
          HOME
        </text>
      </svg>

      {/* Legend + click hint */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, fontSize: rem(11) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_FILLS_LOCAL[2], opacity: 0.9 }} />
          Good
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_FILLS_LOCAL[1], opacity: 0.6, border: '1px solid var(--border-strong)' }} />
          Average
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_FILLS_LOCAL[0], opacity: 0.9 }} />
          Bad
        </span>
        <span style={{ color: 'var(--faint)', fontSize: rem(10), marginLeft: 8 }}>Click cells to cycle</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   DefenseGradeSlider — shared "quick slider" row used by Catching / Infield /
   Outfield report forms. Mirrors the slider feel of the Hitting CoachDiagnosis
   and Pitching grade items (20-80 scouting scale, snap-on-mousedown to 50,
   tone bar coloured by grade, dedicated notes line) but skips multi-select
   chips since defense skill rows don't carry descriptive option lists.
   ───────────────────────────────────────────────────────────────────────── */
function DefenseGradeSlider({
  label, grade, onGradeChange,
}: {
  label: string;
  grade: string;
  /** Legacy props kept for backward-compat with existing callers but
   *  no longer rendered. The notes input row was removed per
   *  coach-spec ("size-match to Coach Grade chips") — coaches add
   *  per-grade context in the parent form's Notes section instead. */
  notes?: string;
  onGradeChange: (s: string) => void;
  onNotesChange?: (s: string) => void;
}) {
  const value: number | null = grade === '' ? null : (() => {
    const n = parseInt(grade, 10);
    return Number.isFinite(n) ? n : null;
  })();
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  /* Click/drag anywhere on the score bar to set the grade. Snap step
     is 5 so scores land on the canonical 20/25/30/…/80 scouting grid.
     Mirrors `DefenseCoachGradeItem`'s `handleBarPointer` exactly so
     the two surfaces feel identical when the coach uses them. */
  const handleBarPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const fraction = rect.width === 0 ? 0 : x / rect.width;
    const raw = 20 + fraction * 60;
    const snapped = Math.max(20, Math.min(80, Math.round(raw / 5) * 5));
    onGradeChange(String(snapped));
  };
  /* Rebuilt to match `DefenseCoachGradeItem` (The Gather / Lower Half
     at Foot Strike / etc.) pixel-perfect — same warm-grey gradient
     chrome, same padding, same border + radius + inset shadow stack,
     same internal layout (title + score readout + clear, then a
     single click/drag-able 10 px bar). The previous DefenseGradeSlider
     was visibly larger because it stacked a range slider + a number
     input + a clear button + a notes input row UNDER the bar; all
     four were redundant once the bar itself became interactive. */
  return (
    <div style={{
      ...reportInnerBubbleStyle,
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: rem(10.5), fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {label}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontWeight: 800, fontSize: rem(20),
            color: tone, lineHeight: 1, letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {value ?? '—'}
          </span>
          {value !== null && (
            <button
              type="button"
              onClick={() => onGradeChange('')}
              title="Clear this grade"
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 5,
                padding: '1px 6px', fontSize: rem(10), cursor: 'pointer',
                lineHeight: 1.2,
              }}
            >x</button>
          )}
        </span>
      </div>
      <div
        role="slider"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={value ?? undefined}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          handleBarPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return;
          handleBarPointer(e);
        }}
        style={{
          position: 'relative',
          height: 10,
          borderRadius: 5,
          background: 'var(--border)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0,
          width: `${pct}%`,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${tone}33, ${tone}aa)`,
          transition: 'width 0.08s linear',
        }} />
      </div>
    </div>
  );
}

/* DefenseOverallSlider — variant for "Overall ___ Grade" rows.
   Same compact shape as DefenseGradeSlider — the previous accent-blue
   gradient was retired so every grade bubble in the defense form
   (per-skill + overall) reads at the same Coach-Grade-chip size. */
function DefenseOverallSlider({
  label, grade, onGradeChange, readOnly = false,
}: {
  label: string;
  grade: string;
  onGradeChange: (s: string) => void;
  /** When true, the slider renders as a passive display — no pointer
   *  interactions, no clear button. Used by the Catching report where
   *  the Overall grade auto-computes as the average of its section's
   *  sub-skill grades (so the coach can't manually override the
   *  derived value). */
  readOnly?: boolean;
}) {
  const value: number | null = grade === '' ? null : (() => {
    const n = parseInt(grade, 10);
    return Number.isFinite(n) ? n : null;
  })();
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  const handleBarPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const fraction = rect.width === 0 ? 0 : x / rect.width;
    const raw = 20 + fraction * 60;
    const snapped = Math.max(20, Math.min(80, Math.round(raw / 5) * 5));
    onGradeChange(String(snapped));
  };
  return (
    <div style={{
      ...reportInnerBubbleStyle,
      padding: '10px 12px',
      display: 'flex', flexDirection: 'column', gap: 7,
      marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: rem(10.5), fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {label}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontWeight: 800, fontSize: rem(20),
            color: tone, lineHeight: 1, letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {value ?? '—'}
          </span>
          {value !== null && !readOnly && (
            <button
              type="button"
              onClick={() => onGradeChange('')}
              title="Clear this grade"
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 5,
                padding: '1px 6px', fontSize: rem(10), cursor: 'pointer',
                lineHeight: 1.2,
              }}
            >x</button>
          )}
          {readOnly && (
            /* AVG chip — signals to the coach that this Overall grade
               is auto-computed from the section's sub-skill grades,
               not a manually-set value. Replaces the Clear (×) button
               in the same slot since clearing a derived value makes
               no sense. */
            <span
              title="Auto-computed as the average of this section's sub-skill grades"
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 5,
                padding: '1px 6px', fontSize: rem(9), fontWeight: 700,
                letterSpacing: '0.10em', textTransform: 'uppercase',
                lineHeight: 1.2,
              }}
            >AVG</span>
          )}
        </span>
      </div>
      <div
        role="slider"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={value ?? undefined}
        tabIndex={readOnly ? -1 : 0}
        onPointerDown={(e) => {
          if (readOnly) return;
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          handleBarPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return;
          handleBarPointer(e);
        }}
        style={{
          position: 'relative',
          height: 10,
          borderRadius: 5,
          background: 'var(--border)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0,
          width: `${pct}%`,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${tone}33, ${tone}aa)`,
          transition: 'width 0.08s linear',
        }} />
      </div>
    </div>
  );
}

function CatchingForm({ data, setData }: { data: CatchingFormData; setData: (d: CatchingFormData) => void }) {
  const updateThrowing = (key: keyof CatchingFormData['throwing'], field: Partial<ThrowingRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      throwing: {
        ...data.throwing,
        [key]: { ...(data.throwing[key] as ThrowingRow), ...field },
      },
    });
  };
  const updateThrowingAttempt = (key: keyof CatchingFormData['throwing'], idx: number, val: string) => {
    if (key === 'overallGrade') return;
    const row = data.throwing[key] as ThrowingRow;
    const newAttempts = [...row.attempts];
    newAttempts[idx] = val;
    updateThrowing(key, { attempts: newAttempts });
  };
  const updateReceiving = (key: keyof CatchingFormData['receiving'], field: Partial<GradeRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      receiving: {
        ...data.receiving,
        [key]: { ...(data.receiving[key] as GradeRow), ...field },
      },
    });
  };
  const updateBlocking = (key: keyof CatchingFormData['blocking'], field: Partial<GradeRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      blocking: {
        ...data.blocking,
        [key]: { ...(data.blocking[key] as GradeRow), ...field },
      },
    });
  };

  const throwingRows: { key: keyof CatchingFormData['throwing']; label: string; mlbAvg: string }[] = [
    { key: 'popTime2B', label: 'Pop Time (2B) — sec', mlbAvg: '1.90–2.00' },
    { key: 'exchangeTime', label: 'Exchange Time — sec', mlbAvg: '0.65–0.75' },
    { key: 'velocity', label: 'Velocity — mph', mlbAvg: '~75–80' },
    { key: 'shuffleVelocity', label: 'Shuffle Velocity — mph', mlbAvg: '—' },
  ];

  // Receiving rows — six Coaches Grade sub-skills that render next to
  // the strike-zone heat map on the dashboard, plus the two legacy
  // umbrella grades (Quiet Hands, Stance & Setup) we keep capturing
  // for older reports' continuity.
  const receivingRows: { key: keyof CatchingFormData['receiving']; label: string }[] = [
    { key: 'path',         label: 'Path' },
    { key: 'accuracy',     label: 'Accuracy' },
    { key: 'turn',         label: 'Turn' },
    { key: 'presentation', label: 'Presentation' },
    { key: 'timing',       label: 'Timing' },
    { key: 'stanceSetup',  label: 'Stance & Setup' },
  ];

  /* Helper — average the numeric values of an arbitrary set of
     grade-string fields, returning a 20-80-clamped integer as a
     string (or `''` if no field carries a value). Used to derive the
     three section "Overall" grades from their sub-skills so the
     coach no longer manually enters them — they're a pure function
     of the underlying coach grades. */
  const averageGrades = (grades: (string | undefined)[]): string => {
    const valid = grades
      .map(g => (g ? parseInt(g, 10) : NaN))
      .filter(n => Number.isFinite(n)) as number[];
    if (valid.length === 0) return '';
    const avg = valid.reduce((s, v) => s + v, 0) / valid.length;
    return String(Math.max(20, Math.min(80, Math.round(avg))));
  };

  /* Section averages — sourced from the coach-spec sub-skill groups.
     Receiving uses the six core sub-skills the coach grades inline
     (Load / Path / Accuracy / Turn / Presentation / Timing). The
     two legacy umbrella grades (Quiet Hands, Stance & Setup) are
     intentionally excluded so the dashboard's Overall Receiving
     score matches the same six chips it displays in the side panel.
     Throwing uses the three coach-grade sub-skills below the speed/
     pop-time attempts. Blocking averages every sub-skill row in
     the section. */
  const overallReceivingAvg = averageGrades([
    data.receiving.path.grade,
    data.receiving.accuracy.grade,
    data.receiving.turn.grade,
    data.receiving.presentation.grade,
    data.receiving.timing.grade,
  ]);
  const overallThrowingAvg = averageGrades([
    data.throwing.footwork.grade,
    data.throwing.transfer.grade,
    data.throwing.accuracy.grade,
    data.throwing.armPath.grade,
    data.throwing.footStrike.grade,
    data.throwing.rotationSeq.grade,
    data.throwing.decel.grade,
  ]);
  const overallBlockingAvg = averageGrades([
    data.blocking.blockLeft.grade,
    data.blocking.blockCenter.grade,
    data.blocking.blockRight.grade,
    data.blocking.accuracy.grade,
    data.blocking.gloveBodyAngle.grade,
    data.blocking.recoverySpeed.grade,
  ]);

  // Blocking rows include the three positional Range grades + the existing
  // technique grades.
  const blockingRows: { key: keyof CatchingFormData['blocking']; label: string }[] = [
    { key: 'blockLeft',      label: 'Blocking Range — Left' },
    { key: 'blockCenter',    label: 'Blocking Range — Center' },
    { key: 'blockRight',     label: 'Blocking Range — Right' },
    { key: 'accuracy',       label: 'Blocking Accuracy' },
    { key: 'gloveBodyAngle', label: 'Glove / Body Angle' },
    { key: 'recoverySpeed',  label: 'Recovery Speed' },
  ];

  // Cycle a strike-zone cell's value: 1 (avg) → 2 (good) → 0 (bad) → 1 ...
  const cycle = (v: ZoneVal): ZoneVal => (v === 1 ? 2 : v === 2 ? 0 : 1);
  const updateInnerZone = (idx: number) => {
    const next = [...data.receiving.zoneColors];
    next[idx] = cycle(next[idx] ?? 1);
    setData({ ...data, receiving: { ...data.receiving, zoneColors: next } });
  };
  const updateBorderZone = (idx: number) => {
    const next = [...data.receiving.borderZoneColors];
    next[idx] = cycle(next[idx] ?? 1);
    setData({ ...data, receiving: { ...data.receiving, borderZoneColors: next } });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── THROWING & POP TIME ── */}
      <div style={reportOuterBubbleStyle}>
        <div style={sectionTitleStyle}>
          Throwing &amp; Pop Time
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: rem(12) }}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: 'left', minWidth: 140 }}>Metric</th>
                {[1,2,3,4,5,6,7,8].map(n => (
                  <th key={n} style={{ ...headerCellStyle, minWidth: 56 }}>Att {n}</th>
                ))}
                <th style={{ ...headerCellStyle, minWidth: 60 }}>MLB Avg</th>
                <th style={{ ...headerCellStyle, textAlign: 'left', minWidth: 120 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {throwingRows.map(row => {
                const rowData = data.throwing[row.key] as ThrowingRow;
                return (
                  <tr key={row.key}>
                    <td style={metricLabelStyle}>{row.label}</td>
                    {rowData.attempts.map((val, i) => (
                      <td key={i} style={{ padding: '4px 2px' }}>
                        <input
                          type="text" inputMode="decimal" style={inputStyle}
                          value={val} placeholder="—"
                          onChange={e => updateThrowingAttempt(row.key, i, e.target.value)}
                        />
                      </td>
                    ))}
                    <td style={mlbRefStyle}>{row.mlbAvg}</td>
                    <td style={{ padding: '4px 2px' }}>
                      <input
                        type="text" style={{ ...inputStyle, textAlign: 'left' }}
                        value={rowData.notes} placeholder="Notes..."
                        onChange={e => updateThrowing(row.key, { notes: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Coach Grades — Footwork / Transfer / Accuracy. These three
            20-80 grades feed the dashboard's Underlying Stats → Throwing
            row, alongside Pop Time / Exchange / Arm Strength. */}
        <div style={{ ...sectionTitleStyle, marginTop: 16 }}>
          Throwing — Coach Grades (20–80)
        </div>
        {/* Grade slider grid — matches the Coach Grades section
           layout (auto-fit, minmax(280px, 1fr)) so each
           DefenseGradeSlider lays out at the same horizontal size
           as a Coach Grade chip (The Gather / Lower Half at Foot
           Strike / etc.). Was previously a vertical flex stack
           which made each slider stretch to 100% modal width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {([
            { key: 'footwork',    label: 'Footwork' },
            { key: 'transfer',    label: 'Transfer' },
            { key: 'accuracy',    label: 'Accuracy' },
            { key: 'armPath',     label: 'Arm Path' },
            { key: 'footStrike',  label: 'Foot Strike Position' },
            { key: 'rotationSeq', label: 'Rotation Sequence' },
            { key: 'decel',       label: 'Arm Deceleration' },
          ] as { key: 'footwork' | 'transfer' | 'accuracy' | 'armPath' | 'footStrike' | 'rotationSeq' | 'decel'; label: string }[]).map(row => {
            const rowData = data.throwing[row.key] as GradeRow;
            return (
              <DefenseGradeSlider
                key={row.key}
                label={row.label}
                grade={rowData.grade}
                notes={rowData.notes}
                onGradeChange={(v) => setData({
                  ...data,
                  throwing: { ...data.throwing, [row.key]: { ...rowData, grade: v } },
                })}
                onNotesChange={(v) => setData({
                  ...data,
                  throwing: { ...data.throwing, [row.key]: { ...rowData, notes: v } },
                })}
              />
            );
          })}
        </div>
        <DefenseOverallSlider
          label="Overall Throwing Grade"
          /* Auto-computed average of Footwork + Transfer + Accuracy
             coach grades. Slider is read-only — the coach can't
             override the derived value, only update the underlying
             sub-skill grades. */
          grade={overallThrowingAvg}
          onGradeChange={() => undefined}
          readOnly
        />
      </div>

      {/* ── RECEIVING ── */}
      <div style={reportOuterBubbleStyle}>
        <div style={sectionTitleStyle}>
          Receiving — Strike-Zone Heat Map
        </div>
        {/* Interactive 5×5 grid — 9 inner strike-zone cells + 16 border
            cells around them. Click a cell to cycle Avg → Good → Bad. */}
        <CatchingZoneEditor
          zoneColors={data.receiving.zoneColors}
          borderZoneColors={data.receiving.borderZoneColors}
          onToggleInner={updateInnerZone}
          onToggleBorder={updateBorderZone}
        />
        <div style={{ ...sectionTitleStyle, marginTop: 16 }}>
          Receiving — Skill Grades (20–80)
        </div>
        {/* Grade slider grid — matches the Coach Grades section
           layout (auto-fit, minmax(280px, 1fr)) so each
           DefenseGradeSlider lays out at the same horizontal size
           as a Coach Grade chip (The Gather / Lower Half at Foot
           Strike / etc.). Was previously a vertical flex stack
           which made each slider stretch to 100% modal width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {receivingRows.map(row => {
            const rowData = data.receiving[row.key] as GradeRow;
            return (
              <DefenseGradeSlider
                key={row.key}
                label={row.label}
                grade={rowData.grade}
                notes={rowData.notes}
                onGradeChange={(v) => updateReceiving(row.key, { grade: v })}
                onNotesChange={(v) => updateReceiving(row.key, { notes: v })}
              />
            );
          })}
        </div>
        <DefenseOverallSlider
          label="Overall Receiving Grade"
          /* Auto-computed average of Load + Path + Accuracy + Turn +
             Presentation + Timing coach grades (the six core sub-
             skills the dashboard's side panel renders). Slider is
             read-only — coach updates the average by updating the
             sub-skill grades above. */
          grade={overallReceivingAvg}
          onGradeChange={() => undefined}
          readOnly
        />
      </div>

      {/* ── BLOCKING ── */}
      <div style={reportOuterBubbleStyle}>
        <div style={sectionTitleStyle}>
          Blocking — Scouting Grades (20–80)
        </div>
        {/* Grade slider grid — matches the Coach Grades section
           layout (auto-fit, minmax(280px, 1fr)) so each
           DefenseGradeSlider lays out at the same horizontal size
           as a Coach Grade chip (The Gather / Lower Half at Foot
           Strike / etc.). Was previously a vertical flex stack
           which made each slider stretch to 100% modal width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {blockingRows.map(row => {
            const rowData = data.blocking[row.key] as GradeRow;
            return (
              <DefenseGradeSlider
                key={row.key}
                label={row.label}
                grade={rowData.grade}
                notes={rowData.notes}
                onGradeChange={(v) => updateBlocking(row.key, { grade: v })}
                onNotesChange={(v) => updateBlocking(row.key, { notes: v })}
              />
            );
          })}
        </div>
        <DefenseOverallSlider
          label="Overall Blocking Grade"
          /* Auto-computed average of every blocking sub-skill in the
             section: Block Left/Center/Right + Accuracy + Glove-Body
             Angle + Recovery Speed. Slider is read-only — coach
             updates the average by updating the sub-skill grades. */
          grade={overallBlockingAvg}
          onGradeChange={() => undefined}
          readOnly
        />
      </div>
    </div>
  );
}

/* ── Infield Assessment Form ── */

interface ArmRow {
  attempts: string[];  // 3 string values
  notes: string;
}

/**
 * Per-snapshot group shape: two string inputs + an /80 grade + a notes
 * field. Strings (not numbers) because the form holds raw user input
 * until save; parsing to numbers happens in build*Content.
 */
interface DefenseSnapshotGroup {
  primary: string;   // e.g. max velocity, hands grade, 60-yard time
  secondary: string; // e.g. avg velocity, transfers, acceleration
  /* Optional third metric — legacy (Arm Strength's Pull Down Velocity);
     other groups leave it undefined. No longer entered for Arm Strength
     now that it captures a list of throws. */
  tertiary?: string;
  /* Arm Strength only — up to 8 raw throwing velocities (mph). Max + Avg
     are derived from these and written into `primary` / `secondary`, so
     the snapshot + the Defensive Skills callout's max read them exactly
     as before. Persists via the raw form blob for re-edit. */
  throws?: string[];
  overallGrade: string;
  notes: string;
}

interface InfieldFormData {
  // Legacy granular fields kept for back-compat with older saved
  // reports. New reports use `manualSnapshot` below; the dashboard
  // prefers it when present.
  arm: {
    velocity: ArmRow;
    accuracy: ArmRow;
  };
  rangeFootwork: {
    jumps: GradeRow;
    routes: GradeRow;
    rangeGloveSide: GradeRow;
    rangeArmSide: GradeRow;
    breakdownFootwork: GradeRow;
    athleticism: GradeRow;
    overallGrade: string;
  };
  handsGlove: {
    exchanges: GradeRow;
    shortHops: GradeRow;
    forehand: GradeRow;
    backhand: GradeRow;
    doublePlays: GradeRow;
    overallGrade: string;
  };
  /* Snapshot-shape manual inputs — what the Infielder Snapshot panel
   * actually shows. "Defense will be manual uploads" → coaches type
   * each value here; the dashboard reads from this object first. */
  manualSnapshot: {
    armStrength: DefenseSnapshotGroup; // primary = max velo mph, secondary = avg velo mph
    glove:       DefenseSnapshotGroup; // primary = hands grade,  secondary = transfers grade
    range:       DefenseSnapshotGroup; // primary = 60yd time,    secondary = accel 0-30 time
    firstStep:   DefenseSnapshotGroup; // primary = reaction s,   secondary = VALD jumps in
  };
}

const EMPTY_ARM_ROW: ArmRow = { attempts: ['', '', ''], notes: '' };

const EMPTY_SNAPSHOT_GROUP: DefenseSnapshotGroup = {
  primary: '', secondary: '', tertiary: '', overallGrade: '', notes: '',
};

function emptyInfieldForm(): InfieldFormData {
  return {
    arm: {
      velocity: { ...EMPTY_ARM_ROW, attempts: [...EMPTY_ARM_ROW.attempts] },
      accuracy: { ...EMPTY_ARM_ROW, attempts: [...EMPTY_ARM_ROW.attempts] },
    },
    rangeFootwork: {
      jumps: { ...EMPTY_GRADE_ROW },
      routes: { ...EMPTY_GRADE_ROW },
      rangeGloveSide: { ...EMPTY_GRADE_ROW },
      rangeArmSide: { ...EMPTY_GRADE_ROW },
      breakdownFootwork: { ...EMPTY_GRADE_ROW },
      athleticism: { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
    handsGlove: {
      exchanges: { ...EMPTY_GRADE_ROW },
      shortHops: { ...EMPTY_GRADE_ROW },
      forehand: { ...EMPTY_GRADE_ROW },
      backhand: { ...EMPTY_GRADE_ROW },
      doublePlays: { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
    manualSnapshot: {
      armStrength: { ...EMPTY_SNAPSHOT_GROUP },
      glove:       { ...EMPTY_SNAPSHOT_GROUP },
      range:       { ...EMPTY_SNAPSHOT_GROUP },
      firstStep:   { ...EMPTY_SNAPSHOT_GROUP },
    },
  };
}

function buildInfieldContent(data: InfieldFormData) {
  const parseArmRow = (row: ArmRow, higherIsBetter: boolean) => {
    const nums = row.attempts.map(a => { const n = parseFloat(a); return isNaN(n) ? null : n; });
    const valid = nums.filter((n): n is number => n !== null);
    return {
      attempts: nums,
      best: valid.length > 0 ? (higherIsBetter ? Math.max(...valid) : Math.min(...valid)) : null,
      avg: valid.length > 0 ? +(valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(1) : null,
      notes: row.notes,
    };
  };
  const parseGrade = (row: GradeRow) => ({
    grade: row.grade ? parseInt(row.grade) || null : null,
    notes: row.notes,
  });
  const parseNum = (s: string) => {
    if (!s) return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };
  const parseSnapshotGroup = (g: DefenseSnapshotGroup) => ({
    primary: parseNum(g.primary),
    secondary: parseNum(g.secondary),
    /* Tertiary parsed defensively — undefined on groups that don't use
       it (Glove / Range / First Step) flows through `parseNum` as null. */
    tertiary: parseNum(g.tertiary ?? ''),
    overallGrade: parseNum(g.overallGrade),
    notes: g.notes,
  });
  return {
    arm: {
      velocity: parseArmRow(data.arm.velocity, true),   // higher velo is better
      accuracy: parseArmRow(data.arm.accuracy, true),    // higher % is better
    },
    rangeFootwork: {
      jumps: parseGrade(data.rangeFootwork.jumps),
      routes: parseGrade(data.rangeFootwork.routes),
      rangeGloveSide: parseGrade(data.rangeFootwork.rangeGloveSide),
      rangeArmSide: parseGrade(data.rangeFootwork.rangeArmSide),
      breakdownFootwork: parseGrade(data.rangeFootwork.breakdownFootwork),
      athleticism: parseGrade(data.rangeFootwork.athleticism),
      overallGrade: data.rangeFootwork.overallGrade ? parseInt(data.rangeFootwork.overallGrade) || null : null,
    },
    handsGlove: {
      exchanges: parseGrade(data.handsGlove.exchanges),
      shortHops: parseGrade(data.handsGlove.shortHops),
      forehand: parseGrade(data.handsGlove.forehand),
      backhand: parseGrade(data.handsGlove.backhand),
      doublePlays: parseGrade(data.handsGlove.doublePlays),
      overallGrade: data.handsGlove.overallGrade ? parseInt(data.handsGlove.overallGrade) || null : null,
    },
    /* Snapshot-shape manual entries — the four headline groups visible
     * on the Infielder Snapshot dashboard. */
    manualSnapshot: {
      armStrength: parseSnapshotGroup(data.manualSnapshot.armStrength),
      glove:       parseSnapshotGroup(data.manualSnapshot.glove),
      range:       parseSnapshotGroup(data.manualSnapshot.range),
      firstStep:   parseSnapshotGroup(data.manualSnapshot.firstStep),
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   DefenseSnapshotFormSection — shared form body used by both InfieldForm
   and OutfieldForm. Matches the dashboard's DefensiveSnapshot panel
   layout one-for-one: four headline groups (Arm Strength / Glove /
   Range / First Step), each with two input rows + an overall /80 grade
   + notes. The data shape is the four-group `manualSnapshot` extension
   on InfieldFormData / OutfieldFormData.
   ───────────────────────────────────────────────────────────────────── */

interface SnapshotFormSpec {
  /** Group key in `data.manualSnapshot`. */
  key: 'armStrength' | 'glove' | 'range' | 'firstStep';
  title: string;
  /** Label + suffix for the primary row (e.g. "Max velocity" + "mph"). */
  primary: { label: string; unit: string; inputMode?: 'decimal' | 'numeric' };
  /** Label + suffix for the secondary row. */
  secondary: { label: string; unit: string; inputMode?: 'decimal' | 'numeric' };
  /** Optional third row — currently only Arm Strength uses it
   *  (Pull Down Velocity). Omitted on groups that only need two. */
  tertiary?: { label: string; unit: string; inputMode?: 'decimal' | 'numeric' };
}

const INFIELD_SNAPSHOT_SPEC: SnapshotFormSpec[] = [
  { key: 'armStrength', title: 'Arm Strength',
    primary:   { label: 'Max velocity',       unit: 'mph', inputMode: 'decimal' },
    secondary: { label: 'Avg velocity',       unit: 'mph', inputMode: 'decimal' },
    tertiary:  { label: 'Pull Down velocity', unit: 'mph', inputMode: 'decimal' } },
  { key: 'glove', title: 'Glove',
    primary:   { label: 'Hands',     unit: 'grade', inputMode: 'numeric' },
    secondary: { label: 'Transfers', unit: 'grade', inputMode: 'numeric' } },
  { key: 'range', title: 'Range',
    primary:   { label: '60 yard dash',   unit: 's', inputMode: 'decimal' },
    secondary: { label: '10 Yard Sprint', unit: 's', inputMode: 'decimal' } },
  /* First Step group retired per coach-spec — the snapshot now carries
     Arm Strength / Glove / Range only. The `firstStep` data shape stays
     on InfieldFormData/OutfieldFormData (and the SnapshotFormSpec key
     union) for back-compat with older saved reports; it's simply no
     longer entered here or displayed on the profile. */
];

const OUTFIELD_SNAPSHOT_SPEC: SnapshotFormSpec[] = INFIELD_SNAPSHOT_SPEC;

function DefenseSnapshotFormSection({
  mode, spec, manualSnapshot, setManualSnapshot,
}: {
  mode: 'infield' | 'outfield';
  spec: SnapshotFormSpec[];
  manualSnapshot: InfieldFormData['manualSnapshot'];
  setManualSnapshot: (next: InfieldFormData['manualSnapshot']) => void;
}) {
  const accent = mode === 'infield' ? '#F59E0B' : '#22C55E';

  const updateGroup = (key: SnapshotFormSpec['key'], patch: Partial<DefenseSnapshotGroup>) => {
    setManualSnapshot({
      ...manualSnapshot,
      [key]: { ...manualSnapshot[key], ...patch },
    });
  };

  /* Local numeric parse for deriving Arm Strength's Max / Avg from the
     entered throw velocities. */
  const num = (s: string): number | null => {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  /* Shared inner-bubble card chrome (theme-aware) used by every group. */
  const cardStyle: React.CSSProperties = {
    background: 'var(--defense-inner-bg)',
    border: '1px solid var(--border-light)',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex', flexDirection: 'column', gap: 10,
  };

  /* Glove / Range overall grade — auto-averaged from the two metric values
     entered (rounded to a whole number). Empty when nothing's entered. */
  const deriveGrade = (d: DefenseSnapshotGroup): string => {
    const vals = [num(d.primary), num(d.secondary)].filter((n): n is number => n !== null);
    if (!vals.length) return '';
    return String(Math.round(vals.reduce((a, b) => a + b, 0) / vals.length));
  };

  /* Group header — colored dot, uppercase title, and the /80 overall grade.
     When `autoGrade` is provided (Glove / Range) the grade is shown
     read-only (auto-averaged); otherwise it's an editable input (Arm
     Strength keeps a manual grade). */
  const renderHeader = (group: SnapshotFormSpec, autoGrade?: string) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      paddingBottom: 8, borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
      <span style={{
        flex: 1, fontSize: rem(11), fontWeight: 800,
        letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-bright)',
      }}>{group.title}</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        {autoGrade !== undefined ? (
          <span style={{
            width: 56, textAlign: 'center', fontWeight: 700, fontSize: rem(14),
            color: 'var(--text-bright)', fontVariantNumeric: 'tabular-nums',
          }}>{autoGrade || '—'}</span>
        ) : (
          <input
            type="text" inputMode="numeric"
            value={manualSnapshot[group.key].overallGrade}
            onChange={(e) => updateGroup(group.key, { overallGrade: e.target.value })}
            placeholder="—"
            style={{ ...inputStyle, width: 56, textAlign: 'center', fontWeight: 700 }}
          />
        )}
        <span style={{ fontSize: rem(10), color: 'var(--text-muted)' }}>/80</span>
      </span>
    </div>
  );

  /* Arm Strength — derive Max + Avg live from up to 8 throw velocities. */
  const armData = manualSnapshot.armStrength;
  const armThrows = Array.from({ length: 8 }, (_, i) => armData.throws?.[i] ?? '');
  const armNums = armThrows.map(num).filter((n): n is number => n !== null);
  const armMax = armNums.length ? Math.max(...armNums) : null;
  const armAvg = armNums.length ? armNums.reduce((a, b) => a + b, 0) / armNums.length : null;
  const setArmThrow = (i: number, val: string) => {
    const next = [...armThrows];
    next[i] = val;
    const ns = next.map(num).filter((n): n is number => n !== null);
    const mx = ns.length ? Math.max(...ns) : null;
    const av = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
    updateGroup('armStrength', {
      throws: next,
      primary: mx === null ? '' : String(mx),
      secondary: av === null ? '' : av.toFixed(1),
    });
  };

  const armSpec = spec.find((s) => s.key === 'armStrength');
  const otherSpecs = spec.filter((s) => s.key !== 'armStrength');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Arm Strength — full-width row of up to 8 throwing velocities.
          Max + Avg are derived live and written into primary / secondary
          so the Infielder/Outfielder Snapshot (and the Defensive Skills
          callout's max) read them exactly as before. ── */}
      {armSpec && (
        <div style={cardStyle}>
          {renderHeader(armSpec)}
          <div style={{
            fontSize: rem(11), color: 'var(--text-muted)', fontWeight: 600,
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            Throwing Velocities (mph) — up to 8
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 8 }}>
            {armThrows.map((t, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                <span style={{ fontSize: rem(9), fontWeight: 600, color: 'var(--text-muted)' }}>{i + 1}</span>
                <input
                  type="text" inputMode="decimal"
                  value={t}
                  onChange={(e) => setArmThrow(i, e.target.value)}
                  placeholder="—"
                  style={{ ...inputStyle, width: '100%', textAlign: 'center', padding: '6px 4px' }}
                />
              </div>
            ))}
          </div>
          {/* Derived Max / Avg readout (auto-computed from the throws). */}
          <div style={{ display: 'flex', gap: 28, paddingTop: 2 }}>
            {([
              { label: 'Max velocity', val: armMax === null ? null : (Number.isInteger(armMax) ? String(armMax) : armMax.toFixed(1)) },
              { label: 'Avg velocity', val: armAvg === null ? null : armAvg.toFixed(1) },
            ]).map((m) => (
              <span key={m.label} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: rem(12), color: 'var(--text-muted)' }}>{m.label}</span>
                <span style={{ fontSize: rem(15), fontWeight: 700, color: 'var(--text-bright)' }}>
                  {m.val ?? '—'}
                  <span style={{ fontSize: rem(11), color: 'var(--text-muted)', fontWeight: 400, marginLeft: 3 }}>mph</span>
                </span>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={armData.notes}
            onChange={(e) => updateGroup('armStrength', { notes: e.target.value })}
            placeholder="Notes…"
            style={{ ...inputStyle, textAlign: 'left', fontSize: rem(12) }}
          />
        </div>
      )}

      {/* ── Glove + Range — two-column grid beneath Arm Strength. ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        {otherSpecs.map((group) => {
          const data = manualSnapshot[group.key];
          return (
            <div key={group.key} style={cardStyle}>
              {/* Glove auto-averages its two grades into the overall; Range
                  keeps a manual overall grade for now (its inputs are times,
                  not grades, so an average isn't a meaningful /80). */}
              {renderHeader(group, group.key === 'glove' ? deriveGrade(data) : undefined)}
              {([
                { key: 'primary' as const,   spec: group.primary },
                { key: 'secondary' as const, spec: group.secondary },
                ...(group.tertiary ? [{ key: 'tertiary' as const, spec: group.tertiary }] : []),
              ]).map(({ key: rowKey, spec: rowSpec }) => {
                const value = data[rowKey] ?? '';
                return (
                  <div key={rowSpec.label} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  }}>
                    <span style={{ fontSize: rem(12), color: 'var(--text-muted)' }}>{rowSpec.label}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                      <input
                        type="text"
                        inputMode={rowSpec.inputMode}
                        value={value}
                        onChange={(e) => updateGroup(group.key, group.key === 'glove'
                          /* Glove auto-averages its two values into the overall
                             grade; Range leaves the overall grade untouched
                             (entered manually). */
                          ? { [rowKey]: e.target.value, overallGrade: deriveGrade({ ...data, [rowKey]: e.target.value }) }
                          : { [rowKey]: e.target.value })}
                        placeholder="—"
                        style={{ ...inputStyle, width: 80, textAlign: 'right' }}
                      />
                      <span style={{ fontSize: rem(11), color: 'var(--text-muted)' }}>{rowSpec.unit}</span>
                    </span>
                  </div>
                );
              })}
              <input
                type="text"
                value={data.notes}
                onChange={(e) => updateGroup(group.key, { notes: e.target.value })}
                placeholder="Notes…"
                style={{ ...inputStyle, textAlign: 'left', fontSize: rem(12) }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InfieldForm({ data, setData }: { data: InfieldFormData; setData: (d: InfieldFormData) => void }) {
  /* Snapshot-shape body — four cards matching the Infielder Snapshot's
   * headline groups (Arm Strength / Glove / Range / First Step). Each
   * card collects the two underlying-metric inputs the snapshot
   * displays plus an overall /80 grade and a notes line.
   *
   * Legacy granular fields (arm.velocity attempts, rangeFootwork
   * grades, handsGlove grades) still live in the data shape for
   * back-compat with older reports — the build*Content step writes
   * both shapes — but they're no longer exposed in the form UI. */
  return (
    <div style={{ ...reportOuterBubbleStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Section header in the Pitching report's icon + title style
          (rs.sectionHeader/Icon/Title) so it reads identically to the
          Coach Grades panel below and the Pitching delivery sections. */}
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>🧤</span>
        <span className={rs.sectionTitle}>Infielder Snapshot</span>
      </div>
      <DefenseSnapshotFormSection
        mode="infield"
        spec={INFIELD_SNAPSHOT_SPEC}
        manualSnapshot={data.manualSnapshot}
        setManualSnapshot={(next) => setData({ ...data, manualSnapshot: next })}
      />
    </div>
  );
}

function InfieldFormLegacy({ data, setData }: { data: InfieldFormData; setData: (d: InfieldFormData) => void }) {
  /* Kept around solely so the JSX below typechecks while we migrate. */
  const updateArm = (key: keyof InfieldFormData['arm'], field: Partial<ArmRow>) => {
    setData({
      ...data,
      arm: { ...data.arm, [key]: { ...data.arm[key], ...field } },
    });
  };
  const updateArmAttempt = (key: keyof InfieldFormData['arm'], idx: number, val: string) => {
    const row = data.arm[key];
    const newAttempts = [...row.attempts];
    newAttempts[idx] = val;
    updateArm(key, { attempts: newAttempts });
  };
  const updateRange = (key: keyof InfieldFormData['rangeFootwork'], field: Partial<GradeRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      rangeFootwork: { ...data.rangeFootwork, [key]: { ...(data.rangeFootwork[key] as GradeRow), ...field } },
    });
  };
  const updateHands = (key: keyof InfieldFormData['handsGlove'], field: Partial<GradeRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      handsGlove: { ...data.handsGlove, [key]: { ...(data.handsGlove[key] as GradeRow), ...field } },
    });
  };

  const armRows: { key: keyof InfieldFormData['arm']; label: string; unit: string }[] = [
    { key: 'velocity', label: 'Arm Velocity', unit: 'mph' },
    { key: 'accuracy', label: 'Arm Accuracy', unit: '% on target' },
  ];

  const rangeRows: { key: keyof InfieldFormData['rangeFootwork']; label: string }[] = [
    { key: 'jumps', label: 'Jumps' },
    { key: 'routes', label: 'Routes' },
    { key: 'rangeGloveSide', label: 'Range \u2014 Glove Side' },
    { key: 'rangeArmSide', label: 'Range \u2014 Arm Side' },
    { key: 'breakdownFootwork', label: 'Break Down Footwork' },
    { key: 'athleticism', label: 'Athleticism' },
  ];

  const handsRows: { key: keyof InfieldFormData['handsGlove']; label: string }[] = [
    { key: 'exchanges', label: 'Exchanges' },
    { key: 'shortHops', label: 'Short Hops' },
    { key: 'forehand', label: 'Forehand' },
    { key: 'backhand', label: 'Backhand' },
    { key: 'doublePlays', label: 'Double Plays' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── ARM STRENGTH & ACCURACY ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>💪</span> Arm Strength & Accuracy
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: rem(12) }}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: 'left', minWidth: 140 }}>Metric</th>
                {[1,2,3].map(n => (
                  <th key={n} style={{ ...headerCellStyle, minWidth: 72 }}>Attempt {n}</th>
                ))}
                <th style={{ ...headerCellStyle, textAlign: 'left', minWidth: 120 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {armRows.map(row => {
                const rowData = data.arm[row.key];
                return (
                  <tr key={row.key}>
                    <td style={metricLabelStyle}>{row.label} — {row.unit}</td>
                    {rowData.attempts.map((val, i) => (
                      <td key={i} style={{ padding: '4px 2px' }}>
                        <input
                          type="text" inputMode="decimal" style={inputStyle}
                          value={val} placeholder="—"
                          onChange={e => updateArmAttempt(row.key, i, e.target.value)}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '4px 2px' }}>
                      <input
                        type="text" style={{ ...inputStyle, textAlign: 'left' }}
                        value={rowData.notes} placeholder="Notes..."
                        onChange={e => updateArm(row.key, { notes: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── RANGE & FOOTWORK ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🏃</span> Range & Footwork — Scouting Grades (20–80)
        </div>
        {/* Grade slider grid — matches the Coach Grades section
           layout (auto-fit, minmax(280px, 1fr)) so each
           DefenseGradeSlider lays out at the same horizontal size
           as a Coach Grade chip (The Gather / Lower Half at Foot
           Strike / etc.). Was previously a vertical flex stack
           which made each slider stretch to 100% modal width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {rangeRows.map(row => {
            const rowData = data.rangeFootwork[row.key] as GradeRow;
            return (
              <DefenseGradeSlider
                key={row.key}
                label={row.label}
                grade={rowData.grade}
                notes={rowData.notes}
                onGradeChange={(v) => updateRange(row.key, { grade: v })}
                onNotesChange={(v) => updateRange(row.key, { notes: v })}
              />
            );
          })}
        </div>
        <DefenseOverallSlider
          label="Overall Range / Footwork"
          grade={data.rangeFootwork.overallGrade}
          onGradeChange={(v) => setData({ ...data, rangeFootwork: { ...data.rangeFootwork, overallGrade: v } })}
        />
      </div>

      {/* ── HANDS & GLOVE WORK ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🧤</span> Hands & Glove Work — Scouting Grades (20–80)
        </div>
        {/* Grade slider grid — matches the Coach Grades section
           layout (auto-fit, minmax(280px, 1fr)) so each
           DefenseGradeSlider lays out at the same horizontal size
           as a Coach Grade chip (The Gather / Lower Half at Foot
           Strike / etc.). Was previously a vertical flex stack
           which made each slider stretch to 100% modal width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {handsRows.map(row => {
            const rowData = data.handsGlove[row.key] as GradeRow;
            return (
              <DefenseGradeSlider
                key={row.key}
                label={row.label}
                grade={rowData.grade}
                notes={rowData.notes}
                onGradeChange={(v) => updateHands(row.key, { grade: v })}
                onNotesChange={(v) => updateHands(row.key, { notes: v })}
              />
            );
          })}
        </div>
        <DefenseOverallSlider
          label="Overall Hands / Glove"
          grade={data.handsGlove.overallGrade}
          onGradeChange={(v) => setData({ ...data, handsGlove: { ...data.handsGlove, overallGrade: v } })}
        />
      </div>
    </div>
  );
}

/* ── Outfield Assessment Form ── */

interface OutfieldFormData {
  // Legacy granular fields — kept for back-compat. New reports write
  // to manualSnapshot below.
  arm: {
    velocity: ArmRow;      // reuse ArmRow (3 attempts + notes) from Infield
    crowHop: ArmRow;
    releaseTime: ArmRow;
    accuracy: ArmRow;
    overallGrade: string;
  };
  routesReads: {
    firstStepJump: GradeRow;
    flyBallBack: GradeRow;
    flyBallIn: GradeRow;
    lineDriveRead: GradeRow;
    routes: GradeRow;
    range: GradeRow;
    gloveWork: GradeRow;
    overallGrade: string;
  };
  /* Snapshot-shape manual inputs — same shape as InfieldFormData so
   * the same DefenseSnapshotForm can render both. */
  manualSnapshot: {
    armStrength: DefenseSnapshotGroup;
    glove:       DefenseSnapshotGroup;
    range:       DefenseSnapshotGroup;
    firstStep:   DefenseSnapshotGroup;
  };
}

function emptyOutfieldForm(): OutfieldFormData {
  return {
    arm: {
      velocity: { ...EMPTY_ARM_ROW, attempts: [...EMPTY_ARM_ROW.attempts] },
      crowHop: { ...EMPTY_ARM_ROW, attempts: [...EMPTY_ARM_ROW.attempts] },
      releaseTime: { ...EMPTY_ARM_ROW, attempts: [...EMPTY_ARM_ROW.attempts] },
      accuracy: { ...EMPTY_ARM_ROW, attempts: [...EMPTY_ARM_ROW.attempts] },
      overallGrade: '',
    },
    routesReads: {
      firstStepJump: { ...EMPTY_GRADE_ROW },
      flyBallBack: { ...EMPTY_GRADE_ROW },
      flyBallIn: { ...EMPTY_GRADE_ROW },
      lineDriveRead: { ...EMPTY_GRADE_ROW },
      routes: { ...EMPTY_GRADE_ROW },
      range: { ...EMPTY_GRADE_ROW },
      gloveWork: { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
    manualSnapshot: {
      armStrength: { ...EMPTY_SNAPSHOT_GROUP },
      glove:       { ...EMPTY_SNAPSHOT_GROUP },
      range:       { ...EMPTY_SNAPSHOT_GROUP },
      firstStep:   { ...EMPTY_SNAPSHOT_GROUP },
    },
  };
}

function buildOutfieldContent(data: OutfieldFormData) {
  const parseArmRow = (row: ArmRow, higherIsBetter: boolean) => {
    const nums = row.attempts.map(a => { const n = parseFloat(a); return isNaN(n) ? null : n; });
    const valid = nums.filter((n): n is number => n !== null);
    return {
      attempts: nums,
      best: valid.length > 0 ? (higherIsBetter ? Math.max(...valid) : Math.min(...valid)) : null,
      avg: valid.length > 0 ? +(valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(1) : null,
      notes: row.notes,
    };
  };
  const parseGrade = (row: GradeRow) => ({
    grade: row.grade ? parseInt(row.grade) || null : null,
    notes: row.notes,
  });
  const parseNum = (s: string) => {
    if (!s) return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };
  const parseSnapshotGroup = (g: DefenseSnapshotGroup) => ({
    primary: parseNum(g.primary),
    secondary: parseNum(g.secondary),
    /* Tertiary parsed defensively — undefined on groups that don't use
       it (Glove / Range / First Step) flows through `parseNum` as null. */
    tertiary: parseNum(g.tertiary ?? ''),
    overallGrade: parseNum(g.overallGrade),
    notes: g.notes,
  });
  return {
    arm: {
      velocity: parseArmRow(data.arm.velocity, true),
      crowHop: parseArmRow(data.arm.crowHop, true),
      releaseTime: parseArmRow(data.arm.releaseTime, false),  // lower time is better
      accuracy: parseArmRow(data.arm.accuracy, true),
      overallGrade: data.arm.overallGrade ? parseInt(data.arm.overallGrade) || null : null,
    },
    routesReads: {
      firstStepJump: parseGrade(data.routesReads.firstStepJump),
      flyBallBack: parseGrade(data.routesReads.flyBallBack),
      flyBallIn: parseGrade(data.routesReads.flyBallIn),
      lineDriveRead: parseGrade(data.routesReads.lineDriveRead),
      routes: parseGrade(data.routesReads.routes),
      range: parseGrade(data.routesReads.range),
      gloveWork: parseGrade(data.routesReads.gloveWork),
      overallGrade: data.routesReads.overallGrade ? parseInt(data.routesReads.overallGrade) || null : null,
    },
    manualSnapshot: {
      armStrength: parseSnapshotGroup(data.manualSnapshot.armStrength),
      glove:       parseSnapshotGroup(data.manualSnapshot.glove),
      range:       parseSnapshotGroup(data.manualSnapshot.range),
      firstStep:   parseSnapshotGroup(data.manualSnapshot.firstStep),
    },
  };
}

function OutfieldForm({ data, setData }: { data: OutfieldFormData; setData: (d: OutfieldFormData) => void }) {
  /* Snapshot-shape body — same four cards as the Infielder Snapshot
   * but with the outfielder accent color. */
  return (
    <div style={{ ...reportOuterBubbleStyle, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Section header in the Pitching report's icon + title style
          (rs.sectionHeader/Icon/Title) so it reads identically to the
          Coach Grades panel below and the Pitching delivery sections. */}
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>🧤</span>
        <span className={rs.sectionTitle}>Outfielder Snapshot</span>
      </div>
      <DefenseSnapshotFormSection
        mode="outfield"
        spec={OUTFIELD_SNAPSHOT_SPEC}
        manualSnapshot={data.manualSnapshot}
        setManualSnapshot={(next) => setData({ ...data, manualSnapshot: next })}
      />
    </div>
  );
}

function OutfieldFormLegacy({ data, setData }: { data: OutfieldFormData; setData: (d: OutfieldFormData) => void }) {
  /* Kept for back-compat alongside InfieldFormLegacy. */
  const updateArm = (key: keyof OutfieldFormData['arm'], field: Partial<ArmRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      arm: { ...data.arm, [key]: { ...(data.arm[key] as ArmRow), ...field } },
    });
  };
  const updateArmAttempt = (key: keyof OutfieldFormData['arm'], idx: number, val: string) => {
    if (key === 'overallGrade') return;
    const row = data.arm[key] as ArmRow;
    const newAttempts = [...row.attempts];
    newAttempts[idx] = val;
    updateArm(key, { attempts: newAttempts });
  };
  const updateRoutes = (key: keyof OutfieldFormData['routesReads'], field: Partial<GradeRow>) => {
    if (key === 'overallGrade') return;
    setData({
      ...data,
      routesReads: { ...data.routesReads, [key]: { ...(data.routesReads[key] as GradeRow), ...field } },
    });
  };

  const armRows: { key: keyof OutfieldFormData['arm']; label: string; unit: string }[] = [
    { key: 'velocity', label: 'Arm Velocity', unit: 'mph' },
    { key: 'crowHop', label: 'Crow Hop', unit: 'mph' },
    { key: 'releaseTime', label: 'Release Time (catch-to-throw)', unit: 'sec' },
    { key: 'accuracy', label: 'Arm Accuracy', unit: '% on target' },
  ];

  const routesRows: { key: keyof OutfieldFormData['routesReads']; label: string }[] = [
    { key: 'firstStepJump', label: 'First-Step Jump' },
    { key: 'flyBallBack', label: 'Fly Ball Read \u2014 Going Back' },
    { key: 'flyBallIn', label: 'Fly Ball Read \u2014 In' },
    { key: 'lineDriveRead', label: 'Line Drive Read' },
    { key: 'routes', label: 'Routes' },
    { key: 'range', label: 'Range' },
    { key: 'gloveWork', label: 'Glove Work' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── ARM STRENGTH & ACCURACY ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>💪</span> Arm Strength & Accuracy
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: rem(12) }}>
            <thead>
              <tr>
                <th style={{ ...headerCellStyle, textAlign: 'left', minWidth: 180 }}>Metric</th>
                {[1,2,3].map(n => (
                  <th key={n} style={{ ...headerCellStyle, minWidth: 72 }}>Attempt {n}</th>
                ))}
                <th style={{ ...headerCellStyle, textAlign: 'left', minWidth: 120 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {armRows.map(row => {
                const rowData = data.arm[row.key] as ArmRow;
                return (
                  <tr key={row.key}>
                    <td style={metricLabelStyle}>{row.label} — {row.unit}</td>
                    {rowData.attempts.map((val, i) => (
                      <td key={i} style={{ padding: '4px 2px' }}>
                        <input
                          type="text" inputMode="decimal" style={inputStyle}
                          value={val} placeholder="—"
                          onChange={e => updateArmAttempt(row.key, i, e.target.value)}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '4px 2px' }}>
                      <input
                        type="text" style={{ ...inputStyle, textAlign: 'left' }}
                        value={rowData.notes} placeholder="Notes..."
                        onChange={e => updateArm(row.key, { notes: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DefenseOverallSlider
          label="Overall Arm Grade"
          grade={data.arm.overallGrade}
          onGradeChange={(v) => setData({ ...data, arm: { ...data.arm, overallGrade: v } })}
        />
      </div>

      {/* ── ROUTES, RANGE, READS & GLOVE ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🏃</span> Routes, Range, Reads & Glove — Scouting Grades (20–80)
        </div>
        {/* Grade slider grid — matches the Coach Grades section
           layout (auto-fit, minmax(280px, 1fr)) so each
           DefenseGradeSlider lays out at the same horizontal size
           as a Coach Grade chip (The Gather / Lower Half at Foot
           Strike / etc.). Was previously a vertical flex stack
           which made each slider stretch to 100% modal width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {routesRows.map(row => {
            const rowData = data.routesReads[row.key] as GradeRow;
            return (
              <DefenseGradeSlider
                key={row.key}
                label={row.label}
                grade={rowData.grade}
                notes={rowData.notes}
                onGradeChange={(v) => updateRoutes(row.key, { grade: v })}
                onNotesChange={(v) => updateRoutes(row.key, { notes: v })}
              />
            );
          })}
        </div>
        <DefenseOverallSlider
          label="Overall Routes / Reads"
          grade={data.routesReads.overallGrade}
          onGradeChange={(v) => setData({ ...data, routesReads: { ...data.routesReads, overallGrade: v } })}
        />
      </div>
    </div>
  );
}

/* ── Modal ── */

interface ReportModalProps {
  player: Player;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the modal opens in EDIT mode for this existing report —
   *  prefills reportType / title / notes and saves via PATCH instead of POST. */
  existingReport?: import('./helpers').ReportSummary | null;
  /** Opens the modal at a specific report-type tab on first render.
   *  Used for the player-side "Edit Profile" entry point — passing
   *  'SUMMARY' lands directly on the personal-details form. */
  initialReportType?: string;
  /** When true, hides the report-type chip row and the modal title flips
   *  to "Edit Profile" — used by the player-side entry point so non-coaches
   *  can edit their personal details without seeing the report flow. */
  profileOnly?: boolean;
}

export function ReportModal({ player, userId, onClose, onSaved, existingReport, initialReportType, profileOnly }: ReportModalProps) {
  const isEdit = !!existingReport;
  const [reportType, setReportType] = useState(existingReport?.reportType || initialReportType || 'HITTING');
  const [csvFiles, setCsvFiles] = useState<Record<string, File | null>>({});
  const [csvResults, setCsvResults] = useState<Record<string, UploadResult | null>>({});
  /* Per-section state — each report-type chip keeps its OWN name, notes, and
     pending video uploads, so a coach can fill out several sections in one
     modal session and save them all as separate reports. The `reportTitle` /
     `notes` / `videos` accessors below bind to the currently-selected
     `reportType`, so every existing render reference keeps working unchanged.
     In edit mode only the one report's type is seeded. */
  const [titlesByType, setTitlesByType] = useState<Record<string, string>>(
    () => (existingReport ? { [existingReport.reportType]: existingReport.title || '' } : {}),
  );
  const [notesByType, setNotesByType] = useState<Record<string, string>>(
    () => (existingReport ? { [existingReport.reportType]: existingReport.notes || '' } : {}),
  );
  const [videosByType, setVideosByType] = useState<Record<string, VideoEntry[]>>({});
  const reportTitle = titlesByType[reportType] ?? '';
  const setReportTitle = (v: string) => setTitlesByType(p => ({ ...p, [reportType]: v }));
  const notes = notesByType[reportType] ?? '';
  const setNotes = (v: string) => setNotesByType(p => ({ ...p, [reportType]: v }));
  const videos = videosByType[reportType] ?? [];
  const setVideos = (v: VideoEntry[]) => setVideosByType(p => ({ ...p, [reportType]: v }));
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // ── Edit-mode prefill: surface previously-attached CSV uploads + videos so
  // the coach can see what's saved and remove or replace it. Both pieces of
  // state are mutated by the form (Remove clicks) and then re-merged in
  // handleSubmit so anything the user kept is preserved.
  const parseExistingContent = (): Record<string, any> => {
    if (!existingReport?.content) return {};
    try { return JSON.parse(existingReport.content) || {}; } catch { return {}; }
  };
  const [existingCsvUploads, setExistingCsvUploads] = useState<Record<string, ExistingUpload>>(() => {
    const c = parseExistingContent();
    return (c.csvUploads && typeof c.csvUploads === 'object') ? { ...c.csvUploads } : {};
  });
  // Top-section videos (Swing) — anything not tagged 'decision' lands here.
  const [existingVideos, setExistingVideos] = useState<ExistingVideo[]>(() => {
    const c = parseExistingContent();
    if (Array.isArray(c.videos)) return c.videos.filter((v: ExistingVideo) => v.section !== 'decision');
    // No content.videos array — fall back to deriving from videoIds (older
    // reports that pre-date the content.videos field).
    if (existingReport?.videoIds) {
      return existingReport.videoIds.split(',').map(s => s.trim()).filter(Boolean)
        .map(id => ({ id, name: `Video ${id.slice(0, 8)}`, size: 0 }));
    }
    return [];
  });
  // Bottom-section videos (Swing Decision) — only entries explicitly tagged
  // 'decision' appear here. New uploads in this section get tagged on save.
  const [existingSwingDecisionVideos, setExistingSwingDecisionVideos] = useState<ExistingVideo[]>(() => {
    const c = parseExistingContent();
    if (Array.isArray(c.videos)) return c.videos.filter((v: ExistingVideo) => v.section === 'decision');
    return [];
  });
  // Swing-decision sub-section state (HITTING reports only). Notes saved at
  // content.swingDecisionNotes; staged videos uploaded + tagged on save.
  const [swingDecisionNotes, setSwingDecisionNotes] = useState<string>(() => {
    const c = parseExistingContent();
    return typeof c.swingDecisionNotes === 'string' ? c.swingDecisionNotes : '';
  });
  const [swingDecisionVideos, setSwingDecisionVideos] = useState<VideoEntry[]>([]);

  /* ── Editor ↔ profile parity for the Videos box ──────────────────
     The Hitting/Pitching/Catching/Infield/Outfield profile sections list
     every clip whose `category` matches the report type — Coach Reviews,
     in-app recordings, AND uploads — not only the clips saved into
     content.videos. Re-opening the editor previously surfaced ONLY
     content.videos, so those category-linked clips appeared "missing".
     Fetch the player's library and show the SAME set here, READ-ONLY:
     these are for context and are NOT folded back into the saved videoIds,
     so editing/saving never mass-links or drops them. */
  const [playerVideos, setPlayerVideos] = useState<api.Video[]>([]);
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const vids = await api.getPlayerVideos(player.id);
        if (!cancelled) setPlayerVideos(vids);
      } catch { /* non-critical — editor still works without the related list */ }
    })();
    return () => { cancelled = true; };
  }, [isEdit, player.id]);
  // IDs already attached to THIS report (videoIds + content.videos) — kept out
  // of the read-only list so attached clips don't double-render.
  const reportLinkedVideoIds = (() => {
    const ids = new Set<string>();
    (existingReport?.videoIds || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => ids.add(id));
    const c = parseExistingContent();
    if (Array.isArray(c.videos)) c.videos.forEach((v: any) => { if (v?.id) ids.add(v.id); });
    return ids;
  })();
  // Category-matched clips for the active report type that aren't already
  // attached — mirrors the profile's `category === <type>` rule.
  const relatedVideos: ExistingVideo[] = isEdit
    ? playerVideos
        .filter(v => v.category === reportType && !reportLinkedVideoIds.has(v.id))
        .map(v => ({ id: v.id, name: v.title, size: 0, url: v.originalUrl || undefined, section: 'swing' as const }))
    : [];

  const emptySummary: SummaryData = {
    firstName: '', lastName: '', positions: [], bats: '', throws: '',
    height: '', weight: '', gradYear: '', birthDate: '', highSchool: '',
    clubTeam: '', pbrNational: '', pbrState: '', pbrPosition: '', pgScore: '',
    collegeCommit: '', logoFile: null,
    playingLevelGoal: '', goals: '',
  };
  const [summaryData, setSummaryData] = useState<SummaryData>(emptySummary);
  /* Catching / Infield / Outfield form data — edit-mode prefill from
     the saved raw form blob (`content.catchingFormData` etc., written
     by the save path below alongside the parsed `catchingAssessment`).
     Older reports that predate the raw-form-blob save fall through to
     `empty*Form()` — a one-time re-entry will preserve data going
     forward. The corresponding profile-side parsers continue reading
     the canonical `catchingAssessment` / `infieldAssessment` /
     `outfieldAssessment` blobs (the raw form is editor-side only). */
  const [catchingData, setCatchingData] = useState<CatchingFormData>(() => {
    if (isEdit && existingReport?.content) {
      try {
        const parsed = JSON.parse(existingReport.content);
        if (parsed?.catchingFormData) return parsed.catchingFormData as CatchingFormData;
      } catch { /* fall through */ }
    }
    return emptyCatchingForm();
  });
  const [infieldData, setInfieldData] = useState<InfieldFormData>(() => {
    if (isEdit && existingReport?.content) {
      try {
        const parsed = JSON.parse(existingReport.content);
        if (parsed?.infieldFormData) return parsed.infieldFormData as InfieldFormData;
      } catch { /* fall through */ }
    }
    return emptyInfieldForm();
  });
  const [outfieldData, setOutfieldData] = useState<OutfieldFormData>(() => {
    if (isEdit && existingReport?.content) {
      try {
        const parsed = JSON.parse(existingReport.content);
        if (parsed?.outfieldFormData) return parsed.outfieldFormData as OutfieldFormData;
      } catch { /* fall through */ }
    }
    return emptyOutfieldForm();
  });
  /* S&C structured form state — populated by `StrengthConditioningForm`.
     When editing an existing STRENGTH report, prefill from the report's
     `content.strengthConditioning` blob (same key the profile tab reads
     out of via `parseSCContent`). New reports start blank via
     `emptyScForm()`. */
  const [scData, setScData] = useState<SCContent>(() => {
    if (isEdit && existingReport?.content) {
      try {
        const parsed = JSON.parse(existingReport.content);
        if (parsed?.strengthConditioning) return parsed.strengthConditioning;
      } catch { /* fall through to empty form */ }
    }
    return emptyScForm();
  });

  // Coach Diagnosis manual scores (HITTING reports). When editing an existing
  // HITTING report, prefill from the report's content.manualScores; otherwise
  // start with all nulls so coaches can grade fresh.
  const [manualScores, setManualScores] = useState<ManualSwingScores>(() =>
    isEdit && existingReport ? getManualSwingScores(existingReport) : {
      forwardMove: null, posture: null, stability: null, direction: null,
      stretch: null, core: null, slot: null, timing: null, stride: null,
    }
  );
  // Multi-select option tags paired with each manual score (descriptive
  // labels like "Drift" / "Tall" / "+Stack"). Stored at content.manualOptions.
  const [manualOptions, setManualOptions] = useState<ManualSwingOptions>(() =>
    isEdit && existingReport ? getManualSwingOptions(existingReport) : {
      forwardMove: [], posture: [], stability: [], direction: [],
      stretch: [], core: [], slot: [], timing: [], stride: [],
    }
  );

  // Pitching grades (PITCHING reports). When editing, prefill from the
  // report's content.pitchingGrades; otherwise start empty so each row reads
  // "—" until the coach grades it.
  const [pitchingGrades, setPitchingGrades] = useState<PitchingGrades>(() =>
    isEdit && existingReport ? getPitchingGrades(existingReport) : {}
  );

  /* Defense Coach Grades (CATCHING / INFIELD / OUTFIELD reports). Each
     defense position gets its own 7-section grade slot persisted at
     content.{position}CoachGrades. When editing an existing report,
     prefill from that slot; otherwise start empty. Same simplified
     shape (`DefenseCoachGrades = Record<sectionKey, number|null>`)
     across all three so coaches see / grade the same 7 categories
     regardless of position. */
  const [catchingCoachGrades, setCatchingCoachGrades] = useState<DefenseCoachGrades>(() =>
    isEdit && existingReport ? getDefenseCoachGrades(existingReport, 'catching') : {}
  );
  const [infieldCoachGrades, setInfieldCoachGrades] = useState<DefenseCoachGrades>(() =>
    isEdit && existingReport ? getDefenseCoachGrades(existingReport, 'infield') : {}
  );
  const [outfieldCoachGrades, setOutfieldCoachGrades] = useState<DefenseCoachGrades>(() =>
    isEdit && existingReport ? getDefenseCoachGrades(existingReport, 'outfield') : {}
  );

  /* Per-CSV-slot manual entry — coaches can flip an individual CSV
     card into "Manual Entry" mode and fill in the same metrics directly.
     Slots that opt-in: blast (Swing Metrics) → manualSwingMetrics,
     fullswing (Batted Ball Metrics) → manualBattedBall. */
  const [manualBattedBall, setManualBattedBall] = useState<ManualBattedBall>(() =>
    isEdit && existingReport ? getManualBattedBall(existingReport) : {
      avg_exit_velo: null, squared_up_pct: null, smash_factor: null,
      launch_angle: null, distance: null,
    },
  );
  const [manualSwingMetrics, setManualSwingMetrics] = useState<ManualSwingMetrics>(() =>
    isEdit && existingReport ? getManualSwingMetrics(existingReport) : {
      max_bat_speed: null, avg_bat_speed: null,
      attack_angle: null, plane_angle: null,
      time_to_contact: null, on_plane_efficiency: null,
      connection_at_contact: null, rotational_acceleration: null,
      /* Blast CSV spec additions — coaches can hand-enter these on
         a report when no CSV is uploaded. Default to null so they
         render as empty inputs until populated. */
      plane_score: null, connection_score: null, rotation_score: null,
      early_connection: null, connection_at_impact: null,
    },
  );
  /* Per-slot toggle — true when the coach has flipped that card into
     manual-entry mode. Default for every slot is CSV-upload mode (off).
     In edit mode we ONLY restore the toggle to ON when the saved content
     has an explicit `manualEntryModes` marker for that slot. Reports that
     pre-date the marker (or were saved with manual-mode off) always open
     in CSV mode — even if stale manualBattedBall / manualSwingMetrics
     values are still sitting in content from older saves. This stops
     the form from auto-populating with leftover 0%-style values that
     then get re-saved into the report. */
  const [manualMode, setManualMode] = useState<Record<string, boolean>>(() => {
    if (!isEdit || !existingReport) return {};
    try {
      const c = parseExistingContent();
      const m = c?.manualEntryModes;
      const out: Record<string, boolean> = {};
      if (m && m.fullswing) out.fullswing = true;
      if (m && m.blast)     out.blast     = true;
      return out;
    } catch { return {}; }
  });

  // Pre-fill summary from player
  useEffect(() => {
    const inchesToHeight = (inches: number | null): string => {
      if (!inches) return '';
      return `${Math.floor(inches / 12)}'${inches % 12}"`;
    };
    setSummaryData({
      firstName: player.firstName || '', lastName: player.lastName || '',
      positions: player.positions ? player.positions.split(',').map(s => s.trim()) : [],
      bats: player.bats || '', throws: player.throws || '',
      height: inchesToHeight(player.heightInches), weight: player.weightLbs ? String(player.weightLbs) : '',
      gradYear: player.gradYear ? String(player.gradYear) : '',
      birthDate: player.birthDate ? player.birthDate.slice(0, 10) : '',
      highSchool: player.highSchool || '', clubTeam: player.clubTeam || '',
      pbrNational: player.pbrNational ? String(player.pbrNational) : '',
      pbrState: player.pbrState ? String(player.pbrState) : '',
      pbrPosition: player.pbrPosition ? String(player.pbrPosition) : '',
      pgScore: player.pgScore ? String(player.pgScore) : '',
      collegeCommit: player.collegeCommit || '', logoFile: null,
      playingLevelGoal: (player as any).playingLevelGoal || '', goals: (player as any).goals || '',
    });
  }, [player]);

  /* The old "reset CSV files + catching/infield/outfield form on report-type
     change" effect was REMOVED so a coach can fill out multiple sections in
     one modal session without losing each section's data when switching chips.
     Each section's state is independent (per-type grade state + the per-section
     title/notes/videos accessors above), and `csvFiles` is keyed by slot —
     slot keys are unique per report type — so the sections never collide.
     Initial state still comes from the useState initializers (empty for new
     reports, the saved blob in edit mode). */

  const csvSlots = REPORT_CSV_SLOTS[reportType] || [];

  /* Report types that can each become their own report (SUMMARY is the
     player-profile editor, handled separately). */
  const REPORT_DATA_TYPES = ['HITTING', 'PITCHING', 'CATCHING', 'INFIELD', 'OUTFIELD', 'STRENGTH'];

  /* Does a given section have anything worth saving? Drives which separate
     reports get created on a multi-section save — checks the section's name,
     notes, pending videos, selected CSVs, and its type-specific grade data. */
  const sectionHasData = (t: string): boolean => {
    if ((titlesByType[t] ?? '').trim()) return true;
    if ((notesByType[t] ?? '').trim()) return true;
    if ((videosByType[t] ?? []).length > 0) return true;
    if ((REPORT_CSV_SLOTS[t] || []).some(s => csvFiles[s.key])) return true;
    switch (t) {
      case 'HITTING':
        return Object.values(manualScores).some(v => v != null)
          || Object.values(manualOptions).some((a: any) => a?.length)
          || manualMode.fullswing || manualMode.blast
          || swingDecisionNotes.trim().length > 0 || swingDecisionVideos.length > 0;
      case 'PITCHING':
        return Object.values(pitchingGrades).some((e: any) => e?.score != null || (e?.options?.length));
      case 'CATCHING':
        return JSON.stringify(catchingData) !== JSON.stringify(emptyCatchingForm())
          || Object.values(catchingCoachGrades).some(v => v != null);
      case 'INFIELD':
        return JSON.stringify(infieldData) !== JSON.stringify(emptyInfieldForm())
          || Object.values(infieldCoachGrades).some(v => v != null);
      case 'OUTFIELD':
        return JSON.stringify(outfieldData) !== JSON.stringify(emptyOutfieldForm())
          || Object.values(outfieldCoachGrades).some(v => v != null);
      case 'STRENGTH':
        return JSON.stringify(scData) !== JSON.stringify(emptyScForm());
      default:
        return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (reportType === 'SUMMARY') {
        /* Normalize positions on save — strips umbrella codes that have
           been superseded by specific codes (e.g. drops "INF" when
           1B/2B/3B/SS are also present, drops "OF" when LF/CF/RF are
           present). Lets legacy data set via the New Player form's
           umbrella picker self-heal as coaches re-save profiles
           through this modal's specific-codes picker. See
           `normalizePositionsForSave` in helpers.ts for the rule. */
        const normalizedPositions = normalizePositionsForSave(summaryData.positions);
        await api.updatePlayer(player.id, {
          firstName: summaryData.firstName || undefined, lastName: summaryData.lastName || undefined,
          positions: normalizedPositions.join(',') || undefined,
          bats: summaryData.bats || null, throws: summaryData.throws || null,
          heightInches: heightToInches(summaryData.height), weightLbs: summaryData.weight ? parseInt(summaryData.weight) : null,
          gradYear: summaryData.gradYear ? parseInt(summaryData.gradYear) : null,
          birthDate: summaryData.birthDate || null, highSchool: summaryData.highSchool || null,
          clubTeam: summaryData.clubTeam || null,
          pbrNational: summaryData.pbrNational ? parseInt(summaryData.pbrNational) : null,
          pbrState: summaryData.pbrState ? parseInt(summaryData.pbrState) : null,
          pbrPosition: summaryData.pbrPosition ? parseInt(summaryData.pbrPosition) : null,
          pgScore: summaryData.pgScore ? parseFloat(summaryData.pgScore) : null,
          collegeCommit: summaryData.collegeCommit || null,
          playingLevelGoal: summaryData.playingLevelGoal || null,
          goals: summaryData.goals || null,
        } as any);
      } else {
        /* Save a SEPARATE report for every section that has data (new
           reports); edit mode updates just the one existing report. Each loop
           iteration shadows reportType / csvSlots / videos / reportTitle /
           notes with THIS section's values, so the whole existing save body
           below runs per-section without further changes. */
        /* EDIT: always save back to the existing report's OWN type — never a
           switched-to type. The UI now locks the type chips in edit mode, and
           this is the belt-and-suspenders behind that lock: even if reportType
           were somehow different, an edit can only ever rewrite the report it
           opened, with that report's type's content. This is what prevents the
           "edit Pitching → pick Catching → save" overwrite. */
        let typesToSave = (isEdit && existingReport)
          ? [existingReport.reportType]
          : REPORT_DATA_TYPES.filter(sectionHasData);
        if (typesToSave.length === 0) typesToSave = [reportType];
        for (const saveType of typesToSave) {
        const reportType = saveType;
        const csvSlots = REPORT_CSV_SLOTS[saveType] || [];
        const videos = videosByType[saveType] ?? [];
        const reportTitle = titlesByType[saveType] ?? '';
        const notes = notesByType[saveType] ?? '';
        const uploadSummary: Record<string, any> = {};
        let atBatData: any = null;
        for (const slot of csvSlots) {
          const file = csvFiles[slot.key];
          if (!file) continue;
          setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'processing' as const, message: 'Uploading...' } }));
          try {
            // At-Bat Assessment: parse XLSX on frontend, store in report content
            if (slot.vendor === 'AtBat') {
              const buf = await file.arrayBuffer();
              const parsed = parseAtBatXlsx(buf);
              atBatData = parsed;
              uploadSummary[slot.key] = { vendor: 'AtBat', atBats: parsed.atBats.length, playerName: parsed.playerName };
              setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'success', message: `${parsed.atBats.length} at-bats parsed with ${parsed.atBats.reduce((s: number, ab: any) => s + ab.pitches.length, 0)} total pitches`, rows: parsed.atBats.length, metrics: 11 } }));
              continue;
            }
            const sourceMap: Record<string, string> = {
              'Blast Motion': 'BLAST_MOTION', 'Full Swing': 'FULL_SWING', 'HitTrax': 'HITTRAX',
              'TrackMan': 'TRACKMAN', 'VALD': 'VALD', 'Vizual Edge': 'VIZUAL_EDGE',
              'Custom': 'AUTO_DETECT',
            };
            const result = await api.uploadCSV(file, userId, sourceMap[slot.vendor], player.id);
            uploadSummary[slot.key] = { vendor: slot.vendor, rows: result.totalRows, metrics: result.metricsCreated, uploadId: result.uploadId };
            setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'success', message: `${result.metricsCreated} metrics from ${result.totalRows} rows`, rows: result.totalRows, metrics: result.metricsCreated } }));
          } catch (err: any) {
            setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'error', message: err?.message || 'Upload failed' } }));
            uploadSummary[slot.key] = { vendor: slot.vendor, error: err?.message };
          }
        }
        // Upload video files. HITTING reports have a second pool of pending
        // videos staged in the Swing Decision sub-section — those get tagged
        // section: 'decision' so we can split them apart on the next edit.
        type SavedVideo = { name: string; size: number; id?: string; url?: string; section?: 'swing' | 'decision' };
        const uploadVideos = async (entries: VideoEntry[], section: 'swing' | 'decision') => {
          /* Pre-compute per-bundle indices BEFORE firing off uploads so
             each video in a bundle gets a unique " - Angle N" suffix.
             This used to live inside the per-upload loop, where the
             `bundleCounters` map mutated as titles were generated
             sequentially. Now that uploads fire in parallel below
             (see `Promise.all`), the title generation MUST happen up
             front so the assignment is deterministic. The shared
             bundle prefix ("Training - <ReportType> - Upload
             <bundleId>") + the per-clip angle suffix is exactly the
             title shape `bundleVideos` detects as a multi-angle group
             at display time. Reuses the same naming convention Live
             Training clips ship with, so the gallery treats Report
             bundles and Training bundles identically. */
          const bundleCounters = new Map<string, number>();
          const titledEntries = entries.map((v) => {
            let title: string;
            if (!v.bundleId) {
              /* Single-zone upload — keep the original filename so
                 the gallery surfaces the user's chosen name. */
              title = v.file.name.replace(/\.[^.]+$/, '');
            } else {
              /* Bundle upload — generate a Training-style title. The
                 numeric tail of the bundleId keeps the prefix readable
                 (no full UUID exposed in the title). */
              const shortBundle = v.bundleId.split('-').slice(-1)[0] || v.bundleId;
              const angleIdx = (bundleCounters.get(v.bundleId) ?? 0) + 1;
              bundleCounters.set(v.bundleId, angleIdx);
              const cat = (reportType || 'REPORT').toString();
              title = `Training - ${cat} - Upload ${shortBundle} - Angle ${angleIdx}`;
            }
            return { entry: v, title };
          });

          /* Fire every upload in parallel via Promise.all instead of
             the prior `for…await` sequential loop. Sequential meant a
             3-video report waited for video 1 to finish before video 2
             even started — at the new adaptive 4K-up-to-240 fps capture
             bitrates a single clip can be 100+ MB, so a sequential
             save would block for ~3× a single upload's time. Parallel
             keeps the wait at roughly the slowest single upload (the
             browser still respects HTTP/1.1's per-origin connection
             cap, but modern browsers run 6 in flight by default — way
             more than typical report video counts). Per-video errors
             are caught individually so one failed upload doesn't kill
             the whole save; the catch arm preserves the same
             `name + size` shape with no `id`, matching the original
             error path. */
          const results = await Promise.all(
            titledEntries.map(async ({ entry: v, title }) => {
              try {
                const result = await api.uploadVideo(v.file, player.id, title, reportType);
                return {
                  saved: {
                    name: v.file.name,
                    size: v.file.size,
                    id: result.id,
                    url: result.originalUrl || undefined,
                    section,
                  } as SavedVideo,
                  id: result.id as string | undefined,
                };
              } catch (err: any) {
                console.error('Video upload failed:', err);
                return {
                  saved: { name: v.file.name, size: v.file.size, section } as SavedVideo,
                  id: undefined,
                };
              }
            }),
          );

          const ids: string[] = results.map((r) => r.id).filter((x): x is string => !!x);
          const saved: SavedVideo[] = results.map((r) => r.saved);
          return { ids, saved };
        };
        /* Swing and Swing-Decision uploads now fire in parallel — was
           sequential (`await swing; await decision;`). The decision
           pool only exists on HITTING reports; everything else
           resolves an empty no-op so the two arms always co-exist
           in the Promise.all. */
        const [swingUpload, decisionUpload] = await Promise.all([
          uploadVideos(videos, 'swing'),
          reportType === 'HITTING'
            ? uploadVideos(swingDecisionVideos, 'decision')
            : Promise.resolve({ ids: [] as string[], saved: [] as SavedVideo[] }),
        ]);
        const uploadedVideoIds = [...swingUpload.ids, ...decisionUpload.ids];

        // In edit mode, MERGE the new content keys over the existing report's
        // content JSON so we don't drop fields the modal doesn't manage
        // (manualScores, diagnosisNotes, etc. saved by other UIs).
        // CSV / video MERGE rules:
        //  - Start with the existing entries the user *kept* (they may have
        //    removed slots/videos in the form — those are gone now).
        //  - Layer newly-uploaded CSV slots over the kept existing slots
        //    (a Replace action drops the existing entry first, so the new
        //     upload simply takes its slot).
        //  - Tag every video with its section so the next edit can split them
        //    back into the Swing vs Swing Decision lists.
        let prevContent: Record<string, any> = {};
        if (isEdit && existingReport?.content) {
          try { prevContent = JSON.parse(existingReport.content) || {}; } catch { /* ignore */ }
        }
        const mergedCsvUploads = { ...existingCsvUploads, ...uploadSummary };
        const tagSwing    = (v: ExistingVideo): SavedVideo => ({ ...v, section: 'swing' });
        const tagDecision = (v: ExistingVideo): SavedVideo => ({ ...v, section: 'decision' });
        const mergedVideos: SavedVideo[] = [
          ...existingVideos.map(tagSwing),
          ...(reportType === 'HITTING' ? existingSwingDecisionVideos.map(tagDecision) : []),
          ...swingUpload.saved,
          ...decisionUpload.saved,
        ];
        /* At-Bat assessment lifecycle:
             • New XLSX uploaded → atBatData truthy → save the freshly parsed block.
             • Existing slot kept (no new upload, but slot still in
               existingCsvUploads) → leave prevContent.atBatAssessment alone.
             • Slot was removed in the modal (no new upload AND not in
               existingCsvUploads) → explicitly clear prevContent's stale
               atBatAssessment so the at-bat metrics stop feeding the snapshot.
           Without this last branch, removing the at-bat XLSX from a report
           left the parsed metrics inside content.atBatAssessment and the
           snapshot kept showing them. */
        const atBatStillPresent = !!atBatData || !!existingCsvUploads.atbat;
        const newContent = {
          ...prevContent,
          ...(Object.keys(mergedCsvUploads).length > 0 ? { csvUploads: mergedCsvUploads } : { csvUploads: undefined }),
          ...(mergedVideos.length > 0 ? { videos: mergedVideos } : { videos: undefined }),
          ...(atBatData
              ? { atBatAssessment: atBatData }
              : atBatStillPresent
                ? {}
                : { atBatAssessment: undefined }),
          ...(reportType === 'CATCHING' ? {
            catchingAssessment: buildCatchingContent(catchingData),
            /* Raw editor form blob — kept verbatim alongside the
               parsed `catchingAssessment` so re-opening the report
               for edit can restore the exact form state (strings,
               attempt arrays, notes, etc.) instead of starting blank.
               The profile read path keeps using `catchingAssessment`;
               this field is editor-only. */
            catchingFormData: catchingData,
            /* 7-section defense Coach Grades — persisted as a flat
               Record<sectionKey, number|null> at
               content.catchingCoachGrades so the profile tab can
               read it back via `getDefenseCoachGrades`. */
            catchingCoachGrades,
          } : {}),
          ...(reportType === 'INFIELD' ? {
            infieldAssessment: buildInfieldContent(infieldData),
            infieldFormData: infieldData,
            infieldCoachGrades,
          } : {}),
          ...(reportType === 'OUTFIELD' ? {
            outfieldAssessment: buildOutfieldContent(outfieldData),
            outfieldFormData: outfieldData,
            outfieldCoachGrades,
          } : {}),
          /* STRENGTH reports serialize the structured S&C form blob
             under `strengthConditioning` so the profile S&C tab's
             `parseSCContent` helper can read it back on render. */
          ...(reportType === 'STRENGTH' ? { strengthConditioning: scData } : {}),
          ...(reportType === 'HITTING' ? {
            manualScores: {
              forwardMove: manualScores.forwardMove,
              posture:     manualScores.posture,
              stability:   manualScores.stability,
              direction:   manualScores.direction,
              stretch:     manualScores.stretch,
              core:        manualScores.core,
              slot:        manualScores.slot,
              timing:      manualScores.timing,
              stride:      manualScores.stride,
              updatedAt:   new Date().toISOString(),
              updatedBy:   userId,
            },
            // Multi-select descriptive tags for each Coach Diagnosis category
            // (e.g. forwardMove: ['Drift']). Always written so removals stick.
            manualOptions: { ...manualOptions },
            /* Per-CSV-slot manual entries — ONLY written when the slot's
               Manual Entry toggle is ON. When the coach disables manual
               mode (or removes the slot entirely), we save an empty object
               so previously-typed values stop counting as "the report has
               Full Swing / Blast data" and the matching Snapshot section
               correctly hides. */
            manualBattedBall: manualMode.fullswing
              ? { ...manualBattedBall }
              : { avg_exit_velo: null, squared_up_pct: null, smash_factor: null,
                  launch_angle: null, distance: null },
            manualSwingMetrics: manualMode.blast
              ? { ...manualSwingMetrics }
              : { max_bat_speed: null, avg_bat_speed: null,
                  attack_angle: null, plane_angle: null,
                  time_to_contact: null, on_plane_efficiency: null,
                  connection_at_contact: null, rotational_acceleration: null },
            /* Persist the manual-mode flags so the read side can tell
               whether a manualBattedBall / manualSwingMetrics block
               represents real manual data or just leftover persisted
               values from a save before the toggle was added. */
            manualEntryModes: {
              fullswing: !!manualMode.fullswing,
              blast: !!manualMode.blast,
            },
            // Swing Decision sub-section notes — empty string clears the field.
            swingDecisionNotes: swingDecisionNotes || undefined,
          } : {}),
          ...(reportType === 'PITCHING' ? {
            // 7-section delivery grades (score + multi-select tags per item).
            // Saved every submit so removed entries propagate cleanly.
            pitchingGrades: {
              ...pitchingGrades,
              updatedAt: new Date().toISOString(),
              updatedBy: userId,
            },
          } : {}),
        };
        const content = JSON.stringify(newContent);
        if (isEdit && existingReport) {
          // videoIds = kept-existing video IDs (both sections) + newly-uploaded IDs.
          // (We don't fall back to existingReport.videoIds — anything the user
          // removed in the form is intentionally dropped from the link.)
          const keptIds = [
            ...existingVideos.map(v => v.id).filter((x): x is string => !!x),
            ...(reportType === 'HITTING' ? existingSwingDecisionVideos.map(v => v.id).filter((x): x is string => !!x) : []),
          ];
          const combinedIds = [...keptIds, ...uploadedVideoIds];
          await api.updateReport(existingReport.id, {
            title: reportTitle || undefined,
            content,
            notes: notes || undefined,
            videoIds: combinedIds.length > 0 ? combinedIds.join(',') : '',
          });
        } else {
          await api.createReport({
            playerId: player.id,
            createdById: userId,
            reportType,
            title: reportTitle || undefined,
            content,
            notes: notes || undefined,
            videoIds: uploadedVideoIds.length > 0 ? uploadedVideoIds.join(',') : undefined,
          });
        }
        } // end for (const saveType of typesToSave) — one report per filled section
      }
      setSuccess(true);
      onSaved();
      setTimeout(() => { setSuccess(false); onClose(); }, 1500);
    } catch (err: any) {
      alert(err?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 className={styles.modalTitle}>
              {reportType === 'SUMMARY' ? 'Edit Profile' : 'New Report'} — {player.firstName} {player.lastName}
            </h2>
            {/* Edit Profile toggles to/from the Summary form. The chip was
                removed from REPORT_TYPES, so this is the only entry point.
                Hidden in profileOnly mode (player edit-profile entry) since
                the player shouldn't see the report flow at all. */}
            {/* Hidden while editing an existing report — you're editing that
                one report, not the profile (prevents an accidental jump to the
                Summary/profile form mid-edit). */}
            {!profileOnly && !isEdit && (
              <button
                type="button"
                onClick={() => {
                  if (reportType === 'SUMMARY') {
                    setReportType('HITTING');
                  } else {
                    setReportType('SUMMARY');
                    setNotes(''); setVideos([]); setExistingCsvUploads({}); setExistingVideos([]);
                    setSwingDecisionNotes(''); setSwingDecisionVideos([]); setExistingSwingDecisionVideos([]);
                  }
                }}
                style={{
                  background: reportType === 'SUMMARY' ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                  color: reportType === 'SUMMARY' ? '#000' : 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '6px 12px',
                  fontSize: rem(12),
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title={reportType === 'SUMMARY' ? 'Back to report upload' : 'Edit player profile information'}
              >
                {reportType === 'SUMMARY' ? '← Back to Reports' : 'Edit Profile'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Eye toggle — hides/shows the corresponding profile tab
                for the currently-selected report type. Lives at the top
                of the modal "across from" the report name in the
                header, so coaches can pre-set visibility per athlete.
                Suppressed for SUMMARY (no matching profile tab) and for
                the profile-only (player edit-profile) entry. */}
            {!profileOnly && reportType !== 'SUMMARY' && REPORT_TYPE_TO_TAB[reportType] && (
              <EyeVisibilityToggle
                playerId={player.id}
                tabKey={REPORT_TYPE_TO_TAB[reportType]}
                tabLabel={REPORT_TYPES.find(t => t.id === reportType)?.label ?? reportType}
              />
            )}
            <button type="button" className={styles.modalClose} onClick={onClose}>x</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalBody}>
          {/* Report type chips — cleaner, segmented row.
              Hidden entirely in profileOnly mode so the player only sees
              the SUMMARY form fields. */}
          {!profileOnly && (
          <div className={rs.fieldGroup}>
            <label className={rs.label}>Report Type</label>
            <div className={rs.chipRow}>
              {REPORT_TYPES.map(t => {
                /* EDIT MODE: the report type is LOCKED to the report being
                   edited. Switching it would make the save write THIS type's
                   content over the existing (different-type) report and
                   silently corrupt it — exactly the bug where editing a
                   Pitching report, clicking Catching, and saving overwrote
                   the Pitching report with Catching data. A report is one
                   type; to add another type, create a NEW report. */
                const locked = isEdit && t.id !== reportType;
                return (
                  <button key={t.id} type="button"
                    disabled={locked}
                    className={`${rs.chip} ${reportType === t.id ? rs.chipActive : ''}`}
                    title={isEdit ? 'Report type is locked while editing an existing report' : undefined}
                    style={locked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    onClick={isEdit ? undefined : () => {
                      /* CREATE MODE: switch which section is visible. NO state
                         reset — each section's grades / notes / videos / name
                         persist per-type so a coach can fill several sections
                         and the multi-save writes a SEPARATE report for each.
                         (The old reset here wiped pitchingGrades / manualOptions
                         and the leaving section's notes+videos on every switch,
                         which broke the fill-many-save-once workflow.) */
                      setReportType(t.id);
                    }}>
                    <span className={rs.chipIcon}>{t.icon}</span>{t.label}
                  </button>
                );
              })}
            </div>
          </div>
          )}

          {/* Report Name */}
          {reportType !== 'SUMMARY' && (
            <div className={rs.fieldGroup}>
              <label className={rs.label}>Report Name</label>
              <input
                type="text"
                className={rs.summaryInput}
                value={reportTitle}
                onChange={e => setReportTitle(e.target.value)}
                placeholder="e.g. Spring Assessment, Weekly Session 3..."
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* Summary form / Catching form / CSV+Notes+Videos */}
          {reportType === 'SUMMARY' ? (
            <SummaryForm data={summaryData} setData={setSummaryData} />
          ) : reportType === 'CATCHING' ? (
            <>
              <CatchingForm data={catchingData} setData={setCatchingData} />
              {/* Standalone Coach Grades section retired per coach-spec —
                  the four delivery-mechanics checkpoints (Arm Path /
                  Foot Strike Position / Rotation Sequence / Arm
                  Deceleration) are now graded inline in CatchingForm's
                  Throwing Grades section alongside Footwork / Transfer
                  / Accuracy, so the catching report doesn't need the
                  separate `DefenseCoachGradesSection` block.
                  (`catchingCoachGrades` state stays for back-compat —
                  older reports still read it on the profile.) */}
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <RichTextEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Overall catching assessment notes, areas to develop..."
                  minHeight={120}
                />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} relatedVideos={relatedVideos} />
            </>
          ) : reportType === 'INFIELD' ? (
            <>
              <InfieldForm data={infieldData} setData={setInfieldData} />
              <DefenseCoachGradesSection
                grades={infieldCoachGrades}
                setGrades={setInfieldCoachGrades}
              />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <RichTextEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Infield defensive assessment notes, areas to develop..."
                  minHeight={120}
                />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} relatedVideos={relatedVideos} />
            </>
          ) : reportType === 'OUTFIELD' ? (
            <>
              <OutfieldForm data={outfieldData} setData={setOutfieldData} />
              <DefenseCoachGradesSection
                grades={outfieldCoachGrades}
                setGrades={setOutfieldCoachGrades}
              />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <RichTextEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Outfield defensive assessment notes, areas to develop..."
                  minHeight={120}
                />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} relatedVideos={relatedVideos} />
            </>
          ) : reportType === 'STRENGTH' ? (
            <>
              {/* S&C structured form — mirrors the profile S&C tab
                 layout 1:1 (3 big-blue panels, warm-grey Curveball
                 sub-bubbles, sub-tab bar, 12-card mobility battery)
                 but every read-only display is now an editable input.
                 Result blob persists under
                 `content.strengthConditioning` on save and gets
                 read back by `parseSCContent` on the profile tab. */}
              <StrengthConditioningForm data={scData} setData={setScData} />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>General Mechanical Notes</span></div>
                <RichTextEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Delivery observations, cues given, follow-ups — any cross-section observations not captured above…"
                  minHeight={140}
                />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} relatedVideos={relatedVideos} />
            </>
          ) : (
            <>
              {reportType === 'HITTING' && (
                <CoachDiagnosisSliders
                  scores={manualScores} setScores={setManualScores}
                  options={manualOptions} setOptions={setManualOptions}
                />
              )}
              {reportType === 'PITCHING' && (
                <PitchingGradesSections grades={pitchingGrades} setGrades={setPitchingGrades} />
              )}
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                {/* Both Hitting AND every other report type use the same
                    global RichTextEditor for the primary Notes field —
                    Bold / Italic / Underline + font-size dropdown. Stores
                    HTML so formatting persists into the snapshot, the
                    notes box on the PDF, and round-trips on re-edit. */}
                <RichTextEditor
                  value={notes}
                  onChange={setNotes}
                  placeholder="Session observations, development notes, drill recommendations..."
                  minHeight={reportType === 'HITTING' ? 220 : 120}
                />
              </div>
              {/* HITTING reports split CSV slots into two visual groups —
                  Swing (Blast / Full Swing) and Swing Decision (At-Bat).
                  Other report types render a single Data Imports group. */}
              {(() => {
                const swingGroup = reportType === 'HITTING'
                  ? csvSlots.filter(s => s.group !== 'decision')
                  : csvSlots;
                if (swingGroup.length === 0) return null;
                return (
                  <div className={rs.section}>
                    <div className={rs.sectionHeader}>
                      <span className={rs.sectionIcon}>📊</span>
                      <span className={rs.sectionTitle}>Data Imports</span>
                      <span className={rs.sectionCount}>{swingGroup.length} {swingGroup.length === 1 ? 'source' : 'sources'}</span>
                    </div>
                    <div className={rs.csvGrid}>
                      {swingGroup.map(slot => {
                        /* Only HITTING's Blast (swing metrics) + Full Swing
                           (batted ball metrics) cards expose a Manual Entry
                           toggle. Everything else stays CSV-only. */
                        const supportsManual = reportType === 'HITTING'
                          && (slot.key === 'blast' || slot.key === 'fullswing');
                        const isManual = supportsManual && !!manualMode[slot.key];
                        const setBb = (key: keyof ManualBattedBall, raw: string) =>
                          setManualBattedBall(prev => ({
                            ...prev,
                            [key]: raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : prev[key]),
                          }));
                        const setSw = (key: keyof ManualSwingMetrics, raw: string) =>
                          setManualSwingMetrics(prev => ({
                            ...prev,
                            [key]: raw === '' ? null : (Number.isFinite(Number(raw)) ? Number(raw) : prev[key]),
                          }));
                        const manualNode = isManual
                          ? (slot.key === 'blast' ? (
                              <ManualMetricBubbles
                                fields={MANUAL_SWING_METRIC_FIELDS}
                                values={manualSwingMetrics}
                                onChange={setSw}
                              />
                            ) : (
                              <ManualMetricBubbles
                                fields={MANUAL_BATTED_BALL_FIELDS}
                                values={manualBattedBall}
                                onChange={setBb}
                              />
                            ))
                          : undefined;
                        return (
                          <CsvUploadCard key={slot.key} slot={slot} file={csvFiles[slot.key] || null} uploadResult={csvResults[slot.key] || null}
                            existingUpload={existingCsvUploads[slot.key] || null}
                            onSelect={f => setCsvFiles(prev => ({ ...prev, [slot.key]: f }))}
                            onRemove={() => { setCsvFiles(prev => ({ ...prev, [slot.key]: null })); setCsvResults(prev => ({ ...prev, [slot.key]: null })); }}
                            onRemoveExisting={() => setExistingCsvUploads(prev => { const n = { ...prev }; delete n[slot.key]; return n; })}
                            manualMode={isManual}
                            onToggleManual={supportsManual
                              ? () => setManualMode(prev => ({ ...prev, [slot.key]: !prev[slot.key] }))
                              : undefined}
                            manualNode={manualNode} />
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} relatedVideos={relatedVideos} />

              {/* ── Swing Decision sub-section (HITTING only) ──
                  Has its OWN notes textarea, At-Bat XLSX slot, and video list.
                  Saved into the same HITTING report — videos get tagged with
                  section: 'decision' so the modal can split them apart on
                  next edit. */}
              {reportType === 'HITTING' && (() => {
                const decisionGroup = csvSlots.filter(s => s.group === 'decision');
                return (
                  <>
                    <div style={{ height: 1, background: 'var(--border)', margin: '12px 0 4px' }} />
                    <div className={rs.section} style={{ paddingTop: 8 }}>
                      <div className={rs.sectionHeader}>
                        <span className={rs.sectionIcon}>🎯</span>
                        <span className={rs.sectionTitle}>Swing Decision</span>
                      </div>
                    </div>
                    <div className={rs.section}>
                      <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                      <RichTextEditor
                        value={swingDecisionNotes}
                        onChange={setSwingDecisionNotes}
                        placeholder="At-bat approach, plate discipline, decision quality..."
                        minHeight={120}
                      />
                    </div>
                    {decisionGroup.length > 0 && (
                      <div className={rs.section}>
                        <div className={rs.sectionHeader}>
                          <span className={rs.sectionIcon}>📊</span>
                          <span className={rs.sectionTitle}>Data Imports</span>
                          <span className={rs.sectionCount}>{decisionGroup.length} {decisionGroup.length === 1 ? 'source' : 'sources'}</span>
                        </div>
                        <div className={rs.csvGrid}>
                          {decisionGroup.map(slot => (
                            <CsvUploadCard key={slot.key} slot={slot} file={csvFiles[slot.key] || null} uploadResult={csvResults[slot.key] || null}
                              existingUpload={existingCsvUploads[slot.key] || null}
                              onSelect={f => setCsvFiles(prev => ({ ...prev, [slot.key]: f }))}
                              onRemove={() => { setCsvFiles(prev => ({ ...prev, [slot.key]: null })); setCsvResults(prev => ({ ...prev, [slot.key]: null })); }}
                              onRemoveExisting={() => setExistingCsvUploads(prev => { const n = { ...prev }; delete n[slot.key]; return n; })} />
                          ))}
                        </div>
                      </div>
                    )}
                    <VideoSection
                      videos={swingDecisionVideos} setVideos={setSwingDecisionVideos}
                      existingVideos={existingSwingDecisionVideos} setExistingVideos={setExistingSwingDecisionVideos}
                    />
                  </>
                );
              })()}
            </>
          )}

          {/* Submit */}
          <div className={rs.submitRow}>
            <button type="submit" className={rs.submitBtn} disabled={submitting}>
              {submitting ? (reportType === 'SUMMARY' ? 'Updating...' : 'Saving...') : (reportType === 'SUMMARY' ? 'Update Player Profile' : 'Save Report')}
            </button>
            {success && <span className={rs.successMsg}>Saved successfully!</span>}
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Coach Diagnosis Sliders — eight 20-80 sliders the coach uses to grade the
   player on each Hitting Report. The same data feeds the Coach Diagnosis bar
   in the Hitting Snapshot bubble on the player's profile.
   ─────────────────────────────────────────────────────────────────────────── */
const COACH_DIAG_KEYS: { key: keyof ManualSwingScores; label: string; hint: string; options: string[] }[] = [
  /* Label + order mirror the player-profile Coach Diagnosis chip strip
     (SwingTab.tsx / HittingReport.tsx) so the modal grading UI matches
     what coaches see on the read side. DATA KEYS UNCHANGED so existing
     saved scores stay attached:
       key `stretch`   → "Counter"   (was "Stretch")
       key `core`      → "Stability"
       key `stability` → "Slot"
       key `slot`      → "Path"
     The `forwardMove` row is retired entirely — the chip / coach-grade
     card disappeared app-wide so the slider goes with it. The data key
     still exists in ManualSwingScores for backward compatibility, but
     no UI surface writes to it.
     `stride` is a new Coach Diagnosis slot — null on legacy reports,
     persists alongside the other manual scores once a coach grades it. */
  { key: 'stride',      label: 'Stride',       hint: 'Stride length & direction from load to launch.',            options: ['Short', 'Long', 'Square', 'Open'] },
  { key: 'stretch',     label: 'Counter',      hint: 'Counter-rotation — lower-half load → directional intent toward the pitcher.', options: ['Rhythmic', 'Good', 'Stuck', 'None'] },
  { key: 'posture',     label: 'Posture',      hint: 'Spine angle from set-up through contact.',                  options: ['Tall', 'Hinged', 'Forward', 'Back'] },
  { key: 'core',        label: 'Stability',    hint: 'Balance and base — head-still through finish.',             options: ['+Stack', '-Stack', '+Lead Leg', '-Lead Leg'] },
  { key: 'stability',   label: 'Slot',         hint: 'Hand path & barrel slot through the hitting zone.',         options: ['Steep', 'Flat', 'Uphill'] },
  { key: 'slot',        label: 'Path',         hint: 'Bat-path / barrel route through the zone.',                 options: ['Steep', 'Flat', 'Uphill'] },
  { key: 'direction',   label: 'Direction',    hint: 'Bat path & body line working through the ball.',            options: ['Pull', 'Center', 'Oppo'] },
  { key: 'timing',      label: 'Timing',       hint: 'On-time launch — load → stride → swing in rhythm with the pitch.', options: ['Early', 'Late', 'On-Time', 'Inconsistent'] },
];

function CoachDiagnosisSliders({
  scores, setScores,
  options, setOptions,
}: {
  scores: ManualSwingScores;
  setScores: React.Dispatch<React.SetStateAction<ManualSwingScores>>;
  options: ManualSwingOptions;
  setOptions: React.Dispatch<React.SetStateAction<ManualSwingOptions>>;
}) {
  const filledCount = COACH_DIAG_KEYS.filter(k => scores[k.key] != null || (options[k.key]?.length ?? 0) > 0).length;
  /* Coach Diagnosis (HITTING) — slate "Hitting Snapshot" outer bubble
     wrapping the off-white CoachDiagnosisRow cards, matching the
     Pitching report's delivery sections. */
  return (
    <div className={rs.section} style={reportOuterBubbleStyle}>
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>✍️</span>
        <span className={rs.sectionTitle}>Mechanical Grades</span>
        <span className={rs.sectionCount}>{filledCount} / {COACH_DIAG_KEYS.length} graded</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 12,
      }}>
        {COACH_DIAG_KEYS.map(({ key, label, hint, options: opts }) => (
          <CoachDiagnosisRow
            key={key}
            label={label}
            hint={hint}
            value={scores[key]}
            onChange={(v) => setScores(prev => ({ ...prev, [key]: v }))}
            optionList={opts}
            selectedOptions={options[key] || []}
            onToggleOption={(opt) => setOptions(prev => {
              const cur = prev[key] || [];
              const next = cur.includes(opt) ? cur.filter(o => o !== opt) : [...cur, opt];
              return { ...prev, [key]: next };
            })}
          />
        ))}
      </div>
    </div>
  );
}

function CoachDiagnosisRow({
  label, hint, value, onChange,
  optionList, selectedOptions, onToggleOption,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
  optionList: string[];
  selectedOptions: string[];
  onToggleOption: (opt: string) => void;
}) {
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  return (
    <div style={{
      ...reportInnerBubbleStyle,
      padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      }}>
        <span style={{
          fontSize: rem(10.5), fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: rem(20),
          color: tone, lineHeight: 1, letterSpacing: '-0.02em',
        }}>
          {value ?? '—'}
        </span>
      </div>

      {/* Multi-select option chips — saved alongside the score and surfaced
          on the Hitting Report read side under the Coach Diagnosis row. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {optionList.map(opt => {
          const active = selectedOptions.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggleOption(opt)}
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                fontSize: rem(11),
                fontWeight: 600,
                cursor: 'pointer',
                border: active ? '1px solid rgba(126,182,255,0.55)' : '1px solid var(--border)',
                background: active
                  ? 'linear-gradient(135deg, rgba(126,182,255,0.28), rgba(61,139,253,0.16))'
                  : 'rgba(255,255,255,0.04)',
                color: active ? '#cfe0ff' : 'var(--text-muted)',
                whiteSpace: 'nowrap',
                transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      <div style={{
        height: 5, borderRadius: 3,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: tone, transition: 'width 0.18s ease',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={20} max={80} step={5}
          value={value ?? 50}
          // Hide the thumb when this row is unscored so coaches don't
          // think "50" is already picked. First interaction snaps to 50
          // (or wherever they click via native onChange) and the thumb
          // reappears.
          className={value === null ? 'scoreSliderEmpty' : undefined}
          onPointerDown={() => { if (value === null) onChange(50); }}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={20} max={80} step={5}
          value={value ?? ''}
          placeholder="—"
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') return onChange(null);
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            onChange(Math.max(20, Math.min(80, Math.round(n / 5) * 5)));
          }}
          style={{
            width: 56,
            background: 'rgba(20,24,32,0.85)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '4px 7px',
            borderRadius: 6,
            fontSize: rem(12), fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
          }}
        />
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            title="Clear"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: rem(13), padding: '0 4px',
            }}
          >×</button>
        )}
      </div>

      <span style={{ fontSize: rem(10.5), color: 'var(--text-muted)', lineHeight: 1.45 }}>
        {hint}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PITCHING report — graded delivery checkpoints
   The 7-section taxonomy (PITCHING_GRADE_SECTIONS) is defined in helpers.ts
   so the player profile's Mechanical Grades panel can render the same data.
   Each item carries a 20-80 score PLUS multi-select descriptive tags, saved
   as content.pitchingGrades keyed by `${section}.${item}`.
   ───────────────────────────────────────────────────────────────────────── */
/** Total item count across all sections — drives the "X / N graded" header. */
const PITCHING_GRADE_TOTAL_ITEMS = PITCHING_GRADE_SECTIONS.reduce((n, s) => n + s.items.length, 0);

function PitchingGradesSections({
  grades, setGrades,
}: {
  grades: PitchingGrades;
  setGrades: React.Dispatch<React.SetStateAction<PitchingGrades>>;
}) {
  const filledCount = Object.values(grades)
    .filter(g => g && (g.score != null || (g.options?.length ?? 0) > 0)).length;
  return (
    <>
      <div className={rs.section}>
        <div className={rs.sectionHeader}>
          <span className={rs.sectionIcon}>✍️</span>
          <span className={rs.sectionTitle}>Delivery Grades</span>
          <span className={rs.sectionCount}>{filledCount} / {PITCHING_GRADE_TOTAL_ITEMS} graded</span>
        </div>
      </div>
      {PITCHING_GRADE_SECTIONS.map(sec => (
        <PitchingGradeSection key={sec.key} section={sec} grades={grades} setGrades={setGrades} />
      ))}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   DefenseCoachGradesSection — simpler editor used by every defense
   report (CATCHING / INFIELD / OUTFIELD). Renders the 7 Coach Grade
   sections defined in DEFENSE_COACH_GRADE_SECTIONS as a single grid
   of one-slider bubbles per section — no per-item sub-grades, no
   descriptor multi-select chips (intentionally simpler than Pitching
   per coach-spec: "I dont need the underlying metrics, just give me
   the 7 Coach Grades"). State shape: `DefenseCoachGrades` (a flat
   Record<sectionKey, number|null>) persisted to one of three content
   slots (catchingCoachGrades / infieldCoachGrades / outfieldCoachGrades).
   ─────────────────────────────────────────────────────────────── */
function DefenseCoachGradesSection({
  grades, setGrades,
}: {
  grades: DefenseCoachGrades;
  setGrades: React.Dispatch<React.SetStateAction<DefenseCoachGrades>>;
}) {
  const filledCount = Object.values(grades).filter(v => v != null).length;
  const total = DEFENSE_COACH_GRADE_SECTIONS.length;
  return (
    <>
      <div className={rs.section}>
        <div className={rs.sectionHeader}>
          <span className={rs.sectionIcon}>✍️</span>
          <span className={rs.sectionTitle}>Throwing Grades</span>
          <span className={rs.sectionCount}>{filledCount} / {total} graded</span>
        </div>
      </div>
      {/* All 7 sections live inside ONE dark-navy outer panel (same
         chrome the Pitching modal uses for each individual section)
         — flat list of 7 grey inner bubbles, each with a single
         slider. Going with a single outer panel instead of 7
         per-section panels because there's only one slider per
         section, so the visual weight of a per-section panel +
         header per slider would be overkill. */}
      <div
        className={rs.section}
        /* Slate outer panel via the shared report bubble chrome so the
           Coach Grades panel matches the Snapshot + Pitching delivery
           panels exactly — clean drop shadow in light, inset depth in
           dark (was a hardcoded inset stack that didn't flip). */
        style={reportOuterBubbleStyle}
      >
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {DEFENSE_COACH_GRADE_SECTIONS.map(sec => (
            <DefenseCoachGradeItem
              key={sec.key}
              section={sec}
              value={grades[sec.key] ?? null}
              onChange={(next) => setGrades(prev => ({ ...prev, [sec.key]: next }))}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function DefenseCoachGradeItem({
  section, value, onChange,
}: {
  section: { key: string; title: string; icon: string };
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  /* Interactive 20-80 score bar — click or drag anywhere on the
     track to set the score. Snap step is 5 so scores land on the
     canonical 20/25/30/…/80 scouting grid. Mirrors the
     PitchingGradeItem score bar exactly so the modal interaction
     model is identical between pitching + defense. */
  const handleBarPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const fraction = rect.width === 0 ? 0 : x / rect.width;
    const raw = 20 + fraction * 60;
    const snapped = Math.max(20, Math.min(80, Math.round(raw / 5) * 5));
    onChange(snapped);
  };
  return (
    <div style={{
      padding: '10px 12px',
      /* Theme-aware defense inner-bubble surface (near-white in light,
         dark graphite in dark) — matches the profile's defense chips,
         replacing the hardcoded translucent-white wash copied from the
         Pitching grade item (which read near-white-on-light). */
      background: 'var(--defense-inner-bg)',
      border: '1px solid var(--border-light)',
      borderRadius: 10,
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      {/* Section icon + title + score readout + clear */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: rem(13), lineHeight: 1 }}>{section.icon}</span>
          <span style={{
            fontSize: rem(10.5), fontWeight: 700, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            {section.title}
          </span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontWeight: 800, fontSize: rem(20),
            color: tone, lineHeight: 1, letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {value ?? '—'}
          </span>
          {value !== null && (
            <button
              type="button"
              onClick={() => onChange(null)}
              title="Clear this grade"
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 5,
                padding: '1px 6px', fontSize: rem(10), cursor: 'pointer',
                lineHeight: 1.2,
              }}
            >x</button>
          )}
        </span>
      </div>
      {/* Score bar — click/drag to set */}
      <div
        role="slider"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={value ?? undefined}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          handleBarPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return;
          handleBarPointer(e);
        }}
        style={{
          position: 'relative',
          height: 10,
          borderRadius: 5,
          background: 'var(--border)',
          border: '1px solid var(--border)',
          cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0,
          width: `${pct}%`,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${tone}33, ${tone}aa)`,
          transition: 'width 0.08s linear',
        }} />
      </div>
    </div>
  );
}

function PitchingGradeSection({
  section, grades, setGrades,
}: {
  section: PitchingGradeSectionConfig;
  grades: PitchingGrades;
  setGrades: React.Dispatch<React.SetStateAction<PitchingGrades>>;
}) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  return (
    /* Outer bubble per delivery section (Gather / Arm Path / Direction /
       ... / Movement / Execution). Dark theme keeps the deep dark-navy
       chrome it always had. Light theme flips to `--panel-bg-light`
       (the cool-slate surface the Hitting Snapshot wears) so the
       Pitching grade sections read as siblings of the Hitting Snapshot
       bubble across themes. The inline dark-navy bg can't pick up the
       `[data-theme="light"]` CSS override, so the switch is wired via
       useTheme(). */
    <div
      className={rs.section}
      style={{
        background: isLight
          ? 'var(--panel-bg-light)'
          : 'radial-gradient(ellipse at 50% 35%, rgba(255,255,255,0.04) 0%, transparent 60%), rgba(10, 14, 20, 0.38)',
        border: isLight ? '1px solid rgba(0, 0, 0, 0.10)' : '1px solid var(--border-light)',
        borderRadius: 12,
        padding: 16,
        boxShadow: isLight
          ? '0 6px 18px rgba(15, 20, 30, 0.08)'
          : 'inset 0 1px 0 rgba(255, 255, 255, 0.05), inset 0 0 24px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.25)',
      }}
    >
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>{section.icon}</span>
        <span className={rs.sectionTitle}>{section.title}</span>
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 12,
      }}>
        {section.items.map(item => {
          const k = pitchingGradeKey(section.key, item.key);
          const entry = grades[k] || { score: null, options: [] };
          return (
            <PitchingGradeItem
              key={k}
              item={item}
              entry={entry}
              onChange={(next) => setGrades(prev => ({ ...prev, [k]: next }))}
            />
          );
        })}
      </div>
    </div>
  );
}

function PitchingGradeItem({
  item, entry, onChange,
}: {
  item: PitchingGradeItemConfig;
  entry: PitchingGradeEntry;
  onChange: (next: PitchingGradeEntry) => void;
}) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const value = entry.score;
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;

  const toggleOption = (opt: string) => {
    const has = entry.options.includes(opt);
    const next = has ? entry.options.filter(o => o !== opt) : [...entry.options, opt];
    onChange({ ...entry, options: next });
  };

  /* Single interactive score bar — handles BOTH display and input.
     Clicking or dragging anywhere on the track sets the score; the
     fill width visualizes the current value. Replaces the previous
     stack of separate score bar + slider + numeric input + clear
     button, which gave each checkpoint bubble four rows. Now each
     bubble is just three rows: label+score / option chips / bar.

     Snap step is 5 (matches the previous slider) so scores land on
     the canonical 20/25/30/…/80 scouting grid. Touch + mouse +
     trackpad all route through pointer events. */
  const handleBarPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const fraction = rect.width === 0 ? 0 : x / rect.width;
    const raw = 20 + fraction * 60;
    const snapped = Math.max(20, Math.min(80, Math.round(raw / 5) * 5));
    onChange({ ...entry, score: snapped });
  };

  return (
    /* Inner per-checkpoint bubble (Leg Lift Height / Load / Stability
       / Tempo / etc.) — sits inside the section's outer panel.
       Light theme uses `--bubble-chrome-bg` (the same #eaeaea surface
       the arsenal cards Curveball / Fastball / Slider / Changeup wear)
       so every inner bubble in the Pitching Report reads as one
       consistent surface. Dark theme keeps the warm translucent-white
       wash. The inline background is the lever — `[data-theme="light"]`
       CSS overrides can't beat inline styles, so we flip via useTheme. */
    <div style={{
      padding: '10px 12px',
      background: isLight
        ? 'var(--bubble-chrome-bg)'
        : 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)',
      border: isLight ? '1px solid var(--border-light)' : '1px solid var(--border)',
      borderRadius: 10,
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      {/* Label + score readout + clear */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: rem(10.5), fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {item.label}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontWeight: 800, fontSize: rem(20),
            color: tone, lineHeight: 1, letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {value ?? '—'}
          </span>
          {/* Inline clear — surfaces only when there's something
              to clear so the row stays compact for fresh
              checkpoints. */}
          {(value !== null || entry.options.length > 0) && (
            <button
              type="button"
              onClick={() => onChange({ score: null, options: [] })}
              title="Clear this checkpoint"
              style={{
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 5,
                padding: '1px 6px', fontSize: rem(10), cursor: 'pointer',
                lineHeight: 1.2,
              }}
            >x</button>
          )}
        </span>
      </div>

      {/* Multi-select chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {item.options.map(opt => {
          const active = entry.options.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleOption(opt)}
              style={{
                padding: '4px 9px',
                borderRadius: 6,
                fontSize: rem(11),
                fontWeight: 600,
                cursor: 'pointer',
                border: active ? '1px solid rgba(126,182,255,0.55)' : '1px solid var(--border)',
                background: active
                  ? 'linear-gradient(135deg, rgba(126,182,255,0.28), rgba(61,139,253,0.16))'
                  : 'rgba(255,255,255,0.04)',
                color: active ? '#cfe0ff' : 'var(--text-muted)',
                whiteSpace: 'nowrap',
                transition: 'background 0.12s ease, border-color 0.12s ease, color 0.12s ease',
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {/* Combined display + input bar. Click anywhere to set the
          score; press-and-drag to fine-tune. Pointer capture keeps
          the drag responsive even when the cursor leaves the bar. */}
      <div
        role="slider"
        aria-label={`${item.label} score`}
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={value ?? undefined}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleBarPointer(e);
        }}
        onPointerMove={(e) => {
          /* Only respond while the primary button is held (drag),
             not on hover. `e.buttons === 1` is reliable across
             mouse + touch. */
          if (e.buttons !== 1) return;
          handleBarPointer(e);
        }}
        onKeyDown={(e) => {
          /* Keyboard accessibility — arrow keys nudge by the
             snap step. */
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            const cur = value ?? 50;
            onChange({ ...entry, score: Math.max(20, cur - 5) });
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            const cur = value ?? 50;
            onChange({ ...entry, score: Math.min(80, cur + 5) });
          }
        }}
        style={{
          height: 10, borderRadius: 5,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          cursor: 'pointer',
          touchAction: 'none',
          position: 'relative',
        }}
      >
        <div style={{
          width: `${pct}%`, height: '100%',
          background: tone, transition: 'width 0.18s ease',
        }} />
      </div>
    </div>
  );
}
