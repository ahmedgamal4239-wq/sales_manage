import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Page, Row, Title } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';
import { useRefreshCurrentUser } from '@/hooks/useRefreshCurrentUser';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  useRefreshCurrentUser();
  const { t, isRTL } = useLanguage();
  const colors = useColors();
  const router = useRouter();
  return <Page><LanguageControl /><Title>{t('settings')}</Title>
    <Card>
      <Text style={[styles.name, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{user?.nameAr}</Text>
      {user?.nameEn ? <Text style={[styles.englishName, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{user.nameEn}</Text> : null}
      <Row style={[styles.detailRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><Text style={{ color: colors.mutedForeground }}>{t('employeeId')}</Text><Text style={{ color: colors.foreground, fontWeight: '600' }}>{user?.employeeId}</Text></Row>
      <Row style={[styles.detailRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><Text style={{ color: colors.mutedForeground }}>{t('userRole')}</Text><Text style={{ color: colors.foreground, fontWeight: '600' }}>{user?.role}</Text></Row>
    </Card>
    <Card>
      <Button title={t('changePassword')} secondary onPress={() => router.push('/password')} />
      <Button title={t('signOut')} onPress={() => void signOut().then(() => router.replace('/login'))} />
    </Card>
  </Page>;
}
const styles = StyleSheet.create({
  name: { fontSize: 19, fontWeight: '700' }, englishName: { fontSize: 13, marginTop: 4 },
  detailRow: { justifyContent: 'space-between', marginTop: 15 },
});