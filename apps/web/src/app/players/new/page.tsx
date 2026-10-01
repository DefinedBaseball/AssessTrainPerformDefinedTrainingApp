'use client';

/* ─────────────────────────────────────────────────────────────────────
   /players/new — the "Manual" half of + Add Athlete.

   Mirrors the public Create an Account form (/register) field for field and
   row for row, which in turn mirrors Edit Profile. A coach typing a profile
   here and an athlete filling it in themselves produce the same record, so
   nothing has to be re-keyed afterwards.

   Two deliberate differences from /register, both because the person at the
   keyboard is a COACH, not the athlete:

     • Athlete Type is present. It is coach-input only — it drives the Hub
       filter and program post audiences — so it is absent from the public
       form and belongs here, in the position Edit Profile puts it.

     • Password is required, as on /register. There is no fallback: a
       blank field used to create the account with the shared default
       "player123", which anyone who knew the athlete's email could sign
       in with. A blank submit now stops with "Create Password to Continue" and focuses the
       field. The API refuses a blank password too (auth.service
       register), so this is not only a client-side rule.
   ───────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import * as api from '@/lib/api';
import { DobPicker } from '@/components/DobPicker';
import { ATHLETE_TYPES } from '@/lib/athlete-types';
import { normalizePositionsForSave } from '../../athletes/[id]/helpers';
import styles from './page.module.css';

/* Errors that are about the password, shown under the Password field too.
   Exact strings from the submit handler (and the API, which uses the same
   wording), so a server-side rejection lands in the same place. */
const PASSWORD_ERRORS = new Set([
  'Create Password to Continue',
  'Password must be at least 6 characters',
  'Passwords do not match',
]);

/* The SPECIFIC position codes, matching Edit Profile and /register. The old
   umbrella set (INF / OF / UTIL) this form used to write is what made
   athletes print as "INF · OF" on the PDF cover regardless of what was
   actually picked; normalizePositionsForSave cleans those on the way out. */
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

