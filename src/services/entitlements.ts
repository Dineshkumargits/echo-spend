import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { useStore } from '../store/useStore';
import { queryOwned, type OwnedState } from './billing';
import { ensureFirstSeenAt, ensureTrialStarted, getTrialStartedAt } from './database';

/**
 * Entitlement — the single source of truth for "is this install Pro?".
 *
 * Echo Spend has no backend, so Google Play *is* the server. This module is the
 * only place that knows that: screens ask `useEntitlement()`, and nothing above
 * it ever touches a billing API.
 *
 * ── Status ───────────────────────────────────────────────────────────────────
 * All 4 steps are in. `ENFORCEMENT_ENABLED` is true: gates in config/features
 * are now live for anyone who is not founder/lifetime/subscribed/mid-trial.
 * Every install already on a device before FOUNDER_CUTOFF_ISO carries the
 * founder grant from bootstrapLocalEntitlement's backdated first_seen_at, so
 * this did not retroactively downgrade anyone using the app already.
 *
 * ── Precedence ───────────────────────────────────────────────────────────────
 * lifetime > founder > play_sub > trial > free. Ranked in RANK below; the
 * winner is whichever of the Play-verified and local grants outranks the
 * other, so a founder who also happens to buy lifetime is simply lifetime, and
 * a subscriber who was also grandfathered keeps Pro if either one lapses.
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
 * ── Founder grant ────────────────────────────────────────────────────────────
 * Anyone whose install predates FOUNDER_CUTOFF_ISO gets Pro, permanently, free.
 * Existing users have real usage history — see getEarliestActivityDate() in
 * services/database — which is what "predates" is measured against, backdating
 * first_seen_at rather than trusting "now" the first time this code runs on an
 * install that has been in daily use for months. See bootstrapLocalEntitlement.
 *
 * ── Degradation contract ─────────────────────────────────────────────────────
 * A lapse must never destroy or hide anything. A user who drops to free with
 * twelve accounts still sees all twelve; they simply cannot add a thirteenth,
 * and over-limit items become read-only. Export and Drive restore stay free
 * unconditionally — see config/features.
 */

export type EntitlementTier = 'free' | 'pro';

export type EntitlementSource =
  /** Local 14-day trial from first install; no card. */
  | 'trial'
  /** Active Play subscription (monthly or annual base plan). */
  | 'play_sub'
  /** One-time `echo_pro_lifetime` purchase. */
  | 'lifetime'
  /** Installed before the paywall shipped — permanent thank-you grant. */
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
 * Flipped true 2026-09-06, the same release that pins FOUNDER_CUTOFF_ISO
 * below — every install already on a device before this release ships gets
 * the founder grant via bootstrapLocalEntitlement's backdated first_seen_at,
 * so this is not a retroactive downgrade for anyone using the app today.
 */
export const ENFORCEMENT_ENABLED = true;

/**
 * Installs that predate this are grandfathered permanently, free.
 *
 * Pinned to the release date of the build that flips ENFORCEMENT_ENABLED
 * above. MUST NOT move backward from here — moving it later would leave a
 * window of installs that are neither founder nor have a full trial ahead of
 * them, and moving it earlier could strip someone who already earned founder
 * status under the original date.
 */
export const FOUNDER_CUTOFF_ISO = '2026-09-06T00:00:00.000Z';

/**
 * How long a subscription keeps working while Play cannot be reached.
 *
 * This is not Play's own billing grace period (Play handles that server-side
 * and keeps returning the purchase); it is purely how long we trust a cached
 * answer on a device that has been offline.
 */
export const GRACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Length of the no-card local trial. */
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** Minimum gap between Play round trips, outside of explicit user actions. */
export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

const FREE: Entitlement = { tier: 'free', source: 'none', expiresAt: null };
const UNGATED: Entitlement = { tier: 'pro', source: 'founder', expiresAt: null };

