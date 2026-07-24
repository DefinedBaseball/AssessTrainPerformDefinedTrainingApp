'use client';

/* ─────────────────────────────────────────────────────────────────────
   /inquiry — PUBLIC inquiry form (linked from the Defined Baseball site).

   Field set per coach spec:
     First Name · Last Name · Birthday (calendar) · Position(s) (dropdown)
     Grad Year (dropdown) · High School · Club Team · Other Sports ·
     Injury History · Other Hobbies · GOALS section (Level dropdown:
     High School / College / Professional + long-answer text).
   Contact (Email* + Phone) is kept so the coach can actually reach out —
   the roster's contact columns read from it.

   Submit → public POST /inquiries (rate-limited, honeypot-guarded) →
   lands in the coach Inquiries roster + pings every coach's bell.
   ───────────────────────────────────────────────────────────────────── */

import { useState } from 'react';
import * as api from '@/lib/api';
import { DobPicker } from '@/components/DobPicker';
import rs from '../register/page.module.css';
import styles from './page.module.css';

/* Specific position codes — same set as the profile's position picker. */
const POSITION_OPTIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'UTIL'];
const GRAD_YEARS = Array.from({ length: 10 }, (_, i) => 2026 + i);
const GOAL_LEVELS = ['High School', 'College', 'Professional'];

export default function InquiryPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [gradYear, setGradYear] = useState('');
  const [highSchool, setHighSchool] = useState('');
  const [clubTeam, setClubTeam] = useState('');
  const [otherSports, setOtherSports] = useState('');
  const [injuryHistory, setInjuryHistory] = useState('');
  const [otherHobbies, setOtherHobbies] = useState('');
  const [goalLevel, setGoalLevel] = useState('');
  const [goals, setGoals] = useState('');
  const [honeypot, setHoneypot] = useState(''); // spam trap
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  /* Position(s): a DROPDOWN that appends the chosen position to a chip list
     (so it stays a dropdown per spec but still supports multiple). The select
     always snaps back to the placeholder; chips carry an × to remove. */
  const addPosition = (pos: string) => {
    if (pos && !positions.includes(pos)) setPositions((prev) => [...prev, pos]);
  };
  const removePosition = (pos: string) =>
    setPositions((prev) => prev.filter((p) => p !== pos));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Honeypot: a bot filled the hidden field → pretend success, save nothing.
    if (honeypot.trim()) { setSubmitted(true); return; }
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required');
    if (!email.trim()) return setError('Email is required');

    setError('');
    setSubmitting(true);
    try {
      await api.createInquiry({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        birthDate: birthDate || undefined,
        positions: positions.length ? positions.join(',') : undefined,
        gradYear: gradYear ? parseInt(gradYear) : undefined,
        school: highSchool.trim() || undefined,
        clubTeam: clubTeam.trim() || undefined,
        otherSports: otherSports.trim() || undefined,
        injuryHistory: injuryHistory.trim() || undefined,
        otherHobbies: otherHobbies.trim() || undefined,
        goalLevel: goalLevel || undefined,
        goals: goals.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong submitting your inquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={rs.container}>
      <div className={rs.card}>
        <div className={rs.brandRow}>
          <img src="/logo.png" alt="Defined Baseball Academy" width={34} height={34} />
        </div>

        {submitted ? (
          <div className={styles.confirm}>
            <div className={styles.confirmIcon}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className={styles.confirmTitle}>Inquiry received</h1>
            <p className={styles.confirmText}>
              Thank you for your interest in Defined Baseball Academy, we will reach out to you soon.
            </p>
          </div>
        ) : (
          <>
            <h1 className={rs.title}>Defined Baseball Academy Inquiry</h1>
            <p className={rs.subtitle}>Tell us a bit about the athlete and we&apos;ll be in touch.</p>

            <form onSubmit={handleSubmit} className={rs.form}>
              {/* Honeypot — off-screen; humans never fill it, bots do. */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                className={styles.honeypot}
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
                placeholder="Leave this field empty"
              />

              {/* ── Athlete ── */}
              <div className={rs.sectionLabel}>Athlete</div>
              <div className={rs.row2}>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>First Name *</label>
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>Last Name *</label>
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                </div>
              </div>
              <div className={rs.fieldGroup}>
                <label className={rs.label}>Birthday</label>
                <DobPicker value={birthDate} onChange={setBirthDate} />
              </div>

              {/* ── Contact ── kept so we can actually reach out */}
              <div className={rs.sectionLabel}>Contact</div>
              <div className={rs.row2}>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>Email *</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>Phone</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-5555" />
                </div>
              </div>

              {/* ── Baseball ── */}
              <div className={rs.sectionLabel}>Baseball</div>
              <div className={rs.row2}>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>Position(s)</label>
                  <select
                    value=""
                    onChange={(e) => { addPosition(e.target.value); e.target.value = ''; }}
                  >
                    <option value="">{positions.length ? 'Add another…' : 'Select…'}</option>
                    {POSITION_OPTIONS.filter((p) => !positions.includes(p)).map((pos) => (
                      <option key={pos} value={pos}>{pos}</option>
                    ))}
                  </select>
                  {positions.length > 0 && (
                    <div className={rs.chipRow} style={{ marginTop: 6 }}>
                      {positions.map((pos) => (
                        <button
                          key={pos}
                          type="button"
                          className={`${rs.chipSm} ${rs.chipActive}`}
                          onClick={() => removePosition(pos)}
                          title={`Remove ${pos}`}
                        >
                          {pos} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>Grad Year</label>
                  <select value={gradYear} onChange={(e) => setGradYear(e.target.value)}>
                    <option value="">--</option>
                    {GRAD_YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={rs.row2}>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>High School</label>
                  <input type="text" value={highSchool} onChange={(e) => setHighSchool(e.target.value)} placeholder="School name" />
                </div>
                <div className={rs.fieldGroup}>
                  <label className={rs.label}>Club Team</label>
                  <input type="text" value={clubTeam} onChange={(e) => setClubTeam(e.target.value)} placeholder="Club name" />
                </div>
              </div>

              {/* ── Background ── */}
              <div className={rs.sectionLabel}>Background</div>
              <div className={rs.fieldGroup}>
                <label className={rs.label}>Other Sports</label>
                <input type="text" value={otherSports} onChange={(e) => setOtherSports(e.target.value)} placeholder="e.g. Hockey, Football" />
              </div>
              <div className={rs.fieldGroup}>
                <label className={rs.label}>Injury History</label>
                <input type="text" value={injuryHistory} onChange={(e) => setInjuryHistory(e.target.value)} placeholder="Past or current injuries" />
              </div>
              <div className={rs.fieldGroup}>
                <label className={rs.label}>Other Hobbies</label>
                <input type="text" value={otherHobbies} onChange={(e) => setOtherHobbies(e.target.value)} placeholder="Outside of sports" />
              </div>

              {/* ── Goals ── */}
              <div className={rs.sectionLabel}>Goals</div>
              <div className={rs.fieldGroup}>
                <label className={rs.label}>Level</label>
                <select value={goalLevel} onChange={(e) => setGoalLevel(e.target.value)}>
                  <option value="">--</option>
                  {GOAL_LEVELS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className={rs.fieldGroup}>
                <label className={rs.label}>Tell us about your goals</label>
                <textarea
                  className={styles.textarea}
                  value={goals}
                  onChange={(e) => setGoals(e.target.value)}
                  placeholder="What do you want to accomplish as a player?"
                />
              </div>

              {error && <div className={rs.error}>{error}</div>}

              <button type="submit" className={rs.submit} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Inquiry'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
