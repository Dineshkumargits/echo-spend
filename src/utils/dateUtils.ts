/**
 * Calendar-day arithmetic.
 *
 * The recurring bug these exist to prevent: computing "days until" from a raw
 * millisecond difference. `Math.ceil((target - now) / DAY)` is only correct when
 * `target` sits at midnight. Stored due dates often carry a time-of-day — a
 * subscription keeps whatever time it was created or last paid — and then a bill
 * due at 12:30 today reads as "Tomorrow" all morning, flipping to "Today" only
 * after 12:30. Normalizing BOTH sides to local midnight first is the fix.
 *
 * Everything here is local-time. Never use toISOString() to derive a calendar
 * day: it converts to UTC first, so in any zone ahead of UTC (IST included) a
 * local midnight lands on the previous day.
 */

export const DAY_MS = 86_400_000;

/** Local midnight of the given instant. */
export const startOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

/**
 * Whole calendar days from `now` to `target`. Negative means overdue.
 * Both sides are normalized, so the time-of-day on either is irrelevant.
 */
export const daysBetween = (target: Date, now: Date = new Date()): number =>
  Math.round((startOfDay(target).getTime() - startOfDay(now).getTime()) / DAY_MS);

/** Whole calendar days from `now` to an ISO date string. Negative means overdue. */
export const daysUntil = (iso: string, now: Date = new Date()): number =>
  daysBetween(new Date(iso), now);

/**
 * The next date landing on `dayOfMonth` — this month if it hasn't passed,
 * otherwise next month. Clamped so day 31 resolves in short months, which plain
 * `new Date(y, m, 31)` does not (it rolls into the following month).
 */
export const nextOccurrenceOfDay = (dayOfMonth: number, now: Date = new Date()): Date => {
  const today = startOfDay(now);
  const day = Math.min(Math.max(Math.round(dayOfMonth) || 1, 1), 31);
  const build = (year: number, month: number): Date => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return startOfDay(new Date(year, month, Math.min(day, lastDay)));
  };
  const thisMonth = build(today.getFullYear(), today.getMonth());
  return thisMonth >= today ? thisMonth : build(today.getFullYear(), today.getMonth() + 1);
};

/** "Today" / "Tomorrow" / "in 4d" / "3d overdue" */
export const formatDueLabel = (daysLeft: number): string => {
  if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  return `in ${daysLeft}d`;
};

/** Long form for list rows: "Today" / "Tomorrow" / "In 4 days" / "Overdue". */
export const formatDueLabelLong = (daysLeft: number): string => {
  if (daysLeft < 0) return 'Overdue';
  if (daysLeft === 0) return 'Today';
  if (daysLeft === 1) return 'Tomorrow';
  return `In ${daysLeft} days`;
};
