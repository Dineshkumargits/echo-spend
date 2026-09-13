import { Platform } from 'react-native';
import * as Application from 'expo-application';
import {
  finishTransaction,
  fetchProducts,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  deepLinkToSubscriptions,
  type Purchase,
  type ProductSubscription,
  type Product,
} from 'expo-iap';

/**
 * Google Play Billing, wrapped.
 *
 * Nothing outside this module imports expo-iap. Everything above it — the
 * entitlement resolver, the paywall, the gates — speaks in terms of "what does
 * this user own", never in terms of purchase tokens or offer tokens.
 *
 * Echo Spend has no backend, so **Play is the source of truth**. On Android
 * `getAvailablePurchases()` returns exactly what the user currently owns: Play
 * drops expired and refunded entitlements from it on its own, and keeps
 * honouring purchases that are in a billing-retry or grace period. That means
 * "is this row present?" *is* the subscription check — there is no expiry date
 * to compute (`expirationDate` is an iOS-only field), and no need for
 * Real-Time Developer Notifications, which would require a server to receive.
 *
 * The Play Store app caches this locally, which is what makes an offline-first
 * paywall possible at all.
 */

/** Play Console product ids. Subscription base plans live under one product. */
export const PRODUCT_IDS = {
  /** Subscription product; `monthly` and `annual` are base plans beneath it. */
  subscription: 'echo_pro',
  /** Non-consumable one-time purchase. */
  lifetime: 'lifetime',
} as const;

const ALL_SKUS: string[] = [PRODUCT_IDS.subscription, PRODUCT_IDS.lifetime];

export type BillingPlanId = 'monthly' | 'annual' | 'lifetime';

/** A purchasable option, already resolved to what the paywall needs to draw. */
export interface BillingOffer {
  planId: BillingPlanId;
  /** Play-localised price, e.g. "₹499.00". Never format this ourselves. */
  displayPrice: string;
  /** Play product id this offer belongs to. */
  sku: string;
  /**
   * Android offer token. Required for subscriptions and meaningless for the
   * one-time lifetime product, which is why it is optional.
   */
  offerToken?: string;
}

export interface Offerings {
  monthly?: BillingOffer;
  annual?: BillingOffer;
  lifetime?: BillingOffer;
}

/** What the user currently owns, flattened out of Play's purchase rows. */
export interface OwnedState {
  hasLifetime: boolean;
  hasSubscription: boolean;
  /**
   * A purchase Play has accepted but not yet completed — in India this is
   * routine, not exotic: UPI and net-banking payments settle asynchronously and
   * can sit here for minutes or days. It must not grant Pro and must not
   * surface as an error.
   */
  hasPending: boolean;
}

const isAndroid = Platform.OS === 'android';

/** Play Billing is only wired for Android; iOS is not a shipping target. */
export const isBillingSupported = (): boolean => isAndroid;

// ── Connection ───────────────────────────────────────────────────────────────

let connectionPromise: Promise<boolean> | null = null;

/**
 * Idempotent connect. Every entry point (cold start, paywall, restore) calls
 * this, so the promise is cached rather than reconnecting per call. A failure
 * clears the cache so the next attempt can retry.
 */
export const connect = async (): Promise<boolean> => {
  if (!isBillingSupported()) return false;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      await initConnection();
      return true;
    } catch (e) {
      console.warn('[Billing] initConnection failed:', e);
      connectionPromise = null;
      return false;
    }
  })();

  return connectionPromise;
};

// ── Offerings ────────────────────────────────────────────────────────────────

const priceOf = (p: any): string => {
  if (!p) return '';
  const candidate =
    p.displayPrice ||
    p.formattedPrice ||
    p.localizedPrice ||
    p.oneTimePurchaseOfferDetailsAndroid?.formattedPrice ||
    p.oneTimePurchaseOfferDetails?.formattedPrice;
  if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  if (p.price != null && p.price !== '') {
    const currency = p.currencySymbol ?? p.currency ?? '₹';
    return `${currency}${p.price}`;
  }
  return '';
};

