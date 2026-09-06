import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { PremiumGate } from './AnalyticsKit';
import { useEntitlement } from '../hooks/useEntitlement';
import { FeatureKey, PaywallTrigger } from '../config/features';

/**
 * Entitlement-aware wrapper around PremiumGate.
 *
 * PremiumGate owns the *look* of a locked section (dimmed content plus a lock
 * pill) and takes a raw boolean. Gate owns the *decision*, so screens name a
 * feature instead of computing `isPremium` themselves — which is how
 * AnalyticsScreen ended up with a hardcoded `const isPremium = true`.
 *
 * Tapping a locked section opens the paywall, carrying the trigger through so
 * the headline matches what the user was actually reaching for. Pass `onUnlock`
 * only to override that.
 */
export const Gate: React.FC<{
  feature: FeatureKey;
  /** Recorded for conversion attribution when the paywall opens. */
  trigger?: PaywallTrigger;
  title?: string;
  onUnlock?: (trigger: PaywallTrigger) => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}> = ({ feature, trigger = 'analytics_gate', title, onUnlock, children, style }) => {
  const { locked } = useEntitlement();
  const navigation = useNavigation<any>();

  return (
    <PremiumGate
      premium={!locked(feature)}
      title={title}
      onUnlock={() =>
        onUnlock
          ? onUnlock(trigger)
          : navigation.navigate('Paywall', { trigger })
      }
      style={style}
    >
      {children}
    </PremiumGate>
  );
};
