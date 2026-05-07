'use client';

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { parseAtBatXlsx } from '@/lib/atbat-parser';
import rs from '@/components/assessment/report-form.module.css';
import styles from './page.module.css';
import {
  type ManualSwingScores, getManualSwingScores,
  type ManualSwingOptions, getManualSwingOptions,
  type ManualBattedBall, getManualBattedBall,
  type ManualSwingMetrics, getManualSwingMetrics,
  MANUAL_BATTED_BALL_FIELDS, MANUAL_SWING_METRIC_FIELDS,
  type PitchingGrades, type PitchingGradeEntry, getPitchingGrades,
  type PitchingGradeItemConfig, type PitchingGradeSectionConfig,
  PITCHING_GRADE_SECTIONS, pitchingGradeKey,
  scoreColor,
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
  { id: 'STRENGTH', label: 'S & C', icon: '💪' },
  // Defense cluster — Infield · Outfield · Catching grouped at the end
  { id: 'INFIELD', label: 'Infield', icon: '🧤' },
  { id: 'OUTFIELD', label: 'Outfield', icon: '🏃' },
  { id: 'CATCHING', label: 'Catching', icon: '🎯' },
];

const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'Utility'];

/* Inline button styles used by the Club Team / College inline "add new" panels. */
const quickBtnPrimary: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
const quickBtnSecondary: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 12,
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
                fontSize: 11,
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
          padding: '8px 10px',
          background: 'rgba(20,24,32,0.55)',
          border: '1px solid var(--border-light)',
          borderRadius: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700,
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
                fontSize: 18,
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
                fontSize: 10, fontWeight: 600,
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

interface VideoEntry { id: string; file: File; }
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

function VideoSection({ videos, setVideos, existingVideos, setExistingVideos }: {
  videos: VideoEntry[]; setVideos: (v: VideoEntry[]) => void;
  existingVideos?: ExistingVideo[]; setExistingVideos?: (v: ExistingVideo[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setVideos([...videos, ...Array.from(files).map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f,
    }))]);
  };
  const existing = existingVideos ?? [];
  const totalCount = existing.length + videos.length;
  return (
    <div className={rs.section}>
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>🎬</span>
        <span className={rs.sectionTitle}>Videos</span>
        {totalCount > 0 && <span className={rs.sectionCount}>{totalCount} {totalCount === 1 ? 'file' : 'files'}</span>}
      </div>
      {totalCount > 0 && (
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
          {videos.map(v => (
            <div key={v.id} className={rs.videoItem}>
              <span className={rs.videoFileIcon}>🎥</span>
              <div className={rs.videoFileInfo}>
                <div className={rs.videoFileName}>{v.file.name}</div>
                <div className={rs.videoFileMeta}>{formatFileSize(v.file.size)}</div>
              </div>
              <button type="button" className={rs.videoRemove} onClick={() => setVideos(videos.filter(x => x.id !== v.id))}>x</button>
            </div>
          ))}
        </div>
      )}
      <div className={rs.videoDropZone} onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}>
        <span className={rs.dropIcon}>🎬</span>
        <span className={rs.dropText}>Drop video files here or click to browse</span>
        <span className={rs.videoFormats}>MP4, MOV, AVI, MKV</span>
        <input ref={inputRef} type="file" accept="video/*" multiple style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
    </div>
  );
}

