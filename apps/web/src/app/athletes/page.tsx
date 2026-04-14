'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { MOCK_PLAYERS } from '@/lib/mock-data';
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
      <div className={styles.header}>
        <h1 className={styles.title}>Athletes</h1>
        <div className={styles.actions}>
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
        </div>
      </div>

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
        <div className={styles.grid}>
          {filtered.map(p => (
            <Link key={p.id} href={`/athletes/${p.id}`} className={styles.playerCard}>
              <div className={styles.cardHeader}>
                <div className={styles.avatar}>
                  {p.firstName[0]}{p.lastName[0]}
                </div>
                <div>
                  <div className={styles.playerName}>{p.firstName} {p.lastName}</div>
                  <div className={styles.playerMeta}>
                    {p.gradYear && <span>Class of {p.gradYear}</span>}
                  </div>
                </div>
              </div>

              <div className={styles.positionsRow}>
                {p.positions.split(',').map(pos => (
                  <span key={pos.trim()} className="badge">{pos.trim()}</span>
                ))}
              </div>

              <div className={styles.cardStats}>
                {p.heightInches && (
                  <div className={styles.cardStat}>
                    <span className={styles.cardStatValue}>
                      {Math.floor(p.heightInches / 12)}'{p.heightInches % 12}"
                    </span>
                    <span className={styles.cardStatLabel}>Height</span>
                  </div>
                )}
                {p.weightLbs && (
                  <div className={styles.cardStat}>
                    <span className={styles.cardStatValue}>{p.weightLbs}</span>
                    <span className={styles.cardStatLabel}>Weight</span>
                  </div>
                )}
                {p.collegeCommit && (
                  <div className={styles.cardStat}>
                    <span className={styles.cardStatValue} style={{ color: 'var(--success)', fontSize: 13 }}>
                      {p.collegeCommit}
                    </span>
                    <span className={styles.cardStatLabel}>Commit</span>
                  </div>
                )}
              </div>

              {(p.pbrNational || p.pgScore) && (
                <div className={styles.rankings}>
                  {p.pbrNational && <span className={styles.ranking}>PBR #{p.pbrNational}</span>}
                  {p.pgScore && <span className={styles.ranking}>PG {p.pgScore}</span>}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
