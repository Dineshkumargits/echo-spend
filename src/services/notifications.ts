import * as Notifications from 'expo-notifications';
import { Platform, AppState, NativeModules } from 'react-native';
import { useStore } from '../store/useStore';

// Single authoritative handler — keeps badge, plays sound, shows alert.
// Refactored to silence alerts when the app is active to prevent "notification bombing"
// while the user is already looking at their data.
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
      const { preferences } = useStore.getState();
      const currency = preferences?.currency ?? '₹';
      const categoryLabel = category ? ` · ${category}` : '';
      const text = `${currency}${amount.toLocaleString('en-IN')} at ${merchant}${categoryLabel}`;
      
      if (AppState.currentState === 'active') {
        notify.info('New Transaction Found', text);
        return;
      }

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

      if (AppState.currentState === 'active') {
        notify.info(`${count} New Transactions`, body);
        return;
      }

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

      if (AppState.currentState === 'active') {
        notify.info(title, body);
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: { screen: 'Home' },
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

  async notifyWeeklyDigest(totalSpent: number, topCategory: string, currency: string) {
    try {
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
      await Notifications.scheduleNotificationAsync({
        identifier: 'echo-daily-reminder',
        content: {
          title: 'Daily Expense Check-in',
          body: "Don't forget to add today's expenses! Tap to open Echo Spend.",
          data: { screen: 'Home' },
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
      if (AppState.currentState === 'active') {
        notify.info(title, body);
        return;
      }

      const priority = channelId === 'alerts'
        ? Notifications.AndroidNotificationPriority.MAX
        : (channelId === 'transactions'
          ? Notifications.AndroidNotificationPriority.HIGH
          : Notifications.AndroidNotificationPriority.DEFAULT);

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