export default function NewPlayerPage() {
  const router = useRouter();
  const { user, isCoach, isLoading } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  /* The password row sits mid-form; on a blank submit we move the coach
     to it rather than leave them hunting for what's missing. */
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
  const [athleteTypes, setAthleteTypes] = useState<string[]>([]);
  const [playingLevelGoal, setPlayingLevelGoal] = useState('');
  const [goals, setGoals] = useState('');
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
  const toggleAthleteType = (key: string) => {
    setAthleteTypes(prev =>
      prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]
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
    if (!password.trim()) {
      setError('Create Password to Continue');
      passwordRef.current?.focus();
      return;
    }
    if (password.trim().length < 6) {
      setError('Password must be at least 6 characters');
      passwordRef.current?.focus();
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      // First register the user account
      const regResult = await api.register(email, password.trim(), 'PLAYER');
      const userId = regResult.id;

      // Create the player profile with basic fields
      const player = await api.createPlayer({
        userId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        /* Same normalization /register and Edit Profile apply. */
        positions: normalizePositionsForSave(positions).join(','),
        gradYear: gradYear ? parseInt(gradYear) : undefined,
        heightInches: heightToInches(height),
        weightLbs: weight ? parseInt(weight) : undefined,
      });

      // Update with all additional fields
      const updates: Record<string, any> = {};
      if (bats) updates.bats = bats;
      if (throws_) updates.throws = throws_;
      if (birthDate) updates.birthDate = birthDate;
      if (parentEmail.trim()) updates.parentEmail = parentEmail.trim();
      if (parentPhone.trim()) updates.parentPhone = parentPhone.trim();
      if (highSchool.trim()) updates.highSchool = highSchool.trim();
      if (clubTeam.trim()) updates.clubTeam = clubTeam.trim();
      if (college.trim()) updates.college = college.trim();
      if (professionalTeam.trim()) updates.professionalTeam = professionalTeam.trim();
      if (playingLevelGoal) updates.playingLevelGoal = playingLevelGoal;
      if (goals.trim()) updates.goals = goals.trim();
      if (pbrNational) updates.pbrNational = parseInt(pbrNational);
      if (pbrState) updates.pbrState = parseInt(pbrState);
      if (pbrPosition) updates.pbrPosition = parseInt(pbrPosition);
      if (pgScore) updates.pgScore = parseFloat(pgScore);
      if (collegeCommit.trim()) updates.collegeCommit = collegeCommit.trim();
      if (athleteTypes.length > 0) updates.athleteTypes = athleteTypes.join(',');

      if (Object.keys(updates).length > 0) {
        await api.updatePlayer(player.id, updates);
      }

      /* Phone lives on the User row, not Player, so it cannot ride along with
         updatePlayer. Non-fatal: a failure here must not strand a profile
         that has already been created. */
      if (phone.trim()) {
        try {
          await api.setUserPhone(userId, phone.trim());
        } catch (err) {
          console.error('Failed to save phone:', err);
        }
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
        <div className={styles.sectionLabel}>Player Information</div>

        {/* Row 1 */}
        <div className={styles.row4}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>First Name *</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Last Name *</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Birthday</label>
            <DobPicker value={birthDate} onChange={setBirthDate} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Grad Year</label>
            <select value={gradYear} onChange={e => setGradYear(e.target.value)}>
              <option value="">--</option>
              {[2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032].map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
              <option value={api.GRAD_COLLEGE}>College</option>
              <option value={api.GRAD_PRO}>Professional</option>
            </select>
          </div>
        </div>

        {/* Row 2 — credentials, same slot /register uses */}
        <div className={styles.row3}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Email *</label>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="athlete@example.com"
              required
            />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Password *</label>
            <input
              ref={passwordRef}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
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
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
            />
          </div>
        </div>

        {/* Row 3 */}
        <div className={styles.row3}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(407) 555-0100" />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Parent Email</label>
            <input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} placeholder="parent@example.com" />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Parent Phone</label>
            <input type="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="(407) 555-0100" />
          </div>
        </div>

        {/* Positions */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Position(s) *</label>
          <div className={styles.chipRow}>
            {POSITIONS.map(pos => (
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
            <select value={bats} onChange={e => setBats(e.target.value)}>
              <option value="">Select...</option>
              <option value="R">R</option>
              <option value="L">L</option>
              <option value="S">S</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Throws</label>
            <select value={throws_} onChange={e => setThrows(e.target.value)}>
              <option value="">Select...</option>
              <option value="R">R</option>
              <option value="L">L</option>
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Height</label>
            <select value={height} onChange={e => setHeight(e.target.value)}>
              <option value="">Select...</option>
              {HEIGHT_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Weight (lbs)</label>
            <input type="number" value={weight} onChange={e => setWeight(e.target.value)} placeholder="lbs" min={80} max={300} />
          </div>
        </div>

        {/* Row 6 */}
        <div className={styles.row4}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>High School</label>
            <input type="text" value={highSchool} onChange={e => setHighSchool(e.target.value)} placeholder="High school name" />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Club Team</label>
            <input type="text" value={clubTeam} onChange={e => setClubTeam(e.target.value)} placeholder="Club name" />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>College</label>
            <input type="text" value={college} onChange={e => setCollege(e.target.value)} placeholder="Current college" />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Professional Team</label>
            <input type="text" value={professionalTeam} onChange={e => setProfessionalTeam(e.target.value)} placeholder="Pro club" />
          </div>
        </div>

        {/* Coach-only, so it is here and NOT on the public /register form. */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Athlete Type</label>
          <div className={styles.chipRow}>
            {ATHLETE_TYPES.map(t => (
              <button
                key={t.key}
                type="button"
                className={`${styles.chip} ${athleteTypes.includes(t.key) ? styles.chipActive : ''}`}
                onClick={() => toggleAthleteType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.sectionLabel}>Goals &amp; Aspirations</div>
        <div className={styles.row}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Playing Level Goal</label>
            <select value={playingLevelGoal} onChange={e => setPlayingLevelGoal(e.target.value)}>
              <option value="">Select...</option>
              {PLAYING_LEVELS.map(lv => <option key={lv} value={lv}>{lv}</option>)}
            </select>
          </div>
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Goals</label>
          <textarea
            value={goals}
            onChange={e => setGoals(e.target.value)}
            placeholder="Personal goals…"
            rows={4}
            style={{ resize: 'vertical', minHeight: 80 }}
          />
        </div>

        <div className={styles.sectionLabel}>Rankings &amp; Scores</div>
        <div className={styles.row4}>
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
            <input type="number" value={pbrPosition} onChange={e => setPbrPosition(e.target.value)} placeholder="Position ranking" min={1} />
          </div>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>PG Score</label>
            <input type="number" value={pgScore} onChange={e => setPgScore(e.target.value)} placeholder="0.0" min={0} max={10} step={0.1} />
          </div>
        </div>

        <div className={styles.sectionLabel}>College Commitment</div>
        <div className={styles.row}>
          <div className={styles.fieldGroup}>
            <label className={styles.label}>Committed To</label>
            <input type="text" value={collegeCommit} onChange={e => setCollegeCommit(e.target.value)} placeholder="University" />
          </div>
        </div>

        <p className={styles.hint}>
          Athletes log in with their email and the password set here.
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
