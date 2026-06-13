import React, { useState, useEffect } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, KeyboardAvoidingView, Alert,
} from 'react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import {
  LucideX, LucideCheck, LucideCalendar, LucideChevronDown,
  LucideCreditCard, LucideTarget, LucidePlus, LucideTrash2,
} from 'lucide-react-native';
import * as LucideIcons from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation, useRoute } from '@react-navigation/native';
import { 
  addGoal, updateGoal, deleteGoal,
  getAccounts, getCategories, Account, Category, Goal 
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { CategoryPicker } from '../components/CategoryPicker';


export const AddGoalScreen = () => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const navigation = useNavigation();
  const route = useRoute();
  const { 
    goalToEdit, 
    prefillName, 
    prefillAmount, 
    prefillCategory, 
    prefillAccountId 
  } = (route.params as { 
    goalToEdit?: Goal;
    prefillName?: string;
    prefillAmount?: string;
    prefillCategory?: string;
    prefillAccountId?: number;
  }) ?? {};
  const isEditing = !!goalToEdit;

  const [name, setName] = useState(goalToEdit?.name ?? prefillName ?? '');
  const [targetAmount, setTargetAmount] = useState(goalToEdit?.targetAmount ? String(goalToEdit.targetAmount) : (prefillAmount ?? ''));
  const [currentAmount, setCurrentAmount] = useState(goalToEdit?.currentAmount ? String(goalToEdit.currentAmount) : '0');
  const [monthlyContribution, setMonthlyContribution] = useState(goalToEdit?.monthlyContribution ? String(goalToEdit.monthlyContribution) : '');
  const [category, setCategory] = useState(goalToEdit?.category ?? prefillCategory ?? '');
  const [date, setDate] = useState<Date>(
    goalToEdit?.deadline ? new Date(goalToEdit.deadline) : new Date(new Date().setFullYear(new Date().getFullYear() + 1))
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState(goalToEdit?.notes ?? '');

  // Linked account
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAccountId, setLinkedAccountId] = useState<number | undefined>(goalToEdit?.linkedAccountId ?? prefillAccountId);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Categories from DB
  const [categories, setCategories] = useState<Category[]>([]);

  const [errors, setErrors] = useState<{ name?: string; target?: string; category?: string }>({});

  const refreshCategories = () => {
    getCategories().then(setCategories);
  };

  useEffect(() => {
    Promise.all([getAccounts(), getCategories()]).then(([accs, cats]) => {
      setAccounts(accs);
      setCategories(cats);
      if (cats.length > 0 && !category) {
        const other = cats.find(c => c.name === 'Other' && c.type === 'expense');
        setCategory(other ? other.name : cats[0].name);
      }
    });
  }, []);


  const selectedAccount = accounts.find(a => a.id === linkedAccountId);

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setDate(selectedDate);
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = 'Goal name is required';
    const target = parseFloat(targetAmount);
    if (!targetAmount || isNaN(target) || target <= 0) newErrors.target = 'Enter a valid target amount';
    if (!category) newErrors.category = 'Select a category';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const goalData = {
      name: name.trim(),
      targetAmount: parseFloat(targetAmount),
      currentAmount: parseFloat(currentAmount) || 0,
      deadline: date.toISOString(),
      category,
      isActive: true,
      linkedAccountId,
      monthlyContribution: monthlyContribution ? parseFloat(monthlyContribution) : undefined,
      notes: notes.trim() || undefined,
    };

    if (isEditing) {
      await updateGoal(goalToEdit.id, goalData);
      notify.success('Goal updated!');
    } else {
      await addGoal(goalData);
      notify.success('Goal created!');
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!isEditing) return;
    Alert.alert(
      'Delete Goal',
      'Are you sure you want to delete this goal? This will not affect existing transactions.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            await deleteGoal(goalToEdit.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            notify.success('Goal deleted');
            navigation.goBack();
          }
        }
      ]
    );
  };

  // Estimate months to reach goal
  const target = parseFloat(targetAmount) || 0;
  const already = parseFloat(currentAmount) || 0;
  const monthly = parseFloat(monthlyContribution) || 0;
  const remaining = Math.max(target - already, 0);
  const estimatedMonths = monthly > 0 ? Math.ceil(remaining / monthly) : null;

  const s = StyleSheet.create({
    content: { padding: 24, flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    field: { marginBottom: 20 },
    label: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold', color: colors.secondary },
    input: { fontSize: 18, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, color: colors.primary },
    amountInput: { fontSize: 36, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, color: '#34C759' },
    dateRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12, gap: 10 },
    iosPickerContainer: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden', marginTop: 12, borderWidth: 1, borderColor: colors.border },
    iosPickerDone: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, alignItems: 'center' },
    pickerSheet: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginTop: 8, overflow: 'hidden' },
    pickerItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
    catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
    saveButton: { height: 60, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: '#34C759' },
    deleteButton: { height: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, borderWidth: 1, borderColor: colors.danger },
    estimateBox: { backgroundColor: '#34C75912', borderRadius: 12, padding: 12, marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    splitRow: { flexDirection: 'row', gap: 16 },
    halfField: { flex: 1 },
  });

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.content}>
          <View style={s.header}>
            <ThemedText className="text-2xl font-bold">{isEditing ? 'Edit Goal' : 'New Goal'}</ThemedText>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <LucideX color={colors.secondary} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Priority Section: Amount & Category side-by-side */}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20, alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={s.label}>Target Amount ({preferences.currency})</ThemedText>
                <TextInput
                  style={s.amountInput}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={targetAmount}
                  onChangeText={v => { setTargetAmount(v); setErrors(e => ({ ...e, target: undefined })); }}
                  autoFocus={!isEditing}
                />
                {errors.target && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.target}</ThemedText>}
              </View>

              <CategoryPicker
                selectedCategory={category}
                onSelect={setCategory}
                categories={categories}
                type="expense"
                refreshCategories={refreshCategories}
                variant="square"
              />
            </View>

            {/* Goal Name */}
            <View style={s.field}>
              <ThemedText style={s.label}>Goal Name</ThemedText>
              <TextInput
                style={s.input}
                placeholder="e.g. New iPhone, Vacation, Emergency Fund"
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={v => { setName(v); setErrors(e => ({ ...e, name: undefined })); }}
              />
              {errors.name && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.name}</ThemedText>}
            </View>

            {/* Initial + Monthly Contribution */}
            <View style={[s.field, s.splitRow]}>
              <View style={s.halfField}>
                <ThemedText style={s.label}>Already Saved ({preferences.currency})</ThemedText>
                <TextInput
                  style={s.input}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={currentAmount}
                  onChangeText={setCurrentAmount}
                />
              </View>
              <View style={s.halfField}>
                <ThemedText style={s.label}>Monthly Plan ({preferences.currency})</ThemedText>
                <TextInput
                  style={s.input}
                  placeholder="Optional"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={monthlyContribution}
                  onChangeText={setMonthlyContribution}
                />
              </View>
            </View>

            {/* Estimate preview */}
            {estimatedMonths !== null && estimatedMonths > 0 && (
              <View style={[s.estimateBox, { marginTop: -8, marginBottom: 20 }]}>
                <ThemedText style={{ fontSize: 12, color: '#34C759' }}>
                  Estimated time to reach goal
                </ThemedText>
                <ThemedText style={{ fontWeight: 'bold', color: '#34C759' }}>
                  {estimatedMonths < 12
                    ? `${estimatedMonths} month${estimatedMonths !== 1 ? 's' : ''}`
                    : `${Math.floor(estimatedMonths / 12)}y ${estimatedMonths % 12}m`}
                </ThemedText>
              </View>
            )}

            {/* Deadline */}
            <View style={s.field}>
              <ThemedText style={s.label}>Deadline</ThemedText>
              <TouchableOpacity style={s.dateRow} onPress={() => setShowDatePicker(true)}>
                <LucideCalendar color={colors.secondary} size={18} />
                <ThemedText style={{ fontSize: 16 }}>
                  {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </ThemedText>
              </TouchableOpacity>
              {showDatePicker && (
                <View style={Platform.OS === 'ios' ? s.iosPickerContainer : undefined}>
                  <DateTimePicker
                    value={date}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDateChange}
                    minimumDate={new Date()}
                    themeVariant={isDark ? 'dark' : 'light'}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity onPress={() => setShowDatePicker(false)} style={s.iosPickerDone}>
                      <ThemedText style={{ color: '#34C759', fontWeight: 'bold' }}>Done</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Linked Account */}
            <View style={s.field}>
              <ThemedText style={s.label}>Savings Account</ThemedText>
              <TouchableOpacity
                style={[s.dateRow, { justifyContent: 'space-between' }]}
                onPress={() => { setShowAccountPicker(v => !v); Haptics.selectionAsync(); }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <LucideCreditCard color={colors.secondary} size={18} />
                  <ThemedText style={{ fontSize: 16, color: selectedAccount ? colors.primary : colors.muted }}>
                    {selectedAccount ? selectedAccount.name : 'Select account (optional)'}
                  </ThemedText>
                </View>
                <LucideChevronDown color={colors.secondary} size={16} />
              </TouchableOpacity>
              {showAccountPicker && accounts.length > 0 && (
                <View style={s.pickerSheet}>
                  <TouchableOpacity
                    style={s.pickerItem}
                    onPress={() => { setLinkedAccountId(undefined); setShowAccountPicker(false); }}
                  >
                    <ThemedText style={{ color: colors.secondary }}>None</ThemedText>
                  </TouchableOpacity>
                  {accounts.map(acc => (
                    <TouchableOpacity
                      key={acc.id}
                      style={[s.pickerItem, linkedAccountId === acc.id && { backgroundColor: '#34C75912' }]}
                      onPress={() => { setLinkedAccountId(acc.id); setShowAccountPicker(false); }}
                    >
                      <LucideCreditCard color={linkedAccountId === acc.id ? '#34C759' : colors.secondary} size={16} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: 'bold', color: linkedAccountId === acc.id ? '#34C759' : colors.primary }}>
                          {acc.name}
                        </ThemedText>
                        <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                          {acc.accountType} · {preferences.currency}{acc.balance.toLocaleString('en-IN')}
                        </ThemedText>
                      </View>
                      {linkedAccountId === acc.id && <LucideCheck color="#34C759" size={16} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>


            {/* Notes */}
            <View style={s.field}>
              <ThemedText style={s.label}>Notes (optional)</ThemedText>
              <TextInput
                style={[s.input, { fontSize: 15 }]}
                placeholder="Why this goal matters..."
                placeholderTextColor={colors.muted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>

            <TouchableOpacity style={s.saveButton} onPress={handleSave}>
              <LucideCheck color="#FFFFFF" size={24} />
              <ThemedText style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 18, marginLeft: 8 }}>
                {isEditing ? 'Save Changes' : 'Create Goal'}
              </ThemedText>
            </TouchableOpacity>

            {isEditing && (
              <TouchableOpacity style={s.deleteButton} onPress={handleDelete}>
                <LucideTrash2 color={colors.danger} size={20} />
                <ThemedText style={{ color: colors.danger, fontWeight: 'bold', fontSize: 16, marginLeft: 8 }}>
                  Delete Goal
                </ThemedText>
              </TouchableOpacity>
            )}

          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default AddGoalScreen;
