/**
 * CategoryManager — shared category add/edit/delete bottom sheet.
 *
 * Usage anywhere:
 *   const mgr = useCategoryManager(onRefresh);
 *   <CategoryManagerModal manager={mgr} defaultType="expense" />
 *
 *   // open to add new:          mgr.openNew(defaultType, parentId?)
 *   // open to edit existing:    mgr.openEdit(category)
 *   // open to add subcategory:  mgr.openNew(parentCategory.type, parentCategory.id)
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  Modal, Alert, Dimensions, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import {
  LucideX, LucideCheck, LucideTrash2, LucideSearch,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { addCategory, updateCategory, deleteCategory, getCategories, Category } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedText } from './ThemedSafeAreaView';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Emoji dataset ────────────────────────────────────────────────────────────

export interface EmojiItem {
  emoji: string;
  name: string;
  keywords: string[];
}

export interface EmojiGroup {
  title: string;
  emojis: EmojiItem[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    title: 'Food & Dining',
    emojis: [
      { emoji: '🍽️', name: 'Dining', keywords: ['dining', 'food', 'eat', 'restaurant', 'meal'] },
      { emoji: '☕', name: 'Coffee', keywords: ['coffee', 'cafe', 'latte', 'cappuccino', 'tea'] },
      { emoji: '🍕', name: 'Pizza', keywords: ['pizza', 'italian', 'fast food'] },
      { emoji: '🍔', name: 'Burger', keywords: ['burger', 'fast food', 'snack'] },
      { emoji: '🍜', name: 'Noodles', keywords: ['noodles', 'ramen', 'asian', 'soup'] },
      { emoji: '🍣', name: 'Sushi', keywords: ['sushi', 'japanese', 'fish'] },
      { emoji: '🥗', name: 'Salad', keywords: ['salad', 'healthy', 'greens'] },
      { emoji: '🥐', name: 'Bakery', keywords: ['bakery', 'bread', 'pastry', 'croissant'] },
      { emoji: '🍰', name: 'Desserts', keywords: ['dessert', 'cake', 'sweet', 'candy'] },
      { emoji: '🍺', name: 'Beer', keywords: ['beer', 'drinks', 'pub', 'alcohol'] },
      { emoji: '🍷', name: 'Wine', keywords: ['wine', 'drinks', 'alcohol', 'bottle'] },
      { emoji: '🧃', name: 'Juice', keywords: ['juice', 'drinks', 'beverage'] },
      { emoji: '🧋', name: 'Boba', keywords: ['boba', 'bubble tea', 'drinks'] },
      { emoji: '🥡', name: 'Takeout', keywords: ['takeout', 'delivery', 'order', 'food'] },
      { emoji: '🛒', name: 'Groceries', keywords: ['groceries', 'supermarket', 'market', 'vegetables'] },
      { emoji: '🥩', name: 'Meat', keywords: ['meat', 'chicken', 'food'] },
    ],
  },
  {
    title: 'Transport',
    emojis: [
      { emoji: '🚗', name: 'Car', keywords: ['car', 'drive', 'vehicle', 'auto'] },
      { emoji: '🚕', name: 'Taxi', keywords: ['taxi', 'cab', 'uber', 'ola', 'ride'] },
      { emoji: '🚌', name: 'Bus', keywords: ['bus', 'public', 'transit', 'commute'] },
      { emoji: '🚂', name: 'Train', keywords: ['train', 'metro', 'rail', 'subway'] },
      { emoji: '✈️', name: 'Flight', keywords: ['flight', 'airplane', 'plane', 'travel', 'airport'] },
      { emoji: '🛵', name: 'Scooter', keywords: ['scooter', 'moped', 'bike', 'two-wheeler'] },
      { emoji: '🚲', name: 'Bicycle', keywords: ['bicycle', 'cycle', 'bike'] },
      { emoji: '⛽', name: 'Fuel', keywords: ['fuel', 'petrol', 'gas', 'diesel'] },
      { emoji: '🅿️', name: 'Parking', keywords: ['parking', 'park'] },
      { emoji: '🚢', name: 'Ferry', keywords: ['ferry', 'ship', 'boat', 'cruise'] },
      { emoji: '🛺', name: 'Auto', keywords: ['auto', 'rickshaw', 'tuk tuk'] },
    ],
  },
  {
    title: 'Housing & Utilities',
    emojis: [
      { emoji: '🏠', name: 'Home', keywords: ['home', 'house', 'rent', 'housing', 'apartment'] },
      { emoji: '💡', name: 'Electricity', keywords: ['electricity', 'power', 'bill', 'utility', 'light'] },
      { emoji: '💧', name: 'Water', keywords: ['water', 'bill', 'utility', 'plumbing'] },
      { emoji: '🔥', name: 'Gas', keywords: ['gas', 'cooking', 'bill', 'utility', 'lpg'] },
      { emoji: '📶', name: 'Internet', keywords: ['internet', 'wifi', 'broadband', 'data', 'online'] },
      { emoji: '🌡️', name: 'AC', keywords: ['ac', 'air conditioning', 'cooling', 'hvac'] },
      { emoji: '🔧', name: 'Maintenance', keywords: ['maintenance', 'repair', 'fix', 'plumber'] },
      { emoji: '🏗️', name: 'Renovation', keywords: ['renovation', 'construction', 'remodel'] },
      { emoji: '🛋️', name: 'Furniture', keywords: ['furniture', 'sofa', 'chair', 'decor', 'home'] },
    ],
  },
  {
    title: 'Shopping',
    emojis: [
      { emoji: '🛍️', name: 'Shopping', keywords: ['shopping', 'retail', 'store', 'buy'] },
      { emoji: '👗', name: 'Clothing', keywords: ['clothing', 'clothes', 'fashion', 'dress', 'outfit'] },
      { emoji: '👟', name: 'Shoes', keywords: ['shoes', 'footwear', 'sneakers', 'sandals'] },
      { emoji: '💍', name: 'Jewelry', keywords: ['jewelry', 'accessories', 'gold', 'rings'] },
      { emoji: '📱', name: 'Electronics', keywords: ['electronics', 'phone', 'gadget', 'tech'] },
      { emoji: '💻', name: 'Laptop', keywords: ['laptop', 'computer', 'mac', 'tech'] },
      { emoji: '🎁', name: 'Gifts', keywords: ['gift', 'present', 'surprise', 'birthday'] },
      { emoji: '🪑', name: 'Home Goods', keywords: ['home goods', 'appliances', 'kitchen'] },
      { emoji: '📦', name: 'Online Orders', keywords: ['online', 'order', 'delivery', 'ecommerce'] },
      { emoji: '🧴', name: 'Personal Care', keywords: ['personal care', 'grooming', 'toiletries', 'beauty'] },
    ],
  },
  {
    title: 'Health & Fitness',
    emojis: [
      { emoji: '💊', name: 'Medicine', keywords: ['medicine', 'pharmacy', 'pills', 'drugs', 'healthcare'] },
      { emoji: '🏥', name: 'Hospital', keywords: ['hospital', 'doctor', 'clinic', 'medical'] },
      { emoji: '💪', name: 'Gym', keywords: ['gym', 'fitness', 'workout', 'exercise', 'training'] },
      { emoji: '🧘', name: 'Yoga', keywords: ['yoga', 'meditation', 'wellness', 'mindfulness'] },
      { emoji: '🦷', name: 'Dental', keywords: ['dental', 'dentist', 'teeth', 'oral'] },
      { emoji: '👁️', name: 'Eye Care', keywords: ['eye', 'glasses', 'vision', 'optician'] },
      { emoji: '🧬', name: 'Lab Tests', keywords: ['lab', 'test', 'blood', 'checkup'] },
      { emoji: '🩺', name: 'Doctor', keywords: ['doctor', 'consultation', 'checkup', 'medical'] },
    ],
  },
  {
    title: 'Entertainment',
    emojis: [
      { emoji: '🎬', name: 'Movies', keywords: ['movies', 'cinema', 'film', 'theatre'] },
      { emoji: '🎵', name: 'Music', keywords: ['music', 'spotify', 'concerts', 'streaming'] },
      { emoji: '🎮', name: 'Gaming', keywords: ['gaming', 'games', 'xbox', 'playstation', 'steam'] },
      { emoji: '📺', name: 'Streaming', keywords: ['streaming', 'netflix', 'ott', 'shows', 'tv'] },
      { emoji: '🎭', name: 'Events', keywords: ['events', 'shows', 'tickets', 'concerts', 'live'] },
      { emoji: '📚', name: 'Books', keywords: ['books', 'reading', 'ebooks', 'kindle'] },
      { emoji: '🎲', name: 'Board Games', keywords: ['board games', 'games', 'fun'] },
      { emoji: '🏟️', name: 'Sports Events', keywords: ['sports', 'stadium', 'match', 'ticket'] },
      { emoji: '🎪', name: 'Fun', keywords: ['fun', 'amusement', 'park', 'theme park'] },
    ],
  },
  {
    title: 'Education',
    emojis: [
      { emoji: '🎓', name: 'Tuition', keywords: ['tuition', 'school', 'college', 'education', 'fees'] },
      { emoji: '📖', name: 'Courses', keywords: ['courses', 'online learning', 'udemy', 'skillshare'] },
      { emoji: '✏️', name: 'Stationery', keywords: ['stationery', 'pen', 'notebook', 'supplies'] },
      { emoji: '🏫', name: 'School', keywords: ['school', 'institution', 'classes'] },
      { emoji: '🔬', name: 'Research', keywords: ['research', 'science', 'lab'] },
      { emoji: '🖊️', name: 'Writing', keywords: ['writing', 'notes', 'journal'] },
    ],
  },
  {
    title: 'Travel',
    emojis: [
      { emoji: '🌍', name: 'Travel', keywords: ['travel', 'trip', 'vacation', 'holiday', 'tour'] },
      { emoji: '🏨', name: 'Hotel', keywords: ['hotel', 'accommodation', 'stay', 'hostel', 'airbnb'] },
      { emoji: '🗺️', name: 'Sightseeing', keywords: ['sightseeing', 'tour', 'guide', 'attraction'] },
      { emoji: '🏖️', name: 'Beach', keywords: ['beach', 'resort', 'vacation', 'sea'] },
      { emoji: '🏕️', name: 'Camping', keywords: ['camping', 'outdoor', 'nature', 'trek'] },
      { emoji: '🗽', name: 'Tourism', keywords: ['tourism', 'landmark', 'city tour'] },
      { emoji: '🧳', name: 'Luggage', keywords: ['luggage', 'bag', 'packing', 'baggage'] },
    ],
  },
  {
    title: 'Family & Pets',
    emojis: [
      { emoji: '👶', name: 'Baby', keywords: ['baby', 'child', 'infant', 'diaper', 'kids'] },
      { emoji: '🧒', name: 'Kids', keywords: ['kids', 'children', 'school', 'toys'] },
      { emoji: '🐕', name: 'Dog', keywords: ['dog', 'pet', 'vet', 'grooming'] },
      { emoji: '🐈', name: 'Cat', keywords: ['cat', 'pet', 'vet', 'grooming'] },
      { emoji: '🏫', name: 'School Fees', keywords: ['school fees', 'education', 'tuition', 'kids'] },
      { emoji: '🎠', name: 'Kids Activities', keywords: ['kids activities', 'classes', 'hobby'] },
      { emoji: '❤️', name: 'Family', keywords: ['family', 'loved ones', 'relatives'] },
    ],
  },
  {
    title: 'Subscriptions',
    emojis: [
      { emoji: '📡', name: 'Subscriptions', keywords: ['subscriptions', 'monthly', 'recurring'] },
      { emoji: '📰', name: 'News', keywords: ['news', 'newspaper', 'magazine', 'media'] },
      { emoji: '☁️', name: 'Cloud Storage', keywords: ['cloud', 'storage', 'drive', 'dropbox'] },
      { emoji: '🎧', name: 'Audio', keywords: ['audio', 'podcast', 'music', 'streaming'] },
      { emoji: '🔐', name: 'Security', keywords: ['security', 'vpn', 'antivirus', 'password'] },
    ],
  },
  {
    title: 'Finance & Work',
    emojis: [
      { emoji: '💰', name: 'Salary', keywords: ['salary', 'income', 'wage', 'pay', 'earnings'] },
      { emoji: '💼', name: 'Business', keywords: ['business', 'work', 'office', 'freelance'] },
      { emoji: '📈', name: 'Investments', keywords: ['investments', 'stocks', 'mutual funds', 'sip'] },
      { emoji: '🏦', name: 'Banking', keywords: ['banking', 'bank', 'savings', 'account'] },
      { emoji: '💳', name: 'Credit Card', keywords: ['credit card', 'card', 'cashback'] },
      { emoji: '🪙', name: 'Crypto', keywords: ['crypto', 'bitcoin', 'ethereum', 'coins'] },
      { emoji: '📊', name: 'Dividends', keywords: ['dividends', 'returns', 'income', 'profit'] },
      { emoji: '🤝', name: 'Freelance', keywords: ['freelance', 'consulting', 'contract', 'gig'] },
      { emoji: '🏧', name: 'ATM', keywords: ['atm', 'cash', 'withdrawal'] },
      { emoji: '🔄', name: 'Transfer', keywords: ['transfer', 'send money', 'payment'] },
    ],
  },
  {
    title: 'Nature & Miscellaneous',
    emojis: [
      { emoji: '🌱', name: 'Plants', keywords: ['plants', 'garden', 'nature', 'green'] },
      { emoji: '🌞', name: 'Outdoors', keywords: ['outdoors', 'sun', 'park', 'nature'] },
      { emoji: '🎨', name: 'Art', keywords: ['art', 'painting', 'creative', 'hobby'] },
      { emoji: '📷', name: 'Photography', keywords: ['photography', 'camera', 'photo', 'shoot'] },
      { emoji: '🧵', name: 'Crafts', keywords: ['crafts', 'sewing', 'hobby', 'diy'] },
      { emoji: '🙏', name: 'Charity', keywords: ['charity', 'donation', 'temple', 'giving'] },
      { emoji: '⭐', name: 'Other', keywords: ['other', 'misc', 'miscellaneous', 'general'] },
      { emoji: '📁', name: 'Uncategorized', keywords: ['uncategorized', 'unknown', 'general'] },
    ],
  },
];

export const EMOJI_LIST = EMOJI_GROUPS.flatMap(g => g.emojis);

// ─── Shared constants ────────────────────────────────────────────────────────

export const CATEGORY_COLORS = [
  '#FF9500', '#FFCC00', '#30D158', '#34C759',
  '#00C7BE', '#32ADE6', '#0A84FF', '#007AFF',
  '#5856D6', '#AF52DE', '#BF5AF2', '#FF2D55',
  '#FF375F', '#FF453A', '#8E8E93', '#626266',
];

// Legacy Lucide icon name → emoji mapping (for backwards compatibility)
const LUCIDE_TO_EMOJI: Record<string, string> = {
  Coffee: '☕', Car: '🚗', ShoppingBag: '🛍️', Zap: '⚡', Tv: '📺',
  Heart: '❤️', TrendingUp: '📈', Briefcase: '💼', RotateCw: '🔄',
  HelpCircle: '⭐', Folder: '📁', Wallet: '👛', Banknote: '💵',
  Coins: '🪙', PiggyBank: '🐷', CreditCard: '💳', Landmark: '🏦',
  Calculator: '🧮', Gift: '🎁', Utensils: '🍽️', IceCream: '🍦',
  Candy: '🍬', Beer: '🍺', Wine: '🍷', Pizza: '🍕', Bus: '🚌',
  Train: '🚂', Plane: '✈️', Bike: '🚲', Ship: '🚢', Truck: '🚛',
  Globe: '🌍', Palmtree: '🌴', Home: '🏠', Baby: '👶', Cat: '🐈',
  Dog: '🐕', Shirt: '👕', Key: '🔑', Lock: '🔒', Umbrella: '☂️',
  Gamepad2: '🎮', Film: '🎬', Clapboard: '🎬', Music: '🎵',
  Headphones: '🎧', Monitor: '🖥️', Smartphone: '📱', Mic: '🎤',
  Wifi: '📶', Stethoscope: '🩺', Pill: '💊', Dumbbell: '💪',
  GraduationCap: '🎓', Book: '📚', Library: '📖', Wrench: '🔧',
  Hammer: '🔨', Palette: '🎨', PenTool: '✏️', Camera: '📷',
  Lightbulb: '💡', Flower2: '🌸', Leaf: '🌿', Sun: '🌞',
  Moon: '🌙', Star: '⭐', Disc: '💿', Printer: '🖨️',
};

/** Detect if a string is an emoji (not a Lucide icon name). */
const isEmojiIcon = (s: string): boolean => {
  if (!s || s.length === 0) return false;
  // Lucide names are PascalCase ASCII — if it has non-ASCII or is short & pictographic, it's emoji
  return !/^[A-Z][a-zA-Z0-9]+$/.test(s);
};

