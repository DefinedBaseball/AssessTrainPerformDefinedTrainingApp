'use client';

/* ─────────────────────────────────────────────────────────────────────
   /register/parent -- a parent creates their own account. It's active
   straight away (on its own it only sees the parent's own profile); their
   athletes are added from the profile's Link Athlete button, which finds
   profiles listing this email as Parent Email and asks an admin to allow
   each link. Open even while new-athlete sign-up is switched off.
   ───────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useAcademy, AcademyContactLine } from '@/lib/academy';
import * as api from '@/lib/api';
import styles from '../page.module.css';
import { AccountTypeToggle } from '../AccountTypeToggle';
import { PARENT_SELF_SIGNUP } from '@/lib/features';

export default function ParentRegisterPage() {
  const router = useRouter();
  const { user, isLoading, login } = useAuth();
  const { appLogoUrl } = useAcademy();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /* ?invite= from a coach's Add Parent email: pre-fills the email + name,
     and signing up with that email links the athletes the coach picked. */
  const [inviteCode, setInviteCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  /* Read the URL once on mount; until then we can't tell an invite visit
     from a public one (matters while public parent sign-up is off). */
  const [inviteChecked, setInviteChecked] = useState(false);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('invite') || '';
    setInviteChecked(true);
    if (!code) return;
    setInviteCode(code);
    api.getParentInvite(code)
      .then((inv) => {
        setInviteEmail(inv.email);
        setEmail(inv.email);
        const [first, ...rest] = (inv.name || '').trim().split(/\s+/);
        if (first) setFirstName(first);
        if (rest.length) setLastName(rest.join(' '));
      })
      .catch((e: any) => setInviteError(e?.message || 'This invite link has expired.'));
  }, []);

  // Already signed in -> nothing to create.
  useEffect(() => {
    if (!isLoading && user) router.replace('/');
  }, [isLoading, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return setError('First and last name are required');
    if (!email.trim()) return setError('Email is required');
    if (!password.trim()) return setError('Create Password to Continue');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError('Passwords do not match');

    setError('');
    setSubmitting(true);
    try {
      await api.signupParent({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        password,
        inviteCode: inviteCode || undefined,
      });
      await login(email.trim(), password);
      router.push('/parent');
    } catch (err: any) {
      setError(err?.message || 'Could not create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLoading && user) return null;

  /* Public parent sign-up is off (live, for now): only a coach's invite
     link opens this form. The API enforces the same rule. */
  if (!PARENT_SELF_SIGNUP && !inviteChecked) return null;
  if (!PARENT_SELF_SIGNUP && !inviteCode) {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.brandRow}>
            <img src={appLogoUrl} alt="" width={34} height={34} />
          </div>
          <h1 className={styles.title}>Parent accounts are by invitation</h1>
          <p className={styles.subtitle}>
            Ask your athlete’s coach to send you an invite. The link in that email sets up your account.
          </p>
          <p className={styles.footerLink}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
          <AcademyContactLine />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.brandRow}>
          <img src={appLogoUrl} alt="" width={34} height={34} />
        </div>
        <AccountTypeToggle active="parent" />
        <h1 className={styles.title}>Create your parent account</h1>
        <p className={styles.subtitle}>
          {inviteEmail
            ? 'Your coach invited you. Sign up with this email and your athlete is linked to your account straight away.'
            : 'After you sign in, use Link Athlete to find your athlete. A coach approves each link.'}
        </p>
        {inviteError && <div className={styles.error} style={{ marginBottom: 14 }}>{inviteError} You can still create an account below.</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.sectionLabel}>Parent Information</div>
          <div className={styles.row2}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>First Name *</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Last Name *</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
            </div>
          </div>
          <div className={styles.row2}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="parent@example.com" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Phone Number</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="(407) 555-0100" />
            </div>
          </div>
          <p className={styles.fieldHint}>
            Use the email that’s listed as Parent Email on your athlete’s profile — that’s how Link Athlete finds them.
          </p>
          <div className={styles.row2}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Password *</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" placeholder="At least 8 characters" />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Confirm Password *</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>

          <p className={styles.footerLink}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
          <AcademyContactLine />
        </form>
      </div>
    </div>
  );
}
