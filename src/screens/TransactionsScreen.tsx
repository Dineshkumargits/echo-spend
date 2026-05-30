import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  RefreshControl,
} from 'react-native';
import { MotiView } from 'moti';
import {
  LucideSearch,
  LucideX,
  LucideArrowUpRight,
  LucideArrowDownLeft,
  LucideChevronLeft,
  LucideRotateCw,
  LucideSlidersHorizontal,
  LucideFilter,
  LucideRepeat,
  LucideCheck,
  LucideSmartphone,
  LucidePenLine,
  LucideZap,
  LucideAlertCircle,
} from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useStore } from '../store/useStore';
import {
  getTransactions,
  getCategories,
  getAccounts,
  getAllUniqueTags,
  Transaction,
  Category,
  Account,
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';

// ─── Types ───────────────────────────────────────────────────────────────────

type SortOption = 'newest' | 'oldest' | 'highest' | 'lowest';
type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'all' | 'custom';
type SourceFilter = 'all' | 'sms' | 'manual' | 'auto';

interface Filters {
  type: 'all' | 'debit' | 'credit' | 'transfer';
  categoryName: string | null;
  tagValue: string | null;
  accountId: number | null;
  datePreset: DatePreset;
  customStart: string;
  customEnd: string;
  minAmount: string;
  maxAmount: string;
  source: SourceFilter;
  recurring: boolean;
  sort: SortOption;
}

const DEFAULT_FILTERS: Filters = {
  type: 'all',
  categoryName: null,
  tagValue: null,
  accountId: null,
  datePreset: 'all',
  customStart: new Date().toISOString().split('T')[0],
  customEnd: new Date().toISOString().split('T')[0],
  minAmount: '',
  maxAmount: '',
  source: 'all',
  recurring: false,
  sort: 'newest',
};

const PAGE_SIZE = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getDateRange = (preset: DatePreset, customStart: string, customEnd: string) => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (preset) {
    case 'today':
      return { startDate: fmt(now), endDate: fmt(now) };
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { startDate: fmt(start), endDate: fmt(now) };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(now) };
    }
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case 'custom':
      return { startDate: customStart || undefined, endDate: customEnd || undefined };
    default:
      return { startDate: undefined, endDate: undefined };
  }
};

const countActiveFilters = (f: Filters): number => {
  let count = 0;
  if (f.type !== 'all') count++;
  if (f.categoryName) count++;
  if (f.tagValue) count++;
  if (f.accountId) count++;
  if (f.datePreset !== 'all') count++;
  if (f.minAmount || f.maxAmount) count++;
  if (f.source !== 'all') count++;
  if (f.recurring) count++;
  return count;
};

