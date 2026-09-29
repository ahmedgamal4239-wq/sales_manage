import React, { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import * as Location from 'expo-location';
import { Feather } from '@expo/vector-icons';
import { getGetDashboardQueryKey, getListAttendanceQueryKey, punchAttendance, useListAttendance } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';
import { Button, Card, ErrorNotice, Loading, Page, Row, Title } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';
import { useRefreshCurrentUser } from '@/hooks/useRefreshCurrentUser';

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function AttendanceScreen() {
  const { user, handleApiError } = useAuth();
  useRefreshCurrentUser();
  const { t, isRTL, language } = useLanguage();
  const colors = useColors();
  const client = useQueryClient();
  const canViewAttendance = hasPermission(user, 'attendance.view');
  const canWriteAttendance = hasPermission(user, 'attendance.write');
  const attendance = useListAttendance({ query: { queryKey: getListAttendanceQueryKey(), enabled: canViewAttendance } });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const todayPunches = useMemo(() => (attendance.data ?? []).filter((punch) => dateKey(new Date(punch.receivedAt)) === dateKey(new Date())).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()), [attendance.data]);
  const latest = todayPunches[0];
  const nextType = latest?.type === 'IN' ? 'OUT' : 'IN';
  const recordPunch = async () => {
    if (!user?.branchId) return setError(t('noBranch'));
    setBusy(true);
    setError('');
    setSuccess('');
    setSettingsRequired(false);
    try {
      let latitude: number;
      let longitude: number;
      let accuracy: number;
      let capturedAt: string;
      if (Platform.OS === 'web') {
        if (!globalThis.navigator?.geolocation) throw new Error(t('locationError'));
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          globalThis.navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
        accuracy = position.coords.accuracy;
        capturedAt = new Date(position.timestamp).toISOString();
      } else {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          setError(t('permissionDenied'));
          setSettingsRequired(!permission.canAskAgain);
          return;
        }
        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
        if (location.coords.accuracy === null) throw new Error(t('locationError'));
        accuracy = location.coords.accuracy;
        capturedAt = new Date(location.timestamp).toISOString();
      }
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) {
        throw new Error(t('locationError'));
      }
      await punchAttendance({
        branchId: user.branchId,
        type: nextType,
        latitude,
        longitude,
        accuracy,
        capturedAt,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: getListAttendanceQueryKey() }),
        client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
      ]);
      setSuccess(t('captured'));
    } catch (e) {
      handleApiError(e);
      setError(e instanceof Error ? e.message : t('locationError'));
    } finally {
      setBusy(false);
    }
  };
  const refetch = () => { if (canViewAttendance) void attendance.refetch(); };
  if (!canViewAttendance && !canWriteAttendance) {
    return <Redirect href={hasPermission(user, 'dashboard.view') ? '/(tabs)' : hasPermission(user, 'sales.view') || hasPermission(user, 'sales.write') ? '/(tabs)/sales' : '/(tabs)/data'} />;
  }
  return <Page><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={attendance.isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>
    <View style={[styles.headingRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><View style={{ flex: 1 }}><Title subtitle={canWriteAttendance ? t('locationHint') : t('history')}>{t('attendance')}</Title></View><LanguageControl /></View>
    {canWriteAttendance && !user?.branchId ? <ErrorNotice message={t('noBranch')} /> : null}
    {canViewAttendance && attendance.error ? <ErrorNotice message={attendance.error instanceof Error ? attendance.error.message : 'Request failed'} onRetry={refetch} /> : null}
    {canWriteAttendance ? <Card style={styles.actionCard}>
      <View style={[styles.clockIcon, { backgroundColor: colors.secondary }]}><Feather name="map-pin" size={23} color={colors.primary} /></View>
      <Text style={[styles.actionTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{t(nextType === 'IN' ? 'punchIn' : 'punchOut')}</Text>
      <Text style={[styles.branchLabel, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{t('branch')}{user?.branchId ? ` #${user.branchId}` : ''}</Text>
      {canViewAttendance && latest ? <Row style={styles.lastPunch}><Text style={{ color: colors.mutedForeground }}>{t('lastPunch')}</Text><Text style={{ color: colors.foreground, fontWeight: '600' }}>{new Date(latest.receivedAt).toLocaleTimeString(language === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })} · {latest.type}</Text></Row> : null}
      {error ? <ErrorNotice message={error} /> : null}
      {settingsRequired && Platform.OS !== 'web' ? <Pressable onPress={() => { void Linking.openSettings(); }} style={styles.settingsLink}><Text style={{ color: colors.primary, fontWeight: '700' }}>{t('settings')}</Text></Pressable> : null}
      {success ? <Text style={[styles.success, { color: colors.primary }]}>{success}</Text> : null}
      {canWriteAttendance ? <Button title={t(nextType === 'IN' ? 'punchIn' : 'punchOut')} onPress={() => void recordPunch()} busy={busy} disabled={!user?.branchId} /> : null}
    </Card> : null}
    {canViewAttendance ? <Title>{t('history')}</Title> : null}
    {canViewAttendance && attendance.isLoading ? <Loading /> : null}
    {canViewAttendance && todayPunches.length === 0 && !attendance.isLoading ? <Card><Text style={{ color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }}>{t('noHistory')}</Text></Card> : null}
    {canViewAttendance ? todayPunches.map((punch) => <Card key={punch.id} style={styles.historyCard}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={[styles.historyLeft, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><Feather name={punch.type === 'IN' ? 'log-in' : 'log-out'} size={19} color={colors.primary} /><View><Text style={[styles.type, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{punch.type === 'IN' ? t('punchIn') : t('punchOut')}</Text><Text style={[styles.timestamp, { color: colors.mutedForeground }]}>{new Date(punch.receivedAt).toLocaleString(language === 'ar' ? 'ar' : 'en')}</Text></View></View>
        <Text style={[styles.status, { color: colors.primary }]}>{punch.status}</Text>
      </Row>
    </Card>) : null}
  </ScrollView></Page>;
}
const styles = StyleSheet.create({
  content: { paddingBottom: 30 }, headingRow: { justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  actionCard: { padding: 19 }, clockIcon: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  actionTitle: { fontSize: 19, fontWeight: '700' }, branchLabel: { fontSize: 12, marginTop: 5 },
  lastPunch: { justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e3e4d9', marginTop: 16, paddingTop: 12, marginBottom: 7 },
  settingsLink: { alignSelf: 'flex-end', padding: 7 }, success: { fontSize: 13, marginVertical: 7, fontWeight: '700' },
  historyCard: { paddingVertical: 13 }, historyLeft: { alignItems: 'center', gap: 11 }, type: { fontSize: 13, fontWeight: '700' }, timestamp: { fontSize: 11, marginTop: 3 }, status: { fontSize: 11, fontWeight: '700' },
});