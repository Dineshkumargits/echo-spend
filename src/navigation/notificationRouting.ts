/**
 * Maps a notification's `data.screen` onto an actual navigation target.
 *
 * Two things made every notification tap land on the dashboard:
 *
 * 1. The old handler called `navigationRef.navigate(screen)` with names like
 *    'Home', 'Analytics' and 'Txns'. Those are NOT routes on the root stack —
 *    they are tabs nested inside the stack's 'Main' route. Navigating to a name
 *    the root navigator doesn't know is a no-op, so the app simply stayed
 *    wherever it was, which is the dashboard. Nested tabs must be addressed as
 *    `navigate('Main', { screen: <tab> })`.
 *
 * 2. It bailed out on `!navigationRef.isReady()` with no retry. On a cold start —
 *    the app launched BY the tap — the container is never ready that early, so
 *    the target was discarded every time.
 *
 * Keep this table in sync with AppNavigator (root stack) and TabNavigator.
 */

/** Tabs living inside the root stack's 'Main' route. */
const TAB_ROUTES = new Set(['Home', 'Analytics', 'Scan', 'Txns', 'Settings']);

/** Screens registered directly on the root stack. */
const STACK_ROUTES = new Set([
  'ManageAccounts', 'SmartInbox', 'Categories', 'Search', 'AddTransaction',
  'AddAccount', 'EditTransaction', 'SmartScan', 'AddGoal', 'AddLoan',
  'AddSubscription', 'Subscriptions', 'TransactionDetail', 'BankAccountDetail',
  'SplitExpense', 'SplitDetail', 'Finances', 'Budget', 'Tips', 'AIModelSetup',
  'AccountBackup', 'Paywall',
]);

/** Older builds shipped notifications carrying these names. */
const ALIASES: Record<string, string> = {
  Dashboard: 'Home',
  Charts: 'Analytics',
  More: 'Settings',
  Transactions: 'Txns',
};

export type NavTarget = { name: string; params?: object };

/**
 * Resolve a notification payload to a navigation target, or null when the
 * payload names nothing navigable (e.g. the sync notification, which carries
 * `triggerSync` instead of `screen`).
 */
export function resolveNotificationTarget(
  data: Record<string, any> | undefined | null,
): NavTarget | null {
  const raw = data?.screen;
  if (typeof raw !== 'string' || !raw) return null;

  const screen = ALIASES[raw] ?? raw;

  if (TAB_ROUTES.has(screen)) {
    return { name: 'Main', params: { screen } };
  }
  if (STACK_ROUTES.has(screen)) {
    return { name: screen };
  }

  console.warn(`[NotificationRouting] Unknown target screen "${raw}" — ignoring.`);
  return null;
}

// ─── Deferred navigation ─────────────────────────────────────────────────────

let _pending: NavTarget | null = null;

/**
 * Navigate now if the container is ready, otherwise hold the target until it is.
 *
 * A tap that launches the app arrives long before NavigationContainer mounts,
 * and onboarding can delay it further still. Holding one target (the newest
 * wins — the user's most recent tap is the one they meant) and flushing it from
 * `onReady` is what makes cold-start deep links work at all.
 */
export function navigateWhenReady(
  nav: { isReady: () => boolean; navigate: (name: any, params?: any) => void },
  target: NavTarget,
): void {
  if (!nav.isReady()) {
    console.log(`[NotificationRouting] Container not ready — queueing "${target.name}".`);
    _pending = target;
    return;
  }
  console.log(`[NotificationRouting] Navigating to "${target.name}".`);
  nav.navigate(target.name, target.params);
}

/** Called from NavigationContainer.onReady to deliver any queued target. */
export function flushPendingNavigation(
  nav: { isReady: () => boolean; navigate: (name: any, params?: any) => void },
): void {
  if (!_pending || !nav.isReady()) return;
  const target = _pending;
  _pending = null;
  console.log(`[NotificationRouting] Flushing queued target "${target.name}".`);
  nav.navigate(target.name, target.params);
}
