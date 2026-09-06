import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import {
  Entitlement,
  deriveEntitlement,
  isOnGrace,
  isProEntitlement,
} from '../services/entitlements';
import {
  FeatureKey,
  LimitKey,
  canAddMore,
  isGated,
  limitFor,
} from '../config/features';

/**
 * The only way a screen should ask about Pro.
 *
 * Nothing outside services/entitlements may touch billing, and nothing outside
 * config/features may hardcode a limit — this hook is the seam between them.
 *
 * While ENFORCEMENT_ENABLED is false this always reports Pro, so wiring a
 * screen up to it now is a no-op that can be reviewed on its own.
 */
export interface EntitlementApi {
  entitlement: Entitlement;
  isPro: boolean;
  /** Pro is being honoured from a cached answer. Display only; gates nothing. */
  onGrace: boolean;
  /** True when this capability is locked for the current user. */
  locked: (key: FeatureKey) => boolean;
  /** The user's ceiling for a countable thing; Infinity for Pro. */
  limit: (key: LimitKey) => number;
  /** True when one more may be created without crossing the free limit. */
  canAdd: (key: LimitKey, currentCount: number) => boolean;
}

export const useEntitlement = (): EntitlementApi => {
  // Subscribed to the persisted values rather than a derived object, so this
  // re-renders exactly when Play's answer changes and not on every store write.
  const stored = useStore((s) => s.proEntitlement);
  const verifiedAt = useStore((s) => s.entitlementVerifiedAt);

  return useMemo(() => {
    const entitlement = deriveEntitlement(stored, verifiedAt);
    const pro = isProEntitlement(entitlement);

    return {
      entitlement,
      isPro: pro,
      onGrace: isOnGrace(stored, verifiedAt),
      locked: (key: FeatureKey) => isGated(key, pro),
      limit: (key: LimitKey) => limitFor(key, pro),
      canAdd: (key: LimitKey, currentCount: number) =>
        canAddMore(key, currentCount, pro),
    };
  }, [stored, verifiedAt]);
};
