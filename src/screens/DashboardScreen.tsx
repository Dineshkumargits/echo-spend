import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { MotiView } from 'moti';
import { LucidePlus, LucideTrendingUp, LucideWallet, LucideSearch, LucidePieChart, LucideTarget, LucideLandmark, LucideRepeat } from 'lucide-react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store/useStore';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';

import {
  getTransactions,
  Transaction,
  getAccounts,
  Account,
  getCategories,
  Category,
  getCurrentMonthSpend,
  getGoals,
  Goal,
  getLoans,
  Loan,
  getSubscriptions,
  Subscription,
} from '../services/database';

const DashboardScreen = ({ navigation }: any) => {
  const { preferences } = useStore();
  const { colors, isDark } = useTheme();
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [upcoming, setUpcoming] = React.useState<any[]>([]);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const isFocused = useIsFocused();

  // CC outstanding is a liability — subtract it from net worth
  const totalBalance = useMemo(() =>
    accounts.reduce((sum, acc) =>
      acc.accountType === 'credit_card' ? sum - acc.balance : sum + acc.balance
    , 0),
    [accounts]
  );

  const budgetPct = useMemo(() =>
    preferences.monthlyBudget > 0
      ? Math.min((monthlySpend / preferences.monthlyBudget) * 100, 100)
      : 0,
    [monthlySpend, preferences.monthlyBudget]
  );

  const budgetBarColor = useMemo(() =>
    budgetPct >= 100 ? colors.danger : budgetPct >= 80 ? colors.warning : colors.accent,
    [budgetPct, colors]
  );

  const loadData = useCallback(async () => {
    const [txs, accs, cats, spend, gs, ls, ss] = await Promise.all([
      getTransactions({ limit: 15, confirmedOnly: true }),
      getAccounts(),
      getCategories(),
      getCurrentMonthSpend(preferences.salaryDay),
      getGoals(true),
      getLoans(true),
      getSubscriptions(true),
    ]);
    setTransactions(txs);
    setAccounts(accs);
    setCategories(cats);
    setMonthlySpend(spend);

    const now = new Date();
    const tenDays = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const up: any[] = [
      ...gs.filter((g: Goal) => g.deadline && new Date(g.deadline) <= tenDays).map((g: Goal) => ({ ...g, type: 'goal', date: g.deadline })),
      ...ls.filter((l: Loan) => new Date(l.nextDueDate) <= tenDays).map((l: Loan) => ({ ...l, type: 'loan', date: l.nextDueDate, name: l.lender })),
      ...ss.filter((s: Subscription) => new Date(s.nextDueDate) <= tenDays).map((s: Subscription) => ({ ...s, type: 'sub', date: s.nextDueDate })),
    ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

    setUpcoming(up);
  }, [preferences.salaryDay]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    await loadData();
    setRefreshing(false);
  }, [loadData, triggerHaptic]);

  React.useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused, loadData]);

  const formatAmount = useCallback((val: number) => {
    if (preferences.hideAmounts) return '****';
    return `${preferences.currency}${val.toLocaleString('en-IN')}`;
  }, [preferences.hideAmounts, preferences.currency]);

  const triggerHaptic = useCallback((style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences.hapticsEnabled) Haptics.impactAsync(style);
  }, [preferences.hapticsEnabled]);

  // Memoize category lookup map to avoid O(n) find on every transaction row render
  const categoryMap = useMemo(() =>
    new Map(categories.map(c => [c.name, c])),
    [categories]
  );

  const styles = useMemo(() => createStyles(), []);

  const renderTransaction = useCallback(({ item }: { item: Transaction }) => {
    const cat = categoryMap.get(item.category);
    return (
      <TouchableOpacity
        onPress={() => {
          triggerHaptic();
          navigation.navigate('TransactionDetail', { transaction: item });
        }}
        style={[styles.txRow, { borderBottomColor: colors.border }]}
      >
        <View
          style={[styles.txIcon, { backgroundColor: `${cat?.color || colors.secondary}20` }]}
        >
          {renderCategoryIcon(cat?.icon ?? '📁', cat?.color || colors.secondary, 20)}
        </View>
        <View style={styles.txMid}>
          <ThemedText className="font-bold" numberOfLines={1}>{item.merchant}</ThemedText>
          <ThemedText type="secondary" className="text-xs mt-0.5" numberOfLines={1}>
            {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            {' · '}{new Date(item.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            {' · '}{item.category}
            {item.tags && item.tags.length > 0 ? ` · ${item.tags.map((t: string) => '#' + t).join(' ')}` : ''}
          </ThemedText>
        </View>
        <ThemedText
          className="font-bold"
          style={{ color: item.type === 'transfer' ? colors.warning : (item.type === 'credit' ? colors.success : colors.primary) }}
        >
          {item.type === 'credit' ? '+' : (item.type === 'transfer' ? '⇄' : '-')}{formatAmount(item.amount)}
        </ThemedText>
      </TouchableOpacity>
    );
  }, [categoryMap, colors, navigation, triggerHaptic, formatAmount, styles]);

  return (
    <ThemedSafeAreaView>
      <ScrollView 
        className="flex-1 px-6" 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={onRefresh} 
            colors={[colors.accent]} 
            tintColor={colors.accent} 
          />
        }
      >
        {/* Header */}
        <View className="mt-4 mb-6 flex-row justify-between items-center">
          <MotiView
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600 }}
          >
            <ThemedText type="secondary" className="text-sm uppercase tracking-widest">Dashboard</ThemedText>
            <ThemedText className="text-3xl font-bold">Summary</ThemedText>
          </MotiView>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                navigation.navigate('Analytics');
              }}
              className="w-10 h-10 rounded-full items-center justify-center border"
              style={{ backgroundColor: colors.translucent, borderColor: colors.border }}
            >
              <LucidePieChart color={colors.primary} size={20} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                navigation.navigate('Search');
              }}
              className="w-10 h-10 rounded-full items-center justify-center border"
              style={{ backgroundColor: colors.translucent, borderColor: colors.border }}
            >
              <LucideSearch color={colors.primary} size={20} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Net Worth */}
        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-8"
        >
          <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-1">Net Worth</ThemedText>
          <ThemedText className="text-4xl font-bold">
            {totalBalance < 0 ? '-' : ''}{formatAmount(Math.abs(totalBalance))}
          </ThemedText>
          <ThemedText type="secondary" className="text-xs mt-1">
            across {accounts.length} account{accounts.length !== 1 ? 's' : ''}
          </ThemedText>
        </MotiView>

        {/* Accounts */}
        <View className="mb-8">
          <View className="flex-row justify-between items-center mb-4">
            <ThemedText className="text-xl font-bold">Linked Accounts</ThemedText>
            <TouchableOpacity onPress={() => navigation.navigate('ManageAccounts')}>
              <ThemedText className="text-sm font-bold" style={{ color: colors.accent }}>View All</ThemedText>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-6 px-6"
            contentContainerStyle={{ paddingRight: 40 }}
          >
            {accounts.map(acc => (
              <MotiView
                key={acc.id}
                from={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="px-0 py-0 rounded-apple-lg mr-4 w-44 overflow-hidden border"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate('BankAccountDetail', { accountId: acc.id });
                  }}
                  className="p-4"
                >
                  <View className="flex-row justify-between items-start mb-5">
                    <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: `${colors.accent}20` }}>
                      <LucideWallet color={colors.accent} size={16} />
                    </View>
                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.border }}>
                      <ThemedText type="secondary" className="text-[9px] font-bold uppercase">
                        {acc.accountType?.replace('_', ' ') || 'bank'}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="secondary" className="text-xs font-medium" numberOfLines={1}>{acc.name}</ThemedText>
                  <ThemedText className="text-lg font-bold mt-1">
                    {acc.accountType === 'credit_card' ? '-' : ''}{formatAmount(acc.balance)}
                  </ThemedText>
                </TouchableOpacity>
              </MotiView>
            ))}

            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                navigation.navigate('AddAccount');
              }}
              className="p-4 rounded-apple-lg w-44 items-center justify-center border"
              style={{ backgroundColor: colors.translucent, borderStyle: 'dashed', borderColor: colors.secondary }}
            >
              <LucidePlus color={colors.primary} size={24} />
              <ThemedText type="secondary" className="text-xs mt-2 font-medium">Add Account</ThemedText>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Monthly Spend Card */}
        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-6 rounded-apple-md mb-8 border"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
        >
          <View className="flex-row justify-between items-center mb-3">
            <ThemedText type="secondary" className="text-sm">Cycle Spending</ThemedText>
            <LucideTrendingUp color={budgetBarColor} size={20} />
          </View>
          <ThemedText className="text-4xl font-bold">
            {formatAmount(monthlySpend)}
          </ThemedText>

          <View className="mt-5">
            <View className="flex-row justify-between mb-1.5">
              <ThemedText type="secondary" className="text-xs">
                Budget (Starts Day {preferences.salaryDay})
              </ThemedText>
              <ThemedText className="text-xs font-bold" style={{ color: budgetBarColor }}>
                {formatAmount(preferences.monthlyBudget)}
              </ThemedText>
            </View>
            <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
              <View
                className="h-full rounded-full"
                style={{ backgroundColor: budgetBarColor, width: `${budgetPct}%` }}
              />
            </View>
            {budgetPct >= 80 && (
              <ThemedText className="text-xs mt-1.5 font-bold" style={{ color: budgetBarColor }}>
                {budgetPct >= 100
                  ? `Over budget`
                  : `${Math.round(budgetPct)}% used`}
              </ThemedText>
            )}
          </View>
        </MotiView>

        {/* Upcoming Section */}
        {upcoming.length > 0 && (
          <View className="mb-8">
            <ThemedText className="text-xl font-bold mb-4">Upcoming Commitments</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-6 px-6">
              {upcoming.map((item, idx) => (
                <MotiView
                  key={idx}
                  from={{ opacity: 0, translateX: 20 }}
                  animate={{ opacity: 1, translateX: 0 }}
                  className="p-4 rounded-apple-md mr-3 w-56 border"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  <View className="flex-row items-center mb-3">
                    <View
                      className="w-8 h-8 rounded-full items-center justify-center mr-2"
                      style={{ backgroundColor: item.type === 'goal' ? '#34C75920' : (item.type === 'loan' ? '#FF950020' : '#5AC8FA20') }}
                    >
                      {item.type === 'goal' ? <LucideTarget color="#34C759" size={14} /> :
                        item.type === 'loan' ? <LucideLandmark color="#FF9500" size={14} /> :
                          <LucideRepeat color="#5AC8FA" size={14} />}
                    </View>
                    <ThemedText type="secondary" className="text-[10px] font-bold uppercase tracking-tighter">
                      {item.type === 'goal' ? 'Goal' : item.type === 'loan' ? 'EMI' : 'Subscription'}
                    </ThemedText>
                  </View>
                  <ThemedText className="font-bold" numberOfLines={1}>{item.name}</ThemedText>
                  <View className="flex-row justify-between items-end mt-2">
                    <View>
                      <ThemedText className="text-xs">{new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</ThemedText>
                    </View>
                    <ThemedText className="font-bold text-sm">
                      {formatAmount(item.amount || item.emiAmount || 0)}
                    </ThemedText>
                  </View>
                </MotiView>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Recent Transactions */}
        <View className="mb-24">
          <View className="flex-row justify-between items-end mb-4">
            <View>
              <ThemedText className="text-xl font-bold">Recent Spends</ThemedText>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Txns')}>
              <ThemedText className="text-sm" style={{ color: colors.accent }}>View All</ThemedText>
            </TouchableOpacity>
          </View>

          <View style={{ height: 400 }}>
            <FlashList
              data={transactions}
              keyExtractor={item => item.id.toString()}
              renderItem={renderTransaction}
              contentContainerStyle={{ paddingBottom: 16 }}
              ListEmptyComponent={
                <View className="pt-12 items-center">
                  <ThemedText type="secondary">No transactions yet.</ThemedText>
                </View>
              }
            />
          </View>
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate('AddTransaction');
        }}
        className="absolute bottom-8 right-6 w-16 h-16 rounded-full items-center justify-center"
        activeOpacity={0.85}
        style={{ elevation: 8, backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }}
      >
        <LucidePlus color={isDark ? "#000000" : "#FFFFFF"} size={32} />
      </TouchableOpacity>

    </ThemedSafeAreaView>
  );
};

const createStyles = () =>
  StyleSheet.create({
    txRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    txIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 12,
    },
    txMid: {
      flex: 1,
      marginRight: 12,
    },
  });

export default DashboardScreen;
