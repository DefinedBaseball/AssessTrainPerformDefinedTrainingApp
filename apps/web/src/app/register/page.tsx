'use client';

/* ─────────────────────────────────────────────────────────────────────
   /register — public player self-registration.

   An athlete fills out their full Player Profile (the same fields a coach
   uses in Add Athlete) plus email + password. On submit we create a single
   PENDING account via /auth/signup, sign them in, and route to `/`, where
   the holding screen shows "Waiting for coach approval" until a coach
   accepts them from their notifications. Coaches are NOT created here —
   this page only makes player accounts.
   ───────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { DobPicker } from '@/components/DobPicker';
import styles from './page.module.css';

const POSITION_OPTIONS = ['C', 'INF', 'OF', 'P', 'UTIL'];
const BATS_OPTIONS = ['R', 'L', 'S'];
const THROWS_OPTIONS = ['R', 'L'];

export default function RegisterPage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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

  // Already signed in → no need to register.
  useEffect(() => {
    if (!isLoading && user) router.replace('/');
  }, [isLoading, user, router]);

  const togglePosition = (pos: string) => {
    setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required');
    if (positions.length === 0) return setError('Select at least one position');
    if (!email.trim()) return setError('Email is required');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');

    setError('');
    setSubmitting(true);
    try {
      const heightInches =
        heightFt && heightIn ? parseInt(heightFt) * 12 + parseInt(heightIn) : undefined;

      await api.signupPlayer({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        positions: positions.join(','),
        heightInches,
        weightLbs: weight ? parseInt(weight) : undefined,
        gradYear: gradYear ? parseInt(gradYear) : undefined,
        bats: bats || undefined,
        throws: throws_ || undefined,
        birthDate: birthDate || undefined,
        highSchool: highSchool.trim() || undefined,
        clubTeam: clubTeam.trim() || undefined,
        collegeCommit: collegeCommit.trim() || undefined,
        pbrNational: pbrNational ? parseInt(pbrNational) : undefined,
        pbrState: pbrState ? parseInt(pbrState) : undefined,
        pbrPosition: pbrPosition ? parseInt(pbrPosition) : undefined,
        pgScore: pgScore ? parseFloat(pgScore) : undefined,
      });

      // Establish the session (pending login is allowed) → holding screen.
      await login(email.trim(), password);
      router.push('/');
    } catch (err: any) {
      setError(err?.message || 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLoading && user) return null;

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <img src="/logo.png" alt="" width={34} height={34} />
        </div>
        <h1 className={styles.title}>Create your athlete account</h1>
        <p className={styles.subtitle}>
          Fill out your player profile below. A coach will review and approve your access.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* ── Identity ── */}
          <div className={styles.sectionLabel}>Player Info</div>
          <div className={styles.row3}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>First Name *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Last Name *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Email *</label>
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
          </div>

          {/* ── Credentials ── */}
          <div className={styles.row2}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Password *</label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Confirm Password *</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                required
              />
            </div>
          </div>

          {/* ── Positions ── */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Positions *</label>
            <div className={styles.chipRow}>
              {POSITION_OPTIONS.map((pos) => (
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

          {/* ── Physical ── */}
          <div className={styles.sectionLabel}>Physical</div>
          <div className={styles.row4}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Bats</label>
              <div className={styles.chipRow}>
                {BATS_OPTIONS.map((b) => (
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
                {THROWS_OPTIONS.map((t) => (
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
                <input type="number" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} placeholder="ft" min={4} max={7} />
                <span className={styles.heightSep}>&apos;</span>
                <input type="number" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} placeholder="in" min={0} max={11} />
                <span className={styles.heightSep}>&quot;</span>
              </div>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Weight (lbs)</label>
              <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="lbs" min={80} max={300} />
            </div>
          </div>

          {/* ── Background ── */}
          <div className={styles.sectionLabel}>Background</div>
          <div className={styles.row4}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Grad Year</label>
              <select value={gradYear} onChange={(e) => setGradYear(e.target.value)}>
                <option value="">--</option>
                {[2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
                <option value={api.GRAD_COLLEGE}>College</option>
                <option value={api.GRAD_PRO}>Professional</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Birthday</label>
              <DobPicker value={birthDate} onChange={setBirthDate} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>High School</label>
              <input type="text" value={highSchool} onChange={(e) => setHighSchool(e.target.value)} placeholder="School name" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Club Team</label>
              <input type="text" value={clubTeam} onChange={(e) => setClubTeam(e.target.value)} placeholder="Club name" />
            </div>
          </div>

          {/* ── Rankings ── */}
          <div className={styles.sectionLabel}>Rankings &amp; Commitment</div>
          <div className={styles.row5}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>PBR National</label>
              <input type="number" value={pbrNational} onChange={(e) => setPbrNational(e.target.value)} placeholder="#" min={1} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>PBR State</label>
              <input type="number" value={pbrState} onChange={(e) => setPbrState(e.target.value)} placeholder="#" min={1} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>PBR Position</label>
              <input type="number" value={pbrPosition} onChange={(e) => setPbrPosition(e.target.value)} placeholder="#" min={1} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>PG Score</label>
              <input type="number" value={pgScore} onChange={(e) => setPgScore(e.target.value)} placeholder="0.0" min={0} max={10} step={0.1} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>College Commit</label>
              <input type="text" value={collegeCommit} onChange={(e) => setCollegeCommit(e.target.value)} placeholder="University" />
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>

          <p className={styles.footerLink}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
