'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player, VideoWithPlayer, Metric } from '@/lib/api';
import VideoThumbnail from '@/components/VideoThumbnail';
import { PageHeader } from '@/components/PageHeader';
import aStyles from '@/components/assessment/assessment.module.css';
import { bundleVideos, normalizeVideoTitle } from '@/lib/video-titles';
import { getVideoCategoryColors } from '@/lib/training-colors';
import { VideoBundleModal, VideoBundleCard } from '@/components/assessment';
import styles from './page.module.css';

// Coaching Studio retired - its features (mic-narrated Coach Review
// recording, drawing tools, sync/unsync grid playback,
// compare-with-other-video) all live inside the regular video bubble
// modal now. The videos page is library-only.

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
  /* Per-athlete report lists, keyed by `playerId`. The global Film
     Room mixes clips from every player on the roster, so when a coach
     opens a VideoBundleCard and starts a Coach Review recording the
     "Attach to Report" dropdown needs to show THAT player's reports —
     not a single shared list. We lazy-fill this map: every time a new
     player's clip appears in the visible video list we ensure that
     player's reports are loaded, then forward the per-card subset
     down to each VideoBundleCard via its `reports` prop. */
  const [reportsByPlayer, setReportsByPlayer] = useState<Record<string, any[]>>({});

  // Filters — players are locked to their own playerId
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [category, setCategory] = useState('all');
  const [gradYears, setGradYears] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Video player
  const [playingVideo, setPlayingVideo] = useState<VideoWithPlayer | null>(null);
  /* Multi-angle bundle currently open in the bundle viewer modal.
     Distinct from `playingVideo` (single-clip viewer). */
  const [openBundle, setOpenBundle] = useState<{ videos: VideoWithPlayer[]; label: string } | null>(null);

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

  /* Lazy-load reports for every player whose clip is currently in the
     visible video list, but only if we haven't fetched them yet. Each
     VideoBundleCard receives a per-player report subset via its
     `reports` prop, which the bundle modal then surfaces in the
     "Attach to Report" dropdown when the coach saves a Coach Review
     recording. Without this the Film Room would let coaches record
     reviews but not attach them to a report — the same UX every
     per-athlete tab already supports. */
  useEffect(() => {
    if (!user) return;
    const seen = new Set<string>();
    const pending: string[] = [];
    for (const v of videos) {
      const pid = (v as VideoWithPlayer).player?.id;
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      if (!(pid in reportsByPlayer)) pending.push(pid);
    }
    if (pending.length === 0) return;
    /* Fire all missing-player report fetches in parallel and merge
       into the map as each one resolves. Errors are swallowed per
       player so one 404 doesn't take down the whole map. */
    Promise.all(
      pending.map((pid) =>
        api.getPlayerReports(pid)
          .then((reports) => [pid, reports] as [string, typeof reports])
          /* Cast the empty-array branch to the same tuple shape as
             the success branch so TS infers a single union type
             instead of treating the catch result as `readonly []`
             (which then can't be assigned into the mutable `next`
             record below). */
          .catch(() => [pid, [] as Awaited<ReturnType<typeof api.getPlayerReports>>] as [string, Awaited<ReturnType<typeof api.getPlayerReports>>]),
      ),
    ).then((entries) => {
      setReportsByPlayer((prev) => {
        const next = { ...prev };
        for (const [pid, reports] of entries) next[pid] = reports;
        return next;
      });
    });
  }, [videos, user, reportsByPlayer]);

  /* Re-fetch videos after a Coach Review recording uploads so the new
     clip appears in the gallery immediately. Plumbed through every
     VideoBundleCard via `onUploaded`. */
  const handleVideoUploaded = useCallback(() => {
    if (!user) return;
    if (!isCoach && !user.playerId) return;
    api.browseVideos({
      playerId: effectivePlayerId || undefined,
      category: category === 'all' ? undefined : category,
      gradYears: gradYears.length > 0 ? gradYears : undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    })
      .then((v) => setVideos(v))
      .catch(() => { /* swallow — gallery just won't refresh */ });
  }, [user, isCoach, effectivePlayerId, category, gradYears, dateFrom, dateTo]);

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
        readout={videos.length > 0
          ? `${videos.length} video${videos.length !== 1 ? 's' : ''}`
          : undefined}
      />

      {/* Coaching Studio retired — its tab + the standalone authoring
          UI were removed. Every record/draw/sync/compare feature now
          lives inside the regular video bubble modal that opens when
          any video tile is clicked. The /videos page is library-only:
          a filterable, downloadable browse view of every video. */}

      {/* Outer dark-navy panel — same `aStyles.profilePanel` chrome
          the Leaderboards page wraps itself in. Contains the athlete
          dropdown + filters + video grid so the whole page reads as
          one big dark-blue bubble with the grey video tiles laid
          inside it. */}
      <div
        className={aStyles.profilePanel}
        style={{ marginTop: 16, padding: 20, display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Athlete Selector (Coach Only) ── */}
        {isCoach && (
          <AthleteDropdown
            players={players}
            selectedId={selectedPlayerId}
            onSelect={setSelectedPlayerId}
          />
        )}

        {/* ── Library content ── */}
        <>
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
        /* 4-column grid using the shared VideoBundleCard — same
           grey curveball-style bubble + category-colored border +
           white text the rest of the app's video galleries use.
           Bundles collapse to a single tile with a count badge in
           the bottom corner; clicking opens VideoBundleModal.
           Label override: "First Last, Position" — replaces the
           standard `Category - Source - Detail` shape because on a
           multi-player library page the athlete + position is the
           most useful at-a-glance identifier. */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gridAutoRows: 'max-content',
          gap: 16,
        }}>
          {bundleVideos(videos).map((b) => {
            const first = b.videos[0];
            const cardVideos = b.videos.map((v) => ({
              id: v.id,
              title: v.title,
              category: v.category,
              createdAt: v.createdAt,
              originalUrl: v.hlsUrl || v.originalUrl,
            }));
            /* No `label` prop — fall back to the default
               `formatBubbleLabel` inside VideoBundleCard, which
               composes the same `<Category> - <Source> - <Detail>`
               (or `Coach Review - <Category> - <Source>`) shape the
               player-profile galleries use. The athlete's name is
               passed via `subtitle` so it surfaces next to the date
               at the bottom of each tile (only on this multi-player
               library view; per-athlete galleries skip it). */
            const playerName =
              `${first.player.firstName} ${first.player.lastName}`.trim();
            /* Pull this clip's player's pre-fetched report list out of
               the per-player report map. Missing-key fallback to an
               empty array so the dropdown auto-hides cleanly (per the
               `AttachableReport[]` empty-omit contract on
               VideoBundleModalProps) while the lazy-load effect
               continues populating the map in the background. */
            const playerReports = reportsByPlayer[first.player.id] ?? [];
            return (
              <VideoBundleCard
                key={b.key}
                videos={cardVideos}
                size="lg"
                playerId={first.player.id}
                recordingCategory={first.category}
                subtitle={playerName}
                /* Hand the per-clip player's reports to the bundle
                   modal so the global Film Room's Record-and-save
                   flow now surfaces the same "Attach to Report"
                   dropdown the per-athlete tabs have. */
                reports={playerReports}
                /* Refresh the gallery after a Coach Review upload so
                   the new clip appears without a manual reload. */
                onUploaded={handleVideoUploaded}
              />
            );
          })}
        </div>
      )}
        </>
      </div>{/* /profilePanel */}

      {/* ── Video Player Modal (single-clip viewer) ── */}
      {playingVideo && (
        <VideoPlayerModal
          video={playingVideo}
          onClose={() => setPlayingVideo(null)}
        />
      )}

      {/* ── Bundle Viewer Modal (multi-angle Training clips) ─────────
          Opens when the coach clicks a bundle tile in the gallery.
          The modal carries mode-toggle UX (One by One vs Grid) so
          coaches can choose how to watch the angles. */}
      {openBundle && (
        <VideoBundleModal
          videos={openBundle.videos.map((v) => ({
            id: v.id,
            title: v.title,
            category: v.category,
            createdAt: v.createdAt,
            originalUrl: v.hlsUrl || v.originalUrl || null,
          }))}
          label={openBundle.label}
          onClose={() => setOpenBundle(null)}
        />
      )}
    </div>
  );
}
