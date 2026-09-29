import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getMe, getGetMeQueryKey, mobileLogin, logout as apiLogout } from '@workspace/api-client-react';
import type { Employee } from '@workspace/api-client-react';
import { handleUnauthorizedError, readToken, setUnauthorizedHandler, writeToken } from './session';

type AuthValue = {
  token: string | null;
  user: Employee | null;
  ready: boolean;
  signIn: (employeeId: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadUser: () => Promise<Employee>;
  setUser: (user: Employee | null) => void;
  handleApiError: (error: unknown) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<Employee | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();
  const clearSession = useCallback(async () => {
    await writeToken(null);
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    let mounted = true;
    readToken().then((stored) => {
      if (mounted) {
        setToken(stored);
        setReady(true);
      }
    }).catch(() => setReady(true));
    return () => { mounted = false; };
  }, []);

  const signIn = async (employeeId: string, password: string) => {
    const session = await mobileLogin({ employeeId, password });
    await writeToken(session.token);
    setToken(session.token);
    setUser(session.user);
    queryClient.setQueryData(getGetMeQueryKey(), session.user);
    await queryClient.invalidateQueries();
  };

  const signOut = async () => {
    try {
      if (token) await apiLogout();
    } finally {
      await clearSession();
    }
  };

  const reloadUser = useCallback(async () => {
    try {
      const current = await getMe();
      const previous = queryClient.getQueryData<Employee>(getGetMeQueryKey())?.effectivePermissions ?? [];
      const next = current.effectivePermissions ?? [];
      const permissionsChanged = previous.length !== next.length ||
        previous.some((permission) => !next.includes(permission));
      if (permissionsChanged) queryClient.clear();
      setUser(current);
      queryClient.setQueryData(getGetMeQueryKey(), current);
      return current;
    } catch (error) {
      handleUnauthorizedError(error);
      throw error;
    }
  }, [queryClient]);

  const handleApiError = useCallback((error: unknown) => handleUnauthorizedError(error), []);
  const value = useMemo(() => ({ token, user, ready, signIn, signOut, reloadUser, setUser, handleApiError }), [token, user, ready, clearSession, reloadUser, handleApiError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}