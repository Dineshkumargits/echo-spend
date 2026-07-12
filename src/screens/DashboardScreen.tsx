import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useCallback, useMemo, useState, useRef } from 'react';
import { View, ScrollView, TouchableOpacity, Pressable, RefreshControl, Modal } from 'react-native';
import { MotiView } from 'moti';
import {
  LucidePlus, LucideWallet, LucideSearch,
  LucidePieChart, LucideTarget, LucideLandmark, LucideRepeat,
  LucideBrain, LucideDownload, LucideX, LucideRefreshCcw,
  LucideSparkles, LucideCreditCard, LucideCoins,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store/useStore';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import { AIModelManager } from '../services/aiModelManager';
import AIModelSetupStep from './AIModelSetupStep';
import { TourGuideModal } from '../components/TourGuideModal';
import { PulseDot, AmountText, SectionLabel, CycleBar, WaveformBar, WavePoint, ResonanceRings } from '../components/Signal';
import { fonts, formatINR } from '../theme/tokens';
import { SignalRow, IconTile, Card } from '../components/Kit';
import { useAIInsights } from '../hooks/useAIInsights';

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
  getUnconfirmedTransactions,
  getSpendTrend,
  SpendTrendPoint,
  getCategoryBreakdown,
  CategoryBreakdown,
  getBudgetUtilization,
  Budget,
  getPendingSplitMembers,
  PendingSplitMember,
  getActiveInsights,
  dismissInsight,
  Insight,
  getLastScanTime,
} from '../services/database';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const timeGreeting = (): string => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

/** Relative time: just now / Nm ago / Nh ago / Nd ago / never */
const relativeTime = (iso: string | null): string => {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const timeOnly = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};

// ─── DashboardScreen ─────────────────────────────────────────────────────────

