import React, { useState, useEffect } from 'react';
import {
  View, ScrollView, TouchableOpacity, StyleSheet, Modal,
  TextInput, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import PagerView from 'react-native-pager-view';
import {
  LucidePlus, LucideTarget, LucideLandmark, LucideRepeat, LucideCalendar,
  LucideUserPlus, LucideCreditCard,
  LucideAlertCircle, LucidePencil, LucideUsers, LucideChevronRight,
  LucideZap, LucideWallet, LucideBanknote,
  LucideX, LucideCheck,
} from 'lucide-react-native';
import { MotiView } from 'moti';
import { useIsFocused } from '@react-navigation/native';
import {
  getGoals, getLoans, getSubscriptions, getAccounts, getSplits,
  paySubscription, contributeToGoal, recordLoanPayment,
  Goal, Loan, Subscription, Account, SplitWithStats,
} from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';

// ─── Quick-action modal ─────────────────────────────────────────────────────
interface QuickActionState {
  type: 'paySubscription' | 'contributeGoal' | 'payLoan';
  id: number;
  label: string;
  defaultAmount: number;
  accentColor: string;
  accountId?: number;
  splitId?: number;
}

const QuickActionModal = ({
  state,
  accounts,
  currency,
  colors,
  onDone,
  onClose,
  navigation,
}: {
  state: QuickActionState;
  accounts: Account[];
  currency: string;
  colors: any;
  onDone: () => void;
  onClose: () => void;
  navigation: any;
}) => {
  const [amount, setAmount] = useState(String(state.defaultAmount));
  const [accountId, setAccountId] = useState<number | undefined>(state.accountId);
  const [loading, setLoading] = useState(false);
  const [showAccPicker, setShowAccPicker] = useState(false);

  const selectedAcc = accounts.find(a => a.id === accountId);

  const handleConfirm = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      notify.error('Enter a valid amount');
      return;
    }
    setLoading(true);
    try {
      if (state.type === 'paySubscription') {
        const result = await paySubscription(state.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        notify.success('Payment recorded!');
        onDone();
        // If a split was created, navigate to it
        if (result.splitId) {
          onClose();
          navigation.navigate('SplitDetail', { splitId: result.splitId });
        } else {
          onClose();
        }
      } else if (state.type === 'contributeGoal') {
        await contributeToGoal(state.id, amt, accountId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        notify.success(`${currency}${amt.toLocaleString('en-IN')} added to goal!`);
        onDone();
        onClose();
      } else if (state.type === 'payLoan') {
        await recordLoanPayment(state.id, amt, accountId);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        notify.success('Payment recorded!');
        onDone();
        onClose();
      }
    } catch (e: any) {
      notify.error(e?.message ?? 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const s = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
    label: { fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 'bold', color: colors.secondary },
    amtInput: { fontSize: 36, fontWeight: 'bold', color: state.accentColor, borderBottomWidth: 2, borderBottomColor: state.accentColor, paddingVertical: 8, marginBottom: 20 },
    accRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: colors.translucent, marginBottom: 16, gap: 8 },
    accPicker: { backgroundColor: colors.background, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 16 },
    accItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 },
    btn: { height: 56, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: state.accentColor },
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <View style={s.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <ThemedText style={{ fontWeight: 'bold', fontSize: 18 }}>{state.label}</ThemedText>
            <TouchableOpacity onPress={onClose}>
              <LucideX color={colors.secondary} size={22} />
            </TouchableOpacity>
          </View>

          <ThemedText style={s.label}>Amount ({currency})</ThemedText>
          <TextInput
            style={s.amtInput}
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            autoFocus
            selectTextOnFocus
          />

          {/* Account picker (not shown for paySubscription — account is already baked in) */}
          {state.type !== 'paySubscription' && (
            <>
              <ThemedText style={s.label}>From / To Account</ThemedText>
              <TouchableOpacity
                style={s.accRow}
                onPress={() => setShowAccPicker(v => !v)}
              >
                <LucideWallet color={colors.secondary} size={16} />
                <ThemedText style={{ flex: 1, color: selectedAcc ? colors.primary : colors.muted }}>
                  {selectedAcc ? selectedAcc.name : 'Select account (optional)'}
                </ThemedText>
                <LucideChevronRight color={colors.secondary} size={14} />
              </TouchableOpacity>
              {showAccPicker && (
                <View style={s.accPicker}>
                  <TouchableOpacity
                    style={s.accItem}
                    onPress={() => { setAccountId(undefined); setShowAccPicker(false); }}
                  >
                    <ThemedText style={{ color: colors.secondary }}>None</ThemedText>
                  </TouchableOpacity>
                  {accounts.map(acc => (
                    <TouchableOpacity
                      key={acc.id}
                      style={[s.accItem, accountId === acc.id && { backgroundColor: `${state.accentColor}12` }]}
                      onPress={() => { setAccountId(acc.id); setShowAccPicker(false); }}
                    >
                      <LucideCreditCard color={accountId === acc.id ? state.accentColor : colors.secondary} size={14} />
                      <ThemedText style={{ flex: 1, fontWeight: 'bold', color: accountId === acc.id ? state.accentColor : colors.primary }}>
                        {acc.name}
                      </ThemedText>
                      {accountId === acc.id && <LucideCheck color={state.accentColor} size={14} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          <TouchableOpacity style={s.btn} onPress={handleConfirm} disabled={loading}>
            <LucideCheck color="#fff" size={20} />
            <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 16, marginLeft: 8 }}>
              {loading ? 'Processing…' : 'Confirm'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── Main Screen ────────────────────────────────────────────────────────────

export const FinancesScreen = ({ navigation }: any) => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const isFocused = useIsFocused();

  const pagerRef = React.useRef<PagerView>(null);
  const TABS = React.useMemo(() => ['subs', 'goals', 'loans', 'cards', 'splits'] as const, []);
  const [activeTab, setActiveTab] = useState<'subs' | 'goals' | 'loans' | 'cards' | 'splits'>('subs');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [creditCards, setCreditCards] = useState<Account[]>([]);
  const [splits, setSplits] = useState<SplitWithStats[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [quickAction, setQuickAction] = useState<QuickActionState | null>(null);

  useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused]);

  const loadData = async () => {
    setLoading(true);
    const [gs, ls, ss, accs, sps] = await Promise.all([
      getGoals(true),
      getLoans(true),
      getSubscriptions(true),
      getAccounts(),
      getSplits(),
    ]);
    setGoals(gs);
    setLoans(ls);
    setSubscriptions(ss);
    setAccounts(accs);
    setCreditCards(accs.filter(a => a.accountType === 'credit_card'));
    setSplits(sps);
    setLoading(false);
  };

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await loadData();
    setRefreshing(false);
  }, []);

  const daysUntilDue = (billDueDay: number): number => {
    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), billDueDay);
    if (thisMonth < today) {
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, billDueDay);
      return Math.ceil((nextMonth.getTime() - today.getTime()) / 86_400_000);
    }
    return Math.ceil((thisMonth.getTime() - today.getTime()) / 86_400_000);
  };

  const daysUntilDate = (dateStr: string): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  };

  const renderProgressBar = (current: number, target: number, color: string) => {
    const pct = Math.min(Math.max((current / target) * 100, 0), 100);
    return (
      <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginTop: 12, overflow: 'hidden' }}>
        <MotiView
          from={{ width: '0%' }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'timing', duration: 1000 }}
          style={{ height: '100%', backgroundColor: color }}
        />
      </View>
    );
  };

  const accountName = (id?: number) => accounts.find(a => a.id === id)?.name;

  // ─── Tab renders ──────────────────────────────────────────────────────────

  const renderSubscriptionsTab = () => {
    const totalMonthly = subscriptions.reduce((s, sub) => {
      if (sub.frequency === 'monthly') return s + sub.amount;
      if (sub.frequency === 'yearly') return s + sub.amount / 12;
      if (sub.frequency === 'weekly') return s + sub.amount * 4.33;
      return s;
    }, 0);

    return (
      <MotiView from={{ opacity: 0, translateX: -20 }} animate={{ opacity: 1, translateX: 0 }} exit={{ opacity: 0, translateX: 20 }}>
        {subscriptions.length > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: `${colors.accent}12`, borderColor: `${colors.accent}30` }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <LucideRepeat color={colors.accent} size={18} />
              <View>
                <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Monthly Burn</ThemedText>
                <ThemedText style={{ fontWeight: 'bold', fontSize: 22, color: colors.accent }}>
                  {preferences.currency}{Math.round(totalMonthly).toLocaleString('en-IN')}
                </ThemedText>
              </View>
              <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                <ThemedText style={{ fontSize: 10, color: colors.secondary }}>{subscriptions.length} active</ThemedText>
              </View>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={() => navigation.navigate('Subscriptions')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
            gap: 12,
          }}
          activeOpacity={0.8}
        >
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${colors.accent}15`, alignItems: 'center', justifyContent: 'center' }}>
            <LucideRepeat color={colors.accent} size={18} />
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: 'bold', fontSize: 14 }}>Tracked Recurring Bills</ThemedText>
            <ThemedText type="secondary" style={{ fontSize: 11, marginTop: 2 }}>View auto-detected ledger bills & upcoming cycles</ThemedText>
          </View>
          <LucideChevronRight color={colors.secondary} size={16} />
        </TouchableOpacity>

        {subscriptions.length === 0 ? renderEmpty('subscriptions') : subscriptions.map(sub => {
          const days = daysUntilDate(sub.nextDueDate);
          const isUrgent = days <= 3;
          const splitMembers = sub.splitEnabled && sub.splitMembers
            ? (() => { try { return JSON.parse(sub.splitMembers); } catch { return []; } })()
            : [];
          const totalPeople = splitMembers.length + 1;
          const myShare = sub.splitEnabled && totalPeople > 1
            ? Math.round((sub.amount / totalPeople) * 100) / 100
            : null;
          const debitAcc = accountName(sub.debitAccountId);

          return (
            <TouchableOpacity
              key={sub.id}
              style={[styles.card, isUrgent && { borderColor: `${colors.danger}50` }]}
              onPress={() => navigation.navigate('AddSubscription', { subscriptionToEdit: sub })}
              activeOpacity={0.8}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconContainer, { backgroundColor: `${colors.accent}15` }]}>
                  <LucideRepeat color={colors.accent} size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 16 }}>{sub.name}</ThemedText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>
                      {sub.frequency} · {sub.category}
                    </ThemedText>
                    {sub.splitEnabled && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: `${colors.accent}15`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <LucideUsers color={colors.accent} size={10} />
                        <ThemedText style={{ fontSize: 9, color: colors.accent, fontWeight: 'bold' }}>{totalPeople} people</ThemedText>
                      </View>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 16 }}>
                    {preferences.hideAmounts ? '****' : `${preferences.currency}${sub.amount.toLocaleString('en-IN')}`}
                  </ThemedText>
                  {myShare !== null && (
                    <ThemedText style={{ fontSize: 10, color: colors.accent }}>
                      My share: {preferences.currency}{myShare.toLocaleString('en-IN')}
                    </ThemedText>
                  )}
                </View>
              </View>

              {/* Footer row */}
              <View style={[styles.cardFooter, { marginTop: 12 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <LucideCalendar color={isUrgent ? colors.danger : colors.secondary} size={12} />
                  <ThemedText style={{ fontSize: 11, color: isUrgent ? colors.danger : colors.secondary, fontWeight: isUrgent ? 'bold' : 'normal' }}>
                    {days === 0 ? 'Due today!' : days === 1 ? 'Due tomorrow' : days < 0 ? 'Overdue' : `Due in ${days}d`}
                    {' · '}
                    {new Date(sub.nextDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </ThemedText>
                  {debitAcc && (
                    <>
                      <ThemedText style={{ color: colors.muted, fontSize: 10 }}>·</ThemedText>
                      <LucideWallet color={colors.muted} size={10} />
                      <ThemedText style={{ fontSize: 10, color: colors.muted }}>{debitAcc}</ThemedText>
                    </>
                  )}
                </View>

                {/* Pay Now button */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${colors.accent}20`, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setQuickAction({
                      type: 'paySubscription',
                      id: sub.id,
                      label: `Pay ${sub.name}`,
                      defaultAmount: sub.amount,
                      accentColor: colors.accent,
                      accountId: sub.debitAccountId,
                    });
                  }}
                >
                  <LucideZap color={colors.accent} size={12} />
                  <ThemedText style={{ color: colors.accent, fontWeight: 'bold', fontSize: 11 }}>Pay Now</ThemedText>
                </TouchableOpacity>
              </View>

              {sub.notes && (
                <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 8 }}>{sub.notes}</ThemedText>
              )}
            </TouchableOpacity>
          );
        })}
      </MotiView>
    );
  };

  const renderGoalsTab = () => {
    const totalSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
    const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);

    return (
      <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}>
        {goals.length > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: '#34C75912', borderColor: '#34C75930' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <LucideTarget color="#34C759" size={18} />
              <View>
                <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Total Saved</ThemedText>
                <ThemedText style={{ fontWeight: 'bold', fontSize: 22, color: '#34C759' }}>
                  {preferences.currency}{totalSaved.toLocaleString('en-IN')}
                </ThemedText>
              </View>
              <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                <ThemedText style={{ fontSize: 10, color: colors.secondary }}>of {preferences.currency}{totalTarget.toLocaleString('en-IN')}</ThemedText>
                <ThemedText style={{ fontSize: 10, color: '#34C759', fontWeight: 'bold' }}>
                  {totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}% overall
                </ThemedText>
              </View>
            </View>
          </View>
        )}

        {goals.length === 0 ? renderEmpty('goals') : goals.map(goal => {
          const pct = goal.targetAmount > 0 ? Math.round((goal.currentAmount / goal.targetAmount) * 100) : 0;
          const remaining = goal.targetAmount - goal.currentAmount;
          const savedAcc = accountName(goal.linkedAccountId);
          const daysToDeadline = goal.deadline ? daysUntilDate(goal.deadline) : null;
          const monthsLeft = daysToDeadline !== null ? Math.ceil(daysToDeadline / 30) : null;
          const impliedMonthly = monthsLeft && monthsLeft > 0 && remaining > 0
            ? Math.ceil(remaining / monthsLeft)
            : null;

          return (
            <TouchableOpacity
              key={goal.id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('AddGoal', { goalToEdit: goal })}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconContainer, { backgroundColor: '#34C75915' }]}>
                  <LucideTarget color="#34C759" size={20} />
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 16 }}>{goal.name}</ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>
                    {goal.category}
                    {savedAcc ? ` · ${savedAcc}` : ''}
                  </ThemedText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 16 }}>
                    {preferences.hideAmounts ? '****' : `${preferences.currency}${goal.currentAmount.toLocaleString('en-IN')}`}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary }}>
                    of {preferences.currency}{goal.targetAmount.toLocaleString('en-IN')}
                  </ThemedText>
                </View>
              </View>

              {renderProgressBar(goal.currentAmount, goal.targetAmount, '#34C759')}

              <View style={[styles.cardFooter, { marginTop: 12 }]}>
                <View>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary }}>
                    {goal.deadline
                      ? `Deadline: ${new Date(goal.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                      : 'No deadline'}
                  </ThemedText>
                  {goal.monthlyContribution && (
                    <ThemedText style={{ fontSize: 10, color: '#34C759' }}>
                      Plan: {preferences.currency}{goal.monthlyContribution.toLocaleString('en-IN')}/mo
                    </ThemedText>
                  )}
                  {impliedMonthly && !goal.monthlyContribution && (
                    <ThemedText style={{ fontSize: 10, color: colors.secondary }}>
                      Need {preferences.currency}{impliedMonthly.toLocaleString('en-IN')}/mo to meet deadline
                    </ThemedText>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <ThemedText style={{ color: '#34C759', fontSize: 11, fontWeight: 'bold' }}>{pct}% ACHIEVED</ThemedText>
                  {/* Add Money button */}
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#34C75920', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setQuickAction({
                        type: 'contributeGoal',
                        id: goal.id,
                        label: `Add to "${goal.name}"`,
                        defaultAmount: goal.monthlyContribution ?? 500,
                        accentColor: '#34C759',
                        accountId: goal.linkedAccountId,
                      });
                    }}
                  >
                    <LucidePlus color="#34C759" size={12} />
                    <ThemedText style={{ color: '#34C759', fontWeight: 'bold', fontSize: 11 }}>Add Money</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {goal.notes && (
                <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 8 }}>{goal.notes}</ThemedText>
              )}
            </TouchableOpacity>
          );
        })}
      </MotiView>
    );
  };

  const renderLoansTab = () => {
    const borrowed = loans.filter(l => l.type === 'borrowed' || !l.type);
    const lent = loans.filter(l => l.type === 'lent');
    const totalOwed = borrowed.reduce((s, l) => s + l.remainingAmount, 0);
    const totalToReceive = lent.reduce((s, l) => s + l.remainingAmount, 0);

    return (
      <MotiView from={{ opacity: 0, translateX: 20 }} animate={{ opacity: 1, translateX: 0 }} exit={{ opacity: 0, translateX: -20 }}>
        {loans.length > 0 && (
          <View style={[styles.summaryCard, { backgroundColor: colors.translucent, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
              {totalOwed > 0 && (
                <View style={{ alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>I Owe</ThemedText>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 18, color: colors.warning }}>
                    {preferences.currency}{totalOwed.toLocaleString('en-IN')}
                  </ThemedText>
                </View>
              )}
              {totalOwed > 0 && totalToReceive > 0 && (
                <View style={{ width: 1, backgroundColor: colors.border }} />
              )}
              {totalToReceive > 0 && (
                <View style={{ alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Owed to Me</ThemedText>
                  <ThemedText style={{ fontWeight: 'bold', fontSize: 18, color: colors.success }}>
                    {preferences.currency}{totalToReceive.toLocaleString('en-IN')}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        )}

        {loans.length === 0 ? renderEmpty('loans') : (
          <>
            {lent.length > 0 && (
              <>
                <ThemedText style={{ fontSize: 11, color: colors.secondary, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 10, marginLeft: 2, letterSpacing: 1 }}>
                  Money Owed to Me
                </ThemedText>
                {lent.map(loan => renderLoanCard(loan, colors.success, <LucideUserPlus color={colors.success} size={20} />))}
                <View style={{ height: 16 }} />
              </>
            )}
            {borrowed.length > 0 && (
              <>
                <ThemedText style={{ fontSize: 11, color: colors.secondary, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 10, marginLeft: 2, letterSpacing: 1 }}>
                  Money I Owe
                </ThemedText>
                {borrowed.map(loan => renderLoanCard(loan, colors.warning, <LucideLandmark color={colors.warning} size={20} />))}
              </>
            )}
          </>
        )}
      </MotiView>
    );
  };

  const renderLoanCard = (loan: Loan, color: string, icon: React.ReactNode) => {
    const days = daysUntilDate(loan.nextDueDate);
    const isUrgent = days <= 3;
    const pct = loan.totalAmount > 0
      ? Math.round(((loan.totalAmount - loan.remainingAmount) / loan.totalAmount) * 100)
      : 0;
    const linkedAcc = accountName(loan.linkedAccountId);
    const remainingEmis = loan.emiAmount > 0 ? Math.ceil(loan.remainingAmount / loan.emiAmount) : null;
    const isLent = loan.type === 'lent';

    return (
      <TouchableOpacity
        key={loan.id}
        style={[styles.card, isUrgent && { borderColor: `${colors.danger}50` }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('AddLoan', { loanToEdit: loan })}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: `${color}15` }]}>
            {icon}
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText style={{ fontWeight: 'bold', fontSize: 16 }}>{loan.lender}</ThemedText>
            <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>
              {isLent ? 'Lending' : `EMI: ${preferences.currency}${loan.emiAmount.toLocaleString('en-IN')}`}
              {loan.interestRate ? ` · ${loan.interestRate}% p.a.` : ''}
            </ThemedText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <ThemedText style={{ color: isLent ? colors.success : colors.danger, fontWeight: 'bold', fontSize: 16 }}>
              {preferences.hideAmounts ? '****' : `${preferences.currency}${loan.remainingAmount.toLocaleString('en-IN')}`}
            </ThemedText>
            <ThemedText style={{ fontSize: 10, color: colors.secondary }}>REMAINING</ThemedText>
          </View>
        </View>

        {renderProgressBar(loan.totalAmount - loan.remainingAmount, loan.totalAmount, color)}

        <View style={[styles.cardFooter, { marginTop: 12 }]}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {isUrgent && <LucideAlertCircle color={colors.danger} size={11} />}
              <ThemedText style={{ fontSize: 11, color: isUrgent ? colors.danger : colors.secondary, fontWeight: isUrgent ? 'bold' : 'normal' }}>
                {isLent ? 'Expected' : 'Next EMI'}: {new Date(loan.nextDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                {days === 0 ? ' (Today!)' : days === 1 ? ' (Tomorrow)' : days < 0 ? ' (Overdue)' : ` (${days}d)`}
              </ThemedText>
            </View>
            {linkedAcc && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <LucideWallet color={colors.muted} size={10} />
                <ThemedText style={{ fontSize: 10, color: colors.muted }}>{linkedAcc}</ThemedText>
              </View>
            )}
            {remainingEmis !== null && !isLent && (
              <ThemedText style={{ fontSize: 10, color: colors.secondary, marginTop: 2 }}>
                ~{remainingEmis} EMI{remainingEmis !== 1 ? 's' : ''} left
                {loan.tenure ? ` of ${loan.tenure}` : ''}
              </ThemedText>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <ThemedText style={{ color, fontSize: 11, fontWeight: 'bold' }}>{pct}% {isLent ? 'COLLECTED' : 'REPAID'}</ThemedText>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${color}20`, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}
              onPress={() => {
                Haptics.selectionAsync();
                setQuickAction({
                  type: 'payLoan',
                  id: loan.id,
                  label: isLent ? `Record repayment from ${loan.lender}` : `Pay EMI to ${loan.lender}`,
                  defaultAmount: loan.emiAmount || 0,
                  accentColor: color,
                  accountId: loan.linkedAccountId,
                });
              }}
            >
              <LucideBanknote color={color} size={12} />
              <ThemedText style={{ color, fontWeight: 'bold', fontSize: 11 }}>
                {isLent ? 'Record Repayment' : 'Pay EMI'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        {loan.notes && (
          <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 8 }}>{loan.notes}</ThemedText>
        )}
      </TouchableOpacity>
    );
  };

  const renderCardsTab = () => (
    <MotiView from={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}>
      {creditCards.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.translucent }]}>
            <LucideCreditCard color={colors.secondary} size={32} />
          </View>
          <ThemedText style={{ fontWeight: 'bold', textAlign: 'center' }}>No credit cards added</ThemedText>
          <ThemedText style={{ fontSize: 12, color: colors.secondary, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 }}>
            Add a credit card account to track outstanding dues and available credit.
          </ThemedText>
          <TouchableOpacity
            onPress={() => navigation.navigate('AddAccount', { initialType: 'credit_card' })}
            style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, backgroundColor: colors.accent }}
          >
            <ThemedText style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>Add Credit Card</ThemedText>
          </TouchableOpacity>
        </View>
      ) : creditCards.map(card => {
        const utilPct = card.creditLimit && card.creditLimit > 0
          ? Math.min((card.balance / card.creditLimit) * 100, 100)
          : null;
        const available = card.creditLimit ? card.creditLimit - card.balance : null;
        const dueDays = card.billDueDay ? daysUntilDue(card.billDueDay) : null;
        const isDueUrgent = dueDays !== null && dueDays <= 5;
        const utilColor = utilPct === null ? colors.accent
          : utilPct >= 80 ? colors.danger
            : utilPct >= 50 ? colors.warning
              : colors.success;

        return (
          <TouchableOpacity
            key={card.id}
            style={[styles.card, isDueUrgent && { borderColor: `${colors.danger}60` }]}
            onPress={() => navigation.navigate('AddAccount', { accountToEdit: card })}
            activeOpacity={0.85}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconContainer, { backgroundColor: `${colors.accent}15` }]}>
                <LucideCreditCard color={colors.accent} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText style={{ fontWeight: 'bold', fontSize: 16 }}>{card.name}</ThemedText>
                {card.creditLimit ? (
                  <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>
                    Limit: {preferences.currency}{card.creditLimit.toLocaleString('en-IN')}
                  </ThemedText>
                ) : (
                  <ThemedText style={{ fontSize: 11, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Credit Card</ThemedText>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <ThemedText style={{ color: colors.danger, fontWeight: 'bold', fontSize: 18 }}>
                  {preferences.hideAmounts ? '****' : `-${preferences.currency}${card.balance.toLocaleString('en-IN')}`}
                </ThemedText>
                <ThemedText style={{ fontSize: 10, color: colors.secondary }}>OUTSTANDING</ThemedText>
              </View>
            </View>

            {utilPct !== null && (
              <View style={{ marginTop: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>Credit utilization</ThemedText>
                  <ThemedText style={{ color: utilColor, fontSize: 11, fontWeight: 'bold' }}>{Math.round(utilPct)}%</ThemedText>
                </View>
                <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
                  <MotiView
                    from={{ width: '0%' }}
                    animate={{ width: `${utilPct}%` }}
                    transition={{ type: 'timing', duration: 1000 }}
                    style={{ height: '100%', backgroundColor: utilColor }}
                  />
                </View>
              </View>
            )}

            <View style={[styles.cardFooter, { marginTop: 12 }]}>
              {available !== null ? (
                <View>
                  <ThemedText style={{ fontSize: 10, color: colors.secondary, textTransform: 'uppercase', fontWeight: 'bold' }}>Available</ThemedText>
                  <ThemedText style={{ color: colors.success, fontWeight: 'bold', fontSize: 14 }}>
                    {preferences.hideAmounts ? '****' : `${preferences.currency}${available.toLocaleString('en-IN')}`}
                  </ThemedText>
                </View>
              ) : <View />}

              {dueDays !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  {isDueUrgent && <LucideAlertCircle color={colors.danger} size={12} />}
                  <ThemedText style={{ color: isDueUrgent ? colors.danger : colors.secondary, fontSize: 12, fontWeight: isDueUrgent ? 'bold' : 'normal' }}>
                    {dueDays === 0 ? 'Due today!' : dueDays === 1 ? 'Due tomorrow' : `Due in ${dueDays}d`}
                  </ThemedText>
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => navigation.navigate('AddAccount', { accountToEdit: card })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <LucidePencil color={colors.muted} size={11} />
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>Set due date</ThemedText>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </MotiView>
  );

  const renderSplitsTab = () => {
    const totalPending = splits.reduce((s, sp) => s + (sp.pendingAmount ?? 0), 0);
    return (
      <MotiView from={{ opacity: 0, translateX: 20 }} animate={{ opacity: 1, translateX: 0 }} exit={{ opacity: 0, translateX: -20 }}>
        {splits.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.translucent }]}>
              <LucideUsers color={colors.secondary} size={32} />
            </View>
            <ThemedText style={{ fontWeight: 'bold', textAlign: 'center' }}>No active splits</ThemedText>
            <ThemedText style={{ fontSize: 12, color: colors.secondary, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 }}>
              Split an expense from the transaction details screen.
            </ThemedText>
          </View>
        ) : (
          <>
            {totalPending > 0 && (
              <View style={[styles.card, { backgroundColor: colors.warning + '12', borderColor: colors.warning + '40' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <LucideUsers color={colors.warning} size={20} />
                  <View>
                    <ThemedText style={{ fontWeight: 'bold', fontSize: 15 }}>Total Pending</ThemedText>
                    <ThemedText style={{ color: colors.warning, fontWeight: 'bold', fontSize: 20, marginTop: 2 }}>
                      {preferences.currency}{totalPending.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </ThemedText>
                  </View>
                </View>
              </View>
            )}
            {splits.map(split => {
              const collected = split.collectedAmount ?? 0;
              const pending = split.pendingAmount ?? 0;
              const total = collected + pending;
              const pct = total > 0 ? Math.round((collected / total) * 100) : 100;
              const allSettled = (split.pendingCount ?? 0) === 0;

              return (
                <TouchableOpacity
                  key={split.id}
                  style={styles.card}
                  onPress={() => navigation.navigate('SplitDetail', { splitId: split.id })}
                  activeOpacity={0.8}
                >
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconContainer, { backgroundColor: allSettled ? colors.success + '15' : colors.warning + '15' }]}>
                      <LucideUsers color={allSettled ? colors.success : colors.warning} size={20} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontWeight: 'bold', fontSize: 15 }} numberOfLines={1}>{split.title}</ThemedText>
                      <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                        {split.memberCount} {split.memberCount === 1 ? 'person' : 'people'} ·{' '}
                        {new Date(split.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </ThemedText>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <ThemedText style={{ color: allSettled ? colors.success : colors.warning, fontWeight: 'bold', fontSize: 16 }}>
                        {preferences.currency}{pending.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </ThemedText>
                      <ThemedText style={{ fontSize: 10, color: colors.secondary }}>
                        {allSettled ? 'SETTLED' : 'PENDING'}
                      </ThemedText>
                    </View>
                    <LucideChevronRight color={colors.muted} size={16} style={{ marginLeft: 4 }} />
                  </View>
                  <View style={{ marginTop: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
                      <ThemedText style={{ fontSize: 11, color: colors.secondary }}>Collection progress</ThemedText>
                      <ThemedText style={{ color: allSettled ? colors.success : colors.accent, fontSize: 11, fontWeight: 'bold' }}>{pct}%</ThemedText>
                    </View>
                    <View style={{ height: 5, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
                      <MotiView
                        from={{ width: '0%' }}
                        animate={{ width: `${pct}%` }}
                        transition={{ type: 'timing', duration: 900 }}
                        style={{ height: '100%', backgroundColor: allSettled ? colors.success : colors.accent }}
                      />
                    </View>
                  </View>
                  <View style={[styles.cardFooter, { marginTop: 10 }]}>
                    <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                      Total: {preferences.currency}{split.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </ThemedText>
                    {!allSettled && (
                      <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                        {split.pendingCount} {split.pendingCount === 1 ? 'person' : 'people'} pending
                      </ThemedText>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </MotiView>
    );
  };

  const renderEmpty = (type: string) => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.translucent }]}>
        {type === 'goals' ? <LucideTarget color={colors.secondary} size={32} /> :
          type === 'loans' ? <LucideLandmark color={colors.secondary} size={32} /> :
            <LucideRepeat color={colors.secondary} size={32} />}
      </View>
      <ThemedText style={{ fontWeight: 'bold', textAlign: 'center' }}>No active {type}</ThemedText>
      <ThemedText style={{ fontSize: 12, color: colors.secondary, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 }}>
        Track your financial commitments by adding your {type} here.
      </ThemedText>
    </View>
  );


  const styles = StyleSheet.create({
    container: { flex: 1, paddingHorizontal: 24 },
    header: { marginTop: 24, marginBottom: 24 },
    tabBar: { flexDirection: 'row', backgroundColor: colors.translucent, borderRadius: 14, padding: 4, marginBottom: 24 },
    tabItem: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
    activeTab: { backgroundColor: colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3, elevation: 2 },
    card: { backgroundColor: colors.surface, borderRadius: 20, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
    cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    iconContainer: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
    emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
    emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    fab: { position: 'absolute', bottom: 32, right: 24, width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
    summaryCard: { borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1 },
  });

  return (
    <ThemedSafeAreaView>
      <View style={styles.container}>
        <View style={styles.header}>
          <ThemedText style={{ fontSize: 12, color: colors.secondary, textTransform: 'uppercase', letterSpacing: 2 }}>Financial Hub</ThemedText>
          <ThemedText style={{ fontSize: 28, fontWeight: 'bold' }}>Commitments</ThemedText>
        </View>

        <View style={styles.tabBar}>
          {TABS.map((tab, index) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, activeTab === tab && styles.activeTab]}
              onPress={() => {
                setActiveTab(tab);
                pagerRef.current?.setPage(index);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <ThemedText style={{ fontSize: 11, fontWeight: 'bold', color: activeTab === tab ? colors.primary : colors.secondary }}>
                {tab === 'subs' ? 'Subs' : tab === 'goals' ? 'Goals' : tab === 'loans' ? 'Loans' : tab === 'cards' ? 'Cards' : 'Splits'}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={0}
          onPageSelected={(e) => {
            const index = e.nativeEvent.position;
            setActiveTab(TABS[index]);
            Haptics.selectionAsync();
          }}
        >
          <View key="subs">
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            >
              {renderSubscriptionsTab()}
            </ScrollView>
          </View>
          <View key="goals">
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            >
              {renderGoalsTab()}
            </ScrollView>
          </View>
          <View key="loans">
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            >
              {renderLoansTab()}
            </ScrollView>
          </View>
          <View key="cards">
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            >
              {renderCardsTab()}
            </ScrollView>
          </View>
          <View key="splits">
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
            >
              {renderSplitsTab()}
            </ScrollView>
          </View>
        </PagerView>

        {activeTab !== 'cards' && activeTab !== 'splits' && (
          <TouchableOpacity
            style={styles.fab}
            onPress={() => {
              const screen = activeTab === 'subs' ? 'AddSubscription' : activeTab === 'goals' ? 'AddGoal' : 'AddLoan';
              navigation.navigate(screen);
            }}
          >
            <LucidePlus color={isDark ? '#000' : '#FFF'} size={32} />
          </TouchableOpacity>
        )}
      </View>

      {/* Quick Action Modal */}
      <Modal
        visible={quickAction !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setQuickAction(null)}
      >
        {quickAction && (
          <QuickActionModal
            state={quickAction}
            accounts={accounts}
            currency={preferences.currency}
            colors={colors}
            onDone={loadData}
            onClose={() => setQuickAction(null)}
            navigation={navigation}
          />
        )}
      </Modal>
    </ThemedSafeAreaView>
  );
};

export default FinancesScreen;
