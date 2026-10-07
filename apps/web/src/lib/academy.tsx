'use client';

/* Academy branding + settings every page can read (Settings → Academy):
   name, logo, contact info, the new-athlete switch and the time zone.

   Public data -- the sign-in, sign-up and inquiry pages need it with no
   account. Cached in localStorage so the name/logo/time zone are right on
   the first paint, then refreshed from the server. */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import * as api from '@/lib/api';

const CACHE_KEY = 'academy_public';

export const DEFAULT_ACADEMY: api.PublicAcademy = {
  name: 'Defined Baseball Academy',
  contact: { phone: '', email: '', address: '', website: '', instagram: '', x: '' },
  acceptingAthletes: true,
  closedMessage: "We aren't taking new athletes right now. Please check back soon.",
  timeZone: '',
  logos: { app: null, email: null },
};

function readCache(): api.PublicAcademy | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? { ...DEFAULT_ACADEMY, ...parsed } : null;
  } catch {
    return null;
  }
}

/* ── Time zone ──────────────────────────────────────────────────────────
   Timestamps (messages, alerts, reports, videos, posts, inquiries, live
   sessions) show in the academy's zone, so a remote athlete sees the same
   4:30 PM the coach does. Date-only values (calendar days, birthdays) are
   NOT zoned -- they're plain days, and shifting them would move them.

   Module-level so plain formatting helpers can read it without a hook. Read
   from the cache at load, so the first render already uses it. */
let currentTimeZone = readCache()?.timeZone || '';

/** Spread into toLocale*String options: `{ ...tzOpt(), month: 'short' }`.
 *  Empty when no zone is set (each device's own time). */
export function tzOpt(): { timeZone?: string } {
  return currentTimeZone ? { timeZone: currentTimeZone } : {};
}

/** "YYYY-MM-DD" of a moment in the academy's zone -- for same-day checks. */
export function tzDayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { ...tzOpt(), year: 'numeric', month: '2-digit', day: '2-digit' });
}

/* ── Context ─────────────────────────────────────────────────────────── */

interface AcademyContextValue {
  academy: api.PublicAcademy;
  /** The in-app logo (white mark for dark plates). */
  appLogoUrl: string;
  refresh: () => Promise<void>;
}

const AcademyContext = createContext<AcademyContextValue>({
  academy: DEFAULT_ACADEMY,
  appLogoUrl: '/logo.png',
  refresh: async () => {},
});

export function AcademyProvider({ children }: { children: React.ReactNode }) {
  const [academy, setAcademyState] = useState<api.PublicAcademy>(DEFAULT_ACADEMY);
  const pathname = usePathname();

  const setAcademy = useCallback((a: api.PublicAcademy) => {
    currentTimeZone = a.timeZone || '';
    setAcademyState(a);
    try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(a)); } catch { /* storage off */ }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setAcademy(await api.getPublicAcademy());
    } catch { /* keep what we have */ }
  }, [setAcademy]);

  useEffect(() => {
    const cached = readCache();
    if (cached) setAcademyState(cached);
    void refresh();
  }, [refresh]);

  /* Browser tab title = the academy name. Next re-writes <title> from the
     static metadata after navigations, so watch <head> and put it back. */
  useEffect(() => {
    const apply = () => {
      if (document.title !== academy.name) document.title = academy.name;
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [academy.name, pathname]);

  const value = useMemo<AcademyContextValue>(() => ({
    academy,
    appLogoUrl: academy.logos.app ? `/api/academy/logo/app?v=${academy.logos.app}` : '/logo.png',
    refresh,
  }), [academy, refresh]);

  return <AcademyContext.Provider value={value}>{children}</AcademyContext.Provider>;
}

export function useAcademy() {
  return useContext(AcademyContext);
}

/** Social handle or URL → link (http/https only). Mirrors the API. */
export function socialUrl(kind: 'instagram' | 'x', value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  if (!handle) return null;
  return kind === 'instagram' ? `https://instagram.com/${handle}` : `https://x.com/${handle}`;
}

export function websiteUrl(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  return `https://${v}`;
}

/** Contact line + links for the public pages (sign-up, inquiry, closed). */
export function AcademyContactLine({ style }: { style?: React.CSSProperties }) {
  const { academy } = useAcademy();
  const c = academy.contact;
  const facts = [c.phone, c.email, c.address].map((s) => s.trim()).filter(Boolean);
  const links = [
    { label: 'Website', href: websiteUrl(c.website) },
    { label: 'Instagram', href: socialUrl('instagram', c.instagram) },
    { label: 'X', href: socialUrl('x', c.x) },
  ].filter((l): l is { label: string; href: string } => !!l.href);
  if (!facts.length && !links.length) return null;
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.7, ...style }}>
      {facts.length > 0 && <div>{facts.join(' · ')}</div>}
      {links.length > 0 && (
        <div>
          {links.map((l, i) => (
            <span key={l.label}>
              {i > 0 && ' · '}
              <a href={l.href} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{l.label}</a>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
