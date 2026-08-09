/**
 * Pure derivations behind the day-to-day dashboard widgets.
 *
 * Everything here is computed from data the dashboard already loads (accounts,
 * subscriptions, loans, month spend), so adding these widgets cost no extra
 * queries. Keeping them pure also makes the money math testable in isolation
 * from the screen.
 */
import type { Account, Subscription, Loan } from '../../services/database';

const DAY_MS = 86_400_000;

const startOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

/** Whole days from today to `iso`. Negative means overdue. */
export const daysUntil = (iso: string, now = new Date()): number =>
  Math.round(
    (startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime()) / DAY_MS,
  );

// ─── Financial cycle ─────────────────────────────────────────────────────────

export interface Cycle {
  start: Date;
  end: Date;
  /** Days already elapsed, at least 1 so callers can divide by it. */
  daysElapsed: number;
  /** Days remaining including today, at least 1 so callers can divide by it. */
  daysRemaining: number;
  totalDays: number;
}

/**
 * The user's spending cycle, anchored on payday rather than the calendar month.
 * `salaryDay` is clamped per-month, so 31 behaves correctly in February.
 */
export const getCycle = (salaryDay: number, now = new Date()): Cycle => {
  const day = Math.min(Math.max(Math.round(salaryDay) || 1, 1), 31);
  const clampToMonth = (year: number, month: number): Date => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return startOfDay(new Date(year, month, Math.min(day, lastDay)));
  };

  const today = startOfDay(now);
  let start = clampToMonth(today.getFullYear(), today.getMonth());
  // Before this month's payday, we're still inside the previous cycle.
  if (start > today) start = clampToMonth(today.getFullYear(), today.getMonth() - 1);
  const end = clampToMonth(start.getFullYear(), start.getMonth() + 1);

  const totalDays = Math.max(Math.round((end.getTime() - start.getTime()) / DAY_MS), 1);
  const elapsed = Math.round((today.getTime() - start.getTime()) / DAY_MS);

  return {
    start,
    end,
    totalDays,
    daysElapsed: Math.max(elapsed, 1),
    daysRemaining: Math.max(totalDays - elapsed, 1),
  };
};

// ─── Upcoming bills ──────────────────────────────────────────────────────────

export interface UpcomingBill {
  key: string;
  label: string;
  amount: number;
  dueDate: string;
  daysLeft: number;
  kind: 'subscription' | 'emi' | 'card';
  /** Navigation target for the row. */
  target: 'subs' | 'loans' | 'card';
  refId: number;
}

/**
 * The next `withinDays` of committed outgoings: active subscriptions, borrowed-loan
 * EMIs, and credit-card payments. Overdue items are kept (and sort first) because
 * a missed bill is exactly what the user needs to see.
 *
 * Only `borrowed` loans are bills — a `lent` loan is money coming back, so
 * including it would inflate committed spend and understate safe-to-spend.
 */
export const getUpcomingBills = (
  subscriptions: Subscription[],
  loans: Loan[],
  accounts: Account[],
  withinDays = 30,
  now = new Date(),
): UpcomingBill[] => {
  const bills: UpcomingBill[] = [];

  for (const s of subscriptions) {
    if (!s.isActive || !s.nextDueDate) continue;
    bills.push({
      key: `sub-${s.id}`,
      label: s.name,
      amount: s.amount,
      dueDate: s.nextDueDate,
      daysLeft: daysUntil(s.nextDueDate, now),
      kind: 'subscription',
      target: 'subs',
      refId: s.id,
    });
  }

  for (const l of loans) {
    if (!l.isActive || l.type !== 'borrowed' || !l.nextDueDate) continue;
    if (!l.emiAmount) continue;
    bills.push({
      key: `loan-${l.id}`,
      label: `${l.lender} EMI`,
      amount: l.emiAmount,
      dueDate: l.nextDueDate,
      daysLeft: daysUntil(l.nextDueDate, now),
      kind: 'emi',
      target: 'loans',
      refId: l.id,
    });
  }

  for (const a of accounts) {
    if (a.accountType !== 'credit_card' || !a.billDueDay) continue;
    // Outstanding is carried as a positive balance on a card account; nothing
    // owed means there is no bill to show.
    if (a.balance <= 0) continue;
    const due = nextOccurrenceOfDay(a.billDueDay, now);
    bills.push({
      key: `card-${a.id}`,
      label: `${a.name} bill`,
      amount: a.balance,
      dueDate: due.toISOString(),
      daysLeft: daysUntil(due.toISOString(), now),
      kind: 'card',
      target: 'card',
      refId: a.id,
    });
  }

  return bills
    .filter((b) => b.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
};

/**
 * The next date landing on `dayOfMonth`, this month if it hasn't passed yet,
 * otherwise next month. Clamped so day 31 resolves in short months.
 */
export const nextOccurrenceOfDay = (dayOfMonth: number, now = new Date()): Date => {
  const today = startOfDay(now);
  const day = Math.min(Math.max(Math.round(dayOfMonth) || 1, 1), 31);
  const build = (year: number, month: number): Date => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return startOfDay(new Date(year, month, Math.min(day, lastDay)));
  };
  const thisMonth = build(today.getFullYear(), today.getMonth());
  return thisMonth >= today ? thisMonth : build(today.getFullYear(), today.getMonth() + 1);
};

