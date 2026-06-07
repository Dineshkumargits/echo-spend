import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Modal } from 'react-native';
import { MotiView } from 'moti';
import {
  LucidePlus, LucideTrendingUp, LucideWallet, LucideSearch,
  LucidePieChart, LucideTarget, LucideLandmark, LucideRepeat,
  LucideBrain, LucidePlay, LucidePause, LucideX, LucideRefreshCcw,
  LucideSparkles,
} from 'lucide-react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store/useStore';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import { AIModelManager } from '../services/aiModelManager';
import AIModelSetupStep from './AIModelSetupStep';
import { TourGuideModal } from '../components/TourGuideModal';

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
  getSplits,
} from '../services/database';

const DashboardScreen = ({ navigation }: any) => {
  const {
    preferences,
    aiModelStatus,
    aiModelNudgeDismissed,
    setAiModelNudgeDismissed,
    aiModelProgress,
    aiModelError,
  } = useStore();
  const { colors, isDark } = useTheme();
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [upcoming, setUpcoming] = React.useState<any[]>([]);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showTour, setShowTour] = useState(false);
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

  const triggerHaptic = useCallback((style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences.hapticsEnabled) Haptics.impactAsync(style);
  }, [preferences.hapticsEnabled]);

  const formatAmount = useCallback((val: number) => {
    if (preferences.hideAmounts) return '****';
    return `${preferences.currency}${val.toLocaleString('en-IN')}`;
  }, [preferences.hideAmounts, preferences.currency]);

  const getDaysLeft = (date: string) => {
    const diff = new Date(date).getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return 'Overdue';
    return `${days} days left`;
  };

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
  }, [preferences.salaryDay, preferences.currency, preferences.hideAmounts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    await loadData();
    setRefreshing(false);
  }, [loadData, triggerHaptic]);

  React.useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused, loadData]);

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
                setShowTour(true);
              }}
              className="w-10 h-10 rounded-full items-center justify-center border"
              style={{ backgroundColor: colors.translucent, borderColor: colors.border }}
            >
              <LucideSparkles color={colors.accent} size={18} />
            </TouchableOpacity>
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

        {/* AI Setup Nudge Card */}
        {((!aiModelNudgeDismissed && aiModelStatus === 'not_downloaded') ||
          aiModelStatus === 'downloading' ||
          aiModelStatus === 'paused' ||
          aiModelStatus === 'error') && AIModelManager.isDeviceCompatible() && (
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-5 rounded-apple-md mb-8 border flex-row gap-4"
            style={{ backgroundColor: `${colors.accent}12`, borderColor: `${colors.accent}30` }}
          >
            <View className="w-10 h-10 rounded-xl items-center justify-center flex-shrink-0" style={{ backgroundColor: `${colors.accent}25` }}>
              <LucideBrain color={colors.accent} size={20} />
            </View>
            <View className="flex-1">
              {aiModelStatus === 'not_downloaded' && (
                <>
                  <ThemedText className="font-bold text-sm">Unlock Smart SMS Scanning</ThemedText>
                  <ThemedText type="secondary" className="text-xs mt-1 leading-5">
                    Download the local AI engine to enable automatic transaction classification. Everything runs 100% privately on your device.
                  </ThemedText>
                  <View className="flex-row gap-4 mt-4">
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic();
                        setShowSetupModal(true);
                      }}
                      className="px-4 py-2 rounded-lg bg-accent"
                    >
                      <ThemedText className="text-white font-bold text-xs">Setup AI</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic();
                        setAiModelNudgeDismissed(true);
                      }}
                      className="px-4 py-2 rounded-lg border"
                      style={{ borderColor: colors.border }}
                    >
                      <ThemedText type="secondary" className="font-bold text-xs">Dismiss</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {aiModelStatus === 'downloading' && (
                <>
                  <ThemedText className="font-bold text-sm">Downloading local AI Engine...</ThemedText>
                  <View className="mt-3">
                    <View style={{ width: '100%', height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
                      <MotiView
                        animate={{ width: `${aiModelProgress}%` }}
                        transition={{ type: 'timing', duration: 300 }}
                        style={{ height: '100%', borderRadius: 3, backgroundColor: colors.accent }}
                      />
                    </View>
                    <View className="flex-row justify-between mt-1.5">
                      <ThemedText type="secondary" className="text-[10px]">Downloading...</ThemedText>
                      <ThemedText className="font-bold text-[10px]" style={{ color: colors.accent }}>{aiModelProgress}%</ThemedText>
                    </View>
                  </View>
                  <View className="flex-row gap-4 mt-4">
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic();
                        AIModelManager.pauseDownload();
                      }}
                      className="px-4 py-2 rounded-lg bg-accent flex-row items-center gap-1.5"
                    >
                      <LucidePause color="#fff" size={12} />
                      <ThemedText className="text-white font-bold text-xs">Pause</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                        AIModelManager.cancelDownload();
                      }}
                      className="px-4 py-2 rounded-lg border flex-row items-center gap-1.5"
                      style={{ borderColor: colors.border }}
                    >
                      <LucideX color={colors.secondary} size={12} />
                      <ThemedText type="secondary" className="font-bold text-xs">Cancel</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {aiModelStatus === 'paused' && (
                <>
                  <ThemedText className="font-bold text-sm">AI Download Paused</ThemedText>
                  <ThemedText type="secondary" className="text-xs mt-1">
                    Progress: {aiModelProgress}%
                  </ThemedText>
                  <View className="mt-3">
                    <View style={{ width: '100%', height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
                      <MotiView
                        animate={{ width: `${aiModelProgress}%` }}
                        transition={{ type: 'timing', duration: 300 }}
                        style={{ height: '100%', borderRadius: 3, backgroundColor: colors.secondary }}
                      />
                    </View>
                  </View>
                  <View className="flex-row gap-4 mt-4">
                    <TouchableOpacity
                      onPress={async () => {
                        triggerHaptic();
                        try {
                          await AIModelManager.downloadModel();
                        } catch (err) {
                          console.error('Resume download failed:', err);
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-accent flex-row items-center gap-1.5"
                    >
                      <LucidePlay color="#fff" size={12} />
                      <ThemedText className="text-white font-bold text-xs">Resume</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                        AIModelManager.cancelDownload();
                      }}
                      className="px-4 py-2 rounded-lg border flex-row items-center gap-1.5"
                      style={{ borderColor: colors.border }}
                    >
                      <LucideX color={colors.secondary} size={12} />
                      <ThemedText type="secondary" className="font-bold text-xs">Cancel</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {aiModelStatus === 'error' && (
                <>
                  <ThemedText className="font-bold text-sm" style={{ color: colors.danger }}>AI Download Failed</ThemedText>
                  <ThemedText type="secondary" className="text-xs mt-1">
                    {aiModelProgress > 0 ? `Failed at ${aiModelProgress}%. ` : ''}{aiModelError || 'Please check your connection and try again.'}
                  </ThemedText>
                  <View className="flex-row gap-4 mt-4">
                    <TouchableOpacity
                      onPress={async () => {
                        triggerHaptic();
                        try {
                          await AIModelManager.downloadModel();
                        } catch (err) {
                          console.error('Retry download failed:', err);
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-accent flex-row items-center gap-1.5"
                    >
                      <LucideRefreshCcw color="#fff" size={12} />
                      <ThemedText className="text-white font-bold text-xs">Retry</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                        AIModelManager.cancelDownload();
                      }}
                      className="px-4 py-2 rounded-lg border flex-row items-center gap-1.5"
                      style={{ borderColor: colors.border }}
                    >
                      <LucideX color={colors.secondary} size={12} />
                      <ThemedText type="secondary" className="font-bold text-xs">Cancel</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </MotiView>
        )}

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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="-mx-6 px-6"
              contentContainerStyle={{ paddingRight: 40 }}
            >
              {upcoming.map((item, idx) => {
                const color = item.type === 'goal' ? '#34C759' : (item.type === 'loan' ? '#FF9500' : '#5AC8FA');
                const daysLeft = getDaysLeft(item.date);
                const isOverdue = daysLeft === 'Overdue';

                return (
                  <MotiView
                    key={idx}
                    from={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-4 rounded-apple-md mr-3 w-60 border overflow-hidden"
                    style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                  >
                    {/* Left Accent Strip */}
                    <View
                      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: color }}
                    />

                    <View className="flex-row justify-between items-start mb-3">
                      <View className="flex-row items-center">
                        <View
                          className="w-7 h-7 rounded-full items-center justify-center mr-2"
                          style={{ backgroundColor: `${color}20` }}
                        >
                          {item.type === 'goal' ? <LucideTarget color={color} size={14} /> :
                            item.type === 'loan' ? <LucideLandmark color={color} size={14} /> :
                              <LucideRepeat color={color} size={14} />}
                        </View>
                        <ThemedText type="secondary" className="text-[10px] font-bold uppercase tracking-tight">
                          {item.type === 'goal' ? 'Goal' : item.type === 'loan' ? 'EMI' : 'Subscription'}
                        </ThemedText>
                      </View>
                      <View className={`px-2 py-0.5 rounded-full ${isOverdue ? 'bg-red-500/10' : 'bg-gray-500/10'}`}>
                        <ThemedText style={{ color: isOverdue ? colors.danger : colors.secondary }} className="text-[9px] font-bold">
                          {daysLeft}
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText className="font-bold text-sm" numberOfLines={1}>{item.name}</ThemedText>

                    <View className="flex-row justify-between items-end mt-3">
                      <ThemedText type="secondary" className="text-xs">
                        {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </ThemedText>
                      <ThemedText className="font-bold text-base" style={{ color: colors.primary }}>
                        {formatAmount(item.amount || item.emiAmount || 0)}
                      </ThemedText>
                    </View>
                  </MotiView>
                );
              })}
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

          <View className="space-y-1">
            {transactions.slice(0, 10).map((tx) => (
              <React.Fragment key={tx.id}>
                {renderTransaction({ item: tx })}
              </React.Fragment>
            ))}
            {transactions.length === 0 && (
              <View className="pt-12 items-center">
                <ThemedText type="secondary">No transactions yet.</ThemedText>
              </View>
            )}
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

      {/* AI Setup Modal */}
      <Modal
        visible={showSetupModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSetupModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <AIModelSetupStep
            showClose
            onComplete={() => setShowSetupModal(false)}
          />
        </View>
      </Modal>

      {/* Tour Guide Modal */}
      <TourGuideModal
        visible={showTour}
        onClose={() => setShowTour(false)}
      />

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