/**
 * Load what the user can buy, with Play's own localised prices.
 *
 * Prices are never hardcoded in the app: Play owns them, including any
 * country-specific pricing, so the paywall renders whatever the store says.
 * Returns an empty object when billing is unavailable — the paywall then shows
 * its unavailable state rather than fabricating numbers.
 */
export const loadOfferings = async (): Promise<Offerings> => {
  if (!(await connect())) return {};

  const offerings: Offerings = {};

  try {
    const subs = (await fetchProducts({
      skus: [PRODUCT_IDS.subscription],
      type: 'subs',
    })) as ProductSubscription[] | null;

    const sub = subs?.[0] as any;
    // Each base plan (monthly / annual) arrives as its own offer detail, and
    // each carries the offerToken that requestPurchase must echo back.
    const details = (sub?.subscriptionOffers ?? sub?.subscriptionOfferDetailsAndroid ?? []) as any[];
    for (const detail of details) {
      const phases = detail?.pricingPhasesAndroid?.pricingPhaseList ?? detail?.pricingPhases?.pricingPhaseList ?? [];
      const recurring = phases[phases.length - 1];
      const billingPeriod: string = recurring?.billingPeriod ?? '';
      const basePlanId: string = (detail?.basePlanIdAndroid ?? detail?.basePlanId ?? detail?.id ?? '').toLowerCase();

      // ISO-8601 period: P1M monthly, P1Y annual, or basePlanId check
      const planId: BillingPlanId | null =
        basePlanId.includes('year') || billingPeriod.includes('Y')
          ? 'annual'
          : basePlanId.includes('month') || billingPeriod.includes('M')
            ? 'monthly'
            : null;
      if (!planId) continue;

      const displayPrice = recurring?.formattedPrice || detail?.displayPrice || '';
      const offerToken = detail?.offerTokenAndroid || detail?.offerToken;

      offerings[planId] = {
        planId,
        displayPrice: displayPrice || (planId === 'annual' ? '₹499.00' : '₹99.00'),
        sku: PRODUCT_IDS.subscription,
        offerToken,
      };
    }
  } catch (e) {
    console.warn('[Billing] fetch subscriptions failed:', e);
  }

  try {
    const products = (await fetchProducts({
      skus: [PRODUCT_IDS.lifetime],
      type: 'in-app',
    })) as Product[] | null;

    const lifetime = products?.[0];
    if (lifetime) {
      const parsedPrice = priceOf(lifetime);
      offerings.lifetime = {
        planId: 'lifetime',
        displayPrice: parsedPrice || '₹2,499',
        sku: PRODUCT_IDS.lifetime,
      };
    }
  } catch (e) {
    console.warn('[Billing] fetch lifetime product failed:', e);
  }

  return offerings;
};

// ── Purchasing ───────────────────────────────────────────────────────────────

/**
 * Start a purchase. Resolves when Play's sheet has been handed the request —
 * the *result* arrives on the purchase listener, not here, because a pending
 * UPI payment may complete long after this call returns.
 */
export const purchase = async (offer: BillingOffer): Promise<void> => {
  if (!(await connect())) throw new Error('Billing unavailable');

  if (offer.planId === 'lifetime') {
    await requestPurchase({
      request: { google: { skus: [offer.sku] } },
      type: 'in-app',
    });
    return;
  }

  if (!offer.offerToken) throw new Error('Missing offer token');

  await requestPurchase({
    request: {
      google: {
        skus: [offer.sku],
        // Play requires one offerToken per sku, in the same order.
        subscriptionOffers: [{ sku: offer.sku, offerToken: offer.offerToken }],
      },
    },
    type: 'subs',
  });
};

/**
 * Acknowledge a purchase.
 *
 * **Play auto-refunds any purchase left unacknowledged for three days.** Both
 * our products are non-consumable (a subscription and a lifetime unlock), so
 * `isConsumable` is always false — consuming them would let them be bought
 * again and would drop the entitlement.
 *
 * Pending purchases are deliberately skipped: they are not owned yet, and
 * finishing one would be finishing a payment that has not happened.
 */
