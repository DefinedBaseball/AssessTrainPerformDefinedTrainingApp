'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useAcademy } from '@/lib/academy';
import { PARENT_SELF_SIGNUP } from '@/lib/features';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { login, user, isLoading } = useAuth();
  const { academy, appLogoUrl } = useAcademy();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If the user is already signed in, bounce them to home rather than
  // re-prompt for credentials. Stops the "Sign In" button from looking like
  // a logged-out CTA when the session is actually active.
  useEffect(() => {
    if (!isLoading && user) router.replace('/');
  }, [isLoading, user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  /* Demo quick-login is a DEV-ONLY convenience. In a production build it
     would be an open door to full coach access for anyone who finds the
     login page, so it's gated off unless we're in development OR an
     explicit opt-in flag is set. `process.env.NODE_ENV` is inlined by
     Next at build time, so this whole block tree-shakes out of prod. */
  const showDemoLogin =
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_ENABLE_DEMO_LOGIN === 'true';

  const handleQuickLogin = async (role: 'COACH' | 'PLAYER' | 'PARENT') => {
    setLoading(true);
    try {
      // Dev-only convenience (tree-shaken out of production builds). Coach
      // points at the primary admin so the quick-login matches the real roster;
      // Parent is the seeded demo parent (Sarah Smith), linked to John Smith.
      const quickEmail = role === 'COACH'
        ? 'connor@definedbaseball.com'
        : role === 'PARENT' ? 'parent@playerdev.com' : 'john@playerdev.com';
      const quickPassword = role === 'COACH' ? 'PasswordCoach' : 'player123';
      await login(quickEmail, quickPassword);
      router.push('/');
    } catch {
      setError('Quick login failed — make sure the API is running and seeded.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logoIcon}>
          <img src={appLogoUrl} alt="" width={36} height={36} />
        </div>
        <h1 className={styles.title}>Assess, Train, Perform</h1>
        <p className={styles.subtitle}>Sign in to your account</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link href="/forgot-password" style={{ fontSize: 13, color: 'var(--text-muted)', textDecoration: 'none' }}>
            Forgot password?
          </Link>
        </div>

        {showDemoLogin && (
          <>
            <div className={styles.divider}>
              <span>or quick login</span>
            </div>

            <div className={styles.quickRow}>
              <button className="btn btn-outline" onClick={() => handleQuickLogin('COACH')} disabled={loading}>
                Coach Demo
              </button>
              <button className="btn btn-outline" onClick={() => handleQuickLogin('PLAYER')} disabled={loading}>
                Player Demo
              </button>
              <button className="btn btn-outline" onClick={() => handleQuickLogin('PARENT')} disabled={loading}>
                Parent Demo
              </button>
            </div>
          </>
        )}

        {/* With parent sign-up open, always shown: /register asks Athlete or
            Parent, and parents can sign up any time. Without it (live, for
            now) it is the athlete link, hidden while new athletes are
            switched off (Settings → Academy). */}
        {PARENT_SELF_SIGNUP ? (
          <p className={styles.signupPrompt}>
            New here? <Link href="/register">Create an account</Link>
          </p>
        ) : academy.acceptingAthletes && (
          <p className={styles.signupPrompt}>
            New athlete? <Link href="/register">Create an account</Link>
          </p>
        )}
      </div>
    </div>
  );
}
