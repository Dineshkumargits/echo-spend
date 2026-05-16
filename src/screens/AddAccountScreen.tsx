import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, ScrollView, Alert, Platform, KeyboardAvoidingView, Text } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LucideX, LucideCheck, LucideCalendar, LucideTrash2, LucideInfo } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { addAccount, updateAccount, deleteAccount, Account } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';

type AccountType = Account['accountType'];

const ACCOUNT_TYPES: { type: AccountType; label: string; emoji: string }[] = [
  { type: 'bank', label: 'Bank', emoji: '🏦' },
  { type: 'credit_card', label: 'Credit Card', emoji: '💳' },
  { type: 'cash', label: 'Cash', emoji: '💵' },
  { type: 'wallet', label: 'Wallet', emoji: '👛' },
];

type RootStackParamList = {
  AddAccount: { accountToEdit?: Account; initialType?: AccountType };
};
type AddAccountScreenRouteProp = RouteProp<RootStackParamList, 'AddAccount'>;

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const AddAccountScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation();
  const route = useRoute<AddAccountScreenRouteProp>();
  const accountToEdit = route.params?.accountToEdit;

  const [name, setName] = useState(accountToEdit?.name || '');
  const [balance, setBalance] = useState(accountToEdit ? accountToEdit.balance.toString() : '');
  const [accountType, setAccountType] = useState<AccountType>(
    accountToEdit?.accountType || route.params?.initialType || 'bank'
  );
  const [last4Digits, setLast4Digits] = useState(accountToEdit?.last4Digits || '');
  const [creditLimit, setCreditLimit] = useState(accountToEdit?.creditLimit?.toString() || '');
  const [statementDay, setStatementDay] = useState<number | null>(accountToEdit?.statementDay ?? null);
  const [billDueDay, setBillDueDay] = useState<number | null>(accountToEdit?.billDueDay ?? null);
  const [showStatementDayPicker, setShowStatementDayPicker] = useState(false);
  const [showBillDueDayPicker, setShowBillDueDayPicker] = useState(false);

  const defaultStartDate = new Date().toISOString();
  // Support legacy "YYYY-MM-DD" by converting it into full ISO on load
  const [startDate, setStartDate] = useState(accountToEdit?.startDate 
    ? (accountToEdit.startDate.includes('T') ? accountToEdit.startDate : new Date(accountToEdit.startDate).toISOString()) 
    : defaultStartDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [errors, setErrors] = useState<{ name?: string; balance?: string; startDate?: string; creditLimit?: string; last4Digits?: string }>({});

  const isCC = accountType === 'credit_card';
  const themedStyles = useMemo(() => createThemedStyles(colors, isDark), [colors, isDark]);

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'set' && selectedDate) {
        if (pickerMode === 'date') {
          // Keep old time, update date
          const current = new Date(startDate);
          selectedDate.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds());
          setStartDate(selectedDate.toISOString());
          setPickerMode('time');
          setShowDatePicker(false);
          // React Native Android date picker needs a slight delay before showing the next one
          setTimeout(() => setShowDatePicker(true), 50);
        } else {
          // Keep new date, update time
          const current = new Date(startDate);
          current.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
          setStartDate(current.toISOString());
          setShowDatePicker(false);
        }
      } else {
        setShowDatePicker(false);
      }
    } else {
      if (selectedDate) setStartDate(selectedDate.toISOString());
    }
    setErrors(e => ({ ...e, startDate: undefined }));
  };

  useEffect(() => {
    if (accountToEdit) {
      setName(accountToEdit.name);
      setBalance(accountToEdit.balance.toString());
      setAccountType(accountToEdit.accountType || 'bank');
      setCreditLimit(accountToEdit.creditLimit?.toString() || '');
      setStatementDay(accountToEdit.statementDay ?? null);
      setBillDueDay(accountToEdit.billDueDay ?? null);
      setStartDate(accountToEdit.startDate);
      setLast4Digits(accountToEdit.last4Digits || '');
    }
  }, [accountToEdit]);

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    if (!name.trim()) {
      newErrors.name = 'Account name is required';
    } else if (name.trim().length > 60) {
      newErrors.name = 'Max 60 characters';
    }
    const parsed = parseFloat(balance);
    if (!balance || isNaN(parsed)) {
      newErrors.balance = isCC ? 'Enter outstanding amount (0 if fully paid)' : 'Enter a valid balance (can be 0)';
    } else if (parsed < 0) {
      newErrors.balance = isCC ? 'Outstanding cannot be negative' : 'Balance cannot be negative';
    }
    if (isCC && creditLimit) {
      const cl = parseFloat(creditLimit);
      if (isNaN(cl) || cl <= 0) {
        newErrors.creditLimit = 'Enter a valid credit limit';
      } else if (!isNaN(parsed) && parsed > cl) {
        newErrors.creditLimit = 'Outstanding exceeds credit limit';
      }
    }
    if (isNaN(new Date(startDate).getTime())) {
      newErrors.startDate = 'Select a valid date and time';
    }
    if (last4Digits && !/^\d{4}$/.test(last4Digits)) {
      newErrors.last4Digits = 'Enter exactly 4 digits';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    const payload: Partial<Account> = {
      name: name.trim(),
      accountType,
      creditLimit: isCC && creditLimit ? parseFloat(creditLimit) : undefined,
      statementDay: isCC && statementDay ? statementDay : undefined,
      billDueDay: isCC && billDueDay ? billDueDay : undefined,
      startDate,
      last4Digits: last4Digits.trim() || undefined,
    };

    if (!accountToEdit) {
      payload.balance = parseFloat(balance);
      payload.startingBalance = parseFloat(balance);
    }

    try {
      if (accountToEdit) {
        await updateAccount(accountToEdit.id, payload);
        notify.success('Account updated');
      } else {
        await addAccount(payload as Omit<Account, 'id'>);
        notify.success('Account added');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.goBack();
    } catch {
      notify.error('Failed to save account');
    }
  };

  const handleDelete = () => {
    if (!accountToEdit) return;
    Alert.alert(
      'Delete Account',
      'Are you sure? Transactions linked to this account will be kept but unlinked.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount(accountToEdit.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              notify.success('Account deleted');
              navigation.goBack();
            } catch {
              notify.error('Failed to delete account');
            }
          },
        },
      ]
    );
  };

  const DayPickerModal = ({
    visible,
    selected,
    onSelect,
    onClose,
    title,
  }: {
    visible: boolean;
    selected: number | null;
    onSelect: (d: number) => void;
    onClose: () => void;
    title: string;
  }) => {
    if (!visible) return null;
    return (
      <View style={[themedStyles.dayPickerOverlay]}>
        <View style={[themedStyles.dayPickerSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={themedStyles.dayPickerHeader}>
            <ThemedText className="font-bold text-base">{title}</ThemedText>
            <TouchableOpacity onPress={onClose}>
              <LucideX color={colors.secondary} size={18} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={themedStyles.dayGrid} showsVerticalScrollIndicator={false}>
            {DAY_OPTIONS.map(d => (
              <TouchableOpacity
                key={d}
                onPress={() => { onSelect(d); onClose(); }}
                style={[
                  themedStyles.dayCell,
                  { backgroundColor: selected === d ? colors.accent : colors.translucent },
                ]}
              >
                <Text style={{ color: selected === d ? '#fff' : colors.primary, fontWeight: 'bold', fontSize: 14 }}>
                  {d}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    );
  };

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={{ flex: 1, padding: 24 }}>
          <View style={themedStyles.header}>
            <ThemedText className="text-xl font-bold">{accountToEdit ? 'Edit Account' : 'Add Account'}</ThemedText>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={[themedStyles.closeBtn, { backgroundColor: colors.translucent }]}
            >
              <LucideX color={colors.primary} size={18} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {/* Account Type */}
            <ThemedText type="secondary" style={themedStyles.label}>Account Type</ThemedText>
            <View style={themedStyles.typeRow}>
              {ACCOUNT_TYPES.map(({ type, label, emoji }) => (
                <TouchableOpacity
                  key={type}
                  onPress={() => setAccountType(type)}
                  style={[
                    themedStyles.typeChip,
                    { backgroundColor: accountType === type ? `${colors.accent}20` : colors.translucent },
                    accountType === type && { borderColor: colors.accent },
                  ]}
                >
                  <ThemedText style={themedStyles.typeEmoji}>{emoji}</ThemedText>
                  <ThemedText
                    className="text-xs font-bold"
                    style={{ color: accountType === type ? colors.accent : colors.secondary }}
                  >
                    {label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* CC info banner */}
            {isCC && (
              <View style={[themedStyles.infoBanner, { backgroundColor: `${colors.accent}12`, borderColor: `${colors.accent}30` }]}>
                <LucideInfo color={colors.accent} size={14} />
                <ThemedText style={{ color: colors.accent, fontSize: 12, flex: 1, marginLeft: 8, lineHeight: 18 }}>
                  For credit cards, the balance tracks what you owe. Purchases increase it; payments decrease it.
                </ThemedText>
              </View>
            )}

            {/* Name */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                {isCC ? 'Card / Bank Name' : 'Bank / Account Name'}
              </ThemedText>
              <TextInput
                style={[
                  themedStyles.input,
                  { backgroundColor: colors.translucent, borderColor: colors.border, color: colors.primary },
                  errors.name && { borderColor: colors.danger },
                ]}
                placeholder={isCC ? 'e.g. HDFC Regalia, SBI SimplyCLICK' : 'e.g. HDFC Bank, Paytm Wallet'}
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={v => { setName(v); setErrors(e => ({ ...e, name: undefined })); }}
                maxLength={60}
              />
              {errors.name && <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.name}</ThemedText>}
            </View>

            {/* Last 4 digits — only relevant for bank/credit-card, not cash/wallet */}
            {(accountType === 'bank' || accountType === 'credit_card') && (
              <View style={themedStyles.field}>
                <ThemedText type="secondary" style={themedStyles.label}>
                  {isCC ? 'Last 4 Digits of Card' : 'Last 4 Digits of Account No.'}
                </ThemedText>
                <TextInput
                  style={[
                    themedStyles.input,
                    themedStyles.last4Input,
                    { backgroundColor: colors.translucent, borderColor: errors.last4Digits ? colors.danger : colors.border, color: colors.primary },
                  ]}
                  placeholder="e.g. 4321"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  maxLength={4}
                  value={last4Digits}
                  onChangeText={v => {
                    const digits = v.replace(/\D/g, '').slice(0, 4);
                    setLast4Digits(digits);
                    setErrors(e => ({ ...e, last4Digits: undefined }));
                  }}
                />
                {errors.last4Digits
                  ? <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.last4Digits}</ThemedText>
                  : <ThemedText type="secondary" className="text-[11px] mt-1 italic">
                      Used by Smart Scan to match SMS to this account. Check your bank app or statement.
                    </ThemedText>
                }
              </View>
            )}

            {/* Balance / Outstanding — ONLY SHOW ON CREATE */}
            {!accountToEdit && (
              <View style={themedStyles.field}>
                <ThemedText type="secondary" style={themedStyles.label}>
                  {isCC ? 'Current Outstanding (₹)' : 'Opening Balance (₹)'}
                </ThemedText>
                <TextInput
                  style={[
                    themedStyles.input,
                    themedStyles.balanceInput,
                    { backgroundColor: colors.translucent, borderColor: colors.border, color: colors.primary },
                    errors.balance && { borderColor: colors.danger },
                  ]}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={balance}
                  onChangeText={v => { setBalance(v); setErrors(e => ({ ...e, balance: undefined })); }}
                />
                {errors.balance
                  ? <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.balance}</ThemedText>
                  : <ThemedText type="secondary" className="text-[11px] mt-1 italic">
                    {isCC
                      ? 'How much you owe right now. Enter 0 if your card is fully paid.'
                      : 'Your account balance right now. We\'ll track all changes after this.'}
                  </ThemedText>
                }
              </View>
            )}

            {/* Credit card specific fields */}
            {isCC && (
              <>
                {/* Credit Limit */}
                <View style={themedStyles.field}>
                  <ThemedText type="secondary" style={themedStyles.label}>Credit Limit (₹) — optional</ThemedText>
                  <TextInput
                    style={[
                      themedStyles.input,
                      { backgroundColor: colors.translucent, borderColor: errors.creditLimit ? colors.danger : colors.border, color: colors.primary },
                    ]}
                    placeholder="e.g. 100000"
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    value={creditLimit}
                    onChangeText={v => { setCreditLimit(v); setErrors(e => ({ ...e, creditLimit: undefined })); }}
                  />
                  {errors.creditLimit
                    ? <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.creditLimit}</ThemedText>
                    : creditLimit && !isNaN(parseFloat(creditLimit)) && !isNaN(parseFloat(balance)) && (
                      <ThemedText type="secondary" className="text-[11px] mt-1 italic">
                        Available credit: ₹{(parseFloat(creditLimit) - (parseFloat(balance) || 0)).toLocaleString('en-IN')}
                      </ThemedText>
                    )
                  }
                </View>

                {/* Statement Day */}
                <View style={themedStyles.field}>
                  <ThemedText type="secondary" style={themedStyles.label}>Statement Generation Date — optional</ThemedText>
                  <TouchableOpacity
                    onPress={() => setShowStatementDayPicker(true)}
                    style={[themedStyles.dateRow, { backgroundColor: colors.translucent, borderColor: colors.border }]}
                    activeOpacity={0.7}
                  >
                    <LucideCalendar color={colors.secondary} size={16} />
                    <ThemedText style={{ flex: 1, fontSize: 16, marginLeft: 10, color: statementDay ? colors.primary : colors.muted }}>
                      {statementDay ? `${ordinal(statementDay)} of each month` : 'Not set'}
                    </ThemedText>
                  </TouchableOpacity>
                  <ThemedText type="secondary" className="text-[11px] mt-1 italic">
                    Day your bank generates the monthly statement.
                  </ThemedText>
                </View>

                {/* Bill Due Day */}
                <View style={themedStyles.field}>
                  <ThemedText type="secondary" style={themedStyles.label}>Payment Due Date — optional</ThemedText>
                  <TouchableOpacity
                    onPress={() => setShowBillDueDayPicker(true)}
                    style={[themedStyles.dateRow, { backgroundColor: colors.translucent, borderColor: colors.border }]}
                    activeOpacity={0.7}
                  >
                    <LucideCalendar color={colors.secondary} size={16} />
                    <ThemedText style={{ flex: 1, fontSize: 16, marginLeft: 10, color: billDueDay ? colors.primary : colors.muted }}>
                      {billDueDay ? `${ordinal(billDueDay)} of each month` : 'Not set'}
                    </ThemedText>
                  </TouchableOpacity>
                  <ThemedText type="secondary" className="text-[11px] mt-1 italic">
                    Day by which you must pay at least the minimum amount.
                  </ThemedText>
                </View>
              </>
            )}

            {/* Start Date */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                {isCC ? 'Outstanding As Of' : 'Balance As Of'}
              </ThemedText>
              <TouchableOpacity
                style={[
                  themedStyles.dateRow,
                  { backgroundColor: colors.translucent, borderColor: errors.startDate ? colors.danger : colors.border },
                ]}
                onPress={() => {
                  setPickerMode('date');
                  setShowDatePicker(true);
                }}
                activeOpacity={0.7}
              >
                <LucideCalendar color={colors.secondary} size={16} />
                <ThemedText style={themedStyles.dateInput}>
                  {new Date(startDate).toLocaleString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: 'numeric', minute: '2-digit', hour12: true
                  })}
                </ThemedText>
              </TouchableOpacity>
              {errors.startDate
                ? <ThemedText style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{errors.startDate}</ThemedText>
                : <ThemedText type="secondary" className="text-[11px] mt-1 italic">
                  {isCC
                    ? 'Date and time the above outstanding amount was last correct.'
                    : 'Smart Scan imports bank SMS from this exact time forward.'}
                </ThemedText>
              }

              {showDatePicker && (
                <View style={Platform.OS === 'ios' ? themedStyles.iosPickerContainer : undefined}>
                  <DateTimePicker
                    value={new Date(startDate)}
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

            <TouchableOpacity onPress={handleSave} style={[themedStyles.saveButton, { backgroundColor: colors.accent }]}>
              <LucideCheck color="#FFFFFF" size={20} />
              <ThemedText className="font-bold text-lg" style={{ color: '#FFFFFF' }}>
                {accountToEdit ? 'Save Changes' : 'Create Account'}
              </ThemedText>
            </TouchableOpacity>

            {accountToEdit && (
              <TouchableOpacity onPress={handleDelete} style={[themedStyles.deleteButton, { backgroundColor: `${colors.danger}15` }]}>
                <LucideTrash2 color={colors.danger} size={20} />
                <ThemedText className="font-bold text-lg" style={{ color: colors.danger }}>Delete Account</ThemedText>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      {/* Day picker modals */}
      <DayPickerModal
        visible={showStatementDayPicker}
        selected={statementDay}
        onSelect={setStatementDay}
        onClose={() => setShowStatementDayPicker(false)}
        title="Statement Generation Day"
      />
      <DayPickerModal
        visible={showBillDueDayPicker}
        selected={billDueDay}
        onSelect={setBillDueDay}
        onClose={() => setShowBillDueDayPicker(false)}
        title="Payment Due Day"
      />
    </ThemedSafeAreaView>
  );
};

const createThemedStyles = (colors: any, isDark: boolean) => StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20, gap: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'transparent' },
  typeEmoji: { fontSize: 16, marginRight: 6 },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 20 },
  field: { marginBottom: 24 },
  label: { fontSize: 11, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold' },
  input: { padding: 14, borderRadius: 12, fontSize: 16, borderWidth: 1 },
  balanceInput: { fontSize: 24, fontWeight: 'bold' },
  last4Input: { fontSize: 24, fontWeight: 'bold', letterSpacing: 8, width: 140 },
  dateRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1 },
  dateInput: { flex: 1, fontSize: 16, marginLeft: 10 },
  saveButton: { padding: 18, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 20, gap: 8 },
  deleteButton: { padding: 18, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 40, gap: 8 },
  iosPickerContainer: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden', marginTop: 12, borderWidth: 1, borderColor: colors.border },
  iosPickerDone: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, alignItems: 'center' },
  // Day picker modal
  dayPickerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 999 },
  dayPickerSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, maxHeight: 400 },
  dayPickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 20 },
  dayCell: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});

export default AddAccountScreen;
