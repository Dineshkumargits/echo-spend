import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { MotiView } from 'moti';
import { LineChart } from 'react-native-wagmi-charts';
import Svg, { Path, G, Circle, Text as SvgText } from 'react-native-svg';
import * as LucideIcons from 'lucide-react-native';
import {
  LucideArrowLeft,
  LucideEdit3,
  LucideTrendingDown,
  LucideTrendingUp,
  LucideArrowRight,
  LucideCalendar,
  LucideChevronRight,
  LucideChevronDown,
  LucideWallet,
  LucideCreditCard,
  LucideBanknote,
  LucideCircleDollarSign,
  LucideArrowUpRight,
  LucideArrowDownLeft,
} from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import {
  Account,
  Transaction,
  Category,
  SpendTrendPoint,
  getAccounts,
  getTransactions,
  getCategories,
  getAccountInsights,
  getAccountSpendTrend,
  syncAccountBalanceFromSms,
  recalculateAccountBalance,
} from '../services/database';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Constants ────────────────────────────────────────────────────────────────
const PIE_COLORS = [
  '#0A84FF', '#30D158', '#FF9500', '#BF5AF2', '#FF453A',
  '#5AC8FA', '#FFD60A', '#FF6B6B', '#4ECDC4', '#34C759',
];



// ─── Types ────────────────────────────────────────────────────────────────────

type DateRangePreset = '7d' | '30d' | '90d' | 'all';
type ActiveTab = 'expense' | 'income';

interface CategoryGroup {
  category: string;
  icon: string;
  color: string;
  total: number;
  count: number;
  percentage: number;
  transactions: Transaction[];
}

// ─── Donut Chart ──────────────────────────────────────────────────────────────

interface DonutChartProps {
  slices: CategoryGroup[];
  selectedIndex: number | null;
  onSelect: (i: number | null) => void;
  themeColors: any;
}

const DonutChart = React.memo(({ slices, selectedIndex, onSelect, themeColors }: DonutChartProps) => {
  const size = Math.min(SCREEN_WIDTH - 80, 220);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 14;
  const innerR = outerR * 0.6;

  // Single slice: full circle
  if (slices.length === 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={outerR} fill={slices[0].color}
          onPress={() => onSelect(selectedIndex === 0 ? null : 0)} />
        <Circle cx={cx} cy={cy} r={innerR} fill={themeColors.surface} />
        <SvgText x={cx} y={cy - 6} textAnchor="middle" fontSize={10} fill={themeColors.secondary}>
          {slices[0].category.length > 11 ? slices[0].category.slice(0, 11) + '…' : slices[0].category}
        </SvgText>
        <SvgText x={cx} y={cy + 10} textAnchor="middle" fontSize={13} fill={themeColors.primary} fontWeight="bold">
          100%
        </SvgText>
      </Svg>
    );
  }

  const GAP = 0.04;
  const totalGap = GAP * slices.length;
  const available = 2 * Math.PI - totalGap;
  let angle = -Math.PI / 2;

  const arcs = slices.map((slice, i) => {
    const sweep = (slice.percentage / 100) * available;
    const end = angle + sweep;
    const mid = angle + sweep / 2;
    const R = selectedIndex === i ? outerR + 6 : outerR;

    const ox1 = cx + R * Math.cos(angle);
    const oy1 = cy + R * Math.sin(angle);
    const ox2 = cx + R * Math.cos(end);
    const oy2 = cy + R * Math.sin(end);
    const ix1 = cx + innerR * Math.cos(end);
    const iy1 = cy + innerR * Math.sin(end);
    const ix2 = cx + innerR * Math.cos(angle);
    const iy2 = cy + innerR * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;

    const d =
      `M ${ox1.toFixed(2)} ${oy1.toFixed(2)} ` +
      `A ${R} ${R} 0 ${large} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)} ` +
      `L ${ix1.toFixed(2)} ${iy1.toFixed(2)} ` +
      `A ${innerR} ${innerR} 0 ${large} 0 ${ix2.toFixed(2)} ${iy2.toFixed(2)} Z`;

    angle = end + GAP;
    return { d, mid, i };
  });

  const sel = selectedIndex !== null ? slices[selectedIndex] : null;

  return (
    <Svg width={size} height={size}>
      {arcs.map(({ d, i }) => (
        <Path
          key={i}
          d={d}
          fill={slices[i].color}
          opacity={selectedIndex === null || selectedIndex === i ? 1 : 0.4}
          onPress={() => onSelect(selectedIndex === i ? null : i)}
        />
      ))}
      {sel ? (
        <G>
          <SvgText x={cx} y={cy - 10} textAnchor="middle" fontSize={10} fill={themeColors.secondary}>
            {sel.category.length > 11 ? sel.category.slice(0, 11) + '…' : sel.category}
          </SvgText>
          <SvgText x={cx} y={cy + 7} textAnchor="middle" fontSize={13} fill={themeColors.primary} fontWeight="bold">
            ₹{sel.total.toLocaleString('en-IN')}
          </SvgText>
          <SvgText x={cx} y={cy + 23} textAnchor="middle" fontSize={11} fill={sel.color} fontWeight="bold">
            {sel.percentage}%
          </SvgText>
        </G>
      ) : (
        <SvgText x={cx} y={cy + 5} textAnchor="middle" fontSize={11} fill={themeColors.secondary}>
          {slices.length} categories
        </SvgText>
      )}
    </Svg>
  );
});