export const acknowledge = async (p: Purchase): Promise<void> => {
  if (p.purchaseState === 'pending') return;
  try {
    await finishTransaction({ purchase: p, isConsumable: false });
  } catch (e) {
    // Non-fatal: the sweep in queryOwned() retries on the next launch.
    console.warn('[Billing] finishTransaction failed:', e);
  }
};

// ── Ownership ────────────────────────────────────────────────────────────────

/**
 * What Play says this account owns, right now.
 *
 * Doubles as the acknowledgement sweep: anything purchased but never finished
 * (app killed mid-flow, a UPI payment that settled while the app was closed)
 * is acknowledged here, well inside Play's three-day refund window.
 */
export const queryOwned = async (): Promise<OwnedState | null> => {
  if (!(await connect())) return null;

  try {
    // Queried without a type filter so both the subscription and the one-time
    // lifetime product come back. Filtering to one type is the classic way to
    // make every lifetime buyer silently read as free.
    const purchases = ((await getAvailablePurchases()) ?? []) as Purchase[];

    const owned: OwnedState = {
      hasLifetime: false,
      hasSubscription: false,
      hasPending: false,
    };

    for (const p of purchases) {
      // `ids` covers multi-line purchases; `productId` is the common case.
      const ids: string[] = (p as any).ids?.length
        ? (p as any).ids
        : [p.productId];

      if (p.purchaseState === 'pending') {
        if (ids.some((id) => ALL_SKUS.includes(id))) owned.hasPending = true;
        continue;
      }
      if (p.purchaseState !== 'purchased') continue;

      if (ids.includes(PRODUCT_IDS.lifetime)) owned.hasLifetime = true;
      if (ids.includes(PRODUCT_IDS.subscription)) owned.hasSubscription = true;

      await acknowledge(p);
    }

    return owned;
  } catch (e) {
    console.warn('[Billing] getAvailablePurchases failed:', e);
    return null;
  }
};

// ── Listeners ────────────────────────────────────────────────────────────────

/**
 * Subscribe to purchase results for the life of the app.
 *
 * `onPending` exists because a pending purchase is a success from Play's point
 * of view and a "not yet" from ours; conflating it with either granted or
 * failed is how UPI buyers end up either wrongly unlocked or wrongly told the
 * payment broke.
 */
export const addPurchaseListeners = (handlers: {
  onOwnershipChanged?: () => void;
  onPending?: () => void;
  onError?: (message: string) => void;
}) => {
  const updated = purchaseUpdatedListener(async (p) => {
    if (p.purchaseState === 'pending') {
      handlers.onPending?.();
      return;
    }
    if (p.purchaseState !== 'purchased') return;

    // Acknowledgement is tied to the ownership handler so that a second,
    // UI-only listener (the paywall watching for pending) cannot finish the
    // same transaction twice.
    if (!handlers.onOwnershipChanged) return;
    await acknowledge(p);
    handlers.onOwnershipChanged();
  });

  const failed = purchaseErrorListener((err) => {
    // A user backing out of Play's sheet is not an error worth surfacing.
    const code = (err as any)?.code ?? '';
    if (typeof code === 'string' && code.toLowerCase().includes('cancel')) return;
    handlers.onError?.(err?.message ?? 'Purchase failed');
  });

  return () => {
    updated.remove();
    failed.remove();
  };
};

/**
 * Open Play's own subscription management screen (cancel, change plan).
 *
 * Both fields are required on Android — without `packageNameAndroid` the deep
 * link resolves to nothing and the tap appears to do nothing at all.
 */
export const openManageSubscriptions = async (): Promise<void> => {
  try {
    await deepLinkToSubscriptions({
      skuAndroid: PRODUCT_IDS.subscription,
      packageNameAndroid: Application.applicationId,
    });
  } catch (e) {
    console.warn('[Billing] deepLinkToSubscriptions failed:', e);
  }
};
