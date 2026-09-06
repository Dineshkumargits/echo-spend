/**
 * The free/Pro feature matrix.
 *
 * Every limit and every gated capability lives here as data, so the answer to
 * "what does free actually get?" is one file, not thirty scattered `if` checks.
 * Screens ask `limitFor()` / `isGated()`; they never hardcode a number.
 *
 * Two rules this matrix is built around, and which any future edit must respect:
 *
 *  1. Capture is never gated. Real-time SMS capture, the Smart Inbox, manual
 *     entry and editing are the habit the whole app rests on. Gating them
 *     leaves nothing to upsell.
 *  2. The user's data is never held hostage. CSV export, Drive backup and
 *     restore, and editing anything already recorded stay free forever —
 *     including for a lapsed subscriber.
 *
 * What IS gated: the archive (history depth), interpretation (analytics),
 * automation (background work), volume (entity counts), and polish.
 *
 * The on-device AI parser is deliberately NOT a Pro feature. The regex parser
 * is the fast, accurate default path; AI is an optional extra for unusual SMS
 * formats and stays free for everyone.
 */

/** A countable limit — free users get a number, Pro users get Infinity. */
export type LimitKey =
  | 'accounts'
  | 'budgets'
  | 'subscriptions'
  | 'loans'
  | 'goals'
  /** How many days back a Smart Scan may read SMS. */
  | 'scanHistoryDays'
  /** Longest trend window selectable in Analytics. */
  | 'trendDays'
  /** Insights kept in the deck per salary cycle. */
  | 'insightsPerCycle'
  /** Curated theme packs available, counted from the start of THEMES. */
  | 'themePacks';

/** An on/off capability. */
export type FeatureKey =
  // ── Interpretation ──
  | 'merchantAnalytics'
  | 'spendingPatterns'
  | 'cycleComparison'
  | 'customDateRange'
  | 'categoryDrilldown'
  // ── Automation ──
  // Note: no 'backgroundSmsScan' here on purpose. In this codebase there is a
  // single preference (autoSmsScan) that both processIncomingSms and the
  // periodic BACKGROUND_SMS_SCAN_TASK check — it IS real-time capture, not a
  // convenience layered on top of it. Gating it would violate the capture
  // rule above, so it stays free and ungated; only scheduled backup and the
  // notification automations below are genuine convenience layers.
  | 'scheduledBackup'
  | 'budgetAlerts'
  | 'billReminders'
  | 'weeklyDigest'
  // ── Polish ──
  | 'customDashboard';

export const FREE_LIMITS: Record<LimitKey, number> = {
  accounts: 3,
  budgets: 3,
  subscriptions: 5,
  loans: 2,
  goals: 1,
  scanHistoryDays: 90,
  trendDays: 30,
  insightsPerCycle: 1,
  themePacks: 1,
};

/** Capabilities free users do NOT have. Anything absent here is free. */
export const GATED_FEATURES: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  'merchantAnalytics',
  'spendingPatterns',
  'cycleComparison',
  'customDateRange',
  'categoryDrilldown',
  'scheduledBackup',
  'budgetAlerts',
  'billReminders',
  'weeklyDigest',
  'customDashboard',
]);

/**
 * Where a paywall was opened from. Recorded so conversion can be attributed
 * without a backend (Play Console and Firebase see the trigger; no server does).
 */
export type PaywallTrigger =
  | 'trial_ended'
  | 'cycle_close'
  | 'scan_history_wall'
  | 'analytics_gate'
  | 'automation_toggle'
  | 'limit_reached'
  | 'settings'
  | 'founder_card';

export const limitFor = (key: LimitKey, isPro: boolean): number =>
  isPro ? Infinity : FREE_LIMITS[key];

export const isGated = (key: FeatureKey, isPro: boolean): boolean =>
  !isPro && GATED_FEATURES.has(key);

/**
 * True when adding one more would stay within the free limit.
 *
 * Deliberately a "can I add?" question, never a "should I hide?" question: a
 * lapsed subscriber sitting above the limit keeps seeing everything they
 * already created — over-limit items go read-only, they are never hidden or
 * deleted. See services/entitlements for the degradation contract.
 */
export const canAddMore = (key: LimitKey, currentCount: number, isPro: boolean): boolean =>
  currentCount < limitFor(key, isPro);
