import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  PermissionsAndroid,
  Platform,
  Animated,
  KeyboardAvoidingView,
} from 'react-native';
import {
  LucideX,
  LucideCheck,
  LucideTrash2,
  LucideZap,
  LucideShieldCheck,
  LucideArrowUpRight,
  LucideArrowDownLeft,
  LucideRotateCw,
  LucideInfo,
  LucideChevronDown,
  LucidePencil,
  LucideInbox,
  LucideAlertTriangle,
} from 'lucide-react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { useAISmsParser, ScanContext } from '../hooks/useAISmsParser';
import { hashSms } from '../services/smsParserService';
import {
  Transaction,
  Account,
  Category,
  addTransaction,
  updateTransaction,
  getCategories,
  getTopMerchantMappings,
  markSmsProcessed,
  getAllSmsHashes,
  getSubscriptions,
  getGoals,
  getLoans,
  getBudgets,
  updateAccountLastScanned,
  getAccountScanRanges,
  AccountScanRange,
  getUnconfirmedTransactions,
  confirmTransaction,
  deleteTransaction,
  isRawSmsAlreadyExists,
  isSmsDuplicateTransaction,
} from '../services/database';
import { matchSmsToAccount, SmsAccountMatch } from '../services/smsParserService';
import { useStore } from '../store/useStore';
import { setForegroundScanActive } from '../services/backgroundTasks';
import { MotiView, AnimatePresence } from 'moti';
import { notify } from '../utils/notify';
import { useTheme } from '../theme/ThemeProvider';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { ReviewTransactionCard } from '../components/ReviewTransactionCard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { AIModelManager } from '../services/aiModelManager';

type Phase = 'scanning' | 'review';

// Cheap pre-filter: at least one financial term must be present before we bother sending to AI.
const BANK_KEYWORDS = [
  'debited', 'credited', 'spent', 'received', 'transferred',
  'withdrawn', 'deposited', 'paid', 'payment', 'purchase',
  'rs.', 'rs ', '₹', 'inr', 'upi', 'vpa', 'neft', 'imps', 'rtgs',
  'atm', 'pos', 'txn', 'transaction', 'a/c', 'acct', 'account', 'bal',
  'deducted', 'charged', 'sent', 'amount', 'amt', 'dr', 'cr', 'card',
  'salary', 'refund', 'cashback', 'deposited', 'deposit',
];
// Always skip OTPs — never send them to AI.
const OTP_KEYWORDS = ['otp', 'one time', 'password', 'verification code', 'one-time'];
// Everything else (due reminders, promos, balance alerts) is sent to AI for classification.

const SmartScanScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { parseSms } = useAISmsParser();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';

  const [phase, setPhase] = useState<Phase>('scanning');
  const [scanStartedAt] = useState(() => new Date());
  const [scanFromDate, setScanFromDate] = useState<Date | null>(null);

  // Scanning state
  const [scanTotal, setScanTotal] = useState(0);
  const [scanCurrent, setScanCurrent] = useState(0);
  const [newFoundCount, setNewFoundCount] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Review state
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [newTxIds, setNewTxIds] = useState<Set<number>>(new Set());
  const [oldPendingCount, setOldPendingCount] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // Per-transaction account overrides (txId → accountId)
  const [accountOverrides, setAccountOverrides] = useState<Record<number, number>>({});
  // AI model status during scan
  const [aiModelDown, setAiModelDown] = useState(false);
  const [offlineTxIds, setOfflineTxIds] = useState<Set<number>>(new Set());
  const [isModelInitializing, setIsModelInitializing] = useState(false);

  useEffect(() => {
    const init = async () => {
      const [ranges, cats] = await Promise.all([
        getAccountScanRanges(),
        getCategories(),
      ]);

      const accs = ranges.map(r => r.account);
      setAccounts(accs);
      setCategories(cats);

      // scanFromDate is set inside startScan() after computing the true fetch window
      startScan(ranges, accs, cats);
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (phase === 'review') {
        getUnconfirmedTransactions().then(setQueue);
      }
    }, [phase])
  );

  const animateProgress = useCallback((current: number, total: number) => {
    if (total === 0) return;
    Animated.timing(progressAnim, {
      toValue: current / total,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [progressAnim]);

  const startScan = useCallback(async (
    ranges: AccountScanRange[],
    preloadedAccounts?: Account[],
    preloadedCategories?: Category[],
  ) => {
    // Block the background SMS scan for the duration of this foreground scan.
    // Without this, the background task can fire concurrently, find the same SMS
    // before hashes are marked, and send spurious "New Transaction Detected" notifications.
    setForegroundScanActive(true);
    try {
    setPhase('scanning');
    setScanCurrent(0);
    setScanTotal(0);
    setNewFoundCount(0);
    progressAnim.setValue(0);
    setAiModelDown(false);
    setOfflineTxIds(new Set());

    const accs = preloadedAccounts ?? accounts;
    const cats = preloadedCategories ?? categories;

    // Only bank + credit_card accounts produce SMS; cash/wallet accounts are excluded
    const trackableRanges = ranges.filter(
      r => r.account.accountType === 'bank' || r.account.accountType === 'credit_card'
    );

    if (accs.length === 0) {
      Alert.alert('No Accounts', 'Add a bank account first to start tracking transactions.');
      navigation.goBack();
      return;
    }

    if (trackableRanges.length === 0) {
      // Only cash/wallet accounts — nothing to scan
      const all = await getUnconfirmedTransactions();
      setQueue(all);
      setOldPendingCount(all.length);
      setNewTxIds(new Set());
      setPhase('review');
      return;
    }

    // Load existing unconfirmed (before this scan) so we can badge new ones
    const existingUnconfirmed = await getUnconfirmedTransactions();
    setOldPendingCount(existingUnconfirmed.length);
    const existingIds = new Set(existingUnconfirmed.map(t => t.id));

    const [merchantHints, savedHashes, subs, goals, loans, budgets] = await Promise.all([
      getTopMerchantMappings(20),
      getAllSmsHashes(),
      getSubscriptions(true),
      getGoals(true),
      getLoans(true),
      getBudgets(),
    ]);

    const scanContext: ScanContext = {
      subscriptions: subs,
      goals,
      loans,
      accounts: accs,
      categories: cats,
      budgets,
    };

    // Try to init the on-device AI model before scanning (if downloaded but not loaded)
    const isDownloaded = await AIModelManager.isModelDownloaded();
    const isCompatible = AIModelManager.isDeviceCompatible();
    if (!AIModelManager.isModelLoaded() && isDownloaded && isCompatible) {
      setIsModelInitializing(true);
      await AIModelManager.initModel().catch(() => {});
      setIsModelInitializing(false);
    }

    const hints = merchantHints.map(m => ({
      raw: m.merchantRaw,
      clean: m.merchantClean,
      category: m.categoryName,
    }));

    // Compute the actual SMS fetch window. Each account has its own cursor (fromMs).
    // Accounts with last4Digits get a wider 30-day window because a newly-added
    // account might need to catch SMS that arrived before its startDate.
    // Accounts without last4 use their strict per-account cursor.
    // Unmatched SMS use a 7-day lookback window (internal safety net only).
    // Step 1: Compute the per-account scan anchor (what the user sees as "Scanning from")
    // Use the earliest of all account cursors as the global fetch window start.
    const fetchFromMs = trackableRanges.reduce((min, r) => Math.min(min, r.fromMs), Date.now());
    setScanFromDate(new Date(fetchFromMs));

    // Two regexes used to gate unmatched SMS against false positives.
    // An ad may contain "50,000" but will rarely contain a banking verb.
    const BANK_AMOUNT_RE = /(?:(?:inr|rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?\s*(?:inr|rs\.?|₹))|(?:\b(?:amt|amount|of)\s+([\d,]+(?:\.\d{1,2})?))/i;
    const BANK_VERB_RE   = /\b(?:debited|credited|spent|withdrawn|received|transferred|paid|deducted|charged|sent|deposited|deposit|salary)\b/i;

    let smsInbox: { body: string; date: number }[] = [];

    if (Platform.OS === 'android') {
      try {
        const SMSModule = require('react-native-get-sms-android');
        const SmsAndroid = SMSModule.default || SMSModule;
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
          title: 'SMS Permission Required',
          message: 'Echo Spend needs to read your SMS messages to automatically detect bank transactions. Your messages never leave your device.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        });

        if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          setPhase('review');
          notify.error('SMS permission permanently denied', 'Enable it in Settings → App Permissions');
          return;
        }

        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setPhase('review');
          notify.error('SMS permission required for Smart Scan');
          return;
        }

        smsInbox = await new Promise<{ body: string; date: number }[]>((resolve) => {
          SmsAndroid.list(
            JSON.stringify({ box: 'inbox', maxCount: 10000, indexFrom: 0, minDate: fetchFromMs }),
            () => resolve([]),
            (_: number, list: string) => {
              const parsed = JSON.parse(list) as any[];
              resolve(parsed.map((s: any) => ({ body: s.body as string, date: s.date as number })));
            }
          );
        });
      } catch (e) {
        notify.error('Failed to read SMS messages');
      }
    }

    // Sort newest first so the user sees their latest transactions immediately.
    smsInbox.sort((a, b) => b.date - a.date);

    // Step 1 — cheap pre-filter: skip OTPs, skip already-processed hashes,
    // require at least one financial keyword so we don't send unrelated SMS to AI.
    // Due reminders, promos, and balance alerts are intentionally kept here —
    // the AI's isTransaction gate handles them in the parse loop below.
    const keywordFiltered = smsInbox.filter(sms => {
      const lower = sms.body.toLowerCase();
      if (OTP_KEYWORDS.some((k: string) => lower.includes(k))) return false;
      if (!BANK_KEYWORDS.some((k: string) => lower.includes(k))) return false;
      if (savedHashes.has(hashSms(sms.body))) return false;
      return true;
    });

    // Step 2 — match each SMS to a registered account (best-effort; unmatched
    // SMS are still included so fraud-alert formats like SBI's "ending XXXX …
    // Txn. not done by you?" are not silently dropped when the card isn't
    // registered or matching heuristics don't fire).
    const accountsForMatch = trackableRanges.map(r => r.account);
    const rangeByAccountId = Object.fromEntries(trackableRanges.map(r => [r.account.id, r]));

    const filtered: Array<{ body: string; date: number; matchedAccount: SmsAccountMatch }> = [];
    for (const sms of keywordFiltered) {
      const matched = matchSmsToAccount(sms.body, accountsForMatch);

      // 1. If it didn't match any account in Echo Spend, ignore it
      if (!matched) continue;

      // 2. If the matched account has a registered last 4 digits, we require a strict last-4 match.
      // This prevents transactions from other accounts at the same bank from leaking in.
      if (matched.last4Digits && matched.matchType !== 'last4') continue;

      // Range window check strictly enforces the per-account cursors.
      const range = rangeByAccountId[matched.id];
      if (!range || sms.date < range.fromMs) continue;

      filtered.push({ body: sms.body, date: sms.date, matchedAccount: matched });
    }

    // Cap at 100 messages per foreground scan (now newest first)
    const capped = filtered.slice(0, 100);
    setScanTotal(capped.length);

    if (capped.length === 0) {
      // Nothing new — safe to advance all cursors to now
      const now = new Date().toISOString();
      await Promise.all(trackableRanges.map(r => updateAccountLastScanned(r.account.id, now)));
      const all = await getUnconfirmedTransactions();
      setQueue(all);
      setNewTxIds(new Set());
      setPhase('review');
      return;
    }

    const newlySavedIds: number[] = [];
    const offlineSavedIds: number[] = [];
    const scannedAccountIds = new Set<number>();

    for (let i = 0; i < capped.length; i++) {
      const sms = capped[i];
      setScanCurrent(i + 1);
      animateProgress(i + 1, capped.length);
      if (sms.matchedAccount) scannedAccountIds.add(sms.matchedAccount.id);

      try {
        const parsed = await parseSms(sms.body, hints, scanContext, sms.date);

        // Flag if AI model wasn't available and regex fallback was used
        if (parsed.parsedOffline) setAiModelDown(true);

        // AI determined this SMS is not a real transaction — mark it so we never
        // re-scan it, then skip without adding to the review queue.
        if (!parsed.isTransaction) {
          await markSmsProcessed(hashSms(sms.body));
          continue;
        }

        if (parsed.alreadySaved) {
          await markSmsProcessed(hashSms(sms.body));
          continue;
        }

        // ── Multi-layer dedup ──────────────────────────────────────────────
        // Layer 1: Exact rawSms body match (covers confirmed + unconfirmed)
        if (await isRawSmsAlreadyExists(sms.body)) {
          await markSmsProcessed(hashSms(sms.body));
          continue;
        }

        if (parsed.transaction.amount !== undefined && parsed.transaction.amount > 0) {
          // Prefer structural match → AI suggestion → first bank account
          const accountId = sms.matchedAccount?.id
            ?? parsed.suggestedAccountId
            ?? accountsForMatch[0]?.id;
          if (accountId) scannedAccountIds.add(accountId);

          // Layer 2: Semantic dedup — same amount + type + account within ±2h
          // Catches cases where SMS body differs slightly (whitespace, encoding)
          // or a manual entry was added before the scan ran.
          if (await isSmsDuplicateTransaction(
            parsed.transaction.amount,
            (parsed.transaction.type as 'credit' | 'debit' | 'transfer') ?? 'debit',
            parsed.transaction.date ?? new Date(sms.date).toISOString(),
            accountId,
          )) {
            await markSmsProcessed(hashSms(sms.body));
            continue;
          }

          // Auto-approve tiny high-confidence debits — never auto-approve offline-parsed
          // transactions since local regex parsing is less reliable and needs user review
          if (
            preferences.autoApproveSmallSpends &&
            parsed.transaction.type !== 'credit' &&
            parsed.transaction.amount <= preferences.autoApproveThreshold &&
            parsed.confidence === 'high' &&
            !parsed.parsedOffline
          ) {
            const txData = {
              ...parsed.transaction,
              accountId,
              isConfirmed: true,
              rawSms: sms.body,
              source: 'auto' as const,
            } as Omit<Transaction, 'id'>;
            await addTransaction(txData);
            await markSmsProcessed(hashSms(sms.body));
            setNewFoundCount(c => c + 1);
          } else {
            const txData = {
              ...parsed.transaction,
              accountId,
              isConfirmed: false,
              rawSms: sms.body,
              source: 'sms' as const,
            } as Omit<Transaction, 'id'>;
            const newId = await addTransaction(txData);
            await markSmsProcessed(hashSms(sms.body));
            newlySavedIds.push(newId);
            if (parsed.parsedOffline) offlineSavedIds.push(newId);
            setNewFoundCount(c => c + 1);
          }
        } else {
          await markSmsProcessed(hashSms(sms.body));
        }
      } catch {
        // Skip unparseable SMS — it will not be marked as processed, so it can be retried
      }
    }

    // Advance cursor AFTER the processing loop — not before — so a crash during
    // parsing doesn't permanently skip SMS that were never actually saved.
    if (filtered.length <= 50) {
      const now = new Date().toISOString();
      await Promise.all(trackableRanges.map(r => updateAccountLastScanned(r.account.id, now)));
    } else {
      // Capped at 50; advance to just before the 51st so the next scan picks it up.
      const safeDateStr = new Date(filtered[50].date).toISOString();
      await Promise.all(trackableRanges.map(r => updateAccountLastScanned(r.account.id, safeDateStr)));
    }

    // Load ALL unconfirmed for review (old + new)
    const allUnconfirmed = await getUnconfirmedTransactions();
    setQueue(allUnconfirmed);

    // Mark which ones are new this session
    const newIds = new Set(newlySavedIds.filter(id => !existingIds.has(id)));
    setNewTxIds(newIds);
    setOfflineTxIds(new Set(offlineSavedIds));

    animateProgress(filtered.length, filtered.length);
    setPhase('review');
    } finally {
      setForegroundScanActive(false);
    }
  }, [accounts, categories, parseSms, preferences, animateProgress, navigation]);

  // ── Review actions ──────────────────────────────────────────────────────────

  const effectiveAccountId = (tx: Transaction) =>
    accountOverrides[tx.id] ?? tx.accountId;

  const handleConfirm = async (tx: Transaction) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const accountId = effectiveAccountId(tx);

    // If user overrode the account, update the DB before confirming
    if (accountId && accountId !== tx.accountId) {
      await updateTransaction(tx.id, { accountId });
    }

    await confirmTransaction(tx.id);
    // Goal and loan impacts are applied inside confirmTransaction → applyTransactionImpact.
    // Do NOT call updateGoalCurrentAmount / updateLoanRemainingAmount here — that double-applies.

    setQueue(prev => prev.filter(t => t.id !== tx.id));
    setNewTxIds(prev => { const s = new Set(prev); s.delete(tx.id); return s; });
    notify.success('Saved', `${currency}${tx.amount?.toLocaleString('en-IN')} at ${tx.merchant}`);
  };

  const handleDelete = (tx: Transaction) => {
    Alert.alert(
      'Ignore Transaction',
      `Remove ${currency}${tx.amount?.toLocaleString('en-IN')} at ${tx.merchant}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await deleteTransaction(tx.id);
            setQueue(prev => prev.filter(t => t.id !== tx.id));
            setNewTxIds(prev => { const s = new Set(prev); s.delete(tx.id); return s; });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const handleConfirmAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      'Confirm All',
      `Confirm all ${queue.length} pending transaction${queue.length > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm All',
          onPress: async () => {
            for (const tx of queue) {
              const accountId = effectiveAccountId(tx);
              if (accountId && accountId !== tx.accountId) {
                await updateTransaction(tx.id, { accountId });
              }
              await confirmTransaction(tx.id);
            }
            setQueue([]);
            setNewTxIds(new Set());
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            notify.success(`${queue.length} transactions confirmed`);
            navigation.goBack();
          },
        },
      ]
    );
  };

  const handleDeleteAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      'Delete All Pending',
      `Permanently delete all ${queue.length} pending transaction${queue.length > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            const count = queue.length;
            for (const tx of queue) {
              await deleteTransaction(tx.id);
            }
            setQueue([]);
            setNewTxIds(new Set());
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            notify.success(`${count} transactions deleted`);
          },
        },
      ]
    );
  };

  const changeAccount = (txId: number, accountId: number) => {
    setAccountOverrides(prev => ({ ...prev, [txId]: accountId }));
  };


  const confidenceColor: Record<string, string> = {
    high: colors.success,
    medium: colors.warning,
    low: colors.danger,
  };

  // ── Render phases ───────────────────────────────────────────────────────────

  const renderHeader = () => (
    <View className="px-6 py-4 flex-row justify-between items-center border-b" style={{ borderBottomColor: colors.border }}>
      <View className="flex-row items-center">
        <View className="w-9 h-9 rounded-full items-center justify-center mr-3" style={{ backgroundColor: `${colors.accent}20` }}>
          <LucideZap color={colors.accent} size={18} />
        </View>
        <View>
          <ThemedText className="text-xl font-bold">Smart Scan</ThemedText>
          <ThemedText type="secondary" className="text-xs">
            {phase === 'scanning' && (scanTotal > 0 ? `Analyzing ${scanCurrent} of ${scanTotal}…` : isModelInitializing ? 'Initializing AI Engine…' : 'Preparing…')}
            {phase === 'review' && (queue.length > 0 ? `${queue.length} pending · ${newTxIds.size} new` : 'All caught up')}
          </ThemedText>
        </View>
      </View>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        className="w-9 h-9 rounded-full items-center justify-center"
        style={{ backgroundColor: colors.translucent }}
      >
        <LucideX color={colors.primary} size={18} />
      </TouchableOpacity>
    </View>
  );

  // ── Scanning phase ──────────────────────────────────────────────────────────
  if (phase === 'scanning') {
    return (
      <ThemedSafeAreaView>
        {renderHeader()}
        <View className="flex-1 px-6 items-center justify-center">
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full items-center"
          >
            {/* Animated pulse ring */}
            <MotiView
              from={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.15, opacity: 0.2 }}
              transition={{ type: 'timing', duration: 1200, loop: true }}
              className="absolute w-32 h-32 rounded-full"
              style={{ backgroundColor: colors.accent }}
            />
            <View
              className="w-28 h-28 rounded-full items-center justify-center mb-10"
              style={{ backgroundColor: `${colors.accent}25`, borderWidth: 1, borderColor: `${colors.accent}40` }}
            >
              <ActivityIndicator color={colors.accent} size="large" />
            </View>

            <ThemedText className="font-bold text-2xl mb-2">
              {scanTotal > 0 ? `${scanCurrent} / ${scanTotal}` : isModelInitializing ? 'Initializing AI Engine…' : 'Preparing…'}
            </ThemedText>
            <ThemedText type="secondary" className="text-sm text-center">
              {isModelInitializing
                ? 'Loading local Llama-3.2 model context…'
                : `Matching SMS to your ${accounts.filter(a => a.accountType === 'bank' || a.accountType === 'credit_card').length} tracked account${accounts.filter(a => a.accountType === 'bank' || a.accountType === 'credit_card').length !== 1 ? 's' : ''}`}
            </ThemedText>
            {scanFromDate && (
              <ThemedText type="secondary" className="text-xs mb-1 mt-1">
                Scanning from {scanFromDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' '}at {scanFromDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
              </ThemedText>
            )}
            <ThemedText type="secondary" className="text-[10px] mb-8 opacity-60">
              Session started {scanStartedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
            </ThemedText>

            {/* Progress bar */}
            {scanTotal > 0 && (
              <View className="w-full rounded-full overflow-hidden mb-6" style={{ height: 6, backgroundColor: colors.border }}>
                <Animated.View
                  style={{
                    height: 6,
                    backgroundColor: colors.accent,
                    width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                    borderRadius: 3,
                  }}
                />
              </View>
            )}

            {newFoundCount > 0 && (
              <MotiView
                from={{ opacity: 0, translateY: 8 }}
                animate={{ opacity: 1, translateY: 0 }}
                className="px-5 py-3 rounded-full flex-row items-center"
                style={{ backgroundColor: `${colors.success}15` }}
              >
                <LucideCheck color={colors.success} size={14} />
                <ThemedText className="font-bold ml-2 text-sm" style={{ color: colors.success }}>
                  {newFoundCount} transaction{newFoundCount !== 1 ? 's' : ''} found
                </ThemedText>
              </MotiView>
            )}

            {oldPendingCount > 0 && (
              <ThemedText type="secondary" className="text-xs mt-4">
                + {oldPendingCount} previously pending
              </ThemedText>
            )}

            {aiModelDown && (
              <View
                className="mt-4 px-4 py-2 rounded-full flex-row items-center"
                style={{ backgroundColor: `${colors.warning}18` }}
              >
                <LucideAlertTriangle color={colors.warning} size={13} />
                <ThemedText className="text-xs ml-2 font-semibold" style={{ color: colors.warning }}>
                  AI model not loaded — using basic parsing
                </ThemedText>
              </View>
            )}
          </MotiView>
        </View>
      </ThemedSafeAreaView>
    );
  }

  // ── Review phase ────────────────────────────────────────────────────────────
  const newItems = queue.filter(t => newTxIds.has(t.id));
  const oldItems = queue.filter(t => !newTxIds.has(t.id));

  return (
    <ThemedSafeAreaView>
      {renderHeader()}

      {/* Summary bar */}
      {queue.length > 0 && (
        <View className="px-6 py-3 flex-row items-center justify-between border-b" style={{ borderBottomColor: colors.border }}>
          <View className="flex-row items-center">
            {newTxIds.size > 0 && (
              <View className="mr-3 px-2.5 py-1 rounded-full flex-row items-center" style={{ backgroundColor: `${colors.accent}15` }}>
                <LucideZap color={colors.accent} size={11} />
                <ThemedText className="text-[10px] font-bold ml-1" style={{ color: colors.accent }}>
                  {newTxIds.size} new
                </ThemedText>
              </View>
            )}
            {oldPendingCount > 0 && (
              <View className="px-2.5 py-1 rounded-full flex-row items-center" style={{ backgroundColor: `${colors.warning}15` }}>
                <LucideInbox color={colors.warning} size={11} />
                <ThemedText className="text-[10px] font-bold ml-1" style={{ color: colors.warning }}>
                  {oldItems.length} pending
                </ThemedText>
              </View>
            )}
          </View>
          {queue.length > 1 && (
            <View className="flex-row items-center">
              <TouchableOpacity
                onPress={handleDeleteAll}
                className="px-4 py-2 rounded-full mr-2"
                style={{ backgroundColor: `${colors.danger}15` }}
              >
                <ThemedText className="text-xs font-bold" style={{ color: colors.danger }}>
                  Delete All
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmAll}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: `${colors.accent}20` }}
              >
                <ThemedText className="text-xs font-bold" style={{ color: colors.accent }}>
                  Confirm All
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
      <ScrollView 
        className="flex-1 px-6" 
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {queue.length === 0 ? (
          <View className="items-center py-20">
            <LucideShieldCheck color={colors.success} size={56} />
            <ThemedText className="font-bold text-xl mt-5">All caught up!</ThemedText>
            <ThemedText type="secondary" className="text-center mt-2 px-8">
              {newFoundCount > 0
                ? `${newFoundCount} transaction${newFoundCount !== 1 ? 's' : ''} were auto-approved.`
                : 'No new transactions found since your last scan.'}
            </ThemedText>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="mt-8 px-8 py-3 rounded-full"
              style={{ backgroundColor: colors.accent }}
            >
              <ThemedText className="font-bold" style={{ color: '#FFFFFF' }}>Done</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <AnimatePresence>
            {queue.map((tx) => (
              <ReviewTransactionCard
                key={tx.id}
                tx={tx}
                isNew={newTxIds.has(tx.id)}
                isOffline={offlineTxIds.has(tx.id)}
                accounts={accounts}
                categories={categories}
                accountOverride={accountOverrides[tx.id]}
                onConfirm={(txToConfirm) => handleConfirm(txToConfirm)}
                onDelete={handleDelete}
                onEditPress={(txToEdit) => navigation.navigate('EditTransaction', { transaction: txToEdit })}
                onTransactionUpdated={(updatedTx) => {
                  setQueue(prev => prev.map(t => t.id === updatedTx.id ? updatedTx : t));
                }}
                onChangeAccount={changeAccount}
              />
            ))}
          </AnimatePresence>
        )}
        <View className="h-24" />
      </ScrollView>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default SmartScanScreen;
