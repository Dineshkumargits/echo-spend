import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Single authoritative handler — keeps badge, plays sound, shows alert in all states.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const NotificationService = {
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

    if (Platform.OS === 'android') {
      // Default channel (fallback for any notification not specifying a channelId)
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Echo Spend',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      await Notifications.setNotificationChannelAsync('transactions', {
        name: 'Transactions',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#0A84FF',
      });
      // 'alerts' channel is used for global budget and error notifications (MAX importance)
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Budget & Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF9500',
      });
      // 'budget' channel is used for per-category budget notifications (DEFAULT importance)
      await Notifications.setNotificationChannelAsync('budget', {
        name: 'Budget Alerts',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#FF9500',
      });
      await Notifications.setNotificationChannelAsync('digest', {
        name: 'Weekly Digest',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    return true;
  },

  /** Single new transaction detected in background */
  async notifyNewTransaction(amount: number, merchant: string, category?: string) {
    try {
      const categoryLabel = category ? ` · ${category}` : '';
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'New Transaction Detected',
          body: `₹${amount.toLocaleString('en-IN')} at ${merchant}${categoryLabel} — tap to review`,
          data: { screen: 'SmartInbox' },
          sound: 'default',
          ...(Platform.OS === 'android' && { channelId: 'transactions' }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  /** Multiple transactions found in a background scan */
  async notifyBatchTransactions(count: number, totalAmount: number, topMerchant?: string) {
    try {
      const merchantLine = topMerchant ? ` Top: ${topMerchant}.` : '';
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${count} New Transaction${count > 1 ? 's' : ''} Found`,
          body: `₹${totalAmount.toLocaleString('en-IN')} total detected.${merchantLine} Tap to review.`,
          data: { screen: 'SmartInbox' },
          sound: 'default',
          ...(Platform.OS === 'android' && { channelId: 'transactions' }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async notifyBudgetAlert(spent: number, budget: number, currency: string) {
    try {
      const pct = Math.round((spent / budget) * 100);
      const over = spent >= budget;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: over ? 'Budget Exceeded!' : `Budget at ${pct}%`,
          body: over
            ? `You've spent ${currency}${spent.toLocaleString('en-IN')} — ${currency}${(spent - budget).toLocaleString('en-IN')} over your ${currency}${budget.toLocaleString('en-IN')} budget.`
            : `${pct}% of your monthly budget used (${currency}${spent.toLocaleString('en-IN')} / ${currency}${budget.toLocaleString('en-IN')}).`,
          data: { screen: 'Home' },
          sound: 'default',
          ...(Platform.OS === 'android' && { channelId: 'alerts' }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async notifyWeeklyDigest(totalSpent: number, topCategory: string, currency: string) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Weekly Spend Digest',
          body: `You spent ${currency}${totalSpent.toLocaleString('en-IN')} this week. Most spent on ${topCategory}.`,
          data: { screen: 'Analytics' },
          sound: 'default',
          ...(Platform.OS === 'android' && { channelId: 'digest' }),
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

      // Compute the next occurrence of 9:00 PM local time.
      // If it's already past 9 PM today, schedule for tomorrow.
      const now = new Date();
      const target = new Date(now);
      target.setHours(21, 0, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1);
      }

      // Use a DATE trigger (maps to AlarmManager.setExact on Android when
      // SCHEDULE_EXACT_ALARM permission is granted). This fires at the precise
      // time, unlike DAILY which uses setInexactRepeating and is subject to
      // Doze-mode batching (causing 30–40 minute delays).
      await Notifications.scheduleNotificationAsync({
        identifier: 'echo-daily-reminder',
        content: {
          title: 'Daily Expense Check-in',
          body: "Don't forget to add today's expenses! Tap to open Echo Spend.",
          data: { screen: 'Home', rescheduleDaily: true },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: target,
          ...(Platform.OS === 'android' && { channelId: 'alerts' }),
        },
      });
    } catch (e) {
      console.error('[Notifications] Failed to schedule daily reminder:', e);
    }
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
      await Notifications.scheduleNotificationAsync({
        identifier: 'echo-scan-suggestion',
        content: {
          title: 'Review Pending Transactions',
          body: `You have ${count} transactions waiting to be confirmed. Tap to review.`,
          data: { screen: 'SmartInbox' },
          sound: 'default',
          ...(Platform.OS === 'android' && { channelId: 'transactions' }),
        },
        trigger: null,
      });
    } catch {}
  },

  async notifyError(title: string, body: string) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `⚠️ ${title}`,
          body,
          sound: 'default',
          ...(Platform.OS === 'android' && { channelId: 'alerts' }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },

  async scheduleLocalNotification(title: string, body: string, channelId = 'default', data?: any) {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          data,
          ...(Platform.OS === 'android' && { channelId }),
        },
        trigger: null,
      });
    } catch { /* notification failure is non-fatal */ }
  },
};