// ─── Safe to spend ───────────────────────────────────────────────────────────

export interface SafeToSpend {
  /** Budget minus spend minus bills still due this cycle. Can go negative. */
  amount: number;
  /** `amount` spread over the days left in the cycle. Floored at 0. */
  perDay: number;
  /** Committed outgoings still due before the cycle ends. */
  committed: number;
  daysRemaining: number;
  /** What the user could spend per day if they were exactly on pace. */
  idealPerDay: number;
  /** Actual average daily spend so far this cycle. */
  actualPerDay: number;
  onTrack: boolean;
  /** True when no budget is configured — the widget should prompt instead. */
  needsBudget: boolean;
}

/**
 * Safe-to-spend deliberately subtracts *upcoming committed bills* as well as
 * money already spent. Budget-minus-spend alone reads as a healthy surplus on
 * the 28th even when rent clears on the 30th, which is precisely when people
 * overspend.
 */
export const getSafeToSpend = (
  monthlyBudget: number,
  monthSpend: number,
  bills: UpcomingBill[],
  cycle: Cycle,
): SafeToSpend => {
  const committed = bills
    .filter((b) => b.daysLeft >= 0 && new Date(b.dueDate) <= cycle.end)
    .reduce((sum, b) => sum + b.amount, 0);

  const amount = monthlyBudget - monthSpend - committed;
  const idealPerDay = monthlyBudget > 0 ? monthlyBudget / cycle.totalDays : 0;
  const actualPerDay = monthSpend / cycle.daysElapsed;

  return {
    amount,
    perDay: Math.max(amount, 0) / cycle.daysRemaining,
    committed,
    daysRemaining: cycle.daysRemaining,
    idealPerDay,
    actualPerDay,
    onTrack: monthlyBudget > 0 && actualPerDay <= idealPerDay,
    needsBudget: monthlyBudget <= 0,
  };
};

// ─── Credit cards ────────────────────────────────────────────────────────────

export interface CardHealth {
  account: Account;
  outstanding: number;
  limit: number;
  /** 0–100, clamped. 0 when no limit is configured. */
  utilizationPct: number;
  available: number;
  hasLimit: boolean;
  dueInDays: number | null;
  statementInDays: number | null;
  /** Utilization above 30% starts hurting credit scores; 75%+ is urgent. */
  severity: 'ok' | 'warn' | 'high';
}

export const getCardHealth = (accounts: Account[], now = new Date()): CardHealth[] =>
  accounts
    .filter((a) => a.accountType === 'credit_card')
    .map((a): CardHealth => {
      const outstanding = Math.max(a.balance, 0);
      const limit = a.creditLimit ?? 0;
      const hasLimit = limit > 0;
      const utilizationPct = hasLimit
        ? Math.min((outstanding / limit) * 100, 100)
        : 0;

      return {
        account: a,
        outstanding,
        limit,
        hasLimit,
        utilizationPct,
        available: hasLimit ? Math.max(limit - outstanding, 0) : 0,
        dueInDays: a.billDueDay
          ? daysUntil(nextOccurrenceOfDay(a.billDueDay, now).toISOString(), now)
          : null,
        statementInDays: a.statementDay
          ? daysUntil(nextOccurrenceOfDay(a.statementDay, now).toISOString(), now)
          : null,
        severity: !hasLimit
          ? 'ok'
          : utilizationPct >= 75
            ? 'high'
            : utilizationPct >= 30
              ? 'warn'
              : 'ok',
      };
    })
    .sort((a, b) => b.utilizationPct - a.utilizationPct);

/** "Today" / "Tomorrow" / "in 4d" / "3d overdue" */
export const formatDueLabel = (daysLeft: number): string => {
  if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  return `in ${daysLeft}d`;
};
