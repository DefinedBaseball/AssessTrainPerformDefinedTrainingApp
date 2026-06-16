'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { DobPicker } from '@/components/DobPicker';
import styles from './page.module.css';

const POSITION_OPTIONS = ['C', 'INF', 'OF', 'P', 'UTIL'];
const BATS_OPTIONS = ['R', 'L', 'S'];
const THROWS_OPTIONS = ['R', 'L'];

export default function NewPlayerPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [bats, setBats] = useState('');
  const [throws_, setThrows] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');
  const [weight, setWeight] = useState('');
  const [highSchool, setHighSchool] = useState('');
  const [clubTeam, setClubTeam] = useState('');
  const [pbrNational, setPbrNational] = useState('');
  const [pbrState, setPbrState] = useState('');
  const [pbrPosition, setPbrPosition] = useState('');
  const [pgScore, setPgScore] = useState('');
  const [collegeCommit, setCollegeCommit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && (!user || !isCoach)) router.replace('/');
  }, [isLoading, user, isCoach, router]);

  const togglePosition = (pos: string) => {
    setPositions(prev =>
      prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required');
      return;
    }
    if (positions.length === 0) {
      setError('Select at least one position');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      // First register the user account
      const regResult = await api.register(email, 'player123', 'PLAYER');
      const userId = regResult.id;

      // Calculate height in inches
      const heightInches = heightFt && heightIn
        ? parseInt(heightFt) * 12 + parseInt(heightIn)
        : undefined;

      // Create the player profile with basic fields
      const player = await api.createPlayer({
        userId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        positions: positions.join(','),
        gradYear: gradYear ? parseInt(gradYear) : undefined,
        heightInches,
        weightLbs: weight ? parseInt(weight) : undefined,
      });

      // Update with all additional fields
      const updates: Record<string, any> = {};
      if (bats) updates.bats = bats;
      if (throws_) updates.throws = throws_;
      if (birthDate) updates.birthDate = birthDate;
      if (highSchool.trim()) updates.highSchool = highSchool.trim();
      if (clubTeam.trim()) updates.clubTeam = clubTeam.trim();
      if (pbrNational) updates.pbrNational = parseInt(pbrNational);
      if (pbrState) updates.pbrState = parseInt(pbrState);
      if (pbrPosition) updates.pbrPosition = parseInt(pbrPosition);
      if (pgScore) updates.pgScore = parseFloat(pgScore);
      if (collegeCommit.trim()) updates.collegeCommit = collegeCommit.trim();

      if (Object.keys(updates).length > 0) {
        await api.updatePlayer(player.id, updates);
      }

      router.push(`/athletes/${player.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create player');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !user) return null;

  return (
    <div>
      <h1 className={styles.title}>Add New Athlete</h1>
      <p className={styles.subtitle}>Create a full player profile</p>

      <form onSubmit={handleSubmit} className={styles.form}>
        {/* ── Section: Identity ── */}
        <div className={styles.sectionLabel}>Player Info</div>

        <div className={styles.row3}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>First Name *</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Last Name *</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Email *</label>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="player@example.com"
              required
            />
          </div>
        </div>

        {/* ── Section: Positions ── */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Positions *</label>
          <div className={styles.chipRow}>
            {POSITION_OPTIONS.map(pos => (
              <button
                key={pos}
                type="button"
                className={`${styles.chip} ${positions.includes(pos) ? styles.chipActive : ''}`}
                onClick={() => togglePosition(pos)}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        {/* ── Section: Physical ── */}
        <div className={styles.sectionLabel}>Physical</div>

        <div className={styles.row4}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Bats</label>
            <div className={styles.chipRow}>
              {BATS_OPTIONS.map(b => (
                <button
                  key={b}
                  type="button"
                  className={`${styles.chipSm} ${bats === b ? styles.chipActive : ''}`}
                  onClick={() => setBats(bats === b ? '' : b)}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Throws</label>
            <div className={styles.chipRow}>
              {THROWS_OPTIONS.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.chipSm} ${throws_ === t ? styles.chipActive : ''}`}
                  onClick={() => setThrows(throws_ === t ? '' : t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Height</label>
            <div className={styles.heightRow}>
              <input type="number" value={heightFt} onChange={e => setHeightFt(e.target.value)} placeholder="ft" min={4} max={7} />
              <span className={styles.heightSep}>'</span>
              <input type="number" value={heightIn} onChange={e => setHeightIn(e.target.value)} placeholder="in" min={0} max={11} />
              <span className={styles.heightSep}>"</span>
            </div>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Weight (lbs)</label>
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="lbs" min={80} max={300} />
          </div>
        </div>

        {/* ── Section: Background ── */}
        <div className={styles.sectionLabel}>Background</div>

        <div className={styles.row4}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Grad Year</label>
            <select value={gradYear} onChange={e => setGradYear(e.target.value)}>
              <option value="">--</option>
              {[2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Birthday</label>
            <DobPicker value={birthDate} onChange={setBirthDate} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>High School</label>
            <input type="text" value={highSchool} onChange={e => setHighSchool(e.target.value)} placeholder="School name" />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Club Team</label>
            <input type="text" value={clubTeam} onChange={e => setClubTeam(e.target.value)} placeholder="Club name" />
          </div>
        </div>

        {/* ── Section: Rankings ── */}
        <div className={styles.sectionLabel}>Rankings & Commitment</div>

        <div className={styles.row5}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>PBR National</label>
            <input type="number" value={pbrNational} onChange={e => setPbrNational(e.target.value)} placeholder="#" min={1} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>PBR State</label>
            <input type="number" value={pbrState} onChange={e => setPbrState(e.target.value)} placeholder="#" min={1} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>PBR Position</label>
            <input type="number" value={pbrPosition} onChange={e => setPbrPosition(e.target.value)} placeholder="#" min={1} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>PG Score</label>
            <input type="number" value={pgScore} onChange={e => setPgScore(e.target.value)} placeholder="0.0" min={0} max={10} step={0.1} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>College Commit</label>
            <input type="text" value={collegeCommit} onChange={e => setCollegeCommit(e.target.value)} placeholder="University" />
          </div>
        </div>

        {/* ── Hint ── */}
        <p className={styles.hint}>
          Default password for new athletes is <strong>player123</strong>. They can log in with their email.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.submitRow}>
          <button type="button" className="btn btn-outline" onClick={() => router.back()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Athlete'}
          </button>
        </div>
      </form>
    </div>
  );
}
