'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { login, user, isLoading } = useAuth();
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

  const handleQuickLogin = async (role: 'COACH' | 'PLAYER') => {
    setLoading(true);
    try {
      const quickEmail = role === 'COACH' ? 'coach@playerdev.com' : 'john@playerdev.com';
      const quickPassword = role === 'COACH' ? 'coach123' : 'player123';
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
          <img src="/logo.png" alt="" width={36} height={36} />
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
            </div>
          </>
        )}

        <p className={styles.signupPrompt}>
          New athlete? <Link href="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
