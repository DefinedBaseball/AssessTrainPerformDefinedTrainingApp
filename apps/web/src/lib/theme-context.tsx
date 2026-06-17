'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Theme provider — toggles between the existing dark palette and the
 * light palette defined under `[data-theme="light"]` in globals.css.
 *
 * Persistence: localStorage key `pdapp_theme` so the choice survives
 * across reloads (and across tabs, via the `storage` event).
 *
 * Hydration: a tiny inline script in the root layout (see
 * `<ThemeBootstrapScript />`) sets `data-theme` on the <html> element
 * BEFORE React hydrates, so the page never flashes the wrong palette.
 */
export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'pdapp_theme';

function readStoredTheme(): Theme {
  // Light is the default — only an explicit saved 'dark' opts out.
  if (typeof window === 'undefined') return 'light';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'dark' ? 'dark' : 'light';
  } catch { return 'light'; }
}

function applyToDocument(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // We start at 'light' (the default) on the server and then sync with
  // the bootstrap script's choice on the client via the effect below. The
  // effect only updates state — the DOM was already correct from bootstrap.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyToDocument(stored);
    // Cross-tab sync — pick up changes made in another window.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next: Theme = e.newValue === 'light' ? 'light' : 'dark';
      setThemeState(next);
      applyToDocument(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyToDocument(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Permissive fallback so a stray useTheme() doesn't crash — most
    // call sites are inside the provider, but the toggle button might
    // briefly mount during hydration.
    return { theme: 'light', setTheme: () => undefined, toggle: () => undefined };
  }
  return ctx;
}

/** Inline script string that runs before React hydrates to set the
 *  `data-theme` attribute based on localStorage. Prevents a flash of
 *  the wrong theme. Render once inside the document <head> via
 *  next/script or a regular <script> tag with `dangerouslySetInnerHTML`. */
export const themeBootstrapScript = `
(function () {
  try {
    var t = window.localStorage.getItem('${STORAGE_KEY}');
    // Light is the default — apply it unless the user explicitly saved 'dark'.
    if (t !== 'dark') document.documentElement.setAttribute('data-theme', 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();
