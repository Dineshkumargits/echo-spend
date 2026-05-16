import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform, KeyboardAvoidingView, Modal, ActivityIndicator } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LucideX, LucideSave, LucideCheck, LucidePlus, LucideCalendar, LucideSearch, LucideTag, LucideChevronRight } from 'lucide-react-native';

import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import {
  updateTransaction,
  getCategories,
  Category,
  Transaction,
  getAccounts,
  Account,
  getGoals,
  Goal,
  getLoans,
  Loan,
  getSubscriptions,
  Subscription,
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { EntityLinker } from './AddTransactionScreen';
import { CategoryPicker } from '../components/CategoryPicker';
import { useNotifications } from '../hooks/useNotifications';
import { TagInput } from '../components/TagInput';

type RootStackParamList = {
  EditTransaction: { transaction: Transaction };
};
type EditTransactionScreenRouteProp = RouteProp<RootStackParamList, 'EditTransaction'>;

export const EditTransactionScreen = () => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const navigation = useNavigation();
  const { checkBudgetAlerts } = useNotifications();
  const route = useRoute<EditTransactionScreenRouteProp>();
  const { transaction } = route.params;

  const [amount, setAmount] = useState(transaction.amount.toString());
  const [merchant, setMerchant] = useState(transaction.merchant);
  const [category, setCategory] = useState(transaction.category);
  const [type, setType] = useState<'debit' | 'credit' | 'transfer'>(transaction.type as 'debit' | 'credit' | 'transfer');
  const [notes, setNotes] = useState(transaction.notes || '');
  const [tags, setTags] = useState<string[]>(transaction.tags || []);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  const [selectedAccount, setSelectedAccount] = useState<number | null>(transaction.accountId || null);
  const [selectedToAccount, setSelectedToAccount] = useState<number | null>(transaction.toAccountId || null);
  const [selectedGoal, setSelectedGoal] = useState<number | null>(transaction.goalId || null);
  const [selectedLoan, setSelectedLoan] = useState<number | null>(transaction.loanId || null);
  const [selectedSub, setSelectedSub] = useState<number | null>(transaction.subscriptionId || null);
  const [isBorrowed, setIsBorrowed] = useState(transaction.category === 'Debt'); // Simple heuristic

  const [date, setDate] = useState(new Date(transaction.date));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [errors, setErrors] = useState<{ amount?: string; merchant?: string; account?: string; toAccount?: string }>({});
  const [saving, setSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'set' && selectedDate) {
        if (pickerMode === 'date') {
          const newDate = new Date(date);
          newDate.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
          setDate(newDate);
          setPickerMode('time');
          setShowDatePicker(false);
          // Small delay for Android to show time picker
          setTimeout(() => setShowDatePicker(true), 100);
          return;
        } else {
          const newDate = new Date(date);
          newDate.setHours(selectedDate.getHours(), selectedDate.getMinutes());
          setDate(newDate);
        }
      }
      setShowDatePicker(false);
      setPickerMode('date');
    } else {
      if (selectedDate) setDate(selectedDate);
    }
  };

  const themedStyles = useMemo(() => createThemedStyles(colors, isDark), [colors, isDark]);

  const refreshCategories = () => {
    getCategories().then(setCategories);
  };



  useEffect(() => {
    Promise.all([
      getCategories(),
      getAccounts(),
      getGoals(true),
      getLoans(true),
      getSubscriptions(true)
    ]).then(([cats, accs, gs, ls, ss]) => {
      setCategories(cats);
      setAccounts(accs);
      setGoals(gs);
      setLoans(ls);
      setSubscriptions(ss);
    });
  }, []);

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      newErrors.amount = 'Enter a valid amount greater than 0';
    }
    if (parsedAmount > 10_000_000) {
      newErrors.amount = 'Amount cannot exceed ₹1,00,00,000';
    }
    if (!merchant.trim()) {
      newErrors.merchant = 'Merchant name is required';
    }
    if (merchant.trim().length > 100) {
      newErrors.merchant = 'Merchant name is too long (max 100 chars)';
    }
    if (!selectedAccount) {
      newErrors.account = 'Select an account';
    }
    if (type === 'transfer' && !selectedToAccount) {
      newErrors.toAccount = 'Select a destination account';
    } else if (type === 'transfer' && selectedAccount === selectedToAccount) {
      newErrors.toAccount = 'Source and destination cannot be the same';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateTransaction(transaction.id, {
      amount: parseFloat(amount),
      merchant: merchant.trim(),
      category,
      type,
      date: date.toISOString(),
      notes: notes.trim() || undefined,
      isConfirmed: true,
      isTransfer: type === 'transfer',
      accountId: selectedAccount || undefined,
      toAccountId: type === 'transfer' ? (selectedToAccount || undefined) : undefined,
      goalId: selectedGoal || undefined,
      loanId: selectedLoan || undefined,
      subscriptionId: selectedSub || undefined,
      tags: tags.length > 0 ? tags : undefined,
    });

    notify.success('Transaction updated');
    checkBudgetAlerts();
    navigation.goBack();
  };


  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={themedStyles.content}>
          <View style={themedStyles.header}>
            <ThemedText className="text-2xl font-bold">Edit Transaction</ThemedText>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <LucideX color={colors.secondary} size={24} />
            </TouchableOpacity>
          </View>

          {/* Type toggle */}
          <View style={[themedStyles.typeToggle, { backgroundColor: colors.translucent }]}>
            {(['debit', 'credit', 'transfer'] as const).map(t => (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                style={[
                  themedStyles.typeBtn,
                  type === t && { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }
                ]}
              >
                <ThemedText
                  className="text-xs font-bold"
                  style={{ color: type === t ? colors.primary : colors.secondary }}
                >
                  {t === 'debit' ? 'EXPENSE' : (t === 'transfer' ? 'TRANSFER' : 'INCOME')}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {/* Priority Section: Amount & Category side-by-side */}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24, alignItems: 'center' }}>
              {/* 1. Amount */}
              <View style={{ flex: 1 }}>
                <ThemedText type="secondary" style={themedStyles.label}>Amount (₹)</ThemedText>
                <TextInput
                  style={[
                    themedStyles.amountInput,
                    { color: type === 'transfer' ? colors.warning : (type === 'credit' ? colors.success : colors.accent) },
                    errors.amount && { borderBottomColor: colors.danger }
                  ]}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={v => { setAmount(v); setErrors(e => ({ ...e, amount: undefined })); }}
                />
                {errors.amount && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.amount}</ThemedText>}
              </View>

              {/* 2. Category Square Card */}
              <CategoryPicker
                selectedCategory={category}
                onSelect={setCategory}
                categories={categories}
                type={type === 'debit' ? 'expense' : (type === 'credit' ? 'income' : 'transfer')}
                refreshCategories={refreshCategories}
                variant="square"
              />
            </View>

            {/* 3. Account Selector */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>{type === 'transfer' ? 'From Account' : 'Account'}</ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="-mx-6 mb-2"
                contentContainerStyle={{ paddingHorizontal: 24, paddingRight: 32 }}
                nestedScrollEnabled={true}
              >
                {accounts.sort((a,b) => a.displayOrder - b.displayOrder).map(acc => (
                  <TouchableOpacity
                    key={acc.id}
                    onPress={() => {
                      setSelectedAccount(acc.id);
                      setErrors(e => ({ ...e, account: undefined }));
                    }}
                    style={[
                      themedStyles.pill,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                      selectedAccount === acc.id && { backgroundColor: `${colors.accent}15`, borderColor: colors.accent }
                    ]}
                  >
                    <ThemedText style={{ color: selectedAccount === acc.id ? colors.accent : colors.secondary, fontWeight: 'bold' }}>
                      {acc.name}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {errors.account && <ThemedText style={{ color: colors.danger, fontSize: 12 }}>{errors.account}</ThemedText>}
            </View>

            {/* 3.5. To Account Selector (Transfer only) */}
            {type === 'transfer' && (
              <View style={themedStyles.field}>
                <ThemedText type="secondary" style={themedStyles.label}>To Account</ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="-mx-6 mb-2"
                  contentContainerStyle={{ paddingHorizontal: 24, paddingRight: 32 }}
                  nestedScrollEnabled={true}
                >
                  {accounts.sort((a, b) => a.displayOrder - b.displayOrder).map(acc => (
                    <TouchableOpacity
                      key={`to-${acc.id}`}
                      onPress={() => {
                        setSelectedToAccount(acc.id);
                        setErrors(e => ({ ...e, toAccount: undefined }));
                      }}
                      style={[
                        themedStyles.pill,
                        { backgroundColor: colors.surface, borderColor: colors.border },
                        selectedToAccount === acc.id && { backgroundColor: `${colors.warning}15`, borderColor: colors.warning }
                      ]}
                    >
                      <ThemedText style={{ color: selectedToAccount === acc.id ? colors.warning : colors.secondary, fontWeight: 'bold' }}>
                        {acc.name}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {errors.toAccount && <ThemedText style={{ color: colors.danger, fontSize: 12 }}>{errors.toAccount}</ThemedText>}
              </View>
            )}

            {/* 4. Merchant */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>Merchant / Source</ThemedText>
              <TextInput
                style={[
                  themedStyles.merchantInput,
                  { color: colors.primary, borderBottomColor: colors.border },
                  errors.merchant && { borderBottomColor: colors.danger }
                ]}
                placeholder="e.g. Starbucks, Salary"
                placeholderTextColor={colors.muted}
                value={merchant}
                onChangeText={v => { setMerchant(v); setErrors(e => ({ ...e, merchant: undefined })); }}
                maxLength={100}
              />
              {errors.merchant && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.merchant}</ThemedText>}
            </View>

            {/* 5. Date */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>Transaction Date & Time</ThemedText>
              <TouchableOpacity
                style={[themedStyles.dateRow, { borderBottomColor: colors.border }]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <LucideCalendar color={colors.secondary} size={16} />
                <ThemedText style={{ fontSize: 16 }}>
                  {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </ThemedText>
              </TouchableOpacity>
              {showDatePicker && (
                <View style={Platform.OS === 'ios' ? themedStyles.iosPickerContainer : undefined}>
                  <DateTimePicker
                    value={date}
                    mode={Platform.OS === 'ios' ? 'datetime' : pickerMode}
                    display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                    onChange={handleDateChange}
                    maximumDate={new Date()}
                    themeVariant={isDark ? 'dark' : 'light'}
                  />
                  {Platform.OS === 'ios' && (
                    <TouchableOpacity onPress={() => setShowDatePicker(false)} style={themedStyles.iosPickerDone}>
                      <ThemedText style={{ color: colors.accent, fontWeight: 'bold' }}>Done</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* 6. Linking Section */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={[themedStyles.label, { marginBottom: 12 }]}>
                Link to Subscription / Goal / Loan
              </ThemedText>
              <EntityLinker
                goals={goals}
                loans={loans}
                subscriptions={subscriptions}
                selectedGoal={selectedGoal}
                selectedLoan={selectedLoan}
                selectedSub={selectedSub}
                onGoal={id => { setSelectedLoan(null); setSelectedSub(null); setSelectedGoal(id); }}
                onLoan={id => { setSelectedGoal(null); setSelectedSub(null); setSelectedLoan(id); }}
                onSub={id => { setSelectedGoal(null); setSelectedLoan(null); setSelectedSub(id); }}
                colors={colors}
                currency={preferences.currency}
              />
            </View>

            {/* 7. Borrowed Toggle */}
            <View style={[themedStyles.field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
              <View>
                <ThemedText type="secondary" style={themedStyles.label}>Personal Debt?</ThemedText>
                <ThemedText type="secondary" className="text-xs">Borrowed or Lent money</ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => setIsBorrowed(!isBorrowed)}
                style={{
                  width: 50, height: 30, borderRadius: 15,
                  backgroundColor: isBorrowed ? colors.warning : colors.muted,
                  justifyContent: 'center', paddingHorizontal: 2
                }}
              >
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#FFFFFF', transform: [{ translateX: isBorrowed ? 20 : 0 }] }} />
              </TouchableOpacity>
            </View>

            {/* 8. Notes */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>Notes (optional)</ThemedText>
              <TextInput
                style={[themedStyles.notesInput, { color: colors.primary, borderBottomColor: colors.border }]}
                placeholder="Add a note..."
                placeholderTextColor={colors.muted}
                value={notes}
                onChangeText={setNotes}
                maxLength={200}
                multiline
              />
            </View>

            {/* 9. Tags */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>Tags (optional)</ThemedText>
              <TagInput tags={tags} onChangeTags={setTags} />
            </View>

          </ScrollView>

          {/* Sticky Update Button */}
          <View style={[themedStyles.footer, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[
                themedStyles.saveButton,
                { backgroundColor: colors.accent },
                (!amount || saving) && { opacity: 0.5 }
              ]}
              onPress={handleSave}
              disabled={!amount || saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <LucideCheck color="#FFFFFF" size={22} />
                  <ThemedText className="font-bold text-lg ml-2" style={{ color: '#FFFFFF' }}>Update Transaction</ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

    </ThemedSafeAreaView>
  );
};

const createThemedStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  content: { padding: 24, flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  typeToggle: { flexDirection: 'row', borderRadius: 50, padding: 4, marginBottom: 24 },
  typeBtn: { flex: 1, paddingVertical: 10, borderRadius: 50, alignItems: 'center' },
  field: { marginBottom: 24 },
  label: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' },
  amountInput: { fontSize: 36, fontWeight: 'bold', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'transparent' },
  merchantInput: { fontSize: 17, borderBottomWidth: 1, paddingVertical: 10 },
  notesInput: { fontSize: 15, borderBottomWidth: 1, paddingVertical: 10, minHeight: 44 },
  selectedIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  saveButton: { height: 60, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 20, borderTopWidth: 1 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  pill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, marginRight: 8 },
  iosPickerContainer: { backgroundColor: colors.surface, borderRadius: 20, marginTop: 10, padding: 10 },
  iosPickerDone: { alignItems: 'center', padding: 12, marginTop: 4 },
});

export default EditTransactionScreen;
