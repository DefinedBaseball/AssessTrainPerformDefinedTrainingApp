'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as api from '@/lib/api';
import styles from '../login/page.module.css';

/**
 * "Reset password" — lands here from the emailed link (`?token=…`). Reads the
 * token from the URL on the client (avoids the Suspense boundary that
 * useSearchParams would require at prerender), collects a new password, and
 * submits it with the token. On success the user is sent back to sign in.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    setReady(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (!token) { setError('This reset link is invalid or has expired.'); return; }
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Could not reset your password.');
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
        <h1 className={styles.title}>Reset password</h1>

        {done ? (
          <>
            <p className={styles.subtitle}>
              Your password has been reset. You can now sign in with your new password.
            </p>
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => router.push('/login')}
            >
              Go to sign in
            </button>
          </>
        ) : !ready ? (
          <p className={styles.subtitle}>Loading…</p>
        ) : !token ? (
          <>
            <p className={styles.subtitle}>
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <p className={styles.signupPrompt} style={{ marginTop: 18 }}>
              <Link href="/forgot-password">Request a new link</Link>
            </p>
          </>
        ) : (
          <>
            <p className={styles.subtitle}>Choose a new password for your account.</p>
            <form onSubmit={handleSubmit} className={styles.form}>
              <input
                type="password"
                placeholder="New password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
              {error && <div className={styles.error}>{error}</div>}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !password || !confirm}
                style={{ width: '100%' }}
              >
                {loading ? 'Resetting...' : 'Reset password'}
              </button>
            </form>
            <p className={styles.signupPrompt}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
