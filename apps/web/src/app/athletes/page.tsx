'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { getAgeFromBirthDate } from './[id]/helpers';
import styles from './page.module.css';

const POSITIONS = ['All', 'C', 'INF', 'OF', 'P', 'UTIL'];

export default function AthletesPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('All');
  const [sortDir, setSortDir] = useState<'az' | 'za'>('az'); // default alphabetical
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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

  const filtered = players.filter(p => {
    const name = `${p.firstName} ${p.lastName}`.toLowerCase();
    const matchesSearch = !search || name.includes(search.toLowerCase());
    const matchesPos = posFilter === 'All' || p.positions.includes(posFilter);
    return matchesSearch && matchesPos;
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
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'nowrap',
          }}>
            <input
              type="text"
              placeholder="Search athletes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            {isCoach && (
              <Link href="/players/new" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                + Add Athlete
              </Link>
            )}
          </div>
        }
      />

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
            <span className={styles.colPbr}>PBR St.</span>
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
              <Link key={p.id} href={`/athletes/${p.id}`} className={styles.listRow}>
                <span className={styles.colName}>
                  <span className={styles.avatar}>
                    {p.firstName[0]}{p.lastName[0]}
                  </span>
                  <span className={styles.playerName}>{p.firstName} {p.lastName}</span>
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
                <span className={styles.colPbr}>{p.pbrState ?? '—'}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
