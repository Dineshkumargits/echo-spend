/**
 * Pure derivations behind the day-to-day dashboard widgets.
 *
 * Everything here is computed from data the dashboard already loads (accounts,
 * subscriptions, loans, month spend), so adding these widgets cost no extra
 * queries. Keeping them pure also makes the money math testable in isolation
 * from the screen.
 */
import type { Account, Subscription, Loan, CardStatement } from '../../services/database';

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
 * Turn a cycle window into the day counts the widgets need.
 *
 * The window itself comes from services/salaryCycle — the one place that knows
 * the salary date and time. Widgets must never re-derive it, or they drift out
 * of agreement with the budget gauges.
 */
export const toCycle = (window: { start: Date; end: Date }, now = new Date()): Cycle => {
  const today = startOfDay(now);
  const start = startOfDay(window.start);
  const end = startOfDay(window.end);

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
  /** Open card statements. Without these, card bills are omitted rather than guessed. */
  statements: CardStatement[] = [],
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

  // Card bills come from the STATEMENT, never from the running balance.
  // account.balance is current outstanding — it includes spend made after the
  // statement was generated, which is not yet due. Quoting it overstates every
  // bill for anyone who uses the card after their statement date.
  for (const st of statements) {
    if (st.isPaid) continue;
    const remaining = Math.max(st.totalDue - st.paidAmount, 0);
    if (remaining <= 0) continue;
    const card = accounts.find((a) => a.id === st.accountId);
    if (!card) continue;

    bills.push({
      key: `card-${st.accountId}-${st.dueDate}`,
      label: `${card.name} bill`,
      amount: remaining,
      dueDate: st.dueDate,
      daysLeft: daysUntil(st.dueDate, now),
      kind: 'card',
      target: 'card',
      refId: card.id,
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
  /** Current running balance — everything spent, billed or not. */
  outstanding: number;
  /** The open statement, if one has been captured. */
  statement: CardStatement | null;
  /** What must actually be paid by the due date. Null when no statement is known. */
  amountDue: number | null;
  minimumDue: number | null;
  /** Spend since the statement — not due yet, rolls into the next bill. */
  unbilled: number | null;
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

export const getCardHealth = (
  accounts: Account[],
  now = new Date(),
  statements: CardStatement[] = [],
): CardHealth[] =>
  accounts
    .filter((a) => a.accountType === 'credit_card')
    .map((a): CardHealth => {
      const outstanding = Math.max(a.balance, 0);
      // Oldest unpaid statement is the one being billed.
      const statement =
        statements
          .filter((s) => s.accountId === a.id && !s.isPaid)
          .sort((x, y) => new Date(x.dueDate).getTime() - new Date(y.dueDate).getTime())[0] ?? null;
      const amountDue = statement
        ? Math.max(statement.totalDue - statement.paidAmount, 0)
        : null;
      const limit = a.creditLimit ?? 0;
      const hasLimit = limit > 0;
      const utilizationPct = hasLimit
        ? Math.min((outstanding / limit) * 100, 100)
        : 0;

      return {
        account: a,
        outstanding,
        statement,
        amountDue,
        minimumDue: statement?.minimumDue ?? null,
        // Only meaningful once a statement exists; otherwise we cannot tell
        // billed from unbilled spend.
        unbilled: statement ? Math.max(outstanding - amountDue!, 0) : null,
        limit,
        hasLimit,
        utilizationPct,
        available: hasLimit ? Math.max(limit - outstanding, 0) : 0,
        // Prefer the real due date from the statement over the configured day.
        dueInDays: statement
          ? daysUntil(statement.dueDate, now)
          : a.billDueDay
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

/**
 * How long a purchase made *today* stays interest-free.
 *
 * A purchase lands on the statement generated on `statementDay`, and that
 * statement is payable by `billDueDay`. So buying just after a statement closes
 * gives the longest free credit — the number people optimise around.
 *
 * Returns null unless both dates are configured; guessing here would be worse
 * than staying quiet, since the whole value is in the exact date.
 */
export interface InterestFreeInfo {
  /** The statement today's spend will appear on. */
  nextStatementDate: Date;
  /** When that statement must be paid. */
  payBy: Date;
  /** Total interest-free days from today. */
  days: number;
}

export const getInterestFreeInfo = (
  account: Account,
  now = new Date(),
): InterestFreeInfo | null => {
  if (!account.statementDay || !account.billDueDay) return null;

  const nextStatementDate = nextOccurrenceOfDay(account.statementDay, now);

  // The due date is the first billDueDay strictly after that statement closes.
  // Same month when the due day falls later, otherwise the following month.
  let payBy = nextOccurrenceOfDay(account.billDueDay, nextStatementDate);
  if (payBy <= nextStatementDate) {
    const after = new Date(nextStatementDate);
    after.setDate(after.getDate() + 1);
    payBy = nextOccurrenceOfDay(account.billDueDay, after);
  }

  return {
    nextStatementDate,
    payBy,
    days: Math.max(daysUntil(payBy.toISOString(), now), 0),
  };
};
