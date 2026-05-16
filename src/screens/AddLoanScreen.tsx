import React, { useState, useEffect } from 'react';
import {
  View, StyleSheet, TextInput, TouchableOpacity, ScrollView,
  Platform, KeyboardAvoidingView,
} from 'react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import {
  LucideX, LucideCheck, LucideCalendar, LucideLandmark,
  LucideChevronDown, LucideCreditCard,
} from 'lucide-react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation } from '@react-navigation/native';
import { addLoan, getAccounts, Account } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';

export const AddLoanScreen = () => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const navigation = useNavigation();

  const [type, setType] = useState<'borrowed' | 'lent'>('borrowed');
  const [lender, setLender] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [remainingAmount, setRemainingAmount] = useState('');
  const [emiAmount, setEmiAmount] = useState('');
  const [tenure, setTenure] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [nextDueDate, setNextDueDate] = useState<Date>(
    new Date(new Date().setMonth(new Date().getMonth() + 1))
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [notes, setNotes] = useState('');

  // Linked account
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAccountId, setLinkedAccountId] = useState<number | undefined>();
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const [errors, setErrors] = useState<{ lender?: string; total?: string; emi?: string }>({});

  useEffect(() => {
    getAccounts().then(setAccounts);
  }, []);

  const selectedAccount = accounts.find(a => a.id === linkedAccountId);

  const accentColor = type === 'borrowed' ? colors.warning : colors.success;

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) setNextDueDate(selectedDate);
  };

  // Auto-compute EMI from total + tenure + interest
  const computeEmi = () => {
    const P = parseFloat(totalAmount);
    const r = parseFloat(interestRate) / 12 / 100;
    const n = parseInt(tenure, 10);
    if (!P || !n || n <= 0) return;
    if (!interestRate || parseFloat(interestRate) === 0) {
      setEmiAmount(String(Math.round(P / n)));
      return;
    }
    // EMI = P * r * (1+r)^n / ((1+r)^n - 1)
    const emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    setEmiAmount(String(Math.round(emi)));
  };

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!lender.trim()) {
      newErrors.lender = type === 'borrowed' ? 'Lender name is required' : 'Person name is required';
    }
    const total = parseFloat(totalAmount);
    if (!totalAmount || isNaN(total) || total <= 0) newErrors.total = 'Enter a valid amount';
    if (type === 'borrowed') {
      const emi = parseFloat(emiAmount);
      if (!emiAmount || isNaN(emi) || emi <= 0) newErrors.emi = 'Enter a valid EMI amount';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const total = parseFloat(totalAmount);
    const remaining = remainingAmount ? parseFloat(remainingAmount) : total;

    await addLoan({
      lender: lender.trim(),
      totalAmount: total,
      remainingAmount: remaining,
      emiAmount: parseFloat(emiAmount) || 0,
      nextDueDate: nextDueDate.toISOString(),
      interestRate: interestRate ? parseFloat(interestRate) : undefined,
      isActive: true,
      type,
      linkedAccountId,
      tenure: tenure ? parseInt(tenure, 10) : undefined,
      notes: notes.trim() || undefined,
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notify.success(type === 'borrowed' ? 'Loan added!' : 'Debt record created!');
    navigation.goBack();
  };

  // Interest calculations for borrowed
  const totalP = parseFloat(totalAmount) || 0;
  const monthlyEmi = parseFloat(emiAmount) || 0;
  const tenureN = parseInt(tenure, 10) || 0;
  const totalPayable = monthlyEmi * tenureN;
  const totalInterest = totalPayable - totalP;

  // Remaining EMIs estimate
  const remainingP = remainingAmount ? parseFloat(remainingAmount) : totalP;
  const remainingEmis = monthlyEmi > 0 ? Math.ceil(remainingP / monthlyEmi) : null;

  const s = StyleSheet.create({
    content: { padding: 24, flex: 1 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
    field: { marginBottom: 20 },
    label: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold', color: colors.secondary },
    input: { fontSize: 18, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, color: colors.primary },
    amountInput: { fontSize: 36, fontWeight: 'bold', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10, color: accentColor },
    dateRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12, gap: 10 },
    toggleRow: { flexDirection: 'row', backgroundColor: colors.translucent, borderRadius: 12, padding: 4, marginBottom: 20 },
    toggleBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
    toggleActive: { backgroundColor: colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
    saveButton: { height: 60, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16, backgroundColor: accentColor },
    iosPickerContainer: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden', marginTop: 12, borderWidth: 1, borderColor: colors.border },
    iosPickerDone: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, alignItems: 'center' },
    pickerSheet: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginTop: 8, overflow: 'hidden' },
    pickerItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10 },
    splitRow: { flexDirection: 'row', gap: 16 },
    halfField: { flex: 1 },
    infoBox: { borderRadius: 12, padding: 12, marginBottom: 20, flexDirection: 'row', justifyContent: 'space-between' },
    computeBtn: { marginTop: 8, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, alignSelf: 'flex-start' },
  });

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.content}>
          <View style={s.header}>
            <ThemedText className="text-2xl font-bold">
              {type === 'borrowed' ? 'New Loan' : 'Lend Money'}
            </ThemedText>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <LucideX color={colors.secondary} size={24} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Type Toggle */}
            <View style={s.toggleRow}>
              <TouchableOpacity
                style={[s.toggleBtn, type === 'borrowed' && s.toggleActive]}
                onPress={() => { setType('borrowed'); Haptics.selectionAsync(); }}
              >
                <ThemedText style={{ fontSize: 12, fontWeight: 'bold', color: type === 'borrowed' ? colors.primary : colors.secondary }}>
                  Borrowing
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.toggleBtn, type === 'lent' && s.toggleActive]}
                onPress={() => { setType('lent'); Haptics.selectionAsync(); }}
              >
                <ThemedText style={{ fontSize: 12, fontWeight: 'bold', color: type === 'lent' ? colors.primary : colors.secondary }}>
                  Lending
                </ThemedText>
              </TouchableOpacity>
            </View>

            {/* EMI / Collecting Amount */}
            <View style={s.field}>
              <ThemedText style={s.label}>
                {type === 'borrowed' ? `EMI Amount (${preferences.currency})` : `Collecting Amount (${preferences.currency})`}
              </ThemedText>
              <TextInput
                style={s.amountInput}
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                value={emiAmount}
                onChangeText={v => { setEmiAmount(v); setErrors(e => ({ ...e, emi: undefined })); }}
                autoFocus
              />
              {type === 'borrowed' && errors.emi && (
                <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.emi}</ThemedText>
              )}
            </View>

            {/* Lender / Person Name */}
            <View style={s.field}>
              <ThemedText style={s.label}>
                {type === 'borrowed' ? 'Lender / Institution' : 'Friend / Person Name'}
              </ThemedText>
              <TextInput
                style={s.input}
                placeholder={type === 'borrowed' ? 'e.g. HDFC Bank' : 'e.g. John Doe'}
                placeholderTextColor={colors.muted}
                value={lender}
                onChangeText={v => { setLender(v); setErrors(e => ({ ...e, lender: undefined })); }}
              />
              {errors.lender && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.lender}</ThemedText>}
            </View>

            {/* Total + Remaining */}
            <View style={[s.field, s.splitRow]}>
              <View style={s.halfField}>
                <ThemedText style={s.label}>Total Amount ({preferences.currency})</ThemedText>
                <TextInput
                  style={s.input}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={totalAmount}
                  onChangeText={v => { setTotalAmount(v); setErrors(e => ({ ...e, total: undefined })); }}
                />
                {errors.total && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.total}</ThemedText>}
              </View>
              <View style={s.halfField}>
                <ThemedText style={s.label}>Remaining ({preferences.currency})</ThemedText>
                <TextInput
                  style={s.input}
                  placeholder="Full amount"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={remainingAmount}
                  onChangeText={setRemainingAmount}
                />
              </View>
            </View>

            {/* Tenure + Interest Rate (borrowed only) */}
            {type === 'borrowed' && (
              <View style={[s.field, s.splitRow]}>
                <View style={s.halfField}>
                  <ThemedText style={s.label}>Tenure (months)</ThemedText>
                  <TextInput
                    style={s.input}
                    placeholder="e.g. 24"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    value={tenure}
                    onChangeText={setTenure}
                  />
                </View>
                <View style={s.halfField}>
                  <ThemedText style={s.label}>Interest Rate (%)</ThemedText>
                  <TextInput
                    style={s.input}
                    placeholder="0.00"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    value={interestRate}
                    onChangeText={setInterestRate}
                  />
                </View>
              </View>
            )}

            {/* Auto-compute EMI button */}
            {type === 'borrowed' && totalP > 0 && tenureN > 0 && (
              <TouchableOpacity
                style={[s.computeBtn, { borderColor: accentColor }]}
                onPress={() => { computeEmi(); Haptics.selectionAsync(); }}
              >
                <ThemedText style={{ color: accentColor, fontWeight: 'bold', fontSize: 12 }}>
                  Calculate EMI from Total + Tenure
                </ThemedText>
              </TouchableOpacity>
            )}

            {/* Loan summary info */}
            {type === 'borrowed' && monthlyEmi > 0 && tenureN > 0 && totalInterest > 0 && (
              <View style={[s.infoBox, { backgroundColor: `${accentColor}10`, marginTop: 12 }]}>
                <View style={{ alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Total Payable</ThemedText>
                  <ThemedText style={{ fontWeight: 'bold', color: accentColor }}>{preferences.currency}{totalPayable.toLocaleString('en-IN')}</ThemedText>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Interest</ThemedText>
                  <ThemedText style={{ fontWeight: 'bold', color: colors.danger }}>{preferences.currency}{Math.round(totalInterest).toLocaleString('en-IN')}</ThemedText>
                </View>
                {remainingEmis !== null && (
                  <View style={{ alignItems: 'center' }}>
                    <ThemedText style={{ fontSize: 10, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Remaining EMIs</ThemedText>
                    <ThemedText style={{ fontWeight: 'bold', color: colors.primary }}>{remainingEmis}</ThemedText>
                  </View>
                )}
              </View>
            )}

            {/* Next Due Date */}
            <View style={s.field}>
              <ThemedText style={s.label}>
                {type === 'borrowed' ? 'Next EMI Date' : 'Expected Repayment Date'}
              </ThemedText>
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
                      <ThemedText style={{ color: accentColor, fontWeight: 'bold' }}>Done</ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* Linked Account */}
            <View style={s.field}>
              <ThemedText style={s.label}>
                {type === 'borrowed' ? 'EMI Debit Account' : 'Repayment Credit Account'}
              </ThemedText>
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
                      style={[s.pickerItem, linkedAccountId === acc.id && { backgroundColor: `${accentColor}12` }]}
                      onPress={() => { setLinkedAccountId(acc.id); setShowAccountPicker(false); }}
                    >
                      <LucideCreditCard color={linkedAccountId === acc.id ? accentColor : colors.secondary} size={16} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontWeight: 'bold', color: linkedAccountId === acc.id ? accentColor : colors.primary }}>
                          {acc.name}
                        </ThemedText>
                        <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                          {acc.accountType} · {preferences.currency}{acc.balance.toLocaleString('en-IN')}
                        </ThemedText>
                      </View>
                      {linkedAccountId === acc.id && <LucideCheck color={accentColor} size={16} />}
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
                placeholder="e.g. Home loan, car loan, friend loan..."
                placeholderTextColor={colors.muted}
                value={notes}
                onChangeText={setNotes}
                multiline
              />
            </View>

            <TouchableOpacity style={s.saveButton} onPress={handleSave}>
              <LucideCheck color="#FFFFFF" size={24} />
              <ThemedText style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 18, marginLeft: 8 }}>
                {type === 'borrowed' ? 'Add Loan' : 'Add Record'}
              </ThemedText>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default AddLoanScreen;
