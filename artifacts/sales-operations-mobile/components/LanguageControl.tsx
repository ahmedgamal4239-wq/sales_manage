import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useLanguage } from '@/lib/language';

export default function LanguageControl() {
  const { t, toggle } = useLanguage();
  const colors = useColors();
  return <Pressable accessibilityRole="button" onPress={toggle} style={[styles.control, { borderColor: colors.border }]}><Text style={[styles.text, { color: colors.primary }]}>{t('language')}</Text></Pressable>;
}
const styles = StyleSheet.create({
  control: { paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 14 },
  text: { fontSize: 12, fontWeight: '700' },
});