interface SummaryData {
  firstName: string; lastName: string; positions: string[]; bats: string; throws: string;
  height: string; weight: string; gradYear: string; birthDate: string; highSchool: string;
  clubTeam: string; pbrNational: string; pbrState: string; pbrPosition: string; pgScore: string;
  collegeCommit: string; logoFile: File | null;
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
            {POSITIONS.map(pos => (
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
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
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
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
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
    popTime3B: ThrowingRow;
    exchangeTime: ThrowingRow;
    velocity: ThrowingRow;
    overallGrade: string;
  };
  receiving: {
    /** Click-to-shade per-zone quality — drives the dashboard's strike-zone
     *  heat map. 9 inner cells + 16 border cells (5x5 grid total). */
    zoneColors: ZoneVal[];        // length 9
    borderZoneColors: ZoneVal[];  // length 16
    quietHands: GradeRow;
    stanceSetup: GradeRow;
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
      popTime3B: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      exchangeTime: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      velocity: { ...EMPTY_THROWING_ROW, attempts: [...EMPTY_THROWING_ROW.attempts] },
      overallGrade: '',
    },
    receiving: {
      // Default every zone cell to "average" (1) so the grid renders
      // legibly before the coach has shaded any cell.
      zoneColors: Array(9).fill(1) as ZoneVal[],
      borderZoneColors: Array(16).fill(1) as ZoneVal[],
      quietHands: { ...EMPTY_GRADE_ROW },
      stanceSetup: { ...EMPTY_GRADE_ROW },
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
  return {
    throwing: {
      popTime2B: parseAttempts(data.throwing.popTime2B),
      popTime3B: parseAttempts(data.throwing.popTime3B),
      exchangeTime: parseAttempts(data.throwing.exchangeTime),
      velocity: parseVeloAttempts(data.throwing.velocity),
      overallGrade: data.throwing.overallGrade ? parseInt(data.throwing.overallGrade) || null : null,
    },
    receiving: {
      // Strike-zone shading drives the dashboard's heat map. The 9 inner
      // cells map to the strike zone; the 16 border cells map to balls
      // around the zone.
      zoneColors: data.receiving.zoneColors,
      borderZoneColors: data.receiving.borderZoneColors,
      quietHands: parseGrade(data.receiving.quietHands),
      stanceSetup: parseGrade(data.receiving.stanceSetup),
      overallGrade: data.receiving.overallGrade ? parseInt(data.receiving.overallGrade) || null : null,
    },
    // Positional blocking grades — Block Left / Center / Right replace the
    // single "range" entry. Other blocking skills (accuracy / glove-body
    // angle / recovery speed) stay as-is.
    blocking: {
      blockLeft: parseGrade(data.blocking.blockLeft),
      blockCenter: parseGrade(data.blocking.blockCenter),
      blockRight: parseGrade(data.blocking.blockRight),
      accuracy: parseGrade(data.blocking.accuracy),
      gloveBodyAngle: parseGrade(data.blocking.gloveBodyAngle),
      recoverySpeed: parseGrade(data.blocking.recoverySpeed),
      overallGrade: data.blocking.overallGrade ? parseInt(data.blocking.overallGrade) || null : null,
    },
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13, fontFamily: "'DM Mono', monospace",
  background: 'var(--surface2, rgba(255,255,255,0.06))', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', textAlign: 'center', outline: 'none',
};
const gradeInputStyle: React.CSSProperties = {
  ...inputStyle, width: 70, fontSize: 15, fontWeight: 700, textAlign: 'center',
};
const notesInputStyle: React.CSSProperties = {
  ...inputStyle, textAlign: 'left', flex: 1, minWidth: 100,
};
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--accent-light)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8,
};
const headerCellStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-muted)', textAlign: 'center', padding: '6px 4px',
};
const metricLabelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', padding: '8px 0',
};
const mlbRefStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: '6px 4px',
};
const overallRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, marginTop: 12,
  padding: '12px 16px', background: 'rgba(32,128,141,0.08)', borderRadius: 8,
  border: '1px solid rgba(32,128,141,0.2)',
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
  const W = 320, H = 360;
  const cellW = 56, cellH = 64;
  const gridW = cellW * 5, gridH = cellH * 5;
  const ox = (W - gridW) / 2;
  const oy = 20;

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
      const x = ox + c * cellW;
      const y = oy + r * cellH;
      const isStrike = kind === 'inner';
      const onClick = () => kind === 'inner' ? onToggleInner(idx) : onToggleBorder(idx);
      cells.push(
        <g key={`${r}-${c}`} onClick={onClick} style={{ cursor: 'pointer' }}>
          <rect
            x={x} y={y} width={cellW} height={cellH}
            fill={ZONE_FILLS_LOCAL[v as ZoneVal]}
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={isStrike ? 0.7 : 0.5}
            rx={2}
            opacity={isStrike ? 0.95 : 0.55}
          />
          <text
            x={x + cellW / 2}
            y={y + cellH / 2 + 4}
            textAnchor="middle"
            fontSize={10}
            fontFamily="'DM Mono', monospace"
            fontWeight={700}
            fill="rgba(255,255,255,0.55)"
            letterSpacing="0.06em"
          >
            {ZONE_TONE[v as ZoneVal]}
          </text>
        </g>,
      );
    }
  }

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
          x={ox + cellW * 1} y={oy + cellH * 1}
          width={cellW * 3} height={cellH * 3}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={2}
          rx={2}
          pointerEvents="none"
        />
        {/* Strike-zone label inside outline (top center) */}
        <text x={W / 2} y={oy + cellH + 14} textAnchor="middle"
              fontSize={9} fontFamily="'DM Mono', monospace" fontWeight={700}
              fill="rgba(255,255,255,0.70)" letterSpacing="0.22em" pointerEvents="none">
          STRIKE ZONE
        </text>
      </svg>

      {/* Legend + click hint */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, fontSize: 11 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_FILLS_LOCAL[2], opacity: 0.9 }} />
          Good
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_FILLS_LOCAL[1], opacity: 0.6, border: '1px solid rgba(255,255,255,0.18)' }} />
          Average
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-muted)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_FILLS_LOCAL[0], opacity: 0.9 }} />
          Bad
        </span>
        <span style={{ color: 'var(--faint)', fontSize: 10, marginLeft: 8 }}>Click cells to cycle</span>
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
  label, grade, notes, onGradeChange, onNotesChange,
}: {
  label: string;
  grade: string;
  notes: string;
  onGradeChange: (s: string) => void;
  onNotesChange: (s: string) => void;
}) {
  const value: number | null = grade === '' ? null : (() => {
    const n = parseInt(grade, 10);
    return Number.isFinite(n) ? n : null;
  })();
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  return (
    <div style={{
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--text-bright)',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 18,
          color: tone, lineHeight: 1, letterSpacing: '-0.02em',
        }}>
          {value ?? '—'}
        </span>
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
          className={value === null ? 'scoreSliderEmpty' : undefined}
          onPointerDown={() => { if (value === null) onGradeChange('50'); }}
          onChange={(e) => onGradeChange(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={20} max={80} step={5}
          value={value ?? ''}
          placeholder="—"
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') { onGradeChange(''); return; }
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            const clamped = Math.max(20, Math.min(80, Math.round(n / 5) * 5));
            onGradeChange(String(clamped));
          }}
          style={{
            width: 56,
            background: 'rgba(20,24,32,0.85)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '4px 7px',
            borderRadius: 6,
            fontSize: 12, fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
          }}
        />
        {value !== null && (
          <button
            type="button"
            onClick={() => onGradeChange('')}
            title="Clear"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 13, padding: '0 4px',
            }}
          >×</button>
        )}
      </div>
      <input
        type="text"
        value={notes}
        placeholder="Notes..."
        onChange={(e) => onNotesChange(e.target.value)}
        style={{
          width: '100%',
          background: 'rgba(20,24,32,0.85)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          padding: '5px 8px',
          borderRadius: 6,
          fontSize: 12,
        }}
      />
    </div>
  );
}

