/**
 * Day-to-day dashboard widgets added alongside the customizable layout.
 *
 * Each is a pure presentation component: the screen owns loading and passes the
 * already-fetched data in, so these add no queries and stay easy to reorder.
 * All of them render an honest empty/setup state rather than disappearing, so a
 * widget the user explicitly enabled never looks broken.
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Pressable,
  ScrollView,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { MotiView } from 'moti';
import {
  LucideChevronRight,
  LucideCreditCard,
  LucideCalendar,
  LucideRepeat,
  LucideLandmark,
} from 'lucide-react-native';
import { ThemedText } from '../ThemedSafeAreaView';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, formatINR } from '../../theme/tokens';
import { AmountText, SectionLabel, CycleBar } from '../Signal';
import { Card, IconTile } from '../Kit';
import type { UpcomingBill, CardHealth } from './derive';
import { formatDueLabel, getInterestFreeInfo } from './derive';
import type { Insight } from '../../services/database';

// ─── Shared bits ─────────────────────────────────────────────────────────────

const WidgetSection: React.FC<{
  label: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}> = ({ label, action, children }) => {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 24 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <SectionLabel>{label}</SectionLabel>
        {action && (
          <Pressable
            onPress={action.onPress}
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <SectionLabel color={colors.accent}>{action.label}</SectionLabel>
            <LucideChevronRight size={12} color={colors.accent} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
};

const MutedNote: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors } = useTheme();
  return (
    <ThemedText
      style={{ fontFamily: fonts.text, fontSize: 13, color: colors.secondary, lineHeight: 19 }}
    >
      {children}
    </ThemedText>
  );
};

// ─── Upcoming bills ──────────────────────────────────────────────────────────

const BILL_ICON = {
  subscription: LucideRepeat,
  emi: LucideLandmark,
  card: LucideCreditCard,
} as const;

interface UpcomingBillsWidgetProps {
  bills: UpcomingBill[];
  currency: string;
  masked: boolean;
  onPressBill: (bill: UpcomingBill) => void;
  onSeeAll: () => void;
  /** Rows to show before collapsing behind "See all". */
  limit?: number;
}

export const UpcomingBillsWidget: React.FC<UpcomingBillsWidgetProps> = ({
  bills,
  currency,
  masked,
  onPressBill,
  onSeeAll,
  limit = 4,
}) => {
  const { colors } = useTheme();
  const shown = bills.slice(0, limit);
  const total = bills.reduce((sum, b) => sum + b.amount, 0);

  if (bills.length === 0) {
    return (
      <WidgetSection label="Upcoming bills">
        <Card>
          <MutedNote>
            Nothing left to pay this cycle. Subscriptions, EMIs and card
            payments appear here as they come due.
          </MutedNote>
        </Card>
      </WidgetSection>
    );
  }

  return (
    <WidgetSection
      label="Upcoming bills"
      action={bills.length > limit ? { label: `All ${bills.length}`, onPress: onSeeAll } : undefined}
    >
      <Card padded={false}>
        {shown.map((bill, idx) => {
          const Icon = BILL_ICON[bill.kind];
          const overdue = bill.daysLeft < 0;
          const urgent = bill.daysLeft >= 0 && bill.daysLeft <= 3;
          const dueColor = overdue ? colors.danger : urgent ? colors.debit : colors.secondary;

          return (
            <MotiView
              key={bill.key}
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 220, delay: idx * 40 }}
            >
              <Pressable
                onPress={() => onPressBill(bill)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  gap: 12,
                }}
              >
                <IconTile color={dueColor} size={36}>
                  <Icon size={16} color={dueColor} />
                </IconTile>

                <View style={{ flex: 1 }}>
                  <ThemedText
                    numberOfLines={1}
                    style={{ fontFamily: fonts.textMedium, fontSize: 14, color: colors.primary }}
                  >
                    {bill.label}
                  </ThemedText>
                  <ThemedText
                    style={{ fontFamily: fonts.signal, fontSize: 11, color: dueColor, marginTop: 3 }}
                  >
                    {formatDueLabel(bill.daysLeft)}
                  </ThemedText>
                </View>

                <AmountText
                  value={bill.amount}
                  size={14}
                  currency={currency}
                  masked={masked}
                  kind="debit"
                />
              </Pressable>
            </MotiView>
          );
        })}

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: colors.surfaceElevated,
          }}
        >
          <SectionLabel>Due this cycle</SectionLabel>
          <AmountText
            value={total}
            size={14}
            currency={currency}
            masked={masked}
            kind="debit"
          />
        </View>
      </Card>
    </WidgetSection>
  );
};

