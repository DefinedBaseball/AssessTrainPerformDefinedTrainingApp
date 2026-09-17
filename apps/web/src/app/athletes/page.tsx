'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { getAgeFromBirthDate } from './[id]/helpers';
import { ATHLETE_TYPE_FILTERS, matchesAthleteTypeFilter } from '@/lib/athlete-types';
import styles from './page.module.css';

const POSITIONS = ['All', 'C', 'INF', 'OF', 'P', 'UTIL'];

/* Persist the coach's last athlete-type filter across navigation (localStorage
   so it also survives a full reload / new session). */
const TYPE_FILTER_KEY = 'athleteHub.typeFilter';

export default function AthletesPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('All');
  // Athlete Hub type dropdown — lazy-init from the persisted choice (validated
  // against the known filter keys so a stale value can't select a dead option).
  // Safe with the auth gate below: the select isn't in the server HTML, so
  // reading localStorage during init can't cause a hydration mismatch.
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    if (typeof window === 'undefined') return 'ALL';
    try {
      const saved = localStorage.getItem(TYPE_FILTER_KEY);
      return saved && ATHLETE_TYPE_FILTERS.some(f => f.key === saved) ? saved : 'ALL';
    } catch {
      return 'ALL';
    }
  });
  const [sortDir, setSortDir] = useState<'az' | 'za'>('az'); // default alphabetical
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /* Locking pauses an athlete: the API flips their account to LOCKED, which
     the JWT guard rejects on every request, and Apply Calendar skips them.
     `lockingId` disables just the row being changed so a slow request cannot
     be double-fired. */
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [lockError, setLockError] = useState('');


  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    // Players don't see the team roster — bounce them to their own profile.
    // The backend now blocks api.getPlayers() for the PLAYER role too, but
    // gating the route here avoids a flash of empty state and wasted fetch.
    if (!isCoach) {
      const target = (user as any).playerId ? `/athletes/${(user as any).playerId}` : '/';
      router.replace(target);
    }
  }, [isLoading, user, isCoach, router]);

  /* Load the roster. One silent retry absorbs the Render cold-start (the
     first request after the API idles can time out); a genuine failure then
     surfaces an honest error + Retry state instead of substituting demo
     players — a transient blip must never look like "the roster vanished". */
  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const p = await api.getPlayers();
        setPlayers(p.filter(x => x.positions !== 'COACH'));
        setLoading(false);
        return;
      } catch {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1200)); continue; }
        setLoadError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!user || !isCoach) return;
    loadPlayers();
  }, [user, isCoach, loadPlayers]);

  const toggleLock = useCallback(async (p: Player, locked: boolean) => {
    if (locked && !window.confirm(
      `Lock ${p.firstName} ${p.lastName}?\n\nThey lose access to the app immediately, and program schedules will skip them until you unlock.`,
    )) return;
    setLockingId(p.id);
    setLockError('');
    try {
      await api.setPlayerLocked(p.id, locked);
      /* Refetch rather than patching local state: the row moves between two
         lists, and the server is the authority on the resulting status. */
      await loadPlayers();
    } catch (e: any) {
      setLockError(e?.message || (locked ? 'Failed to lock' : 'Failed to unlock'));
    } finally {
      setLockingId(null);
    }
  }, [loadPlayers]);

  /* Locked athletes leave the main roster and live in their own list — the
     Hub should read as "who is active" at a glance. */
  const lockedPlayers = players
    .filter(api.isPlayerLocked)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

  const filtered = players.filter(p => {
    if (api.isPlayerLocked(p)) return false;
    const name = `${p.firstName} ${p.lastName}`.toLowerCase();
    const matchesSearch = !search || name.includes(search.toLowerCase());
    const matchesPos = posFilter === 'All' || p.positions.includes(posFilter);
    // Athlete-type dropdown — Membership implies Program (see lib/athlete-types).
    const matchesType = matchesAthleteTypeFilter(p.athleteTypes, typeFilter);
    return matchesSearch && matchesPos && matchesType;
  });

  // Alphabetical by displayed name ("First Last"); toggle flips A–Z / Z–A.
  const sorted = [...filtered].sort((a, b) => {
    const cmp = `${a.firstName} ${a.lastName}`.localeCompare(
      `${b.firstName} ${b.lastName}`, undefined, { sensitivity: 'base' },
    );
    return sortDir === 'az' ? cmp : -cmp;
  });

  const gradYears = [...new Set(players.map(p => p.gradYear).filter(Boolean))].sort();

  if (isLoading || !user) return null;

  return (
    <div className={styles.pageRoot}>
      <PageHeader
        eyebrow="Roster"
        title="Athlete"
        titleAccent="Hub"
        actions={
          <div className={styles.hubActions}>
            <input
              type="text"
              placeholder="Search athletes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            {/* Athlete-type filter — All / Program / Lesson / Membership /
                Remote. Membership athletes also surface under Program (the
                implication lives in lib/athlete-types). */}
            <select
              value={typeFilter}
              onChange={e => {
                setTypeFilter(e.target.value);
                try { localStorage.setItem(TYPE_FILTER_KEY, e.target.value); } catch { /* storage unavailable */ }
              }}
              className={styles.typeFilter}
              style={{ whiteSpace: 'nowrap' }}
              title="Filter by athlete type"
              aria-label="Filter by athlete type"
            >
              {ATHLETE_TYPE_FILTERS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            {isCoach && (
              <Link href="/players/new" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                + Add Athlete
              </Link>
            )}
            {/* Locked athletes live on their own page — same table as this
                one, with Unlock in place of Lock. Sits left of the inquiry
                form. */}
            {isCoach && (
              <Link
                href="/athletes/locked"
                className={`btn btn-outline ${styles.iconBtn}`}
                title={`Locked athletes (${lockedPlayers.length})`}
                aria-label={`Locked athletes (${lockedPlayers.length})`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="10.5" width="16" height="10" rx="2" />
                  <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                </svg>
                {lockedPlayers.length > 0 && (
                  <span className={styles.lockBadge}>{lockedPlayers.length}</span>
                )}
              </Link>
            )}
            {/* Form icon → the inquiry roster (prospective athletes who
                submitted the public inquiry form). Coach-only. */}
            {isCoach && (
              <Link
                href="/inquiries"
                className={`btn btn-outline ${styles.iconBtn}`}
                title="Athlete inquiries"
                aria-label="Athlete inquiries"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
                  <path d="M14 3v4h4" />
                  <line x1="9" y1="12.5" x2="15" y2="12.5" />
                  <line x1="9" y1="16.5" x2="13" y2="16.5" />
                </svg>
              </Link>
            )}
          </div>
        }
      />

      {lockError && (
        <div className={styles.lockError}>
          {lockError}
          <button type="button" onClick={() => setLockError('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Position filter */}
      <div className={styles.filterRow}>
        {POSITIONS.map(pos => (
          <button
            key={pos}
            className={`${styles.filterChip} ${posFilter === pos ? styles.filterChipActive : ''}`}
            onClick={() => setPosFilter(pos)}
          >
            {pos}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Loading athletes...</p>
      ) : loadError ? (
        <div className={styles.empty}>
          <p>Couldn&apos;t load the roster.</p>
          <button
            type="button"
            className="btn btn-primary"
            style={{ marginTop: 14 }}
            onClick={loadPlayers}
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>{players.length === 0 ? 'No athletes yet' : 'No athletes found'}</p>
        </div>
      ) : (
        <div className={styles.listWrap}>
          <div className={styles.listHeader}>
            <span
              className={styles.colName}
              onClick={() => setSortDir(d => (d === 'az' ? 'za' : 'az'))}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              title={sortDir === 'az' ? 'Sorted A–Z — click for Z–A' : 'Sorted Z–A — click for A–Z'}
            >
              Name {sortDir === 'az' ? '↑' : '↓'}
            </span>
            <span className={styles.colAge}>Age</span>
            <span className={styles.colGrad}>Grad</span>
            <span className={styles.colPos}>Position</span>
            <span className={styles.colHt}>Height</span>
            <span className={styles.colWt}>Weight</span>
            <span className={styles.colLock}>Lock</span>
          </div>
          {sorted.map(p => {
            // Age comes strictly from birthDate via the shared
            // helper so the athletes-list and profile telemetry
            // strip agree exactly. Replaces the previous
            // `(now - birth) / 31557600000` approximation, which
            // drifted by up to a day around the player's birthday.
            const age = getAgeFromBirthDate(p.birthDate);
            const ht = p.heightInches
              ? `${Math.floor(p.heightInches / 12)}'${p.heightInches % 12}"`
              : '—';

            return (
              /* A div, not a Link: the row now holds a lock BUTTON, and a
                 button inside an anchor is invalid HTML. The name carries the
                 navigation instead. */
              <div key={p.id} className={styles.listRow}>
                <span className={styles.colName}>
                  <span className={styles.avatar}>
                    {p.firstName[0]}{p.lastName[0]}
                  </span>
                  <Link href={`/athletes/${p.id}`} className={`${styles.playerName} ${styles.playerNameLink}`}>
                    {p.firstName} {p.lastName}
                  </Link>
                </span>
                <span className={styles.colAge}>{age ?? '—'}</span>
                <span className={styles.colGrad}>{api.formatGradYear(p.gradYear)}</span>
                <span className={styles.colPos}>
                  <span className={styles.positionsRow}>
                    {p.positions.split(',').map(pos => (
                      <span key={pos.trim()} className="badge">{pos.trim()}</span>
                    ))}
                  </span>
                </span>
                <span className={styles.colHt}>{ht}</span>
                <span className={styles.colWt}>{p.weightLbs ?? '—'}</span>
                <span className={styles.colLock}>
                  {isCoach && (
                    <button
                      type="button"
                      className={styles.lockBtn}
                      disabled={lockingId === p.id}
                      onClick={() => toggleLock(p, true)}
                      title="Lock — pauses app access and program scheduling"
                      aria-label={`Lock ${p.firstName} ${p.lastName}`}
                    >
                      {lockingId === p.id ? '…' : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="4" y="10.5" width="16" height="10" rx="2" />
                          <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                        </svg>
                      )}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
