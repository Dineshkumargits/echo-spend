import * as Notifications from 'expo-notifications';
import { Platform, AppState, NativeModules } from 'react-native';
import { useStore } from '../store/useStore';

// Single authoritative handler — keeps badge, plays sound, shows alert.
// Refactored to silence alerts when the app is active to prevent "notification bombing"
// while the user is already looking at their data.
/**
 * True only when an in-app toast will actually be SEEN.
 *
 * `AppState.currentState` alone is not enough. Headless JS tasks (incoming SMS,
 * background sync) run with no mounted UI, and `notify.*` there emits into an
 * empty listener set — the message is silently discarded and the user gets no
 * notification at all. Requiring a live listener means those contexts correctly
 * fall through to a real system notification.
 */
const canShowInAppToast = (): boolean =>
  AppState.currentState === 'active' && notify.hasListeners();

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isActive = AppState.currentState === 'active';
    return {
      shouldShowAlert: !isActive,
      shouldPlaySound: !isActive,
      shouldSetBadge: true,
      shouldShowBanner: !isActive,
      shouldShowList: true,
    };
  },
});

import { notify } from '../utils/notify';

let _channelsEnsured = false;

/**
 * Create the Android notification channels, at most once per JS context.
 *
 * These used to be created only inside requestPermissions(), which runs solely
 * from the UI (App.tsx). A headless JS task therefore posted notifications with
 * `channelId: 'transactions'` against a channel that need not exist — and
 * Android drops a notification aimed at an unknown channel silently, with no
 * error for the caller to catch. Every notify* path now ensures them first, so a
 * transaction detected while the app has never been opened still reaches the
 * user.
 *
 * setNotificationChannelAsync is idempotent (it updates in place), so re-running
 * it is safe; the flag just avoids the native round-trip on every notification.
 */
const ensureAndroidChannels = async (): Promise<void> => {
  if (Platform.OS !== 'android' || _channelsEnsured) return;
  try {
    // Default channel (fallback for any notification not specifying a channelId)
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Echo Spend',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync('transactions', {
      name: 'Transactions',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: '#FFB454',
    });
    // 'alerts' channel is used for global budget and error notifications (MAX importance)
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Budget & Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FFB454',
    });
    // 'budget' channel is used for per-category budget notifications (DEFAULT importance)
    await Notifications.setNotificationChannelAsync('budget', {
      name: 'Budget Alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#FFB454',
    });
    await Notifications.setNotificationChannelAsync('digest', {
      name: 'Weekly Digest',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    _channelsEnsured = true;
  } catch (e) {
    console.warn('[Notifications] Failed to ensure Android channels:', e);
  }
};

