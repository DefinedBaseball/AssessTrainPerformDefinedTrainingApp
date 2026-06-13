'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import * as api from './api';
import { setAuthToken } from './api';

interface AuthUser {
  id: string;
  email: string;
  role: 'COACH' | 'PLAYER';
  /** Account lifecycle — PENDING players are gated to the holding screen. */
  status: 'ACTIVE' | 'PENDING' | 'DECLINED';
  /** Display name from Settings → Account (null until the user sets it). */
  name: string | null;
  playerId: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isCoach: boolean;
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

  return (
    <AuthContext.Provider
      value={{
        user,
        isCoach: user?.role === 'COACH',
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
