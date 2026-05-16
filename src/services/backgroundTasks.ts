import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { Platform, PermissionsAndroid } from 'react-native';
import { SyncService } from './sync';
import { useStore } from '../store/useStore';
import {
  getAccountScanRanges,
  updateAccountLastScanned,
  addTransaction,
  markSmsProcessed,
  getAllSmsHashes,
  getLastSyncTimeFromDb,
  setLastSyncTimeInDb,
  Transaction,
  getCurrentMonthSpend,
  getCategoryBreakdown,
  getSpendTrend,
  getBudgetUtilization,
  isRawSmsAlreadyExists,
  isSmsDuplicateTransaction,
} from './database';
import { SmsParserService, hashSms, matchSmsToAccount } from './smsParserService';
import { NotificationService } from './notifications';

const BACKGROUND_SYNC_TASK = 'BACKGROUND_CLOUD_SYNC';
const BACKGROUND_SMS_SCAN_TASK = 'BACKGROUND_SMS_AUTO_SCAN';
const BACKGROUND_ALERTS_TASK = 'BACKGROUND_BUDGET_ALERTS';

// Re-entrancy locks: prevent concurrent runs from duplicating work.
let _scanRunning = false;
let _syncRunning = false;

// Set to true while SmartScanScreen is running a foreground scan.
// The background SMS scan task respects this flag and skips entirely —
// there is no point running a background scan while the user is actively
// reviewing transactions, and doing so causes spurious notifications.
let _foregroundScanActive = false;

export const setForegroundScanActive = (active: boolean) => {
  _foregroundScanActive = active;
};

const BANK_KEYWORDS = [
  'debited', 'credited', 'spent', 'received', 'transferred', 'withdrawn',
  'paid', 'payment', 'purchase', 'txn', 'upi', 'vpa', 'neft', 'imps', 'atm', 'pos',
  'inr', 'rs.', 'rs ', '₹', 'transaction', 'a/c', 'acct', 'account', 'bal',
  'deducted', 'charged', 'sent', 'amount', 'amt', 'dr ', 'cr ', 'card',
];
const OTP_KEYWORDS = ['otp', 'password', 'verification code', 'one time', 'one-time'];
// Due reminders, promos, and balance alerts are sent to AI for classification — no EXCLUDE_KEYWORDS here.

// ─── 1. Cloud Sync Task ──────────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  // Re-entrancy lock — prevent stacking sync runs
  if (_syncRunning) return BackgroundFetch.BackgroundFetchResult.NoData;
  _syncRunning = true;

  try {
    const { preferences, googleUser } = useStore.getState();

    if (!googleUser || preferences.syncSchedule === 'none') {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // ── Time gate: only sync after the user's scheduled time ─────────────
    const now = new Date();
    const [schedHour, schedMin] = preferences.syncTime.split(':').map(Number);
    const scheduledTimeToday = new Date(now);
    scheduledTimeToday.setHours(schedHour, schedMin, 0, 0);

    if (now < scheduledTimeToday) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // ── Frequency gate: use shared logic in SyncService ──────────────────
    const isDue = await SyncService.shouldAutoSync();
    if (!isDue) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // ── Actually sync ────────────────────────────────────────────────────
    const result = await SyncService.syncToGoogleDrive();
    if (result) {
      // Persist in both SQLite (for background reliability) and Zustand (for UI)
      const nowIso = new Date().toISOString();
      await setLastSyncTimeInDb(nowIso);
      // Zustand updateLastSynced is already called inside syncToGoogleDrive()
    }
    return result
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.Failed;
  } catch (error) {
    console.error('[Background] Sync task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  } finally {
    _syncRunning = false;
  }
});

// ─── 2. Auto SMS Scan Task ───────────────────────────────────────────────────

export const performBackgroundSmsScan = async () => {
  // Skip if the user is actively running SmartScan in the foreground — no need
  // to scan in the background and send spurious notifications while they're reviewing.
  if (_foregroundScanActive) return BackgroundFetch.BackgroundFetchResult.NoData;
  // Prevent concurrent background runs from stacking notifications.
  if (_scanRunning) return BackgroundFetch.BackgroundFetchResult.NoData;
  _scanRunning = true;

  try {
    return await _doSmsScan();
  } finally {
    _scanRunning = false;
  }
};

