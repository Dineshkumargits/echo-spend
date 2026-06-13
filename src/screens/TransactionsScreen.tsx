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
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from 'react-native';
import { MotiView } from 'moti';
import {
  LucideSearch,
  LucideX,
  LucideChevronLeft,
  LucideSlidersHorizontal,
  LucideFilter,
  LucideRepeat,
  LucideCheck,
  LucideSmartphone,
  LucidePenLine,
  LucideZap,
  LucideAlertCircle,
} from 'lucide-react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
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
    if (isFocused) {
      Promise.all([getCategories(), getAccounts(), getAllUniqueTags()]).then(([cats, accs, tgs]) => {
        setCategories(cats); // show all including subcategories
        setAccounts(accs);
        setTagsList(tgs);
      });
    }
  }, [isFocused]);

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

  // Memoize category lookup map to avoid O(n) find on every transaction row render
  const categoryMap = useMemo(() =>
    new Map(categories.map(c => [c.name, c])),
    [categories]
  );

  // O(1) account name lookup — accounts are already loaded for the filter UI
  const accountMap = useMemo(() =>
    new Map(accounts.map(a => [a.id, a.name])),
    [accounts]
  );

  // Returns a formatted account label string (with leading " · ") or empty string
  const getAccountLabel = (item: Transaction): string => {
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
  };

  // ─── Render helpers ──────────────────────────────────────────────────────

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

  const renderItem = ({ item }: { item: Transaction }) => {
    const cat = categoryMap.get(item.category);
    return (
      <TouchableOpacity
        onPress={() => openDetail(item)}
        activeOpacity={0.7}
        style={[themedStyles.txRow, { borderBottomColor: colors.border }]}
      >
        {/* Left icon */}
        <View
          style={[
            themedStyles.txIcon,
            { backgroundColor: cat?.color ? `${cat.color}20` : colors.translucent }
          ]}
        >
          {renderCategoryIcon(cat?.icon ?? '📁', cat?.color || colors.secondary, 18)}
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
              {formatDateShort(item.date)} · {item.category}{getAccountLabel(item)}
              {item.tags && item.tags.length > 0 ? ` · ${item.tags.map((t: string) => '#' + t).join(' ')}` : ''}
            </ThemedText>
          </View>
        </View>
        <ThemedText className="font-bold text-[15px]" style={{ color: amountColor(item) }}>
          {amountPrefix(item)}{formatAmount(item.amount, currency)}
        </ThemedText>
      </TouchableOpacity>
    );
  };



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
          <TouchableOpacity onPress={() => setSearch('')}>
            <LucideX color={colors.muted} size={16} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Quick Filter Bar ── */}
      <View style={{ marginBottom: 4 }}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={themedStyles.quickFilterScroll}
        >
          {/* Advanced Filter Button */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowFilters(true);
            }}
            style={[
              themedStyles.quickFilterBtn,
              {
                backgroundColor: activeFilterCount > 0 ? `${colors.accent}15` : colors.surface,
                borderColor: activeFilterCount > 0 ? colors.accent : colors.border,
              }
            ]}
          >
            <LucideSlidersHorizontal color={activeFilterCount > 0 ? colors.accent : colors.primary} size={14} />
            <ThemedText 
              className="font-bold text-xs ml-1.5" 
              style={{ color: activeFilterCount > 0 ? colors.accent : colors.primary }}
            >
              Filters
            </ThemedText>
            {activeFilterCount > 0 && (
              <View style={{ marginLeft: 6, backgroundColor: colors.accent, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 99 }}>
                <ThemedText style={{ color: '#FFF', fontSize: 9, fontWeight: '900' }}>{activeFilterCount}</ThemedText>
              </View>
            )}
          </TouchableOpacity>

          {/* Quick Chip: Expense */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilters(f => ({ ...f, type: f.type === 'debit' ? 'all' : 'debit' }));
            }}
            style={[
              themedStyles.quickFilterBtn,
              {
                backgroundColor: filters.type === 'debit' ? `${colors.danger}15` : colors.surface,
                borderColor: filters.type === 'debit' ? colors.danger : colors.border,
              }
            ]}
          >
            <ThemedText 
              className="font-bold text-xs" 
              style={{ color: filters.type === 'debit' ? colors.danger : colors.secondary }}
            >
              Expense
            </ThemedText>
          </TouchableOpacity>

          {/* Quick Chip: Income */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilters(f => ({ ...f, type: f.type === 'credit' ? 'all' : 'credit' }));
            }}
            style={[
              themedStyles.quickFilterBtn,
              {
                backgroundColor: filters.type === 'credit' ? `${colors.success}15` : colors.surface,
                borderColor: filters.type === 'credit' ? colors.success : colors.border,
              }
            ]}
          >
            <ThemedText 
              className="font-bold text-xs" 
              style={{ color: filters.type === 'credit' ? colors.success : colors.secondary }}
            >
              Income
            </ThemedText>
          </TouchableOpacity>

          {/* Quick Chip: This Month */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilters(f => ({ ...f, datePreset: f.datePreset === 'month' ? 'all' : 'month' }));
            }}
            style={[
              themedStyles.quickFilterBtn,
              {
                backgroundColor: filters.datePreset === 'month' ? `${colors.accent}15` : colors.surface,
                borderColor: filters.datePreset === 'month' ? colors.accent : colors.border,
              }
            ]}
          >
            <ThemedText 
              className="font-bold text-xs" 
              style={{ color: filters.datePreset === 'month' ? colors.accent : colors.secondary }}
            >
              This Month
            </ThemedText>
          </TouchableOpacity>

          {/* Quick Chip: Recurring */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setFilters(f => ({ ...f, recurring: !f.recurring }));
            }}
            style={[
              themedStyles.quickFilterBtn,
              {
                backgroundColor: filters.recurring ? `${colors.accent}15` : colors.surface,
                borderColor: filters.recurring ? colors.accent : colors.border,
              }
            ]}
          >
            <LucideRepeat color={filters.recurring ? colors.accent : colors.secondary} size={11} />
            <ThemedText 
              className="font-bold text-xs ml-1" 
              style={{ color: filters.recurring ? colors.accent : colors.secondary }}
            >
              Recurring
            </ThemedText>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* ── Advanced Filters Modal ── */}
      <Modal
        visible={showFilters}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilters(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
          onPress={() => setShowFilters(false)}
        >
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ maxHeight: '85%' }}
          >
            <Pressable
              onPress={e => e.stopPropagation()}
              style={[themedStyles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {/* Header */}
              <View style={[themedStyles.modalHeader, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <ThemedText className="font-bold text-lg">Filter Transactions</ThemedText>
                  {activeFilterCount > 0 && (
                    <ThemedText type="secondary" className="text-xs mt-0.5">
                      {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                    </ThemedText>
                  )}
                </View>
                {activeFilterCount > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      setFilters(DEFAULT_FILTERS);
                    }}
                    style={{ marginRight: 16 }}
                  >
                    <ThemedText style={{ color: colors.danger, fontWeight: '700', fontSize: 13 }}>Reset All</ThemedText>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => setShowFilters(false)}
                  style={[themedStyles.closeBtn, { backgroundColor: colors.translucent }]}
                >
                  <LucideX color={colors.primary} size={18} />
                </TouchableOpacity>
              </View>

              {/* Scrollable filters */}
              <ScrollView 
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
              >
                {/* Type */}
                <SectionLabel label="Transaction Type" />
                <View style={themedStyles.typeGrid}>
                  {(['all', 'debit', 'credit', 'transfer'] as const).map(t => {
                    const active = filters.type === t;
                    const label = t === 'all' ? 'All' : t === 'debit' ? 'Expense' : t === 'credit' ? 'Income' : 'Transfer';
                    const activeColor = t === 'debit' ? colors.danger : t === 'credit' ? colors.success : t === 'transfer' ? colors.warning : colors.accent;
                    return (
                      <TouchableOpacity
                        key={t}
                        onPress={() => setFilters(f => ({ ...f, type: t }))}
                        style={[
                          themedStyles.typeSegment,
                          {
                            backgroundColor: active ? `${activeColor}15` : colors.translucent,
                            borderColor: active ? activeColor : 'transparent',
                          }
                        ]}
                      >
                        <ThemedText 
                          className="font-bold text-xs" 
                          style={{ color: active ? activeColor : colors.secondary }}
                        >
                          {label}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Date presets */}
                <SectionLabel label="Date Preset" />
                <View style={themedStyles.presetGrid}>
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
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => setFilters(f => ({ ...f, datePreset: item.id }))}
                      style={[
                        themedStyles.gridChip,
                        {
                          backgroundColor: filters.datePreset === item.id ? `${colors.accent}15` : colors.translucent,
                          borderColor: filters.datePreset === item.id ? colors.accent : 'transparent',
                        }
                      ]}
                    >
                      <ThemedText 
                        className="font-bold text-xs" 
                        style={{ color: filters.datePreset === item.id ? colors.accent : colors.secondary }}
                      >
                        {item.label}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Custom date range picker (if custom is selected) */}
                {filters.datePreset === 'custom' && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="secondary" style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>START DATE</ThemedText>
                      <TextInput
                        style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, backgroundColor: colors.translucent }]}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.muted}
                        value={filters.customStart}
                        onChangeText={v => setFilters(f => ({ ...f, customStart: v }))}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="secondary" style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>END DATE</ThemedText>
                      <TextInput
                        style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, backgroundColor: colors.translucent }]}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.muted}
                        value={filters.customEnd}
                        onChangeText={v => setFilters(f => ({ ...f, customEnd: v }))}
                      />
                    </View>
                  </View>
                )}

                {/* Amount range */}
                <SectionLabel label={`Amount Range (${currency})`} />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="secondary" style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>MIN AMOUNT</ThemedText>
                    <TextInput
                      style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, backgroundColor: colors.translucent }]}
                      placeholder="e.g. 100"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      value={filters.minAmount}
                      onChangeText={v => setFilters(f => ({ ...f, minAmount: v }))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="secondary" style={{ fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>MAX AMOUNT</ThemedText>
                    <TextInput
                      style={[themedStyles.dateInput, { color: colors.primary, borderColor: colors.border, backgroundColor: colors.translucent }]}
                      placeholder="e.g. 5000"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      value={filters.maxAmount}
                      onChangeText={v => setFilters(f => ({ ...f, maxAmount: v }))}
                    />
                  </View>
                </View>

                {/* Account */}
                <SectionLabel label="Account" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setFilters(f => ({ ...f, accountId: null }))}
                    style={[
                      themedStyles.horizontalChip,
                      {
                        backgroundColor: filters.accountId === null ? `${colors.accent}15` : colors.translucent,
                        borderColor: filters.accountId === null ? colors.accent : 'transparent',
                      }
                    ]}
                  >
                    <ThemedText className="font-bold text-xs" style={{ color: filters.accountId === null ? colors.accent : colors.secondary }}>All Accounts</ThemedText>
                  </TouchableOpacity>
                  {accounts.map(a => {
                    const active = filters.accountId === a.id;
                    const emoji = a.accountType === 'credit_card' ? '💳' : a.accountType === 'cash' ? '💵' : a.accountType === 'wallet' ? '👛' : '🏦';
                    return (
                      <TouchableOpacity
                        key={a.id}
                        onPress={() => setFilters(f => ({ ...f, accountId: f.accountId === a.id ? null : a.id }))}
                        style={[
                          themedStyles.horizontalChip,
                          {
                            backgroundColor: active ? `${colors.accent}15` : colors.translucent,
                            borderColor: active ? colors.accent : 'transparent',
                          }
                        ]}
                      >
                        <ThemedText style={{ fontSize: 12, marginRight: 4 }}>{emoji}</ThemedText>
                        <ThemedText className="font-bold text-xs" style={{ color: active ? colors.accent : colors.secondary }}>{a.name}</ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Category */}
                <SectionLabel label="Category" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setFilters(f => ({ ...f, categoryName: null }))}
                    style={[
                      themedStyles.horizontalChip,
                      {
                        backgroundColor: filters.categoryName === null ? `${colors.accent}15` : colors.translucent,
                        borderColor: filters.categoryName === null ? colors.accent : 'transparent',
                      }
                    ]}
                  >
                    <ThemedText className="font-bold text-xs" style={{ color: filters.categoryName === null ? colors.accent : colors.secondary }}>All Categories</ThemedText>
                  </TouchableOpacity>
                  {categories.map(c => {
                    const active = filters.categoryName === c.name;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => setFilters(f => ({ ...f, categoryName: f.categoryName === c.name ? null : c.name }))}
                        style={[
                          themedStyles.horizontalChip,
                          {
                            backgroundColor: active ? `${c.color}20` : colors.translucent,
                            borderColor: active ? c.color : 'transparent',
                          }
                        ]}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.color, marginRight: 6 }} />
                        <ThemedText className="font-bold text-xs" style={{ color: active ? colors.primary : colors.secondary }}>{c.name}</ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Source */}
                <SectionLabel label="Source" />
                <View style={themedStyles.sourceGrid}>
                  {(
                    [
                      { id: 'all', label: 'All Sources' },
                      { id: 'sms', label: 'SMS' },
                      { id: 'manual', label: 'Manual' },
                      { id: 'auto', label: 'Auto' },
                    ] as { id: SourceFilter; label: string }[]
                  ).map(item => (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => setFilters(f => ({ ...f, source: item.id }))}
                      style={[
                        themedStyles.gridChip,
                        {
                          backgroundColor: filters.source === item.id ? `${colors.accent}15` : colors.translucent,
                          borderColor: filters.source === item.id ? colors.accent : 'transparent',
                        }
                      ]}
                    >
                      <ThemedText 
                        className="font-bold text-xs" 
                        style={{ color: filters.source === item.id ? colors.accent : colors.secondary }}
                      >
                        {item.label}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Sort order */}
                <SectionLabel label="Sort By" />
                <View style={themedStyles.presetGrid}>
                  {(
                    [
                      { id: 'newest', label: 'Newest First' },
                      { id: 'oldest', label: 'Oldest First' },
                      { id: 'highest', label: 'Highest Amount' },
                      { id: 'lowest', label: 'Lowest Amount' },
                    ] as { id: SortOption; label: string }[]
                  ).map(item => (
                    <TouchableOpacity
                      key={item.id}
                      onPress={() => setFilters(f => ({ ...f, sort: item.id }))}
                      style={[
                        themedStyles.gridChip,
                        {
                          backgroundColor: filters.sort === item.id ? `${colors.accent}15` : colors.translucent,
                          borderColor: filters.sort === item.id ? colors.accent : 'transparent',
                        }
                      ]}
                    >
                      <ThemedText 
                        className="font-bold text-xs" 
                        style={{ color: filters.sort === item.id ? colors.accent : colors.secondary }}
                      >
                        {item.label}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Toggles (Recurring) */}
                <SectionLabel label="Special" />
                <TouchableOpacity
                  onPress={() => setFilters(f => ({ ...f, recurring: !f.recurring }))}
                  style={[
                    themedStyles.toggleRow,
                    {
                      backgroundColor: filters.recurring ? `${colors.accent}15` : colors.translucent,
                      borderColor: filters.recurring ? colors.accent : 'transparent',
                      marginBottom: 20,
                    }
                  ]}
                >
                  <LucideRepeat color={filters.recurring ? colors.accent : colors.secondary} size={16} />
                  <ThemedText 
                    className="font-bold text-xs ml-2" 
                    style={{ color: filters.recurring ? colors.accent : colors.secondary }}
                  >
                    Recurring Transactions Only
                  </ThemedText>
                </TouchableOpacity>

                {/* Spacer */}
                <View style={{ height: 40 }} />
              </ScrollView>

              {/* Floating bottom Apply area */}
              <View 
                style={[
                  themedStyles.modalFooter, 
                  { 
                    backgroundColor: colors.surface, 
                    borderTopColor: colors.border,
                  }
                ]}
              >
                <TouchableOpacity
                  onPress={() => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setShowFilters(false);
                  }}
                  style={[themedStyles.applyBtn, { backgroundColor: colors.accent }]}
                >
                  <LucideCheck color="#FFF" size={18} style={{ marginRight: 6 }} />
                  <ThemedText className="font-bold" style={{ color: '#FFF' }}>
                    Apply Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

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
      marginBottom: 12,
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
    quickFilterScroll: {
      paddingHorizontal: 20,
      paddingBottom: 16,
      gap: 8,
      flexDirection: 'row',
    },
    quickFilterBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 99,
      borderWidth: 1,
    },
    modalSheet: {
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderWidth: 1,
      maxHeight: '100%',
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 18,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    closeBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    typeGrid: {
      flexDirection: 'row',
      gap: 8,
    },
    typeSegment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderRadius: 12,
      borderWidth: 1,
    },
    presetGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    sourceGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    gridChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      minWidth: '28%',
      flexGrow: 1,
      alignItems: 'center',
    },
    horizontalChip: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
    },
    modalFooter: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 28 : 16,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    applyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 14,
    },
    dateInput: {
      fontSize: 13,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 10,
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
