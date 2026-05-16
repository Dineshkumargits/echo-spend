import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { notify } from '../utils/notify';
import {
  LucideX,
  LucideEdit3,
  LucideTrash2,
  LucideCalendar,
  LucideRepeat,
  LucideAlertCircle,
  LucideMessageSquare,
  LucideChevronDown,
  LucideChevronUp,
  LucideArrowUpRight,
  LucideArrowDownLeft,
  LucideRotateCw,
  LucideTarget,
  LucideLandmark,
  LucideSmartphone,
  LucidePenLine,
  LucideZap,
  LucideUsers,
  LucideExternalLink,
} from 'lucide-react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import {
  deleteTransaction,
  getAccounts,
  getGoals,
  getLoans,
  getSubscriptions,
  getTransactionSplit,
  Transaction,
  Account,
  Goal,
  Loan,
  Subscription,
  Split,
} from '../services/database';

type RootStackParamList = {
  TransactionDetail: { transaction: Transaction };
};
type RouteProps = RouteProp<RootStackParamList, 'TransactionDetail'>;

const formatAmount = (amount: number) =>
  `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

const TransactionDetailScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProps>();
  const { transaction } = route.params;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [rawSmsExpanded, setRawSmsExpanded] = useState(false);
  const [existingSplit, setExistingSplit] = useState<Split | null>(null);

  useEffect(() => {
    Promise.all([
      getAccounts(),
      getGoals(false),
      getLoans(false),
      getSubscriptions(false),
      getTransactionSplit(transaction.id),
    ]).then(([accs, gs, ls, ss, split]) => {
      setAccounts(accs);
      setGoals(gs);
      setLoans(ls);
      setSubscriptions(ss);
      setExistingSplit(split);
    });
  }, []);

  const account = accounts.find(a => a.id === transaction.accountId);
  const toAccount = accounts.find(a => a.id === transaction.toAccountId);
  const goal = goals.find(g => g.id === transaction.goalId);
  const loan = loans.find(l => l.id === transaction.loanId);
  const sub = subscriptions.find(s => s.id === transaction.subscriptionId);

  const amountColor =
    transaction.type === 'credit'
      ? colors.success
      : transaction.type === 'transfer'
      ? colors.warning
      : colors.danger;

  const amountPrefix =
    transaction.type === 'credit' ? '+' : transaction.type === 'transfer' ? '⇄ ' : '-';

  const handleEdit = () => {
    navigation.replace('EditTransaction', { transaction });
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Transaction',
      `Delete "${transaction.merchant}" for ${formatAmount(transaction.amount)}?\n\nThis will revert any account, goal and loan impacts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteTransaction(transaction.id);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            notify.success('Transaction deleted');
            navigation.goBack();
          },
        },
      ]
    );
  };

  const TypeIcon = () => {
    const size = 28;
    if (transaction.type === 'credit') return <LucideArrowDownLeft color={colors.success} size={size} />;
    if (transaction.type === 'transfer') return <LucideRotateCw color={colors.warning} size={size} />;
    return <LucideArrowUpRight color={colors.danger} size={size} />;
  };

  const sourceLabel =
    transaction.source === 'sms'
      ? 'SMS'
      : transaction.source === 'manual'
      ? 'Manual Entry'
      : transaction.source === 'auto'
      ? 'Auto Detected'
      : transaction.source ?? '—';

  const SourceIcon = () => {
    if (transaction.source === 'sms') return <LucideSmartphone color={colors.secondary} size={13} />;
    if (transaction.source === 'manual') return <LucidePenLine color={colors.secondary} size={13} />;
    if (transaction.source === 'auto') return <LucideZap color={colors.secondary} size={13} />;
    return null;
  };

  const s = createStyles(colors);

  const DetailRow = ({
    label,
    value,
    valueColor,
  }: {
    label: string;
    value: string;
    valueColor?: string;
  }) => (
    <View style={s.detailRow}>
      <ThemedText type="secondary" style={{ fontSize: 13 }}>
        {label}
      </ThemedText>
      <ThemedText
        style={{
          fontWeight: '600',
          color: valueColor ?? colors.primary,
          fontSize: 14,
          maxWidth: '60%',
          textAlign: 'right',
        }}
        numberOfLines={3}
      >
        {value}
      </ThemedText>
    </View>
  );

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[s.closeBtn, { backgroundColor: colors.translucent, borderColor: colors.border }]}
        >
          <LucideX color={colors.primary} size={20} />
        </TouchableOpacity>
        <ThemedText className="text-lg font-bold flex-1 text-center">Transaction Details</ThemedText>
        {/* Spacer to center title */}
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        {/* Amount hero */}
        <View style={s.hero}>
          <View
            style={[
              s.typeIconWrap,
              {
                backgroundColor:
                  transaction.type === 'credit'
                    ? colors.success + '20'
                    : transaction.type === 'transfer'
                    ? colors.warning + '20'
                    : colors.danger + '20',
              },
            ]}
          >
            <TypeIcon />
          </View>

          <ThemedText style={{ fontSize: 36, fontWeight: 'bold', color: amountColor, marginTop: 14 }}>
            {amountPrefix}{formatAmount(transaction.amount)}
          </ThemedText>

          <ThemedText style={{ fontSize: 20, fontWeight: '600', marginTop: 4 }}>
            {transaction.merchant}
          </ThemedText>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 }}>
            <LucideCalendar color={colors.secondary} size={14} />
            <ThemedText type="secondary" style={{ fontSize: 13 }}>
              {formatDate(transaction.date)}
            </ThemedText>
            {!!transaction.isRecurring && (
              <>
                <LucideRepeat color={colors.accent} size={13} />
                <ThemedText style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>
                  Recurring
                </ThemedText>
              </>
            )}
          </View>

          {!transaction.isConfirmed && (
            <View style={[s.pendingBadge, { backgroundColor: colors.warning + '20', borderColor: colors.warning }]}>
              <LucideAlertCircle color={colors.warning} size={13} />
              <ThemedText style={{ color: colors.warning, fontSize: 12, fontWeight: 'bold', marginLeft: 5 }}>
                Pending Confirmation
              </ThemedText>
            </View>
          )}
        </View>

        {/* Core details */}
        <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <DetailRow
            label="Type"
            value={
              transaction.type === 'debit'
                ? 'Expense'
                : transaction.type === 'credit'
                ? 'Income'
                : 'Transfer'
            }
            valueColor={amountColor}
          />
          <DetailRow label="Category" value={transaction.category} />
          {transaction.tags && transaction.tags.length > 0 && (
            <DetailRow label="Tags" value={transaction.tags.map((t: string) => '#' + t).join('  ')} />
          )}
          {account && <DetailRow label={transaction.type === 'transfer' ? "From Account" : "Account"} value={account.name} />}
          {transaction.type === 'transfer' && toAccount && <DetailRow label="To Account" value={toAccount.name} />}
          <View style={[s.detailRow, { borderBottomWidth: 0 }]}>
            <ThemedText type="secondary" style={{ fontSize: 13 }}>Source</ThemedText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <SourceIcon />
              <ThemedText style={{ fontWeight: '600', fontSize: 14 }}>{sourceLabel}</ThemedText>
            </View>
          </View>
        </View>

        {/* Secondary details — only render card if there's at least one visible row */}
        {((transaction.confidence && transaction.source === 'sms') || !!transaction.notes || !!transaction.recurrenceRule) && (
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {transaction.confidence && transaction.source === 'sms' && (
              <DetailRow
                label="AI Confidence"
                value={
                  transaction.confidence.charAt(0).toUpperCase() + transaction.confidence.slice(1)
                }
                valueColor={
                  transaction.confidence === 'high'
                    ? colors.success
                    : transaction.confidence === 'medium'
                    ? colors.warning
                    : colors.danger
                }
              />
            )}
            {!!transaction.notes && (
              <DetailRow label="Notes" value={transaction.notes!} />
            )}
            {!!transaction.recurrenceRule && (
              <DetailRow label="Recurrence" value={transaction.recurrenceRule!} />
            )}
          </View>
        )}

        {/* Linked entities */}
        {(goal || loan || sub) && (
          <View style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ThemedText
              type="secondary"
              style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}
            >
              Linked To
            </ThemedText>
            {goal && (
              <View style={s.linkRow}>
                <LucideTarget color={colors.success} size={16} />
                <ThemedText style={{ marginLeft: 8, color: colors.success, fontWeight: '600', fontSize: 14 }}>
                  {goal.name}
                </ThemedText>
                <ThemedText type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>· Goal</ThemedText>
              </View>
            )}
            {loan && (
              <View style={s.linkRow}>
                <LucideLandmark color={colors.warning} size={16} />
                <ThemedText style={{ marginLeft: 8, color: colors.warning, fontWeight: '600', fontSize: 14 }}>
                  {loan.lender}
                </ThemedText>
                <ThemedText type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>· Loan</ThemedText>
              </View>
            )}
            {sub && (
              <View style={s.linkRow}>
                <LucideRepeat color={colors.accent} size={16} />
                <ThemedText style={{ marginLeft: 8, color: colors.accent, fontWeight: '600', fontSize: 14 }}>
                  {sub.name}
                </ThemedText>
                <ThemedText type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>· Subscription</ThemedText>
              </View>
            )}
          </View>
        )}

        {/* Raw SMS */}
        {transaction.rawSms && (
          <TouchableOpacity
            onPress={() => setRawSmsExpanded(v => !v)}
            style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <LucideMessageSquare color={colors.secondary} size={15} />
                <ThemedText
                  type="secondary"
                  style={{ fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}
                >
                  Raw SMS
                </ThemedText>
              </View>
              {rawSmsExpanded ? (
                <LucideChevronUp color={colors.secondary} size={17} />
              ) : (
                <LucideChevronDown color={colors.secondary} size={17} />
              )}
            </View>
            {rawSmsExpanded && (
              <ThemedText
                type="secondary"
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  lineHeight: 19,
                  fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                }}
              >
                {transaction.rawSms}
              </ThemedText>
            )}
          </TouchableOpacity>
        )}

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <TouchableOpacity
            onPress={handleEdit}
            style={[s.actionBtn, { backgroundColor: colors.accent + '18', borderColor: colors.accent }]}
          >
            <LucideEdit3 color={colors.accent} size={18} />
            <ThemedText style={{ color: colors.accent, fontWeight: 'bold', fontSize: 15, marginLeft: 8 }}>
              Edit
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            style={[s.actionBtn, { backgroundColor: colors.danger + '15', borderColor: colors.danger }]}
          >
            <LucideTrash2 color={colors.danger} size={18} />
            <ThemedText style={{ color: colors.danger, fontWeight: 'bold', fontSize: 15, marginLeft: 8 }}>
              Delete
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Split actions */}
        {transaction.type === 'debit' && (
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
            {existingSplit ? (
              <TouchableOpacity
                onPress={() => navigation.navigate('SplitDetail', { splitId: existingSplit.id })}
                style={[s.actionBtn, { backgroundColor: colors.success + '15', borderColor: colors.success }]}
              >
                <LucideExternalLink color={colors.success} size={18} />
                <ThemedText style={{ color: colors.success, fontWeight: 'bold', fontSize: 15, marginLeft: 8 }}>
                  View Split
                </ThemedText>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => navigation.navigate('SplitExpense', { transaction })}
                style={[s.actionBtn, { backgroundColor: colors.warning + '15', borderColor: colors.warning }]}
              >
                <LucideUsers color={colors.warning} size={18} />
                <ThemedText style={{ color: colors.warning, fontWeight: 'bold', fontSize: 15, marginLeft: 8 }}>
                  Split Expense
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </ThemedSafeAreaView>
  );
};

const createStyles = (colors: any) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    closeBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
    },
    hero: {
      alignItems: 'center',
      paddingVertical: 28,
    },
    typeIconWrap: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 20,
      borderWidth: 1,
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      marginBottom: 12,
    },
    detailRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 7,
    },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      borderRadius: 16,
      borderWidth: 1.5,
    },
  });

export default TransactionDetailScreen;
