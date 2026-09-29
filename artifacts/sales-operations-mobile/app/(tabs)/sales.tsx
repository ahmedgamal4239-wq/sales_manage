import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { getGetDashboardQueryKey, getListProductsQueryKey, getListSalesQueryKey, saveSales, useListProducts, useListSales } from '@workspace/api-client-react';
import type { SalesLine } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';
import { useRefreshCurrentUser } from '@/hooks/useRefreshCurrentUser';
import { Button, Card, ErrorNotice, Field, Loading, Page, Row, Title } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';

type DraftLine = SalesLine;
function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function SalesScreen() {
  const { user, handleApiError } = useAuth();
  useRefreshCurrentUser();
  const { t, isRTL, language } = useLanguage();
  const colors = useColors();
  const queryClient = useQueryClient();
  const canViewSales = hasPermission(user, 'sales.view');
  const canWriteSales = hasPermission(user, 'sales.write');
  const canViewProducts = hasPermission(user, 'products.view');
  const canCreateWithProducts = canWriteSales && canViewProducts;
  const products = useListProducts({ query: { queryKey: getListProductsQueryKey(), enabled: canCreateWithProducts } });
  const sales = useListSales({ query: { queryKey: getListSalesQueryKey(), enabled: canViewSales } });
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const productMap = useMemo(() => new Map((products.data ?? []).map((product) => [product.id, product])), [products.data]);
  const branchId = user?.branchId;
  const updateLine = (index: number, changes: Partial<DraftLine>) => setLines((current) => current.map((line, i) => i === index ? { ...line, ...changes } : line));
  const addProduct = (productId: number) => {
    const product = productMap.get(productId);
    if (!product) return;
    setLines((current) => {
      const existing = current.findIndex((line) => line.productId === productId);
      if (existing >= 0) return current.map((line, i) => i === existing ? { ...line, quantity: line.quantity + 1, amount: ((line.quantity + 1) * Number(product.price)).toFixed(2) } : line);
      return [...current, { productId, quantity: 1, amount: Number(product.price).toFixed(2), returns: '0' }];
    });
    setPickerOpen(false);
    setError('');
  };
  const save = async (submitted: boolean) => {
    if (!canWriteSales || !canViewProducts) return;
    setError('');
    setMessage('');
    if (!branchId) return setError(t('noBranch'));
    if (!lines.length) return setError(t('selectProduct'));
    if (lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) return setError(t('positiveQuantity'));
    setBusy(true);
    try {
      await saveSales({
        branchId,
        businessDate: localDate(),
        lines: lines.map((line) => ({ ...line, quantity: Number(line.quantity), amount: String(line.amount), returns: String(line.returns || '0') })),
        submitted,
        notes: notes.trim() || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListSalesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
      ]);
      setMessage(submitted ? t('reportSent') : t('draftSaved'));
      if (submitted) { setLines([]); setNotes(''); }
    } catch (e) {
      handleApiError(e);
      setError(e instanceof Error ? e.message : t('wrongLogin'));
    } finally {
      setBusy(false);
    }
  };
  const refetch = () => {
    if (canCreateWithProducts) void products.refetch();
    if (canViewSales) void sales.refetch();
  };
  if (!canWriteSales && !canViewSales) {
    return <Redirect href={hasPermission(user, 'dashboard.view') ? '/(tabs)' : hasPermission(user, 'attendance.view') || hasPermission(user, 'attendance.write') ? '/(tabs)/attendance' : '/(tabs)/data'} />;
  }
  return <Page>
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={products.isRefetching || sales.isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>
      <View style={[styles.headingRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><View style={{ flex: 1 }}><Title subtitle={localDate()}>{t('newReport')}</Title></View><LanguageControl /></View>
      {canCreateWithProducts && !branchId ? <ErrorNotice message={t('noBranch')} /> : null}
      {canCreateWithProducts && products.error ? <ErrorNotice message={products.error instanceof Error ? products.error.message : 'Request failed'} onRetry={() => void products.refetch()} /> : null}
      {canCreateWithProducts ? <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}><Text style={[styles.cardTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{t('newReport')}</Text><Text style={[styles.lineCount, { color: colors.mutedForeground }]}>{lines.length} {t('units')}</Text></Row>
        {lines.map((line, index) => {
          const product = productMap.get(line.productId);
          return <View key={`${line.productId}-${index}`} style={[styles.line, { borderTopColor: colors.border }]}>
            <View style={[styles.productHeading, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><Text style={[styles.productName, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{language === 'en' ? product?.nameEn || product?.nameAr : product?.nameAr}</Text><Pressable onPress={() => setLines((all) => all.filter((_, i) => i !== index))} accessibilityLabel="Remove item"><Feather name="x" size={18} color={colors.destructive} /></Pressable></View>
            <View style={[styles.inputLine, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <View style={styles.inputFlex}><Field label={t('quantity')} value={String(line.quantity)} keyboardType="decimal-pad" onChangeText={(value) => {
                const quantity = Number(value);
                const price = Number(product?.price ?? 0);
                updateLine(index, { quantity: Number.isNaN(quantity) ? 0 : quantity, amount: value === '' ? '' : (quantity * price).toFixed(2) });
              }} style={styles.compactField} /></View>
              <View style={styles.inputFlex}><Field label={t('amount')} value={line.amount} keyboardType="decimal-pad" onChangeText={(amount) => updateLine(index, { amount })} style={styles.compactField} /></View>
              <View style={styles.inputFlex}><Field label={t('returns')} value={line.returns} keyboardType="decimal-pad" onChangeText={(returns) => updateLine(index, { returns })} style={styles.compactField} /></View>
            </View>
          </View>;
        })}
        <Button title={pickerOpen ? t('chooseProduct') : t('addProduct')} secondary onPress={() => setPickerOpen((open) => !open)} />
        {pickerOpen ? <View style={[styles.picker, { borderColor: colors.border }]}>
          {(products.data ?? []).filter((item) => item.active).map((product) => <Pressable key={product.id} onPress={() => addProduct(product.id)} style={({ pressed }) => [styles.pickRow, { borderBottomColor: colors.border, opacity: pressed ? 0.65 : 1, flexDirection: isRTL ? 'row-reverse' : 'row' }]}><View style={{ flex: 1 }}><Text style={[styles.pickName, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{language === 'en' ? product.nameEn || product.nameAr : product.nameAr}</Text><Text style={[styles.code, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{product.code}</Text></View><Text style={[styles.price, { color: colors.primary }]}>{Number(product.price).toLocaleString(language === 'ar' ? 'ar' : 'en')}</Text></Pressable>)}
          {products.isLoading ? <Loading /> : null}
          {(products.data ?? []).filter((item) => item.active).length === 0 && !products.isLoading && !products.error ? <Text style={[styles.empty, { color: colors.mutedForeground, padding: 14, textAlign: isRTL ? 'right' : 'left' }]}>{t('noData')}</Text> : null}
        </View> : null}
        <Field label={t('notes')} value={notes} onChangeText={setNotes} multiline style={styles.notes} />
        {error ? <ErrorNotice message={error} /> : null}
        {message ? <Text style={[styles.success, { color: colors.primary }]}>{message}</Text> : null}
        <View style={styles.actions}><Button title={t('saveDraft')} secondary onPress={() => void save(false)} busy={busy} disabled={!branchId} /><Button title={t('submitReport')} onPress={() => void save(true)} busy={busy} disabled={!branchId} /></View>
      </Card> : null}
      {canViewSales ? <Title>{t('personalHistory')}</Title> : null}
      {canViewSales && sales.isLoading ? <Loading /> : null}
      {canViewSales && sales.error ? <ErrorNotice message={sales.error instanceof Error ? sales.error.message : 'Request failed'} onRetry={() => void sales.refetch()} /> : null}
      {canViewSales && (sales.data ?? []).length === 0 && !sales.isLoading ? <Card><Text style={[styles.empty, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{t('noSales')}</Text></Card> : null}
      {canViewSales ? (sales.data ?? []).map((report) => <Card key={report.id} style={styles.reportCard}>
        <Row style={{ justifyContent: 'space-between' }}><Text style={[styles.reportDate, { color: colors.foreground }]}>{report.businessDate}</Text><Text style={[styles.reportStatus, { color: report.status === 'SUBMITTED' ? colors.primary : colors.accent }]}>{report.status}</Text></Row>
        <Row style={{ justifyContent: 'space-between', marginTop: 8 }}><Text style={{ color: colors.mutedForeground }}>{t('net')}</Text><Text style={[styles.reportTotal, { color: colors.primary }]}>{Number(report.net).toLocaleString(language === 'ar' ? 'ar' : 'en')}</Text></Row>
        <Text style={[styles.lineSummary, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{report.lines.length} {t('units')}</Text>
      </Card>) : null}
    </ScrollView>
  </Page>;
}
const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  headingRow: { justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700' }, lineCount: { fontSize: 12 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 5 },
  productHeading: { alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  productName: { fontSize: 14, fontWeight: '700', flex: 1 },
  inputLine: { gap: 8 }, inputFlex: { flex: 1 },
  compactField: { minHeight: 43, paddingHorizontal: 8, paddingVertical: 7, fontSize: 13 },
  picker: { marginTop: 10, borderWidth: 1, borderRadius: 9, overflow: 'hidden' },
  pickRow: { borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center', padding: 12, gap: 8 },
  pickName: { fontSize: 14, fontWeight: '600' }, code: { fontSize: 10, marginTop: 3 }, price: { fontSize: 13, fontWeight: '700' },
  notes: { minHeight: 76, textAlignVertical: 'top' },
  actions: { gap: 8, marginTop: 6 }, success: { fontSize: 13, fontWeight: '700', marginBottom: 7 },
  empty: { fontSize: 13, lineHeight: 19 }, reportCard: { paddingVertical: 14 },
  reportDate: { fontSize: 14, fontWeight: '700' }, reportStatus: { fontSize: 11, fontWeight: '700' }, reportTotal: { fontSize: 15, fontWeight: '800' },
  lineSummary: { fontSize: 11, marginTop: 6 },
});