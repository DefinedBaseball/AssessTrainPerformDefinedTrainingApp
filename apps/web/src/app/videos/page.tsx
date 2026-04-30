'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, VideoWithPlayer } from '@/lib/api';
import VideoThumbnail from '@/components/VideoThumbnail';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

/* ── Constants ── */

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'HITTING', label: 'Hitting' },
  { key: 'PITCHING', label: 'Pitching' },
  { key: 'FIELDING', label: 'Defense' },
  { key: 'CATCHING', label: 'Catching' },
  { key: 'GAME', label: 'Game' },
  { key: 'WORKOUT_DEMO', label: 'S & C' },
];

const GRAD_YEARS = Array.from({ length: 16 }, (_, i) => 2025 + i); // 2025–2040

/* ═══════════════════════════════════════════
   VIDEO PLAYER MODAL (with download button)
   ═══════════════════════════════════════════ */

function VideoPlayerModal({
  video,
  onClose,
}: {
  video: VideoWithPlayer;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const videoUrl = video.hlsUrl || video.originalUrl || '';

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${video.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className={styles.modalOverlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderLeft}>
            <span className={styles.modalTitle}>{video.title}</span>
            <span className={styles.modalMeta}>
              {video.player.firstName} {video.player.lastName} · {video.category}
            </span>
          </div>
          <div className={styles.modalHeaderRight}>
            <button className={styles.modalDownloadBtn} onClick={handleDownload} title="Download video">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2v8M8 10l-3-3M8 10l3-3" />
                <path d="M2 12h12v2H2z" />
              </svg>
              Download
            </button>
            <button className={styles.modalCloseBtn} onClick={onClose}>&times;</button>
          </div>
        </div>
        {/* Video */}
        <div className={styles.modalVideoWrap}>
          <video
            ref={videoRef}
            className={styles.modalVideo}
            src={videoUrl}
            poster={video.thumbnailUrl || undefined}
            controls
            autoPlay
            playsInline
          />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ATHLETE SEARCH DROPDOWN
   ═══════════════════════════════════════════ */

function AthleteDropdown({
  players,
  selectedId,
  onSelect,
}: {
  players: Player[];
  selectedId: string | null; // null = "All Athletes"
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const sorted = useMemo(
    () => [...players].sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`)),
    [players],
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      p => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
        p.positions?.toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const selected = selectedId ? players.find(p => p.id === selectedId) : null;
  const displayLabel = selected ? `${selected.firstName} ${selected.lastName}` : 'All Athletes';

  return (
    <div className={styles.athleteDropdown} ref={dropRef}>
      <button
        type="button"
        className={`${styles.athleteDropdownBtn} ${open ? styles.athleteDropdownBtnOpen : ''}`}
        onClick={() => { setOpen(o => !o); setSearch(''); }}
      >
        <span className={styles.athleteDropdownIcon}>👤</span>
        <span className={styles.athleteDropdownLabel}>{displayLabel}</span>
        <span className={`${styles.athleteDropdownArrow} ${open ? styles.athleteDropdownArrowOpen : ''}`}>▼</span>
      </button>

      {open && (
        <div className={styles.athleteDropdownPanel}>
          {/* Search */}
          <div className={styles.athleteDropdownSearch}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search athletes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={styles.athleteDropdownInput}
            />
          </div>

          {/* Options */}
          <div className={styles.athleteDropdownList}>
            {/* All Athletes option */}
            <button
              type="button"
              className={`${styles.athleteDropdownItem} ${selectedId === null ? styles.athleteDropdownItemActive : ''}`}
              onClick={() => { onSelect(null); setOpen(false); setSearch(''); }}
            >
              <span className={styles.athleteDropdownItemIcon}>🌐</span>
              <span className={styles.athleteDropdownItemName}>All Athletes</span>
              {selectedId === null && <span className={styles.athleteDropdownCheck}>✓</span>}
            </button>

            {/* Player list */}
            {filtered.map(p => (
              <button
                key={p.id}
                type="button"
                className={`${styles.athleteDropdownItem} ${selectedId === p.id ? styles.athleteDropdownItemActive : ''}`}
                onClick={() => { onSelect(p.id); setOpen(false); setSearch(''); }}
              >
                <span className={styles.athleteDropdownItemIcon}>
                  {p.profilePhoto ? (
                    <img src={p.profilePhoto} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />
                  ) : '⚾'}
                </span>
                <div className={styles.athleteDropdownItemInfo}>
                  <span className={styles.athleteDropdownItemName}>{p.lastName}, {p.firstName}</span>
                  <span className={styles.athleteDropdownItemMeta}>
                    {p.positions || '—'} · Class of {p.gradYear || '—'}
                  </span>
                </div>
                {selectedId === p.id && <span className={styles.athleteDropdownCheck}>✓</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className={styles.athleteDropdownEmpty}>No athletes found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   DATE RANGE PICKER
   ═══════════════════════════════════════════ */

function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className={styles.dateRange}>
      <label className={styles.filterLabel}>Date Range</label>
      <div className={styles.dateInputs}>
        <input
          type="date"
          className={styles.dateInput}
          value={from}
          onChange={e => onChange(e.target.value, to)}
          placeholder="From"
        />
        <span className={styles.dateSep}>—</span>
        <input
          type="date"
          className={styles.dateInput}
          value={to}
          onChange={e => onChange(from, e.target.value)}
          placeholder="To"
        />
        {(from || to) && (
          <button
            type="button"
            className={styles.dateClear}
            onClick={() => onChange('', '')}
            title="Clear dates"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   GRAD YEAR MULTI-SELECT
   ═══════════════════════════════════════════ */

function GradYearFilter({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (years: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (yr: number) => {
    onChange(selected.includes(yr) ? selected.filter(y => y !== yr) : [...selected, yr]);
  };

  const label = selected.length === 0 ? 'All Years' : selected.sort().join(', ');

  return (
    <div className={styles.gradYearFilter} ref={ref}>
      <label className={styles.filterLabel}>Grad Year</label>
      <button
        type="button"
        className={styles.gradYearBtn}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.gradYearBtnText}>{label}</span>
        <span className={`${styles.athleteDropdownArrow} ${open ? styles.athleteDropdownArrowOpen : ''}`}>▼</span>
      </button>
      {open && (
        <div className={styles.gradYearPanel}>
          {selected.length > 0 && (
            <button
              type="button"
              className={styles.gradYearClear}
              onClick={() => { onChange([]); setOpen(false); }}
            >
              Clear All
            </button>
          )}
          <div className={styles.gradYearGrid}>
            {GRAD_YEARS.map(yr => (
              <button
                key={yr}
                type="button"
                className={`${styles.gradYearChip} ${selected.includes(yr) ? styles.gradYearChipActive : ''}`}
                onClick={() => toggle(yr)}
              >
                {yr}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   VIDEO CARD
   ═══════════════════════════════════════════ */

function VideoCard({
  video,
  onPlay,
}: {
  video: VideoWithPlayer;
  onPlay: () => void;
}) {
  const videoUrl = video.hlsUrl || video.originalUrl || '';

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `${video.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const formatDuration = (sec: number | null) => {
    if (!sec) return null;
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
  };

  const catColor: Record<string, string> = {
    HITTING: '#4ADE80',
    PITCHING: '#60A5FA',
    FIELDING: '#F59E0B',
    CATCHING: '#A78BFA',
    GAME: '#F87171',
    WORKOUT_DEMO: '#14B8A6',
  };

  return (
    <div className={styles.videoCard} onClick={onPlay}>
      {/* Thumbnail */}
      <div className={styles.videoThumb}>
        <VideoThumbnail
          thumbnailUrl={video.thumbnailUrl}
          src={videoUrl || null}
          className={styles.videoThumbImg}
        />
        <div className={styles.playOverlay}>
          <div className={styles.playBtn}>▶</div>
        </div>
        {video.durationSec && (
          <span className={styles.duration}>{formatDuration(video.durationSec)}</span>
        )}
        <span
          className={styles.catBadge}
          style={{ background: catColor[video.category] || '#6B7280' }}
        >
          {video.category === 'WORKOUT_DEMO' ? 'S&C' : video.category}
        </span>
      </div>

      {/* Body */}
      <div className={styles.videoBody}>
        <div className={styles.videoTitle}>{video.title}</div>
        <div className={styles.videoPlayerName}>
          {video.player.firstName} {video.player.lastName}
          {video.player.positions && (
            <span className={styles.videoPlayerPos}> · {video.player.positions}</span>
          )}
        </div>
        <div className={styles.videoFooter}>
          <span className={styles.videoDate}>
            {new Date(video.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button
            className={styles.downloadBtn}
            onClick={handleDownload}
            title="Download video"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M8 10l-3-3M8 10l3-3" />
              <path d="M2 12h12v2H2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════ */

export default function VideosPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  // Data
  const [players, setPlayers] = useState<Player[]>([]);
  const [videos, setVideos] = useState<VideoWithPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters — players are locked to their own playerId
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [category, setCategory] = useState('all');
  const [gradYears, setGradYears] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Video player
  const [playingVideo, setPlayingVideo] = useState<VideoWithPlayer | null>(null);

  // Auth guard
  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  // For players, auto-lock to their own playerId
  useEffect(() => {
    if (!user) return;
    if (!isCoach && user.playerId) {
      setSelectedPlayerId(user.playerId);
    }
  }, [user, isCoach]);

  // Load players (coach only — players don't need the full list)
  useEffect(() => {
    if (!user || !isCoach) return;
    api.getPlayers().then(setPlayers).catch(() => setPlayers([]));
  }, [user, isCoach]);

  // Load videos (with filters)
  // Players always filter by their own playerId
  const effectivePlayerId = !isCoach && user?.playerId ? user.playerId : selectedPlayerId;
  useEffect(() => {
    if (!user) return;
    // For players without a linked playerId, show nothing
    if (!isCoach && !user.playerId) { setVideos([]); setLoading(false); return; }
    setLoading(true);
    api.browseVideos({
      playerId: effectivePlayerId || undefined,
      category: category === 'all' ? undefined : category,
      gradYears: gradYears.length > 0 ? gradYears : undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    })
      .then(v => { setVideos(v); setLoading(false); })
      .catch(() => { setVideos([]); setLoading(false); });
  }, [user, isCoach, effectivePlayerId, category, gradYears, dateFrom, dateTo]);

  const handleDateChange = useCallback((from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  }, []);

  // Count active filters
  const activeFilters = [
    category !== 'all',
    gradYears.length > 0,
    dateFrom || dateTo,
  ].filter(Boolean).length;

  if (isLoading || !user) return null;

  return (
    <div className={styles.pageWrap}>
      {/* ── Header ── */}
      <PageHeader
        eyebrow="Film Room"
        title={isCoach ? 'Video' : 'My Video'}
        titleAccent="Library"
        subtitle={isCoach ? 'Browse, play, and download player video.' : 'View and download your videos.'}
        readout={videos.length > 0 ? `${videos.length} video${videos.length !== 1 ? 's' : ''}` : undefined}
      />

      {/* ── Athlete Selector (Coach Only) ── */}
      {isCoach && (
        <AthleteDropdown
          players={players}
          selectedId={selectedPlayerId}
          onSelect={setSelectedPlayerId}
        />
      )}

      {/* ── Filters Row ── */}
      <div className={styles.filtersRow}>
        {/* Category chips */}
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Position / Category</label>
          <div className={styles.catRow}>
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                className={`${styles.catChip} ${category === c.key ? styles.catChipActive : ''}`}
                onClick={() => setCategory(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Grad Year multi-select (Coach only) */}
        {isCoach && <GradYearFilter selected={gradYears} onChange={setGradYears} />}

        {/* Date Range */}
        <DateRangeFilter from={dateFrom} to={dateTo} onChange={handleDateChange} />
      </div>

      {/* Active filter pills */}
      {activeFilters > 0 && (
        <div className={styles.activeFilters}>
          {category !== 'all' && (
            <span className={styles.filterPill}>
              {CATEGORIES.find(c => c.key === category)?.label}
              <button onClick={() => setCategory('all')} className={styles.filterPillX}>✕</button>
            </span>
          )}
          {gradYears.map(yr => (
            <span key={yr} className={styles.filterPill}>
              Class of {yr}
              <button onClick={() => setGradYears(gradYears.filter(y => y !== yr))} className={styles.filterPillX}>✕</button>
            </span>
          ))}
          {(dateFrom || dateTo) && (
            <span className={styles.filterPill}>
              {dateFrom || '...'} – {dateTo || '...'}
              <button onClick={() => handleDateChange('', '')} className={styles.filterPillX}>✕</button>
            </span>
          )}
          <button
            className={styles.clearAllBtn}
            onClick={() => { setCategory('all'); setGradYears([]); handleDateChange('', ''); }}
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* ── Video Grid ── */}
      {loading ? (
        <div className={styles.loadingWrap}>
          <div className={styles.spinner} />
          <p>Loading videos...</p>
        </div>
      ) : videos.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎬</span>
          <p className={styles.emptyTitle}>No videos found</p>
          <p className={styles.emptyHint}>
            {activeFilters > 0
              ? 'Try adjusting your filters to see more results.'
              : 'Upload videos from player profiles or the mobile app.'}
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {videos.map(v => (
            <VideoCard
              key={v.id}
              video={v}
              onPlay={() => setPlayingVideo(v)}
            />
          ))}
        </div>
      )}

      {/* ── Video Player Modal ── */}
      {playingVideo && (
        <VideoPlayerModal
          video={playingVideo}
          onClose={() => setPlayingVideo(null)}
        />
      )}
    </div>
  );
}