/* DefenseOverallSlider — variant for "Overall ___ Grade" rows (no notes line). */
function DefenseOverallSlider({
  label, grade, onGradeChange,
}: {
  label: string;
  grade: string;
  onGradeChange: (s: string) => void;
}) {
  const value: number | null = grade === '' ? null : (() => {
    const n = parseInt(grade, 10);
    return Number.isFinite(n) ? n : null;
  })();
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;
  return (
    <div style={{
      padding: '10px 12px',
      background: 'linear-gradient(135deg, rgba(126,182,255,0.08) 0%, rgba(126,182,255,0.02) 100%)',
      border: '1px solid color-mix(in srgb, var(--accent) 35%, var(--border))',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 6,
      marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', color: 'var(--accent-light)',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 22,
          color: tone, lineHeight: 1, letterSpacing: '-0.02em',
        }}>
          {value ?? '—'}
        </span>
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
          className={value === null ? 'scoreSliderEmpty' : undefined}
          onPointerDown={() => { if (value === null) onGradeChange('50'); }}
          onChange={(e) => onGradeChange(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={20} max={80} step={5}
          value={value ?? ''}
          placeholder="—"
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') { onGradeChange(''); return; }
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            const clamped = Math.max(20, Math.min(80, Math.round(n / 5) * 5));
            onGradeChange(String(clamped));
          }}
          style={{
            width: 56,
            background: 'rgba(20,24,32,0.85)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            padding: '4px 7px',
            borderRadius: 6,
            fontSize: 12, fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'center',
          }}
        />
        {value !== null && (
          <button
            type="button"
            onClick={() => onGradeChange('')}
            title="Clear"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 13, padding: '0 4px',
            }}
          >×</button>
        )}
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
    { key: 'popTime3B', label: 'Pop Time (3B) — sec', mlbAvg: '~2.10' },
    { key: 'exchangeTime', label: 'Exchange Time — sec', mlbAvg: '0.65–0.75' },
    { key: 'velocity', label: 'Velocity — mph', mlbAvg: '~75–80' },
  ];

  // Receiving rows now only cover skill-based grades — spatial zone
  // grading happens via the interactive 5×5 strike zone above.
  const receivingRows: { key: keyof CatchingFormData['receiving']; label: string }[] = [
    { key: 'quietHands', label: 'Quiet Hands / Presentation' },
    { key: 'stanceSetup', label: 'Stance & Setup' },
  ];

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
      <div>
        <div style={sectionTitleStyle}>
          <span>🎯</span> Throwing & Pop Time
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
        <DefenseOverallSlider
          label="Overall Throwing Grade"
          grade={data.throwing.overallGrade}
          onGradeChange={(v) => setData({ ...data, throwing: { ...data.throwing, overallGrade: v } })}
        />
      </div>

      {/* ── RECEIVING ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🧤</span> Receiving — Strike-Zone Heat Map
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
          <span>🧤</span> Receiving — Skill Grades (20–80)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          grade={data.receiving.overallGrade}
          onGradeChange={(v) => setData({ ...data, receiving: { ...data.receiving, overallGrade: v } })}
        />
      </div>

      {/* ── BLOCKING ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🛡️</span> Blocking — Scouting Grades (20–80)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          grade={data.blocking.overallGrade}
          onGradeChange={(v) => setData({ ...data, blocking: { ...data.blocking, overallGrade: v } })}
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

interface InfieldFormData {
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
}

const EMPTY_ARM_ROW: ArmRow = { attempts: ['', '', ''], notes: '' };

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
  };
}

function InfieldForm({ data, setData }: { data: InfieldFormData; setData: (d: InfieldFormData) => void }) {
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
  };
}

function OutfieldForm({ data, setData }: { data: OutfieldFormData; setData: (d: OutfieldFormData) => void }) {
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
  const [reportTitle, setReportTitle] = useState(existingReport?.title || '');
  const [notes, setNotes] = useState(existingReport?.notes || '');
  const [videos, setVideos] = useState<VideoEntry[]>([]);
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

  const emptySummary: SummaryData = {
    firstName: '', lastName: '', positions: [], bats: '', throws: '',
    height: '', weight: '', gradYear: '', birthDate: '', highSchool: '',
    clubTeam: '', pbrNational: '', pbrState: '', pbrPosition: '', pgScore: '',
    collegeCommit: '', logoFile: null,
  };
  const [summaryData, setSummaryData] = useState<SummaryData>(emptySummary);
  const [catchingData, setCatchingData] = useState<CatchingFormData>(emptyCatchingForm());
  const [infieldData, setInfieldData] = useState<InfieldFormData>(emptyInfieldForm());
  const [outfieldData, setOutfieldData] = useState<OutfieldFormData>(emptyOutfieldForm());

  // Coach Diagnosis manual scores (HITTING reports). When editing an existing
  // HITTING report, prefill from the report's content.manualScores; otherwise
  // start with all nulls so coaches can grade fresh.
  const [manualScores, setManualScores] = useState<ManualSwingScores>(() =>
    isEdit && existingReport ? getManualSwingScores(existingReport) : {
      forwardMove: null, posture: null, stability: null, direction: null,
      stretch: null, core: null, slot: null, timing: null,
    }
  );
  // Multi-select option tags paired with each manual score (descriptive
  // labels like "Drift" / "Tall" / "+Stack"). Stored at content.manualOptions.
  const [manualOptions, setManualOptions] = useState<ManualSwingOptions>(() =>
    isEdit && existingReport ? getManualSwingOptions(existingReport) : {
      forwardMove: [], posture: [], stability: [], direction: [],
      stretch: [], core: [], slot: [], timing: [],
    }
  );

  // Pitching grades (PITCHING reports). When editing, prefill from the
  // report's content.pitchingGrades; otherwise start empty so each row reads
  // "—" until the coach grades it.
  const [pitchingGrades, setPitchingGrades] = useState<PitchingGrades>(() =>
    isEdit && existingReport ? getPitchingGrades(existingReport) : {}
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
      attack_angle: null, plane_angle: null, avg_bat_speed: null,
      time_to_contact: null, on_plane_efficiency: null,
    },
  );
  /* Per-slot toggle — true when the coach has flipped that card into
     manual-entry mode. Auto-on in edit mode if any value is already
     saved for that slot, so the form re-opens to the saved manual data. */
  const [manualMode, setManualMode] = useState<Record<string, boolean>>(() => {
    if (!isEdit || !existingReport) return {};
    const bb = getManualBattedBall(existingReport);
    const sw = getManualSwingMetrics(existingReport);
    const out: Record<string, boolean> = {};
    if (Object.values(bb).some(v => v != null)) out.fullswing = true;
    if (Object.values(sw).some(v => v != null)) out.blast = true;
    return out;
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
    });
  }, [player]);

  // Reset CSV files + catching form when report type changes
  useEffect(() => { setCsvFiles({}); setCsvResults({}); setCatchingData(emptyCatchingForm()); setInfieldData(emptyInfieldForm()); setOutfieldData(emptyOutfieldForm()); }, [reportType]);

  const csvSlots = REPORT_CSV_SLOTS[reportType] || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (reportType === 'SUMMARY') {
        await api.updatePlayer(player.id, {
          firstName: summaryData.firstName || undefined, lastName: summaryData.lastName || undefined,
          positions: summaryData.positions.join(',') || undefined,
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
        } as any);
      } else {
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
          const ids: string[] = [];
          const saved: SavedVideo[] = [];
          for (const v of entries) {
            try {
              const result = await api.uploadVideo(v.file, player.id, v.file.name.replace(/\.[^.]+$/, ''), reportType);
              ids.push(result.id);
              saved.push({ name: v.file.name, size: v.file.size, id: result.id, url: result.originalUrl || undefined, section });
            } catch (err: any) {
              console.error('Video upload failed:', err);
              saved.push({ name: v.file.name, size: v.file.size, section });
            }
          }
          return { ids, saved };
        };
        const swingUpload    = await uploadVideos(videos, 'swing');
        const decisionUpload = reportType === 'HITTING'
          ? await uploadVideos(swingDecisionVideos, 'decision')
          : { ids: [], saved: [] };
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
        const newContent = {
          ...prevContent,
          ...(Object.keys(mergedCsvUploads).length > 0 ? { csvUploads: mergedCsvUploads } : { csvUploads: undefined }),
          ...(mergedVideos.length > 0 ? { videos: mergedVideos } : { videos: undefined }),
          ...(atBatData ? { atBatAssessment: atBatData } : {}),
          ...(reportType === 'CATCHING' ? { catchingAssessment: buildCatchingContent(catchingData) } : {}),
          ...(reportType === 'INFIELD' ? { infieldAssessment: buildInfieldContent(infieldData) } : {}),
          ...(reportType === 'OUTFIELD' ? { outfieldAssessment: buildOutfieldContent(outfieldData) } : {}),
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
              updatedAt:   new Date().toISOString(),
              updatedBy:   userId,
            },
            // Multi-select descriptive tags for each Coach Diagnosis category
            // (e.g. forwardMove: ['Drift']). Always written so removals stick.
            manualOptions: { ...manualOptions },
            // Per-CSV-slot manual entries (Blast / Full Swing). Always
            // written so cleared fields persist as nulls.
            manualBattedBall:    { ...manualBattedBall },
            manualSwingMetrics:  { ...manualSwingMetrics },
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
            {!profileOnly && (
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
                  fontSize: 12,
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
          <button type="button" className={styles.modalClose} onClick={onClose}>x</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalBody}>
          {/* Report type chips — cleaner, segmented row.
              Hidden entirely in profileOnly mode so the player only sees
              the SUMMARY form fields. */}
          {!profileOnly && (
          <div className={rs.fieldGroup}>
            <label className={rs.label}>Report Type</label>
            <div className={rs.chipRow}>
              {REPORT_TYPES.map(t => (
                <button key={t.id} type="button"
                  className={`${rs.chip} ${reportType === t.id ? rs.chipActive : ''}`}
                  onClick={() => {
                    setReportType(t.id);
                    setNotes(''); setVideos([]); setExistingCsvUploads({}); setExistingVideos([]);
                    setSwingDecisionNotes(''); setSwingDecisionVideos([]); setExistingSwingDecisionVideos([]);
                    setPitchingGrades({});
                    setManualOptions({
                      forwardMove: [], posture: [], stability: [], direction: [],
                      stretch: [], core: [], slot: [], timing: [],
                    });
                  }}>
                  <span className={rs.chipIcon}>{t.icon}</span>{t.label}
                </button>
              ))}
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
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Overall catching assessment notes, areas to develop..." rows={4} />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} />
            </>
          ) : reportType === 'INFIELD' ? (
            <>
              <InfieldForm data={infieldData} setData={setInfieldData} />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Infield defensive assessment notes, areas to develop..." rows={4} />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} />
            </>
          ) : reportType === 'OUTFIELD' ? (
            <>
              <OutfieldForm data={outfieldData} setData={setOutfieldData} />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Outfield defensive assessment notes, areas to develop..." rows={4} />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} />
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
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Session observations, development notes, drill recommendations..." rows={4} />
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

              <VideoSection videos={videos} setVideos={setVideos} existingVideos={existingVideos} setExistingVideos={setExistingVideos} />

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
                      <textarea className={rs.notesArea} value={swingDecisionNotes} onChange={e => setSwingDecisionNotes(e.target.value)}
                        placeholder="At-bat approach, plate discipline, decision quality..." rows={4} />
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
  { key: 'forwardMove', label: 'Forward Move', hint: 'Lower-half load → directional intent toward the pitcher.', options: ['Stuck', 'Stable', 'Drift'] },
  { key: 'posture',     label: 'Posture',      hint: 'Spine angle from set-up through contact.',                  options: ['Tall', 'Hinged', 'Forward', 'Back'] },
  { key: 'stability',   label: 'Stability',    hint: 'Balance and base — head-still through finish.',             options: ['+Stack', '-Stack', '+Lead Leg', '-Lead Leg'] },
  { key: 'direction',   label: 'Direction',    hint: 'Bat path & body line working through the ball.',            options: ['Pull', 'Center', 'Oppo'] },
  { key: 'stretch',     label: 'Stretch',      hint: 'Length & separation between hips and shoulders at launch.', options: ['Rhythmic', 'Good', 'Stuck', 'None'] },
  { key: 'core',        label: 'Core',         hint: 'Trunk strength & sequencing through contact.',              options: ['Connected', 'Disconnected', 'Weak'] },
  { key: 'slot',        label: 'Slot',         hint: 'Hand path & barrel slot through the hitting zone.',         options: ['Steep', 'Flat', 'Uphill'] },
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
  return (
    <div className={rs.section}>
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>✍️</span>
        <span className={rs.sectionTitle}>Coach Diagnosis</span>
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
      padding: '12px 14px',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {label}
        </span>
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 22,
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
                fontSize: 11,
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
            fontSize: 12, fontWeight: 700,
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
              color: 'var(--text-muted)', fontSize: 13, padding: '0 4px',
            }}
          >×</button>
        )}
      </div>

      <span style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
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

