/**
 * Day-to-day dashboard widgets added alongside the customizable layout.
 *
 * Each is a pure presentation component: the screen owns loading and passes the
 * already-fetched data in, so these add no queries and stay easy to reorder.
 * All of them render an honest empty/setup state rather than disappearing, so a
 * widget the user explicitly enabled never looks broken.
 */
import React, { useState, useCallback, useEffect } from 'react';
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
  LucideTarget,
} from 'lucide-react-native';
import { ThemedText } from '../ThemedSafeAreaView';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts, formatINR } from '../../theme/tokens';
import { AmountText, SectionLabel, CycleBar } from '../Signal';
import { Card, IconTile } from '../Kit';
import type { UpcomingBill, CardHealth, PlannedContribution } from './derive';
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

// ─── Upcoming — bills and planned contributions ──────────────────────────────

const BILL_ICON = {
  subscription: LucideRepeat,
  emi: LucideLandmark,
  card: LucideCreditCard,
} as const;

/**
 * One line on either face. Both lenses share it so a bill and a contribution
 * are visually the same object — only the tone and the amount's kind differ.
 */
const UpcomingRow: React.FC<{
  icon: React.ReactNode;
  tone: string;
  label: string;
  sub: string;
  amount: number;
  currency: string;
  masked: boolean;
  kind: 'debit' | 'neutral';
  first: boolean;
  onPress: () => void;
}> = ({ icon, tone, label, sub, amount, currency, masked, kind, first, onPress }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <IconTile color={tone} size={32}>
        {icon}
      </IconTile>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText
          numberOfLines={1}
          style={{ fontFamily: fonts.textMedium, fontSize: 13.5, color: colors.primary }}
        >
          {label}
        </ThemedText>
        <ThemedText
          numberOfLines={1}
          style={{ fontFamily: fonts.signal, fontSize: 10.5, color: tone, marginTop: 2 }}
        >
          {sub}
        </ThemedText>
      </View>
      <AmountText value={amount} size={14} currency={currency} masked={masked} kind={kind} />
    </Pressable>
  );
};

