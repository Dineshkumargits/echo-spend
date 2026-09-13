import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LucideZap, LucideLock } from 'lucide-react-native';
import { ThemedText } from './ThemedSafeAreaView';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, withAlpha } from '../theme/tokens';
import { useEntitlement } from '../hooks/useEntitlement';
import { PaywallTrigger } from '../config/features';

interface ProBadgeProps {
  /** Optional paywall trigger when tapped */
  trigger?: PaywallTrigger;
  /** Force display regardless of entitlement source */
  showAlways?: boolean;
}

/**
 * Subtle indicator badge shown next to Pro features.
 * - Displays "PRO TRIAL" when user is in active 14-day trial.
 * - Displays "PRO" with lock icon when user is on Free tier.
 * - Hidden when user has a permanent/paid Pro plan unless `showAlways` is true.
 */
export const ProBadge: React.FC<ProBadgeProps> = ({
  trigger = 'settings',
  showAlways = false,
}) => {
  const { entitlement, isPro } = useEntitlement();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const isTrial = isPro && entitlement.source === 'trial';
  const isFree = !isPro;

  // Don't render badge for active subscribers/founders unless forced
  if (!showAlways && !isTrial && !isFree) return null;

  const handlePress = () => {
    navigation.navigate('Paywall', { trigger });
  };

  const label = isTrial ? 'PRO TRIAL' : 'PRO';

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.badge,
        {
          backgroundColor: withAlpha(colors.accent, '18'),
          borderColor: withAlpha(colors.accent, '35'),
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {isTrial ? (
        <LucideZap color={colors.accent} size={10} style={styles.icon} />
      ) : (
        <LucideLock color={colors.accent} size={10} style={styles.icon} />
      )}
      <ThemedText style={[styles.text, { color: colors.accent }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: radius.pill,
    borderWidth: 1,
    gap: 3,
  },
  icon: {
    marginRight: 1,
  },
  text: {
    fontFamily: fonts.signal,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

export default ProBadge;
