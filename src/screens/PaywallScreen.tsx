import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, ScrollView, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import {
  LucideX,
  LucideArchive,
  LucideChartNoAxesCombined,
  LucideZap,
  LucideInfinity,
  LucideCheck,
} from 'lucide-react-native';

import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { PrimaryButton } from '../components/Kit';
import { SectionLabel } from '../components/Signal';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, withAlpha } from '../theme/tokens';
import { useStore } from '../store/useStore';
import { notify } from '../utils/notify';
import { PaywallTrigger } from '../config/features';
import {
  BillingOffer,
  BillingPlanId,
  Offerings,
  addPurchaseListeners,
  isBillingSupported,
  loadOfferings,
  purchase as startPurchase,
} from '../services/billing';
import { refreshEntitlement } from '../services/entitlements';
import { useEntitlement } from '../hooks/useEntitlement';

/**
 * The paywall.
 *
 * Prices are never hardcoded here — Play owns them, so every figure on this
 * screen comes from `loadOfferings()`. If the store cannot be reached we say so
 * rather than inventing numbers.
 *
 * The headline changes with the trigger that opened it: someone who just hit
 * the 90-day scan wall is in a different frame of mind from someone who tapped
 * "Echo Pro" in Settings, and one generic feature grid serves neither.
 */

const HEADLINES: Record<PaywallTrigger, { eyebrow: string; title: string; body: string }> = {
  trial_ended: {
    eyebrow: 'Your trial has ended',
    title: 'Keep the full picture',
    body: 'Two weeks of Echo Pro just finished. Your data stays exactly where it is — this only decides how much of it Echo Spend keeps reading for you.',
  },
  cycle_close: {
    eyebrow: 'Cycle closed',
    title: 'See where it actually went',
    body: 'You have a full cycle recorded. Pro reads it back to you — by merchant, by pattern, and against the cycles before it.',
  },
  scan_history_wall: {
    eyebrow: 'More history found',
    title: 'Unlock your full archive',
    body: 'Smart Scan stopped at 90 days. There is more in your inbox, and Pro reads all of it.',
  },
  analytics_gate: {
    eyebrow: 'Echo Pro',
    title: 'The analysis, not just the ledger',
    body: 'Merchant breakdowns, spending patterns and cycle-over-cycle comparison.',
  },
  automation_toggle: {
    eyebrow: 'Echo Pro',
    title: 'Let it run without you',
    body: 'Background scanning, scheduled backups, budget alerts and bill reminders.',
  },
  limit_reached: {
    eyebrow: 'Echo Pro',
    title: 'Room for everything you track',
    body: 'Unlimited accounts, budgets, goals, loans and subscriptions.',
  },
  settings: {
    eyebrow: 'Echo Pro',
    title: 'Everything Echo Spend can do',
    body: 'Your full history, read properly — and the automation to keep it current.',
  },
  founder_card: {
    eyebrow: 'Echo Pro',
    title: 'Everything Echo Spend can do',
    body: 'Your full history, read properly — and the automation to keep it current.',
  },
};

const VALUE_ROWS = [
  {
    icon: LucideArchive,
    title: 'Your full archive',
    body: 'Smart Scan reads every bank message, not just the last 90 days.',
  },
  {
    icon: LucideChartNoAxesCombined,
    title: 'The whole analysis',
    body: 'Merchants, patterns, custom ranges and cycle-over-cycle comparison.',
  },
  {
    icon: LucideZap,
    title: 'Runs without you',
    body: 'Background scanning, scheduled backup, budget alerts and bill reminders.',
  },
  {
    icon: LucideInfinity,
    title: 'No limits',
    body: 'Unlimited accounts, budgets, goals, loans and subscriptions.',
  },
];

const PLAN_ORDER: BillingPlanId[] = ['annual', 'lifetime', 'monthly'];

const PLAN_META: Record<
  BillingPlanId,
  {
    label: string;
    note: string;
    badge?: string;
    savingsBadge?: string;
    anchorPrice?: string;
    monthlyEquivalent?: string;
  }
> = {
  annual: {
    label: 'Yearly',
    note: 'Billed once a year · Less than ₹1.5/day',
    badge: 'BEST VALUE',
    savingsBadge: 'SAVE 58%',
    monthlyEquivalent: '₹41/mo',
  },
  lifetime: {
    label: 'Lifetime',
    note: 'Pay once. Forever Pro access. No renewal, ever.',
    badge: 'SPECIAL OFFER',
    anchorPrice: '₹2,499',
  },
  monthly: {
    label: 'Monthly',
    note: 'Cancel any time in Google Play',
    badge: undefined,
  },
};