/** The shared frame both lenses render into, so the deck never changes shape. */
const LensFace: React.FC<{
  eyebrow: string;
  total: number;
  /** Item count beside the total. Omitted on an empty face, where the note says it. */
  caption?: string;
  action?: { label: string; onPress: () => void };
  currency: string;
  masked: boolean;
  totalKind: 'debit' | 'neutral';
  empty?: string;
  children?: React.ReactNode;
  more?: number;
}> = ({
  eyebrow, total, caption, action, currency, masked, totalKind, empty, children, more = 0,
}) => {
  const { colors } = useTheme();
  return (
    <Card style={{ flex: 1, paddingVertical: 16 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <SectionLabel>{eyebrow}</SectionLabel>
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

      {/* flex-end, not baseline: RN's baseline alignment is inconsistent across
          platforms with mixed font families, and this row mixes the signal face
          with the text one. The nudge below matches the optical baseline. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 }}>
        <AmountText
          value={total}
          size={24}
          currency={currency}
          masked={masked}
          kind={totalKind}
        />
        {!!caption && (
          <ThemedText
            style={{
              fontFamily: fonts.text,
              fontSize: 12,
              color: colors.secondary,
              paddingBottom: 3,
            }}
            numberOfLines={1}
          >
            {caption}
          </ThemedText>
        )}
      </View>

      {empty ? (
        <View style={{ marginTop: 12 }}>
          <MutedNote>{empty}</MutedNote>
        </View>
      ) : (
        <View style={{ marginTop: 10 }}>
          {children}
          {more > 0 && (
            <ThemedText
              style={{
                fontFamily: fonts.signal,
                fontSize: 10.5,
                color: colors.muted,
                marginTop: 10,
              }}
            >
              {`+${more} more`}
            </ThemedText>
          )}
        </View>
      )}
    </Card>
  );
};

interface UpcomingWidgetProps {
  bills: UpcomingBill[];
  planned: PlannedContribution[];
  currency: string;
  masked: boolean;
  onPressBill: (bill: UpcomingBill) => void;
  onPressPlanned: (item: PlannedContribution) => void;
  onSeeAllBills: () => void;
  onSeeAllGoals: () => void;
  /** Rows on a face before the "+N more" line. */
  rowsPerFace?: number;
  /** Horizontal padding the parent ScrollView applies, so faces bleed edge-to-edge. */
  gutter?: number;
}

/**
 * Two lenses on the same cycle, one swipe apart:
 *
 *   Due     — bills that leave your account whether you act or not.
 *   Planned — what you have chosen to set aside.
 *
 * They share a widget and never a total. Swiping replaces a segmented control,
 * so there is no lens preference to persist and no extra chrome; the page dot
 * turns red when its lens holds something overdue, so switching away can never
 * hide a missed bill. A fixed row count keeps both faces the same height
 * whether you have two bills or twelve.
 */
export const UpcomingWidget: React.FC<UpcomingWidgetProps> = ({
  bills,
  planned,
  currency,
  masked,
  onPressBill,
  onPressPlanned,
  onSeeAllBills,
  onSeeAllGoals,
  rowsPerFace = 3,
  gutter = 24,
}) => {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const GAP = 12;
  const faceWidth = width - gutter * 2;
  const interval = faceWidth + GAP;

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / interval);
      setPage((prev) => (prev === next ? prev : next));
    },
    [interval],
  );

  // The Planned face can disappear between loads (last goal completed). Without
  // this the dot indicator stays stuck on a page that no longer exists.
  const faceCount = planned.length > 0 ? 2 : 1;
  useEffect(() => {
    if (page > faceCount - 1) setPage(0);
  }, [faceCount, page]);

  const billsTotal = bills.reduce((sum, b) => sum + b.amount, 0);
  const plannedTotal = planned.reduce((sum, p) => sum + p.amount, 0);
  const hasOverdueBill = bills.some((b) => b.daysLeft < 0);
  const hasOverdueGoal = planned.some((p) => p.daysLeft !== null && p.daysLeft < 0);

  // The Planned face only exists once there is something planned — with no
  // goals the widget is exactly the bills list it replaced, dots and all gone.
  const showPlanned = faceCount > 1;

  if (bills.length === 0 && !showPlanned) {
    return (
      <WidgetSection label="Upcoming">
        <Card>
          <MutedNote>
            Nothing left to pay this cycle. Subscriptions, EMIs and card
            payments appear here as they come due.
          </MutedNote>
        </Card>
      </WidgetSection>
    );
  }

  const faces = [
    <LensFace
      key="due"
      eyebrow="Due this cycle"
      total={billsTotal}
      caption={bills.length === 0 ? undefined : bills.length === 1 ? '1 bill' : `${bills.length} bills`}
      action={bills.length > 0 ? { label: `All ${bills.length}`, onPress: onSeeAllBills } : undefined}
      currency={currency}
      masked={masked}
      totalKind="debit"
      empty={bills.length === 0 ? 'Nothing left to pay this cycle.' : undefined}
      more={Math.max(bills.length - rowsPerFace, 0)}
    >
      {bills.slice(0, rowsPerFace).map((bill, idx) => {
        const Icon = BILL_ICON[bill.kind];
        const overdue = bill.daysLeft < 0;
        const urgent = bill.daysLeft >= 0 && bill.daysLeft <= 3;
        const tone = overdue ? colors.danger : urgent ? colors.debit : colors.secondary;
        return (
          <UpcomingRow
            key={bill.key}
            icon={<Icon size={15} color={tone} />}
            tone={tone}
            label={bill.label}
            sub={formatDueLabel(bill.daysLeft)}
            amount={bill.amount}
            currency={currency}
            masked={masked}
            kind="debit"
            first={idx === 0}
            onPress={() => onPressBill(bill)}
          />
        );
      })}
    </LensFace>,
  ];

  if (showPlanned) {
    faces.push(
      <LensFace
        key="planned"
        eyebrow="To set aside"
        total={plannedTotal}
        caption={planned.length === 1 ? '1 goal' : `${planned.length} goals`}
        action={{ label: `All ${planned.length}`, onPress: onSeeAllGoals }}
        currency={currency}
        masked={masked}
        // Never debit-toned: this money has not left, and colouring it like a
        // bill is what made the old carousel read as an obligation.
        totalKind="neutral"
        more={Math.max(planned.length - rowsPerFace, 0)}
      >
        {planned.slice(0, rowsPerFace).map((item, idx) => {
          const overdue = item.daysLeft !== null && item.daysLeft < 0;
          const tone = overdue ? colors.danger : colors.credit;
          const parts = [
            item.daysLeft !== null ? formatDueLabel(item.daysLeft) : null,
            `${item.progressPct}% saved`,
          ].filter(Boolean);
          return (
            <UpcomingRow
              key={item.key}
              icon={<LucideTarget size={15} color={tone} />}
              tone={tone}
              label={item.label}
              sub={parts.join(' · ')}
              amount={item.amount}
              currency={currency}
              masked={masked}
              kind="neutral"
              first={idx === 0}
              onPress={() => onPressPlanned(item)}
            />
          );
        })}
      </LensFace>,
    );
  }

  const dotTone = (idx: number) =>
    (idx === 0 ? hasOverdueBill : hasOverdueGoal) ? colors.danger : colors.accent;

  return (
    <WidgetSection label="Upcoming">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={faces.length > 1}
        // Snap, not pagingEnabled: faces are inset by the gutter, so a
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
        {faces.map((face, idx) => (
          <MotiView
            key={idx}
            from={{ opacity: 0, translateY: 6 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 220, delay: idx * 50 }}
            style={{
              width: faceWidth,
              marginRight: idx === faces.length - 1 ? 0 : GAP,
            }}
          >
            {face}
          </MotiView>
        ))}
      </ScrollView>

      {faces.length > 1 && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          {faces.map((_, idx) => (
            <View
              key={idx}
              style={{
                width: idx === page ? 16 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: idx === page ? dotTone(idx) : colors.border,
              }}
            />
          ))}
        </View>
      )}
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
