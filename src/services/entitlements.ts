import { useStore } from '../store/useStore';
import { queryOwned, type OwnedState } from './billing';

/**
 * Entitlement — the single source of truth for "is this install Pro?".
 *
 * Echo Spend has no backend, so Google Play *is* the server. This module is the
 * only place that knows that: screens ask `useEntitlement()`, and nothing above
 * it ever touches a billing API.
 *
 * ── Status ───────────────────────────────────────────────────────────────────
 * Steps 1-2 of 4 are in. `ENFORCEMENT_ENABLED` is still false, so
 * `deriveEntitlement()` reports Pro for everyone and behaviour is unchanged.
 * Step 3 adds the founder grant and the trial clock; only then does step 4 flip
 * the flag, so no existing user is downgraded by a release that merely lands
 * the code.
 *
 * ── Precedence ───────────────────────────────────────────────────────────────
 * lifetime > founder > play_sub > trial > free.
 *
 * ── Two kinds of grant ───────────────────────────────────────────────────────
 * `lifetime` and `founder` are **permanent**: no clock, no verification needed.
 *
 * `play_sub` is **presence-based**. On Android, presence in
 * `getAvailablePurchases()` IS the check — Play removes expired and refunded
 * entitlements itself and keeps returning purchases that are in billing retry
 * or a store-side grace period. (`expirationDate` is iOS-only, so there is no
 * date to store.) It follows that a subscription is only as good as the last
 * time Play confirmed it, which is what GRACE_WINDOW_MS bounds.
 *
 * `trial` is **time-boxed** and carries its own deadline.
 *
 * ── Degradation contract ─────────────────────────────────────────────────────
 * A lapse must never destroy or hide anything. A user who drops to free with
 * twelve accounts still sees all twelve; they simply cannot add a thirteenth,
 * and over-limit items become read-only. Export and Drive restore stay free
 * unconditionally — see config/features.
 */

export type EntitlementTier = 'free' | 'pro';

export type EntitlementSource =
  /** Local 14-day trial from first install; no card. Step 3. */
  | 'trial'
  /** Active Play subscription (monthly or annual base plan). */
  | 'play_sub'
  /** One-time `echo_pro_lifetime` purchase. */
  | 'lifetime'
  /** Installed before the paywall shipped — permanent thank-you grant. Step 3. */
  | 'founder'
  | 'none';

export interface Entitlement {
  tier: EntitlementTier;
  source: EntitlementSource;
  /** ISO deadline for time-boxed grants (the trial). null otherwise. */
  expiresAt: string | null;
}

/**
 * Master switch for the paywall.
 *
 * Stays false until steps 3-4 have shipped and every existing install has been
 * stamped with its founder grant. Flipping this is a deliberate, separate
 * release — never a side effect of landing gating code.
 */
export const ENFORCEMENT_ENABLED = false;

/**
 * How long a subscription keeps working while Play cannot be reached.
 *
 * This is not Play's own billing grace period (Play handles that server-side
 * and keeps returning the purchase); it is purely how long we trust a cached
 * answer on a device that has been offline.
 */
export const GRACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Length of the no-card local trial. Consumed in step 3. */
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** Minimum gap between Play round trips, outside of explicit user actions. */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const FREE: Entitlement = { tier: 'free', source: 'none', expiresAt: null };
const UNGATED: Entitlement = { tier: 'pro', source: 'founder', expiresAt: null };

export const isProEntitlement = (e: Entitlement): boolean => e.tier === 'pro';

/** Permanent grants need no clock and no network. */
const isPermanent = (source: EntitlementSource): boolean =>
  source === 'lifetime' || source === 'founder';

/**
 * The current entitlement, derived purely from persisted state.
 *
 * Pure and synchronous on purpose: gating decisions happen during render, so
 * this never touches Play. `refreshEntitlement()` is what talks to the store
 * and writes the state this reads.
 *
 * Returns the SAME object identity as `stored` whenever the grant still
 * stands, so React memoisation downstream holds.
 */
