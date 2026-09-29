import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, Pressable, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useListBranches, useListProducts, useListUsers } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { useRefreshCurrentUser } from '@/hooks/useRefreshCurrentUser';
import { useColors } from '@/hooks/useColors';
import { Card, ErrorNotice, Loading, Page, Row, Title } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';

type Section = 'branches' | 'products' | 'users';

function BranchesRoster() {
  const query = useListBranches();
  const { t, isRTL } = useLanguage();
  const colors = useColors();
  const retry = () => void query.refetch();
  return <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={retry} tintColor={colors.primary} />}>
    {query.error ? <ErrorNotice message={query.error instanceof Error ? query.error.message : 'Request failed'} onRetry={retry} /> : null}
    {query.isLoading ? <Loading /> : null}
    {(query.data ?? []).length === 0 && !query.isLoading && !query.error ? <Card><Text style={{ color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }}>{t('noData')}</Text></Card> : null}
    {(query.data ?? []).map((branch) => <Card key={`branch-${branch.id}`} style={styles.dataCard}>
      <Text style={[styles.itemTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{branch.name}</Text>
      <Text style={[styles.itemMeta, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{branch.chain || t('branches')} · {branch.timezone}</Text>
    </Card>)}
  </ScrollView>;
}

function ProductsRoster() {
  const query = useListProducts();
  const { t, isRTL, language } = useLanguage();
  const colors = useColors();
  const retry = () => void query.refetch();
  return <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={retry} tintColor={colors.primary} />}>
    {query.error ? <ErrorNotice message={query.error instanceof Error ? query.error.message : 'Request failed'} onRetry={retry} /> : null}
    {query.isLoading ? <Loading /> : null}
    {(query.data ?? []).length === 0 && !query.isLoading && !query.error ? <Card><Text style={{ color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }}>{t('noData')}</Text></Card> : null}
    {(query.data ?? []).map((product) => <Card key={`product-${product.id}`} style={styles.dataCard}>
      <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}>
        <Text style={[styles.itemTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{language === 'en' ? product.nameEn || product.nameAr : product.nameAr}</Text>
        <Text style={[styles.itemMeta, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{product.code}</Text>
      </View><Text style={[styles.itemPrice, { color: colors.primary }]}>{Number(product.price).toLocaleString(language === 'ar' ? 'ar' : 'en')}</Text></Row>
    </Card>)}
  </ScrollView>;
}

function UsersRoster() {
  const query = useListUsers();
  const { t, isRTL, language } = useLanguage();
  const colors = useColors();
  const retry = () => void query.refetch();
  return <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={retry} tintColor={colors.primary} />}>
    {query.error ? <ErrorNotice message={query.error instanceof Error ? query.error.message : 'Request failed'} onRetry={retry} /> : null}
    {query.isLoading ? <Loading /> : null}
    {(query.data ?? []).length === 0 && !query.isLoading && !query.error ? <Card><Text style={{ color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }}>{t('noData')}</Text></Card> : null}
    {(query.data ?? []).map((employee) => <Card key={`user-${employee.id}`} style={styles.dataCard}>
      <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}>
        <Text style={[styles.itemTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{language === 'en' ? employee.nameEn || employee.nameAr : employee.nameAr}</Text>
        <Text style={[styles.itemMeta, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{employee.employeeId}</Text>
      </View><Text style={[styles.itemRole, { color: employee.active ? colors.primary : colors.mutedForeground }]}>{employee.role}</Text></Row>
    </Card>)}
  </ScrollView>;
}

export default function ManagerDataScreen() {
  const { user } = useAuth();
  useRefreshCurrentUser();
  const { t, isRTL } = useLanguage();
  const colors = useColors();
  const [section, setSection] = useState<Section>('branches');
  const sections = (['branches', 'products', 'users'] as Section[]).filter((item) => hasPermission(user, `${item}.view` as 'branches.view' | 'products.view' | 'users.view'));
  if (!sections.length) return <Redirect href="/(tabs)" />;
  const currentSection = sections.includes(section) ? section : sections[0];
  return <Page>
    <View style={styles.content}>
      <View style={[styles.heading, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><View style={{ flex: 1 }}><Title subtitle={t('readOnly')}>{t('readOnly')}</Title></View><LanguageControl /></View>
      <View style={[styles.tabs, { flexDirection: isRTL ? 'row-reverse' : 'row', backgroundColor: colors.secondary }]}>
        {sections.map((item) => <Pressable key={item} onPress={() => setSection(item)} style={[styles.tab, currentSection === item && { backgroundColor: colors.primary }]}><Text style={{ color: currentSection === item ? colors.primaryForeground : colors.foreground, fontWeight: '700', fontSize: 12 }}>{item === 'users' ? t('people') : t(item)}</Text></Pressable>)}
      </View>
      {currentSection === 'branches' ? <BranchesRoster /> : currentSection === 'products' ? <ProductsRoster /> : <UsersRoster />}
    </View>
  </Page>;
}

const styles = StyleSheet.create({
  content: { flex: 1, paddingBottom: 30 }, heading: { justifyContent: 'space-between', alignItems: 'flex-start' },
  tabs: { padding: 4, borderRadius: 10, marginBottom: 14, gap: 4 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8 },
  dataCard: { paddingVertical: 13 }, itemTitle: { fontSize: 14, fontWeight: '700' }, itemMeta: { fontSize: 11, marginTop: 4 }, itemPrice: { fontSize: 13, fontWeight: '700' }, itemRole: { fontSize: 10, fontWeight: '700' },
});