function PitchingGradeSection({
  section, grades, setGrades,
}: {
  section: PitchingGradeSectionConfig;
  grades: PitchingGrades;
  setGrades: React.Dispatch<React.SetStateAction<PitchingGrades>>;
}) {
  return (
    <div className={rs.section}>
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
  const value = entry.score;
  const tone = value !== null ? scoreColor(value) : '#475569';
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - 20) / 60) * 100)) : 0;

  const toggleOption = (opt: string) => {
    const has = entry.options.includes(opt);
    const next = has ? entry.options.filter(o => o !== opt) : [...entry.options, opt];
    onChange({ ...entry, options: next });
  };

  return (
    <div style={{
      padding: '12px 14px',
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      display: 'flex', flexDirection: 'column', gap: 9,
    }}>
      {/* Label + score readout */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--text-muted)',
        }}>
          {item.label}
        </span>
        <span style={{
          fontWeight: 800, fontSize: 22,
          color: tone, lineHeight: 1, letterSpacing: '-0.02em',
        }}>
          {value ?? '—'}
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
                fontSize: 11,
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

      {/* Score bar */}
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

      {/* Slider + numeric input + clear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={20} max={80} step={5}
          value={value ?? 50}
          // Hide the thumb when this checkpoint hasn't been graded so
          // coaches don't think "50" is already picked. First interaction
          // snaps to 50 (or to the clicked position) and the thumb
          // reappears.
          className={value === null ? 'scoreSliderEmpty' : undefined}
          onPointerDown={() => { if (value === null) onChange({ ...entry, score: 50 }); }}
          onChange={(e) => onChange({ ...entry, score: Number(e.target.value) })}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={20} max={80} step={5}
          value={value ?? ''}
          placeholder="—"
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') return onChange({ ...entry, score: null });
            const n = Number(v);
            if (!Number.isFinite(n)) return;
            onChange({ ...entry, score: Math.max(20, Math.min(80, Math.round(n / 5) * 5)) });
          }}
          style={{
            width: 56, padding: '4px 6px', fontSize: 12, fontWeight: 700,
            background: 'rgba(0,0,0,0.25)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 6, textAlign: 'center',
          }}
        />
        {(value !== null || entry.options.length > 0) && (
          <button
            type="button"
            onClick={() => onChange({ score: null, options: [] })}
            title="Clear this checkpoint"
            style={{
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 6,
              padding: '4px 8px', fontSize: 11, cursor: 'pointer',
            }}
          >x</button>
        )}
      </div>
    </div>
  );
}
