import React, { useState, useEffect, useCallback } from 'react';
import {
  View, ScrollView, TouchableOpacity, Alert,
  RefreshControl, Modal, TextInput,
} from 'react-native';
import { MotiView } from 'moti';
import * as LucideIcons from 'lucide-react-native';
import {
  LucideArrowLeft, LucideTrash2, LucideCheck, LucideClock,
  LucideSplit, LucideWallet, LucideCreditCard,
  LucideChevronRight, LucideUsers, LucideRepeat, LucideTarget, LucideLandmark,
  LucideEdit2, LucideUndo,
} from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { notify } from '../utils/notify';
import {
  getSplitById, deleteSplit, receiveSplitPayment, updateSplitReceiveAccount,
  getAccounts, getTransactionById, getSubscriptionById, getGoalById, getLoanById,
  revertLatestRepayment,
  Split, SplitMember, Account, Subscription, Goal, Loan,
} from '../services/database';

// ─── Receive modal ────────────────────────────────────────────────────────────

const ReceiveModal = ({
  member, accounts, defaultAccountId, currency, onConfirm, onClose,
}: {
  member: SplitMember & { paidAmount: number };
  accounts: Account[];
  defaultAccountId?: number;
  currency: string;
  onConfirm: (accountId: number, amount: number) => void;
  onClose: () => void;
}) => {
  const { colors } = useTheme();
  const remaining = member.share - (member.paidAmount ?? 0);
  const [amountStr, setAmountStr] = useState(remaining.toFixed(2));
  const [selected, setSelected] = useState<number>(defaultAccountId ?? accounts[0]?.id ?? 0);

  const handleConfirm = () => {
    const amt = parseFloat(amountStr);
    if (isNaN(amt) || amt <= 0) {
      notify.error('Enter a valid amount');
      return;
    }
    if (amt > remaining + 0.01) {
      notify.error(`Amount cannot exceed the remaining balance of ${currency}${remaining.toLocaleString('en-IN')}`);
      return;
    }
    onConfirm(selected, amt);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' }}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1}
          style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}
        >
          <ThemedText style={{ fontSize: 17, fontWeight: '700', marginBottom: 4 }}>
            Receive from {member.name}
          </ThemedText>
          <ThemedText style={{ fontSize: 13, color: colors.secondary, marginBottom: 16 }}>
            Total share: {currency}{member.share.toLocaleString('en-IN')} · Already paid: {currency}{(member.paidAmount ?? 0).toLocaleString('en-IN')}
          </ThemedText>

          <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
            Repayment Amount ({currency})
          </ThemedText>
          <TextInput
            value={amountStr}
            onChangeText={setAmountStr}
            keyboardType="decimal-pad"
            style={{
              padding: 12,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: colors.border,
              color: colors.primary,
              backgroundColor: colors.translucent,
              fontSize: 16,
              fontWeight: '600',
              marginBottom: 16,
            }}
          />

          <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.secondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
            Add to account
          </ThemedText>

          {accounts.map(acc => {
            const isCC = acc.accountType === 'credit_card';
            return (
              <TouchableOpacity
                key={acc.id}
                onPress={() => setSelected(acc.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  padding: 14, borderRadius: 14, marginBottom: 8,
                  backgroundColor: selected === acc.id ? `${colors.accent}15` : colors.translucent,
                  borderWidth: 1.5,
                  borderColor: selected === acc.id ? colors.accent : 'transparent',
                }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}20` }}>
                  {isCC ? <LucideCreditCard color={colors.accent} size={16} /> : <LucideWallet color={colors.accent} size={16} />}
                </View>
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>{acc.name}</ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    {acc.accountType.replace('_', ' ')} · Balance: {currency}{acc.balance.toLocaleString('en-IN')}
                  </ThemedText>
                </View>
                {selected === acc.id && <LucideCheck color={colors.accent} size={18} />}
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            onPress={handleConfirm}
            style={{ marginTop: 8, padding: 16, borderRadius: 14, backgroundColor: colors.success, alignItems: 'center' }}
          >
            <ThemedText style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
              Confirm — Receive {currency}{parseFloat(amountStr || '0').toLocaleString('en-IN')}
            </ThemedText>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

const SplitDetailScreen = ({ navigation, route }: any) => {
  const { splitId }: { splitId: number } = route.params;
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const isFocused = useIsFocused();
  const cur = preferences.currency;

  const [split, setSplit] = useState<Split | null>(null);
  const [members, setMembers] = useState<(SplitMember & { paidAmount: number })[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [receiveTarget, setReceiveTarget] = useState<(SplitMember & { paidAmount: number }) | null>(null);

  // Linked entity context (subscription / goal / loan from the linked transaction)
  const [linkedSub, setLinkedSub] = useState<Subscription | null>(null);
  const [linkedGoal, setLinkedGoal] = useState<Goal | null>(null);
  const [linkedLoan, setLinkedLoan] = useState<Loan | null>(null);

  const load = useCallback(async () => {
    const [data, accs] = await Promise.all([
      getSplitById(splitId),
      getAccounts(),
    ]);
    if (data) {
      setSplit(data.split);
      setMembers(data.members);

      // Resolve linked entity from the split's transaction
      if (data.split.transactionId) {
        const tx = await getTransactionById(data.split.transactionId);
        if (tx) {
          if (tx.subscriptionId) {
            const sub = await getSubscriptionById(tx.subscriptionId);
            setLinkedSub(sub);
          } else if (tx.goalId) {
            const goal = await getGoalById(tx.goalId);
            setLinkedGoal(goal);
          } else if (tx.loanId) {
            const loan = await getLoanById(tx.loanId);
            setLinkedLoan(loan);
          }
        }
      }
    }
    setAccounts(accs);
    setLoading(false);
    setRefreshing(false);
  }, [splitId]);

  useEffect(() => { if (isFocused) load(); }, [isFocused, load]);

  const handleReceive = async (accountId: number, amount: number) => {
    if (!receiveTarget || !split) return;
    const target = receiveTarget;
    setReceiveTarget(null);
    try {
      await receiveSplitPayment(target.id, accountId, split.title, target.name, amount);
      notify.success(`${cur}${amount.toLocaleString('en-IN')} received from ${target.name}`);
      load();
    } catch {
      notify.error('Failed to record payment');
    }
  };

  const handleRevertPayment = (member: SplitMember) => {
    Alert.alert(
      'Revert Payment',
      `Delete the latest repayment transaction from ${member.name}? This will increase their pending balance.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revert',
          style: 'destructive',
          onPress: async () => {
            try {
              await revertLatestRepayment(member.id);
              notify.success(`Reverted latest payment from ${member.name}`);
              load();
            } catch (err: any) {
              notify.error(err?.message ?? 'Failed to revert payment');
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Split',
      'This will remove all split records. Any transactions created from repayments will remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            await deleteSplit(splitId);
            notify.success('Split deleted');
            navigation.goBack();
          },
        },
      ],
    );
  };

  if (loading || !split) {
    return (
      <ThemedSafeAreaView className="items-center justify-center">
        <View />
      </ThemedSafeAreaView>
    );
  }

  const me = members.find(m => m.isMe);
  const others = members.filter(m => !m.isMe);
  const pendingMembers = others.filter(m => !m.isPaid);
  const paidMembers = others.filter(m => m.isPaid);
  const collectedAmount = others.reduce((s, m) => s + (m.paidAmount ?? 0), 0);
  const pendingAmount = others.reduce((s, m) => s + Math.max(0, m.share - (m.paidAmount ?? 0)), 0);
  const collectedPct = pendingAmount + collectedAmount > 0
    ? (collectedAmount / (pendingAmount + collectedAmount)) * 100
    : 100;
  const paidByAccount = accounts.find(a => a.id === split.paidByAccountId);
  const isFromCC = paidByAccount?.accountType === 'credit_card';

  return (
    <ThemedSafeAreaView>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent }}
        >
          <LucideArrowLeft color={colors.primary} size={18} />
        </TouchableOpacity>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <LucideSplit color={colors.accent} size={16} />
          <ThemedText style={{ fontSize: 16, fontWeight: '700' }}>Split Details</ThemedText>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('SplitExpense', { 
              splitToEdit: split,
              membersToEdit: members
            })} 
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}15` }}
          >
            <LucideEdit2 color={colors.accent} size={16} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.danger}15` }}>
            <LucideTrash2 color={colors.danger} size={16} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, gap: 12 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
      >
        {/* Hero card */}
        <MotiView
          from={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ padding: 20, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontSize: 20, fontWeight: '700' }} numberOfLines={2}>{split.title}</ThemedText>
              <ThemedText style={{ fontSize: 12, color: colors.secondary, marginTop: 4 }}>
                {new Date(split.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
                {paidByAccount ? ` · ${paidByAccount.name}` : ''}
              </ThemedText>
            </View>
            <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
              <ThemedText style={{ fontSize: 11, color: colors.secondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 }}>Total</ThemedText>
              <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{cur}{split.totalAmount.toLocaleString('en-IN')}</ThemedText>
            </View>
          </View>

          {/* Progress */}
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText style={{ fontSize: 12, color: colors.secondary }}>Collected</ThemedText>
              <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.success }}>
                {cur}{collectedAmount.toLocaleString('en-IN')} / {cur}{(pendingAmount + collectedAmount).toLocaleString('en-IN')}
              </ThemedText>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' }}>
              <MotiView
                from={{ width: '0%' }}
                animate={{ width: `${collectedPct}%` }}
                transition={{ type: 'timing', duration: 900 }}
                style={{ height: '100%', borderRadius: 4, backgroundColor: colors.success }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                {paidMembers.length} of {others.length} paid
              </ThemedText>
              {pendingAmount > 0 && (
                <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.warning }}>
                  {cur}{pendingAmount.toLocaleString('en-IN')} pending
                </ThemedText>
              )}
            </View>
          </View>
        </MotiView>

        {/* Linked entity context badge */}
        {(linkedSub || linkedGoal || linkedLoan) && (
          <MotiView
            from={{ opacity: 0, translateY: -6 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              padding: 12, borderRadius: 14,
              backgroundColor: linkedSub ? '#5AC8FA10' : linkedGoal ? '#34C75910' : '#FF950010',
              borderWidth: 1,
              borderColor: linkedSub ? '#5AC8FA30' : linkedGoal ? '#34C75930' : '#FF950030',
            }}
          >
            {linkedSub && <LucideRepeat color="#5AC8FA" size={15} />}
            {linkedGoal && <LucideTarget color="#34C759" size={15} />}
            {linkedLoan && <LucideLandmark color="#FF9500" size={15} />}
            <View style={{ flex: 1 }}>
              {linkedSub && (
                <>
                  <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#5AC8FA' }}>
                    Subscription Split — {linkedSub.name}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    {linkedSub.frequency} · {cur}{linkedSub.amount.toLocaleString('en-IN')} total · {linkedSub.category}
                  </ThemedText>
                </>
              )}
              {linkedGoal && (
                <>
                  <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#34C759' }}>
                    Goal Contribution — {linkedGoal.name}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    {cur}{linkedGoal.currentAmount.toLocaleString('en-IN')} / {cur}{linkedGoal.targetAmount.toLocaleString('en-IN')} saved
                  </ThemedText>
                </>
              )}
              {linkedLoan && (
                <>
                  <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#FF9500' }}>
                    Loan Payment — {linkedLoan.lender}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    {cur}{linkedLoan.remainingAmount.toLocaleString('en-IN')} remaining · {linkedLoan.type === 'borrowed' ? 'Borrowing' : 'Lending'}
                  </ThemedText>
                </>
              )}
            </View>
            {linkedSub && (
              <TouchableOpacity onPress={() => navigation.navigate('AddSubscription', { subscriptionToEdit: linkedSub })}>
                <LucideChevronRight color="#5AC8FA" size={14} />
              </TouchableOpacity>
            )}
            {linkedGoal && (
              <TouchableOpacity onPress={() => navigation.navigate('AddGoal', { goalToEdit: linkedGoal })}>
                <LucideChevronRight color="#34C759" size={14} />
              </TouchableOpacity>
            )}
            {linkedLoan && (
              <TouchableOpacity onPress={() => navigation.navigate('AddLoan', { loanToEdit: linkedLoan })}>
                <LucideChevronRight color="#FF9500" size={14} />
              </TouchableOpacity>
            )}
          </MotiView>
        )}

        {/* My share */}
        {me && (
          <View style={{ padding: 16, borderRadius: 16, backgroundColor: `${colors.accent}10`, borderWidth: 1, borderColor: `${colors.accent}30`, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.accent}20` }}>
              <ThemedText style={{ fontSize: 12, fontWeight: '800', color: colors.accent }}>You</ThemedText>
            </View>
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontSize: 14, fontWeight: '600', color: colors.accent }}>Your share</ThemedText>
              <ThemedText style={{ fontSize: 12, color: colors.secondary, marginTop: 2 }}>Already paid (you covered the bill)</ThemedText>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <ThemedText style={{ fontSize: 18, fontWeight: '700', color: colors.accent }}>{cur}{me.share.toLocaleString('en-IN')}</ThemedText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <LucideCheck color={colors.success} size={11} />
                <ThemedText style={{ fontSize: 11, color: colors.success, fontWeight: '600' }}>Settled</ThemedText>
              </View>
            </View>
          </View>
        )}

        {/* Pending members */}
        {pendingMembers.length > 0 && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <LucideClock color={colors.warning} size={13} />
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.warning, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Pending ({pendingMembers.length})
              </ThemedText>
            </View>
            <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
              {pendingMembers.map((m, i) => (
                <MotiView
                  key={m.id}
                  from={{ opacity: 0, translateX: -12 }}
                  animate={{ opacity: 1, translateX: 0 }}
                  transition={{ delay: i * 50 }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    padding: 14, backgroundColor: colors.surface,
                    borderBottomWidth: i < pendingMembers.length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.warning}18` }}>
                    <ThemedText style={{ fontSize: 14, fontWeight: '700', color: colors.warning }}>
                      {m.name.charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>{m.name}</ThemedText>
                    {m.paidAmount > 0 ? (
                      <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 2 }}>
                        paid {cur}{m.paidAmount.toLocaleString('en-IN')} of {cur}{m.share.toLocaleString('en-IN')}
                      </ThemedText>
                    ) : (
                      <ThemedText style={{ fontSize: 12, color: colors.secondary, marginTop: 2 }}>Owes you</ThemedText>
                    )}
                  </View>
                  <ThemedText style={{ fontSize: 16, fontWeight: '700', color: colors.warning, marginRight: 8 }}>
                    {cur}{(m.share - m.paidAmount).toLocaleString('en-IN')}
                  </ThemedText>
                  {m.paidAmount > 0 && (
                    <TouchableOpacity
                      onPress={() => handleRevertPayment(m)}
                      style={{ padding: 6, marginRight: 4 }}
                    >
                      <LucideUndo color={colors.danger} size={15} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => setReceiveTarget(m)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: `${colors.success}18`, borderWidth: 1, borderColor: `${colors.success}40` }}
                  >
                    <LucideCheck color={colors.success} size={13} />
                    <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.success }}>Receive</ThemedText>
                  </TouchableOpacity>
                </MotiView>
              ))}
            </View>
          </View>
        )}

        {/* Paid members */}
        {paidMembers.length > 0 && (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <LucideCheck color={colors.success} size={13} />
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: colors.success, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Collected ({paidMembers.length})
              </ThemedText>
            </View>
            <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
              {paidMembers.map((m, i) => {
                const repaidTo = accounts.find(a => a.id === m.repaidToAccountId);
                return (
                  <View
                    key={m.id}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      padding: 14, backgroundColor: colors.surface,
                      borderBottomWidth: i < paidMembers.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                      opacity: 0.75,
                    }}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.success}15` }}>
                      <LucideCheck color={colors.success} size={16} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontSize: 14, fontWeight: '600' }}>{m.name}</ThemedText>
                      <ThemedText style={{ fontSize: 11, color: colors.secondary, marginTop: 2 }}>
                        {m.paidDate ? new Date(m.paidDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                        {repaidTo ? ` · to ${repaidTo.name}` : ''}
                      </ThemedText>
                    </View>
                    <ThemedText style={{ fontSize: 15, fontWeight: '700', color: colors.success }}>
                      {cur}{m.share.toLocaleString('en-IN')}
                    </ThemedText>
                    <TouchableOpacity
                      onPress={() => handleRevertPayment(m)}
                      style={{ padding: 6, marginLeft: 8 }}
                    >
                      <LucideUndo color={colors.danger} size={16} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Credit card tip */}
        {isFromCC && pendingAmount > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={{ padding: 16, borderRadius: 16, backgroundColor: `${colors.warning}10`, borderWidth: 1, borderColor: `${colors.warning}30`, gap: 8 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <LucideCreditCard color={colors.warning} size={15} />
              <ThemedText style={{ fontSize: 13, fontWeight: '700', color: colors.warning }}>Credit Card Tip</ThemedText>
            </View>
            <ThemedText style={{ fontSize: 12, color: colors.secondary, lineHeight: 18 }}>
              You paid via <ThemedText style={{ fontWeight: '700', color: colors.primary }}>{paidByAccount?.name}</ThemedText>. When friends repay into your bank account, add a{' '}
              <ThemedText style={{ fontWeight: '700', color: colors.primary }}>transfer</ThemedText> from that bank account to your credit card to keep both balances accurate.
            </ThemedText>
            <TouchableOpacity
              onPress={() => navigation.navigate('AddTransaction')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
            >
              <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.accent }}>Add transfer</ThemedText>
              <LucideChevronRight color={colors.accent} size={13} />
            </TouchableOpacity>
          </MotiView>
        )}

        {/* All settled */}
        {pendingMembers.length === 0 && others.length > 0 && (
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ padding: 20, borderRadius: 16, backgroundColor: `${colors.success}10`, borderWidth: 1, borderColor: `${colors.success}30`, alignItems: 'center', gap: 8 }}
          >
            <ThemedText style={{ fontSize: 24 }}>🎉</ThemedText>
            <ThemedText style={{ fontSize: 15, fontWeight: '700', color: colors.success }}>All settled!</ThemedText>
            <ThemedText style={{ fontSize: 12, color: colors.secondary, textAlign: 'center' }}>
              You've collected {cur}{collectedAmount.toLocaleString('en-IN')} from {paidMembers.length} {paidMembers.length === 1 ? 'person' : 'people'}.
            </ThemedText>
          </MotiView>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Receive payment modal */}
      {receiveTarget && (
        <ReceiveModal
          member={receiveTarget}
          accounts={accounts}
          defaultAccountId={split.receiveToAccountId}
          currency={cur}
          onConfirm={handleReceive}
          onClose={() => setReceiveTarget(null)}
        />
      )}
    </ThemedSafeAreaView>
  );
};

export default SplitDetailScreen;