// ─── Credit cards ────────────────────────────────────────────────────────────

interface CreditCardsWidgetProps {
  cards: CardHealth[];
  currency: string;
  masked: boolean;
  onPressCard: (card: CardHealth) => void;
  onAddCard: () => void;
  /** Opens the Pay Bill sheet. Omitted, the button is hidden. */
  onPayBill?: (card: CardHealth) => void;
  /** Jump to the full Cards tab in Money. */
  onSeeAll?: () => void;
  /** Horizontal padding the parent ScrollView applies, so cards can bleed edge-to-edge. */
  gutter?: number;
}

export const CreditCardsWidget: React.FC<CreditCardsWidgetProps> = ({
  cards,
  currency,
  masked,
  onPressCard,
  onAddCard,
  onPayBill,
  onSeeAll,
  gutter = 24,
}) => {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  // Same deck mechanics as InsightCarousel — one card per page, snapped.
  const GAP = 12;
  const cardWidth = width - gutter * 2;
  const interval = cardWidth + GAP;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / interval);
      setPage((prev) => (prev === next ? prev : next));
    },
    [interval],
  );

  if (cards.length === 0) {
    return (
      <WidgetSection label="Credit cards">
        <Card onPress={onAddCard}>
          <MutedNote>
            No credit cards tracked yet. Add one to watch utilization and never
            miss a payment due date.
          </MutedNote>
        </Card>
      </WidgetSection>
    );
  }

  const toneFor = (severity: CardHealth['severity']) =>
    severity === 'high' ? colors.danger : severity === 'warn' ? colors.debit : colors.credit;

  // Cards needing attention lead, so the deck opens on the one that matters:
  // a bill to pay first, then utilization worth acting on.
  const ranked = [...cards].sort((a, b) => {
    const score = (c: CardHealth) =>
      ((c.amountDue ?? 0) > 0 ? 2 : 0) + (c.severity === 'high' ? 1 : 0);
    return score(b) - score(a);
  });

  const totalDue = cards.reduce((sum, c) => sum + (c.amountDue ?? 0), 0);
  const totalOutstanding = cards.reduce((sum, c) => sum + c.outstanding, 0);

  return (
    <WidgetSection
      label="Credit cards"
      action={onSeeAll ? { label: `All ${cards.length}`, onPress: onSeeAll } : undefined}
    >
      {/* One-line portfolio summary, so the headline numbers survive collapsing. */}
      {cards.length > 1 && (
        <Card style={{ padding: 14, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <SectionLabel>Due now</SectionLabel>
              <AmountText
                value={totalDue}
                size={17}
                currency={currency}
                masked={masked}
                kind={totalDue > 0 ? 'debit' : 'neutral'}
                style={{ marginTop: 3 }}
              />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <SectionLabel>Outstanding</SectionLabel>
              <AmountText
                value={totalOutstanding}
                size={17}
                currency={currency}
                masked={masked}
                kind="neutral"
                style={{ marginTop: 3 }}
              />
            </View>
          </View>
        </Card>
      )}

      {/* One card per page. Every card keeps its full detail — the widget's
          height stays the same whether the wallet holds one card or seven,
          which the old stack-plus-"show all" could not do. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Snap, not pagingEnabled: cards are inset by the gutter, so a
        // full-viewport page width would drift out of alignment as you swipe.
        snapToInterval={interval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{ paddingHorizontal: gutter, alignItems: 'stretch' }}
      >
        {ranked.map((card, idx) => {
          const tone = toneFor(card.severity);
          return (
            <MotiView
              key={card.account.id}
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 220, delay: idx * 50 }}
              style={{
                width: cardWidth,
                marginRight: idx === ranked.length - 1 ? 0 : GAP,
              }}
            >
              {/* Pressable wrapper rather than Card's own onPress: only an
                  element in this chain can carry flex:1, and every face has to
                  fill the tallest card so the deck's height never jumps. */}
              <Pressable onPress={() => onPressCard(card)} style={{ flex: 1 }}>
                <Card style={{ flex: 1 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 12,
                      gap: 12,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <IconTile color={tone} size={34}>
                        <LucideCreditCard size={15} color={tone} />
                      </IconTile>
                      <View style={{ flex: 1 }}>
                        <ThemedText
                          numberOfLines={1}
                          style={{ fontFamily: fonts.textMedium, fontSize: 14, color: colors.primary }}
                        >
                          {card.account.name}
                        </ThemedText>
                        {card.account.last4Digits && (
                          <ThemedText
                            style={{
                              fontFamily: fonts.signal,
                              fontSize: 11,
                              color: colors.secondary,
                              marginTop: 2,
                            }}
                          >
                            •••• {card.account.last4Digits}
                          </ThemedText>
                        )}
                      </View>
                    </View>

                    {/* Headline is what must be PAID (statement remaining), not the
                        running balance — post-statement spend isn't due yet. */}
                    <View style={{ alignItems: 'flex-end' }}>
                      <AmountText
                        value={card.amountDue ?? card.outstanding}
                        size={17}
                        currency={currency}
                        masked={masked}
                        kind="debit"
                      />
                      <ThemedText
                        style={{ fontFamily: fonts.signal, fontSize: 9, color: colors.secondary, marginTop: 2 }}
                      >
                        {card.amountDue !== null ? 'DUE NOW' : 'OUTSTANDING'}
                      </ThemedText>
                    </View>
                  </View>

                  {card.hasLimit ? (
                    <>
                      <CycleBar pct={card.utilizationPct} color={tone} />
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginTop: 8,
                        }}
                      >
                        <ThemedText
                          style={{ fontFamily: fonts.signal, fontSize: 11, color: tone }}
                        >
                          {`${Math.round(card.utilizationPct)}% used`}
                        </ThemedText>
                        <MutedNote>
                          {masked
                            ? `${currency}•••• available`
                            : `${currency}${formatINR(card.available)} available`}
                        </MutedNote>
                      </View>
                    </>
                  ) : (
                    // Utilization is meaningless without a limit — prompt for it
                    // rather than rendering a misleading empty bar.
                    <MutedNote>Add a credit limit to track utilization.</MutedNote>
                  )}

                  {card.statement && (
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        marginTop: 10,
                        paddingTop: 10,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                      }}
                    >
                      {card.minimumDue !== null && (
                        <MutedNote>
                          {masked
                            ? `Min ${currency}••••`
                            : `Min ${currency}${formatINR(card.minimumDue)}`}
                        </MutedNote>
                      )}
                      {card.unbilled !== null && card.unbilled > 0 && (
                        <MutedNote>
                          {masked
                            ? `${currency}•••• unbilled`
                            : `${currency}${formatINR(card.unbilled)} unbilled`}
                        </MutedNote>
                      )}
                    </View>
                  )}

                  {onPayBill && (card.amountDue ?? 0) > 0 && (
                    <Pressable
                      onPress={() => onPayBill(card)}
                      style={{
                        marginTop: 12,
                        paddingVertical: 10,
                        borderRadius: 12,
                        alignItems: 'center',
                        backgroundColor: colors.accent,
                      }}
                    >
                      <ThemedText
                        style={{ fontFamily: fonts.textSemibold, fontSize: 13, color: colors.onAccent }}
                      >
                        {masked
                          ? 'Pay bill'
                          : `Pay ${currency}${formatINR(card.amountDue as number)}`}
                      </ThemedText>
                    </Pressable>
                  )}

                  {/* Free-credit window for a purchase made today — the number
                      people actually plan around. */}
                  {(() => {
                    const free = getInterestFreeInfo(card.account);
                    if (!free) return null;
                    return (
                      <MutedNote>
                        {`Buy today → interest-free for ${free.days} days, until ${free.payBy.toLocaleDateString(
                          'en-IN', { day: 'numeric', month: 'short' },
                        )}`}
                      </MutedNote>
                    );
                  })()}

                  {(card.dueInDays !== null || card.statementInDays !== null) && (
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 16,
                        marginTop: 12,
                        paddingTop: 12,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                      }}
                    >
                      {card.dueInDays !== null && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <LucideCalendar size={12} color={colors.secondary} />
                          <ThemedText
                            style={{
                              fontFamily: fonts.text,
                              fontSize: 12,
                              color: card.dueInDays <= 3 ? colors.debit : colors.secondary,
                            }}
                          >
                            {`Payment ${formatDueLabel(card.dueInDays).toLowerCase()}`}
                          </ThemedText>
                        </View>
                      )}
                      {card.statementInDays !== null && (
                        <MutedNote>
                          {`Statement ${formatDueLabel(card.statementInDays).toLowerCase()}`}
                        </MutedNote>
                      )}
                    </View>
                  )}
                </Card>
              </Pressable>
            </MotiView>
          );
        })}
      </ScrollView>

      {ranked.length > 1 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          {ranked.map((card, idx) => (
            <View
              key={card.account.id}
              style={{
                width: idx === page ? 16 : 6,
                height: 6,
                borderRadius: 3,
                // The dot carries the card's own severity, so a card needing
                // attention is visible without swiping to it.
                backgroundColor: idx === page ? toneFor(card.severity) : colors.border,
              }}
            />
          ))}
        </View>
      )}
    </WidgetSection>
  );
};

