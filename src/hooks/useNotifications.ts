import { useCallback } from 'react';
import * as Device from 'expo-device';
import { getBudgetUtilization } from '../services/database';
import { useStore } from '../store/useStore';
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

  /** Check per-category budgets and fire alerts if thresholds are hit. */
  const checkBudgetAlerts = useCallback(async () => {
    const { budgetAlerts, budgetNotificationHistory, salaryDay, currency } = useStore.getState().preferences;
    const { updateBudgetNotificationHistory } = useStore.getState();

    if (!budgetAlerts) return;
    try {
      // Pass the user's salary-day so utilization uses the same cycle as the
      // global monthly spend shown on the dashboard.
      const utilizations = await getBudgetUtilization(salaryDay);
      for (const u of utilizations) {
        const pct = Math.floor(u.percentage / 10) * 10; // round down to 80, 90, 100…
        const lastPct = budgetNotificationHistory[u.budget.id] || 0;

        if (pct >= 80 && pct > lastPct) {
          if (pct >= 100) {
            await scheduleLocalNotification(
              `Budget Exceeded: ${u.budget.categoryName}`,
              `You've overspent your ${u.budget.categoryName} budget by ${currency}${(u.spent - u.budget.amount).toFixed(0)}.`,
              'budget',
              { screen: 'Budget' }
            );
          } else {
            await scheduleLocalNotification(
              `Budget Alert: ${u.budget.categoryName}`,
              `You've used ${u.percentage.toFixed(0)}% of your ${u.budget.categoryName} budget (${currency}${u.spent.toFixed(0)} / ${currency}${u.budget.amount.toFixed(0)}).`,
              'budget',
              { screen: 'Budget' }
            );
          }
          updateBudgetNotificationHistory(u.budget.id, pct);
        }
      }
    } catch { /* budget check failure is non-fatal */ }
  }, [scheduleLocalNotification]);

  return {
    requestPermissions,
    scheduleLocalNotification,
    checkBudgetAlerts,
  };
};
