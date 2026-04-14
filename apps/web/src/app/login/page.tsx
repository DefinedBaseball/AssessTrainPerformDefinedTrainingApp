'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      </div>
    </div>
  );
}
