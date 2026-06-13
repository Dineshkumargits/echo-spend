import React, { useState, useEffect } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, KeyboardAvoidingView, Switch, Alert,
} from 'react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import {
  LucideX, LucideCheck, LucideCalendar, LucideRepeat,
  LucideChevronDown, LucideUsers, LucideUserPlus, LucideTrash2,
  LucideCreditCard, LucidePlus,
} from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation, useRoute } from '@react-navigation/native';
import { 
  addSubscription, updateSubscription, deleteSubscription,
  getAccounts, getCategories, Account, Category, Subscription 
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { CategoryPicker } from '../components/CategoryPicker';


const FREQUENCIES = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
] as const;

export const AddSubscriptionScreen = () => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const navigation = useNavigation();
  const route = useRoute();
  const { 
    subscriptionToEdit, 
    prefillName, 
    prefillAmount, 
    prefillCategory, 
    prefillAccountId 
  } = (route.params as { 
    subscriptionToEdit?: Subscription;
    prefillName?: string;
    prefillAmount?: string;
    prefillCategory?: string;
    prefillAccountId?: number;
  }) ?? {};
  const isEditing = !!subscriptionToEdit;

  const [name, setName] = useState(subscriptionToEdit?.name ?? prefillName ?? '');
  const [amount, setAmount] = useState(subscriptionToEdit?.amount ? String(subscriptionToEdit.amount) : (prefillAmount ?? ''));
  const [category, setCategory] = useState(subscriptionToEdit?.category ?? prefillCategory ?? '');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly' | 'yearly'>(subscriptionToEdit?.frequency ?? 'monthly');
  const [nextDueDate, setNextDueDate] = useState<Date>(
    subscriptionToEdit?.nextDueDate ? new Date(subscriptionToEdit.nextDueDate) : new Date(new Date().setMonth(new Date().getMonth() + 1))
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState(subscriptionToEdit?.notes ?? '');

  // Linked account
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [debitAccountId, setDebitAccountId] = useState<number | undefined>(subscriptionToEdit?.debitAccountId ?? prefillAccountId);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  // Categories from DB
  const [categories, setCategories] = useState<Category[]>([]);

  // Split
  const [splitEnabled, setSplitEnabled] = useState(subscriptionToEdit?.splitEnabled ?? false);
  const [splitMemberNames, setSplitMemberNames] = useState<string[]>(
    subscriptionToEdit?.splitMembers 
      ? JSON.parse(subscriptionToEdit.splitMembers).map((m: any) => m.name)
      : ['']
  );

  const [errors, setErrors] = useState<{ name?: string; amount?: string; category?: string }>({});

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


  const selectedAccount = accounts.find(a => a.id === debitAccountId);

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setNextDueDate(selectedDate);
  };

  const addMember = () => {
    setSplitMemberNames(prev => [...prev, '']);
    Haptics.selectionAsync();
  };

  const removeMember = (idx: number) => {
    setSplitMemberNames(prev => prev.filter((_, i) => i !== idx));
    Haptics.selectionAsync();
  };

  const updateMember = (idx: number, value: string) => {
    setSplitMemberNames(prev => prev.map((m, i) => i === idx ? value : m));
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!name.trim()) newErrors.name = 'Service name is required';
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) newErrors.amount = 'Enter a valid amount';
    if (!category) newErrors.category = 'Select a category';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const validMembers = splitMemberNames
      .map(m => m.trim())
      .filter(Boolean)
      .map(name => ({ name }));

    const subData = {
      name: name.trim(),
      amount: parseFloat(amount),
      category,
      frequency,
      nextDueDate: nextDueDate.toISOString(),
      isActive: true,
      debitAccountId,
      splitEnabled: splitEnabled && validMembers.length > 0,
      splitMembers: splitEnabled && validMembers.length > 0 ? JSON.stringify(validMembers) : undefined,
      notes: notes.trim() || undefined,
    };

    if (isEditing) {
      await updateSubscription(subscriptionToEdit.id, subData);
      notify.success('Subscription updated!');
    } else {
      await addSubscription(subData);
      notify.success('Subscription added!');
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!isEditing) return;
    Alert.alert(
      'Delete Subscription',
      'Are you sure you want to delete this subscription? This will not affect existing transactions.',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            await deleteSubscription(subscriptionToEdit.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            notify.success('Subscription deleted');
            navigation.goBack();
          }
        }
      ]
    );
  };

  // Per-person share preview
  const amt = parseFloat(amount) || 0;
  const validMemberCount = splitMemberNames.filter(m => m.trim()).length;
  const totalPeople = validMemberCount + 1;
  const myShare = splitEnabled && totalPeople > 1
    ? Math.round((amt / totalPeople) * 100) / 100
    : amt;

  const s = StyleSheet.create({
    content: { padding: 24, flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    field: { marginBottom: 20 },
    label: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold', color: colors.secondary },
    input: { fontSize: 18, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, color: colors.primary },
    amountInput: { fontSize: 36, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, color: colors.accent },
    dateRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12, gap: 10 },
    toggleRow: { flexDirection: 'row', backgroundColor: colors.translucent, borderRadius: 12, padding: 4 },
    toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
    toggleActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
    saveButton: { height: 60, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: colors.accent },
    deleteButton: { height: 56, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, borderWidth: 1, borderColor: colors.danger },
    iosPickerContainer: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden', marginTop: 12, borderWidth: 1, borderColor: colors.border },
    iosPickerDone: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, alignItems: 'center' },
    pickerSheet: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginTop: 8, overflow: 'hidden' },
    pickerItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
    catChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6 },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    memberInput: { flex: 1, fontSize: 16, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 8, color: colors.primary },
    sharePreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: `${colors.accent}12`, borderRadius: 12, padding: 12, marginTop: 8 },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  });

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.content}>
          <View style={s.header}>
            <ThemedText className="text-2xl font-bold">{isEditing ? 'Edit Subscription' : 'New Subscription'}</ThemedText>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <LucideX color={colors.secondary} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Priority Section: Amount & Category side-by-side */}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20, alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <ThemedText style={s.label}>Amount ({preferences.currency})</ThemedText>
                <TextInput
                  style={s.amountInput}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={v => { setAmount(v); setErrors(e => ({ ...e, amount: undefined })); }}
                  autoFocus={!isEditing}
                />
                {errors.amount && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.amount}</ThemedText>}
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

            {/* Service Name */}
            <View style={s.field}>
              <ThemedText style={s.label}>Service Name</ThemedText>
              <TextInput
                style={s.input}
                placeholder="e.g. Netflix, Spotify, Gym"
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={v => { setName(v); setErrors(e => ({ ...e, name: undefined })); }}
              />
              {errors.name && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.name}</ThemedText>}
            </View>

            {/* Billing Cycle */}
            <View style={s.field}>
              <ThemedText style={s.label}>Billing Cycle</ThemedText>
              <View style={s.toggleRow}>
                {FREQUENCIES.map(f => (
                  <TouchableOpacity
                    key={f.key}
                    style={[s.toggleBtn, frequency === f.key && s.toggleActive]}
                    onPress={() => { setFrequency(f.key); Haptics.selectionAsync(); }}
                  >
                    <ThemedText style={{ fontSize: 12, fontWeight: 'bold', color: frequency === f.key ? colors.primary : colors.secondary }}>
                      {f.label}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Next Billing Date */}
            <View style={s.field}>
              <ThemedText style={s.label}>Next Billing Date</ThemedText>
              <TouchableOpacity style={s.dateRow} onPress={() => setShowDatePicker(true)}>
                <LucideCalendar color={colors.secondary} size={18} />
                <ThemedText style={{ fontSize: 16 }}>
                  {nextDueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                </ThemedText>
              </TouchableOpacity>
              {showDatePicker && (
                <View style={Platform.OS === 'ios' ? s.iosPickerContainer : undefined}>
                  <DateTimePicker
                    value={nextDueDate}
                    mode="date"
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDateChange}
                    minimumDate={new Date()}
                    themeVariant={isDark ? 'dark' : 'light'}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity onPress={() => setShowDatePicker(false)} style={s.iosPickerDone}>
                      <ThemedText style={{ color: colors.accent, fontWeight: 'bold' }}>Done</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Debit Account */}
            <View style={s.field}>
              <ThemedText style={s.label}>Debit Account</ThemedText>
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
                    onPress={() => { setDebitAccountId(undefined); setShowAccountPicker(false); }}
                  >
                    <ThemedText style={{ color: colors.secondary }}>None</ThemedText>
                  </TouchableOpacity>
                  {accounts.map(acc => (
                    <TouchableOpacity
                      key={acc.id}
                      style={[s.pickerItem, debitAccountId === acc.id && { backgroundColor: `${colors.accent}12` }]}
                      onPress={() => { setDebitAccountId(acc.id); setShowAccountPicker(false); }}
                    >
                      <LucideCreditCard color={debitAccountId === acc.id ? colors.accent : colors.secondary} size={16} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: 'bold', color: debitAccountId === acc.id ? colors.accent : colors.primary }}>
                          {acc.name}
                        </ThemedText>
                        <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                          {acc.accountType} · {preferences.currency}{acc.balance.toLocaleString('en-IN')}
                        </ThemedText>
                      </View>
                      {debitAccountId === acc.id && <LucideCheck color={colors.accent} size={16} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>



            {/* Split */}
            <View style={[s.field, { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: splitEnabled ? `${colors.accent}50` : colors.border }]}>
              <View style={s.switchRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <LucideUsers color={splitEnabled ? colors.accent : colors.secondary} size={20} />
                  <View>
                    <ThemedText style={{ fontWeight: 'bold', fontSize: 15 }}>Split with others</ThemedText>
                    <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                      Share the cost with friends
                    </ThemedText>
                  </View>
                </View>
                <Switch
                  value={splitEnabled}
                  onValueChange={v => { setSplitEnabled(v); Haptics.selectionAsync(); }}
                  trackColor={{ false: colors.border, true: `${colors.accent}80` }}
                  thumbColor={splitEnabled ? colors.accent : colors.secondary}
                />
              </View>

              {splitEnabled && (
                <View style={{ marginTop: 16 }}>
                  <ThemedText style={{ ...s.label, marginBottom: 12 }}>Friends sharing this subscription</ThemedText>
                  {splitMemberNames.map((memberName, idx) => (
                    <View key={idx} style={s.memberRow}>
                      <TextInput
                        style={s.memberInput}
                        placeholder={`Person ${idx + 1} name`}
                        placeholderTextColor={colors.muted}
                        value={memberName}
                        onChangeText={v => updateMember(idx, v)}
                      />
                      {splitMemberNames.length > 1 && (
                        <TouchableOpacity onPress={() => removeMember(idx)}>
                          <LucideTrash2 color={colors.danger} size={18} />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                  <TouchableOpacity
                    onPress={addMember}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}
                  >
                    <LucideUserPlus color={colors.accent} size={16} />
                    <ThemedText style={{ color: colors.accent, fontWeight: 'bold', fontSize: 13 }}>Add person</ThemedText>
                  </TouchableOpacity>

                  {amt > 0 && validMemberCount > 0 && (
                    <View style={s.sharePreview}>
                      <ThemedText style={{ fontSize: 12, color: colors.secondary }}>Your share ({totalPeople} people)</ThemedText>
                      <ThemedText style={{ fontWeight: 'bold', color: colors.accent }}>
                        {preferences.currency}{myShare.toLocaleString('en-IN')}
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Notes */}
            <View style={s.field}>
              <ThemedText style={s.label}>Notes (optional)</ThemedText>
              <TextInput
                style={[s.input, { fontSize: 15 }]}
                placeholder="Any notes about this subscription..."
                placeholderTextColor={colors.muted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>

            <TouchableOpacity style={s.saveButton} onPress={handleSave}>
              <LucideCheck color="#FFFFFF" size={24} />
              <ThemedText style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 18, marginLeft: 8 }}>
                {isEditing ? 'Save Changes' : 'Add Subscription'}
              </ThemedText>
            </TouchableOpacity>

            {isEditing && (
              <TouchableOpacity style={s.deleteButton} onPress={handleDelete}>
                <LucideTrash2 color={colors.danger} size={20} />
                <ThemedText style={{ color: colors.danger, fontWeight: 'bold', fontSize: 16, marginLeft: 8 }}>
                  Delete Subscription
                </ThemedText>
              </TouchableOpacity>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default AddSubscriptionScreen;
