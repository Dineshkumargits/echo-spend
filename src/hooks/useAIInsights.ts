import { useCallback } from 'react';
import {
  getCategoryBreakdown,
  getSpendTrend,
  getActiveInsights,
  saveInsight,
  pruneOldInsights,
  Insight,
  getBudgetUtilization,
  getTransactionCount,
} from '../services/database';
import { useStore } from '../store/useStore';

export const useAIInsights = () => {
  /** Load already-cached active insights from DB */
  const getInsights = useCallback(async (): Promise<Insight[]> => {
    return await getActiveInsights();
  }, []);

  /**
   * Generate fresh insights using enhanced local heuristics.
   * No AI model needed — all computation is deterministic and instant.
   * Call this at most once per day (caller's responsibility to rate-limit).
   */
  const generateInsights = useCallback(async (): Promise<Insight[]> => {
    await pruneOldInsights();

    const { preferences } = useStore.getState();
    const currency = preferences.currency ?? '₹';

    const [trend14, trend7, breakdown, budgetUtil] = await Promise.all([
      getSpendTrend(14),
      getSpendTrend(7),
      getCategoryBreakdown(),
      getBudgetUtilization(preferences.salaryDay),
    ]);

    if (breakdown.length === 0 && trend14.length === 0) return [];

    const now = new Date().toISOString();
    const insights: Omit<Insight, 'id'>[] = [];

    // ── 1. Weekly Digest: Top spend category ────────────────────────────────
    if (breakdown.length > 0) {
      const top = breakdown[0];
      insights.push({
        type: 'weekly_digest',
        title: `Top spend: ${top.category}`,
        body: `${top.category} accounts for ${top.percentage}% of your spending this month (${currency}${top.total.toFixed(0)}).`,
        generatedAt: now,
      });
    }

    // ── 2. Daily Average ────────────────────────────────────────────────────
    const totalSpend14 = trend14.reduce((s, p) => s + p.total, 0);
    const activeDays14 = trend14.filter(p => p.total > 0).length;
    if (totalSpend14 > 0 && activeDays14 > 0) {
      const avgDaily = totalSpend14 / activeDays14;
      insights.push({
        type: 'suggestion',
        title: 'Daily average',
        body: `Your average daily spend is ${currency}${avgDaily.toFixed(0)} over the past 14 days.`,
        generatedAt: now,
      });
    }

    // ── 3. Week-over-Week Comparison ────────────────────────────────────────
    const thisWeekTotal = trend7.reduce((s, p) => s + p.total, 0);
    // Calculate last week from the 14-day data (days 8-14)
    const lastWeekDays = trend14.slice(0, 7);
    const lastWeekTotal = lastWeekDays.reduce((s, p) => s + p.total, 0);

    if (lastWeekTotal > 0 && thisWeekTotal > 0) {
      const changePercent = Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100);
      if (Math.abs(changePercent) >= 15) {
        const direction = changePercent > 0 ? 'more' : 'less';
        insights.push({
          type: changePercent > 30 ? 'anomaly' : 'suggestion',
          title: `${Math.abs(changePercent)}% ${direction} this week`,
          body: `You spent ${currency}${thisWeekTotal.toFixed(0)} this week vs ${currency}${lastWeekTotal.toFixed(0)} last week.`,
          generatedAt: now,
        });
      }
    }

    // ── 4. Anomaly Detection: High-spend days ───────────────────────────────
    if (trend14.length > 0) {
      const avgDaily = totalSpend14 / (trend14.length || 1);
      const highDay = trend14.find(p => p.total > avgDaily * 2.5);
      if (highDay) {
        insights.push({
          type: 'anomaly',
          title: `High spend on ${highDay.date}`,
          body: `You spent ${currency}${highDay.total.toFixed(0)} on ${highDay.date}, ${Math.round(highDay.total / avgDaily)}x your daily average.`,
          generatedAt: now,
        });
      }
    }

    // ── 5. Category Spike Detection ─────────────────────────────────────────
    if (breakdown.length >= 2) {
      // If the top category is > 50% of total spending, flag it
      const top = breakdown[0];
      if (top.percentage > 50) {
        insights.push({
          type: 'anomaly',
          title: `${top.category} dominates spending`,
          body: `${top.category} is ${top.percentage}% of your total spend. Consider diversifying.`,
          generatedAt: now,
        });
      }
    }

    // ── 6. Budget Proximity Warnings ────────────────────────────────────────
    for (const u of budgetUtil) {
      if (u.percentage >= 75 && u.percentage < 100) {
        // Calculate remaining days in the cycle
        const today = new Date();
        const salaryDay = preferences.salaryDay ?? 1;
        let nextCycleStart: Date;
        if (today.getDate() >= salaryDay) {
          nextCycleStart = new Date(today.getFullYear(), today.getMonth() + 1, salaryDay);
        } else {
          nextCycleStart = new Date(today.getFullYear(), today.getMonth(), salaryDay);
        }
        const daysLeft = Math.max(1, Math.ceil((nextCycleStart.getTime() - today.getTime()) / 86400000));

        insights.push({
          type: 'suggestion',
          title: `${u.budget.categoryName}: ${u.percentage}% used`,
          body: `${currency}${(u.budget.amount - u.spent).toFixed(0)} remaining with ${daysLeft} days left in this cycle.`,
          generatedAt: now,
        });
        break; // Only show the most critical budget warning
      }
    }

    // ── 7. No-Spend Streak ──────────────────────────────────────────────────
    // Count consecutive days with zero spend from the end of the trend
    let noSpendStreak = 0;
    for (let i = trend14.length - 1; i >= 0; i--) {
      if (trend14[i].total === 0) noSpendStreak++;
      else break;
    }
    if (noSpendStreak >= 2) {
      insights.push({
        type: 'suggestion',
        title: `${noSpendStreak}-day no-spend streak! 🎉`,
        body: `Great discipline! You haven't spent anything in ${noSpendStreak} days.`,
        generatedAt: now,
      });
    } else {
      // Check for continuous spending streak
      let spendStreak = 0;
      for (let i = trend14.length - 1; i >= 0; i--) {
        if (trend14[i].total > 0) spendStreak++;
        else break;
      }
      if (spendStreak >= 10) {
        insights.push({
          type: 'suggestion',
          title: `${spendStreak} days of continuous spending`,
          body: `Consider planning a no-spend day to reset your habits.`,
          generatedAt: now,
        });
      }
    }

    // ── 8. Savings Opportunity ──────────────────────────────────────────────
    if (breakdown.length >= 2) {
      // Find the second-highest discretionary category
      const discretionary = breakdown.filter(b =>
        !['Salary', 'Transfer', 'Loan Payment', 'Insurance', 'Investments'].includes(b.category)
      );
      if (discretionary.length >= 2) {
        const target = discretionary[1]; // second-highest
        const savingsAmount = Math.round(target.total * 0.2);
        if (savingsAmount > 100) {
          insights.push({
            type: 'suggestion',
            title: `Save ${currency}${savingsAmount}/month`,
            body: `Reducing ${target.category} by 20% could save ${currency}${savingsAmount} monthly.`,
            generatedAt: now,
          });
        }
      }
    }

    // Save all insights (limit to 5 most interesting)
    const toSave = insights.slice(0, 5);
    for (const insight of toSave) {
      await saveInsight(insight);
    }

    return await getActiveInsights();
  }, []);

  return { getInsights, generateInsights };
};
