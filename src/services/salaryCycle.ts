/**
 * Budget cycle — the single source of truth for "when does the budget reset?".
 *
 * The cycle is anchored on the *actual* salary arrivals the user has recorded,
 * each a full timestamp (date + time). Payroll rarely lands on the same day
 * every month — the 30th, then the 31st, then the 1st — and a recurring
 * day-of-month rule cannot express that. So the user records what really
 * happened, including correcting it after the fact ("salary came 31 Jul, I'm
 * setting it on 1 Aug").
 *
 * Boundaries:
 *  - Cycle starts at a recorded salary instant.
 *  - It ends at the NEXT recorded salary instant when one exists, so historical
 *    cycles are exactly the real gap between paydays.
 *  - The newest cycle has no "next" yet, so it ends one calendar month later.
 *    If the user forgets to record for a while, that rolls forward a month at a
 *    time — the budget still resets on schedule instead of growing forever.
 *
 * With nothing recorded yet (fresh install, or an upgrade from the old
 * day-of-month setting) it falls back to the recurring anchor in preferences,
 * so behaviour is unchanged until the first salary date is recorded.
 */

// ─── Fallback anchor (pre-migration / nothing recorded yet) ──────────────────

export interface CycleAnchor {
  /** Day of month, 1–31. Clamped into shorter months. */
  day: number;
  /** Local time of day, "HH:mm" on a 24-hour clock. */
  time: string;
}

export const DEFAULT_SALARY_TIME = '00:00';
export const DEFAULT_CYCLE_ANCHOR: CycleAnchor = { day: 1, time: DEFAULT_SALARY_TIME };

const clampDay = (day: number): number => Math.min(Math.max(Math.round(day) || 1, 1), 31);

/** Parse "HH:mm", falling back to midnight on anything unparseable. */
export const parseTime = (time: string | undefined): { hours: number; minutes: number } => {
  const [h, m] = (time ?? '').split(':');
  const hours = Number(h);
  const minutes = Number(m);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return { hours: 0, minutes: 0 };
  return {
    hours: Math.min(Math.max(Math.trunc(hours), 0), 23),
    minutes: Math.min(Math.max(Math.trunc(minutes), 0), 59),
  };
};

/** "HH:mm", zero-padded. Anything unparseable becomes midnight. */
export const normalizeTime = (time: string | undefined): string => {
  const { hours, minutes } = parseTime(time);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/**
 * Fallback anchor from preferences. Permissive on purpose: these values
 * round-trip through the Google Drive backup and may be written by a different
 * app version.
 */
export const cycleAnchorFrom = (prefs: {
  salaryDay?: number;
  salaryTime?: string;
}): CycleAnchor => ({
  day: Number.isFinite(prefs.salaryDay) ? clampDay(prefs.salaryDay as number) : 1,
  time: normalizeTime(prefs.salaryTime),
});

// ─── Date helpers ────────────────────────────────────────────────────────────

const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();

export const startOfDay = (d: Date): Date => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
};

/**
 * YYYY-MM-DD in LOCAL time.
 *
 * Not `toISOString().split('T')[0]` — that converts to UTC first, so a local
 * instant in any zone ahead of UTC (IST included) can yield the previous day's
 * key, making the budget-cycle reset key disagree with the cycle it names.
 */
export const toLocalDateKey = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Add whole calendar months, keeping the time and clamping the day into shorter
 * months. Plain `setMonth(+1)` on the 31st overflows into the following month
 * (31 Jan → 3 Mar), which is exactly the drift this module exists to prevent.
 */
export const addMonthsClamped = (d: Date, months: number): Date => {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const y = target.getFullYear();
  const m = target.getMonth();
  return new Date(
    y, m, Math.min(d.getDate(), daysInMonth(y, m)),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  );
};