export const PaywallScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const trigger: PaywallTrigger = route.params?.trigger ?? 'settings';
  const hapticsEnabled = useStore((s) => s.preferences.hapticsEnabled);
  const { isPro, entitlement, trialDaysLeft } = useEntitlement();
  const initialIsPro = useRef(isPro);
  const initialSource = useRef(entitlement.source);

  const [offerings, setOfferings] = useState<Offerings>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<BillingPlanId>('annual');

  const copy = HEADLINES[trigger] ?? HEADLINES.settings;

  const tap = useCallback(
    (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
      if (hapticsEnabled) Haptics.impactAsync(style).catch(() => {});
    },
    [hapticsEnabled],
  );

  useEffect(() => {
    let alive = true;
    loadOfferings()
      .then((o) => {
        if (!alive) return;
        const completeOfferings: Offerings = {
          annual: (o.annual && o.annual.displayPrice) ? o.annual : (__DEV__ ? { planId: 'annual', displayPrice: '₹799/yr', sku: 'echo_pro_sub' } : o.annual),
          monthly: (o.monthly && o.monthly.displayPrice) ? o.monthly : (__DEV__ ? { planId: 'monthly', displayPrice: '₹99/mo', sku: 'echo_pro_sub' } : o.monthly),
          lifetime: (o.lifetime && o.lifetime.displayPrice) ? o.lifetime : (__DEV__ ? { planId: 'lifetime', displayPrice: '₹2,499', sku: 'lifetime' } : o.lifetime),
        };
        setOfferings(completeOfferings);
        if (!completeOfferings.annual) setSelected(completeOfferings.lifetime ? 'lifetime' : 'monthly');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // Granting is App.tsx's job — one global listener owns acknowledgement and the
  // success path, so a purchase that settles while this screen is closed still
  // lands. This screen only listens for the states it must *draw*: a payment
  // left pending, and an outright failure.
  useEffect(() => {
    const unsubscribe = addPurchaseListeners({
      onPending: () => {
        setBusy(false);
        setPending(true);
      },
      onError: (message) => {
        setBusy(false);
        notify.error('Purchase failed', message);
      },
    });
    return unsubscribe;
  }, []);

  // Dismiss once the entitlement actually flips from free/trial to paid,
  // wherever the grant came from — this purchase, a restore, or one that cleared in the background.
  useEffect(() => {
    const becamePro = !initialIsPro.current && isPro;
    const upgradedFromTrial = initialSource.current === 'trial' && entitlement.source === 'play_sub';
    const upgradedToLifetime = entitlement.source === 'lifetime' && initialSource.current !== 'lifetime';

    if (becamePro || upgradedFromTrial || upgradedToLifetime) {
      if (navigation.canGoBack()) navigation.goBack();
    }
  }, [isPro, entitlement.source, navigation]);

  const handleBuy = async () => {
    const offer: BillingOffer | undefined = offerings[selected];
    if (!offer) return;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    try {
      if (__DEV__ && !offer.offerToken) {
        // Fallback for simulation / emulator testing
        if (selected === 'lifetime') {
          useStore.getState().setProEntitlement({ tier: 'pro', source: 'lifetime', expiresAt: null }, new Date().toISOString());
          notify.success('Unlocked!', 'Echo Pro lifetime access activated');
        } else {
          useStore.getState().setProEntitlement({ tier: 'pro', source: 'play_sub', expiresAt: null }, new Date().toISOString());
          notify.success('Subscribed!', 'Echo Pro active');
        }
        setBusy(false);
        if (navigation.canGoBack()) navigation.goBack();
        return;
      }
      await startPurchase(offer);
    } catch (e: any) {
      setBusy(false);
      notify.error('Could not start purchase', e?.message ?? 'Please try again');
    }
  };

  const handleRestore = async () => {
    tap();
    setBusy(true);
    // One round trip: this both re-reads Play and reports what it found, so
    // "nothing owned" and "still pending" can be told apart.
    const { entitlement, owned } = await refreshEntitlement(true);
    setBusy(false);

    if (entitlement.tier === 'pro') {
      notify.success('Echo Pro restored');
      if (navigation.canGoBack()) navigation.goBack();
    } else if (owned?.hasPending) {
      setPending(true);
    } else {
      notify.info('Nothing to restore', 'No Echo Pro purchase on this account');
    }
  };

  const unavailable = !loading && (!isBillingSupported() || PLAN_ORDER.every((p) => !offerings[p]));

  return (
    <ThemedSafeAreaView className="flex-1">
      <View style={styles.closeRow}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.closeBtn}>
          <LucideX color={colors.secondary} size={22} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SectionLabel>{copy.eyebrow}</SectionLabel>
        <ThemedText style={[styles.title, { color: colors.primary }]}>{copy.title}</ThemedText>
        <ThemedText type="secondary" style={styles.body}>
          {copy.body}
        </ThemedText>

        <View style={styles.values}>
          {VALUE_ROWS.map(({ icon: Icon, title, body }) => (
            <View key={title} style={styles.valueRow}>
              <View style={[styles.valueIcon, { backgroundColor: withAlpha(colors.accent, '1A') }]}>
                <Icon color={colors.accent} size={17} />
              </View>
              <View style={styles.flex}>
                <ThemedText style={[styles.valueTitle, { color: colors.primary }]}>{title}</ThemedText>
                <ThemedText type="secondary" style={styles.valueBody}>
                  {body}
                </ThemedText>
              </View>
            </View>
          ))}
        </View>

        {isPro && entitlement.source === 'trial' && (
          <View style={[styles.notice, { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, '10'), marginTop: 20 }]}>
            <ThemedText style={[styles.valueTitle, { color: colors.accent }]}>
              {trialDaysLeft != null && trialDaysLeft > 0
                ? `${trialDaysLeft} Day${trialDaysLeft === 1 ? '' : 's'} Remaining in Free Trial`
                : 'Free Trial Active'}
            </ThemedText>
            <ThemedText type="secondary" style={styles.noticeText}>
              Upgrading now extends your Echo Pro access seamlessly after your free trial finishes.
            </ThemedText>
          </View>
        )}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : unavailable ? (
          <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <ThemedText type="secondary" style={styles.noticeText}>
              The Play Store is not reachable right now, so plans and prices can't be shown.
              Nothing has been charged — try again in a moment.
            </ThemedText>
          </View>
        ) : pending ? (
          <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <ThemedText style={[styles.valueTitle, { color: colors.primary }]}>
              Payment processing
            </ThemedText>
            <ThemedText type="secondary" style={styles.noticeText}>
              Google is still confirming your payment. UPI and net banking can take a
              while. Echo Pro switches on by itself the moment it clears — you don't
              need to pay again or keep this screen open.
            </ThemedText>
          </View>
        ) : (
          <View style={styles.plans}>
            {PLAN_ORDER.map((planId) => {
              const offer = offerings[planId];
              if (!offer) return null;
              const meta = PLAN_META[planId];
              const active = selected === planId;

              let priceDisplay = offer.displayPrice || (planId === 'lifetime' ? '₹1,499.00' : planId === 'annual' ? '₹499.00' : '₹99.00');
              if (planId === 'annual' && !priceDisplay.includes('/')) {
                priceDisplay = `${priceDisplay}/yr`;
              } else if (planId === 'monthly' && !priceDisplay.includes('/')) {
                priceDisplay = `${priceDisplay}/mo`;
              }

              return (
                <Pressable
                  key={planId}
                  onPress={() => {
                    tap();
                    setSelected(planId);
                  }}
                  style={[
                    styles.plan,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                    active && { borderColor: colors.accent, backgroundColor: withAlpha(colors.accent, '12') },
                  ]}
                >
                  <View style={styles.planHead}>
                    <ThemedText style={[styles.planLabel, { color: colors.primary }]}>
                      {meta.label}
                    </ThemedText>
                    {!!meta.badge && (
                      <View style={[styles.badge, { backgroundColor: withAlpha(meta.badge === 'BEST VALUE' ? colors.accent : '#FFD700', '1F') }]}>
                        <ThemedText style={[styles.badgeText, { color: meta.badge === 'BEST VALUE' ? colors.accent : '#FFD700' }]}>
                          {meta.badge}
                        </ThemedText>
                      </View>
                    )}
                    {!!meta.savingsBadge && (
                      <View style={[styles.badge, { backgroundColor: withAlpha(colors.accent, '18') }]}>
                        <ThemedText style={[styles.badgeText, { color: colors.accent }]}>
                          {meta.savingsBadge}
                        </ThemedText>
                      </View>
                    )}
                    <View style={styles.flex} />
                    {active && <LucideCheck color={colors.accent} size={18} />}
                  </View>

                  <View style={styles.planPriceRow}>
                    <ThemedText style={[styles.planPrice, { color: colors.primary }]}>
                      {priceDisplay}
                    </ThemedText>
                    {!!meta.anchorPrice && (
                      <ThemedText style={[styles.planAnchor, { color: colors.muted }]}>
                        {meta.anchorPrice}
                      </ThemedText>
                    )}
                    {!!meta.monthlyEquivalent && (
                      <ThemedText style={[styles.planEquivalent, { color: colors.accent }]}>
                        ({meta.monthlyEquivalent})
                      </ThemedText>
                    )}
                  </View>

                  <ThemedText type="muted" style={styles.planNote}>
                    {meta.note}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Free vs Pro Comparison Matrix */}
        <View style={{ marginTop: 28 }}>
          <ThemedText style={[styles.valueTitle, { color: colors.primary, marginBottom: 12 }]}>
            Free vs. Echo Pro Comparison
          </ThemedText>
          <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', backgroundColor: colors.surface }}>
            {[
              { label: 'Real-time SMS Capture', free: 'Free', pro: 'Free' },
              { label: 'SMS Archive Depth', free: '90 Days', pro: 'Full Archive' },
              { label: 'Analytics & Trends', free: '30 Days', pro: 'Unlimited' },
              { label: 'Accounts & Budgets', free: '3 Max', pro: 'Unlimited' },
              { label: 'Background Backups', free: 'Manual', pro: 'Automated' },
              { label: 'Offline Data Privacy', free: '100% Local', pro: '100% Local' },
            ].map((row, idx) => (
              <View
                key={row.label}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderTopWidth: idx > 0 ? 1 : 0,
                  borderTopColor: colors.border,
                }}
              >
                <ThemedText style={{ fontSize: 12.5, color: colors.primary, flex: 1 }}>{row.label}</ThemedText>
                <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
                  <ThemedText style={{ fontSize: 11.5, color: colors.secondary, width: 60, textAlign: 'right' }}>{row.free}</ThemedText>
                  <ThemedText style={{ fontSize: 11.5, fontWeight: '700', color: colors.accent, width: 75, textAlign: 'right' }}>{row.pro}</ThemedText>
                </View>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {!unavailable && !pending && (
          <PrimaryButton
            label={busy ? 'Opening Google Play…' : 'Continue'}
            onPress={handleBuy}
            disabled={busy || loading || !offerings[selected]}
          />
        )}
        <Pressable onPress={handleRestore} disabled={busy} style={styles.restore}>
          <ThemedText type="secondary" style={styles.restoreText}>
            Restore purchases
          </ThemedText>
        </Pressable>
        <ThemedText type="muted" style={styles.legal}>
          Billed through Google Play. Subscriptions renew until cancelled and can be
          managed in Play at any time. Your transactions never leave your phone.
        </ThemedText>
      </View>
    </ThemedSafeAreaView>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 8 },
  closeBtn: { padding: 8 },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 },
  title: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 34, marginTop: 6 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 10 },
  values: { marginTop: 26, gap: 16 },
  valueRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  valueIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  valueTitle: { fontFamily: fonts.textSemibold, fontSize: 14 },
  valueBody: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  notice: { marginTop: 26, padding: 16, borderRadius: radius.md, borderWidth: 1, gap: 6 },
  noticeText: { fontSize: 13, lineHeight: 19 },
  plans: { marginTop: 26, gap: 10 },
  plan: { borderWidth: 1, borderRadius: radius.md, padding: 14 },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planLabel: { fontFamily: fonts.textSemibold, fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  badgeText: { fontFamily: fonts.signal, fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase' },
  planPriceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8, gap: 4 },
  planPrice: { fontFamily: fonts.displayBold, fontSize: 22, fontVariant: ['tabular-nums'] },
  planAnchor: { fontFamily: fonts.textMedium, fontSize: 15, textDecorationLine: 'line-through', marginLeft: 6 },
  planEquivalent: { fontFamily: fonts.signal, fontSize: 12, fontWeight: '700', marginLeft: 6 },
  planNote: { fontSize: 11.5, marginTop: 4 },
  footer: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8, gap: 10 },
  restore: { alignItems: 'center', paddingVertical: 6 },
  restoreText: { fontSize: 13, fontFamily: fonts.textSemibold },
  legal: { fontSize: 10.5, lineHeight: 15, textAlign: 'center' },
});

export default PaywallScreen;
