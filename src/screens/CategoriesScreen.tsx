import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import {
  LucideChevronLeft, LucidePlus, LucideSearch, LucideX,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { getCategories, Category } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useCategoryManager, CategoryManagerModal } from '../components/CategoryManager';

const CategoriesScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');
  const [search, setSearch] = useState('');

  const loadCategories = async () => {
    const data = await getCategories();
    setCategories(data);
    setLoading(false);
  };

  useEffect(() => { loadCategories(); }, []);

  const manager = useCategoryManager(loadCategories);

  const filteredRootCategories = useMemo(() => {
    const roots = categories.filter(c => !c.parentId && c.type === activeTab);
    if (!search.trim()) return roots;
    const q = search.toLowerCase();
    return roots.filter(c =>
      c.name.toLowerCase().includes(q) ||
      categories.some(sub => sub.parentId === c.id && sub.name.toLowerCase().includes(q))
    );
  }, [categories, activeTab, search]);

  const subsMap = useMemo(() => {
    const map = new Map<number, Category[]>();
    for (const c of categories) {
      if (c.parentId) {
        const arr = map.get(c.parentId) ?? [];
        arr.push(c);
        map.set(c.parentId, arr);
      }
    }
    return map;
  }, [categories]);

  return (
    <ThemedSafeAreaView>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[s.iconBtn, { backgroundColor: colors.translucent }]}
        >
          <LucideChevronLeft color={colors.primary} size={24} />
        </TouchableOpacity>
        <ThemedText style={s.headerTitle}>Categories</ThemedText>
        <TouchableOpacity
          onPress={() => manager.openNew(activeTab)}
          style={[s.iconBtn, { backgroundColor: colors.accent }]}
        >
          <LucidePlus color="#FFFFFF" size={24} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={s.tabsContainer}>
        <View style={[s.tabsRow, { backgroundColor: colors.translucent }]}>
          {(['expense', 'income'] as const).map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => { setActiveTab(t); setSearch(''); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={[s.tabBtn, activeTab === t && { backgroundColor: colors.surface }]}
            >
              <Text style={{ fontSize: 14, marginRight: 4 }}>{t === 'expense' ? '💸' : '💰'}</Text>
              <ThemedText style={[s.tabLabel, { color: activeTab === t ? colors.primary : colors.secondary }]}>
                {t === 'expense' ? 'Expenses' : 'Income'}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Search bar */}
      <View style={[s.searchBar, { backgroundColor: colors.translucent, borderColor: colors.border }]}>
        <LucideSearch color={colors.secondary} size={16} />
        <TextInput
          style={[s.searchInput, { color: colors.primary }]}
          placeholder="Search categories…"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <LucideX color={colors.secondary} size={14} />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.listContent}
      >
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : filteredRootCategories.length === 0 ? (
          <View style={[s.empty, { borderColor: colors.border }]}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>
              {search ? '🔍' : (activeTab === 'expense' ? '💸' : '💰')}
            </Text>
            <ThemedText style={s.emptyTitle}>
              {search ? 'No results' : 'No categories yet'}
            </ThemedText>
            <ThemedText type="secondary" style={s.emptySubtitle}>
              {search
                ? `No ${activeTab} categories match "${search}"`
                : `Tap + to create your first ${activeTab} category`}
            </ThemedText>
            {!search && (
              <TouchableOpacity
                onPress={() => manager.openNew(activeTab)}
                style={[s.emptyBtn, { backgroundColor: colors.accent }]}
              >
                <ThemedText style={{ color: '#fff', fontWeight: 'bold' }}>Create Category</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={s.grid}>
            {filteredRootCategories.map(parent => {
              const subs = subsMap.get(parent.id!) ?? [];
              const filteredSubs = search.trim()
                ? subs.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
                : subs;

              return (
                <View key={parent.id} style={s.cardWrapper}>
                  {/* Parent card */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => manager.openEdit(parent)}
                    style={[s.card, { backgroundColor: colors.surface, borderColor: `${parent.color}30` }]}
                  >
                    {/* Top row: emoji + add sub button */}
                    <View style={s.cardTop}>
                      <View style={[s.emojiCircle, { backgroundColor: `${parent.color}18` }]}>
                        <Text style={s.emojiText}>{
                          (() => {
                            const icon = parent.icon;
                            // Simple emoji detection — non-PascalCase means it's already emoji
                            return /^[A-Z][a-zA-Z0-9]+$/.test(icon) ? '📁' : icon;
                          })()
                        }</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => manager.openNew(activeTab, parent.id)}
                        style={[s.addSubBtn, { backgroundColor: colors.translucent }]}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <LucidePlus color={colors.accent} size={16} />
                      </TouchableOpacity>
                    </View>

                    {/* Category name + count */}
                    <View style={{ marginTop: 8 }}>
                      <ThemedText style={s.cardName} numberOfLines={2}>{parent.name}</ThemedText>
                      <ThemedText type="secondary" style={s.cardCount}>
                        {subs.length > 0 ? `${subs.length} sub${subs.length > 1 ? 'categories' : 'category'}` : 'Tap to edit'}
                      </ThemedText>
                    </View>

                    {/* Color accent bar at bottom */}
                    <View style={[s.colorBar, { backgroundColor: parent.color }]} />
                  </TouchableOpacity>

                  {/* Subcategory list */}
                  {filteredSubs.length > 0 && (
                    <View style={s.subList}>
                      {filteredSubs.map(sub => (
                        <TouchableOpacity
                          key={sub.id}
                          onPress={() => manager.openEdit(sub)}
                          style={[s.subRow, { borderTopColor: colors.border }]}
                          activeOpacity={0.7}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <Text style={s.subIcon}>
                              {/^[A-Z][a-zA-Z0-9]+$/.test(sub.icon) ? '📁' : sub.icon}
                            </Text>
                            <ThemedText style={s.subLabel}>{sub.name}</ThemedText>
                          </View>
                          <View style={[s.subIndicator, { backgroundColor: sub.color }]} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <CategoryManagerModal
        manager={manager}
        onRefresh={loadCategories}
      />
    </ThemedSafeAreaView>
  );
};

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tabsContainer: { paddingHorizontal: 20, marginBottom: 12 },
  tabsRow: { flexDirection: 'row', borderRadius: 14, padding: 4 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10 },
  tabLabel: { fontSize: 13, fontWeight: 'bold' },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 16,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  listContent: { paddingHorizontal: 16, paddingBottom: 120 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  cardWrapper: { width: '47.5%' },
  card: {
    borderRadius: 20, padding: 14, borderWidth: 1.5,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  emojiCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 26 },
  addSubBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 15, fontWeight: 'bold', lineHeight: 20, marginBottom: 2 },
  cardCount: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  colorBar: { height: 3, borderRadius: 2, marginTop: 12 },
  subList: { marginTop: 4 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  subIcon: { fontSize: 12, marginRight: 8 },
  subLabel: { fontSize: 11, fontWeight: '500' },
  subIndicator: { width: 3, height: 3, borderRadius: 1.5 },
  empty: { alignItems: 'center', justifyContent: 'center', marginTop: 60, padding: 32, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed' },
  emptyTitle: { fontSize: 17, fontWeight: 'bold', textAlign: 'center', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: 20, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 24 },
});

export default CategoriesScreen;
