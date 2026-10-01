'use client';

/* ─────────────────────────────────────────────────────────────────────
   /register — public player self-registration.

   The form deliberately MIRRORS the Edit Profile form (ReportModal's
   SummaryForm): same fields, same order, same controls. An athlete who
   fills this in has entered everything a coach would otherwise have to
   type for them, so there is nothing left to re-key on approval.

   Three deliberate differences, none of them cosmetic:

     • Row 2 is Email + Password + Confirm. Edit Profile shows the login
       address with Change Email / Reset Password beside it, which is
       meaningless before the account exists.

     • Athlete Type is absent. It is coach-input only (it drives the Hub
       filter and program post audiences), so a public form must not be
       able to set it — the same rule the save payload in SummaryForm
       enforces.

     • One-Off Logo is absent. It is a coach-supplied asset for the PDF
       cover, not something an athlete provides about themselves.

   On submit we create a single PENDING account via /auth/signup, sign
   them in, and route to `/`, where the holding screen shows "Waiting for
   coach approval" until a coach accepts them from their notifications.
   Coaches are NOT created here — this page only makes player accounts.
   ───────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { DobPicker } from '@/components/DobPicker';
import { normalizePositionsForSave } from '../athletes/[id]/helpers';
import styles from './page.module.css';

/* Errors that are about the password, shown under the Password field too.
   Exact strings from the submit handler (and the API, which uses the same
   wording), so a server-side rejection lands in the same place. */
const PASSWORD_ERRORS = new Set([
  'Create Password to Continue',
  'Password must be at least 6 characters',
  'Passwords do not match',
]);

/* The SPECIFIC position codes, matching Edit Profile. The old umbrella set
   (INF / OF / UTIL) is what made players print as "INF · OF" on the PDF
   cover; `normalizePositionsForSave` cleans those up on the way out. */
const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'Utility'];
const PLAYING_LEVELS = ['High School', 'College', 'D3', 'D2', 'D1', 'Professional'];

function buildHeightOptions(): string[] {
  const opts: string[] = [];
  for (let ft = 4; ft <= 7; ft++) {
    for (let inc = 0; inc < 12; inc++) {
      if (ft === 7 && inc > 0) break;
      opts.push(`${ft}'${inc}"`);
    }
  }
  return opts;
}
const HEIGHT_OPTIONS = buildHeightOptions();

