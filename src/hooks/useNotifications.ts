import { useCallback } from 'react';
import * as Device from 'expo-device';
import { runCategoryBudgetAlerts } from '../services/budgetAlerts';
import { NotificationService } from '../services/notifications';

// NOTE: setNotificationHandler is configured once in notifications.ts (the
// authoritative location). We must NOT call it again here — the second call
// would override it and could disable badge counting.

export const useNotifications = () => {
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    // Delegate to the centralised NotificationService which sets up all channels.
    return NotificationService.requestPermissions();
  }, []);

  const scheduleLocalNotification = useCallback(
    async (title: string, body: string, channelId = 'default', data?: any) => {
      await NotificationService.scheduleLocalNotification(title, body, channelId, data);
    },
    []
  );

  /** Check per-category budgets and fire threshold / pace alerts. */
  const checkBudgetAlerts = useCallback(async () => {
    try {
      await runCategoryBudgetAlerts();
    } catch { /* budget check failure is non-fatal */ }
  }, []);

  return {
    requestPermissions,
    scheduleLocalNotification,
    checkBudgetAlerts,
  };
};
