import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getGetMeQueryKey, useGetMe } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { useColors } from '@/hooks/useColors';

export default function EntryRoute() {
  const { token, ready, setUser } = useAuth();
  const router = useRouter();
  const colors = useColors();
  const me = useGetMe({ query: { queryKey: getGetMeQueryKey(), enabled: ready && !!token, retry: false } });
  useEffect(() => {
    if (!ready) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    if (me.data) {
      setUser(me.data);
      router.replace(me.data.mustChangePassword ? '/password' : '/(tabs)');
    } else if (me.isError) {
      router.replace('/login');
    }
  }, [ready, token, me.data, me.isError, router, setUser]);
  return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} size="large" /></View>;
}