function heightToInches(h: string): number | undefined {
  const m = h.match(/^(\d+)'(\d+)"$/);
  if (!m) return undefined;
  return parseInt(m[1]) * 12 + parseInt(m[2]);
}

export default function RegisterPage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [bats, setBats] = useState('');
  const [throws_, setThrows] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [highSchool, setHighSchool] = useState('');
  const [clubTeam, setClubTeam] = useState('');
  const [college, setCollege] = useState('');
  const [professionalTeam, setProfessionalTeam] = useState('');
  const [playingLevelGoal, setPlayingLevelGoal] = useState('');
  const [goals, setGoals] = useState('');
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
    if (!password.trim()) {
      passwordRef.current?.focus();
      return setError('Create Password to Continue');
    }
    if (password.length < 6) {
      passwordRef.current?.focus();
      return setError('Password must be at least 6 characters');
    }
    if (password !== confirm) return setError('Passwords do not match');

    setError('');
    setSubmitting(true);
    try {
      await api.signupPlayer({
        email: email.trim(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        /* Same normalization Edit Profile applies, so a self-registered
           athlete's positions print identically to a coach-entered one. */
        positions: normalizePositionsForSave(positions).join(','),
        heightInches: heightToInches(height),
        weightLbs: weight ? parseInt(weight) : undefined,
        gradYear: gradYear ? parseInt(gradYear) : undefined,
        bats: bats || undefined,
        throws: throws_ || undefined,
        birthDate: birthDate || undefined,
        phone: phone.trim() || undefined,
        parentEmail: parentEmail.trim() || undefined,
        parentPhone: parentPhone.trim() || undefined,
        highSchool: highSchool.trim() || undefined,
        clubTeam: clubTeam.trim() || undefined,
        college: college.trim() || undefined,
        professionalTeam: professionalTeam.trim() || undefined,
        playingLevelGoal: playingLevelGoal || undefined,
        goals: goals.trim() || undefined,
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
          <div className={styles.sectionLabel}>Player Information</div>

          {/* Row 1 — matches Edit Profile */}
          <div className={styles.row4}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>First Name *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Last Name *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Birthday</label>
              <DobPicker value={birthDate} onChange={setBirthDate} />
            </div>
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
          </div>

          {/* Row 2 — where Edit Profile shows the login address plus Change
              Email / Reset Password, this sets the credentials instead. */}
          <div className={styles.row3}>
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
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Password *</label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                ref={passwordRef}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
              />
              {PASSWORD_ERRORS.has(error) && (
                <div className={styles.error} role="alert" style={{ marginTop: 6 }}>{error}</div>
              )}
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Confirm Password *</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
              />
            </div>
          </div>

          {/* Row 3 */}
          <div className={styles.row3}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(407) 555-0100" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Parent Email</label>
              <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="parent@example.com" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Parent Phone</label>
              <input type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="(407) 555-0100" />
            </div>
          </div>

          {/* Positions */}
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Position(s) *</label>
            <div className={styles.chipRow}>
              {POSITIONS.map((pos) => (
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

          {/* Row 5 */}
          <div className={styles.row4}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Bats</label>
              <select value={bats} onChange={(e) => setBats(e.target.value)}>
                <option value="">Select...</option>
                <option value="R">R</option>
                <option value="L">L</option>
                <option value="S">S</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Throws</label>
              <select value={throws_} onChange={(e) => setThrows(e.target.value)}>
                <option value="">Select...</option>
                <option value="R">R</option>
                <option value="L">L</option>
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Height</label>
              <select value={height} onChange={(e) => setHeight(e.target.value)}>
                <option value="">Select...</option>
                {HEIGHT_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Weight (lbs)</label>
              <input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="lbs" min={80} max={300} />
            </div>
          </div>

          {/* Row 6 */}
          <div className={styles.row4}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>High School</label>
              <input type="text" value={highSchool} onChange={(e) => setHighSchool(e.target.value)} placeholder="High school name" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Club Team</label>
              <input type="text" value={clubTeam} onChange={(e) => setClubTeam(e.target.value)} placeholder="Club name" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>College</label>
              <input type="text" value={college} onChange={(e) => setCollege(e.target.value)} placeholder="Current college" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Professional Team</label>
              <input type="text" value={professionalTeam} onChange={(e) => setProfessionalTeam(e.target.value)} placeholder="Pro club" />
            </div>
          </div>

          {/* Athlete Type sits here in Edit Profile. Omitted on purpose —
              it is coach-input only. */}

          <div className={styles.sectionLabel}>Goals &amp; Aspirations</div>
          <div className={styles.row2}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Playing Level Goal</label>
              <select value={playingLevelGoal} onChange={(e) => setPlayingLevelGoal(e.target.value)}>
                <option value="">Select...</option>
                {PLAYING_LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Goals</label>
            <textarea
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              placeholder="Your personal goals…"
              rows={4}
              style={{ resize: 'vertical', minHeight: 80 }}
            />
          </div>

          <div className={styles.sectionLabel}>Rankings &amp; Scores</div>
          <div className={styles.row4}>
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
              <input type="number" value={pbrPosition} onChange={(e) => setPbrPosition(e.target.value)} placeholder="Position ranking" min={1} />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>PG Score</label>
              <input type="number" value={pgScore} onChange={(e) => setPgScore(e.target.value)} placeholder="0.0" min={0} max={10} step={0.1} />
            </div>
          </div>

          <div className={styles.sectionLabel}>College Commitment</div>
          <div className={styles.row2}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Committed To</label>
              <input type="text" value={collegeCommit} onChange={(e) => setCollegeCommit(e.target.value)} placeholder="University" />
            </div>
          </div>
          {/* One-Off Logo sits beside Committed To in Edit Profile. Omitted
              on purpose — it is a coach-supplied PDF cover asset. */}

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
