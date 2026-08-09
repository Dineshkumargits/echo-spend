/**
 * Dashboard widget registry — the single source of truth for what can appear on
 * the dashboard, in what default order, and how it is described in the "Edit
 * dashboard" sheet.
 *
 * The screen never hardcodes an order: it renders resolveDashboardLayout() and
 * looks each id up in its renderer map. To add a widget, add an entry here and a
 * renderer in DashboardScreen — existing users pick it up automatically via the
 * reconciler below.
 */
import type { DashboardLayoutEntry } from '../../store/useStore';

export type WidgetId =
  // Pre-existing sections, now individually toggleable.
  | 'hero'
  | 'accounts'
  | 'inboxPulse'
  | 'budgetWatch'
  | 'owed'
  | 'upcomingCarousel'
  | 'pulseStrip'
  | 'waveform'
  | 'insight'
  | 'activity'
  // Added in the customizable-dashboard release.
  | 'safeToSpend'
  | 'upcomingBills'
  | 'creditCards';

export interface WidgetMeta {
  id: WidgetId;
  /** Shown in the edit sheet row. */
  title: string;
  /** One line explaining what the widget answers, for the edit sheet. */
  description: string;
  /** Emoji used by the edit sheet's IconTile. */
  emoji: string;
  /** Whether a fresh install shows this widget. */
  defaultEnabled: boolean;
  /**
   * Widgets that carry the screen's core identity. They can still be hidden,
   * but the edit sheet warns rather than silently leaving a blank dashboard.
   */
  core?: boolean;
}

/** Array order IS the default dashboard order. */
export const WIDGET_REGISTRY: WidgetMeta[] = [
  {
    id: 'hero',
    title: 'Net worth',
    description: 'Total across accounts, minus credit card debt, with cycle progress.',
    emoji: '◈',
    defaultEnabled: true,
    core: true,
  },
  {
    id: 'safeToSpend',
    title: 'Safe to spend',
    description: 'What is left after bills and commitments, and your daily allowance.',
    emoji: '🧭',
    defaultEnabled: true,
  },
  {
    id: 'inboxPulse',
    title: 'Smart Inbox nudge',
    description: 'A prompt when SMS transactions are waiting for your review.',
    emoji: '📥',
    defaultEnabled: true,
  },
  {
    id: 'accounts',
    title: 'Linked accounts',
    description: 'Balances across every bank account and wallet you track.',
    emoji: '🏦',
    defaultEnabled: true,
  },
  {
    id: 'creditCards',
    title: 'Credit cards',
    description: 'Utilization against your limit, statement date and payment due.',
    emoji: '💳',
    defaultEnabled: true,
  },
  {
    id: 'upcomingBills',
    title: 'Upcoming bills',
    description: 'Subscriptions, EMIs and card payments due in the next 30 days.',
    emoji: '📅',
    defaultEnabled: true,
  },
  {
    id: 'budgetWatch',
    title: 'Budget watch',
    description: 'Category budgets that are close to, or over, their limit.',
    emoji: '🎯',
    defaultEnabled: true,
  },
  {
    id: 'pulseStrip',
    title: 'Today at a glance',
    description: "Today's spend, top category and biggest single transaction.",
    emoji: '⚡',
    defaultEnabled: true,
  },
  {
    id: 'waveform',
    title: 'Cycle waveform',
    description: 'Your last 14 days of spending as a signal trace.',
    emoji: '〰️',
    defaultEnabled: true,
  },
  {
    id: 'insight',
    title: 'Insights',
    description: 'A swipeable deck of observations about your recent spending.',
    emoji: '✨',
    defaultEnabled: true,
  },
  {
    id: 'owed',
    title: 'Owed to you',
    description: 'Outstanding amounts from split expenses.',
    emoji: '🤝',
    defaultEnabled: true,
  },
  {
    id: 'activity',
    title: 'Recent activity',
    description: 'Your latest transactions, grouped by day.',
    emoji: '📃',
    defaultEnabled: true,
    core: true,
  },
  {
    id: 'upcomingCarousel',
    title: 'Commitments carousel',
    description: 'Swipeable cards for goals, loans and subscriptions.',
    // Superseded by the denser "Upcoming bills" list, which covers the same
    // data plus card due dates — off by default, but one tap to bring back.
    emoji: '🎞️',
    defaultEnabled: false,
  },
];

export const WIDGET_BY_ID: Record<string, WidgetMeta> = Object.fromEntries(
  WIDGET_REGISTRY.map((w) => [w.id, w]),
);

/** The layout a fresh install starts from. */
export const defaultDashboardLayout = (): DashboardLayoutEntry[] =>
  WIDGET_REGISTRY.map((w) => ({ id: w.id, enabled: w.defaultEnabled }));

/**
 * Reconcile a persisted layout against the registry. Always use this instead of
 * reading `preferences.dashboardLayout` directly:
 *
 *  - `undefined` (every install that predates this feature) yields the defaults.
 *  - Widgets removed from the registry are dropped, so a stale id can't render
 *    as a gap or crash the renderer lookup.
 *  - Widgets added in a newer app version are appended with their default
 *    enabled state, so an upgrade never hides new work behind a reset.
 *
 * The input is treated as untrusted. It round-trips through the backup file on
 * Google Drive (see SyncService), so it can come back malformed, or shaped by an
 * app version that knew a different set of widgets. Anything unrecognizable
 * degrades to the defaults rather than throwing — a restore must never leave the
 * user staring at a crashed dashboard.
 */
export const resolveDashboardLayout = (
  stored: DashboardLayoutEntry[] | undefined,
): DashboardLayoutEntry[] => {
  if (!Array.isArray(stored) || stored.length === 0) return defaultDashboardLayout();

  const seen = new Set<string>();
  const resolved: DashboardLayoutEntry[] = [];

  for (const entry of stored) {
    if (!entry || typeof entry.id !== 'string') continue;
    if (!WIDGET_BY_ID[entry.id] || seen.has(entry.id)) continue;
    seen.add(entry.id);
    resolved.push({ id: entry.id, enabled: !!entry.enabled });
  }

  for (const w of WIDGET_REGISTRY) {
    if (!seen.has(w.id)) resolved.push({ id: w.id, enabled: w.defaultEnabled });
  }

  return resolved;
};

/** Convenience: the ordered ids the dashboard should actually render. */
export const visibleWidgetIds = (
  stored: DashboardLayoutEntry[] | undefined,
): WidgetId[] =>
  resolveDashboardLayout(stored)
    .filter((w) => w.enabled)
    .map((w) => w.id as WidgetId);