// ─── Category Group Item ──────────────────────────────────────────────────────

interface CategoryGroupItemProps {
  group: CategoryGroup;
  maxTotal: number;
  isHighlighted: boolean;
  colors: any;
  currency: string;
  onTransactionPress: (tx: Transaction) => void;
}

const CategoryGroupItem = React.memo(({
  group, maxTotal, isHighlighted, colors, currency, onTransactionPress,
}: CategoryGroupItemProps) => {
  const [expanded, setExpanded] = useState(false);
  const IconComp = (LucideIcons as any)[group.icon] || LucideIcons.HelpCircle;
  const barPct = maxTotal > 0 ? (group.total / maxTotal) * 100 : 0;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(e => !e);
  };

  return (
    <View style={{
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: isHighlighted ? `${group.color}08` : colors.surface,
    }}>
      {/* Category row */}
      <TouchableOpacity onPress={toggle} activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}
      >
        <View style={{
          width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          marginRight: 12, backgroundColor: `${group.color}20`,
        }}>
          <IconComp color={group.color} size={18} />
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>{group.category}</ThemedText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99, backgroundColor: colors.border }}>
                <ThemedText style={{ fontSize: 10, fontWeight: '700', color: colors.secondary }}>
                  {group.count} txn{group.count !== 1 ? 's' : ''}
                </ThemedText>
              </View>
              <ThemedText style={{ fontSize: 14, fontWeight: '700', color: group.color }}>
                {currency}{group.total.toLocaleString('en-IN')}
              </ThemedText>
            </View>
          </View>
          {/* Bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
              <View style={{ height: '100%', borderRadius: 4, backgroundColor: group.color, width: `${barPct}%` }} />
            </View>
            <ThemedText style={{ fontSize: 10, fontWeight: '700', color: colors.secondary, width: 28, textAlign: 'right' }}>
              {group.percentage}%
            </ThemedText>
          </View>
        </View>

        <View style={{ marginLeft: 8 }}>
          <LucideChevronDown
            color={colors.secondary} size={16}
            style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
          />
        </View>
      </TouchableOpacity>

      {/* Expanded transactions */}
      {expanded && group.transactions.map((tx, idx) => (
        <TouchableOpacity
          key={tx.id}
          onPress={() => onTransactionPress(tx)}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row', alignItems: 'center',
            paddingLeft: 68, paddingRight: 16, paddingVertical: 10,
            borderTopWidth: 1, borderTopColor: colors.border,
            backgroundColor: `${group.color}06`,
          }}
        >
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontSize: 13, fontWeight: '500' }} numberOfLines={1}>
              {tx.merchant}
            </ThemedText>
            <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 1 }} numberOfLines={1}>
              {new Date(tx.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: '2-digit' })} · {new Date(tx.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              {tx.tags && tx.tags.length > 0 ? ` · ${tx.tags.map(t => '#' + t).join(' ')}` : ''}
            </ThemedText>
          </View>
          <ThemedText style={{ fontSize: 13, fontWeight: '700', color: group.color, marginRight: 6 }}>
            {currency}{tx.amount.toLocaleString('en-IN')}
          </ThemedText>
          <LucideChevronRight color={colors.secondary} size={13} />
        </TouchableOpacity>
      ))}
    </View>
  );
});

