'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import styles from '../login/page.module.css';

/**
 * "Forgot password" — collects an email and asks the API to send a reset link.
 * Always shows the same neutral confirmation whether or not the email maps to
 * an account (the backend never reveals it), so this page can't be used to
 * probe which emails are registered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.requestPasswordReset(email);
    } catch {
      // The endpoint returns ok even for unknown emails; swallow network
      // hiccups too so the neutral confirmation always shows.
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logoIcon}>
          <img src="/logo.png" alt="" width={36} height={36} />
        </div>
        <h1 className={styles.title}>Forgot password</h1>

        {sent ? (
          <>
            <p className={styles.subtitle}>
              If an account exists for that email, we&apos;ve sent a reset link. Check your
              inbox (and spam) — it&apos;s good for 1 hour.
            </p>
            <p className={styles.signupPrompt} style={{ marginTop: 18 }}>
              <Link href="/login">Back to sign in</Link>
            </p>
          </>
        ) : (
          <>
            <p className={styles.subtitle}>Enter your account email and we&apos;ll send a reset link.</p>
            <form onSubmit={handleSubmit} className={styles.form}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !email}
                style={{ width: '100%' }}
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
            <p className={styles.signupPrompt}>
              Remembered it? <Link href="/login">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