/** Renders a category icon — emoji Text for new icons, Lucide fallback for legacy names. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const renderCategoryIcon = (iconName: string, _color: string, size = 20) => {
  let displayEmoji: string | null = null;

  if (isEmojiIcon(iconName)) {
    displayEmoji = iconName;
  } else if (LUCIDE_TO_EMOJI[iconName]) {
    displayEmoji = LUCIDE_TO_EMOJI[iconName];
  }

  if (displayEmoji) {
    return (
      <Text style={{ fontSize: size * 1.1, lineHeight: size * 1.4, textAlign: 'center' }}>
        {displayEmoji}
      </Text>
    );
  }

  // Final fallback — folder emoji
  return (
    <Text style={{ fontSize: size * 1.1, lineHeight: size * 1.4, textAlign: 'center' }}>
      {'📁'}
    </Text>
  );
};

// ─── Manager state hook ───────────────────────────────────────────────────────

export interface CategoryManagerState {
  visible: boolean;
  editing: Category | null;
  parentId: number | null;
  defaultType: 'expense' | 'income';
  openNew: (type: 'expense' | 'income', parentId?: number | null) => void;
  openEdit: (cat: Category) => void;
  close: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const useCategoryManager = (_onRefresh: () => void): CategoryManagerState => {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [parentId, setParentId] = useState<number | null>(null);
  const [defaultType, setDefaultType] = useState<'expense' | 'income'>('expense');

  const openNew = (type: 'expense' | 'income', pid: number | null = null) => {
    setEditing(null);
    setParentId(pid);
    setDefaultType(type);
    setVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    setParentId(cat.parentId ?? null);
    setDefaultType(cat.type === 'transfer' ? 'expense' : cat.type);
    setVisible(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const close = () => setVisible(false);

  return { visible, editing, parentId, defaultType, openNew, openEdit, close };
};

// ─── Emoji Picker ─────────────────────────────────────────────────────────────

interface EmojiPickerProps {
  selected: string;
  onSelect: (emoji: string) => void;
  selectedColor: string;
  colors: Record<string, string>;
}

const EmojiPicker = ({ selected, onSelect, selectedColor, colors }: EmojiPickerProps) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return EMOJI_GROUPS;
    const results = EMOJI_LIST.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.keywords.some(k => k.toLowerCase().includes(q))
    );
    if (results.length === 0) return [];
    return [{ title: 'Search Results', emojis: results }];
  }, [search]);

  return (
    <View>
      {/* Search bar */}
      <View style={[pickerStyles.searchBar, { backgroundColor: colors.translucent, borderColor: colors.border }]}>
        <LucideSearch color={colors.secondary} size={15} />
        <TextInput
          style={[pickerStyles.searchInput, { color: colors.primary }]}
          placeholder="Search emoji…"
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

      {/* Emoji groups */}
      {filtered.length === 0 ? (
        <View style={pickerStyles.noResults}>
          <Text style={{ fontSize: 32 }}>🔍</Text>
          <ThemedText type="secondary" style={{ marginTop: 8, fontSize: 13 }}>No emojis found</ThemedText>
        </View>
      ) : (
        filtered.map(group => (
          <View key={group.title} style={{ marginBottom: 20 }}>
            <ThemedText style={pickerStyles.groupTitle}>{group.title}</ThemedText>
            <View style={pickerStyles.emojiGrid}>
              {group.emojis.map(item => {
                const isSelected = selected === item.emoji;
                return (
                  <TouchableOpacity
                    key={item.emoji}
                    onPress={() => { onSelect(item.emoji); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    style={[
                      pickerStyles.emojiBtn,
                      {
                        backgroundColor: isSelected ? `${selectedColor}20` : colors.translucent,
                        borderWidth: isSelected ? 2 : 0,
                        borderColor: selectedColor,
                      },
                    ]}
                  >
                    <Text style={pickerStyles.emojiText}>{item.emoji}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))
      )}
    </View>
  );
};

const pickerStyles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, marginBottom: 16,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  groupTitle: {
    fontSize: 10, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 1, color: '#8E8E93', marginBottom: 10,
  },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emojiBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  emojiText: { fontSize: 24 },
  noResults: { alignItems: 'center', paddingVertical: 32 },
});

// ─── Modal component ─────────────────────────────────────────────────────────

interface CategoryManagerModalProps {
  manager: CategoryManagerState;
  onRefresh: () => void;
  onSaved?: (parentId: number | null) => void;
}

export const CategoryManagerModal = ({ manager, onRefresh, onSaved }: CategoryManagerModalProps) => {
  const { colors } = useTheme();
  const { visible, editing, parentId, defaultType, close } = manager;

  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('⭐');
  const [selectedColor, setSelectedColor] = useState(CATEGORY_COLORS[0]);
  const [type, setType] = useState<'expense' | 'income'>(defaultType);
  const [formParentId, setFormParentId] = useState<number | null>(parentId);
  const [saving, setSaving] = useState(false);

  const [rootCategories, setRootCategories] = useState<Category[]>([]);

  const loadRoots = useCallback(() => {
    getCategories().then(cats => {
      setRootCategories(cats.filter(c => !c.parentId && c.id !== editing?.id));
    });
  }, [editing?.id]);

  React.useEffect(() => {
    if (!visible) return;
    loadRoots();
    if (editing) {
      setName(editing.name);
      // Migrate legacy Lucide name on open
      const icon = isEmojiIcon(editing.icon)
        ? editing.icon
        : (LUCIDE_TO_EMOJI[editing.icon] ?? '⭐');
      setSelectedIcon(icon);
      setSelectedColor(editing.color);
      setType(editing.type === 'transfer' ? 'expense' : editing.type);
      setFormParentId(editing.parentId ?? null);
    } else {
      setName('');
      setSelectedIcon('⭐');
      setSelectedColor(CATEGORY_COLORS[0]);
      setType(defaultType);
      setFormParentId(parentId);
    }
  }, [visible, editing, defaultType, parentId]);

  React.useEffect(() => {
    if (formParentId) {
      const parent = rootCategories.find(c => c.id === formParentId);
      if (parent && parent.type !== type) setFormParentId(null);
    }
  }, [type]);

  const availableParents = rootCategories.filter(c => c.type === type);
  const selectedParent = availableParents.find(c => c.id === formParentId) ?? null;
  const isSubcategory = formParentId !== null;

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Empty Name', 'Please give your category a name.');
      return;
    }
    setSaving(true);
    try {
      const resolvedParentId = formParentId ?? undefined;
      if (editing) {
        await updateCategory({
          id: editing.id,
          name: name.trim(),
          icon: selectedIcon,
          color: selectedColor,
          type,
          parentId: resolvedParentId,
        });
      } else {
        await addCategory({
          name: name.trim(),
          icon: selectedIcon,
          color: selectedColor,
          type,
          parentId: resolvedParentId,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRefresh();
      onSaved?.(formParentId);
      close();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to save category. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!editing) return;
    Alert.alert(
      'Delete Category',
      editing.parentId
        ? `Delete "${editing.name}"? Transactions using it will keep the category name.`
        : `Delete "${editing.name}" and all its subcategories?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteCategory(editing.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onRefresh();
            close();
          },
        },
      ]
    );
  };

  const title = editing
    ? `Edit "${editing.name}"`
    : isSubcategory
      ? 'New Subcategory'
      : 'New Category';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={close}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingBottom: 40,
              maxHeight: SCREEN_HEIGHT * 0.94,
            }}
          >
            {/* Drag handle */}
            <View style={modalStyles.handle} />

            {/* Header */}
            <View style={modalStyles.header}>
              <ThemedText style={modalStyles.headerTitle}>{title}</ThemedText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {editing && (
                  <TouchableOpacity
                    onPress={handleDelete}
                    style={[modalStyles.iconBtn, { backgroundColor: `${colors.danger}15` }]}
                  >
                    <LucideTrash2 color={colors.danger} size={16} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={close}
                  style={[modalStyles.iconBtn, { backgroundColor: colors.translucent }]}
                >
                  <LucideX color={colors.secondary} size={18} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 24, paddingBottom: 8 }}
            >
              {/* Large emoji preview circle */}
              <View style={modalStyles.previewRow}>
                <View style={[modalStyles.previewCircle, { backgroundColor: `${selectedColor}20`, borderColor: `${selectedColor}40` }]}>
                  <Text style={modalStyles.previewEmoji}>{selectedIcon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontSize: 13, color: colors.secondary, marginBottom: 4 }}>
                    {selectedParent ? `${selectedParent.name} ›` : (type === 'income' ? 'Income' : 'Expense')}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 18, fontWeight: 'bold', color: selectedColor }}>
                    {name || 'Category Name'}
                  </ThemedText>
                </View>
              </View>

              {/* Type toggle — only for root categories */}
              {!isSubcategory && !editing?.parentId && (
                <View style={{ marginBottom: 20 }}>
                  <ThemedText style={s.label}>Type</ThemedText>
                  <View style={[modalStyles.toggleRow, { backgroundColor: colors.translucent }]}>
                    {(['expense', 'income'] as const).map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[
                          modalStyles.toggleBtn,
                          type === t && { backgroundColor: colors.surface },
                        ]}
                        onPress={() => { setType(t); Haptics.selectionAsync(); }}
                      >
                        <Text style={{ marginRight: 4 }}>{t === 'expense' ? '💸' : '💰'}</Text>
                        <ThemedText style={{ fontSize: 13, fontWeight: 'bold', color: type === t ? colors.primary : colors.secondary, textTransform: 'capitalize' }}>
                          {t}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* Parent picker */}
              {(!editing?.id || editing.parentId !== undefined) && availableParents.length > 0 && !editing?.parentId && (
                <View style={{ marginBottom: 20 }}>
                  <ThemedText style={s.label}>Subcategory of</ThemedText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                    <TouchableOpacity
                      onPress={() => { setFormParentId(null); Haptics.selectionAsync(); }}
                      style={[
                        modalStyles.parentChip,
                        {
                          borderColor: formParentId === null ? colors.primary : colors.border,
                          backgroundColor: formParentId === null ? `${colors.primary}12` : colors.translucent,
                        },
                      ]}
                    >
                      <ThemedText style={{ fontSize: 12, fontWeight: 'bold', color: formParentId === null ? colors.primary : colors.secondary }}>
                        None (Root)
                      </ThemedText>
                    </TouchableOpacity>
                    {availableParents.map(parent => (
                      <TouchableOpacity
                        key={parent.id}
                        onPress={() => {
                          setFormParentId(parent.id);
                          setType(parent.type === 'transfer' ? 'expense' : parent.type);
                          Haptics.selectionAsync();
                        }}
                        style={[
                          modalStyles.parentChip,
                          {
                            borderColor: formParentId === parent.id ? parent.color : colors.border,
                            backgroundColor: formParentId === parent.id ? `${parent.color}15` : colors.translucent,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 14 }}>
                          {isEmojiIcon(parent.icon) ? parent.icon : (LUCIDE_TO_EMOJI[parent.icon] ?? '📁')}
                        </Text>
                        <ThemedText style={{ fontSize: 12, fontWeight: 'bold', color: formParentId === parent.id ? parent.color : colors.secondary }}>
                          {parent.name}
                        </ThemedText>
                        {formParentId === parent.id && <LucideCheck color={parent.color} size={12} />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Name input */}
              <ThemedText style={s.label}>
                {isSubcategory ? 'Subcategory Name' : 'Category Name'}
              </ThemedText>
              <TextInput
                style={[modalStyles.nameInput, { borderColor: colors.border, backgroundColor: colors.translucent, color: colors.primary }]}
                placeholder={isSubcategory ? 'e.g. Latte, Takeout, Petrol' : 'e.g. Food, Transport, Bills'}
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={setName}
                autoFocus
              />

              {/* Color swatches */}
              <ThemedText style={s.label}>Color</ThemedText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
                {CATEGORY_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => { setSelectedColor(c); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: c, alignItems: 'center', justifyContent: 'center',
                      borderWidth: selectedColor === c ? 3 : 0,
                      borderColor: colors.primary,
                    }}
                  >
                    {selectedColor === c && <LucideCheck color="#fff" size={16} />}
                  </TouchableOpacity>
                ))}
              </View>

              {/* Emoji picker */}
              <ThemedText style={s.label}>Choose Icon</ThemedText>
              <EmojiPicker
                selected={selectedIcon}
                onSelect={setSelectedIcon}
                selectedColor={selectedColor}
                colors={colors}
              />

              {/* Save button */}
              <TouchableOpacity
                style={[modalStyles.saveBtn, { backgroundColor: selectedColor, opacity: saving ? 0.7 : 1 }]}
                onPress={handleSave}
                disabled={saving}
              >
                <LucideCheck color="#fff" size={20} />
                <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
                  {saving ? 'Saving…' : editing ? 'Update Category' : isSubcategory ? 'Create Subcategory' : 'Create Category'}
                </ThemedText>
              </TouchableOpacity>
              <View style={{ height: 16 }} />
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const s = StyleSheet.create({
  label: { fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, color: '#8E8E93' },
});

const modalStyles = StyleSheet.create({
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#3C3C434A',
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 16,
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold' },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    marginBottom: 24, padding: 16, borderRadius: 20,
  },
  previewCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2,
  },
  previewEmoji: { fontSize: 36 },
  toggleRow: { flexDirection: 'row', borderRadius: 12, padding: 4 },
  toggleBtn: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 8, flexDirection: 'row', justifyContent: 'center', gap: 4,
  },
  parentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginHorizontal: 4,
    borderWidth: 1.5,
  },
  nameInput: {
    padding: 14, borderRadius: 14, marginBottom: 20,
    borderWidth: 1, fontSize: 16,
  },
  saveBtn: {
    height: 56, borderRadius: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8,
  },
});