const RANK: Record<EntitlementSource, number> = {
  lifetime: 4,
  founder: 3,
  play_sub: 2,
  trial: 1,
  none: 0,
};

export const isProEntitlement = (e: Entitlement): boolean => e.tier === 'pro';

/** Permanent grants need no clock and no network. */
const isPermanent = (source: EntitlementSource): boolean =>
  source === 'lifetime' || source === 'founder';

/** The Play-derived half of the merge: lifetime/play_sub, clocked by grace. */
const derivePlayEntitlement = (
  stored: Entitlement | null,
  verifiedAt: string | null,
  now: number,
): Entitlement => {
  if (!stored || stored.tier !== 'pro') return FREE;
  if (stored.source === 'lifetime') return stored;
  if (stored.source !== 'play_sub') return FREE;

  // Presence-based: good only as long as Play's last confirmation is fresh
  // enough. No verification stamp at all means we have never confirmed it.
  if (!verifiedAt) return FREE;
  const graceDeadline = new Date(verifiedAt).getTime() + GRACE_WINDOW_MS;

  // A future-dated stamp (clock change, restored backup) would otherwise extend
  // grace indefinitely, so treat an implausible deadline as expired.
  if (!Number.isFinite(graceDeadline) || now > graceDeadline) return FREE;
  return stored;
};

/** The local half of the merge: founder (permanent) or trial (clocked). */
const deriveLocalEntitlement = (
  local: Entitlement | null,
  now: number,
): Entitlement => {
  if (!local || local.tier !== 'pro') return FREE;
  if (local.source === 'founder') return local;
  if (local.source !== 'trial') return FREE;

  if (!local.expiresAt) return FREE;
  const deadline = new Date(local.expiresAt).getTime();
  return Number.isFinite(deadline) && now <= deadline ? local : FREE;
};

/** Whichever entitlement outranks the other. Ties are impossible: distinct sources. */
const pickBest = (a: Entitlement, b: Entitlement): Entitlement =>
  RANK[a.source] >= RANK[b.source] ? a : b;

/**
 * The current entitlement, derived purely from persisted state.
 *
 * Pure and synchronous on purpose: gating decisions happen during render, so
 * this never touches Play or SQLite. `refreshEntitlement()` writes the Play
 * half of the state this reads; `bootstrapLocalEntitlement()` writes the local
 * (founder/trial) half, once, at cold start.
 */
export const deriveEntitlement = (
  stored: Entitlement | null,
  verifiedAt: string | null,
  local: Entitlement | null = null,
  now: number = Date.now(),
): Entitlement => {
  if (!ENFORCEMENT_ENABLED) return UNGATED;

  const playSide = derivePlayEntitlement(stored, verifiedAt, now);
  const localSide = deriveLocalEntitlement(local, now);
  return pickBest(playSide, localSide);
};

/**
 * True when Pro is currently being honoured from a cached Play answer rather
 * than a fresh one — i.e. we are inside the grace window but overdue for a
 * check. Purely for UI ("Offline — Pro active until …"); never gates anything.
 * A local grant (founder/trial) is never "on grace" — there is nothing to
 * re-verify for either.
 */
export const isOnGrace = (
  stored: Entitlement | null,
  verifiedAt: string | null,
  local: Entitlement | null = null,
  now: number = Date.now(),
): boolean => {
  if (isProEntitlement(deriveLocalEntitlement(local, now))) return false;
  if (!stored || stored.tier !== 'pro' || stored.source !== 'play_sub' || !verifiedAt) {
    return false;
  }
  const age = now - new Date(verifiedAt).getTime();
  return age > REFRESH_INTERVAL_MS && age < GRACE_WINDOW_MS;
};

/** Convenience read of the live store, for non-React callers. */
export const currentEntitlement = (): Entitlement => {
  const { proEntitlement, entitlementVerifiedAt, localEntitlement } = useStore.getState();
  return deriveEntitlement(proEntitlement, entitlementVerifiedAt, localEntitlement);
};