const formatAmount = (amount: number, currency = '₹') =>
  `${currency}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;


const formatDateShort = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

// ─── TransactionsScreen ───────────────────────────────────────────────────────

const TransactionsScreen = () => {
  const { colors } = useTheme();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const canGoBack = navigation.canGoBack();

  const presetAccountId: number | undefined = route.params?.presetAccountId;

  // ── State ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(() =>
    presetAccountId ? { ...DEFAULT_FILTERS, accountId: presetAccountId } : DEFAULT_FILTERS
  );
  const [showFilters, setShowFilters] = useState(false);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Use a ref for the current page offset so loadMore never captures a stale value
  // from a closure, which was causing duplicate pages to load.
  const offsetRef = useRef(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Apply preset account filter when navigated with params ───────────────
  useEffect(() => {
    if (presetAccountId) {
      setFilters(f => ({ ...f, accountId: presetAccountId }));
    }
  }, [presetAccountId]);

  // ── Load metadata ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([getCategories(), getAccounts(), getAllUniqueTags()]).then(([cats, accs, tgs]) => {
      setCategories(cats); // show all including subcategories
      setAccounts(accs);
      setTagsList(tgs);
    });
  }, []);

  // ── Build query opts ──────────────────────────────────────────────────────
  const buildQueryOpts = useCallback(
    (currentOffset: number, searchStr: string, f: Filters) => {
      const { startDate, endDate } = getDateRange(f.datePreset, f.customStart, f.customEnd);
      return {
        limit: PAGE_SIZE,
        offset: currentOffset,
        search: searchStr.trim() || undefined,
        type: f.type !== 'all' ? (f.type as 'credit' | 'debit' | 'transfer') : undefined,
        category: f.categoryName ?? undefined,
        tag: f.tagValue ?? undefined,
        minAmount: f.minAmount ? parseFloat(f.minAmount) : undefined,
        maxAmount: f.maxAmount ? parseFloat(f.maxAmount) : undefined,
        startDate,
        endDate,
        isRecurring: f.recurring ? true : undefined,
        confirmedOnly: true, // Only show confirmed transactions on this screen
        accountId: f.accountId ?? undefined,
      };
    },
    []
  );

  // ── Client-side filters (source, sort) ────────────────────────────────────
  const applyClientFilters = useCallback(
    (raw: Transaction[], f: Filters): Transaction[] => {
      let result = raw;
      if (f.source !== 'all') {
        result = result.filter(t => t.source === f.source);
      }
      if (f.sort === 'oldest') {
        result = [...result].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      } else if (f.sort === 'highest') {
        result = [...result].sort((a, b) => b.amount - a.amount);
      } else if (f.sort === 'lowest') {
        result = [...result].sort((a, b) => a.amount - b.amount);
      }
      // 'newest' is default (DB returns DESC)
      return result;
    },
    []
  );

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchTransactions = useCallback(
    async (searchStr: string, f: Filters, reset = true) => {
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      // Read offset directly from ref — never stale, no closure capture needed.
      const currentOffset = offsetRef.current;
      const opts = buildQueryOpts(currentOffset, searchStr, f);
      const raw = await getTransactions(opts);
      const filtered = applyClientFilters(raw, f);

      if (reset) {
        setTransactions(filtered);
        offsetRef.current = PAGE_SIZE;
      } else {
        setTransactions(prev => [...prev, ...filtered]);
        offsetRef.current = currentOffset + PAGE_SIZE;
      }

      setHasMore(raw.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    },
    [buildQueryOpts, applyClientFilters]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await fetchTransactions(search, filters, true);
    setRefreshing(false);
  }, [search, filters, fetchTransactions]);

  // ── Consolidated Fetching Logic ──────────────────────────────────────────
  // Use a ref to prevent double-firing on initial mount/focus or simultaneous updates
  const lastFetchRef = useRef<string>('');

  useEffect(() => {
    if (!isFocused) return;

    const currentParams = JSON.stringify({ search, filters });
    if (currentParams === lastFetchRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // If it's the very first load, we can fire immediately.
    // Otherwise debounce to catch rapid typing or filter changes.
    const isFirstTime = lastFetchRef.current === '';

    debounceRef.current = setTimeout(() => {
      lastFetchRef.current = currentParams;
      fetchTransactions(search, filters, true);
    }, isFirstTime ? 0 : 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isFocused, search, filters, fetchTransactions]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let expenses = 0;
    let income = 0;

    transactions.forEach(t => {
      if (t.type === 'debit') {
        expenses += t.amount;
      } else if (t.type === 'credit') {
        income += t.amount;
      } else if (t.type === 'transfer') {
        // If we are looking at a specific account, classify transfer as income/expense
        if (filters.accountId) {
          if (t.toAccountId === filters.accountId) {
            income += t.amount;
          } else if (t.accountId === filters.accountId) {
            expenses += t.amount;
          }
        }
        // If we are looking at all accounts, transfers are neutral (ignore for stats)
      }
    });

    return { count: transactions.length, expenses, income };
  }, [transactions, filters.accountId]);

  // ── Open detail ───────────────────────────────────────────────────────────
  const openDetail = (tx: Transaction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('TransactionDetail', { transaction: tx });
  };

  const activeFilterCount = countActiveFilters(filters);
  const themedStyles = useMemo(() => createThemedStyles(colors), [colors]);

  // ─── Render helpers ──────────────────────────────────────────────────────

  const TypeIcon = ({ item, size = 16 }: { item: Transaction; size?: number }) => {
    if (item.type === 'credit') return <LucideArrowDownLeft color={colors.success} size={size} />;
    if (item.type === 'transfer') {
      if (filters.accountId && item.toAccountId === filters.accountId) return <LucideArrowDownLeft color={colors.success} size={size} />;
      if (filters.accountId && item.accountId === filters.accountId) return <LucideArrowUpRight color={colors.danger} size={size} />;
      return <LucideRotateCw color={colors.warning} size={size} />;
    }
    return <LucideArrowUpRight color={colors.danger} size={size} />;
  };

  const amountColor = (item: Transaction) => {
    if (item.type === 'credit') return colors.success;
    if (item.type === 'transfer') {
      if (filters.accountId && item.toAccountId === filters.accountId) return colors.success;
      if (filters.accountId && item.accountId === filters.accountId) return colors.primary;
      return colors.warning;
    }
    return colors.primary;
  };

  const amountPrefix = (item: Transaction) => {
    if (item.type === 'credit') return '+';
    if (item.type === 'transfer') {
      if (filters.accountId && item.toAccountId === filters.accountId) return '+';
      if (filters.accountId && item.accountId === filters.accountId) return '-';
      return '⇄ ';
    }
    return '-';
  };

  const sourceIcon = (source?: string) => {
    if (source === 'sms') return <LucideSmartphone color={colors.secondary} size={13} />;
    if (source === 'manual') return <LucidePenLine color={colors.secondary} size={13} />;
    if (source === 'auto') return <LucideZap color={colors.secondary} size={13} />;
    return null;
  };

  // ─── Transaction Row ──────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: Transaction }) => (
    <TouchableOpacity
      onPress={() => openDetail(item)}
      activeOpacity={0.7}
      style={[themedStyles.txRow, { borderBottomColor: colors.border }]}
    >
      {/* Left icon */}
      <View style={[themedStyles.txIcon, { backgroundColor: colors.translucent }]}>
        <TypeIcon item={item} size={16} />
      </View>

      {/* Middle info */}
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ThemedText className="font-bold text-[15px]" numberOfLines={1} style={{ flex: 1 }}>
            {item.merchant}
          </ThemedText>
          {item.isRecurring ? (
            <LucideRepeat color={colors.accent} size={12} />
          ) : null}
          {!item.isConfirmed ? (
            <LucideAlertCircle color={colors.warning} size={12} />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 5 }}>
          {sourceIcon(item.source)}
          <ThemedText type="secondary" className="text-xs flex-1" numberOfLines={1}>
            {formatDateShort(item.date)} · {item.category}
            {item.tags && item.tags.length > 0 ? ` · ${item.tags.map((t: string) => '#' + t).join(' ')}` : ''}
          </ThemedText>
        </View>
      </View>
      <ThemedText className="font-bold text-[15px]" style={{ color: amountColor(item) }}>
        {amountPrefix(item)}{formatAmount(item.amount, currency)}
      </ThemedText>
    </TouchableOpacity>
  );

  // ─── Filter Panel ─────────────────────────────────────────────────────────

  const FilterChip = ({
    label,
    active,
    onPress,
    color,
  }: {
    label: string;
    active: boolean;
    onPress: () => void;
    color?: string;
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={[
        themedStyles.chip,
        {
          backgroundColor: active ? (color ?? colors.accent) + '20' : colors.surface,
          borderColor: active ? (color ?? colors.accent) : colors.border,
        },
      ]}
    >
      {active && <LucideCheck color={color ?? colors.accent} size={12} style={{ marginRight: 4 }} />}
      <ThemedText
        className="text-xs font-bold"
        style={{ color: active ? (color ?? colors.accent) : colors.secondary }}
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );

  const SectionLabel = ({ label }: { label: string }) => (
    <ThemedText
      type="secondary"
      style={{ fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 16 }}
    >
      {label}
    </ThemedText>
  );

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <View style={themedStyles.header}>
        {canGoBack && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[themedStyles.iconBtn, { backgroundColor: colors.translucent, borderColor: colors.border }]}
          >
            <LucideChevronLeft color={colors.primary} size={22} />
          </TouchableOpacity>
        )}
        <ThemedText className="text-xl font-bold flex-1" style={canGoBack ? { marginLeft: 12 } : undefined}>Transactions</ThemedText>
      </View>

      {/* ── Search bar ── */}
      <View style={themedStyles.searchBar}>
        <LucideSearch color={colors.muted} size={18} />
        <TextInput
          placeholder="Search merchants, categories, or tags…"
          placeholderTextColor={colors.muted}
          style={[themedStyles.searchInput, { color: colors.primary }]}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={{ marginRight: 8 }}>
            <LucideX color={colors.muted} size={16} />
          </TouchableOpacity>
        )}
        <View style={{ width: 1, height: 24, backgroundColor: colors.border, marginHorizontal: 8 }} />
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowFilters(v => !v);
          }}
          style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 8 }}
        >
          <LucideFilter color={activeFilterCount > 0 ? colors.accent : colors.primary} size={18} />
          {activeFilterCount > 0 ? (
            <View style={{ marginLeft: 6, backgroundColor: colors.accent, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
              <ThemedText style={{ color: '#FFF', fontSize: 10, fontWeight: 'bold' }}>{activeFilterCount}</ThemedText>
            </View>
          ) : (
            <ThemedText style={{ marginLeft: 4, fontSize: 13, color: colors.secondary }}>Filter</ThemedText>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Filter Panel ── */}
      {showFilters && (
        <View
          style={[themedStyles.filterPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ paddingBottom: 20 }}>
            <ThemedText style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8, color: colors.accent }}>Advanced Filters</ThemedText>
            {/* Type */}
            <SectionLabel label="Type" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(['all', 'debit', 'credit', 'transfer'] as const).map(t => (
                <FilterChip
                  key={t}
                  label={t === 'all' ? 'All' : t === 'debit' ? 'Expense' : t === 'credit' ? 'Income' : 'Transfer'}
                  active={filters.type === t}
                  onPress={() => setFilters(f => ({ ...f, type: t }))}
                  color={t === 'debit' ? colors.danger : t === 'credit' ? colors.success : t === 'transfer' ? colors.warning : undefined}
                />
              ))}
            </ScrollView>

            {/* Date Range */}
            <SectionLabel label="Date Range" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(
                [
                  { id: 'all', label: 'All Time' },
                  { id: 'today', label: 'Today' },
                  { id: 'week', label: 'Last 7 Days' },
                  { id: 'month', label: 'This Month' },
                  { id: 'last_month', label: 'Last Month' },
                  { id: 'custom', label: 'Custom' },
                ] as { id: DatePreset; label: string }[]
              ).map(item => (
                <FilterChip
                  key={item.id}
                  label={item.label}
                  active={filters.datePreset === item.id}
                  onPress={() => setFilters(f => ({ ...f, datePreset: item.id }))}
                />
              ))}
            </ScrollView>
            {filters.datePreset === 'custom' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TextInput
                  style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, flex: 1 }]}
                  placeholder="From YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  value={filters.customStart}
                  onChangeText={v => setFilters(f => ({ ...f, customStart: v }))}
                />
                <TextInput
                  style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, flex: 1 }]}
                  placeholder="To YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  value={filters.customEnd}
                  onChangeText={v => setFilters(f => ({ ...f, customEnd: v }))}
                />
              </View>
            )}

            {/* Category */}
            <SectionLabel label="Category" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <FilterChip
                label="All"
                active={filters.categoryName === null}
                onPress={() => setFilters(f => ({ ...f, categoryName: null }))}
              />
              {categories.map(c => (
                <FilterChip
                  key={c.id}
                  label={c.name}
                  active={filters.categoryName === c.name}
                  onPress={() =>
                    setFilters(f => ({
                      ...f,
                      categoryName: f.categoryName === c.name ? null : c.name,
                    }))
                  }
                  color={c.color}
                />
              ))}
            </ScrollView>

            {/* Tags */}
            {tagsList.length > 0 && (
              <>
                <SectionLabel label="Tags" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <FilterChip
                    label="All"
                    active={filters.tagValue === null}
                    onPress={() => setFilters(f => ({ ...f, tagValue: null }))}
                  />
                  {tagsList.map(t => (
                    <FilterChip
                      key={t}
                      label={`#${t}`}
                      active={filters.tagValue === t}
                      onPress={() =>
                        setFilters(f => ({
                          ...f,
                          tagValue: f.tagValue === t ? null : t,
                        }))
                      }
                      color={colors.accent}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            {/* Account */}
            <SectionLabel label="Account" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <FilterChip
                label="All"
                active={filters.accountId === null}
                onPress={() => setFilters(f => ({ ...f, accountId: null }))}
              />
              {accounts.map(a => (
                <FilterChip
                  key={a.id}
                  label={a.name}
                  active={filters.accountId === a.id}
                  onPress={() =>
                    setFilters(f => ({
                      ...f,
                      accountId: f.accountId === a.id ? null : a.id,
                    }))
                  }
                />
              ))}
            </ScrollView>

            {/* Amount Range */}
            <SectionLabel label={`Amount Range (${currency})`} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, flex: 1 }]}
                placeholder="Min amount"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                value={filters.minAmount}
                onChangeText={v => setFilters(f => ({ ...f, minAmount: v }))}
              />
              <TextInput
                style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, flex: 1 }]}
                placeholder="Max amount"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                value={filters.maxAmount}
                onChangeText={v => setFilters(f => ({ ...f, maxAmount: v }))}
              />
            </View>

            {/* Source */}
            <SectionLabel label="Source" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'sms', label: 'SMS' },
                  { id: 'manual', label: 'Manual' },
                  { id: 'auto', label: 'Auto' },
                ] as { id: SourceFilter; label: string }[]
              ).map(item => (
                <FilterChip
                  key={item.id}
                  label={item.label}
                  active={filters.source === item.id}
                  onPress={() => setFilters(f => ({ ...f, source: item.id }))}
                />
              ))}
            </ScrollView>

            {/* Sort */}
            <SectionLabel label="Sort By" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(
                [
                  { id: 'newest', label: 'Newest First' },
                  { id: 'oldest', label: 'Oldest First' },
                  { id: 'highest', label: 'Highest Amount' },
                  { id: 'lowest', label: 'Lowest Amount' },
                ] as { id: SortOption; label: string }[]
              ).map(item => (
                <FilterChip
                  key={item.id}
                  label={item.label}
                  active={filters.sort === item.id}
                  onPress={() => setFilters(f => ({ ...f, sort: item.id }))}
                />
              ))}
            </ScrollView>

            {/* Toggles row */}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              {/* Recurring */}
              <TouchableOpacity
                onPress={() => setFilters(f => ({ ...f, recurring: !f.recurring }))}
                style={[
                  themedStyles.toggleChip,
                  {
                    backgroundColor: filters.recurring ? colors.accent + '20' : colors.translucent,
                    borderColor: filters.recurring ? colors.accent : colors.border,
                  },
                ]}
              >
                <LucideRepeat color={filters.recurring ? colors.accent : colors.secondary} size={14} />
                <ThemedText
                  className="ml-1.5 text-xs font-bold"
                  style={{ color: filters.recurring ? colors.accent : colors.secondary }}
                >
                  Recurring Only
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* Reset */}
            {activeFilterCount > 0 && (
              <TouchableOpacity
                onPress={() => setFilters(DEFAULT_FILTERS)}
                style={[themedStyles.resetBtn, { borderColor: colors.danger + '50' }]}
              >
                <LucideX color={colors.danger} size={14} />
                <ThemedText style={{ color: colors.danger, fontWeight: 'bold', fontSize: 13, marginLeft: 6 }}>
                  Reset All Filters
                </ThemedText>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {/* ── Stats bar ── */}
      <View style={[themedStyles.statsBar, { borderBottomColor: colors.border }]}>
        <ThemedText type="secondary" className="text-xs">
          {loading && transactions.length === 0
            ? 'Calculating stats…'
            : `${stats.count} transaction${stats.count !== 1 ? 's' : ''}${hasMore ? '+' : ''}`}
        </ThemedText>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <ThemedText className="text-xs font-bold" style={{ color: colors.danger }}>
            {`-${formatAmount(stats.expenses, currency)}`}
          </ThemedText>
          <ThemedText className="text-xs font-bold" style={{ color: colors.success }}>
            {`+${formatAmount(stats.income, currency)}`}
          </ThemedText>
        </View>
      </View>

      {/* ── List ── */}
      {loading && !refreshing ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      ) : (
        <FlashList
          data={transactions}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }

          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
          onEndReached={() => {
            if (hasMore && !loadingMore && !loading) {
              fetchTransactions(search, filters, false);
            }
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ alignItems: 'center', paddingTop: 80 }}
            >
              <LucideSearch color={colors.muted} size={48} />
              <ThemedText type="secondary" className="mt-4 text-center">
                {search.length > 0 || activeFilterCount > 0
                  ? 'No transactions match your filters.'
                  : 'No transactions yet.'}
              </ThemedText>
            </MotiView>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
            ) : hasMore && transactions.length > 0 ? (
              <TouchableOpacity
                onPress={() => fetchTransactions(search, filters, false)}
                style={[themedStyles.loadMoreBtn, { borderColor: colors.border }]}
              >
                <ThemedText type="secondary" className="text-sm">Load More</ThemedText>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

    </ThemedSafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const createThemedStyles = (colors: any) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 12,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 20,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      padding: 0,
    },
    filterPanel: {
      marginHorizontal: 20,
      marginBottom: 8,
      padding: 16,
      borderRadius: 16,
      borderWidth: 1,
      maxHeight: 380,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      borderWidth: 1,
      marginRight: 8,
      marginBottom: 2,
    },
    toggleChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      flex: 1,
      justifyContent: 'center',
    },
    dateInput: {
      fontSize: 13,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
    },
    resetBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 16,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
    },
    statsBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    txRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    txIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadMoreBtn: {
      alignItems: 'center',
      paddingVertical: 14,
      marginTop: 8,
      borderRadius: 12,
      borderWidth: 1,
    },
  });

export default TransactionsScreen;
