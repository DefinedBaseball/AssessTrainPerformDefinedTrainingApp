'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import type { Player } from '@/lib/api';
import { ProfileReminderButton } from '@/components/ProfileReminderButton';
import { getAgeFromBirthDate } from '../athletes/[id]/helpers';
import aStyles from '../athletes/page.module.css';
import styles from './page.module.css';
/* Coach Dashboard theme: canvas, banner and bubble surfaces. */
import eduStyles from '../education/page.module.css';
import dashStyles from '../page.module.css';
import theme from '../dashTheme.module.css';
import { EduHeader, IconAthletes } from '../education/EduHeader';
import { AthleteAvatar } from '@/components/AthleteAvatar';
import { PendingInvites, useAthletePendingInvites } from '@/components/PendingInvites';


/**
 * The single "Team" a client is playing for.
 *
 * An athlete can carry all three at once, so this picks the one that
 * identifies them best: College, else High School, else Club Team.
 *
 * Reads `college` (where they actually play), NOT `collegeCommit` — that is
 * the recruiting commitment behind the dashboard's Committed count, and a
 * committed junior still plays for their high school.
 *
 * The club case is labelled because "Canes National" on its own reads like a
 * school to anyone scanning the column.
 */
function teamFor(p: Player): string {
  if (p.college) return p.college;
  if (p.highSchool) return p.highSchool;
  if (p.clubTeam) return `${p.clubTeam} (club)`;
  return '';
}

/** A contact cell that is a real mailto:/tel: link when there's a value. */
function ContactCell({ value, href }: { value: string | null | undefined; href: 'mailto' | 'tel' }) {
  if (!value) return <span className={styles.cellMuted}>—</span>;
  return (
    <a
      className={styles.contactLink}
      href={`${href}:${value}`}
      title={value}
    >
      {value}
    </a>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const { user, isCoach, isViewer, isLoading } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');

  /* Contact details for the whole client base — coaches only. Guard on
     `isLoading`, never on `user` alone: `user` is undefined while auth is
     still resolving, so testing it directly would bounce a signed-in coach
     to /login on first paint. */
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace('/login'); return; }
    if (!isCoach) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  /* Same one-silent-retry as the Athlete Hub — absorbs a Render cold start,
     then shows an honest error with a Retry rather than an empty table that
     looks like "you have no clients". */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const list = await api.getPlayers();
        setPlayers(list);
        setLoading(false);
        return;
      } catch {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        setLoadError(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isLoading || !user || !isCoach) return;
    void load();
  }, [isLoading, user, isCoach, load]);

  /* Invited athletes who haven't set up yet: in Pending Invites at the
     bottom (same as the Athletes tab), not the directory itself. */
  const pending = useAthletePendingInvites(players, load, !isLoading && !!user && isCoach);
  const isPendingInvite = pending.isPendingInvite;

  const rows = useMemo(() => {
    const sorted = [...players].filter((p) => !isPendingInvite(p)).sort((a, b) =>
      (a.lastName || '').localeCompare(b.lastName || '') ||
      (a.firstName || '').localeCompare(b.firstName || ''),
    );
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    /* Search every column shown, so a coach can find a client by the parent's
       email or the team just as easily as by name. */
    return sorted.filter((p) => [
      p.firstName, p.lastName, teamFor(p),
      p.user?.email, p.user?.phone, p.parentEmail, p.parentPhone,
    ].some((v) => (v || '').toLowerCase().includes(q)));
  }, [players, query, isPendingInvite]);

  if (isLoading || !user) return null;

  return (
    <div className={`${eduStyles.page} ${dashStyles.coachDash}`}>
      <EduHeader
        tone="light"
        chipInline
        icon={<IconAthletes />}
        eyebrow="Client Directory"
        title="Client"
        accent="Contacts"
        actions={
          <Link href="/athletes" className={`btn btn-outline ${theme.field}`} style={{ whiteSpace: 'nowrap' }}>
            ← Athlete Hub
          </Link>
        }
      />

      <div className={`${styles.toolbar} ${theme.bubble} ${theme.pad}`}>
        <input
          className={`${styles.search} ${theme.field}`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, team, email or phone…"
          aria-label="Search clients"
        />
        <span className={styles.count}>
          {loading ? '' : `${rows.length} of ${players.length} client${players.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {loading ? (
        <div className={`${aStyles.empty} ${theme.inner}`}>Loading clients…</div>
      ) : loadError ? (
        <div className={`${aStyles.empty} ${theme.inner}`}>
          Couldn&apos;t load the client list.{' '}
          <button type="button" className={styles.retry} onClick={() => void load()}>Retry</button>
        </div>
      ) : players.length === 0 || rows.length === 0 ? (
        <>
          <div className={`${aStyles.empty} ${theme.inner}`}>
            {players.length === 0 || !query.trim() ? 'No athletes on the roster yet.' : <>No clients match “{query}”.</>}
          </div>
          {pending.rows.length > 0 && (
            <div className={`${aStyles.listWrap} ${theme.inner}`} style={{ marginTop: 12 }}>
              <PendingInvites rows={pending.rows} onChanged={pending.refresh} canManage={!isViewer} />
            </div>
          )}
        </>
      ) : (
        <div className={`${aStyles.listWrap} ${theme.inner}`}>
          <div className={styles.scrollX}>
            <div className={styles.head}>
              <span>Name</span>
              <span>Age</span>
              <span>Team</span>
              <span>Phone</span>
              <span>Email</span>
              <span>Parent Phone</span>
              <span>Parent Email</span>
              <span>Remind</span>
            </div>
            {rows.map((p) => {
              const age = getAgeFromBirthDate(p.birthDate);
              return (
                /* The NAME is the link to the profile, not the whole row: the
                   contact cells are themselves mailto:/tel: anchors, and an
                   anchor cannot legally contain another anchor — nesting them
                   is invalid HTML and trips a hydration error. */
                <div key={p.id} className={styles.row}>
                  <span className={styles.name}>
                    <AthleteAvatar photo={p.profilePhoto} firstName={p.firstName} lastName={p.lastName} className={aStyles.avatar} />
                    <Link href={`/athletes/${p.id}`} className={`${aStyles.playerName} ${styles.nameLink}`}>
                      {p.firstName} {p.lastName}
                    </Link>
                  </span>
                  <span className={styles.cell}>{age ?? <span className={styles.cellMuted}>—</span>}</span>
                  <span className={styles.cell}>
                    {teamFor(p) || <span className={styles.cellMuted}>—</span>}
                  </span>
                  <span className={styles.cell}><ContactCell value={p.user?.phone} href="tel" /></span>
                  <span className={styles.cell}><ContactCell value={p.user?.email} href="mailto" /></span>
                  <span className={styles.cell}><ContactCell value={p.parentPhone} href="tel" /></span>
                  <span className={styles.cell}><ContactCell value={p.parentEmail} href="mailto" /></span>
                  <span className={styles.cell}>
                    <ProfileReminderButton
                      playerId={p.id}
                      playerName={`${p.firstName} ${p.lastName}`.trim()}
                      email={p.user?.email}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          <PendingInvites rows={pending.rows} onChanged={pending.refresh} canManage={!isViewer} />
        </div>
      )}
    </div>
  );
}