const _doSmsScan = async (): Promise<BackgroundFetch.BackgroundFetchResult> => {
  const { preferences } = useStore.getState();

  if (!preferences.autoSmsScan || Platform.OS !== 'android') {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  const ranges = await getAccountScanRanges();
  const trackableRanges = ranges.filter(
    r => r.account.accountType === 'bank' || r.account.accountType === 'credit_card'
  );

  if (trackableRanges.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

  // Per-account cursor as base.
  // Matches foreground SmartScan logic exactly.
  const accountCursorMs = trackableRanges.reduce((min, r) => Math.min(min, r.fromMs), Date.now());
  const fetchFromMs = accountCursorMs;

  const rangeByAccountId = Object.fromEntries(trackableRanges.map(r => [r.account.id, r]));
  const accountsForMatch = trackableRanges.map(r => r.account);

  const BANK_AMOUNT_RE = /(?:(?:inr|rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?\s*(?:inr|rs\.?|₹))/i;
  const BANK_VERB_RE   = /\b(?:debited|credited|spent|withdrawn|received|transferred|paid|deducted|charged|sent)\b/i;

  let smsInbox: { body: string; date: number }[] = [];
  try {
    const SMSModule = require('react-native-get-sms-android');
    const SmsAndroid = SMSModule.default || SMSModule;

    // Check permission before querying SmsProvider to avoid SecurityException
    const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (!hasPermission) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    smsInbox = await new Promise<{ body: string; date: number }[]>((resolve) => {
      SmsAndroid.list(
        JSON.stringify({ box: 'inbox', maxCount: 50, indexFrom: 0, minDate: fetchFromMs }),
        () => resolve([]),
        (_: number, list: string) => {
          const parsed = JSON.parse(list) as any[];
          resolve(parsed.map((s: any) => ({ body: s.body as string, date: s.date as number })));
        }
      );
    });
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  if (smsInbox.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

  // Cheap pre-filter: skip OTPs and non-financial SMS.
  // Due reminders and promos are intentionally kept here — AI's isTransaction gate handles them.
  const filtered = smsInbox.filter(sms => {
    const lower = sms.body.toLowerCase();
    if (OTP_KEYWORDS.some((k: string) => lower.includes(k))) return false;
    return BANK_KEYWORDS.some((k: string) => lower.includes(k));
  });

  if (filtered.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

  // ── Fast gate: skip if no genuinely new SMS exist ─────────────────────────
  // Check every filtered SMS body against the hash dedup table BEFORE loading
  // AI context, merchant hints, or doing any parsing. If every SMS is already
  // processed, exit immediately — no context load, no notifications, no work.
  const savedHashes = await getAllSmsHashes();
  const hasNewSms = filtered.some(sms => !savedHashes.has(hashSms(sms.body)));
  if (!hasNewSms) return BackgroundFetch.BackgroundFetchResult.NoData;

  const { context, merchantHints } = await SmsParserService.getContext();
  let newTxCount = 0;
  let totalAmount = 0;
  let topMerchant = '';
  const scannedAccountIds = new Set<number>();

  let topCategory = '';

  for (const sms of filtered) {
    const matched = matchSmsToAccount(sms.body, accountsForMatch);

    // Range window check strictly enforces the per-account cursors.
    if (matched) {
      const range = rangeByAccountId[matched.id];
      if (!range || sms.date < range.fromMs) continue;
    } else {
      if (!BANK_AMOUNT_RE.test(sms.body) || !BANK_VERB_RE.test(sms.body)) continue;
      // Unmatched messages use the earliest global cursor to ensure we don't miss anything.
      if (sms.date < fetchFromMs) continue;
    }

    const result = await SmsParserService.parse(sms.body, [], merchantHints, context, sms.date);

    if (result.alreadySaved) {
      await markSmsProcessed(hashSms(sms.body));
      continue;
    }

    // AI determined this SMS is not a real transaction — mark and skip.
    if (!result.isTransaction) {
      await markSmsProcessed(hashSms(sms.body));
      continue;
    }

    // ── Multi-layer dedup (mirrors foreground SmartScan logic) ──────────
    // Layer 1: Exact rawSms body match (confirmed + unconfirmed)
    if (await isRawSmsAlreadyExists(sms.body)) {
      await markSmsProcessed(hashSms(sms.body));
      continue;
    }

    // Resolve account: explicit match > AI suggestion > first bank account
    const accountId = matched?.id ?? result.suggestedAccountId ?? accountsForMatch[0]?.id;

    if (result.transaction.amount && result.transaction.amount > 0 && accountId) {
      // Layer 2: Semantic dedup — same amount + type + account within ±2h
      if (await isSmsDuplicateTransaction(
        result.transaction.amount,
        (result.transaction.type as 'credit' | 'debit' | 'transfer') ?? 'debit',
        result.transaction.date ?? new Date(sms.date).toISOString(),
        accountId,
      )) {
        await markSmsProcessed(hashSms(sms.body));
        continue;
      }

      const txData = {
        ...result.transaction,
        accountId,
        isConfirmed: false,
        rawSms: sms.body,
        source: 'sms' as const,
      } as Omit<Transaction, 'id'>;

      await addTransaction(txData);
      newTxCount++;
      totalAmount += txData.amount ?? 0;
      if (!topMerchant && txData.merchant) topMerchant = txData.merchant;
      if (!topCategory && txData.category) topCategory = txData.category;
      scannedAccountIds.add(accountId);
    }
    // Always mark the hash so the same SMS isn't re-fetched on the next cycle.
    await markSmsProcessed(hashSms(sms.body));
  }

  const now = new Date().toISOString();
  await Promise.all([...scannedAccountIds].map(id => updateAccountLastScanned(id, now)));

  // Only notify when we actually found new transactions from new SMS.
  // No nudge/suggestion notifications — those are noise when the user
  // hasn't received a new bank SMS.
  if (newTxCount > 0) {
    if (newTxCount === 1) {
      await NotificationService.notifyNewTransaction(
        totalAmount,
        topMerchant || 'Unknown Merchant',
        topCategory || undefined,
      );
    } else {
      await NotificationService.notifyBatchTransactions(newTxCount, totalAmount, topMerchant);
    }
  }

  return newTxCount > 0
    ? BackgroundFetch.BackgroundFetchResult.NewData
    : BackgroundFetch.BackgroundFetchResult.NoData;
};

TaskManager.defineTask(BACKGROUND_SMS_SCAN_TASK, async () => {
  try {
    return await performBackgroundSmsScan();
  } catch (error) {
    console.error('[Background] SMS scan failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── 3. Budget Alerts + Weekly Digest Task ───────────────────────────────────

TaskManager.defineTask(BACKGROUND_ALERTS_TASK, async () => {
  try {
    const {
      preferences,
      updateBudgetNotificationHistory,
      resetBudgetNotificationHistory,
      setLastWeeklyDigestDate,
    } = useStore.getState();

    // ── 0. Reset notification history at the start of each new billing cycle ─
    // Without this, alerts at 80/90/100% only ever fire once — in the first month
    // they're triggered — and never again as the history record persists indefinitely.
    {
      const now = new Date();
      const salaryDay = preferences.salaryDay ?? 1;
      const cycleYear = now.getDate() >= salaryDay ? now.getFullYear() : (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
      const cycleMonth = now.getDate() >= salaryDay ? now.getMonth() : (now.getMonth() === 0 ? 11 : now.getMonth() - 1);
      const cycleStart = new Date(cycleYear, cycleMonth, salaryDay).toISOString().split('T')[0];
      if (preferences.lastBudgetCycleReset !== cycleStart) {
        resetBudgetNotificationHistory(cycleStart);
      }
    }

    // ── 1. Global monthly budget alert ───────────────────────────────────────
    if (preferences.budgetAlerts && preferences.monthlyBudget > 0) {
      const spent = await getCurrentMonthSpend(preferences.salaryDay);
      const pctValue = spent / preferences.monthlyBudget;
      const pct = Math.floor(pctValue * 10) * 10; // floor to 80 / 90 / 100

      // Key -1 is reserved for the global budget in the notification history.
      const lastPct = (preferences.budgetNotificationHistory as Record<string | number, number>)['-1'] || 0;

      if (pct >= 80 && pct > lastPct) {
        await NotificationService.notifyBudgetAlert(spent, preferences.monthlyBudget, preferences.currency);
        updateBudgetNotificationHistory(-1, pct);
      }
    }

    // ── 2. Per-category budget alerts ────────────────────────────────────────
    if (preferences.budgetAlerts) {
      const utilizations = await getBudgetUtilization(preferences.salaryDay);
      for (const u of utilizations) {
        const pct = Math.floor(u.percentage / 10) * 10;
        const lastPct = preferences.budgetNotificationHistory[u.budget.id] || 0;

        if (pct >= 80 && pct > lastPct) {
          if (pct >= 100) {
            await NotificationService.scheduleLocalNotification(
              `Budget Exceeded: ${u.budget.categoryName}`,
              `You've overspent your ${u.budget.categoryName} budget by ${preferences.currency}${(u.spent - u.budget.amount).toFixed(0)}.`,
              'budget',
              { screen: 'Budget' }
            );
          } else {
            await NotificationService.scheduleLocalNotification(
              `Budget Alert: ${u.budget.categoryName}`,
              `You've used ${u.percentage}% of your ${u.budget.categoryName} budget (${preferences.currency}${u.spent.toFixed(0)} / ${preferences.currency}${u.budget.amount.toFixed(0)}).`,
              'budget',
              { screen: 'Budget' }
            );
          }
          updateBudgetNotificationHistory(u.budget.id, pct);
        }
      }
    }

    // ── 3. Weekly Digest (Sunday only, once per day) ─────────────────────────
    if (preferences.weeklyDigest) {
      const now = new Date();
      if (now.getDay() === 0) { // Sunday
        const todayStr = now.toISOString().split('T')[0];
        if (preferences.lastWeeklyDigestDate !== todayStr) {
          const [trend, breakdown] = await Promise.all([
            getSpendTrend(7),
            getCategoryBreakdown(),
          ]);
          const totalSpent = trend.reduce((s, p) => s + p.total, 0);
          if (totalSpent > 0 && breakdown.length > 0) {
            await NotificationService.notifyWeeklyDigest(totalSpent, breakdown[0].category, preferences.currency);
            setLastWeeklyDigestDate(todayStr);
          }
        }
      }
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (error) {
    console.error('[Background] Alerts task failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── 4. Registration helper ──────────────────────────────────────────────────

const safeRegister = async (taskName: string, interval: number) => {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(taskName);
  await BackgroundFetch.registerTaskAsync(taskName, {
    minimumInterval: interval,
    stopOnTerminate: false,
    startOnBoot: true,
  });
};

const safeUnregister = async (taskName: string) => {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(taskName);
};

export const registerBackgroundTasks = async () => {
  try {
    const { preferences, googleUser } = useStore.getState();

    if (googleUser && preferences.syncSchedule !== 'none') {
      await safeRegister(BACKGROUND_SYNC_TASK, 15 * 60);
    } else {
      await safeUnregister(BACKGROUND_SYNC_TASK);
    }

    if (Platform.OS === 'android' && preferences.autoSmsScan) {
      await safeRegister(BACKGROUND_SMS_SCAN_TASK, 15 * 60);
    } else {
      await safeUnregister(BACKGROUND_SMS_SCAN_TASK);
    }

    if (preferences.budgetAlerts || preferences.weeklyDigest) {
      await safeRegister(BACKGROUND_ALERTS_TASK, 60 * 60);
    } else {
      await safeUnregister(BACKGROUND_ALERTS_TASK);
    }

  } catch (err) {
    // Background task registration failure is non-fatal — app continues without background tasks
  }
};
