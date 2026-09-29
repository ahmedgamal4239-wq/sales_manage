import React, { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { changePassword } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';
import { Button, Card, ErrorNotice, Field, Page, Title } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

export default function PasswordScreen() {
  const { user, signOut, handleApiError } = useAuth();
  const { t, isRTL } = useLanguage();
  const colors = useColors();
  const router = useRouter();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    if (newPassword.length < 12) return setError(t('passwordRule'));
    if (newPassword !== confirm) return setError(t('passwordMismatch'));
    setBusy(true);
    try {
      await changePassword({ currentPassword, newPassword });
      await signOut();
      router.replace('/login');
    } catch (e) {
      handleApiError(e);
      setError(e instanceof Error ? e.message : t('wrongLogin'));
    } finally {
      setBusy(false);
    }
  };
  return <Page style={styles.page}><KeyboardAwareScrollViewCompat contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <LanguageControl />
    <Title subtitle={user?.nameAr}>{t('changePassword')}</Title>
    {user?.mustChangePassword ? <Text style={[styles.must, { color: colors.primary, textAlign: isRTL ? 'right' : 'left' }]}>{t('passwordRule')}</Text> : null}
    <Card>
      <Field label={t('currentPassword')} value={currentPassword} onChangeText={setCurrent} secureTextEntry returnKeyType="next" />
      <Field label={t('newPassword')} value={newPassword} onChangeText={setNew} secureTextEntry returnKeyType="next" />
      <Field label={t('confirmPassword')} value={confirm} onChangeText={setConfirm} secureTextEntry returnKeyType="done" onSubmitEditing={submit} />
      {error ? <ErrorNotice message={error} /> : null}
      <Button title={t('savePassword')} onPress={submit} busy={busy} />
    </Card>
  </KeyboardAwareScrollViewCompat></Page>;
}
const styles = StyleSheet.create({
  page: { paddingTop: 24 }, content: { flexGrow: 1, maxWidth: 520, width: '100%', alignSelf: 'center' }, must: { fontSize: 13, marginBottom: 12 },
});