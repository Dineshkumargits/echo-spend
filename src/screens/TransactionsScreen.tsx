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
import {
  LucideSearch,
  LucideX,
  LucideSlidersHorizontal,
  LucideRepeat,
  LucideSmartphone,
  LucidePenLine,
  LucideZap,
  LucideRadio,
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
import {
  ScreenHeader, HeaderIconButton, Segmented, SignalRow, GroupLabel,
  PillButton, StatBlock, EmptyState, SheetHandle, PrimaryButton, FieldLabel, TextField,
} from '../components/Kit';
import { AmountText, PulseDot, SectionLabel } from '../components/Signal';
import { fonts } from '../theme/tokens';

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

const fmtShortMoney = (n: number, currency = '₹') => {
  if (n >= 100000) return `${currency}${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${currency}${(n / 1000).toFixed(1)}k`;
  return `${currency}${Math.round(n).toLocaleString('en-IN')}`;
};

/** Mono timeline group label: TODAY / YESTERDAY / MON 8 JUL */
const dayLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

const timeOnly = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
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

  // ── Signal semantics per row ──────────────────────────────────────────────
  const amountKind = (item: Transaction): 'debit' | 'credit' | 'transfer' => {
    if (item.type === 'credit') return 'credit';
    if (item.type === 'transfer') {
      if (filters.accountId && item.toAccountId === filters.accountId) return 'credit';
      if (filters.accountId && item.accountId === filters.accountId) return 'debit';
      return 'transfer';
    }
    return 'debit';
  };

  const sourceGlyph = (source?: string) => {
    if (source === 'sms') return <LucideSmartphone color={colors.muted} size={11} />;
    if (source === 'manual') return <LucidePenLine color={colors.muted} size={11} />;
    if (source === 'auto') return <LucideZap color={colors.muted} size={11} />;
    return null;
  };

  // Date grouping only makes sense in chronological sorts
  const grouped = filters.sort === 'newest' || filters.sort === 'oldest';

  // Flatten headers + rows into one heterogeneous list. Each FlashList cell then
  // renders a single element (a header OR a row) — never a wrapper containing
  // both — which is what FlashList v2's auto-measurement needs to size cells
  // correctly. Wrapping a header and a row in one <View> was throwing off the
  // measurement and causing the rows to render misaligned/overlapping.
  type ListRow =
    | { kind: 'header'; id: string; label: string }
    | { kind: 'tx'; id: string; tx: Transaction };

  const listData = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    let lastLabel = '';
    transactions.forEach(tx => {
      if (grouped) {
        const label = dayLabel(tx.date);
        if (label !== lastLabel) {
          out.push({ kind: 'header', id: `h-${label}`, label });
          lastLabel = label;
        }
      }
      out.push({ kind: 'tx', id: `t-${tx.id}`, tx });
    });
    return out;
  }, [transactions, grouped]);

  // ─── Timeline row ─────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListRow }) => {
    if (item.kind === 'header') {
      return <GroupLabel label={item.label} />;
    }
    const tx = item.tx;
    const cat = categoryMap.get(tx.category);
    const kind = amountKind(tx);
    const nodeColor = kind === 'credit' ? colors.credit : kind === 'debit' ? colors.debit : colors.secondary;

    return (
      <SignalRow
        emoji={cat?.icon ?? '📁'}
        iconColor={cat?.color || colors.secondary}
        title={tx.merchant}
        subtitle={`${timeOnly(tx.date)} · ${tx.category}${getAccountLabel(tx)}${tx.tags && tx.tags.length > 0 ? ` · ${tx.tags.map((t: string) => '#' + t).join(' ')}` : ''}`}
        nodeColor={nodeColor}
        badges={
          <>
            {sourceGlyph(tx.source)}
            {tx.isRecurring ? <LucideRepeat color={colors.ai} size={11} /> : null}
            {!tx.isConfirmed ? <PulseDot size={6} /> : null}
          </>
        }
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
        onPress={() => openDetail(tx)}
        rail={false}
      />
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <ScreenHeader
        eyebrow="Ledger"
        title="Transactions"
        onBack={canGoBack ? () => navigation.goBack() : undefined}
        right={
          <HeaderIconButton onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowFilters(true); }} tint={activeFilterCount > 0 ? colors.accent : undefined}>
            <LucideSlidersHorizontal color={activeFilterCount > 0 ? colors.accent : colors.secondary} size={17} />
            {activeFilterCount > 0 && (
              <View style={{ position: 'absolute', top: -3, right: -3, backgroundColor: colors.accent, borderRadius: 99, minWidth: 15, height: 15, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                <ThemedText font="signal" style={{ fontSize: 8, color: colors.background }}>{activeFilterCount}</ThemedText>
              </View>
            )}
          </HeaderIconButton>
        }
      />

      {/* ── Search ── */}
      <View style={{ paddingHorizontal: 24, marginBottom: 10 }}>
        <TextField
          placeholder="Search merchants, categories, #tags…"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          leading={<LucideSearch color={colors.muted} size={16} />}
          trailing={search.length > 0 ? (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <LucideX color={colors.muted} size={15} />
            </TouchableOpacity>
          ) : undefined}
        />
      </View>

      {/* ── Type segmented (underline style) ── */}
      <Segmented
        value={filters.type}
        onChange={t => setFilters(f => ({ ...f, type: t }))}
        options={[
          { key: 'all', label: 'All' },
          { key: 'debit', label: 'Out', color: colors.debit },
          { key: 'credit', label: 'In', color: colors.credit },
          { key: 'transfer', label: 'Moves', color: colors.secondary },
        ]}
      />

      {/* ── Totals strip ── */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 24, paddingVertical: 14, gap: 24, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <StatBlock label="Signals" value={`${stats.count}${hasMore ? '+' : ''}`} style={{ flex: 1 }} />
        <StatBlock label="Out" value={preferences.hideAmounts ? '••••' : `−${fmtShortMoney(stats.expenses, currency)}`} color={colors.debit} style={{ flex: 1 }} />
        <StatBlock label="In" value={preferences.hideAmounts ? '••••' : `+${fmtShortMoney(stats.income, currency)}`} color={colors.credit} style={{ flex: 1 }} />
      </View>

      {/* ── Timeline list ── */}
      {loading && !refreshing ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      ) : (
        <FlashList
          data={listData}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          getItemType={item => item.kind}
          extraData={`${filters.accountId}-${filters.sort}-${preferences.hideAmounts}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          onEndReached={() => {
            if (hasMore && !loadingMore && !loading) {
              fetchTransactions(search, filters, false);
            }
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon={<LucideRadio color={colors.muted} size={44} />}
              title="No signals here"
              subtitle={search.length > 0 || activeFilterCount > 0
                ? 'Nothing matches this search or filter set. Try widening the net.'
                : 'Confirmed transactions will appear on this timeline.'}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
            ) : hasMore && transactions.length > 0 ? (
              <TouchableOpacity
                onPress={() => fetchTransactions(search, filters, false)}
                style={{ alignItems: 'center', paddingVertical: 16 }}
              >
                <SectionLabel color={colors.accent}>Load more ↓</SectionLabel>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* ── Filter sheet ── */}
      <Modal
        visible={showFilters}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilters(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(4,10,11,0.6)', justifyContent: 'flex-end' }}
          onPress={() => setShowFilters(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ maxHeight: '85%' }}
          >
            <Pressable
              onPress={e => e.stopPropagation()}
              style={{
                backgroundColor: colors.background,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderWidth: 1,
                borderColor: colors.border,
                maxHeight: '100%',
              }}
            >
              <SheetHandle
                title="Tune the signal"
                onClose={() => setShowFilters(false)}
                right={activeFilterCount > 0 ? (
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                      setFilters(DEFAULT_FILTERS);
                    }}
                  >
                    <SectionLabel color={colors.danger}>Reset</SectionLabel>
                  </TouchableOpacity>
                ) : undefined}
              />

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
              >
                {/* Date presets */}
                <FieldLabel style={{ marginTop: 14 }}>Window</FieldLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    [
                      { id: 'all', label: 'All time' },
                      { id: 'today', label: 'Today' },
                      { id: 'week', label: '7 days' },
                      { id: 'month', label: 'This month' },
                      { id: 'last_month', label: 'Last month' },
                      { id: 'custom', label: 'Custom' },
                    ] as { id: DatePreset; label: string }[]
                  ).map(item => (
                    <PillButton
                      key={item.id}
                      label={item.label}
                      active={filters.datePreset === item.id}
                      onPress={() => setFilters(f => ({ ...f, datePreset: item.id }))}
                    />
                  ))}
                </View>

                {filters.datePreset === 'custom' && (
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <View style={{ flex: 1 }}>
                      <FieldLabel>From</FieldLabel>
                      <TextField
                        placeholder="YYYY-MM-DD"
                        value={filters.customStart}
                        onChangeText={v => setFilters(f => ({ ...f, customStart: v }))}
                        style={{ fontFamily: fonts.signal, fontSize: 13 }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <FieldLabel>To</FieldLabel>
                      <TextField
                        placeholder="YYYY-MM-DD"
                        value={filters.customEnd}
                        onChangeText={v => setFilters(f => ({ ...f, customEnd: v }))}
                        style={{ fontFamily: fonts.signal, fontSize: 13 }}
                      />
                    </View>
                  </View>
                )}

                {/* Amount range */}
                <FieldLabel style={{ marginTop: 20 }}>Amount range ({currency})</FieldLabel>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <TextField
                      placeholder="min"
                      keyboardType="numeric"
                      value={filters.minAmount}
                      onChangeText={v => setFilters(f => ({ ...f, minAmount: v }))}
                      style={{ fontFamily: fonts.signal, fontSize: 13 }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <TextField
                      placeholder="max"
                      keyboardType="numeric"
                      value={filters.maxAmount}
                      onChangeText={v => setFilters(f => ({ ...f, maxAmount: v }))}
                      style={{ fontFamily: fonts.signal, fontSize: 13 }}
                    />
                  </View>
                </View>

                {/* Account */}
                <FieldLabel style={{ marginTop: 20 }}>Account</FieldLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <PillButton
                    label="All"
                    active={filters.accountId === null}
                    onPress={() => setFilters(f => ({ ...f, accountId: null }))}
                  />
                  {accounts.map(a => (
                    <PillButton
                      key={a.id}
                      label={a.name}
                      active={filters.accountId === a.id}
                      onPress={() => setFilters(f => ({ ...f, accountId: f.accountId === a.id ? null : a.id }))}
                    />
                  ))}
                </ScrollView>

                {/* Category */}
                <FieldLabel style={{ marginTop: 20 }}>Category</FieldLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  <PillButton
                    label="All"
                    active={filters.categoryName === null}
                    onPress={() => setFilters(f => ({ ...f, categoryName: null }))}
                  />
                  {categories.map(c => (
                    <PillButton
                      key={c.id}
                      label={c.name}
                      color={c.color}
                      active={filters.categoryName === c.name}
                      onPress={() => setFilters(f => ({ ...f, categoryName: f.categoryName === c.name ? null : c.name }))}
                    />
                  ))}
                </ScrollView>

                {/* Tag */}
                {tagsList.length > 0 && (
                  <>
                    <FieldLabel style={{ marginTop: 20 }}>Tag</FieldLabel>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <PillButton
                        label="All"
                        active={filters.tagValue === null}
                        onPress={() => setFilters(f => ({ ...f, tagValue: null }))}
                      />
                      {tagsList.map(t => (
                        <PillButton
                          key={t}
                          label={`#${t}`}
                          color={colors.ai}
                          active={filters.tagValue === t}
                          onPress={() => setFilters(f => ({ ...f, tagValue: f.tagValue === t ? null : t }))}
                        />
                      ))}
                    </ScrollView>
                  </>
                )}

                {/* Source */}
                <FieldLabel style={{ marginTop: 20 }}>Source</FieldLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'sms', label: 'SMS' },
                      { id: 'manual', label: 'Manual' },
                      { id: 'auto', label: 'Auto' },
                    ] as { id: SourceFilter; label: string }[]
                  ).map(item => (
                    <PillButton
                      key={item.id}
                      label={item.label}
                      active={filters.source === item.id}
                      onPress={() => setFilters(f => ({ ...f, source: item.id }))}
                    />
                  ))}
                </View>

                {/* Sort */}
                <FieldLabel style={{ marginTop: 20 }}>Order</FieldLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {(
                    [
                      { id: 'newest', label: 'Newest' },
                      { id: 'oldest', label: 'Oldest' },
                      { id: 'highest', label: 'Biggest' },
                      { id: 'lowest', label: 'Smallest' },
                    ] as { id: SortOption; label: string }[]
                  ).map(item => (
                    <PillButton
                      key={item.id}
                      label={item.label}
                      active={filters.sort === item.id}
                      onPress={() => setFilters(f => ({ ...f, sort: item.id }))}
                    />
                  ))}
                </View>

                {/* Recurring toggle */}
                <FieldLabel style={{ marginTop: 20 }}>Special</FieldLabel>
                <PillButton
                  label="Recurring only"
                  icon={<LucideRepeat color={filters.recurring ? colors.ai : colors.secondary} size={12} />}
                  color={colors.ai}
                  active={filters.recurring}
                  onPress={() => setFilters(f => ({ ...f, recurring: !f.recurring }))}
                  style={{ alignSelf: 'flex-start' }}
                />

                <View style={{ height: 24 }} />

                <PrimaryButton
                  label={activeFilterCount > 0 ? `Apply · ${activeFilterCount} active` : 'Apply'}
                  onPress={() => {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setShowFilters(false);
                  }}
                  style={{ marginBottom: Platform.OS === 'ios' ? 20 : 8 }}
                />
              </ScrollView>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </ThemedSafeAreaView>
  );
};

export default TransactionsScreen;