/** The recurring-anchor instant inside a given month (fallback path only). */
export const anchorInstantFor = (anchor: CycleAnchor, year: number, month: number): Date => {
  const norm = new Date(year, month, 1);
  const y = norm.getFullYear();
  const m = norm.getMonth();
  const { hours, minutes } = parseTime(anchor.time);
  return new Date(y, m, Math.min(anchor.day, daysInMonth(y, m)), hours, minutes, 0, 0);
};

// ─── Cycle resolution ────────────────────────────────────────────────────────

export interface CycleWindow {
  /** Inclusive start — the moment the salary landed. */
  start: Date;
  /** Exclusive end — the next salary, or one month on. */
  end: Date;
  /** True when the start came from a salary the user actually recorded. */
  fromRecord: boolean;
}

/** Normalize input into a sorted-ascending list of valid Dates. */
const sortedDates = (dates: Array<Date | string>): Date[] =>
  dates
    .map((d) => (d instanceof Date ? d : new Date(d)))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

/**
 * Every cycle boundary implied by the recorded salary dates, as [start, end)
 * pairs, oldest first. The final entry is the live cycle and is rolled forward a
 * month at a time until it contains `now`.
 */
const buildCycles = (recorded: Date[], now: Date): CycleWindow[] => {
  const cycles: CycleWindow[] = [];

  for (let i = 0; i < recorded.length; i++) {
    const start = recorded[i];
    const next = recorded[i + 1];

    if (next) {
      // A real gap between two recorded paydays.
      cycles.push({ start, end: next, fromRecord: true });
      continue;
    }

    // Newest recorded salary: end one month on, rolling forward if the user has
    // not recorded since. Each roll is derived from the ORIGINAL instant so the
    // day-of-month clamp never compounds (31 → 28 → 28 …).
    let step = 1;
    let s = start;
    let e = addMonthsClamped(start, 1);
    while (e <= now) {
      s = e;
      step += 1;
      e = addMonthsClamped(start, step);
    }
    cycles.push({ start: s, end: e, fromRecord: step === 1 });
  }

  return cycles;
};

/** Fallback: the old recurring day-of-month rule, used until anything is recorded. */
const anchorCycle = (anchor: CycleAnchor, now: Date, shift: number): CycleWindow => {
  let start = anchorInstantFor(anchor, now.getFullYear(), now.getMonth());
  if (start > now) start = anchorInstantFor(anchor, now.getFullYear(), now.getMonth() - 1);
  const base = new Date(start.getFullYear(), start.getMonth() + shift, 1);
  return {
    start: anchorInstantFor(anchor, base.getFullYear(), base.getMonth()),
    end: anchorInstantFor(anchor, base.getFullYear(), base.getMonth() + 1),
    fromRecord: false,
  };
};

/**
 * The cycle containing `now`, shifted by whole cycles (0 = current, -1 = previous).
 *
 * `recorded` is the list of salary timestamps the user has confirmed, in any
 * order. Shifting walks back through real recorded cycles where they exist, so
 * "last cycle" is the genuine previous payday gap rather than a guess.
 */
export const resolveCycle = (
  recorded: Array<Date | string>,
  fallback: CycleAnchor,
  now = new Date(),
  shift = 0,
): CycleWindow => {
  const list = sortedDates(recorded).filter((d) => d <= now);
  if (list.length === 0) return anchorCycle(fallback, now, shift);

  const cycles = buildCycles(list, now);
  const currentIdx = cycles.length - 1;
  const idx = currentIdx + shift;

  if (idx >= 0 && idx < cycles.length) return cycles[idx];

  // Shifted past the oldest recorded salary — extend backwards a month at a time
  // from the earliest one so budget history still has windows to compare.
  const oldest = cycles[0].start;
  const back = idx; // negative
  return {
    start: addMonthsClamped(oldest, back),
    end: addMonthsClamped(oldest, back + 1),
    fromRecord: false,
  };
};

/** Human-readable summary, e.g. "31 Jul 2026, 18:30". */
export const describeInstant = (d: Date): string =>
  `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d
    .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