// ─── Insight carousel ────────────────────────────────────────────────────────

interface InsightCarouselProps {
  insights: Insight[];
  /** Horizontal padding the parent ScrollView applies, so cards can bleed edge-to-edge. */
  gutter?: number;
}

/**
 * Insights as a swipeable deck rather than a single dismissible card.
 *
 * The old card let you close insights one at a time, which fought the daily
 * regeneration: clearing the deck made the dashboard believe none had ever been
 * generated, so it rebuilt the same set on the next visit and the dismissals
 * looked like they had been undone. A carousel sidesteps that entirely — every
 * insight stays reachable, and nothing needs dismissing to get past it.
 */
export const InsightCarousel: React.FC<InsightCarouselProps> = ({
  insights,
  gutter = 24,
}) => {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const GAP = 12;
  const cardWidth = width - gutter * 2;
  const interval = cardWidth + GAP;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / interval);
      setPage((prev) => (prev === next ? prev : next));
    },
    [interval],
  );

  if (insights.length === 0) return null;

  return (
    <WidgetSection label="Insights">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Snap rather than pagingEnabled: the cards are inset by the gutter, so
        // a full-viewport page width would drift out of alignment as you swipe.
        snapToInterval={interval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{ paddingHorizontal: gutter }}
      >
        {insights.map((insight, idx) => (
          <MotiView
            key={insight.id}
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 240, delay: idx * 40 }}
            style={{
              width: cardWidth,
              marginRight: idx === insights.length - 1 ? 0 : GAP,
            }}
          >
            <Card style={{ padding: 16, minHeight: 96 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                <IconTile emoji="💡" color={colors.ai} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText
                    style={{ fontFamily: fonts.textSemibold, fontSize: 14, color: colors.primary }}
                    numberOfLines={1}
                  >
                    {insight.title}
                  </ThemedText>
                  <ThemedText
                    style={{
                      fontFamily: fonts.text,
                      fontSize: 12,
                      color: colors.secondary,
                      marginTop: 4,
                      lineHeight: 18,
                    }}
                    numberOfLines={3}
                  >
                    {insight.body}
                  </ThemedText>
                </View>
              </View>
            </Card>
          </MotiView>
        ))}
      </ScrollView>

      {insights.length > 1 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          {insights.map((insight, idx) => (
            <View
              key={insight.id}
              style={{
                width: idx === page ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: idx === page ? colors.ai : colors.border,
              }}
            />
          ))}
        </View>
      )}
    </WidgetSection>
  );
};
