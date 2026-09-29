import React, { useState } from 'react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';
import { Button, Card, Field, Page } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';

export default function LoginScreen() {
  const { signIn, handleApiError } = useAuth();
  const { t, isRTL } = useLanguage();
  const colors = useColors();
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!employeeId.trim() || !password) {
      setError(t('wrongLogin'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await signIn(employeeId.trim(), password);
      router.replace('/'); // Root resolves forced password change before opening tabs.
    } catch (e) {
      handleApiError(e);
      setError(t('wrongLogin'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page style={styles.page}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <LanguageControl />
        <View style={[styles.brandMark, { backgroundColor: colors.accent }]}><Text style={[styles.markText, { color: colors.primary }]}>OL</Text></View>
        <Text style={[styles.brand, { color: colors.primary, textAlign: isRTL ? 'right' : 'left' }]}>{t('appName')}</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{t('tagline')}</Text>
        <Card style={styles.card}>
          <Text style={[styles.heading, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{t('loginTitle')}</Text>
          <Field label={t('employeeId')} value={employeeId} onChangeText={setEmployeeId} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
          <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry returnKeyType="done" onSubmitEditing={submit} />
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive, textAlign: isRTL ? 'right' : 'left' }]}>{error}</Text> : null}
          <Button title={t('signIn')} onPress={submit} busy={busy} />
        </Card>
      </KeyboardAwareScrollViewCompat>
    </Page>
  );
}
const styles = StyleSheet.create({
  page: {},
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: 30, maxWidth: 480, width: '100%', alignSelf: 'center' },
  brandMark: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  markText: { fontSize: 17, fontWeight: '900', letterSpacing: -1 },
  brand: { fontSize: 31, fontWeight: '800', letterSpacing: -0.8 },
  tagline: { marginTop: 5, marginBottom: 24, fontSize: 14 },
  card: { padding: 20 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  error: { fontSize: 13, marginBottom: 8 },
});