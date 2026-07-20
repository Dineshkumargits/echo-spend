import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  PermissionsAndroid,
  Platform,
  Animated,
  KeyboardAvoidingView,
} from "react-native";
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
} from "lucide-react-native";
import { renderCategoryIcon } from "../components/CategoryManager";
import { EmptyState, PrimaryButton } from "../components/Kit";
import { useAISmsParser, ScanContext } from "../hooks/useAISmsParser";
import { hashSms } from "../services/smsParserService";
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
} from "../services/database";
import {
  matchSmsToAccount,
  SmsAccountMatch,
} from "../services/smsParserService";
import { useStore } from "../store/useStore";
import { setForegroundScanActive } from "../services/backgroundTasks";
import { MotiView, AnimatePresence } from "moti";
import { notify } from "../utils/notify";
import { useTheme } from "../theme/ThemeProvider";
import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import { ReviewTransactionCard } from "../components/ReviewTransactionCard";
import * as Haptics from "expo-haptics";
import { useFocusEffect } from "@react-navigation/native";
import { AIModelManager } from "../services/aiModelManager";
import { SonarSweep, SectionLabel } from "../components/Signal";
import { fonts } from "../theme/tokens";

type Phase = "scanning" | "review";

// Cheap pre-filter: at least one financial term must be present before we bother sending to AI.
const BANK_KEYWORDS = [
  "debited",
  "credited",
  "spent",
  "received",
  "transferred",
  "withdrawn",
  "deposited",
  "paid",
  "payment",
  "purchase",
  "rs.",
  "rs ",
  "₹",
  "inr",
  "upi",
  "vpa",
  "neft",
  "imps",
  "rtgs",
  "atm",
  "pos",
  "txn",
  "transaction",
  "a/c",
  "acct",
  "account",
  "bal",
  "deducted",
  "charged",
  "sent",
  "amount",
  "amt",
  "dr",
  "cr",
  "card",
  "salary",
  "refund",
  "cashback",
  "deposited",
  "deposit",
];
// Always skip OTPs — never send them to AI.
const OTP_KEYWORDS = [
  "otp",
  "one time",
  "password",
  "verification code",
  "one-time",
];
// Everything else (due reminders, promos, balance alerts) is sent to AI for classification.

const SmartScanScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { parseSms } = useAISmsParser();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? "₹";

  const [phase, setPhase] = useState<Phase>("scanning");
  const [scanStartedAt] = useState(() => new Date());
  const [scanFromDate, setScanFromDate] = useState<Date | null>(null);

  // Scanning state
  const [scanTotal, setScanTotal] = useState(0);
  const [scanCurrent, setScanCurrent] = useState(0);
  const [newFoundCount, setNewFoundCount] = useState(0);
  // Live scan log — display only: last few parsed results + skip counter
  const [scanLog, setScanLog] = useState<string[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [currentParsing, setCurrentParsing] = useState<string | null>(null);

  // Review state
  const [queue, setQueue] = useState<Transaction[]>([]);
  const [newTxIds, setNewTxIds] = useState<Set<number>>(new Set());
  const [oldPendingCount, setOldPendingCount] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // Per-transaction account overrides (txId → accountId)
  const [accountOverrides, setAccountOverrides] = useState<
    Record<number, number>
  >({});
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

      const accs = ranges.map((r) => r.account);
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
      if (phase === "review") {
        getUnconfirmedTransactions().then(setQueue);
      }
    }, [phase]),
  );

  const finishScanOrRedirect = useCallback(async () => {
    const all = await getUnconfirmedTransactions();
    if (all.length > 0) {
      navigation.replace("SmartInbox");
    } else {
      setQueue(all);
      setPhase("review");
    }
  }, [navigation]);

  const startScan = useCallback(
    async (
      ranges: AccountScanRange[],
      preloadedAccounts?: Account[],
      preloadedCategories?: Category[],
    ) => {
      // Block the background SMS scan for the duration of this foreground scan.
      // Without this, the background task can fire concurrently, find the same SMS
      // before hashes are marked, and send spurious "New Transaction Detected" notifications.
      setForegroundScanActive(true);
      try {
        setPhase("scanning");
        setScanCurrent(0);
        setScanTotal(0);
        setNewFoundCount(0);
        setScanLog([]);
        setSkippedCount(0);
        setCurrentParsing(null);
        setAiModelDown(false);
        setOfflineTxIds(new Set());

        const accs = preloadedAccounts ?? accounts;
        const cats = preloadedCategories ?? categories;

        // Only bank + credit_card accounts produce SMS; cash/wallet accounts are excluded
        const trackableRanges = ranges.filter(
          (r) =>
            r.account.accountType === "bank" ||
            r.account.accountType === "credit_card",
        );

        if (accs.length === 0) {
          Alert.alert(
            "No Accounts",
            "Add a bank account first to start tracking transactions.",
          );
          navigation.goBack();
          return;
        }

        if (trackableRanges.length === 0) {
          // Only cash/wallet accounts — nothing to scan
          await finishScanOrRedirect();
          return;
        }

        // Load existing unconfirmed (before this scan) so we can badge new ones
        const existingUnconfirmed = await getUnconfirmedTransactions();
        setOldPendingCount(existingUnconfirmed.length);
        const existingIds = new Set(existingUnconfirmed.map((t) => t.id));

        const [merchantHints, savedHashes, subs, goals, loans, budgets] =
          await Promise.all([
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

        const hints = merchantHints.map((m) => ({
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
        const fetchFromMs = trackableRanges.reduce(
          (min, r) => Math.min(min, r.fromMs),
          Date.now(),
        );
        setScanFromDate(new Date(fetchFromMs));

        // Two regexes used to gate unmatched SMS against false positives.
        // An ad may contain "50,000" but will rarely contain a banking verb.
        const BANK_AMOUNT_RE =
          /(?:(?:inr|rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?\s*(?:inr|rs\.?|₹))|(?:\b(?:amt|amount|of)\s+([\d,]+(?:\.\d{1,2})?))/i;
        const BANK_VERB_RE =
          /\b(?:debited|credited|spent|withdrawn|received|transferred|paid|deducted|charged|sent|deposited|deposit|salary)\b/i;

        let smsInbox: { body: string; date: number }[] = [];

        if (Platform.OS === "android") {
          try {
            const SMSModule = require("react-native-get-sms-android");
            const SmsAndroid = SMSModule.default || SMSModule;

            const hasSmsPerm = await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.READ_SMS,
            );
            if (!hasSmsPerm) {
              Alert.alert(
                "SMS Transaction Scanning",
                "Echo Spend requests permission to read and receive SMS messages (READ_SMS and RECEIVE_SMS) to automatically scan, detect, and import financial transactions from your bank or card alerts. This process runs completely locally and offline on your device, ensuring your sensitive financial data remains private.\n\nDo you want to enable this feature and grant the required permissions?",
                [
                  {
                    text: "Decline",
                    onPress: () => {
                      finishScanOrRedirect();
                      notify.error("SMS permission required for Smart Scan");
                    },
                  },
                  {
                    text: "Agree & Enable",
                    onPress: async () => {
                      try {
                        const granted = await PermissionsAndroid.request(
                          PermissionsAndroid.PERMISSIONS.READ_SMS,
                          {
                            title: "SMS Permission Required",
                            message:
                              "Echo Spend needs permission to read financial SMS messages to automatically scan transactions.",
                            buttonPositive: "Grant",
                            buttonNegative: "Cancel",
                          },
                        );

                        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                          startScan(
                            ranges,
                            preloadedAccounts,
                            preloadedCategories,
                          );
                        } else if (
                          granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
                        ) {
                          finishScanOrRedirect();
                          notify.error(
                            "SMS permission permanently denied",
                            "Enable it in Settings → App Permissions",
                          );
                        } else {
                          finishScanOrRedirect();
                          notify.error(
                            "SMS permission required for Smart Scan",
                          );
                        }
                      } catch (e) {
                        console.warn(
                          "[SmartScanScreen] Failed to request SMS permission:",
                          e,
                        );
                        finishScanOrRedirect();
                      }
                    },
                  },
                ],
              );
              return;
            }

            smsInbox = await new Promise<{ body: string; date: number }[]>(
              (resolve) => {
                SmsAndroid.list(
                  JSON.stringify({
                    box: "inbox",
                    maxCount: 10000,
                    indexFrom: 0,
                    minDate: fetchFromMs,
                  }),
                  () => resolve([]),
                  (_: number, list: string) => {
                    const parsed = JSON.parse(list) as any[];
                    resolve(
                      parsed.map((s: any) => ({
                        body: s.body as string,
                        date: s.date as number,
                      })),
                    );
                  },
                );
              },
            );
          } catch (e) {
            notify.error("Failed to read SMS messages");
          }
        }

        // Sort newest first so the user sees their latest transactions immediately.
        smsInbox.sort((a, b) => b.date - a.date);

        // Step 1 — cheap pre-filter: skip OTPs, skip already-processed hashes,
        // require at least one financial keyword so we don't send unrelated SMS to AI.
        // Due reminders, promos, and balance alerts are intentionally kept here —
        // the AI's isTransaction gate handles them in the parse loop below.
        const keywordFiltered = smsInbox.filter((sms) => {
          const lower = sms.body.toLowerCase();
          if (OTP_KEYWORDS.some((k: string) => lower.includes(k))) return false;
          if (!BANK_KEYWORDS.some((k: string) => lower.includes(k)))
            return false;
          if (savedHashes.has(hashSms(sms.body))) return false;
          return true;
        });
        setSkippedCount(smsInbox.length - keywordFiltered.length);

        // Step 2 — match each SMS to a registered account (best-effort; unmatched
        // SMS are still included so fraud-alert formats like SBI's "ending XXXX …
        // Txn. not done by you?" are not silently dropped when the card isn't
        // registered or matching heuristics don't fire).
        const accountsForMatch = trackableRanges.map((r) => r.account);
        const rangeByAccountId = Object.fromEntries(
          trackableRanges.map((r) => [r.account.id, r]),
        );

        const filtered: Array<{
          body: string;
          date: number;
          matchedAccount: SmsAccountMatch;
        }> = [];
        for (const sms of keywordFiltered) {
          const matched = matchSmsToAccount(sms.body, accountsForMatch);

          // 1. If it didn't match any account in Echo Spend, ignore it
          if (!matched) continue;

          // 2. If the matched account has a registered last 2-4 digits, we require a strict last-digits match.
          // This prevents transactions from other accounts at the same bank from leaking in.
          if (matched.last4Digits && matched.matchType !== "last4") continue;

          // Range window check strictly enforces the per-account cursors.
          const range = rangeByAccountId[matched.id];
          if (!range || sms.date < range.fromMs) continue;

          filtered.push({
            body: sms.body,
            date: sms.date,
            matchedAccount: matched,
          });
        }

        // Cap at 100 messages per foreground scan (now newest first)
        const capped = filtered.slice(0, 100);
        setScanTotal(capped.length);

        if (capped.length === 0) {
          // Nothing new — safe to advance all cursors to now
          const now = new Date().toISOString();
          await Promise.all(
            trackableRanges.map((r) =>
              updateAccountLastScanned(r.account.id, now),
            ),
          );
          await finishScanOrRedirect();
          return;
        }

        const newlySavedIds: number[] = [];
        const offlineSavedIds: number[] = [];
        const scannedAccountIds = new Set<number>();

        for (let i = 0; i < capped.length; i++) {
          const sms = capped[i];
          setScanCurrent(i + 1);
          setCurrentParsing(sms.matchedAccount?.name ?? 'message');
          if (sms.matchedAccount) scannedAccountIds.add(sms.matchedAccount.id);

          try {
            const parsed = await parseSms(
              sms.body,
              hints,
              scanContext,
              sms.date,
            );

            // Flag if AI model wasn't available and regex fallback was used
            if (parsed.parsedOffline) setAiModelDown(true);

            // AI determined this SMS is not a real transaction — mark it so we never
            // re-scan it, then skip without adding to the review queue.
            if (!parsed.isTransaction) {
              await markSmsProcessed(hashSms(sms.body));
              setSkippedCount((c) => c + 1);
              continue;
            }

            if (parsed.alreadySaved) {
              await markSmsProcessed(hashSms(sms.body));
              setSkippedCount((c) => c + 1);
              continue;
            }

            // ── Multi-layer dedup ──────────────────────────────────────────────
            // Layer 1: Exact rawSms body match (covers confirmed + unconfirmed)
            if (await isRawSmsAlreadyExists(sms.body)) {
              await markSmsProcessed(hashSms(sms.body));
              setSkippedCount((c) => c + 1);
              continue;
            }

            if (
              parsed.transaction.amount !== undefined &&
              parsed.transaction.amount > 0
            ) {
              // Prefer structural match → AI suggestion → first bank account
              const accountId =
                sms.matchedAccount?.id ??
                parsed.suggestedAccountId ??
                accountsForMatch[0]?.id;
              if (accountId) scannedAccountIds.add(accountId);

              // Layer 2: Semantic dedup — same amount + type + account within ±2h
              // Catches cases where SMS body differs slightly (whitespace, encoding)
              // or a manual entry was added before the scan ran.
              if (
                await isSmsDuplicateTransaction(
                  parsed.transaction.amount,
                  (parsed.transaction.type as
                    | "credit"
                    | "debit"
                    | "transfer") ?? "debit",
                  parsed.transaction.date ?? new Date(sms.date).toISOString(),
                  accountId,
                )
              ) {
                await markSmsProcessed(hashSms(sms.body));
                setSkippedCount((c) => c + 1);
                continue;
              }

              // Auto-approve tiny high-confidence debits — never auto-approve offline-parsed
              // transactions since local regex parsing is less reliable and needs user review
              if (
                preferences.autoApproveSmallSpends &&
                parsed.transaction.type !== "credit" &&
                parsed.transaction.amount <= preferences.autoApproveThreshold &&
                parsed.confidence === "high" &&
                !parsed.parsedOffline
              ) {
                const txData = {
                  ...parsed.transaction,
                  accountId,
                  isConfirmed: true,
                  rawSms: sms.body,
                  source: "auto" as const,
                } as Omit<Transaction, "id">;
                await addTransaction(txData);
                await markSmsProcessed(hashSms(sms.body));
                setNewFoundCount((c) => c + 1);
                setScanLog((prev) => [
                  ...prev.slice(-4),
                  `${txData.merchant ?? 'Unknown'} ${txData.type === 'credit' ? '+' : '−'}${currency}${(txData.amount ?? 0).toLocaleString('en-IN')} · ${(txData.category ?? 'other').toLowerCase()} · auto`,
                ]);
              } else {
                const txData = {
                  ...parsed.transaction,
                  accountId,
                  isConfirmed: false,
                  rawSms: sms.body,
                  source: "sms" as const,
                } as Omit<Transaction, "id">;
                const newId = await addTransaction(txData);
                await markSmsProcessed(hashSms(sms.body));
                newlySavedIds.push(newId);
                if (parsed.parsedOffline) offlineSavedIds.push(newId);
                setNewFoundCount((c) => c + 1);
                setScanLog((prev) => [
                  ...prev.slice(-4),
                  `${txData.merchant ?? 'Unknown'} ${txData.type === 'credit' ? '+' : '−'}${currency}${(txData.amount ?? 0).toLocaleString('en-IN')} · ${(txData.category ?? 'other').toLowerCase()}`,
                ]);
              }
            } else {
              await markSmsProcessed(hashSms(sms.body));
              setSkippedCount((c) => c + 1);
            }
          } catch {
            // Skip unparseable SMS — it will not be marked as processed, so it can be retried
          }
        }
        setCurrentParsing(null);

        // Advance cursor AFTER the processing loop — not before — so a crash during
        // parsing doesn't permanently skip SMS that were never actually saved.
        if (filtered.length <= 50) {
          const now = new Date().toISOString();
          await Promise.all(
            trackableRanges.map((r) =>
              updateAccountLastScanned(r.account.id, now),
            ),
          );
        } else {
          // Capped at 50; advance to just before the 51st so the next scan picks it up.
          const safeDateStr = new Date(filtered[50].date).toISOString();
          await Promise.all(
            trackableRanges.map((r) =>
              updateAccountLastScanned(r.account.id, safeDateStr),
            ),
          );
        }

        // Load ALL unconfirmed for review (old + new)
        const allUnconfirmed = await getUnconfirmedTransactions();
        if (allUnconfirmed.length > 0) {
          navigation.replace("SmartInbox");
        } else {
          setQueue(allUnconfirmed);

          // Mark which ones are new this session
          const newIds = new Set(
            newlySavedIds.filter((id) => !existingIds.has(id)),
          );
          setNewTxIds(newIds);
          setOfflineTxIds(new Set(offlineSavedIds));

          setPhase("review");
        }
      } finally {
        setForegroundScanActive(false);
      }
    },
    [accounts, categories, parseSms, preferences, navigation, finishScanOrRedirect],
  );

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

    setQueue((prev) => prev.filter((t) => t.id !== tx.id));
    setNewTxIds((prev) => {
      const s = new Set(prev);
      s.delete(tx.id);
      return s;
    });
    notify.success(
      "Saved",
      `${currency}${tx.amount?.toLocaleString("en-IN")} at ${tx.merchant}`,
    );
  };

  const handleDelete = (tx: Transaction) => {
    Alert.alert(
      "Ignore Transaction",
      `Remove ${currency}${tx.amount?.toLocaleString("en-IN")} at ${tx.merchant}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteTransaction(tx.id);
            setQueue((prev) => prev.filter((t) => t.id !== tx.id));
            setNewTxIds((prev) => {
              const s = new Set(prev);
              s.delete(tx.id);
              return s;
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ],
    );
  };

  const handleConfirmAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      "Confirm All",
      `Confirm all ${queue.length} pending transaction${queue.length > 1 ? "s" : ""}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm All",
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
      ],
    );
  };

  const handleDeleteAll = () => {
    if (queue.length === 0) return;
    Alert.alert(
      "Delete All Pending",
      `Permanently delete all ${queue.length} pending transaction${queue.length > 1 ? "s" : ""}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
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
      ],
    );
  };

  const changeAccount = (txId: number, accountId: number) => {
    setAccountOverrides((prev) => ({ ...prev, [txId]: accountId }));
  };

  const confidenceColor: Record<string, string> = {
    high: colors.success,
    medium: colors.warning,
    low: colors.danger,
  };

  // ── Render phases ───────────────────────────────────────────────────────────

  const renderHeader = () => (
    <View
      className="px-6 py-4 flex-row justify-between items-center border-b"
      style={{ borderBottomColor: colors.border }}
    >
      <View className="flex-row items-center">
        <View
          className="w-9 h-9 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${colors.accent}20` }}
        >
          <LucideZap color={colors.accent} size={18} />
        </View>
        <View>
          <ThemedText className="text-xl font-bold">Smart Scan</ThemedText>
          <ThemedText type="secondary" className="text-xs">
            {phase === "scanning" &&
              (scanTotal > 0
                ? `Analyzing ${scanCurrent} of ${scanTotal}…`
                : isModelInitializing
                  ? "Initializing AI Engine…"
                  : "Preparing…")}
            {phase === "review" &&
              (queue.length > 0
                ? `${queue.length} pending · ${newTxIds.size} new`
                : "All quiet")}
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
  if (phase === "scanning") {
    return (
      <ThemedSafeAreaView>
        {renderHeader()}
        <View className="flex-1 px-6 items-center justify-center">
          <MotiView
            from={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full items-center"
          >
            {/* Sonar sweep — the on-device AI listening to your inbox */}
            <SonarSweep size={180} style={{ marginBottom: 32 }} />

            <ThemedText
              className="text-2xl mb-2"
              style={{ fontFamily: fonts.signalBold, fontVariant: ["tabular-nums"] }}
            >
              {scanTotal > 0
                ? `${scanCurrent} / ${scanTotal}`
                : isModelInitializing
                  ? "Listening…"
                  : "Preparing…"}
            </ThemedText>
            <ThemedText type="secondary" className="text-sm text-center">
              {isModelInitializing
                ? "Loading local Qwen2.5-1.5B model context…"
                : `Matching SMS to your ${accounts.filter((a) => a.accountType === "bank" || a.accountType === "credit_card").length} tracked account${accounts.filter((a) => a.accountType === "bank" || a.accountType === "credit_card").length !== 1 ? "s" : ""}`}
            </ThemedText>
            <SectionLabel color={colors.ai} style={{ marginTop: 10 }}>
              All processing on-device · nothing uploaded
            </SectionLabel>
            {scanFromDate && (
              <ThemedText type="secondary" className="text-xs mb-1 mt-1">
                Scanning from{" "}
                {scanFromDate.toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}{" "}
                at{" "}
                {scanFromDate.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                })}
              </ThemedText>
            )}
            <ThemedText
              type="secondary"
              className="text-[10px] mb-8 opacity-60"
            >
              Session started{" "}
              {scanStartedAt.toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              })}
            </ThemedText>

            {scanTotal > 0 && (
              <View
                className="w-full rounded-full overflow-hidden mb-6"
                style={{ height: 6, backgroundColor: colors.border }}
              >
                <MotiView
                  animate={{
                    width: `${scanTotal > 0 ? (scanCurrent / scanTotal) * 100 : 0}%`,
                  }}
                  transition={{ type: "timing", duration: 300 }}
                  style={{
                    height: 6,
                    backgroundColor: colors.accent,
                    borderRadius: 3,
                  }}
                />
              </View>
            )}

            {/* Live parse log — the signal trace of this scan */}
            {(scanLog.length > 0 || skippedCount > 0 || currentParsing) && (
              <MotiView
                from={{ opacity: 0, translateY: 8 }}
                animate={{ opacity: 1, translateY: 0 }}
                className="w-full p-3.5 rounded-apple-md border"
                style={{ backgroundColor: colors.surface, borderColor: colors.border, gap: 6 }}
              >
                {scanLog.slice(-4).map((line, i) => (
                  <ThemedText key={`${i}-${line}`} font="signal" style={{ fontSize: 10, color: colors.credit }} numberOfLines={1}>
                    ＋ {line}
                  </ThemedText>
                ))}
                {currentParsing && (
                  <ThemedText font="signal" style={{ fontSize: 10, color: colors.debit }} numberOfLines={1}>
                    ◌ parsing {currentParsing} …
                  </ThemedText>
                )}
                {skippedCount > 0 && (
                  <ThemedText font="signal" style={{ fontSize: 10, color: colors.secondary }}>
                    · {skippedCount} skipped (OTP / promo / duplicates)
                  </ThemedText>
                )}
              </MotiView>
            )}

            {newFoundCount > 0 && (
              <MotiView
                from={{ opacity: 0, translateY: 8 }}
                animate={{ opacity: 1, translateY: 0 }}
                className="px-5 py-3 rounded-full flex-row items-center mt-4"
                style={{ backgroundColor: `${colors.success}15` }}
              >
                <LucideCheck color={colors.success} size={14} />
                <ThemedText
                  className="font-bold ml-2 text-sm"
                  style={{ color: colors.success }}
                >
                  {newFoundCount} transaction{newFoundCount !== 1 ? "s" : ""}{" "}
                  found
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
                <ThemedText
                  className="text-xs ml-2 font-semibold"
                  style={{ color: colors.warning }}
                >
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
  const newItems = queue.filter((t) => newTxIds.has(t.id));
  const oldItems = queue.filter((t) => !newTxIds.has(t.id));

  return (
    <ThemedSafeAreaView>
      {renderHeader()}

      {/* Summary bar */}
      {queue.length > 0 && (
        <View
          className="px-6 py-3 flex-row items-center justify-between border-b"
          style={{ borderBottomColor: colors.border }}
        >
          <View className="flex-row items-center">
            {newTxIds.size > 0 && (
              <View
                className="mr-3 px-2.5 py-1 rounded-full flex-row items-center"
                style={{ backgroundColor: `${colors.accent}15` }}
              >
                <LucideZap color={colors.accent} size={11} />
                <ThemedText
                  className="text-[10px] font-bold ml-1"
                  style={{ color: colors.accent }}
                >
                  {newTxIds.size} new
                </ThemedText>
              </View>
            )}
            {oldPendingCount > 0 && (
              <View
                className="px-2.5 py-1 rounded-full flex-row items-center"
                style={{ backgroundColor: `${colors.warning}15` }}
              >
                <LucideInbox color={colors.warning} size={11} />
                <ThemedText
                  className="text-[10px] font-bold ml-1"
                  style={{ color: colors.warning }}
                >
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
                <ThemedText
                  className="text-xs font-bold"
                  style={{ color: colors.danger }}
                >
                  Delete All
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmAll}
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: `${colors.accent}20` }}
              >
                <ThemedText
                  className="text-xs font-bold"
                  style={{ color: colors.accent }}
                >
                  Confirm All
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          className="flex-1 px-6"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {queue.length === 0 ? (
            <View>
              {/* Same empty state as SmartInbox ("Review signals") so clearing
                  a deck and an empty scan land on an identical screen. */}
              <EmptyState
                icon={<LucideShieldCheck color={colors.muted} size={56} />}
                title="All quiet."
                subtitle={
                  newFoundCount > 0
                    ? `${newFoundCount} transaction${newFoundCount !== 1 ? "s" : ""} were auto-approved. New transactions land here as they arrive.`
                    : "No new transactions found since your last scan. New transactions land here as they arrive."
                }
                action={<PrimaryButton label="Back home" onPress={() => navigation.goBack()} tone="pulse" />}
              />

              <View
                style={{
                  marginTop: 40,
                  padding: 16,
                  borderRadius: 16,
                  backgroundColor: `${colors.accent}10`,
                  borderColor: `${colors.accent}30`,
                  borderWidth: 1,
                  flexDirection: "row",
                  alignItems: "flex-start",
                  width: "100%",
                }}
              >
                <LucideInfo
                  color={colors.accent}
                  size={16}
                  style={{ marginTop: 2, marginRight: 10 }}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText
                    className="font-bold text-xs mb-1"
                    style={{ color: colors.accent }}
                  >
                    Missing recent transactions?
                  </ThemedText>
                  <ThemedText
                    type="secondary"
                    style={{ fontSize: 11, lineHeight: 16 }}
                  >
                    Some banks send alerts via RCS (Internet Chat) instead of
                    standard SMS. Android prevents third-party apps from reading
                    RCS chats. To fix this, you can turn off RCS in your
                    messages app settings:
                    {"\n"}• Google Messages → Profile Icon → Messages settings →
                    RCS chats → Toggle off "Turn on RCS chats".
                  </ThemedText>
                </View>
              </View>
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
                  onEditPress={(txToEdit) =>
                    navigation.navigate("EditTransaction", {
                      transaction: txToEdit,
                    })
                  }
                  onTransactionUpdated={(updatedTx) => {
                    setQueue((prev) =>
                      prev.map((t) => (t.id === updatedTx.id ? updatedTx : t)),
                    );
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
