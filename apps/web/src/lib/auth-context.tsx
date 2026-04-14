'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as api from './api';
import { setAuthToken } from './api';

interface AuthUser {
  id: string;
  email: string;
  role: 'COACH' | 'PLAYER';
  playerId: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  isCoach: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isCoach: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = localStorage.getItem('auth_user');
      const token = localStorage.getItem('pdapp_token');
      if (stored && token) {
        try {
          // Optimistically restore so UI renders immediately
          setUser(JSON.parse(stored));
          // Then validate the token by hitting /auth/me. If it 401s, clear.
          await api.getMe();
        } catch {
          setAuthToken(null);
          localStorage.removeItem('auth_user');
          setUser(null);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const result = await api.login(email, password);
    setAuthToken(result.token);
    const authUser: AuthUser = {
      id: result.id,
      email: result.email,
      role: result.role as 'COACH' | 'PLAYER',
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
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
