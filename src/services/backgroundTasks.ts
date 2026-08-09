import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform, PermissionsAndroid } from 'react-native';
import { SyncService } from './sync';
import { useStore } from '../store/useStore';
import {
  initDatabase,
  getAccountScanRanges,
  updateAccountLastScanned,
  addTransaction,
  markSmsProcessed,
  getProcessedHashesFor,
  isSmsAlreadyProcessed,
  pruneOldSmsHashes,
  pruneStoredSmsBodies,
  getLastSyncTimeFromDb,
  setLastSyncTimeInDb,
  logSyncAttempt,
  Transaction,
  getCurrentMonthSpend,
  getCategoryBreakdown,
  getSpendTrend,
  isRawSmsAlreadyExists,
  isSmsDuplicateTransaction,
  getSmsTransactionsPendingEnrichment,
  getTransactionById,
  updateTransaction,
  getSalaryCycleWindowAsync,
  getSalaryDates,
  addSalaryDate,
  setPendingSalaryDate,
  clearPendingSalaryDate,
  upsertCardStatement,
  applyCardPayment,
  getOpenStatements,
  getAccounts,
} from './database';
import { toLocalDateKey, cycleAnchorFrom } from './salaryCycle';
// Shared date helpers — a service must not reach into a components folder.
import { nextOccurrenceOfDay, daysUntil, daysBetween } from '../utils/dateUtils';
import { isScanCandidate } from '../utils/smsFilter';
import { runCategoryBudgetAlerts } from './budgetAlerts';
import { SmsParserService, hashSms, matchSmsToAccount, smsReferencesAccountNumber, parseCardStatementSms } from './smsParserService';
import { NotificationService } from './notifications';
import { AIModelManager } from './aiModelManager';

const BACKGROUND_SYNC_TASK = 'BACKGROUND_CLOUD_SYNC';
const BACKGROUND_SMS_SCAN_TASK = 'BACKGROUND_SMS_AUTO_SCAN';
const BACKGROUND_ALERTS_TASK = 'BACKGROUND_BUDGET_ALERTS';

// Re-entrancy locks: prevent concurrent runs from duplicating work.
let _scanRunning = false;
let _syncRunning = false;
// Real-time incoming-SMS handling is serialised by _realtimeChain (below)
// rather than a boolean lock, so a busy handler defers the next SMS instead of
// discarding it.
// Deferred AI enrichment has its own lock too — it is reachable from both the
// periodic scan task and the Smart Inbox screen gaining focus.
let _enrichRunning = false;
// Set by _doSmsScan when it takes a model hold, cleared by performBackgroundSmsScan
// (its only caller) when it drops that hold. Keeps the acquire/release balanced
// even though the scan can return early before ever acquiring.
let _scanHoldsModel = false;

// Set to true while SmartScanScreen is running a foreground scan.
// The background SMS scan task respects this flag and skips entirely —
// there is no point running a background scan while the user is actively
// reviewing transactions, and doing so causes spurious notifications.
let _foregroundScanActive = false;

export const setForegroundScanActive = (active: boolean) => {
  _foregroundScanActive = active;
};

// Zustand persist rehydrates from SecureStore asynchronously. Background/headless
// JS contexts start cold, so reading preferences via getState() before hydration
// completes returns DEFAULT_PREFERENCES — where autoSmsScan is false — and the
// task silently drops the SMS. Every background entry point must wait for
// hydration before consulting preferences.
const waitForHydration = (timeoutMs = 10000): Promise<void> =>
  new Promise((resolve) => {
    if (useStore.getState().hasHydrated) {
      resolve();
      return;
    }
    const unsub = useStore.subscribe((state) => {
      if (state.hasHydrated) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      unsub();
      resolve();
    }, timeoutMs);
  });

// Keyword lists now live in src/utils/smsFilter.ts so the foreground SmartScan
// and this background scan share one definition of "worth parsing".
// Due reminders, promos, and balance alerts still reach the AI for classification.

// SmsProvider reads are capped per call, and the provider orders newest-first —
// so any single capped read drops the oldest messages in the window rather than
// failing loudly. These bound the paging below: PAGE_SIZE per query, and a hard
// ceiling so a first-ever scan over a huge inbox can't run the task out of time.
const SMS_PAGE_SIZE = 250;
const SMS_MAX_TOTAL = 5000;

/**
 * Read every SMS in the inbox from `minDate` onwards, paging through SmsProvider
 * until it runs dry. Returns newest-first, the same order a single call gave.
 */