export const deriveEntitlement = (
  stored: Entitlement | null,
  verifiedAt: string | null,
  now: number = Date.now(),
): Entitlement => {
  if (!ENFORCEMENT_ENABLED) return UNGATED;
  if (!stored || stored.tier !== 'pro') return FREE;

  if (isPermanent(stored.source)) return stored;

  // Time-boxed: the trial carries its own deadline.
  if (stored.expiresAt) {
    const deadline = new Date(stored.expiresAt).getTime();
    return Number.isFinite(deadline) && now <= deadline ? stored : FREE;
  }

  // Presence-based: good only as long as Play's last confirmation is fresh
  // enough. No verification stamp at all means we have never confirmed it, so
  // it cannot be honoured.
  if (!verifiedAt) return FREE;
  const graceDeadline = new Date(verifiedAt).getTime() + GRACE_WINDOW_MS;

  // A future-dated stamp (clock change, restored backup) would otherwise extend
  // grace indefinitely, so treat an implausible deadline as expired.
  if (!Number.isFinite(graceDeadline) || now > graceDeadline) return FREE;

  return stored;
};

/**
 * True when Pro is currently being honoured from a cached answer rather than a
 * fresh one — i.e. we are inside the grace window but overdue for a check.
 * Purely for UI ("Offline — Pro active until …"); it never gates anything.
 */
export const isOnGrace = (
  stored: Entitlement | null,
  verifiedAt: string | null,
  now: number = Date.now(),
): boolean => {
  if (!stored || stored.tier !== 'pro' || isPermanent(stored.source)) return false;
  if (stored.expiresAt || !verifiedAt) return false;
  const age = now - new Date(verifiedAt).getTime();
  return age > REFRESH_INTERVAL_MS && age < GRACE_WINDOW_MS;
};

/** Convenience read of the live store, for non-React callers. */
export const currentEntitlement = (): Entitlement => {
  const { proEntitlement, entitlementVerifiedAt } = useStore.getState();
  return deriveEntitlement(proEntitlement, entitlementVerifiedAt);
};

export const isPro = (): boolean => isProEntitlement(currentEntitlement());

/**
 * Ask Play what this account owns and persist the answer.
 *
 * Called on cold start and on foreground (throttled), and unthrottled after a
 * purchase or an explicit "Restore purchases". Never throws: an unreachable
 * Play must not break a session, it just leaves the user on grace.
 *
 * Returns Play's raw answer alongside the entitlement so a caller that needs
 * to distinguish "nothing owned" from "payment still pending" — the restore
 * button — does not have to query Play a second time.
 *
 * @param force skip the throttle (purchase completed, manual restore).
 */
export const refreshEntitlement = async (
  force = false,
): Promise<{ entitlement: Entitlement; owned: OwnedState | null }> => {
  const { entitlementVerifiedAt, setProEntitlement } = useStore.getState();

  if (!force && entitlementVerifiedAt) {
    const elapsed = Date.now() - new Date(entitlementVerifiedAt).getTime();
    if (elapsed >= 0 && elapsed < REFRESH_INTERVAL_MS) {
      return { entitlement: currentEntitlement(), owned: null };
    }
  }

  const owned = await queryOwned();

  // Play unreachable. Leave the stored entitlement and its verification stamp
  // exactly as they are — deriveEntitlement() turns that into grace on its own,
  // and re-stamping here would silently extend grace forever.
  if (!owned) return { entitlement: currentEntitlement(), owned: null };

  const next: Entitlement = owned.hasLifetime
    ? { tier: 'pro', source: 'lifetime', expiresAt: null }
    : owned.hasSubscription
      ? { tier: 'pro', source: 'play_sub', expiresAt: null }
      : FREE;

  const verifiedAt = new Date().toISOString();
  setProEntitlement(next, verifiedAt);
  return { entitlement: deriveEntitlement(next, verifiedAt), owned };
};
