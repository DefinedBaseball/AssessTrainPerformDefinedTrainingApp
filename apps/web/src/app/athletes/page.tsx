'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { MOCK_PLAYERS } from '@/lib/mock-data';
import { PageHeader } from '@/components/PageHeader';
import styles from './page.module.css';

const POSITIONS = ['All', 'C', 'INF', 'OF', 'P', 'UTIL'];

export default function AthletesPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.getPlayers().then(p => {
      const athletes = p.filter(x => x.positions !== 'COACH');
      setPlayers(athletes.length > 0 ? athletes : MOCK_PLAYERS);
      setLoading(false);
    }).catch(() => { setPlayers(MOCK_PLAYERS); setLoading(false); });
  }, [user]);

  const filtered = players.filter(p => {
    const name = `${p.firstName} ${p.lastName}`.toLowerCase();
    const matchesSearch = !search || name.includes(search.toLowerCase());
    const matchesPos = posFilter === 'All' || p.positions.includes(posFilter);
    return matchesSearch && matchesPos;
  });

  const gradYears = [...new Set(players.map(p => p.gradYear).filter(Boolean))].sort();

  if (isLoading || !user) return null;

  return (
    <div>
      <PageHeader
        eyebrow="Roster"
        title="Athletes"
        subtitle="Search, filter, and jump into any athlete's development profile."
        readout={`${players.length} on roster`}
        actions={
          <>
            <input
              type="text"
              placeholder="Search athletes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            {isCoach && (
              <Link href="/players/new" className="btn btn-primary">+ Add Athlete</Link>
            )}
          </>
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
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <p>No athletes found</p>
        </div>
      ) : (
        <div className={styles.listWrap}>
          <div className={styles.listHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colAge}>Age</span>
            <span className={styles.colGrad}>Grad</span>
            <span className={styles.colPos}>Position</span>
            <span className={styles.colHt}>Height</span>
            <span className={styles.colWt}>Weight</span>
            <span className={styles.colPbr}>PBR St.</span>
            <span className={styles.colPg}>PG</span>
          </div>
          {filtered.map(p => {
            const age = p.birthDate
              ? Math.floor((Date.now() - new Date(p.birthDate).getTime()) / 31557600000)
              : null;
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
                <span className={styles.colGrad}>{p.gradYear ?? '—'}</span>
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
                <span className={styles.colPg}>{p.pgScore ?? '—'}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
