import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity, ScrollView, Platform, KeyboardAvoidingView, Modal, ActivityIndicator, Alert } from 'react-native';
import { MotiView } from 'moti';
import DateTimePicker from '@react-native-community/datetimepicker';
import { LucideX, LucideSave, LucideCheck, LucidePlus, LucideCalendar, LucideSearch, LucideTag, LucideChevronRight, LucideUsers, LucideToggleLeft, LucideToggleRight, LucideWallet, LucideTrash2 } from 'lucide-react-native';

import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import {
  updateTransaction,
  addLoan,
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
  getSplitByTransactionId,
  createSplit,
  updateSplit,
  deleteSplit,
  getPendingSplitMembers,
  PendingSplitMember,
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
  const [loanPersonName, setLoanPersonName] = useState('');
  const [selectedSub, setSelectedSub] = useState<number | null>(transaction.subscriptionId || null);
  const [isBorrowed, setIsBorrowed] = useState(transaction.category === 'Debt'); // Simple heuristic
  const [pendingSplitMembers, setPendingSplitMembers] = useState<PendingSplitMember[]>([]);
  const [selectedSplitMember, setSelectedSplitMember] = useState<number | null>(transaction.splitMemberId || null);

  const [date, setDate] = useState(new Date(transaction.date));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');
  const [errors, setErrors] = useState<{ amount?: string; merchant?: string; account?: string; toAccount?: string }>({});
  const [saving, setSaving] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');

  // Split configurations
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitEqually, setSplitEqually] = useState(true);
  const [receiveToAccountId, setReceiveToAccountId] = useState<number | null>(null);
  const [meDbId, setMeDbId] = useState<number | null>(null);
  const [existingSplitId, setExistingSplitId] = useState<number | null>(null);
  const isFirstLoadRef = React.useRef(true);
  // Tracks when the user explicitly navigated to create a new sub or goal from the EntityLinker.
  // Auto-link only fires on focus return when this flag is set.
  const pendingLinkTypeRef = React.useRef<'sub' | 'goal' | null>(null);
  const goalsRef = React.useRef<Goal[]>([]);
  const subsRef = React.useRef<Subscription[]>([]);

  interface MemberRow {
    key: string;
    id?: number;
    name: string;
    share: string;
  }
  const [splitMembers, setSplitMembers] = useState<MemberRow[]>([{ key: 'p1', name: '', share: '' }]);

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
    const loadData = () => {
      Promise.all([
        getCategories(),
        getAccounts(),
        getGoals(true),
        getLoans(true),
        getSubscriptions(true),
        getSplitByTransactionId(transaction.id),
        getPendingSplitMembers(transaction.id),
      ]).then(([cats, accs, gs, ls, ss, splitData, sms]) => {
        setCategories(cats);
        setAccounts(accs);

        // Smart auto-link: only fires when the user explicitly navigated from
        // the EntityLinker to create a new sub or goal (pendingLinkTypeRef is set).
        if (!isFirstLoadRef.current && pendingLinkTypeRef.current === 'goal') {
          if (gs.length > goalsRef.current.length) {
            const newGoal = gs.find(g => !goalsRef.current.some(old => old.id === g.id));
            if (newGoal) handleGoalSelect(newGoal.id);
          }
          pendingLinkTypeRef.current = null;
        } else if (!isFirstLoadRef.current && pendingLinkTypeRef.current === 'sub') {
          if (ss.length > subsRef.current.length) {
            const newSub = ss.find(s => !subsRef.current.some(old => old.id === s.id));
            if (newSub) handleSubSelect(newSub.id);
          }
          pendingLinkTypeRef.current = null;
        }

        // Update tracking refs with the latest lists
        goalsRef.current = gs;
        subsRef.current = ss;

        setGoals(gs);
        setLoans(ls);
        setSubscriptions(ss);
        setPendingSplitMembers(sms);

        if (isFirstLoadRef.current) {
          isFirstLoadRef.current = false;
          if (splitData) {
            setExistingSplitId(splitData.split.id);
            setSplitEnabled(true);
            setReceiveToAccountId(splitData.split.receiveToAccountId || (accs[0]?.id ?? null));
            
            const meMember = splitData.members.find(m => m.isMe);
            if (meMember) {
              setMeDbId(meMember.id);
            }
            
            const others = splitData.members.filter(m => !m.isMe);
            if (others.length > 0) {
              setSplitMembers(others.map((m) => ({
                key: m.id.toString(),
                id: m.id,
                name: m.name,
                share: m.share.toString(),
              })));
            }
            
            // Determine splitEqually
            const allSharesEqual = splitData.members.every(m => m.share === splitData.members[0].share);
            setSplitEqually(allSharesEqual);
          } else {
            if (accs.length > 0) {
              setReceiveToAccountId(accs[0].id);
            }
          }
        }
      });
    };

    loadData();
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [transaction.id, navigation]);

  const handleSplitMemberSelect = (id: number | null) => {
    setSelectedSub(null);
    setSelectedGoal(null);
    setSelectedLoan(null);
    setSelectedSplitMember(id);
    if (!id) return;
    const member = pendingSplitMembers.find(sm => sm.memberId === id);
    if (!member) return;
    const remaining = member.memberShare - member.memberPaidAmount;
    if (remaining > 0) {
      setAmount(String(remaining));
    }
    setMerchant(`${member.memberName} — ${member.splitTitle}`);
    setCategory('Split');
    setNotes(`Split repayment from ${member.memberName}`);
  };

  useEffect(() => {
    if (type !== 'debit') {
      setSplitEnabled(false);
      setSelectedSub(null);
    }
    if (type !== 'credit') {
      setSelectedSplitMember(null);
    }
  }, [type]);

  // Synchronize category selection and Personal Debt (isBorrowed) toggle
  useEffect(() => {
    setIsBorrowed(category === 'Debt');
  }, [category]);

  const handleToggleBorrowed = (val: boolean) => {
    setIsBorrowed(val);
    if (val) {
      setCategory('Debt');
    } else {
      const otherMatch = categories.find(c => c.name === 'Other' && (
        type === 'transfer' ? c.type === 'transfer' :
          (type === 'debit' ? c.type === 'expense' : c.type === 'income')
      ));
      if (otherMatch) {
        setCategory(otherMatch.name);
      } else {
        const firstMatch = categories.find(c => {
          if (type === 'transfer') return c.type === 'transfer';
          return type === 'debit' ? c.type === 'expense' : c.type === 'income';
        });
        if (firstMatch) setCategory(firstMatch.name);
      }
    }
    Haptics.selectionAsync();
  };

  // Helper calculations for split
  const total = parseFloat(amount) || 0;
  const othersTotal = splitMembers.reduce((s, m) => s + (parseFloat(m.share) || 0), 0);
  const myShare = Math.max(0, Math.round((total - othersTotal) * 100) / 100);

  const distributeEqually = useCallback((count: number, tot: number) => {
    if (count < 1 || tot <= 0) return '';
    const each = tot / (count + 1); // +1 for "me"
    return each.toFixed(2);
  }, []);

  useEffect(() => {
    if (!splitEqually || !splitEnabled) return;
    const share = distributeEqually(splitMembers.length, total);
    setSplitMembers(prev => prev.map(m => ({ ...m, share })));
  }, [splitEqually, splitMembers.length, total, splitEnabled, distributeEqually]);

  const addSplitMember = () => {
    const key = `p${Date.now()}`;
    const share = splitEqually ? distributeEqually(splitMembers.length + 1, total) : '';
    setSplitMembers(prev => [...prev, { key, name: '', share }]);
    Haptics.selectionAsync();
  };

  const removeSplitMember = (key: string) => {
    if (splitMembers.length === 1) return;
    setSplitMembers(prev => {
      const next = prev.filter(m => m.key !== key);
      if (splitEqually) {
        const share = distributeEqually(next.length, total);
        return next.map(m => ({ ...m, share }));
      }
      return next;
    });
    Haptics.selectionAsync();
  };

  const updateSplitMember = (key: string, field: 'name' | 'share', value: string) => {
    setSplitMembers(prev => prev.map(m => m.key === key ? { ...m, [field]: value } : m));
  };

  // Entity Linkers
  const handleSubSelect = (id: number | null) => {
    setSelectedGoal(null);
    setSelectedLoan(null);
    setSelectedSplitMember(null);
    setSelectedSub(id);
    if (!id) return;
    const sub = subscriptions.find(s => s.id === id);
    if (!sub) return;
    if (!merchant) setMerchant(sub.name);
    if (sub.amount && !amount) setAmount(String(sub.amount));
    setCategory(sub.category);

    // Auto-prefill split from subscription if enabled
    if (sub.splitEnabled && sub.splitMembers) {
      try {
        const subMembers = JSON.parse(sub.splitMembers) as { name: string }[];
        if (subMembers.length > 0) {
          setSplitEnabled(true);
          setSplitEqually(true);
          const membersList = subMembers.map((m, idx) => ({
            key: `p${idx + 1}`,
            name: m.name,
            share: '',
          }));
          setSplitMembers(membersList);
        }
      } catch (err) {
        console.warn('Failed to parse subscription split members', err);
      }
    }
    if (sub.debitAccountId) setSelectedAccount(sub.debitAccountId);
  };

  const handleGoalSelect = (id: number | null) => {
    setSelectedSub(null);
    setSelectedLoan(null);
    setSelectedSplitMember(null);
    setSelectedGoal(id);
    if (!id) return;
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    setMerchant(goal.name);
    setCategory(goal.category);
    setNotes(`Contribution to goal: ${goal.name}`);
    const remaining = goal.targetAmount - goal.currentAmount;
    if (goal.monthlyContribution && goal.monthlyContribution > 0) {
      setAmount(String(goal.monthlyContribution));
    } else if (remaining > 0) {
      setAmount(String(remaining));
    } else {
      setAmount(String(goal.targetAmount));
    }
    if (goal.linkedAccountId) {
      if (type === 'transfer') {
        setSelectedToAccount(goal.linkedAccountId);
      } else {
        setSelectedAccount(goal.linkedAccountId);
      }
    }
  };

  const handleLoanSelect = (id: number | null) => {
    setSelectedSub(null);
    setSelectedGoal(null);
    setSelectedSplitMember(null);
    setSelectedLoan(id);
    if (!id) return;
    if (id === -1 || id === -2) {
      setCategory('Debt');
      const initialName = loanPersonName || merchant || '';
      if (initialName) {
        setMerchant(initialName);
        setNotes(id === -1 ? `New loan lending to ${initialName}` : `New loan borrowed from ${initialName}`);
      } else {
        setNotes(id === -1 ? 'New loan lending' : 'New loan borrowed');
      }
      return;
    }
    const loan = loans.find(l => l.id === id);
    if (!loan) return;
    setMerchant(loan.lender);
    setCategory('Debt');

    const isRepayment = (loan.type === 'lent' && type === 'credit') || (loan.type === 'borrowed' && type === 'debit');
    if (isRepayment && loan.emiAmount && loan.emiAmount > 0) {
      setAmount(String(loan.emiAmount));
    } else if (loan.remainingAmount > 0) {
      setAmount(String(loan.remainingAmount));
    } else {
      setAmount(String(loan.totalAmount));
    }

    if (loan.type === 'borrowed') {
      setNotes(type === 'credit' ? `Loan disbursement from ${loan.lender}` : `EMI payment for loan from ${loan.lender}`);
    } else {
      setNotes(type === 'credit' ? `Loan repayment from ${loan.lender}` : `Additional loan to ${loan.lender}`);
    }

    if (loan.linkedAccountId) {
      setSelectedAccount(loan.linkedAccountId);
    }
  };

  // Sync merchant with loanPersonName and notes when selectedLoan is new
  useEffect(() => {
    if (selectedLoan === -1 || selectedLoan === -2) {
      if (loanPersonName) {
        setMerchant(loanPersonName);
        setNotes(
          selectedLoan === -1
            ? `New loan lending to ${loanPersonName}`
            : `New loan borrowed from ${loanPersonName}`
        );
      }
    }
  }, [loanPersonName, selectedLoan]);

  useEffect(() => {
    if ((selectedLoan === -1 || selectedLoan === -2) && !loanPersonName && merchant) {
      setLoanPersonName(merchant);
    }
  }, [merchant, selectedLoan]);

  useEffect(() => {
    if (selectedLoan !== -1 && selectedLoan !== -2) {
      setLoanPersonName('');
    }
  }, [selectedLoan]);

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      newErrors.amount = 'Enter a valid amount greater than 0';
    }
    if (parsedAmount > 10_000_000) {
      const currency = preferences?.currency ?? '₹';
      newErrors.amount = `Amount cannot exceed ${currency}1,0,00,000`;
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

    if (splitEnabled && type === 'debit') {
      if (splitMembers.some(m => !m.name.trim())) {
        notify.error('Enter a name for each person in split');
        return false;
      }
      if (splitMembers.some(m => (parseFloat(m.share) || 0) <= 0)) {
        notify.error('Each person needs a split share > 0');
        return false;
      }
      if (othersTotal >= parsedAmount) {
        notify.error("Others' total share cannot exceed the transaction amount");
        return false;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const performSave = async (shouldDeleteSplit = false) => {
    setSaving(true);
    try {
      let finalLoanId: number | undefined = selectedLoan || undefined;

      if (selectedLoan === -1 || selectedLoan === -2) {
        const newLoanType = selectedLoan === -1 ? 'lent' : 'borrowed';
        const newLoanId = await addLoan({
          lender: (loanPersonName || merchant).trim(),
          totalAmount: parseFloat(amount),
          remainingAmount: 0,
          emiAmount: 0,
          nextDueDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
          interestRate: undefined,
          isActive: true,
          type: newLoanType,
          linkedAccountId: selectedAccount || undefined,
          tenure: undefined,
          notes: notes.trim() || undefined,
        });
        finalLoanId = newLoanId;
      }

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
        loanId: finalLoanId,
        subscriptionId: selectedSub || undefined,
        tags: tags.length > 0 ? tags : undefined,
        splitMemberId: selectedSplitMember || undefined,
      });

      if (shouldDeleteSplit && existingSplitId !== null) {
        await deleteSplit(existingSplitId);
      } else if (splitEnabled && type === 'debit') {
        const allMembers = [
          { 
            id: meDbId || undefined,
            name: 'Me', 
            share: myShare, 
            isMe: true, 
            isPaid: true 
          },
          ...splitMembers.map(m => ({
            id: m.id || undefined,
            name: m.name.trim(),
            share: parseFloat(m.share),
            isMe: false,
            isPaid: false,
          })),
        ];

        if (existingSplitId !== null) {
          await updateSplit(
            existingSplitId,
            {
              title: merchant.trim(),
              totalAmount: parseFloat(amount),
              paidByAccountId: selectedAccount || undefined,
              receiveToAccountId: receiveToAccountId || undefined,
              date: date.toISOString().split('T')[0],
            },
            allMembers
          );
        } else {
          await createSplit(
            {
              transactionId: transaction.id,
              title: merchant.trim(),
              totalAmount: parseFloat(amount),
              paidByAccountId: selectedAccount || undefined,
              receiveToAccountId: receiveToAccountId || undefined,
              date: date.toISOString().split('T')[0],
            },
            allMembers
          );
        }
      }

      notify.success('Transaction updated');
      checkBudgetAlerts();
      navigation.goBack();
    } catch (err) {
      console.error('Error saving transaction', err);
      notify.error('Failed to update transaction');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const splitWasEnabled = existingSplitId !== null;
    const splitIsDisabledNow = !splitEnabled || type !== 'debit';

    if (splitWasEnabled && splitIsDisabledNow) {
      Alert.alert(
        'Disable Split?',
        'Disabling split will remove all member records. Existing repayments in your accounts will remain.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Confirm', 
            style: 'destructive',
            onPress: () => performSave(true) 
          }
        ]
      );
    } else {
      await performSave(false);
    }
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
                <ThemedText type="secondary" style={themedStyles.label}>Amount ({preferences?.currency ?? '₹'})</ThemedText>
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
                splitMembers={pendingSplitMembers}
                selectedGoal={selectedGoal}
                selectedLoan={selectedLoan}
                selectedSub={selectedSub}
                selectedSplitMember={selectedSplitMember}
                onGoal={handleGoalSelect}
                onLoan={handleLoanSelect}
                onSub={handleSubSelect}
                onSplitMember={handleSplitMemberSelect}
                colors={colors}
                currency={preferences.currency}
                txType={type}
                prefillName={merchant}
                prefillAmount={amount}
                prefillCategory={category}
                prefillAccountId={selectedAccount}
                onNavigatingToCreate={(type) => { pendingLinkTypeRef.current = type; }}
              />
              {(selectedLoan === -1 || selectedLoan === -2) && (
                <View style={{ marginTop: 12 }}>
                  <ThemedText style={[themedStyles.label, { marginBottom: 6, fontSize: 13 }]}>
                    {selectedLoan === -1 ? "Borrowing Friend's Name" : "Lender's Name"}
                  </ThemedText>
                  <TextInput
                    style={[
                      themedStyles.merchantInput,
                      { color: colors.primary, borderBottomColor: colors.border },
                    ]}
                    placeholder="Enter name"
                    placeholderTextColor={colors.muted}
                    value={loanPersonName}
                    onChangeText={(v) => {
                      setLoanPersonName(v);
                      setMerchant(v);
                      setNotes(
                        selectedLoan === -1
                          ? `New loan lending to ${v}`
                          : `New loan borrowed from ${v}`
                      );
                    }}
                    maxLength={100}
                  />
                </View>
              )}
            </View>

            {/* Split Expense Inline Section */}
            {type === 'debit' && (
              <View style={[themedStyles.field, { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: splitEnabled ? `${colors.accent}50` : colors.border, marginBottom: 24 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: splitEnabled ? 16 : 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <LucideUsers color={splitEnabled ? colors.accent : colors.secondary} size={20} />
                    <View>
                      <ThemedText style={{ fontWeight: 'bold', fontSize: 15 }}>Split this Expense</ThemedText>
                      <ThemedText type="secondary" className="text-xs">Split bill with friends</ThemedText>
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => { setSplitEnabled(v => !v); Haptics.selectionAsync(); }}>
                    {splitEnabled ? (
                      <LucideToggleRight color={colors.accent} size={32} />
                    ) : (
                      <LucideToggleLeft color={colors.muted} size={32} />
                    )}
                  </TouchableOpacity>
                </View>

                {splitEnabled && (
                  <MotiView
                    from={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ type: 'timing', duration: 200 }}
                    style={{ overflow: 'hidden' }}
                  >
                    {/* Repayment account selector */}
                    <View style={{ marginBottom: 16, marginTop: 12 }}>
                      <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                        Collect Repayments To
                      </ThemedText>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {accounts.map(acc => (
                          <TouchableOpacity
                            key={`repay-to-${acc.id}`}
                            onPress={() => setReceiveToAccountId(acc.id)}
                            style={{
                              flexDirection: 'row', alignItems: 'center', gap: 6,
                              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99,
                              borderWidth: 1.5,
                              backgroundColor: receiveToAccountId === acc.id ? `${colors.accent}18` : 'transparent',
                              borderColor: receiveToAccountId === acc.id ? colors.accent : colors.border,
                            }}
                          >
                            <LucideWallet color={receiveToAccountId === acc.id ? colors.accent : colors.secondary} size={13} />
                            <ThemedText style={{ fontSize: 13, fontWeight: '600', color: receiveToAccountId === acc.id ? colors.accent : colors.primary }}>
                              {acc.name}
                            </ThemedText>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>

                    {/* Split equally toggle */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: 12, borderRadius: 12, backgroundColor: colors.translucent, borderWidth: 1, borderColor: colors.border }}>
                      <View>
                        <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>Split equally</ThemedText>
                        <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 2 }}>Auto-divide including you</ThemedText>
                      </View>
                      <TouchableOpacity onPress={() => { setSplitEqually(v => !v); Haptics.selectionAsync(); }}>
                        {splitEqually ? (
                          <LucideToggleRight color={colors.accent} size={28} />
                        ) : (
                          <LucideToggleLeft color={colors.muted} size={28} />
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Members title & Add button */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                        Split with
                      </ThemedText>
                      <TouchableOpacity
                        onPress={addSplitMember}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: `${colors.accent}18` }}
                      >
                        <LucidePlus color={colors.accent} size={12} />
                        <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.accent }}>Add person</ThemedText>
                      </TouchableOpacity>
                    </View>

                    {/* Me row (read-only) */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: `${colors.accent}10`, borderWidth: 1, borderColor: `${colors.accent}30` }}>
                      <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}20` }}>
                        <ThemedText style={{ fontSize: 12, fontWeight: '800', color: colors.accent }}>Me</ThemedText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={{ fontSize: 13, fontWeight: '600', color: colors.accent }}>You (paid full bill)</ThemedText>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <ThemedText style={{ fontSize: 14, fontWeight: '700', color: colors.accent }}>
                          {preferences.currency}{myShare > 0 ? myShare.toFixed(2) : '—'}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Member rows */}
                    {splitMembers.map((m, idx) => (
                      <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <View style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent, borderWidth: 1, borderColor: colors.border }}>
                          <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.secondary }}>{idx + 1}</ThemedText>
                        </View>
                        <TextInput
                          value={m.name}
                          onChangeText={v => updateSplitMember(m.key, 'name', v)}
                          placeholder="Name"
                          placeholderTextColor={colors.muted}
                          style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, color: colors.primary, backgroundColor: colors.surface, fontSize: 14 }}
                        />
                        <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.surface, paddingHorizontal: 8 }}>
                          <ThemedText style={{ fontSize: 13, color: colors.secondary }}>{preferences.currency}</ThemedText>
                          <TextInput
                            value={m.share}
                            onChangeText={v => !splitEqually && updateSplitMember(m.key, 'share', v)}
                            editable={!splitEqually}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.muted}
                            style={{ width: 60, padding: 10, fontSize: 14, fontWeight: '600', color: splitEqually ? colors.secondary : colors.primary }}
                          />
                        </View>
                        {splitMembers.length > 1 && (
                          <TouchableOpacity onPress={() => removeSplitMember(m.key)} style={{ padding: 4 }}>
                            <LucideTrash2 color={colors.danger} size={16} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </MotiView>
                )}
              </View>
            )}

            {/* 7. Borrowed Toggle */}
            <View style={[themedStyles.field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
              <View>
                <ThemedText type="secondary" style={themedStyles.label}>Personal Debt?</ThemedText>
                <ThemedText type="secondary" className="text-xs">Borrowed or Lent money</ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => handleToggleBorrowed(!isBorrowed)}
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
