import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { MotiView } from 'moti';
import {
  LucideSearch,
  LucideTrendingUp,
  LucideRepeat,
  LucideX,
  LucideChevronLeft,
} from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { getTransactions, getCategories, Transaction, Category } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { renderCategoryIcon } from '../components/CategoryManager';

type FilterId = 'high' | 'recurring' | null;

// Removed static FILTERS declaration to make it dynamic inside the component

const SearchScreen = () => {
  const { colors } = useTheme();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';

  const FILTERS = [
    { id: 'high' as const, label: `High Spends (${currency}2k+)`, icon: LucideTrendingUp },
    { id: 'recurring' as const, label: 'Recurring', icon: LucideRepeat },
  ];

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterId>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const isFocused = useIsFocused();
  const navigation = useNavigation<any>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTransactions = useCallback(async (query: string, filter: FilterId) => {
    setLoading(true);
 
    const opts: Parameters<typeof getTransactions>[0] = {
      limit: 100,
      confirmedOnly: true,
    };

    if (query.trim()) opts.search = query.trim();
    if (filter === 'high') opts.minAmount = 2000;
    if (filter === 'recurring') opts.isRecurring = true;

    const results = await getTransactions(opts);
    setTransactions(results);
    setLoading(false);
  }, []);

  // Reload when tab gains focus
  useEffect(() => {
    if (isFocused) {
      fetchTransactions(search, activeFilter);
      getCategories().then(setCategories);
    }
  }, [isFocused]);

  // Memoize category lookup map to avoid O(n) find on every transaction row render
  const categoryMap = useMemo(() =>
    new Map(categories.map(c => [c.name, c])),
    [categories]
  );

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchTransactions(search, activeFilter);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, activeFilter, fetchTransactions]);

  const toggleFilter = (id: FilterId) => {
    setActiveFilter(prev => (prev === id ? null : id));
  };

  const renderItem = ({ item }: { item: Transaction }) => {
    const cat = categoryMap.get(item.category);
    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('TransactionDetail', { transaction: item })}
        activeOpacity={0.7}
      >
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex-row justify-between items-center py-4 border-b"
          style={{ borderBottomColor: colors.border }}
        >
          <View className="flex-row items-center flex-1 mr-4">
            <View
              className="w-8 h-8 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: cat?.color ? `${cat.color}20` : colors.translucent }}
            >
              {renderCategoryIcon(cat?.icon ?? '📁', cat?.color || colors.secondary, 16)}
            </View>
            <View className="flex-1">
              <ThemedText className="font-bold" numberOfLines={1}>{item.merchant}</ThemedText>
              <ThemedText type="secondary" className="text-xs mt-0.5" numberOfLines={1}>
                {new Date(item.date).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })} · {item.category}
                {item.isRecurring ? ' · 🔁' : ''}
                {item.tags && item.tags.length > 0 ? ` · ${item.tags.map((t: string) => '#' + t).join(' ')}` : ''}
              </ThemedText>
            </View>
          </View>
          <ThemedText
            font="signal"
            className="font-bold text-base"
            style={{ color: item.type === 'transfer' ? colors.warning : (item.type === 'credit' ? colors.credit : colors.debit) }}
          >
            {item.type === 'credit' ? '+' : (item.type === 'transfer' ? '⇄' : '-')}{currency}{item.amount.toLocaleString('en-IN')}
          </ThemedText>
        </MotiView>
      </TouchableOpacity>
    );
  };

  return (
    <ThemedSafeAreaView>
      {/* Search bar */}
      <View className="px-6 pt-4 pb-2 flex-row items-center gap-3">
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="w-10 h-10 rounded-full items-center justify-center border"
          style={{ backgroundColor: colors.translucent, borderColor: colors.border }}
        >
          <LucideChevronLeft color={colors.primary} size={24} />
        </TouchableOpacity>
        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="h-14 rounded-apple-md flex-row items-center px-4 border flex-1"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
        >
          <LucideSearch color={colors.muted} size={20} />
          <TextInput
            placeholder="Search merchants, categories, or tags..."
            placeholderTextColor={colors.muted}
            className="flex-1 text-base ml-3"
            style={{ color: colors.primary }}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <LucideX color={colors.muted} size={18} />
            </TouchableOpacity>
          )}
        </MotiView>
      </View>

      {/* Filter chips */}
      <View className="py-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-6">
          {FILTERS.map(f => {
            const active = activeFilter === f.id;
            return (
              <TouchableOpacity
                key={f.id}
                onPress={() => toggleFilter(f.id)}
                className={`flex-row items-center px-4 py-2 rounded-full mr-2 border ${active ? 'shadow-sm' : ''}`}
                style={{
                  backgroundColor: active ? colors.primary : colors.surface,
                  borderColor: active ? colors.primary : colors.border
                }}
              >
                <f.icon color={active ? colors.background : colors.secondary} size={14} />
                <ThemedText
                  className="text-xs font-bold ml-1.5"
                  style={{ color: active ? colors.background : colors.primary }}
                >
                  {f.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Result count */}
      <View className="px-6 pb-2">
        <ThemedText type="secondary" className="text-xs">
          {loading ? 'Searching…' : `${transactions.length} result${transactions.length !== 1 ? 's' : ''}`}
        </ThemedText>
      </View>

      {/* List */}
      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <View className="flex-1 px-6">
          <FlashList
            data={transactions}
            renderItem={renderItem}
            keyExtractor={item => item.id.toString()}
            ListEmptyComponent={
              <View className="items-center justify-center pt-20">
                <LucideSearch color={colors.muted} size={48} />
                <ThemedText type="secondary" className="mt-4 text-center">
                  {search.length > 0 || activeFilter
                    ? 'No transactions match your search.'
                    : 'No confirmed transactions yet.'}
                </ThemedText>
              </View>
            }
          />
        </View>
      )}
    </ThemedSafeAreaView>
  );
};

export default SearchScreen;
