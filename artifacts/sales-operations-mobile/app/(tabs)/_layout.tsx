import React from 'react';
import { Platform } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';

export default function TabLayout() {
  const colors = useColors();
  const { user, ready, token } = useAuth();
  const { t } = useLanguage();
  const canViewDashboard = hasPermission(user, 'dashboard.view');
  const canViewSales = hasPermission(user, 'sales.view') || hasPermission(user, 'sales.write');
  const canViewAttendance = hasPermission(user, 'attendance.view') || hasPermission(user, 'attendance.write');
  const canViewData = hasPermission(user, 'users.view') || hasPermission(user, 'products.view') || hasPermission(user, 'branches.view');
  if (!ready) return null;
  if (token && !user) return <Redirect href="/" />;
  if (!token || !user) return <Redirect href="/" />;
  if (user.mustChangePassword) return <Redirect href="/password" />;
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.mutedForeground,
    tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: Platform.OS === 'web' ? 84 : 60, paddingTop: 5, paddingBottom: Platform.OS === 'web' ? 28 : 6 },
    tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
  }}>
    {canViewDashboard ? <Tabs.Screen name="index" options={{ title: t('home'), tabBarIcon: ({ color, size }) => <Feather name="grid" color={color} size={size} /> }} /> : null}
    {canViewSales ? <Tabs.Screen name="sales" options={{ title: t('sales'), tabBarIcon: ({ color, size }) => <Feather name="trending-up" color={color} size={size} /> }} /> : null}
    {canViewAttendance ? <Tabs.Screen name="attendance" options={{ title: t('attendance'), tabBarIcon: ({ color, size }) => <Feather name="clock" color={color} size={size} /> }} /> : null}
    {canViewData ? <Tabs.Screen name="data" options={{ title: t('readOnly'), tabBarIcon: ({ color, size }) => <Feather name="layers" color={color} size={size} /> }} /> : null}
    <Tabs.Screen name="settings" options={{ title: t('settings'), tabBarIcon: ({ color, size }) => <Feather name="settings" color={color} size={size} /> }} />
  </Tabs>;
}