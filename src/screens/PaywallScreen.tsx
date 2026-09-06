import React, { useCallback, useEffect, useState } from 'react';
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

const PLAN_META: Record<BillingPlanId, { label: string; note: string; badge?: string }> = {
  annual: { label: 'Yearly', note: 'Billed once a year', badge: 'Best value' },
  lifetime: { label: 'Lifetime', note: 'Pay once. No renewal, ever.', badge: 'No subscription' },
  monthly: { label: 'Monthly', note: 'Cancel any time', badge: undefined },
};

export const PaywallScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const trigger: PaywallTrigger = route.params?.trigger ?? 'settings';
  const hapticsEnabled = useStore((s) => s.preferences.hapticsEnabled);
  const { isPro } = useEntitlement();

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
        setOfferings(o);
        // Never leave a plan selected that the store did not return.
        if (!o.annual) setSelected(o.lifetime ? 'lifetime' : 'monthly');
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

  // Dismiss once the entitlement actually flips, wherever the grant came from —
  // this purchase, a restore, or one that cleared in the background.
  useEffect(() => {
    if (isPro && navigation.canGoBack()) navigation.goBack();
  }, [isPro, navigation]);

  const handleBuy = async () => {
    const offer: BillingOffer | undefined = offerings[selected];
    if (!offer) return;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    try {
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
                      <View style={[styles.badge, { backgroundColor: withAlpha(colors.accent, '1F') }]}>
                        <ThemedText style={[styles.badgeText, { color: colors.accent }]}>
                          {meta.badge}
                        </ThemedText>
                      </View>
                    )}
                    <View style={styles.flex} />
                    {active && <LucideCheck color={colors.accent} size={18} />}
                  </View>
                  <ThemedText style={[styles.planPrice, { color: colors.primary }]}>
                    {offer.displayPrice}
                  </ThemedText>
                  <ThemedText type="muted" style={styles.planNote}>
                    {meta.note}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        )}
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
  planPrice: { fontFamily: fonts.displayBold, fontSize: 22, marginTop: 8, fontVariant: ['tabular-nums'] },
  planNote: { fontSize: 11.5, marginTop: 2 },
  footer: { paddingHorizontal: 24, paddingBottom: 20, paddingTop: 8, gap: 10 },
  restore: { alignItems: 'center', paddingVertical: 6 },
  restoreText: { fontSize: 13, fontFamily: fonts.textSemibold },
  legal: { fontSize: 10.5, lineHeight: 15, textAlign: 'center' },
});

export default PaywallScreen;
