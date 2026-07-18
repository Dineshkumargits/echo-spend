import React, { useState, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  StyleSheet,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { GestureHandlerRootView, ScrollView as GHScrollView } from 'react-native-gesture-handler';
import {
  LucideTag,
  LucideSearch,
  LucideX,
  LucideCheck
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from './ThemedSafeAreaView';
import { Category } from '../services/database';
import { CategoryManagerModal, renderCategoryIcon, useCategoryManager } from './CategoryManager';


interface CategoryPickerProps {
  selectedCategory: string;
  onSelect: (categoryName: string) => void;
  categories: Category[];
  type: 'expense' | 'income' | 'transfer' | 'all';
  label?: string;
  variant?: 'square' | 'row';
  refreshCategories: () => void;
}

export const CategoryPicker: React.FC<CategoryPickerProps> = ({
  selectedCategory,
  onSelect,
  categories,
  type,
  label = 'Category',
  variant = 'square',
  refreshCategories,
}) => {
  const { colors, isDark } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [search, setSearch] = useState('');

  const categoryManager = useCategoryManager(refreshCategories);

  const activeCat = useMemo(() =>
    categories.find(c => c.name === selectedCategory),
    [categories, selectedCategory]);

  const filteredCategories = useMemo(() => {
    return categories
      .filter(c => !c.parentId && (
        type === 'all' ? true :
          type === 'transfer' ? c.type === 'transfer' :
            (type === 'income' ? c.type === 'income' : c.type === 'expense')
      ))
      .filter(parent => {
        if (!search) return true;
        const subs = categories.filter(c => c.parentId === parent.id);
        return parent.name.toLowerCase().includes(search.toLowerCase()) ||
          subs.some(s => s.name.toLowerCase().includes(search.toLowerCase()));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, type, search]);

  const renderSquare = () => (
    <View>
      <ThemedText type="secondary" style={styles.label}>{label}</ThemedText>
      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        style={[
          styles.categorySquare,
          { backgroundColor: colors.surface, borderColor: colors.border }
        ]}
      >
        {activeCat ? (
          <View style={{ alignItems: 'center' }}>
            <View style={[styles.squareIconWrap, { backgroundColor: activeCat.color + '15' }]}>
              {renderCategoryIcon(activeCat.icon, activeCat.color, 24)}
            </View>
            <ThemedText numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: colors.primary, marginTop: 4 }}>
              {selectedCategory}
            </ThemedText>
          </View>
        ) : (
          <View style={{ alignItems: 'center' }}>
            <LucideTag color={colors.secondary} size={24} />
            <ThemedText style={{ fontSize: 10, color: colors.secondary, marginTop: 4 }}>Select</ThemedText>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );

  const renderRow = () => (
    <View style={{ marginBottom: 24 }}>
      <ThemedText type="secondary" style={styles.label}>{label}</ThemedText>
      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        style={[
          styles.categoryRow,
          { backgroundColor: colors.surface, borderColor: colors.border }
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          {activeCat ? (
            <>
              <View style={[styles.selectedIconWrap, { backgroundColor: activeCat.color + '20' }]}>
                {renderCategoryIcon(activeCat.icon, activeCat.color, 16)}
              </View>
              <ThemedText style={{ fontSize: 16, fontWeight: '600' }}>{selectedCategory}</ThemedText>
            </>
          ) : (
            <>
              <View style={[styles.selectedIconWrap, { backgroundColor: colors.translucent }]}>
                <LucideTag color={colors.secondary} size={16} />
              </View>
              <ThemedText style={{ fontSize: 16, color: colors.secondary }}>Select Category</ThemedText>
            </>
          )}
        </View>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      {variant === 'square' ? renderSquare() : renderRow()}

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        {/* Modal renders outside the root GestureHandlerRootView; re-establish one
            so the ScrollView scrolls over its TouchableOpacity rows (RNGH fix). */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setModalVisible(false)}
          />
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

            <View style={styles.modalHeader}>
              <ThemedText style={{ fontSize: 20, fontWeight: 'bold' }}>Select Category</ThemedText>
              <TouchableOpacity
                onPress={() => {
                  setModalVisible(false);
                  categoryManager.openNew(type === 'income' ? 'income' : 'expense');
                }}
                style={{ backgroundColor: colors.accent + '20', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }}
              >
                <ThemedText style={{ color: colors.accent, fontWeight: 'bold', fontSize: 12 }}>+ New</ThemedText>
              </TouchableOpacity>
            </View>

            <View style={[styles.searchBar, { backgroundColor: colors.translucent }]}>
              <LucideSearch color={colors.secondary} size={18} />
              <TextInput
                placeholder="Search categories..."
                placeholderTextColor={colors.muted}
                style={[styles.searchInput, { color: colors.primary }]}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <LucideX color={colors.secondary} size={18} />
                </TouchableOpacity>
              )}
            </View>

            <GHScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              <View style={{ gap: 16 }}>
                {filteredCategories.map(parent => {
                  const subs = categories.filter(c => c.parentId === parent.id)
                    .filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));

                  const isParentActive = selectedCategory === parent.name;

                  return (
                    <View key={parent.id}>
                      <TouchableOpacity
                        onPress={() => {
                          onSelect(parent.name);
                          setModalVisible(false);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }}
                        style={[
                          styles.categoryItem,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                          isParentActive && { backgroundColor: `${parent.color}15`, borderColor: parent.color }
                        ]}
                      >
                        <View style={[styles.emojiCircle, { backgroundColor: `${parent.color}20` }]}>
                          {renderCategoryIcon(parent.icon, parent.color, 18)}
                        </View>
                        <ThemedText
                          className="text-base font-bold"
                          style={{ color: isParentActive ? parent.color : colors.primary }}
                        >
                          {parent.name}
                        </ThemedText>
                        {isParentActive && <View style={{ marginLeft: 'auto' }}><LucideCheck color={parent.color} size={18} /></View>}
                      </TouchableOpacity>

                      {subs.length > 0 && (
                        <View style={styles.subsContainer}>
                          {subs.map(sub => (
                            <TouchableOpacity
                              key={sub.id}
                              onPress={() => {
                                onSelect(sub.name);
                                setModalVisible(false);
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              }}
                              style={[
                                styles.subcategoryItem,
                                { backgroundColor: colors.surface, borderColor: colors.border },
                                selectedCategory === sub.name && {
                                  backgroundColor: `${sub.color}20`,
                                  borderColor: sub.color,
                                  borderWidth: 1.5,
                                },
                              ]}
                            >
                              <ThemedText style={{ fontSize: 13, marginRight: 4 }}>
                                {/^[A-Z][a-zA-Z0-9]+$/.test(sub.icon) ? '📁' : sub.icon}
                              </ThemedText>
                              <ThemedText
                                style={{
                                  fontSize: 12,
                                  fontWeight: selectedCategory === sub.name ? '700' : '500',
                                  color: selectedCategory === sub.name ? sub.color : colors.primary
                                }}
                              >
                                {sub.name}
                              </ThemedText>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </GHScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
        </GestureHandlerRootView>
      </Modal>

      <CategoryManagerModal manager={categoryManager} onRefresh={refreshCategories} />
    </>
  );
};

const styles = StyleSheet.create({
  label: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' },
  categorySquare: {
    width: 80, height: 80, borderRadius: 16, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', padding: 8,
  },
  squareIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  categoryRow: { height: 60, borderRadius: 16, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  selectedIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '85%', paddingTop: 12 },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  modalHeader: { paddingHorizontal: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, paddingHorizontal: 12, borderRadius: 12, marginBottom: 16, height: 44 },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  categoryItem: { borderRadius: 16, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5 },
  emojiCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  subsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, paddingLeft: 12 },
  subcategoryItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, marginRight: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
});