// ─── Analysis Section (isolated — only re-renders on tab data change) ─────────

interface AnalysisSectionProps {
  groups: CategoryGroup[];
  tabLoading: boolean;
  activeTab: ActiveTab;
  colors: any;
  currency: string;
  onTransactionPress: (tx: Transaction) => void;
}

const AnalysisSection = React.memo(({
  groups, tabLoading, activeTab, colors, currency, onTransactionPress,
}: AnalysisSectionProps) => {
  const [selectedPie, setSelectedPie] = useState<number | null>(null);

  // Reset pie selection when tab data changes
  useEffect(() => { setSelectedPie(null); }, [groups]);

  const pieSlices = groups.slice(0, 8);
  const maxTotal = groups[0]?.total ?? 0;

  if (tabLoading) {
    return (
      <View style={{ paddingVertical: 48, alignItems: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (groups.length === 0) {
    return (
      <View style={{
        marginHorizontal: 20, marginBottom: 20, padding: 32,
        borderRadius: 16, alignItems: 'center',
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      }}>
        <ThemedText style={{ color: colors.secondary, fontSize: 14, textAlign: 'center' }}>
          No {activeTab === 'expense' ? 'expense' : 'income'} data for this period
        </ThemedText>
      </View>
    );
  }

  return (
    <View>
      {/* Pie chart card */}
      <View style={{
        marginHorizontal: 20, marginBottom: 16,
        borderRadius: 20, overflow: 'hidden',
        backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      }}>
        {/* Chart header */}
        <View style={{ padding: 20, paddingBottom: 4 }}>
          <ThemedText style={{ fontSize: 15, fontWeight: '700' }}>
            {activeTab === 'expense' ? 'Expense' : 'Income'} Breakdown
          </ThemedText>
          <ThemedText style={{ fontSize: 12, color: colors.secondary, marginTop: 2 }}>
            Tap a slice or row to explore
          </ThemedText>
        </View>

        {/* Pie */}
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <DonutChart
            slices={pieSlices}
            selectedIndex={selectedPie}
            onSelect={setSelectedPie}
            themeColors={colors}
          />
        </View>

        {/* Legend rows */}
        <View style={{ paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}>
          {pieSlices.map((slice, i) => {
            const IconComp = (LucideIcons as any)[slice.icon] || LucideIcons.HelpCircle;
            const isSelected = selectedPie === i;
            return (
              <TouchableOpacity
                key={i}
                onPress={() => setSelectedPie(selectedPie === i ? null : i)}
                style={{ flexDirection: 'row', alignItems: 'center', opacity: selectedPie !== null && !isSelected ? 0.5 : 1 }}
                activeOpacity={0.7}
              >
                <View style={{
                  width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                  marginRight: 10, backgroundColor: `${slice.color}20`,
                }}>
                  <IconComp color={slice.color} size={14} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <ThemedText style={{ fontSize: 13, fontWeight: isSelected ? '700' : '500' }}>
                      {slice.category}
                    </ThemedText>
                    <ThemedText style={{ fontSize: 13, fontWeight: '700' }}>
                      {currency}{slice.total.toLocaleString('en-IN')}
                    </ThemedText>
                  </View>
                  <View style={{ height: 3, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
                    <View style={{ height: '100%', borderRadius: 3, backgroundColor: slice.color, width: `${slice.percentage}%` }} />
                  </View>
                </View>
                <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, marginLeft: 10, width: 28, textAlign: 'right' }}>
                  {slice.percentage}%
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Category groups */}
      <View style={{ marginHorizontal: 20, marginBottom: 16 }}>
        <ThemedText style={{ fontSize: 15, fontWeight: '700', marginBottom: 10 }}>
          By Category
        </ThemedText>
        <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
          {groups.map((group, i) => (
            <CategoryGroupItem
              key={group.category}
              group={group}
              maxTotal={maxTotal}
              isHighlighted={selectedPie === i}
              colors={colors}
              currency={currency}
              onTransactionPress={onTransactionPress}
            />
          ))}
        </View>
      </View>
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

const BankAccountDetailScreen = ({ navigation, route }: any) => {
  const { accountId } = route.params as { accountId: number };
  const { colors } = useTheme();
  const { preferences } = useStore();
  const isFocused = useIsFocused();

  // ── Page-level state (stable — doesn't change on tab switch) ─────────────
  const [account, setAccount] = useState<Account | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [trend, setTrend] = useState<SpendTrendPoint[]>([]);
  const [insights, setInsights] = useState<{
    totalExpense: number; totalIncome: number; txCount: number; avgTxAmount: number;
  } | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // ── Control state ────────────────────────────────────────────────────────
  const [dateRange, setDateRange] = useState<DateRangePreset>('30d');
  const [activeTab, setActiveTab] = useState<ActiveTab>('expense');

  // ── Tab-level state (only changes on tab/dateRange switch) ───────────────
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [tabLoading, setTabLoading] = useState(false);

  const isFirstMount = useRef(true);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const getDateBounds = (preset: DateRangePreset) => {
    if (preset === 'all') return { startDate: undefined, endDate: undefined };
    const now = new Date();
    const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
    const start = new Date(now);
    start.setDate(now.getDate() - days + 1);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    return { startDate: fmt(start), endDate: fmt(now) };
  };

  const fmt = (val: number) =>
    preferences.hideAmounts ? '****' : `${preferences.currency}${Math.abs(val).toLocaleString('en-IN')}`;

  // ── Data loaders ─────────────────────────────────────────────────────────
  const loadPageData = async (range: DateRangePreset) => {
    const { startDate, endDate } = getDateBounds(range);
    const trendDays = range === 'all' ? 90 : range === '90d' ? 90 : range === '30d' ? 30 : 7;
    const [accs, cats, tr, ins] = await Promise.all([
      getAccounts(),
      getCategories(),
      getAccountSpendTrend(accountId, trendDays),
      getAccountInsights(accountId, startDate, endDate),
    ]);
    setAccount(accs.find(a => a.id === accountId) ?? null);
    setCategories(cats);
    setTrend(tr);
    setInsights(ins);
  };

  const loadTabData = async (range: DateRangePreset, tab: ActiveTab, cats: Category[]) => {
    try {
      const { startDate, endDate } = getDateBounds(range);
      const txType = tab === 'expense' ? 'debit' : 'credit';
      const txs = await getTransactions({
        accountId,
        type: txType,
        startDate,
        endDate,
        confirmedOnly: true,
        limit: 500,
      });

      // Group by category (with hierarchy awareness)
      const parentMap = new Map<string, { total: number; count: number; transactions: Transaction[]; icon: string; color: string; subs: Set<string> }>();
      
      txs.forEach(tx => {
        const catDef = cats.find(c => c.name === tx.category);
        const parent = catDef?.parentId ? cats.find(c => c.id === catDef.parentId) : null;
        const parentName = parent?.name || tx.category;

        const existing = parentMap.get(parentName) || {
          total: 0,
          count: 0,
          transactions: [],
          icon: (parent || catDef)?.icon || 'HelpCircle',
          color: (parent || catDef)?.color || colors.secondary,
          subs: new Set()
        };

        existing.total += tx.amount;
        existing.count += 1;
        existing.transactions.push(tx);
        if (parent) existing.subs.add(tx.category);
        parentMap.set(parentName, existing);
      });

      const grandTotal = txs.reduce((s, tx) => s + tx.amount, 0) || 1;
      const groups: CategoryGroup[] = Array.from(parentMap.entries())
        .map(([parentName, data]) => {
          const subText = data.subs.size > 0 ? ` (${Array.from(data.subs).join(', ')})` : '';
          return {
            category: parentName + subText,
            icon: data.icon,
            color: data.color,
            total: data.total,
            count: data.count,
            percentage: Math.round((data.total / grandTotal) * 100),
            transactions: data.transactions.sort((a, b) => b.amount - a.amount),
          };
        })
        .sort((a, b) => b.total - a.total);

      setCategoryGroups(groups);
    } catch (err) {
      console.error('[AccountDetail] loadTabData failed:', err);
    }
  };

  // ── Full reload (focus + dateRange change) ───────────────────────────────
  const loadAll = useCallback(async (range: DateRangePreset, tab: ActiveTab) => {
    try {
      setPageLoading(true);
      setTabLoading(true);
      const { startDate, endDate } = getDateBounds(range);
      const trendDays = range === 'all' ? 90 : range === '90d' ? 90 : range === '30d' ? 30 : 7;
      const [accs, cats, tr, ins] = await Promise.all([
        getAccounts(),
        getCategories(),
        getAccountSpendTrend(accountId, trendDays),
        getAccountInsights(accountId, startDate, endDate),
      ]);
      const acc = accs.find(a => a.id === accountId) ?? null;
      setAccount(acc);
      setCategories(cats);
      setTrend(tr);
      setInsights(ins);
      await loadTabData(range, tab, cats);
    } catch (err) {
      console.error('[AccountDetail] loadAll failed:', err);
    } finally {
      setPageLoading(false);
      setTabLoading(false);
      setRefreshing(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (isFocused) {
      loadAll(dateRange, activeTab);
    }
  }, [isFocused, dateRange, loadAll, activeTab]);

  // Tab change only — skip initial mount
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    setTabLoading(true);
    loadTabData(dateRange, activeTab, categories).then(() => setTabLoading(false));
  }, [activeTab]);

  const onRefresh = () => {
    setRefreshing(true);
    setTabLoading(true);
    loadAll(dateRange, activeTab);
  };

  const onSyncBalance = async () => {
    if (!account) return;
    setRefreshing(true);
    try {
      const success = await syncAccountBalanceFromSms(accountId);
      if (success) {
        notify.success('Balance synced with bank');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        loadAll(dateRange, activeTab);
      } else {
        // Fallback: Recalculate from transaction history + starting balance
        const recSuccess = await recalculateAccountBalance(accountId);
        if (recSuccess) {
          notify.success('Balance recalculated from history');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          loadAll(dateRange, activeTab);
        } else {
          notify.info('No recent balance info found in SMS');
        }
      }
    } catch (err) {
      notify.error('Failed to sync balance');
    } finally {
      setRefreshing(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const chartData = trend.map((p, i) => ({
    timestamp: new Date(p.date).getTime() + i,
    value: p.total,
  }));

  const insightCards = insights ? [
    { label: 'Expenses', value: fmt(insights.totalExpense), icon: LucideTrendingDown, color: colors.danger, sub: `${insights.txCount} transactions` },
    { label: 'Income', value: fmt(insights.totalIncome), icon: LucideTrendingUp, color: colors.success, sub: `avg ${fmt(insights.avgTxAmount)}` },
    {
      label: 'Net Flow',
      value: fmt(Math.abs(insights.totalIncome - insights.totalExpense)),
      icon: LucideArrowRight,
      color: insights.totalIncome >= insights.totalExpense ? colors.success : colors.warning,
      sub: insights.totalIncome >= insights.totalExpense ? 'Surplus' : 'Deficit',
    },
  ] : [];

  const AccountIcon = account?.accountType === 'credit_card' ? LucideCreditCard
    : account?.accountType === 'cash' ? LucideBanknote
      : account?.accountType === 'wallet' ? LucideCircleDollarSign
        : LucideWallet;

  const accountTypeLabel = (account?.accountType ?? 'bank').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  // ── Render ────────────────────────────────────────────────────────────────
  if (pageLoading) {
    return (
      <ThemedSafeAreaView className="items-center justify-center">
        <ActivityIndicator color={colors.accent} size="large" />
      </ThemedSafeAreaView>
    );
  }

  if (!account) {
    return (
      <ThemedSafeAreaView className="items-center justify-center">
        <ThemedText style={{ color: colors.secondary }}>Account not found.</ThemedText>
      </ThemedSafeAreaView>
    );
  }

  return (
    <ThemedSafeAreaView>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
        >
          <LucideArrowLeft color={colors.primary} size={20} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <ThemedText style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{account.name}</ThemedText>
          <ThemedText style={{ fontSize: 12, color: colors.secondary }}>{accountTypeLabel}</ThemedText>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('AddAccount', { accountToEdit: account })}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
        >
          <LucideEdit3 color={colors.accent} size={18} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {/* Balance Hero */}
        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            marginHorizontal: 20, marginBottom: 20, padding: 20,
            borderRadius: 20, backgroundColor: colors.surface,
            borderWidth: 1, borderColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <View style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}20` }}>
              <AccountIcon color={colors.accent} size={22} />
            </View>
            <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: 99, backgroundColor: `${colors.accent}15` }}>
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.accent }}>{accountTypeLabel}</ThemedText>
            </View>
          </View>
          <ThemedText style={{ fontSize: 11, fontWeight: '600', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {account.accountType === 'credit_card' ? 'Outstanding' : 'Current Balance'}
          </ThemedText>
          <ThemedText style={{ fontSize: 36, fontWeight: '700' }}>
            {preferences.hideAmounts ? '****' : `${account.accountType === 'credit_card' ? '-' : ''}${preferences.currency}${account.balance.toLocaleString('en-IN')}`}
          </ThemedText>
          {(account.accountType === 'bank' || account.accountType === 'credit_card') && (
            <TouchableOpacity
              onPress={onSyncBalance}
              activeOpacity={0.6}
              style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}
            >
              <LucideIcons.LucideRefreshCcw color={colors.accent} size={12} />
              <ThemedText style={{ fontSize: 11, color: colors.accent, fontWeight: '600', marginLeft: 6 }}>
                Sync with latest SMS
              </ThemedText>
            </TouchableOpacity>
          )}
          {account.accountType === 'credit_card' && account.creditLimit ? (
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <ThemedText style={{ fontSize: 11, color: colors.secondary }}>Credit Used</ThemedText>
                <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.warning }}>
                  {Math.round((account.balance / account.creditLimit) * 100)}% of {preferences.currency}{account.creditLimit.toLocaleString('en-IN')}
                </ThemedText>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
                <View style={{ height: '100%', borderRadius: 3, backgroundColor: colors.warning, width: `${Math.min((account.balance / account.creditLimit) * 100, 100)}%` }} />
              </View>
            </View>
          ) : null}
          {account.last4Digits ? (
            <ThemedText style={{ fontSize: 12, color: colors.secondary, marginTop: 12 }}>···· {account.last4Digits}</ThemedText>
          ) : null}
        </MotiView>

        {/* Date Range Filter */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <View style={{ flexDirection: 'row', padding: 4, borderRadius: 99, alignSelf: 'flex-start', backgroundColor: colors.translucent }}>
            {(['7d', '30d', '90d', 'all'] as DateRangePreset[]).map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => setDateRange(p)}
                style={{
                  paddingHorizontal: 16, paddingVertical: 6, borderRadius: 99,
                  backgroundColor: dateRange === p ? colors.accent : 'transparent',
                }}
              >
                <ThemedText style={{ fontSize: 12, fontWeight: '700', color: dateRange === p ? '#FFF' : colors.secondary }}>
                  {p === 'all' ? 'All' : p.toUpperCase()}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Insight Cards */}
        {insightCards.length > 0 && (
          <ScrollView
            horizontal showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 20 }}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          >
            {insightCards.map((card, i) => (
              <MotiView
                key={i}
                from={{ opacity: 0, translateX: 20 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ delay: i * 60 }}
                style={{
                  padding: 16, borderRadius: 16, minWidth: 130,
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 12, backgroundColor: `${card.color}20` }}>
                  <card.icon color={card.color} size={16} />
                </View>
                <ThemedText style={{ fontSize: 10, fontWeight: '600', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  {card.label}
                </ThemedText>
                <ThemedText style={{ fontSize: 15, fontWeight: '700', color: card.color }}>{card.value}</ThemedText>
                {card.sub ? <ThemedText style={{ fontSize: 10, color: colors.secondary, marginTop: 2 }}>{card.sub}</ThemedText> : null}
              </MotiView>
            ))}
          </ScrollView>
        )}

        {/* Timeline Graph */}
        <View style={{
          marginHorizontal: 20, marginBottom: 24, padding: 16,
          borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <View>
              <ThemedText style={{ fontSize: 11, fontWeight: '600', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>Spend Trend</ThemedText>
              <ThemedText style={{ fontSize: 20, fontWeight: '700', marginTop: 2 }}>{fmt(trend.reduce((s, p) => s + p.total, 0))}</ThemedText>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: `${colors.accent}15`, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
              <LucideCalendar color={colors.accent} size={12} />
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.accent, marginLeft: 4 }}>
                {dateRange === 'all' ? '90D' : dateRange.toUpperCase()}
              </ThemedText>
            </View>
          </View>
          {chartData.length >= 2 ? (
            <View style={{ overflow: 'hidden' }}>
              <LineChart.Provider data={chartData}>
                <LineChart height={110} width={SCREEN_WIDTH - 72}>
                  <LineChart.Path color={colors.accent} />
                  <LineChart.CursorCrosshair color={colors.primary} />
                </LineChart>
              </LineChart.Provider>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <ThemedText style={{ fontSize: 10, color: colors.secondary }}>
                  {trend[0]?.date ? new Date(trend[0].date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : ''}
                </ThemedText>
                <ThemedText style={{ fontSize: 10, color: colors.secondary }}>
                  {trend[trend.length - 1]?.date ? new Date(trend[trend.length - 1].date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : ''}
                </ThemedText>
              </View>
            </View>
          ) : (
            <View style={{ height: 110, alignItems: 'center', justifyContent: 'center' }}>
              <ThemedText style={{ fontSize: 13, color: colors.secondary }}>No spending data for this period</ThemedText>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.translucent }}>
            {(['expense', 'income'] as ActiveTab[]).map(tab => (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 10,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: activeTab === tab ? colors.surface : 'transparent',
                }}
              >
                {tab === 'expense'
                  ? <LucideArrowUpRight color={activeTab === tab ? colors.danger : colors.secondary} size={14} />
                  : <LucideArrowDownLeft color={activeTab === tab ? colors.success : colors.secondary} size={14} />
                }
                <ThemedText style={{
                  fontSize: 13, fontWeight: '700', marginLeft: 6,
                  color: activeTab === tab ? (tab === 'expense' ? colors.danger : colors.success) : colors.secondary,
                }}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Analysis section (isolated re-render) ── */}
        <AnalysisSection
          groups={categoryGroups}
          tabLoading={tabLoading}
          activeTab={activeTab}
          colors={colors}
          currency={preferences.currency}
          onTransactionPress={tx => navigation.navigate('TransactionDetail', { transaction: tx })}
        />

        {/* View All Transactions */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Main', { screen: 'Txns', params: { presetAccountId: accountId } })}
          style={{
            marginHorizontal: 20, marginBottom: 16, padding: 16, borderRadius: 16,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: `${colors.accent}10`, borderWidth: 1, borderColor: `${colors.accent}30`,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: `${colors.accent}20` }}>
              <LucideArrowRight color={colors.accent} size={16} />
            </View>
            <View>
              <ThemedText style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>View All Transactions</ThemedText>
              <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 1 }}>Filtered for {account.name}</ThemedText>
            </View>
          </View>
          <LucideChevronRight color={colors.accent} size={18} />
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </ThemedSafeAreaView>
  );
};

export default BankAccountDetailScreen;
