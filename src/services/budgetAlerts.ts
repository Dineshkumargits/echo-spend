import { getBudgetImpactForCategory, getBudgetUtilization } from './database';
import { NotificationService } from './notifications';
import { notify } from '../utils/notify';
import { useStore } from '../store/useStore';

/**
 * In-app toast right after a debit is saved: which budget the spend landed in
 * and what's left of it. The instant feedback loop budgets otherwise lack.
 */
export const showBudgetImpactToast = async (categoryName: string) => {
  try {
    const { salaryDay, currency } = useStore.getState().preferences;
    const u = await getBudgetImpactForCategory(categoryName, salaryDay);
    if (!u) return;
    const fmt = (n: number) => `${currency}${Math.round(n).toLocaleString('en-IN')}`;
    const name = u.displayName;
    const window = u.budget.period === 'weekly' ? 'week' : 'cycle';
    if (u.remaining < 0) {
      notify.error(
        `${name} budget exceeded`,
        `${fmt(-u.remaining)} over · ${u.daysLeft}d left this ${window}`,
      );
    } else if (u.pace === 'risk' || u.percentage >= 80) {
      notify.info(
        `${name} · ${u.percentage}% used`,
        `${fmt(u.remaining)} left for ${u.daysLeft} days — pace is high`,
      );
    } else {
      notify.info(
        `${name} · ${u.percentage}% used`,
        `${fmt(u.remaining)} left this ${window}`,
      );
    }
  } catch { /* toast failure is non-fatal */ }
};

/**
 * Per-category budget alerts, shared by the foreground hook (after add/edit)
 * and the background task so both fire identical notifications.
 *
 * History milestones per budget id (fires once each per cycle):
 *   50  → pace warning ("on pace to exceed") while usage is still < 80%
 *   80/90 → threshold warnings
 *   100 → exceeded
 */
export const runCategoryBudgetAlerts = async () => {
  const { budgetAlerts, budgetNotificationHistory, salaryDay, currency } =
    useStore.getState().preferences;
  const { updateBudgetNotificationHistory } = useStore.getState();
  if (!budgetAlerts) return;

  const fmt = (n: number) => `${currency}${Math.round(n).toLocaleString('en-IN')}`;
  const utilizations = await getBudgetUtilization(salaryDay);

  for (const u of utilizations) {
    if (u.orphaned) continue;
    const name = u.displayName;
    const lastPct = budgetNotificationHistory[u.budget.id] || 0;

    if (u.percentage >= 100) {
      if (lastPct < 100) {
        await NotificationService.scheduleLocalNotification(
          `Budget exceeded: ${name}`,
          `${fmt(u.spent - u.effectiveLimit)} over your ${fmt(u.effectiveLimit)} limit with ${u.daysLeft} days left in this ${u.budget.period === 'weekly' ? 'week' : 'cycle'}.`,
          'budget',
          { screen: 'Budget' },
        );
        updateBudgetNotificationHistory(u.budget.id, 100);
      }
    } else if (u.percentage >= 80) {
      const pct = Math.floor(u.percentage / 10) * 10; // 80 or 90
      if (pct > lastPct) {
        await NotificationService.scheduleLocalNotification(
          `Budget alert: ${name}`,
          `${u.percentage}% used (${fmt(u.spent)} / ${fmt(u.effectiveLimit)}) — ${fmt(u.remaining)} left for ${u.daysLeft} days.`,
          'budget',
          { screen: 'Budget' },
        );
        updateBudgetNotificationHistory(u.budget.id, pct);
      }
    } else if (u.pace === 'risk' && u.elapsedPct >= 25 && lastPct < 50) {
      // Early pace warning: usage looks fine in absolute terms but the
      // run-rate says the limit won't survive the window.
      await NotificationService.scheduleLocalNotification(
        `Pace warning: ${name}`,
        `At today's pace you'll hit ${fmt(u.projectedSpend)} against a ${fmt(u.effectiveLimit)} limit. ${u.daysLeft} days to slow down.`,
        'budget',
        { screen: 'Budget' },
      );
      updateBudgetNotificationHistory(u.budget.id, 50);
    }
  }
};
