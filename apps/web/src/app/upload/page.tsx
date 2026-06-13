'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { CsvUploadResult, UploadHistoryEntry } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

const SOURCES = [
  { key: 'auto', label: 'Auto-Detect' },
  { key: 'BLAST_MOTION', label: 'Blast Motion' },
  { key: 'FULL_SWING', label: 'Full Swing' },
  { key: 'HITTRAX', label: 'HitTrax' },
  { key: 'TRACKMAN', label: 'Trackman' },
  { key: 'VALD', label: 'VALD' },
];

export default function UploadPage() {
  const router = useRouter();
  const { user, isLoading, isCoach } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [source, setSource] = useState('auto');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<CsvUploadResult | null>(null);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [history, setHistory] = useState<UploadHistoryEntry[]>([]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    /* CSV import is coach tooling (the API is @Roles('COACH') anyway) —
       bounce players to the dashboard instead of showing a UI that 401s. */
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  const refreshHistory = () => {
    if (!user) return;
    api.getUploadHistory().then(setHistory).catch(() => setHistory([]));
  };

  useEffect(() => { refreshHistory(); /* eslint-disable-next-line */ }, [user]);

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.csv')) {
      setError('Please select a CSV file.');
      return;
    }
    setFile(f);
    setError('');
    setResult(null);
  };

  const handleUpload = async () => {
    if (!file || !user) return;
    setUploading(true);
    setError('');
    try {
      const res = await api.uploadCSV(file, user.id, source === 'auto' ? undefined : source);
      setResult(res);
      setFile(null);
      refreshHistory();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (isLoading || !user) return null;

  return (
    <div>
      <PageHeader
        eyebrow="Data Import"
        title="Upload"
        titleAccent="CSV"
        subtitle="Import player metrics from Blast Motion, Full Swing, HitTrax, Trackman, or VALD"
      />

      {/* Source selector */}
      <div className={styles.sourceRow}>
        {SOURCES.map(s => (
          <button
            key={s.key}
            className={`${styles.sourceChip} ${source === s.key ? styles.sourceChipActive : ''}`}
            onClick={() => setSource(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {file ? (
          <div className={styles.fileInfo}>
            <span className={styles.fileIcon}>📄</span>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
          </div>
        ) : (
          <>
            <span className={styles.dropIcon}>📁</span>
            <p className={styles.dropText}>Drag & drop a CSV file here, or click to browse</p>
            <p className={styles.dropHint}>Supports Blast Motion, Full Swing, HitTrax, Trackman, and VALD formats</p>
          </>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 16 }}
        onClick={handleUpload}
        disabled={!file || uploading}
      >
        {uploading ? 'Processing...' : 'Upload & Process'}
      </button>

      {/* Results */}
      {result && (
        <div className={styles.results}>
          <h2 className={styles.resultsTitle}>Upload Results</h2>

          <div className={styles.resultsGrid}>
            <div className={styles.resultCard}>
              <div className={styles.resultValue}>{result.detectedSource}</div>
              <div className={styles.resultLabel}>Source Detected</div>
            </div>
            <div className={styles.resultCard}>
              <div className={styles.resultValue}>{(result.confidence * 100).toFixed(0)}%</div>
              <div className={styles.resultLabel}>Confidence</div>
            </div>
            <div className={styles.resultCard}>
              <div className={styles.resultValue}>{result.totalRows}</div>
              <div className={styles.resultLabel}>Total Rows</div>
            </div>
            <div className={styles.resultCard}>
              <div className={styles.resultValue} style={{ color: 'var(--success)' }}>{result.metricsCreated}</div>
              <div className={styles.resultLabel}>Metrics Created</div>
            </div>
          </div>

          {result.playersMatched.length > 0 && (
            <div className={styles.resultSection}>
              <h3 className={styles.resultSectionTitle}>Players Matched ({result.playersMatched.length})</h3>
              <div className={styles.chipList}>
                {result.playersMatched.map(name => (
                  <span key={name} className={styles.matchedChip}>{name}</span>
                ))}
              </div>
            </div>
          )}

          {result.playersUnmatched.length > 0 && (
            <div className={styles.resultSection}>
              <h3 className={styles.resultSectionTitle}>Unmatched ({result.playersUnmatched.length})</h3>
              <div className={styles.chipList}>
                {result.playersUnmatched.map(name => (
                  <span key={name} className={styles.unmatchedChip}>{name}</span>
                ))}
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className={styles.resultSection}>
              <h3 className={styles.resultSectionTitle} style={{ color: 'var(--error)' }}>
                Errors ({result.errors.length})
              </h3>
              {result.errors.slice(0, 10).map((e, i) => (
                <div key={i} className={styles.errorRow}>
                  <span>Row {e.row}:</span> {e.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upload history */}
      {history.length > 0 && (
        <div className={styles.history}>
          <h2 className={styles.historyTitle}>Upload History</h2>
          <table className={styles.historyTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th>File</th>
                <th>Status</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 15).map(h => (
                <tr key={h.id}>
                  <td>{new Date(h.createdAt).toLocaleString()}</td>
                  <td><span className={styles.sourceTag}>{h.source}</span></td>
                  <td className={styles.fileCell}>{h.fileUrl}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${styles[`status_${h.status.toLowerCase()}`] || ''}`}>
                      {h.status}
                    </span>
                  </td>
                  <td>
                    {h.successRows ?? 0}
                    {h.totalRows ? ` / ${h.totalRows}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* How it works */}
      <div className={styles.howItWorks}>
        <h3 className={styles.howTitle}>How It Works</h3>
        <div className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <div>
              <strong>Select source</strong> or leave on Auto-Detect
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <div>
              <strong>Drop your CSV</strong> — exported from any supported vendor
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <div>
              <strong>Auto-match</strong> — player names are fuzzy-matched to your roster
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>4</span>
            <div>
              <strong>Metrics imported</strong> — data appears on player profiles and leaderboards
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
