import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/lib/language';

export function Page({ children, style, ...props }: ViewProps) {
  const colors = useColors();
  return <SafeAreaView edges={['top', 'left', 'right']} {...props} style={[styles.page, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 67 : 18 }, style]}>{children}</SafeAreaView>;
}

export function Title({ children, subtitle }: { children: React.ReactNode; subtitle?: React.ReactNode }) {
  const colors = useColors();
  const { isRTL } = useLanguage();
  return <View style={styles.titleWrap}><Text style={[styles.title, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{children}</Text>{subtitle ? <Text style={[styles.subtitle, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{subtitle}</Text> : null}</View>;
}

export function Card({ children, style }: ViewProps) {
  const colors = useColors();
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 5 }, style]}>{children}</View>;
}

export function Label({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const { isRTL } = useLanguage();
  return <Text style={[styles.label, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{children}</Text>;
}

export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  const colors = useColors();
  const { isRTL } = useLanguage();
  return <View style={styles.fieldWrap}>{label ? <Label>{label}</Label> : null}<TextInput {...props} placeholderTextColor={colors.mutedForeground} style={[styles.field, { backgroundColor: colors.card, borderColor: colors.input, color: colors.foreground, borderRadius: colors.radius, textAlign: isRTL ? 'right' : 'left' }, props.style]} /></View>;
}

export function Button({ title, onPress, secondary, disabled, busy }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean; busy?: boolean }) {
  const colors = useColors();
  return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [styles.button, { backgroundColor: secondary ? colors.card : colors.primary, borderColor: secondary ? colors.border : colors.primary, opacity: disabled ? 0.5 : pressed ? 0.82 : 1 }]}>{busy ? <ActivityIndicator color={secondary ? colors.primary : colors.primaryForeground} /> : <Text style={[styles.buttonText, { color: secondary ? colors.primary : colors.primaryForeground }]}>{title}</Text>}</Pressable>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const colors = useColors();
  const { t, isRTL } = useLanguage();
  return <View style={[styles.errorBox, { backgroundColor: colors.card, borderColor: colors.destructive }]}><Text style={[styles.errorText, { color: colors.destructive, textAlign: isRTL ? 'right' : 'left' }]}>{message}</Text>{onRetry ? <Pressable onPress={onRetry}><Text style={{ color: colors.primary, fontWeight: '700', marginTop: 8, textAlign: isRTL ? 'right' : 'left' }}>{t('retry')}</Text></Pressable> : null}</View>;
}

export function Loading() {
  const colors = useColors();
  return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;
}

export function Row({ children, style }: ViewProps) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 36 },
  titleWrap: { marginBottom: 20, gap: 4 },
  title: { fontSize: 25, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, lineHeight: 20 },
  card: { borderWidth: 1, padding: 16, marginBottom: 13, shadowColor: 'black', shadowOpacity: 0.035, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  fieldWrap: { marginBottom: 14 },
  field: { minHeight: 48, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15 },
  button: { minHeight: 49, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 5 },
  buttonText: { fontWeight: '700', fontSize: 15 },
  errorBox: { borderWidth: 1, padding: 13, borderRadius: 9, marginVertical: 10 },
  errorText: { fontSize: 13, lineHeight: 19 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});