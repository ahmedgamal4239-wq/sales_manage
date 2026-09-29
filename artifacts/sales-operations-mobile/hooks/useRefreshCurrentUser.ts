import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export function useRefreshCurrentUser() {
  const { token, reloadUser } = useAuth();
  useFocusEffect(useCallback(() => {
    if (token) void reloadUser().catch(() => undefined);
  }, [token, reloadUser]));
}