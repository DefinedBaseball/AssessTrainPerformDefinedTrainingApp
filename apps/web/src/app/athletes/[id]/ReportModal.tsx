'use client';

import type React from 'react';
import { useState, useRef, useEffect } from 'react';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { parseAtBatXlsx } from '@/lib/atbat-parser';
import rs from '@/components/assessment/report-form.module.css';
import styles from './page.module.css';
import { type ManualSwingScores, getManualSwingScores, scoreColor } from './helpers';

/* ── Constants ── */

const REPORT_TYPES = [
  { id: 'HITTING', label: 'Hitting', icon: '🏏' },
  { id: 'AT_BAT_RESULTS', label: 'At-Bat Results', icon: '📊' },
  { id: 'PITCHING', label: 'Pitching', icon: '⚾' },
  { id: 'INFIELD', label: 'Infield', icon: '🧤' },
  { id: 'OUTFIELD', label: 'Outfield', icon: '🏃' },
  { id: 'CATCHING', label: 'Catching', icon: '🎯' },
  { id: 'STRENGTH', label: 'S & C', icon: '💪' },
  { id: 'COGNITION', label: 'Cognition', icon: '🧠' },
  { id: 'SUMMARY', label: 'Summary', icon: '📋' },
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

interface CsvSlot { key: string; label: string; subtitle: string; vendor: string; }

const REPORT_CSV_SLOTS: Record<string, CsvSlot[]> = {
  HITTING: [
    { key: 'blast', label: 'Swing Metrics', subtitle: 'Blast Motion CSV', vendor: 'Blast Motion' },
    { key: 'fullswing', label: 'Batted Ball Metrics', subtitle: 'Full Swing CSV', vendor: 'Full Swing' },
  ],
  AT_BAT_RESULTS: [
    { key: 'atbat', label: 'At-Bat Assessment', subtitle: 'At-Bat Assessment XLSX', vendor: 'AtBat' },
    { key: 'fullswing', label: 'Full Swing Data', subtitle: 'Full Swing CSV', vendor: 'Full Swing' },
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

function CsvUploadCard({ slot, file, uploadResult, onSelect, onRemove }: {
  slot: CsvSlot; file: File | null; uploadResult: UploadResult | null;
  onSelect: (f: File) => void; onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={rs.csvCard}>
      <div className={rs.csvCardHeader}>
        <div>
          <div className={rs.csvCardTitle}>{slot.label}</div>
          <div className={rs.csvCardSub}>{slot.subtitle}</div>
        </div>
        <span className={rs.csvVendorBadge}>{slot.vendor}</span>
      </div>
      {!file ? (
        <div className={rs.dropZone} onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.(csv|xlsx?)$/i.test(f.name)) onSelect(f); }}
          onClick={() => inputRef.current?.click()}>
          <span className={rs.dropIcon}>📄</span>
          <span className={rs.dropText}>Drop CSV here or click to browse</span>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) onSelect(f); e.target.value = ''; }} />
        </div>
      ) : (
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
      )}
    </div>
  );
}