export const isPro = (): boolean => isProEntitlement(currentEntitlement());

/**
 * Days remaining in the trial, for display only ("3 days left in your trial").
 * null when there is no running trial (founder, already resolved, or expired).
 */
export const trialDaysRemaining = (
  local: Entitlement | null,
  now: number = Date.now(),
): number | null => {
  if (!local || local.source !== 'trial' || !local.expiresAt) return null;
  const deadline = new Date(local.expiresAt).getTime();
  if (!Number.isFinite(deadline)) return null;
  const msLeft = deadline - now;
  return msLeft > 0 ? Math.ceil(msLeft / (24 * 60 * 60 * 1000)) : 0;
};

/**
 * Establishes founder/trial status from real history. Runs once per cold
 * start (idempotent underneath — the SQLite writes it triggers are no-ops
 * after the first ever call), and is safe to call before ENFORCEMENT_ENABLED
 * is ever flipped: doing it now means every install's status is settled from
 * genuine history rather than "whatever the clock happened to read on the day
 * enforcement turned on".
 *
 * Requires the database to be initialized and the store to be hydrated —
 * call this alongside the other post-hydration bootstrap work in App.tsx, the
 * same place refreshEntitlement() and checkForUpdate() are gated.
 */
export const bootstrapLocalEntitlement = async (): Promise<void> => {
  const { localEntitlement, setLocalEntitlement } = useStore.getState();
  const nowIso = new Date().toISOString();

  // getEarliestActivityDate() backdates first_seen_at using real transaction/
  // account/salary history already on this device — see services/database —
  // so an existing install with months of usage is not mistaken for a fresh
  // one just because this is the first release that ever wrote the row.
  const firstSeenAt = await ensureFirstSeenAt(nowIso);

  // A second signal, independent of app data: the OS's own record of when this
  // package was first installed. It does not survive an uninstall or a Drive
  // restore to a new device, which is exactly why it is a fallback rather than
  // the primary signal — but it covers an existing install that happens to
  // have no transactions/accounts recorded yet (e.g. onboarding was completed
  // but Smart Scan never run).
  let installedAt: string | null = null;
  if (Platform.OS === 'android') {
    try {
      installedAt = (await Application.getInstallationTimeAsync())?.toISOString() ?? null;
    } catch {
      installedAt = null;
    }
  }

  const cutoff = new Date(FOUNDER_CUTOFF_ISO).getTime();
  const isFounder =
    (Number.isFinite(new Date(firstSeenAt).getTime()) && new Date(firstSeenAt).getTime() < cutoff) ||
    (installedAt !== null && new Date(installedAt).getTime() < cutoff);

  let next: Entitlement;
  if (isFounder) {
    next = { tier: 'pro', source: 'founder', expiresAt: null };
  } else {
    // Not founder: this is either a genuinely new install (first_seen_at is
    // "now", no earlier evidence existed) or an existing-but-unused install
    // that neither signal could vouch for. Either way it gets the standard
    // trial, timed from whichever came first — an already-running trial, or a
    // fresh one starting now.
    const existingTrialStart = await getTrialStartedAt();
    const trialStart = existingTrialStart ?? (await ensureTrialStarted(nowIso));
    const expiresAt = new Date(
      new Date(trialStart).getTime() + TRIAL_DURATION_MS,
    ).toISOString();
    next = { tier: 'pro', source: 'trial', expiresAt };
  }

  // Cheap, stable identity check avoids a redundant store write (and the
  // re-renders it would cause) on every cold start once status is settled.
  if (
    localEntitlement?.source !== next.source ||
    localEntitlement?.expiresAt !== next.expiresAt
  ) {
    setLocalEntitlement(next);
  }
};

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
  return {
    entitlement: deriveEntitlement(next, verifiedAt, useStore.getState().localEntitlement),
    owned,
  };
};