export const NotificationService = {
  /** Exposed so headless entry points can prepare channels before notifying. */
  ensureAndroidChannels,

  async requestPermissions() {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return false;
    }

    await ensureAndroidChannels();

    return true;
  },

  /** Single new transaction detected in background */
  async notifyNewTransaction(amount: number, merchant: string, category?: string) {
    try {
      const { preferences } = useStore.getState();
      const currency = preferences?.currency ?? '₹';
      const categoryLabel = category ? ` · ${category}` : '';
      const text = `${currency}${amount.toLocaleString('en-IN')} at ${merchant}${categoryLabel}`;
      
      if (canShowInAppToast()) {
        notify.info('New Transaction Found', text);
        return;
      }

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'New Transaction Detected',
          body: `${text} — tap to review`,
          data: { screen: 'SmartInbox' },
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'transactions',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  /** Multiple transactions found in a background scan */
  async notifyBatchTransactions(count: number, totalAmount: number, topMerchant?: string) {
    try {
      const { preferences } = useStore.getState();
      const currency = preferences?.currency ?? '₹';
      const merchantLine = topMerchant ? ` Top: ${topMerchant}.` : '';
      const body = `${currency}${totalAmount.toLocaleString('en-IN')} total detected.${merchantLine} Tap to review.`;

      if (canShowInAppToast()) {
        notify.info(`${count} New Transactions`, body);
        return;
      }

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${count} New Transactions Found`,
          body,
          data: { screen: 'SmartInbox' },
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'transactions',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async notifyBudgetAlert(spent: number, budget: number, currency: string) {
    try {
      const pct = Math.round((spent / budget) * 100);
      const over = spent >= budget;
      const title = over ? 'Budget Exceeded!' : `Budget at ${pct}%`;
      const body = over
        ? `You've spent ${currency}${spent.toLocaleString('en-IN')} — ${currency}${(spent - budget).toLocaleString('en-IN')} over your ${currency}${budget.toLocaleString('en-IN')} budget.`
        : `${pct}% of your monthly budget used (${currency}${spent.toLocaleString('en-IN')} / ${currency}${budget.toLocaleString('en-IN')}).`;

      if (canShowInAppToast()) {
        notify.info(title, body);
        return;
      }

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { screen: 'Budget' },
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'alerts',
            priority: Notifications.AndroidNotificationPriority.MAX,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  /**
   * Auto-applied cycle resets change the budget gauge on their own, so the user
   * must be told what moved and when — silent money-number changes are alarming.
   */
  async notifySalaryCycleReset(occurredAt: string) {
    try {
      const when = new Date(occurredAt);
      const title = 'New budget cycle started';
      const body = `Salary detected on ${when.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short',
      })} at ${when.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit',
      })}. Your budget has reset — tap to review or correct the date.`;

      if (canShowInAppToast()) {
        notify.info(title, body);
        return;
      }

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { screen: 'Budget' },
          sound: 'default',
          ...(Platform.OS === 'android' && {
            channelId: 'alerts',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  /**
   * Card payment reminder. Missing a card due date costs a late fee, interest on
   * the whole statement and a credit-score hit, so this is the highest-value
   * alert the app sends.
   */
  async notifyCardDue(
    cardName: string,
    amountDue: number,
    daysLeft: number,
    currency: string,
    minimumDue?: number | null,
  ) {
    try {
      const when =
        daysLeft <= 0 ? 'due today' : daysLeft === 1 ? 'due tomorrow' : `due in ${daysLeft} days`;
      const title = `${cardName} bill ${when}`;
      const min = minimumDue
        ? ` Minimum ${currency}${minimumDue.toLocaleString('en-IN')}.`
        : '';
      const body = `${currency}${amountDue.toLocaleString('en-IN')} to pay.${min}`;

      if (canShowInAppToast()) {
        notify.info(title, body);
        return;
      }

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { screen: 'Finances' },
          sound: 'default',
          ...(Platform.OS === 'android' && {
            channelId: 'alerts',
            priority: Notifications.AndroidNotificationPriority.MAX,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  /**
   * Credit bureaus snapshot utilization on the STATEMENT date, not the due date.
   * So the moment worth nudging is a few days before the statement closes —
   * paying down then lowers the reported figure. Paying after the statement is
   * generated has no effect on that month's reported utilization.
   */
  async notifyHighUtilization(
    cardName: string,
    utilizationPct: number,
    daysToStatement: number,
    payDown: number,
    currency: string,
  ) {
    try {
      const title = `${cardName} at ${Math.round(utilizationPct)}% utilization`;
      const when =
        daysToStatement <= 0 ? 'today' : daysToStatement === 1 ? 'tomorrow' : `in ${daysToStatement} days`;
      const body = `Your statement generates ${when}. Paying ${currency}${Math.round(
        payDown,
      ).toLocaleString('en-IN')} before then keeps the reported figure under 30%.`;

      if (canShowInAppToast()) {
        notify.info(title, body);
        return;
      }

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { screen: 'Finances' },
          sound: 'default',
          ...(Platform.OS === 'android' && {
            channelId: 'alerts',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async notifyWeeklyDigest(totalSpent: number, topCategory: string, currency: string) {
    try {
      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Weekly Spend Digest',
          body: `You spent ${currency}${totalSpent.toLocaleString('en-IN')} this week. Most spent on ${topCategory}.`,
          data: { screen: 'Analytics' },
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'digest',
            priority: Notifications.AndroidNotificationPriority.DEFAULT,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async scheduleDailyReminder() {
    try {
      // Always cancel first — replaces any stale/misconfigured scheduled notification
      // so there is never more than one daily reminder in the queue.
      await NotificationService.cancelDailyReminder();

      // Use a natively repeating DAILY trigger. This survives app termination and does not
      // require the JavaScript environment to wake up and manually schedule the next instance.
      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        identifier: 'echo-daily-reminder',
        content: {
          title: 'Daily Expense Check-in',
          body: "Don't forget to add today's expenses! Tap to open Echo Spend.",
          data: { screen: 'SmartScan' },
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'alerts',
            priority: Notifications.AndroidNotificationPriority.MAX,
          }),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 21,
          minute: 0,
        },
      });
    } catch (e) {
      console.error('[Notifications] Failed to schedule daily reminder:', e);
    }
  },

  /**
   * Schedules a silent "ping" notification that triggers the background cloud sync.
   * Uses native AlarmManager on Android for precision background execution.
   */
  async scheduleSyncTask(timeStr: string) {
    try {
      await NotificationService.cancelSyncTask();

      if (Platform.OS === 'android') {
        const { BackgroundOptimizationModule } = NativeModules;
        if (BackgroundOptimizationModule) {
          console.log(`[Notifications] Scheduling precision native sync alarm for ${timeStr}`);
          await BackgroundOptimizationModule.scheduleSyncAlarm(timeStr);
          return;
        }
      }

      const [hour, min] = timeStr.split(':').map(Number);
      const now = new Date();
      const target = new Date(now);
      target.setHours(hour, min, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }

      // Fallback/Non-Android path
      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        identifier: 'echo-sync-ping',
        content: {
          title: '', 
          body: '',
          data: { triggerSync: true, rescheduleSync: true, syncTime: timeStr },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: target,
        },
      });
    } catch (e) {
      console.error('[Notifications] Failed to schedule sync task:', e);
    }
  },

  async cancelSyncTask() {
    try {
      if (Platform.OS === 'android') {
        const { BackgroundOptimizationModule } = NativeModules;
        if (BackgroundOptimizationModule) {
          await BackgroundOptimizationModule.cancelSyncAlarm();
          return;
        }
      }
      await Notifications.cancelScheduledNotificationAsync('echo-sync-ping');
    } catch {}
  },

  async cancelDailyReminder() {
    // Fast path: cancel by known identifier.
    try {
      await Notifications.cancelScheduledNotificationAsync('echo-daily-reminder');
    } catch {}
    // Migration sweep: cancel any old reminders that were scheduled without an
    // identifier (title-based dedup era) so none linger after upgrading.
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const n of scheduled) {
        if (n.content.title === 'Daily Expense Check-in') {
          await Notifications.cancelScheduledNotificationAsync(n.identifier);
        }
      }
    } catch {}
  },

  async notifySmartScanSuggestion(count: number) {
    try {
      // Use a fixed identifier so repeated calls (e.g. every 60-second poll)
      // replace the previous notification instead of stacking duplicates.
      // Also cancel-then-schedule to guarantee at most one visible notification.
      try {
        await Notifications.cancelScheduledNotificationAsync('echo-scan-suggestion');
      } catch {}
      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        identifier: 'echo-scan-suggestion',
        content: {
          title: 'Review Pending Transactions',
          body: `You have ${count} transactions waiting to be confirmed. Tap to review.`,
          data: { screen: 'SmartInbox' },
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'transactions',
            priority: Notifications.AndroidNotificationPriority.HIGH,
          }),
        },
        trigger: null,
      });
    } catch {}
  },

  async notifyError(title: string, body: string) {
    try {
      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `⚠️ ${title}`,
          body,
          sound: 'default',
          ...(Platform.OS === 'android' && { 
            channelId: 'alerts',
            priority: Notifications.AndroidNotificationPriority.MAX,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async scheduleLocalNotification(title: string, body: string, channelId = 'default', data?: any) {
    try {
      if (canShowInAppToast()) {
        notify.info(title, body);
        return;
      }

      const priority = channelId === 'alerts'
        ? Notifications.AndroidNotificationPriority.MAX
        : (channelId === 'transactions'
          ? Notifications.AndroidNotificationPriority.HIGH
          : Notifications.AndroidNotificationPriority.DEFAULT);

      await ensureAndroidChannels();
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          data,
          ...(Platform.OS === 'android' && { 
            channelId,
            priority,
          }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },
};