const listAllSms = async (
  SmsAndroid: any,
  minDate: number,
): Promise<{ body: string; date: number }[]> => {
  const all: { body: string; date: number }[] = [];

  for (let indexFrom = 0; indexFrom < SMS_MAX_TOTAL; indexFrom += SMS_PAGE_SIZE) {
    const page = await new Promise<{ body: string; date: number }[]>((resolve) => {
      SmsAndroid.list(
        JSON.stringify({ box: 'inbox', maxCount: SMS_PAGE_SIZE, indexFrom, minDate }),
        () => resolve([]),
        (_: number, list: string) => {
          try {
            const parsed = JSON.parse(list) as any[];
            resolve(parsed.map((s: any) => ({ body: s.body as string, date: s.date as number })));
          } catch {
            resolve([]);
          }
        },
      );
    });

    all.push(...page);
    // A short page means the provider has no more rows in this window.
    if (page.length < SMS_PAGE_SIZE) break;
  }

  if (all.length >= SMS_MAX_TOTAL) {
    console.warn(`[SmsScan] Hit the ${SMS_MAX_TOTAL} SMS ceiling — window may be truncated.`);
  }
  return all;
};

// ─── 1. Cloud Sync Task ──────────────────────────────────────────────────────

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  // Re-entrancy lock — prevent stacking sync runs
  if (_syncRunning) return BackgroundFetch.BackgroundFetchResult.NoData;
  _syncRunning = true;

  try {
    await initDatabase();
    await waitForHydration();
    const { preferences, googleUser } = useStore.getState();

    if (!googleUser || preferences.syncSchedule === 'none') {
      await logSyncAttempt({
        timestamp: new Date().toISOString(),
        source: 'background-fetch',
        outcome: 'skipped',
        reason: !googleUser ? 'Not signed in to Google' : 'Sync schedule set to none',
      }).catch(() => {});
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // ── Time gate: only sync after the user's scheduled time ─────────────
    const now = new Date();
    const [schedHour, schedMin] = preferences.syncTime.split(':').map(Number);
    const scheduledTimeToday = new Date(now);
    scheduledTimeToday.setHours(schedHour, schedMin, 0, 0);

    let lastScheduledTime: Date;
    if (now.getTime() >= scheduledTimeToday.getTime()) {
      lastScheduledTime = scheduledTimeToday;
    } else {
      lastScheduledTime = new Date(scheduledTimeToday.getTime() - 24 * 60 * 60 * 1000);
    }

    // Retrieve the last successful sync time from DB
    const lastSyncIso = await getLastSyncTimeFromDb();
    if (lastSyncIso) {
      const lastSyncTime = new Date(lastSyncIso).getTime();

      // If schedule is weekly, check if at least 6 days have passed since last sync
      if (preferences.syncSchedule === 'weekly') {
        const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
        if (now.getTime() - lastSyncTime < sixDaysMs) {
          await logSyncAttempt({ timestamp: new Date().toISOString(), source: 'background-fetch', outcome: 'skipped', reason: 'Weekly schedule not yet due' }).catch(() => {});
          return BackgroundFetch.BackgroundFetchResult.NoData;
        }
      }

      // Check if we already synced after the most recent scheduled time
      if (lastSyncTime >= lastScheduledTime.getTime()) {
        await logSyncAttempt({ timestamp: new Date().toISOString(), source: 'background-fetch', outcome: 'skipped', reason: 'Already synced after last scheduled time' }).catch(() => {});
        return BackgroundFetch.BackgroundFetchResult.NoData;
      }
    }

    // ── Actually sync ────────────────────────────────────────────────────
    const result = await SyncService.syncToGoogleDrive();
    if (result) {
      // Persist in both SQLite (for background reliability) and Zustand (for UI)
      const nowIso = new Date().toISOString();
      await setLastSyncTimeInDb(nowIso);
      // Zustand updateLastSynced is already called inside syncToGoogleDrive()
      await logSyncAttempt({ timestamp: nowIso, source: 'background-fetch', outcome: 'success' }).catch(() => {});

      // Reschedule the exact silent alarm for tomorrow
      await NotificationService.scheduleSyncTask(preferences.syncTime).catch(() => {});
    } else {
      await logSyncAttempt({ timestamp: new Date().toISOString(), source: 'background-fetch', outcome: 'failure', reason: 'syncToGoogleDrive returned false' }).catch(() => {});
    }
    return result
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.Failed;
  } catch (error) {
    console.error('[Background] Sync task failed:', error);
    await logSyncAttempt({
      timestamp: new Date().toISOString(),
      source: 'background-fetch',
      outcome: 'failure',
      reason: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    return BackgroundFetch.BackgroundFetchResult.Failed;
  } finally {
    _syncRunning = false;
  }
});

// ─── Background Notification Task for Exact Alarm Sync ──────────────────────
const BACKGROUND_NOTIFICATION_TASK = 'BACKGROUND_NOTIFICATION_TASK';

TaskManager.defineTask(BACKGROUND_NOTIFICATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[BackgroundNotification] Task error:', error);
    return;
  }

  const payload = (data as any).notification?.request?.content?.data;
  console.log('[BackgroundNotification] Received background notification with data:', payload);

  if (payload?.triggerSync) {
    try {
      await initDatabase();
      await waitForHydration();
      const { preferences, googleUser } = useStore.getState();
      if (googleUser && preferences.syncSchedule !== 'none') {
        const lastSyncIso = await getLastSyncTimeFromDb();
        let shouldSync = true;
        if (lastSyncIso) {
          const lastSyncTime = new Date(lastSyncIso).getTime();
          const oneHourAgo = Date.now() - 60 * 60 * 1000;
          if (lastSyncTime >= oneHourAgo) {
            shouldSync = false;
          }
        }

        if (shouldSync) {
          console.log('[BackgroundNotification] Syncing to Google Drive...');
          const result = await SyncService.syncToGoogleDrive();
          const nowIso = new Date().toISOString();
          if (result) {
            await setLastSyncTimeInDb(nowIso);
            await logSyncAttempt({ timestamp: nowIso, source: 'notification', outcome: 'success' }).catch(() => {});
          } else {
            await logSyncAttempt({ timestamp: nowIso, source: 'notification', outcome: 'failure', reason: 'syncToGoogleDrive returned false' }).catch(() => {});
          }
        } else {
          await logSyncAttempt({ timestamp: new Date().toISOString(), source: 'notification', outcome: 'skipped', reason: 'Synced within the last hour' }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[BackgroundNotification] Google Drive sync failed:', e);
      await logSyncAttempt({
        timestamp: new Date().toISOString(),
        source: 'notification',
        outcome: 'failure',
        reason: e instanceof Error ? e.message : String(e),
      }).catch(() => {});
    }
  }

  if (payload?.rescheduleSync && payload?.syncTime) {
    try {
      await NotificationService.scheduleSyncTask(payload.syncTime as string);
    } catch (e) {
      console.error('[BackgroundNotification] Failed to reschedule sync task:', e);
    }
  }
});

// ─── Real-time Incoming SMS processor ────────────────────────────────────────

// Serialises real-time SMS handling. This used to be a plain boolean lock that
// returned early when busy — so two SMS arriving in the same second (a debit
// alert plus its balance update, or two cards charged together) meant the second
// was discarded outright: no transaction, no notification, and no hash written,
// leaving it to be picked up minutes later by the periodic scan if at all.
// Chaining instead keeps the "one at a time" guarantee without dropping work.
let _realtimeChain: Promise<void> = Promise.resolve();

export const processIncomingSms = (body: string, date: number): Promise<void> => {
  const run = _realtimeChain.then(() => _doProcessIncomingSms(body, date));
  // Keep the chain alive even if one SMS throws, or every later SMS is skipped.
  _realtimeChain = run.catch(() => {});
  return run;
};

const _doProcessIncomingSms = async (body: string, date: number) => {
  if (_foregroundScanActive) {
    console.log('[BackgroundSms] Skipped: foreground SmartScan is active.');
    return;
  }
  console.log('[BackgroundSms] Processing incoming SMS...');
  try {
    await waitForHydration();
    const { preferences } = useStore.getState();
    if (!preferences.autoSmsScan) {
      console.log('[BackgroundSms] Dropped: autoSmsScan preference is off.');
      return;
    }

    const ranges = await getAccountScanRanges();
    const trackableRanges = ranges.filter(
      r => r.account.accountType === 'bank' || r.account.accountType === 'credit_card'
    );
    if (trackableRanges.length === 0) {
      console.log('[BackgroundSms] Dropped: no bank or credit-card accounts configured.');
      return;
    }

    const accountsForMatch = trackableRanges.map(r => r.account);
    const matched = matchSmsToAccount(body, accountsForMatch);
    if (!matched) {
      console.log('[BackgroundSms] Dropped: SMS matched none of the configured accounts.');
      return;
    }
    // Strict-match guard: an account with registered last-4 normally only accepts
    // SMS that match those digits (prevents sibling-account leakage). But when the
    // SMS names NO account number at all (e.g. "Your A/c has been debited towards
    // Airtel … - Axis Bank"), an unambiguous bank-name match is the best signal —
    // accept it rather than drop a real transaction.
    if (matched.last4Digits && matched.matchType !== 'last4' && smsReferencesAccountNumber(body)) {
      console.log(`[BackgroundSms] Dropped: SMS names a different account than ${matched.last4Digits}.`);
      return;
    }

    // Check raw SMS hash or semantic duplicate first
    const hashed = hashSms(body);
    // Single indexed lookup (sms_hashes.hash is UNIQUE). This used to load the
    // entire table into a Set just to test one value.
    if (await isSmsAlreadyProcessed(hashed)) {
      console.log('[BackgroundSms] Dropped: hash already processed (periodic scan likely won the race).');
      return;
    }

    if (await isRawSmsAlreadyExists(body)) {
      console.log('[BackgroundSms] Dropped: identical rawSms already stored.');
      await markSmsProcessed(hashed);
      return;
    }

    const { context, merchantHints } = await SmsParserService.getContext();

    // Real-time path is REGEX-ONLY (preferRegexOnly) — it must never load the
    // ~380 MB model in a headless context, which OOMs/times out and drops the SMS.
    // Regex parses standard bank SMS reliably and fast; the AI enriches later
    // during the periodic/foreground scan. AI is still used here if already warm.
    const result = await SmsParserService.parse(body, [], merchantHints, context, date, {
      preferRegexOnly: true,
    });
    if (result.alreadySaved || !result.isTransaction) {
      // Not a transaction — but it may still be a card bill worth recording.
      await captureCardStatement(body);
      // Only retire the SMS permanently if the AI actually made this call.
      // This path is regex-only by design, and regex has no real notion of
      // "isTransaction" for unusual formats — marking the hash here meant a
      // single regex miss silently retired the SMS forever, because both the
      // periodic scan and enrichPendingSmsWithAI skip anything already hashed.
      // Leaving it unmarked costs one re-parse per cycle and lets the model
      // reach it later, which is the whole point of the deferred pass.
      if (AIModelManager.isModelLoaded()) {
        await markSmsProcessed(hashed);
      } else {
        console.log('[BackgroundSms] Regex found no transaction; leaving for AI enrichment.');
      }
      return;
    }

    const accountId = matched.id ?? result.suggestedAccountId ?? accountsForMatch[0]?.id;
    if (result.transaction.amount && result.transaction.amount > 0 && accountId) {
      if (await isSmsDuplicateTransaction(
        result.transaction.amount,
        (result.transaction.type as 'credit' | 'debit' | 'transfer') ?? 'debit',
        result.transaction.date ?? new Date(date).toISOString(),
        accountId,
      )) {
        console.log('[BackgroundSms] Dropped: semantic duplicate of a recent transaction.');
        await markSmsProcessed(hashed);
        return;
      }

      const txData = {
        ...result.transaction,
        accountId,
        isConfirmed: false,
        rawSms: body,
        source: 'sms' as const,
      } as Omit<Transaction, 'id'>;

      await addTransaction(txData);
      await handleSalaryCredit(txData);
      await applyCardPaymentFromTx(txData);
      const nowStr = new Date().toISOString();
      await updateAccountLastScanned(accountId, nowStr);

      // Notify
      console.log(`[BackgroundSms] Saved tx ${txData.amount} @ ${txData.merchant} — notifying.`);
      await NotificationService.notifyNewTransaction(
        txData.amount ?? 0,
        txData.merchant || 'Unknown Merchant',
        txData.category || undefined
      );
      await markSmsProcessed(hashed);
      return;
    }

    // Regex called it a transaction but produced no usable amount (or no account
    // could be resolved). Retiring the hash here is the same trap as above: the
    // SMS is real, we simply failed to read it, and marking it processed would
    // hide it from the AI pass forever. Leave it queued unless the AI already had
    // its say.
    if (AIModelManager.isModelLoaded()) {
      await markSmsProcessed(hashed);
    } else {
      console.log('[BackgroundSms] No amount parsed by regex; leaving for AI enrichment.');
    }
  } catch (error) {
    console.error('[BackgroundSms] Failed to process incoming SMS:', error);
  } finally {
    // Free any model context we may have used, to keep the headless task's RAM low.
    // This path never acquires a hold (it is regex-only and merely borrows an
    // already-warm context), so releaseModel() is correct here — and it no-ops
    // while a scan or enrichment batch still holds the model.
    AIModelManager.releaseModel().catch(() => {});
  }
};

// ─── Deferred AI enrichment ──────────────────────────────────────────────────
// Real-time SMS are parsed regex-only for reliability (see processIncomingSms).
// This pass re-parses those saved rawSms bodies with the on-device AI when the
// model can safely load (during the periodic scan or a foreground trigger), and
// upgrades the still-unconfirmed transaction's semantic fields. It NEVER runs in
// the per-SMS headless task. Returns the number of transactions enriched.
export const enrichPendingSmsWithAI = async (): Promise<number> => {
  if (_foregroundScanActive) return 0; // don't contend for the model with a live scan
  // The periodic task and a Smart Inbox focus can both call this, and focus fires
  // again on every navigate-back — without this lock two runs share one batch and
  // the first to finish tears down the model mid-inference for the other.
  if (_enrichRunning) return 0;
  _enrichRunning = true;
  try {
    return await _doEnrichPendingSms();
  } finally {
    _enrichRunning = false;
  }
};

const _doEnrichPendingSms = async (): Promise<number> => {
  await waitForHydration();
  const { preferences } = useStore.getState();
  if (!preferences.autoSmsScan) return 0;
  if (!AIModelManager.isDeviceCompatible()) return 0;

  const pending = await getSmsTransactionsPendingEnrichment(20);
  if (pending.length === 0) return 0;

  // Hold the model for the whole batch so no other caller can unload it mid-run.
  // If it can't load, leave everything queued (aiEnriched stays 0) and retry on
  // the next cycle — never mark as done.
  if (!(await AIModelManager.acquireModel())) return 0;

  const { context, merchantHints } = await SmsParserService.getContext();
  let enriched = 0;

  try {
    for (const tx of pending) {
      if (!tx.rawSms) continue;
      try {
        const result = await SmsParserService.parse(
          tx.rawSms, [], merchantHints, context, new Date(tx.date).getTime(),
          { skipProcessedCheck: true },
        );
        if (!result.isTransaction) {
          // The AI disagrees with regex about this being a transaction. The row
          // is already in the inbox for the user to confirm or dismiss, so keep
          // it — just stop re-parsing it forever.
          await updateTransaction(tx.id, { aiEnriched: true });
          continue;
        }

        // Re-check it's still unconfirmed — the user may have reviewed it
        // meanwhile; never overwrite a confirmed/edited transaction.
        const fresh = await getTransactionById(tx.id);
        if (!fresh || fresh.isConfirmed) continue;

        const t = result.transaction;
        await updateTransaction(tx.id, {
          type: (t.type as Transaction['type']) ?? tx.type,
          merchant: t.merchant || tx.merchant,
          category: t.category || tx.category,
          // Keep regex's structural fields (amount, date, account) — only the
          // semantic fields benefit from AI. An AI-reviewed row is worth at least
          // 'medium', so don't let it read as low-confidence in the inbox.
          confidence: result.confidence === 'low' ? 'medium' : result.confidence,
          aiEnriched: true,
        });
        enriched++;
      } catch (e) {
        console.warn('[Enrich] Failed to enrich tx', tx.id, e);
        // leave aiEnriched=0 → retried next cycle
      }
    }
  } finally {
    // Not `immediate`: this runs in the foreground too, so leave the context warm
    // for the idle timer rather than forcing the next caller to reload ~380 MB.
    AIModelManager.releaseHold().catch(() => {});
  }

  console.log(`[Enrich] AI-enriched ${enriched}/${pending.length} pending SMS transactions.`);
  return enriched;
};


/**
 * Days since the last recorded salary below which a matching credit is treated
 * as a bonus/arrear rather than the next payday. Real monthly gaps run 28–31,
 * so 25 leaves room for an early payment without letting mid-month credits in.
 */
const AUTO_SALARY_MIN_GAP_DAYS = 25;

/**
 * React to a newly-saved credit that matches the user's salary category.
 *
 *  - Clear-cut (>= 25 days since the last recorded salary): record it and let the
 *    budget cycle reset automatically, then notify — a gauge that moves on its
 *    own with no explanation is alarming.
 *  - Ambiguous (sooner than that): store it as a suggestion for the user to
 *    confirm in Budget settings. Deliberately not discarded, so a genuinely
 *    early salary is never lost, it just needs a tap.
 */
export const handleSalaryCredit = async (tx: {
  type?: string;
  category?: string;
  date?: string;
  isTransfer?: boolean;
}) => {
  try {
    if (tx.type !== 'credit' || tx.isTransfer || !tx.date) return;

    const { preferences } = useStore.getState();
    const target = (preferences.salaryCategory ?? 'Salary').trim().toLowerCase();
    if (!target) return;
    if ((tx.category ?? '').trim().toLowerCase() !== target) return;

    const when = new Date(tx.date);
    if (Number.isNaN(when.getTime())) return;

    const recorded = await getSalaryDates(1);
    const last = recorded[0] ? new Date(recorded[0].occurredAt) : null;
    const gapDays = last
      ? Math.abs(when.getTime() - last.getTime()) / 86_400_000
      : Number.POSITIVE_INFINITY;

    if (gapDays >= AUTO_SALARY_MIN_GAP_DAYS) {
      await addSalaryDate(when.toISOString(), 'detected');
      await clearPendingSalaryDate();
      await NotificationService.notifySalaryCycleReset(when.toISOString());
      console.log('[SalaryDate] Auto-started new cycle at', when.toISOString());
      return;
    }

    await setPendingSalaryDate(when.toISOString());
    console.log('[SalaryDate] Suggested (ambiguous, gap', Math.round(gapDays), 'days)');
  } catch (e) {
    console.warn('[SalaryDate] Failed to handle salary credit:', e);
  }
};


// ─── Credit card statements ──────────────────────────────────────────────────

/**
 * Mine a bill/reminder SMS for statement data. These are not transactions, so
 * they never reach the normal parse path — but they carry total due, minimum due
 * and the due date, which is the richest card data a bank sends.
 *
 * Safe to call on every SMS: non-statement messages return null, and repeated
 * reminders for the same bill collapse onto one row (see upsertCardStatement).
 */
export const captureCardStatement = async (body: string): Promise<boolean> => {
  try {
    const parsed = parseCardStatementSms(body);
    if (!parsed) return false;

    const accounts = await getAccounts();
    const cards = accounts.filter((a) => a.accountType === 'credit_card');
    if (cards.length === 0) return false;

    // Prefer an explicit last-4 match; fall back to the only card on file.
    const card =
      (parsed.last4 && cards.find((c) => c.last4Digits === parsed.last4)) ??
      (cards.length === 1 ? cards[0] : null);
    if (!card) {
      console.log('[CardStatement] Could not match SMS to a card; skipping.');
      return false;
    }

    await upsertCardStatement({
      accountId: card.id,
      // Local midnight of the due date — the key repeated reminders dedup on.
      dueDate: parsed.dueDate.toISOString(),
      totalDue: parsed.totalDue,
      minimumDue: parsed.minimumDue,
      source: 'sms',
      rawSms: body,
    });
    console.log('[CardStatement] Captured bill for', card.name, parsed.totalDue);
    return true;
  } catch (e) {
    console.warn('[CardStatement] Failed to capture statement:', e);
    return false;
  }
};

/**
 * A payment landing on a card reduces its open statements, oldest first — the
 * same waterfall banks use, so partial payments leave the bill open with a
 * smaller remaining rather than flipping it to paid.
 */
export const applyCardPaymentFromTx = async (tx: {
  type?: string;
  amount?: number;
  accountId?: number;
  toAccountId?: number;
}) => {
  try {
    const accounts = await getAccounts();
    const isCard = (id?: number) =>
      !!id && accounts.some((a) => a.id === id && a.accountType === 'credit_card');

    // Money reaching a card: a credit on the card, or a transfer into it.
    const cardId =
      tx.type === 'credit' && isCard(tx.accountId) ? tx.accountId
        : tx.type === 'transfer' && isCard(tx.toAccountId) ? tx.toAccountId
          : null;
    if (!cardId || !(tx.amount && tx.amount > 0)) return;

    const applied = await applyCardPayment(cardId, tx.amount);
    if (applied > 0) console.log('[CardStatement] Applied payment', applied, 'to card', cardId);
  } catch (e) {
    console.warn('[CardStatement] Failed to apply payment:', e);
  }
};



/** Days before the due date a card reminder fires. */
const CARD_REMINDER_DAYS = [7, 3, 1, 0];

/**
 * Remind about open card statements approaching their due date.
 *
 * Only unpaid statements are considered, so a bill settled early goes quiet
 * immediately — the repeated bank reminders keep arriving, but ours stop.
 * History is keyed per statement+threshold so each stage fires once.
 */
export const runCardDueReminders = async () => {
  try {
    await waitForHydration();
    const { preferences } = useStore.getState();
    if (!preferences.recurringAlerts) return;

    const [open, accounts] = await Promise.all([getOpenStatements(), getAccounts()]);
    if (open.length === 0) return;

    const now = new Date();
    const history = (preferences.budgetNotificationHistory ?? {}) as Record<string, number>;
    const { updateBudgetNotificationHistory } = useStore.getState();

    for (const st of open) {
      const remaining = Math.max(st.totalDue - st.paidAmount, 0);
      if (remaining <= 0) continue;

      // Calendar days on both sides — a statement due later today must read as
      // 0 (due today), not 1, or the "due today" reminder never fires.
      const daysLeft = daysUntil(st.dueDate, now);
      if (daysLeft < 0 || daysLeft > 7) continue;

      // Fire at the tightest threshold reached, once each.
      const threshold = CARD_REMINDER_DAYS.find((d) => daysLeft <= d);
      if (threshold === undefined) continue;

      // Reuse the notification-history map, namespaced so it cannot collide
      // with budget ids (which are positive integers).
      const key = -(1000 + st.id);
      if (history[String(key)] === threshold) continue;

      const card = accounts.find((a) => a.id === st.accountId);
      if (!card) continue;

      await NotificationService.notifyCardDue(
        card.name, remaining, daysLeft, preferences.currency, st.minimumDue,
      );
      updateBudgetNotificationHistory(key, threshold);
    }
  } catch (e) {
    console.warn('[CardDue] Reminder pass failed:', e);
  }
};



/** Utilization at or above this is worth acting on before the statement closes. */
const HIGH_UTILIZATION_PCT = 30;
/** How many days before the statement date to nudge. */
const UTILIZATION_NUDGE_DAYS = 3;

/**
 * Nudge before the statement closes when utilization is high.
 *
 * Bureaus read utilization from the statement-date snapshot, so this is the only
 * window where paying down changes the reported number. After the statement is
 * generated it is too late for that month — which is why this fires on
 * statementDay, not the due date.
 */
export const runUtilizationNudges = async () => {
  try {
    await waitForHydration();
    const { preferences } = useStore.getState();
    if (!preferences.recurringAlerts) return;

    const accounts = await getAccounts();
    const cards = accounts.filter(
      (a) => a.accountType === 'credit_card' && a.statementDay && (a.creditLimit ?? 0) > 0,
    );
    if (cards.length === 0) return;

    const now = new Date();
    const history = (preferences.budgetNotificationHistory ?? {}) as Record<string, number>;
    const { updateBudgetNotificationHistory } = useStore.getState();

    for (const card of cards) {
      const outstanding = Math.max(card.balance, 0);
      const limit = card.creditLimit as number;
      const pct = (outstanding / limit) * 100;
      if (pct < HIGH_UTILIZATION_PCT) continue;

      const statementDate = nextOccurrenceOfDay(card.statementDay as number, now);
      const daysToStatement = daysBetween(statementDate, now);
      if (daysToStatement < 0 || daysToStatement > UTILIZATION_NUDGE_DAYS) continue;

      // Once per card per statement month.
      const key = -(2000 + card.id);
      const stamp = statementDate.getMonth() + 1;
      if (history[String(key)] === stamp) continue;

      // What it would take to land just under the healthy threshold.
      const payDown = Math.max(outstanding - limit * (HIGH_UTILIZATION_PCT / 100), 0);

      await NotificationService.notifyHighUtilization(
        card.name, pct, daysToStatement, payDown, preferences.currency,
      );
      updateBudgetNotificationHistory(key, stamp);
    }
  } catch (e) {
    console.warn('[Utilization] Nudge pass failed:', e);
  }
};


// ─── 2. Auto SMS Scan Task ───────────────────────────────────────────────────

export const performBackgroundSmsScan = async (silent = false) => {
  // Skip if the user is actively running SmartScan in the foreground — no need
  // to scan in the background and send spurious notifications while they're reviewing.
  if (_foregroundScanActive) return BackgroundFetch.BackgroundFetchResult.NoData;
  // Prevent concurrent background runs from stacking notifications.
  if (_scanRunning) return BackgroundFetch.BackgroundFetchResult.NoData;
  _scanRunning = true;

  console.log('[BackgroundSmsScan] Starting background fetch auto scan...');

  try {
    const result = await _doSmsScan(silent);
    console.log('[BackgroundSmsScan] Background scan complete with result:', result);
    return result;
  } finally {
    _scanRunning = false;
    // Drop the hold _doSmsScan took (if any) to free RAM after a background scan.
    // `immediate` because this is the headless path, where RAM pressure kills the
    // task — but it still won't unload while another caller holds the model.
    if (_scanHoldsModel) {
      console.log('[BackgroundSmsScan] Releasing AI model context.');
      _scanHoldsModel = false;
      AIModelManager.releaseHold(true).catch(() => {});
    }
  }
};

const _doSmsScan = async (silent = false): Promise<BackgroundFetch.BackgroundFetchResult> => {
  await waitForHydration();
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

  let smsInbox: { body: string; date: number }[] = [];
  try {
    const SMSModule = require('react-native-get-sms-android');
    const SmsAndroid = SMSModule.default || SMSModule;

    // Check permission before querying SmsProvider to avoid SecurityException
    const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (!hasPermission) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // SmsProvider returns newest-first, so a single capped read silently drops the
    // OLDEST messages in the window. With a month-wide cursor and a busy inbox the
    // 250-row cap was routinely hit, which is why some bank SMS never showed up in
    // a scan. Page through instead so the whole window is always covered.
    smsInbox = await listAllSms(SmsAndroid, fetchFromMs);
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  if (smsInbox.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

  // Cheap pre-filter: skip OTPs and non-financial SMS.
  // Due reminders and promos are intentionally kept here — AI's isTransaction gate handles them.
  const filtered = smsInbox.filter(sms => isScanCandidate(sms.body));

  if (filtered.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

  // ── Fast gate: skip if no genuinely new SMS exist ─────────────────────────
  // Check every filtered SMS body against the hash dedup table BEFORE loading
  // AI context, merchant hints, or doing any parsing. If every SMS is already
  // processed, exit immediately — no context load, no notifications, no work.
  const batchHashes = filtered.map((sms) => hashSms(sms.body));
  const savedHashes = await getProcessedHashesFor(batchHashes);
  const hasNewSms = batchHashes.some((h) => !savedHashes.has(h));
  if (!hasNewSms) return BackgroundFetch.BackgroundFetchResult.NoData;

  const { context, merchantHints } = await SmsParserService.getContext();

  // Try to hold the on-device AI model for better parsing accuracy. If it fails
  // (e.g. not enough background RAM), regex fallback is used. The hold keeps a
  // concurrently-arriving SMS from unloading the context mid-scan; it is dropped
  // by performBackgroundSmsScan's finally, which is the only caller.
  _scanHoldsModel = await AIModelManager.acquireModel().catch(() => false);

  let newTxCount = 0;
  let totalAmount = 0;
  let topMerchant = '';
  const scannedAccountIds = new Set<number>();

  let topCategory = '';

  for (const sms of filtered) {
    const matched = matchSmsToAccount(sms.body, accountsForMatch);

    // 1. If it didn't match any account in Echo Spend, ignore it
    if (!matched) continue;

    // 2. If the matched account has registered last 2-4 digits, require a strict
    // last-digits match — UNLESS the SMS names no account number at all, in which
    // case an unambiguous bank-name match is the best (and only) signal. This lets
    // account-less bank SMS ("…debited towards Airtel … - Axis Bank") through while
    // still blocking transactions that name a *different* account at the same bank.
    if (matched.last4Digits && matched.matchType !== 'last4' && smsReferencesAccountNumber(sms.body)) continue;

    // Range window check strictly enforces the per-account cursors.
    const range = rangeByAccountId[matched.id];
    if (!range || sms.date < range.fromMs) continue;

    const result = await SmsParserService.parse(sms.body, [], merchantHints, context, sms.date);

    if (result.alreadySaved) {
      await markSmsProcessed(hashSms(sms.body));
      continue;
    }

    // AI determined this SMS is not a real transaction — mark and skip.
    if (!result.isTransaction) {
      // Not a transaction — but it may still be a card bill worth recording.
      await captureCardStatement(sms.body);
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
        // AI parsed this only if the model was actually loaded for the scan;
        // otherwise it was regex and stays queued for later enrichment.
        aiEnriched: AIModelManager.isModelLoaded(),
      } as Omit<Transaction, 'id'>;

      await addTransaction(txData);
      await handleSalaryCredit(txData);
      await applyCardPaymentFromTx(txData);
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
  if (newTxCount > 0 && !silent) {
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
    await initDatabase();
    // Housekeeping: bounded, cheap, and only in the periodic task.
    await pruneOldSmsHashes().catch(() => {});
    await pruneStoredSmsBodies().catch(() => {});
    const result = await performBackgroundSmsScan();
    // Upgrade any regex-only real-time transactions with the on-device AI now
    // that we're in the (heavier-budget) periodic task where the model can load.
    await enrichPendingSmsWithAI().catch(() => {});
    return result;
  } catch (error) {
    console.error('[Background] SMS scan failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── 3. Budget Alerts + Weekly Digest Task ───────────────────────────────────

TaskManager.defineTask(BACKGROUND_ALERTS_TASK, async () => {
  try {
    await initDatabase();
    await waitForHydration();
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
      // Uses the shared resolver so the reset boundary matches the gauges the
      // alerts are about. The old inline math here overflowed short months for
      // salaryDay 29–31, producing a cycle key that drifted off month-end.
      const cycle = await getSalaryCycleWindowAsync(cycleAnchorFrom(preferences));
      const cycleStart = toLocalDateKey(cycle.start);
      if (preferences.lastBudgetCycleReset !== cycleStart) {
        resetBudgetNotificationHistory(cycleStart);
      }
    }

    // ── 1. Global monthly budget alert ───────────────────────────────────────
    if (preferences.budgetAlerts && preferences.monthlyBudget > 0) {
      const spent = await getCurrentMonthSpend(cycleAnchorFrom(preferences));
      const pctValue = spent / preferences.monthlyBudget;
      const pct = Math.floor(pctValue * 10) * 10; // floor to 80 / 90 / 100

      // Key -1 is reserved for the global budget in the notification history.
      const lastPct = (preferences.budgetNotificationHistory as Record<string | number, number>)['-1'] || 0;

      if (pct >= 80 && pct > lastPct) {
        await NotificationService.notifyBudgetAlert(spent, preferences.monthlyBudget, preferences.currency);
        updateBudgetNotificationHistory(-1, pct);
      }
    }

    // ── 2. Per-category budget alerts (shared with the foreground hook) ──────
    if (preferences.budgetAlerts) {
      await runCategoryBudgetAlerts();
      await runCardDueReminders();
      await runUtilizationNudges();
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

    // Register Background Notification Task to handle exact silent alarms for backup
    await Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch((e) => {
      console.warn('[Background] Failed to register background notifications task:', e);
    });

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