const DashboardScreen = ({ navigation }: any) => {
  const {
    preferences,
    aiModelStatus,
    aiModelNudgeDismissed,
    setAiModelNudgeDismissed,
    aiModelProgress,
    aiModelError,
    googleUser,
    lastSynced,
  } = useStore();
  const { colors, isDark } = useTheme();
  const { generateInsights } = useAIInsights();

  // ── Existing state ──────────────────────────────────────────────────────────
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [upcoming, setUpcoming] = React.useState<any[]>([]);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [unconfirmedCount, setUnconfirmedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const isFocused = useIsFocused();

  // ── New state (§4) ──────────────────────────────────────────────────────────
  const [trend14, setTrend14] = useState<SpendTrendPoint[]>([]);
  const [topCategories, setTopCategories] = useState<CategoryBreakdown[]>([]);
  const [budgetWatch, setBudgetWatch] = useState<{ budget: Budget; spent: number; percentage: number }[]>([]);
  const [pendingSplits, setPendingSplits] = useState<PendingSplitMember[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const insightGenGuard = useRef(false);
  const celebratedGoals = useRef<Set<number>>(new Set());
  const [celebrationTrigger, setCelebrationTrigger] = useState(0);

  const currency = preferences.currency ?? '₹';

  // ── Derived values ──────────────────────────────────────────────────────────
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

  const safeToSpend = useMemo(
    () => preferences.monthlyBudget - monthlySpend,
    [preferences.monthlyBudget, monthlySpend]
  );

  const daysLeftInCycle = useMemo(() => {
    const now = new Date();
    const next = now.getDate() >= preferences.salaryDay
      ? new Date(now.getFullYear(), now.getMonth() + 1, preferences.salaryDay)
      : new Date(now.getFullYear(), now.getMonth(), preferences.salaryDay);
    return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 86400000));
  }, [preferences.salaryDay]);

  const triggerHaptic = useCallback((style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences.hapticsEnabled) Haptics.impactAsync(style);
  }, [preferences.hapticsEnabled]);

  const formatAmount = useCallback((val: number) => {
    if (preferences.hideAmounts) return '****';
    return `${currency}${val.toLocaleString('en-IN')}`;
  }, [preferences.hideAmounts, currency]);

  const getDaysLeft = (date: string) => {
    const diff = new Date(date).getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return 'Overdue';
    return `${days} days left`;
  };

  // ── Data loading (§4) ───────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [
      txs, accs, cats, spend, gs, ls, ss, unconfirmed,
      trendData, catBreakdown, budgetUtil, splits, activeInsights, scanTime,
    ] = await Promise.all([
      getTransactions({ limit: 15, confirmedOnly: true }),
      getAccounts(),
      getCategories(),
      getCurrentMonthSpend(preferences.salaryDay),
      getGoals(true),
      getLoans(true),
      getSubscriptions(true),
      getUnconfirmedTransactions(),
      getSpendTrend(14),
      getCategoryBreakdown(),
      getBudgetUtilization(preferences.salaryDay),
      getPendingSplitMembers(),
      getActiveInsights(),
      getLastScanTime(),
    ]);
    setTransactions(txs);
    setAccounts(accs);
    setCategories(cats);
    setMonthlySpend(spend);
    setUnconfirmedCount(unconfirmed.length);
    setTrend14(trendData);
    setTopCategories(catBreakdown);
    setBudgetWatch(budgetUtil);
    setPendingSplits(splits);
    setInsights(activeInsights);
    setLastScanAt(scanTime);
    setGoals(gs);

    const now = new Date();
    const tenDays = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const up: any[] = [
      ...gs.filter((g: Goal) => g.deadline && new Date(g.deadline) <= tenDays).map((g: Goal) => ({ ...g, type: 'goal', date: g.deadline })),
      ...ls.filter((l: Loan) => new Date(l.nextDueDate) <= tenDays).map((l: Loan) => ({ ...l, type: 'loan', date: l.nextDueDate, name: l.lender })),
      ...ss.filter((s: Subscription) => new Date(s.nextDueDate) <= tenDays).map((s: Subscription) => ({ ...s, type: 'sub', date: s.nextDueDate })),
    ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

    setUpcoming(up);

    // §3.6 Insight freshness: generate once per mount if stale
    if (!insightGenGuard.current && txs.length > 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      const newestInsightDate = activeInsights[0]?.generatedAt?.split('T')[0];
      if (!newestInsightDate || newestInsightDate !== todayStr) {
        insightGenGuard.current = true;
        generateInsights().then(fresh => setInsights(fresh)).catch(() => {});
      }
    }

    // §3.13 Celebration hook
    for (const g of gs) {
      if (g.currentAmount >= g.targetAmount && !celebratedGoals.current.has(g.id)) {
        celebratedGoals.current.add(g.id);
        setCelebrationTrigger(t => t + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    }
  }, [preferences.salaryDay, preferences.currency, preferences.hideAmounts, generateInsights]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    await loadData();
    setRefreshing(false);
  }, [loadData, triggerHaptic]);

  React.useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused, loadData]);

  // ── Memos ───────────────────────────────────────────────────────────────────
  const categoryMap = useMemo(() =>
    new Map(categories.map(c => [c.name, c])),
    [categories]
  );

  const accountMap = useMemo(() =>
    new Map(accounts.map(a => [a.id, a.name])),
    [accounts]
  );

  // §3.9 Group recent transactions
  const groupedTransactions = useMemo(() => {
    const todayKey = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toDateString();

    const groups: { label: string; items: Transaction[] }[] = [];
    for (const tx of transactions.slice(0, 10)) {
      const key = new Date(tx.date).toDateString();
      const label = key === todayKey ? 'Today' : key === yesterdayKey ? 'Yesterday' : 'Earlier';
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(tx);
      else groups.push({ label, items: [tx] });
    }
    return groups;
  }, [transactions]);

  // §3.3 Waveform data
  const waveData = useMemo<WavePoint[]>(() =>
    trend14.map(p => ({ value: p.total, kind: (p.total > 0 ? 'out' : 'faint') as WavePoint['kind'] })),
    [trend14]
  );
  const wavePeak = useMemo(() => Math.max(...trend14.map(p => p.total), 0), [trend14]);

  // §3.5 Pulse strip
  const todaySpend = useMemo(() => trend14.length > 0 ? trend14[trend14.length - 1].total : 0, [trend14]);
  const biggestPulse = useMemo(() => {
    const debits = transactions.filter(t => t.type === 'debit');
    if (debits.length === 0) return null;
    return debits.reduce((max, t) => t.amount > max.amount ? t : max, debits[0]);
  }, [transactions]);

  // §3.7 Budget watch — top 3, only if any ≥ 60%
  const budgetWatchFiltered = useMemo(() => {
    const sorted = [...budgetWatch].sort((a, b) => b.percentage - a.percentage);
    const top3 = sorted.slice(0, 3);
    return top3.some(b => b.percentage >= 60) ? top3 : [];
  }, [budgetWatch]);

  // §3.8 Owed total
  const owedTotal = useMemo(() =>
    pendingSplits.reduce((sum, m) => sum + Math.max(0, m.memberShare - m.memberPaidAmount), 0),
    [pendingSplits]
  );
  const owedCount = useMemo(() => {
    const names = new Set(pendingSplits.map(m => m.memberName));
    return names.size;
  }, [pendingSplits]);

  // §3.9 Account label helper (same as TransactionsScreen)
  const getAccountLabel = useCallback((item: Transaction): string => {
    if (item.type === 'transfer') {
      const from = item.accountId != null ? accountMap.get(item.accountId) : undefined;
      const to = item.toAccountId != null ? accountMap.get(item.toAccountId) : undefined;
      const parts = [from, to].filter((v): v is string => !!v);
      return parts.length > 0 ? ` · ${parts.join(' → ')}` : '';
    }
    if (item.accountId != null) {
      const name = accountMap.get(item.accountId);
      return name ? ` · ${name}` : '';
    }
    return '';
  }, [accountMap]);

  const amountKind = (item: Transaction): 'debit' | 'credit' | 'transfer' =>
    item.type === 'credit' ? 'credit' : item.type === 'transfer' ? 'transfer' : 'debit';

  // §3.6 Dismiss insight handler
  const handleDismissInsight = useCallback(async (id: number) => {
    await dismissInsight(id);
    setInsights(prev => prev.filter(i => i.id !== id));
  }, []);

  // ── Greeting ────────────────────────────────────────────────────────────────
  const greetingBase = useMemo(() => timeGreeting(), []);
  const firstName = useMemo(() => googleUser?.name?.split(' ')[0], [googleUser]);

  // ── Account icon helper ─────────────────────────────────────────────────────
  const accountIcon = (type: string | undefined) => {
    switch (type) {
      case 'credit_card': return <LucideCreditCard color={colors.accent} size={16} />;
      case 'cash': return <LucideCoins color={colors.accent} size={16} />;
      case 'wallet': return <LucideWallet color={colors.accent} size={16} />;
      case 'bank': default: return <LucideLandmark color={colors.accent} size={16} />;
    }
  };

  // ─── Main render ──────────────────────────────────────────────────────────

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
        {/* §3.1 Header — personal greeting */}
        <View style={{ marginTop: 16, marginBottom: 20 }}>
          {/* Top row: brand label + action icons (full width, no overflow) */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionLabel>Echo Spend</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TouchableOpacity
                onPress={() => { triggerHaptic(); setShowTour(true); }}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
              >
                <LucideSparkles color={colors.ai} size={16} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { triggerHaptic(); navigation.navigate('Analytics'); }}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
              >
                <LucidePieChart color={colors.secondary} size={17} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { triggerHaptic(); navigation.navigate('Search'); }}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
              >
                <LucideSearch color={colors.secondary} size={17} />
              </TouchableOpacity>
            </View>
          </View>
          {/* Greeting + name below, spanning full width so long names never overflow */}
          <MotiView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
          >
            {firstName ? (
              <>
                <ThemedText font="signal" type="secondary" style={{ fontSize: 13, marginTop: 10, letterSpacing: 0.3 }}>
                  {greetingBase}
                </ThemedText>
                <ThemedText
                  font="display"
                  style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 32, marginTop: 2 }}
                  numberOfLines={2}
                >
                  {firstName}
                </ThemedText>
              </>
            ) : (
              <ThemedText
                font="display"
                style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 32, marginTop: 10 }}
                numberOfLines={2}
              >
                {greetingBase}
              </ThemedText>
            )}
          </MotiView>
        </View>

        {/* §3.2 Hero: Safe to Spend + daily pace line */}
        <MotiView
          from={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ marginBottom: 24 }}
        >
          {/* §3.2 Net worth hero */}
          <SectionLabel color={totalBalance < 0 ? colors.danger : colors.accent}>Net worth</SectionLabel>
          <ThemedText
            font="display"
            style={{
              fontFamily: fonts.displayBold,
              fontSize: 44,
              lineHeight: 52,
              marginTop: 6,
              color: totalBalance < 0 ? colors.danger : colors.primary,
              fontVariant: ['tabular-nums'],
            }}
          >
            {totalBalance < 0 ? '−' : ''}{formatAmount(Math.abs(totalBalance))}
          </ThemedText>

          {/* Cycle progress bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 10 }}>
            <CycleBar
              pct={budgetPct}
              color={budgetPct >= 100 ? colors.danger : undefined}
              style={{ flex: 1 }}
            />
            <ThemedText font="signal" style={{ fontSize: 10, color: colors.secondary }}>
              {daysLeftInCycle}d left
            </ThemedText>
          </View>

          {/* §3.2 Safe to spend — below the bar */}
          {preferences.monthlyBudget > 0 ? (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <SectionLabel color={safeToSpend < 0 ? colors.danger : colors.accent}>
                  {safeToSpend < 0 ? 'Over budget · till day ' + preferences.salaryDay : 'Safe to spend · till day ' + preferences.salaryDay}
                </SectionLabel>
                <ThemedText
                  font="signal"
                  style={{ fontFamily: fonts.signalBold, fontSize: 15, color: safeToSpend < 0 ? colors.danger : colors.primary, fontVariant: ['tabular-nums'] }}
                >
                  {safeToSpend < 0 ? '−' : ''}{formatAmount(Math.abs(safeToSpend))}
                </ThemedText>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <ThemedText font="signal" style={{ fontSize: 10, color: colors.secondary }}>
                  spent {preferences.hideAmounts ? '••••' : formatAmount(monthlySpend)}
                  {` of ${preferences.hideAmounts ? '••••' : formatAmount(preferences.monthlyBudget)}`}
                </ThemedText>
                {daysLeftInCycle > 0 && (
                  <ThemedText font="signal" style={{ fontSize: 10, color: safeToSpend < 0 ? colors.danger : colors.secondary }}>
                    {safeToSpend < 0
                      ? `over by ${preferences.hideAmounts ? '••••' : `${currency}${formatINR(Math.abs(safeToSpend))}`} · resets in ${daysLeftInCycle}d`
                      : `${preferences.hideAmounts ? '••••' : `${currency}${formatINR(Math.floor(safeToSpend / daysLeftInCycle))}`}/day · ${daysLeftInCycle}d left`
                    }
                  </ThemedText>
                )}
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <SectionLabel color={colors.accent}>Cycle spending · from day {preferences.salaryDay}</SectionLabel>
              <ThemedText
                font="signal"
                style={{ fontFamily: fonts.signalBold, fontSize: 15, color: colors.primary, fontVariant: ['tabular-nums'] }}
              >
                {formatAmount(monthlySpend)}
              </ThemedText>
            </View>
          )}
        </MotiView>

        {/* §3.10 Accounts — restyled on kit */}
        <View style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <SectionLabel>Linked accounts</SectionLabel>
            <TouchableOpacity onPress={() => navigation.navigate('ManageAccounts')}>
              <ThemedText style={{ fontSize: 12, fontFamily: fonts.textSemibold, color: colors.accent }}>Manage</ThemedText>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -24 }}
            contentContainerStyle={{ paddingHorizontal: 24, paddingRight: 64 }}
          >
            {accounts.map((acc, idx) => (
              <MotiView
                key={acc.id}
                from={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'timing', duration: 240, delay: idx * 40 }}
                style={{ marginRight: 12, width: 176 }}
              >
                <Card
                  onPress={() => { triggerHaptic(); navigation.navigate('BankAccountDetail', { accountId: acc.id }); }}
                  style={{ padding: 16 }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <IconTile color={colors.accent} size={32}>
                      {accountIcon(acc.accountType)}
                    </IconTile>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: colors.translucent }}>
                      <ThemedText font="signal" type="secondary" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>
                        {acc.accountType?.replace('_', ' ') || 'bank'}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="secondary" style={{ fontSize: 12 }} numberOfLines={1}>{acc.name}</ThemedText>
                  <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, marginTop: 4, color: acc.accountType === 'credit_card' ? colors.debit : colors.primary, fontVariant: ['tabular-nums'] }}>
                    {acc.accountType === 'credit_card' ? '−' : ''}{preferences.hideAmounts ? '••••' : `${currency}${formatINR(acc.balance)}`}
                  </ThemedText>
                </Card>
              </MotiView>
            ))}

            <TouchableOpacity
              onPress={() => { triggerHaptic(); navigation.navigate('AddAccount'); }}
              style={{ padding: 16, borderRadius: 20, width: 176, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.secondary, backgroundColor: colors.translucent }}
            >
              <LucidePlus color={colors.primary} size={24} />
              <ThemedText type="secondary" style={{ fontSize: 12, marginTop: 8 }}>Add Account</ThemedText>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* §3.4 Smart Inbox pulse chip — unchanged */}
        {unconfirmedCount > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={{ marginBottom: 24 }}
          >
            <TouchableOpacity
              onPress={() => { triggerHaptic(); navigation.navigate('SmartInbox'); }}
              activeOpacity={0.8}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 14, borderWidth: 1, backgroundColor: colors.surface, borderColor: colors.border, gap: 12 }}
            >
              <PulseDot />
              <ThemedText style={{ flex: 1, fontFamily: fonts.textSemibold, fontSize: 14 }}>
                {unconfirmedCount} signal{unconfirmedCount !== 1 ? 's' : ''} awaiting review
              </ThemedText>
              <ThemedText style={{ color: colors.secondary, fontSize: 16 }}>→</ThemedText>
            </TouchableOpacity>
          </MotiView>
        )}

        {/* §3.7 Budget watch mini */}
        {budgetWatchFiltered.length > 0 && (
          <Pressable
            onPress={() => { triggerHaptic(); navigation.navigate('Budget'); }}
            style={{ marginBottom: 24 }}
          >
            <SectionLabel style={{ marginBottom: 10 }}>Budget watch</SectionLabel>
            {budgetWatchFiltered.map(item => {
              const barColor = item.percentage >= 100 ? colors.danger : item.percentage >= 80 ? colors.debit : colors.credit;
              return (
                <View key={item.budget.id} style={{ marginBottom: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 13 }} numberOfLines={1}>{item.budget.categoryName}</ThemedText>
                    <ThemedText font="signal" style={{ fontSize: 11, color: barColor, fontFamily: fonts.signalBold }}>{item.percentage}%</ThemedText>
                  </View>
                  <CycleBar pct={item.percentage} color={barColor} height={4} />
                </View>
              );
            })}
          </Pressable>
        )}

        {/* §3.8 Owed to you */}
        {pendingSplits.length > 0 && owedTotal > 0 && (
          <Card
            onPress={() => { triggerHaptic(); navigation.navigate('Finances', { initialTab: 'splits' }); }}
            style={{ marginBottom: 24, padding: 16 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <IconTile emoji="🤝" color={colors.credit} size={40} />
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}>
                  {owedCount} {owedCount === 1 ? 'person owes' : 'people owe'} you
                </ThemedText>
              </View>
              <ThemedText font="signal" style={{ fontFamily: fonts.signalBold, fontSize: 14, color: colors.credit, fontVariant: ['tabular-nums'] }}>
                {preferences.hideAmounts ? '••••' : `+${currency}${formatINR(owedTotal)}`}
              </ThemedText>
            </View>
          </Card>
        )}

        {/* §3.11 Upcoming Section — restyled */}
        {upcoming.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <SectionLabel style={{ marginBottom: 14 }}>Upcoming commitments</SectionLabel>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -24 }}
              contentContainerStyle={{ paddingHorizontal: 24, paddingRight: 64 }}
            >
              {upcoming.map((item, idx) => {
                const color = item.type === 'goal' ? colors.credit : (item.type === 'loan' ? colors.debit : colors.ai);
                const daysLeft = getDaysLeft(item.date);
                const isOverdue = daysLeft === 'Overdue';

                return (
                  <MotiView
                    key={idx}
                    from={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'timing', duration: 240, delay: idx * 40 }}
                    style={{ marginRight: 12, width: 240 }}
                  >
                    <Card
                      onPress={() => {
                        triggerHaptic();
                        navigation.navigate('Finances', {
                          initialTab: item.type === 'goal' ? 'goals' : item.type === 'loan' ? 'loans' : 'subs',
                          highlightId: item.id,
                        });
                      }}
                      style={{ padding: 16 }}
                    >
                      {/* Top row: IconTile + type badge + days pill */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <IconTile color={color} size={28}>
                            {item.type === 'goal' ? <LucideTarget color={color} size={14} /> :
                              item.type === 'loan' ? <LucideLandmark color={color} size={14} /> :
                                <LucideRepeat color={color} size={14} />}
                          </IconTile>
                          <ThemedText font="signal" type="secondary" style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>
                            {item.type === 'goal' ? 'Goal' : item.type === 'loan' ? 'EMI' : 'Sub'}
                          </ThemedText>
                        </View>
                        <View style={{
                          paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99,
                          backgroundColor: isOverdue ? colors.alertSoft : colors.translucent,
                        }}>
                          <ThemedText font="signal" style={{ fontSize: 9, fontFamily: fonts.signalBold, color: isOverdue ? colors.danger : colors.secondary }}>
                            {daysLeft}
                          </ThemedText>
                        </View>
                      </View>
                      <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14 }} numberOfLines={1}>{item.name}</ThemedText>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
                        <ThemedText font="signal" type="secondary" style={{ fontSize: 11 }}>
                          {new Date(item.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </ThemedText>
                        <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: colors.primary, fontVariant: ['tabular-nums'] }}>
                          {formatAmount(item.amount || item.emiAmount || 0)}
                        </ThemedText>
                      </View>
                    </Card>
                  </MotiView>
                );
              })}
            </ScrollView>
            {/* §3.13 Celebration overlay */}
            {celebrationTrigger > 0 && (
              <ResonanceRings
                trigger={celebrationTrigger}
                color={colors.success}
                size={120}
                style={{ alignSelf: 'center', marginTop: -60 }}
              />
            )}
          </View>
        )}

        {/* §3.5 Pulse strip — 3 stat tiles */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
          <Card style={{ flex: 1, padding: 12 }}>
            <SectionLabel>Today</SectionLabel>
            <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: colors.debit, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
              {preferences.hideAmounts ? '••••' : todaySpend > 0 ? `${currency}${formatINR(todaySpend)}` : '—'}
            </ThemedText>
          </Card>
          <Card style={{ flex: 1, padding: 12 }}>
            <SectionLabel>Top cat</SectionLabel>
            {topCategories.length > 0 ? (
              <>
                <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: categoryMap.get(topCategories[0].category)?.color || colors.secondary, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                  {topCategories[0].percentage}%
                </ThemedText>
                <ThemedText font="signal" type="secondary" style={{ fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                  {topCategories[0].category}
                </ThemedText>
              </>
            ) : (
              <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: colors.secondary, marginTop: 4 }}>—</ThemedText>
            )}
          </Card>
          <Card style={{ flex: 1, padding: 12 }}>
            <SectionLabel>Biggest</SectionLabel>
            {biggestPulse ? (
              <>
                <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: colors.debit, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                  {preferences.hideAmounts ? '••••' : `${currency}${formatINR(biggestPulse.amount)}`}
                </ThemedText>
                <ThemedText font="signal" type="secondary" style={{ fontSize: 9, marginTop: 2 }} numberOfLines={1}>
                  {biggestPulse.merchant}
                </ThemedText>
              </>
            ) : (
              <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: colors.secondary, marginTop: 4 }}>—</ThemedText>
            )}
          </Card>
        </View>

        {/* §3.3 Cycle waveform — the signature moment */}
        {trend14.length > 0 && (
          <Pressable
            onPress={() => { triggerHaptic(); navigation.navigate('Analytics'); }}
            style={{ marginBottom: 24 }}
          >
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400 }}
            >
              <WaveformBar data={waveData} height={40} barWidth={5} gap={3} style={{ width: '100%' }} />
              {wavePeak > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <ThemedText font="signal" style={{ fontSize: 9, color: colors.muted }}>last 14 days</ThemedText>
                  <ThemedText font="signal" style={{ fontSize: 9, color: colors.muted }}>
                    peak {preferences.hideAmounts ? '••••' : `${currency}${formatINR(wavePeak)}`}
                  </ThemedText>
                </View>
              )}
            </MotiView>
          </Pressable>
        )}

        {/* §3.6 Insight of the day */}
        {insights.length > 0 && (() => {
          const newest = insights[0];
          return (
            <MotiView
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              style={{ marginBottom: 24 }}
            >
              <Card style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  <IconTile emoji="💡" color={colors.ai} size={36} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14 }} numberOfLines={1}>{newest.title}</ThemedText>
                    <ThemedText type="secondary" style={{ fontSize: 12, marginTop: 4, lineHeight: 18 }} numberOfLines={2}>{newest.body}</ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDismissInsight(newest.id)}
                    hitSlop={8}
                    style={{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
                  >
                    <LucideX color={colors.muted} size={14} />
                  </TouchableOpacity>
                </View>
              </Card>
            </MotiView>
          );
        })()}

        {/* §3.9 Activity feed — migrated to SignalRow */}
        <View style={{ marginBottom: 24 }}>
          {groupedTransactions.map(group => (
            <View key={group.label}>
              <View style={{ paddingTop: 10, paddingBottom: 2 }}>
                <SectionLabel>{group.label}</SectionLabel>
              </View>
              {group.items.map(tx => {
                const cat = categoryMap.get(tx.category);
                const kind = amountKind(tx);
                const nodeColor = kind === 'credit' ? colors.credit : kind === 'debit' ? colors.debit : colors.secondary;
                return (
                  <SignalRow
                    key={tx.id}
                    emoji={cat?.icon ?? '📁'}
                    iconColor={cat?.color || colors.secondary}
                    title={tx.merchant}
                    subtitle={`${timeOnly(tx.date)} · ${tx.category}${getAccountLabel(tx)}${tx.tags && tx.tags.length > 0 ? ` · ${tx.tags.map((t: string) => '#' + t).join(' ')}` : ''}`}
                    nodeColor={nodeColor}
                    right={
                      <AmountText
                        value={tx.amount}
                        kind={kind}
                        showSign={kind !== 'transfer'}
                        currency={currency}
                        masked={preferences.hideAmounts}
                        size={14}
                      />
                    }
                    onPress={() => {
                      triggerHaptic();
                      navigation.navigate('TransactionDetail', { transaction: tx });
                    }}
                    rail={false}
                    padded={false}
                  />
                );
              })}
            </View>
          ))}
          {transactions.length === 0 && (
            <View style={{ paddingTop: 40, paddingBottom: 16, alignItems: 'center' }}>
              <ThemedText type="secondary">No signals yet — add a transaction or run a scan.</ThemedText>
            </View>
          )}
          {transactions.length > 0 && (
            <TouchableOpacity
              onPress={() => { triggerHaptic(); navigation.navigate('Txns'); }}
              style={{ alignItems: 'center', paddingVertical: 14 }}
            >
              <ThemedText font="signal" style={{ fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.accent }}>
                All transactions →
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>

        {/* AI Setup Nudge Card */}
        {((!aiModelNudgeDismissed && aiModelStatus === 'not_downloaded') ||
          aiModelStatus === 'downloading' ||
          aiModelStatus === 'paused' ||
          aiModelStatus === 'error') && AIModelManager.isDeviceCompatible() && (
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ padding: 20, borderRadius: 14, marginBottom: 24, borderWidth: 1, flexDirection: 'row', gap: 16, backgroundColor: colors.creditSoft, borderColor: `${colors.ai}30` }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: `${colors.ai}25` }}>
              <LucideBrain color={colors.ai} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              {aiModelStatus === 'not_downloaded' && (
                <>
                  <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}>Unlock Echo AI</ThemedText>
                  <ThemedText type="secondary" style={{ fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                    Download the local Echo AI engine to enable automatic transaction classification. Everything runs 100% privately on your device.
                  </ThemedText>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 16 }}>
                    <TouchableOpacity
                      onPress={() => { triggerHaptic(); setShowSetupModal(true); }}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.accent }}
                    >
                      <ThemedText style={{ color: colors.onAccent, fontFamily: fonts.textSemibold, fontSize: 12 }}>Setup Echo AI</ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { triggerHaptic(); setAiModelNudgeDismissed(true); }}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
                    >
                      <ThemedText type="secondary" style={{ fontFamily: fonts.textSemibold, fontSize: 12 }}>Dismiss</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {aiModelStatus === 'downloading' && (
                <>
                  <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}>Downloading Echo AI...</ThemedText>
                  <View style={{ marginTop: 12 }}>
                    <View style={{ width: '100%', height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
                      <MotiView
                        animate={{ width: `${aiModelProgress}%` }}
                        transition={{ type: 'timing', duration: 300 }}
                        style={{ height: '100%', borderRadius: 3, backgroundColor: colors.accent }}
                      />
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <ThemedText type="secondary" style={{ fontSize: 10 }}>Downloading...</ThemedText>
                      <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 10, color: colors.accent }}>{aiModelProgress}%</ThemedText>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 16 }}>
                    <TouchableOpacity
                      onPress={() => { triggerHaptic(); setShowSetupModal(true); }}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <LucideDownload color={colors.onAccent} size={12} />
                      <ThemedText style={{ color: colors.onAccent, fontFamily: fonts.textSemibold, fontSize: 12 }}>View Progress</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {aiModelStatus === 'error' && (
                <>
                  <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 14, color: colors.danger }}>Echo AI Download Failed</ThemedText>
                  <ThemedText type="secondary" style={{ fontSize: 12, marginTop: 4 }}>
                    {aiModelProgress > 0 ? `Failed at ${aiModelProgress}%. ` : ''}{aiModelError || 'Please check your connection and try again.'}
                  </ThemedText>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 16 }}>
                    <TouchableOpacity
                      onPress={() => { triggerHaptic(); setShowSetupModal(true); }}
                      style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <LucideRefreshCcw color={colors.onAccent} size={12} />
                      <ThemedText style={{ color: colors.onAccent, fontFamily: fonts.textSemibold, fontSize: 12 }}>Retry Setup</ThemedText>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </MotiView>
        )}

        {/* §3.12 Status footer */}
        <View style={{ alignItems: 'center', paddingVertical: 12, marginBottom: 8 }}>
          <ThemedText font="signal" style={{ fontSize: 9, color: colors.muted, textAlign: 'center' }}>
            {[
              lastScanAt !== undefined ? `scan ${relativeTime(lastScanAt)}` : null,
              lastSynced !== undefined ? `sync ${relativeTime(lastSynced)}` : null,
              `AI ${aiModelStatus === 'ready' || aiModelStatus === 'downloaded' ? 'on-device' : 'off'}`,
            ].filter(Boolean).join(' · ')}
          </ThemedText>
        </View>

        {/* Bottom spacer for FAB clearance */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* FAB — pulse amber: the "emit a transaction" action */}
      <TouchableOpacity
        onPress={() => {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate('AddTransaction');
        }}
        activeOpacity={0.85}
        style={{
          position: 'absolute', bottom: 32, right: 24, width: 64, height: 64,
          borderRadius: 32, alignItems: 'center', justifyContent: 'center',
          elevation: 8, backgroundColor: colors.accent, shadowColor: colors.accent,
          shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10,
        }}
      >
        <LucidePlus color={colors.onAccent} size={32} />
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

export default DashboardScreen;
