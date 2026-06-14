'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as api from './api';
import { setAuthToken } from './api';

export type CoachLevel = 'ADMIN' | 'COACH' | 'VIEWER';

interface AuthUser {
  id: string;
  email: string;
  role: 'COACH' | 'PLAYER';
  /** Coach access level (null for players, and for legacy coaches → treated
   *  as ADMIN below). */
  coachLevel: CoachLevel | null;
  /** Account lifecycle — PENDING players are gated to the holding screen. */
  status: 'ACTIVE' | 'PENDING' | 'DECLINED';
  /** Display name from Settings → Account (null until the user sets it). */
  name: string | null;
  playerId: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isCoach: boolean;
  /** ADMIN-level coach — can manage coach accounts + approvals. */
  isAdmin: boolean;
  /** VIEWER-level coach — read-only across the app. */
  isViewer: boolean;
  /** True while a self-registered player awaits coach approval. */
  isPending: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-fetch /auth/me and update the session (e.g. to detect approval). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isCoach: false,
  isAdmin: false,
  isViewer: false,
  isPending: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Pull the authoritative session from /auth/me and persist it. */
  const refresh = useCallback(async () => {
    try {
      const me = await api.getMe();
      const authUser: AuthUser = {
        id: me.id,
        email: me.email,
        role: me.role as 'COACH' | 'PLAYER',
        coachLevel: (me.coachLevel as CoachLevel | null) ?? null,
        status: (me.status as AuthUser['status']) || 'ACTIVE',
        name: me.name ?? null,
        playerId: me.playerId,
      };
      setUser(authUser);
      localStorage.setItem('auth_user', JSON.stringify(authUser));
    } catch {
      // Token invalid/expired → clear the session.
      setAuthToken(null);
      localStorage.removeItem('auth_user');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem('auth_user');
      const token = localStorage.getItem('pdapp_token');
      if (stored && token) {
        // Optimistically restore so UI renders immediately…
        try {
          setUser(JSON.parse(stored));
        } catch {
          /* ignore corrupt cache */
        }
        // …then revalidate + refresh status (catches approval flips, 401s).
        await refresh();
      }
      setIsLoading(false);
    })();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const result = await api.login(email, password);
    setAuthToken(result.token);
    const authUser: AuthUser = {
      id: result.id,
      email: result.email,
      role: result.role as 'COACH' | 'PLAYER',
      coachLevel: ((result as any).coachLevel as CoachLevel | null) ?? null,
      status: (result.status as AuthUser['status']) || 'ACTIVE',
      name: result.name ?? null,
      playerId: result.playerId,
    };
    setUser(authUser);
    localStorage.setItem('auth_user', JSON.stringify(authUser));
  };

  const logout = () => {
    setUser(null);
    setAuthToken(null);
    localStorage.removeItem('auth_user');
  };

  const isCoach = user?.role === 'COACH';
  const lvl = user?.coachLevel ?? null;
  return (
    <AuthContext.Provider
      value={{
        user,
        isCoach,
        // Legacy coaches (null level) are treated as ADMIN, matching the API.
        isAdmin: isCoach && (lvl === 'ADMIN' || lvl == null),
        isViewer: isCoach && lvl === 'VIEWER',
        isPending: user?.status === 'PENDING',
        isLoading,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