interface VideoEntry { id: string; file: File; }

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VideoSection({ videos, setVideos }: { videos: VideoEntry[]; setVideos: (v: VideoEntry[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setVideos([...videos, ...Array.from(files).map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file: f,
    }))]);
  };
  return (
    <div className={rs.section}>
      <div className={rs.sectionHeader}>
        <span className={rs.sectionIcon}>🎬</span>
        <span className={rs.sectionTitle}>Videos</span>
        {videos.length > 0 && <span className={rs.sectionCount}>{videos.length} {videos.length === 1 ? 'file' : 'files'}</span>}
      </div>
      {videos.length > 0 && (
        <div className={rs.videoList}>
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

interface CatchingFormData {
  throwing: {
    popTime2B: ThrowingRow;
    popTime3B: ThrowingRow;
    exchangeTime: ThrowingRow;
    velocity: ThrowingRow;
    overallGrade: string;
  };
  receiving: {
    topOfZone: GradeRow;
    bottomOfZone: GradeRow;
    gloveSide: GradeRow;
    armSide: GradeRow;
    quietHands: GradeRow;
    stanceSetup: GradeRow;
    overallGrade: string;
  };
  blocking: {
    range: GradeRow;
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
      topOfZone: { ...EMPTY_GRADE_ROW },
      bottomOfZone: { ...EMPTY_GRADE_ROW },
      gloveSide: { ...EMPTY_GRADE_ROW },
      armSide: { ...EMPTY_GRADE_ROW },
      quietHands: { ...EMPTY_GRADE_ROW },
      stanceSetup: { ...EMPTY_GRADE_ROW },
      overallGrade: '',
    },
    blocking: {
      range: { ...EMPTY_GRADE_ROW },
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
      topOfZone: parseGrade(data.receiving.topOfZone),
      bottomOfZone: parseGrade(data.receiving.bottomOfZone),
      gloveSide: parseGrade(data.receiving.gloveSide),
      armSide: parseGrade(data.receiving.armSide),
      quietHands: parseGrade(data.receiving.quietHands),
      stanceSetup: parseGrade(data.receiving.stanceSetup),
      overallGrade: data.receiving.overallGrade ? parseInt(data.receiving.overallGrade) || null : null,
    },
    blocking: {
      range: parseGrade(data.blocking.range),
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

  const receivingRows: { key: keyof CatchingFormData['receiving']; label: string }[] = [
    { key: 'topOfZone', label: 'Receiving — Top of Zone' },
    { key: 'bottomOfZone', label: 'Receiving — Bottom of Zone' },
    { key: 'gloveSide', label: 'Receiving — Glove Side' },
    { key: 'armSide', label: 'Receiving — Arm Side' },
    { key: 'quietHands', label: 'Quiet Hands / Presentation' },
    { key: 'stanceSetup', label: 'Stance & Setup' },
  ];

  const blockingRows: { key: keyof CatchingFormData['blocking']; label: string }[] = [
    { key: 'range', label: 'Blocking Range' },
    { key: 'accuracy', label: 'Blocking Accuracy' },
    { key: 'gloveBodyAngle', label: 'Glove / Body Angle' },
    { key: 'recoverySpeed', label: 'Recovery Speed' },
  ];

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
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Throwing Grade
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.throwing.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, throwing: { ...data.throwing, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
      </div>

      {/* ── RECEIVING ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🧤</span> Receiving — Scouting Grades (20–80)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, padding: '0 0 4px' }}>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Skill</span>
            <span style={headerCellStyle}>Grade</span>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Notes</span>
          </div>
          {receivingRows.map(row => {
            const rowData = data.receiving[row.key] as GradeRow;
            return (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={metricLabelStyle}>{row.label}</span>
                <input
                  type="number" min="20" max="80" step="5" style={gradeInputStyle}
                  value={rowData.grade} placeholder="—"
                  onChange={e => updateReceiving(row.key, { grade: e.target.value })}
                />
                <input
                  type="text" style={notesInputStyle}
                  value={rowData.notes} placeholder="Notes..."
                  onChange={e => updateReceiving(row.key, { notes: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Receiving Grade
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.receiving.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, receiving: { ...data.receiving, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
      </div>

      {/* ── BLOCKING ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🛡️</span> Blocking — Scouting Grades (20–80)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, padding: '0 0 4px' }}>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Skill</span>
            <span style={headerCellStyle}>Grade</span>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Notes</span>
          </div>
          {blockingRows.map(row => {
            const rowData = data.blocking[row.key] as GradeRow;
            return (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={metricLabelStyle}>{row.label}</span>
                <input
                  type="number" min="20" max="80" step="5" style={gradeInputStyle}
                  value={rowData.grade} placeholder="—"
                  onChange={e => updateBlocking(row.key, { grade: e.target.value })}
                />
                <input
                  type="text" style={notesInputStyle}
                  value={rowData.notes} placeholder="Notes..."
                  onChange={e => updateBlocking(row.key, { notes: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Blocking Grade
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.blocking.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, blocking: { ...data.blocking, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, padding: '0 0 4px' }}>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Skill</span>
            <span style={headerCellStyle}>Grade</span>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Notes</span>
          </div>
          {rangeRows.map(row => {
            const rowData = data.rangeFootwork[row.key] as GradeRow;
            return (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={metricLabelStyle}>{row.label}</span>
                <input
                  type="number" min="20" max="80" step="5" style={gradeInputStyle}
                  value={rowData.grade} placeholder="—"
                  onChange={e => updateRange(row.key, { grade: e.target.value })}
                />
                <input
                  type="text" style={notesInputStyle}
                  value={rowData.notes} placeholder="Notes..."
                  onChange={e => updateRange(row.key, { notes: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Range / Footwork
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.rangeFootwork.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, rangeFootwork: { ...data.rangeFootwork, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
      </div>

      {/* ── HANDS & GLOVE WORK ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🧤</span> Hands & Glove Work — Scouting Grades (20–80)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, padding: '0 0 4px' }}>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Skill</span>
            <span style={headerCellStyle}>Grade</span>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Notes</span>
          </div>
          {handsRows.map(row => {
            const rowData = data.handsGlove[row.key] as GradeRow;
            return (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={metricLabelStyle}>{row.label}</span>
                <input
                  type="number" min="20" max="80" step="5" style={gradeInputStyle}
                  value={rowData.grade} placeholder="—"
                  onChange={e => updateHands(row.key, { grade: e.target.value })}
                />
                <input
                  type="text" style={notesInputStyle}
                  value={rowData.notes} placeholder="Notes..."
                  onChange={e => updateHands(row.key, { notes: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Hands / Glove
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.handsGlove.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, handsGlove: { ...data.handsGlove, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
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
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Arm Grade
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.arm.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, arm: { ...data.arm, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
      </div>

      {/* ── ROUTES, RANGE, READS & GLOVE ── */}
      <div>
        <div style={sectionTitleStyle}>
          <span>🏃</span> Routes, Range, Reads & Glove — Scouting Grades (20–80)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, padding: '0 0 4px' }}>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Skill</span>
            <span style={headerCellStyle}>Grade</span>
            <span style={{ ...headerCellStyle, textAlign: 'left' }}>Notes</span>
          </div>
          {routesRows.map(row => {
            const rowData = data.routesReads[row.key] as GradeRow;
            return (
              <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8, alignItems: 'center' }}>
                <span style={metricLabelStyle}>{row.label}</span>
                <input
                  type="number" min="20" max="80" step="5" style={gradeInputStyle}
                  value={rowData.grade} placeholder="—"
                  onChange={e => updateRoutes(row.key, { grade: e.target.value })}
                />
                <input
                  type="text" style={notesInputStyle}
                  value={rowData.notes} placeholder="Notes..."
                  onChange={e => updateRoutes(row.key, { notes: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <div style={overallRowStyle}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Overall Routes / Reads
          </span>
          <input
            type="number" min="20" max="80" step="5" style={gradeInputStyle}
            value={data.routesReads.overallGrade} placeholder="20-80"
            onChange={e => setData({ ...data, routesReads: { ...data.routesReads, overallGrade: e.target.value } })}
          />
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>20-80 scouting scale</span>
        </div>
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
}

export function ReportModal({ player, userId, onClose, onSaved, existingReport }: ReportModalProps) {
  const isEdit = !!existingReport;
  const [reportType, setReportType] = useState(existingReport?.reportType || 'HITTING');
  const [csvFiles, setCsvFiles] = useState<Record<string, File | null>>({});
  const [csvResults, setCsvResults] = useState<Record<string, UploadResult | null>>({});
  const [reportTitle, setReportTitle] = useState(existingReport?.title || '');
  const [notes, setNotes] = useState(existingReport?.notes || '');
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

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
              'Blast Motion': 'BLAST_MOTION', 'Full Swing': 'FULL_SWING', 'TrackMan': 'TRACKMAN',
              'VALD': 'VALD', 'Vizual Edge': 'VIZUAL_EDGE', 'Custom': 'AUTO_DETECT',
            };
            const result = await api.uploadCSV(file, userId, sourceMap[slot.vendor], player.id);
            uploadSummary[slot.key] = { vendor: slot.vendor, rows: result.totalRows, metrics: result.metricsCreated, uploadId: result.uploadId };
            setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'success', message: `${result.metricsCreated} metrics from ${result.totalRows} rows`, rows: result.totalRows, metrics: result.metricsCreated } }));
          } catch (err: any) {
            setCsvResults(prev => ({ ...prev, [slot.key]: { status: 'error', message: err?.message || 'Upload failed' } }));
            uploadSummary[slot.key] = { vendor: slot.vendor, error: err?.message };
          }
        }
        // Upload video files
        const uploadedVideoIds: string[] = [];
        const uploadedVideos: { name: string; size: number; id?: string; url?: string }[] = [];
        for (const v of videos) {
          try {
            const result = await api.uploadVideo(v.file, player.id, v.file.name.replace(/\.[^.]+$/, ''), reportType);
            uploadedVideoIds.push(result.id);
            uploadedVideos.push({ name: v.file.name, size: v.file.size, id: result.id, url: result.originalUrl || undefined });
          } catch (err: any) {
            console.error('Video upload failed:', err);
            uploadedVideos.push({ name: v.file.name, size: v.file.size });
          }
        }

        // In edit mode, MERGE the new content keys over the existing report's
        // content JSON so we don't drop fields the modal doesn't manage
        // (manualScores, diagnosisNotes, etc. saved by other UIs).
        let prevContent: Record<string, any> = {};
        if (isEdit && existingReport?.content) {
          try { prevContent = JSON.parse(existingReport.content) || {}; } catch { /* ignore */ }
        }
        const newContent = {
          ...prevContent,
          ...(Object.keys(uploadSummary).length > 0 ? { csvUploads: { ...(prevContent.csvUploads || {}), ...uploadSummary } } : {}),
          ...(uploadedVideos.length > 0 ? { videos: [...(prevContent.videos || []), ...uploadedVideos] } : {}),
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
          } : {}),
        };
        const content = JSON.stringify(newContent);
        if (isEdit && existingReport) {
          // Combine previously-saved videoIds with any newly uploaded ones
          const prevIds = (existingReport.videoIds || '').split(',').map(s => s.trim()).filter(Boolean);
          const combinedIds = [...prevIds, ...uploadedVideoIds];
          await api.updateReport(existingReport.id, {
            content,
            notes: notes || undefined,
            videoIds: combinedIds.length > 0 ? combinedIds.join(',') : undefined,
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
          <h2 className={styles.modalTitle}>New Report — {player.firstName} {player.lastName}</h2>
          <button type="button" className={styles.modalClose} onClick={onClose}>x</button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalBody}>
          {/* Report type chips — cleaner, segmented row */}
          <div className={rs.fieldGroup}>
            <label className={rs.label}>Report Type</label>
            <div className={rs.chipRow}>
              {REPORT_TYPES.map(t => (
                <button key={t.id} type="button"
                  className={`${rs.chip} ${reportType === t.id ? rs.chipActive : ''}`}
                  onClick={() => { setReportType(t.id); setNotes(''); setVideos([]); }}>
                  <span className={rs.chipIcon}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
          </div>

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
              <VideoSection videos={videos} setVideos={setVideos} />
            </>
          ) : reportType === 'INFIELD' ? (
            <>
              <InfieldForm data={infieldData} setData={setInfieldData} />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Infield defensive assessment notes, areas to develop..." rows={4} />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} />
            </>
          ) : reportType === 'OUTFIELD' ? (
            <>
              <OutfieldForm data={outfieldData} setData={setOutfieldData} />
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Outfield defensive assessment notes, areas to develop..." rows={4} />
              </div>
              <VideoSection videos={videos} setVideos={setVideos} />
            </>
          ) : (
            <>
              {reportType === 'HITTING' && (
                <CoachDiagnosisSliders scores={manualScores} setScores={setManualScores} />
              )}
              <div className={rs.section}>
                <div className={rs.sectionHeader}><span className={rs.sectionIcon}>📝</span><span className={rs.sectionTitle}>Notes</span></div>
                <textarea className={rs.notesArea} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Session observations, development notes, drill recommendations..." rows={4} />
              </div>
              <div className={rs.section}>
                <div className={rs.sectionHeader}>
                  <span className={rs.sectionIcon}>📊</span>
                  <span className={rs.sectionTitle}>Data Imports</span>
                  <span className={rs.sectionCount}>{csvSlots.length} {csvSlots.length === 1 ? 'source' : 'sources'}</span>
                </div>
                <div className={rs.csvGrid}>
                  {csvSlots.map(slot => (
                    <CsvUploadCard key={slot.key} slot={slot} file={csvFiles[slot.key] || null} uploadResult={csvResults[slot.key] || null}
                      onSelect={f => setCsvFiles(prev => ({ ...prev, [slot.key]: f }))}
                      onRemove={() => { setCsvFiles(prev => ({ ...prev, [slot.key]: null })); setCsvResults(prev => ({ ...prev, [slot.key]: null })); }} />
                  ))}
                </div>
              </div>
              <VideoSection videos={videos} setVideos={setVideos} />
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
const COACH_DIAG_KEYS: { key: keyof ManualSwingScores; label: string; hint: string }[] = [
  { key: 'forwardMove', label: 'Forward Move', hint: 'Lower-half load → directional intent toward the pitcher.' },
  { key: 'posture',     label: 'Posture',      hint: 'Spine angle from set-up through contact.' },
  { key: 'stability',   label: 'Stability',    hint: 'Balance and base — head-still through finish.' },
  { key: 'direction',   label: 'Direction',    hint: 'Bat path & body line working through the ball.' },
  { key: 'stretch',     label: 'Stretch',      hint: 'Length & separation between hips and shoulders at launch.' },
  { key: 'core',        label: 'Core',         hint: 'Trunk strength & sequencing through contact.' },
  { key: 'slot',        label: 'Slot',         hint: 'Hand path & barrel slot through the hitting zone.' },
  { key: 'timing',      label: 'Timing',       hint: 'On-time launch — load → stride → swing in rhythm with the pitch.' },
];

function CoachDiagnosisSliders({
  scores,
  setScores,
}: {
  scores: ManualSwingScores;
  setScores: React.Dispatch<React.SetStateAction<ManualSwingScores>>;
}) {
  const filledCount = COACH_DIAG_KEYS.filter(k => scores[k.key] != null).length;
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
        {COACH_DIAG_KEYS.map(({ key, label, hint }) => (
          <CoachDiagnosisRow
            key={key}
            label={label}
            hint={hint}
            value={scores[key]}
            onChange={(v) => setScores(prev => ({ ...prev, [key]: v }))}
          />
        ))}
      </div>
    </div>
  );
}

function CoachDiagnosisRow({
  label, hint, value, onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
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
