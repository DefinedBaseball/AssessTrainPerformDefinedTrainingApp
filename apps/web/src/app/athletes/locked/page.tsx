'use client';

/* ─────────────────────────────────────────────────────────────────────────
   Locked Athletes — the roster of paused accounts.

   A sibling page to the Athlete Hub rather than a dropdown on it, and it
   reuses the Hub's own list classes so the two read as the same table: same
   columns, same widths, same breakpoints. The only difference is the last
   column, which unlocks instead of locks.

   Reached from the padlock button in the Hub's header, beside the inquiry
   form. `/athletes/locked` is a static segment, so Next resolves it here
   rather than to `/athletes/[id]`.
   ───────────────────────────────────────────────────────────────────────── */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { getAgeFromBirthDate } from '../[id]/helpers';
import styles from '../page.module.css';

export default function LockedAthletesPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  /* Same one-silent-retry as the Hub — absorbs a cold start before showing an
     honest error, so a blip never reads as "nobody is locked". */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const all = await api.getPlayers();
        setPlayers(all.filter(p => p.positions !== 'COACH'));
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
    load();
  }, [user, isCoach, load]);

  const unlock = useCallback(async (p: Player) => {
    setUnlockingId(p.id);
    setError('');
    try {
      await api.setPlayerLocked(p.id, false);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to unlock');
    } finally {
      setUnlockingId(null);
    }
  }, [load]);

  const locked = players
    .filter(api.isPlayerLocked)
    .filter(p => {
      const name = `${p.firstName} ${p.lastName}`.toLowerCase();
      return !search || name.includes(search.toLowerCase());
    })
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

  const totalLocked = players.filter(api.isPlayerLocked).length;

  if (isLoading || !user) return null;

  return (
    <div className={styles.pageRoot}>
      <PageHeader
        eyebrow="Paused Accounts"
        title="Locked"
        titleAccent="Athletes"
        actions={
          <div className={styles.hubActions}>
            <input
              type="text"
              placeholder="Search locked athletes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className={styles.searchInput}
            />
            <Link href="/athletes" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>
              ← Athlete Hub
            </Link>
          </div>
        }
      />

      {error && (
        <div className={styles.lockError}>
          {error}
          <button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button>
        </div>
      )}

      <p className={styles.lockedIntro}>
        A locked athlete cannot sign in, and program schedules skip them. Unlocking
        restores both immediately.
      </p>

      {loading ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>Loading…</p>
      ) : loadError ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
          Couldn&apos;t load the roster.{' '}
          <button type="button" className={styles.unlockBtn} onClick={() => load()}>Retry</button>
        </p>
      ) : totalLocked === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
          No locked athletes. Lock one from the <Link href="/athletes">Athlete Hub</Link>.
        </p>
      ) : locked.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 48 }}>
          No locked athletes match “{search}”.
        </p>
      ) : (
        <div className={styles.listWrap}>
          {/* Same columns and widths as the Hub — only the action differs. */}
          <div className={styles.listHeader}>
            <span className={styles.colName}>Name</span>
            <span className={styles.colAge}>Age</span>
            <span className={styles.colGrad}>Grad</span>
            <span className={styles.colPos}>Position</span>
            <span className={styles.colHt}>Height</span>
            <span className={styles.colWt}>Weight</span>
            <span className={styles.colLock}>Unlock</span>
          </div>
          {locked.map(p => {
            const age = getAgeFromBirthDate(p.birthDate);
            const ht = p.heightInches
              ? `${Math.floor(p.heightInches / 12)}'${p.heightInches % 12}"`
              : '—';
            return (
              <div key={p.id} className={styles.listRow}>
                <span className={styles.colName}>
                  <span className={styles.avatar}>{p.firstName[0]}{p.lastName[0]}</span>
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
                  <button
                    type="button"
                    className={styles.unlockBtn}
                    disabled={unlockingId === p.id}
                    onClick={() => unlock(p)}
                    title="Unlock — restores access and program scheduling"
                  >
                    {unlockingId === p.id ? '…' : 'Unlock'}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
