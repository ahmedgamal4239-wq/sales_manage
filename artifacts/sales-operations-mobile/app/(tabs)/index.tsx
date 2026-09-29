import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { getGetDashboardQueryKey, getListBranchesQueryKey, getListSalesQueryKey, useGetDashboard, useListBranches, useListSales } from '@workspace/api-client-react';
import { useAuth } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { useLanguage } from '@/lib/language';
import { useColors } from '@/hooks/useColors';
import { useRefreshCurrentUser } from '@/hooks/useRefreshCurrentUser';
import { Button, Card, ErrorNotice, Loading, Page, Row, Title } from '@/components/ui';
import LanguageControl from '@/components/LanguageControl';

function StatCard({ label, value, foot }: { label: string; value: string | number; foot?: string }) {
  const colors = useColors();
  const { isRTL } = useLanguage();
  return <Card style={styles.stat}><Text style={[styles.statLabel, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{label}</Text><Text style={[styles.statValue, { color: colors.primary, textAlign: isRTL ? 'right' : 'left' }]}>{value}</Text>{foot ? <Text style={[styles.statFoot, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{foot}</Text> : null}</Card>;
}

export default function HomeScreen() {
  const { user } = useAuth();
  useRefreshCurrentUser();
  const { t, isRTL, language } = useLanguage();
  const colors = useColors();
  const canViewDashboard = hasPermission(user, 'dashboard.view');
  const canViewBranches = hasPermission(user, 'branches.view');
  const canViewSales = hasPermission(user, 'sales.view');
  const canViewUsers = hasPermission(user, 'users.view');
  const dashboard = useGetDashboard({ query: { queryKey: getGetDashboardQueryKey(), enabled: canViewDashboard } });
  const branches = useListBranches({ query: { queryKey: getListBranchesQueryKey(), enabled: canViewDashboard && canViewBranches } });
  const sales = useListSales({ query: { queryKey: getListSalesQueryKey(), enabled: canViewDashboard && canViewSales } });
  const branch = branches.data?.find((item) => item.id === user?.branchId);
  const refetch = () => {
    if (canViewDashboard) void dashboard.refetch();
    if (canViewBranches) void branches.refetch();
    if (canViewSales) void sales.refetch();
  };
  if (!canViewDashboard) {
    const nextRoute = canViewSales || hasPermission(user, 'sales.write') ? '/(tabs)/sales'
      : hasPermission(user, 'attendance.view') || hasPermission(user, 'attendance.write') ? '/(tabs)/attendance'
        : canViewBranches || hasPermission(user, 'products.view') || canViewUsers ? '/(tabs)/data' : '/(tabs)/settings';
    return <Redirect href={nextRoute} />;
  }
  if (dashboard.isLoading || (canViewBranches && branches.isLoading)) return <Loading />;
  const error = dashboard.error || (canViewBranches ? branches.error : null);
  const reports = sales.data ?? [];
  return <Page>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>
      <View style={[styles.topLine, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}><View style={{ flex: 1 }}><Text style={[styles.eyebrow, { color: colors.primary, textAlign: isRTL ? 'right' : 'left' }]}>{canViewUsers ? t('managerView') : t('today')}</Text><Text style={[styles.hello, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{t('greeting')}، {user?.nameAr}</Text><Text style={[styles.branch, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{branch?.name ?? (canViewBranches && user?.branchId ? `${t('branch')} #${user.branchId}` : '')}</Text></View><LanguageControl /></View>
      {error ? <ErrorNotice message={error instanceof Error ? error.message : 'Request failed'} onRetry={refetch} /> : null}
      {!canViewBranches && !user?.branchId ? <ErrorNotice message={t('noBranch')} /> : null}
      {dashboard.data ? <View style={styles.stats}>
        <StatCard label={t('salesTotal')} value={Number(dashboard.data.salesTotal).toLocaleString(language === 'ar' ? 'ar' : 'en')} foot={t('salesLabel')} />
        <StatCard label={t('submittedSales')} value={dashboard.data.submittedSales} />
        <StatCard label={t('branches')} value={dashboard.data.branches} />
        {canViewUsers ? <StatCard label={t('products')} value={dashboard.data.products} /> : <StatCard label={t('attendanceIssues')} value={dashboard.data.attendanceExceptions} />}
      </View> : null}
      {canViewSales ? <Card>
        <Text style={[styles.sectionTitle, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{t('personalHistory')}</Text>
        {sales.isLoading ? <Loading /> : sales.error ? <ErrorNotice message={sales.error instanceof Error ? sales.error.message : 'Request failed'} onRetry={() => void sales.refetch()} /> : reports.length === 0 ? <Text style={[styles.emptyText, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{t('noSales')}</Text> :
          reports.slice(0, 3).map((report) => <Row key={report.id} style={styles.historyRow}><Text style={[styles.historyDate, { color: colors.foreground, textAlign: isRTL ? 'right' : 'left' }]}>{report.businessDate}</Text><Text style={[styles.historyTotal, { color: colors.primary }]}>{Number(report.net).toLocaleString(language === 'ar' ? 'ar' : 'en')}</Text></Row>)}
      </Card> : null}
      {canViewUsers ? <Card><Title subtitle={user?.role}>{t('today')}</Title><Text style={[styles.managerText, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{t('people')}: {dashboard.data?.users ?? '—'}  ·  {t('products')}: {dashboard.data?.products ?? '—'}</Text></Card> : null}
      <Text style={[styles.role, { color: colors.mutedForeground, textAlign: isRTL ? 'right' : 'left' }]}>{t('userRole')}: {user?.role}</Text>
    </ScrollView>
  </Page>;
}
const styles = StyleSheet.create({
  content: { paddingBottom: 30 },
  topLine: { alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, gap: 12 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 5 },
  hello: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  branch: { fontSize: 13, marginTop: 4 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  stat: { width: '48.2%', minHeight: 108, justifyContent: 'center', marginBottom: 10 },
  statLabel: { fontSize: 12, fontWeight: '600' },
  statValue: { fontSize: 25, fontWeight: '800', marginTop: 8 },
  statFoot: { fontSize: 10, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 10 },
  historyRow: { justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e3e4d9', paddingVertical: 11 },
  historyDate: { fontSize: 13 }, historyTotal: { fontSize: 14, fontWeight: '700' },
  emptyText: { fontSize: 13, lineHeight: 20 }, managerText: { fontSize: 14, lineHeight: 22 },
  role: { fontSize: 12, marginTop: 5 },
});