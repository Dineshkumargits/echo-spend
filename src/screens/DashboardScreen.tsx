import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, { useCallback, useMemo, useState, useRef } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  Pressable,
  RefreshControl,
  Modal,
} from "react-native";
import { MotiView } from "moti";
import {
  LucidePlus,
  LucideWallet,
  LucideSearch,
  LucidePieChart,
  LucideTarget,
  LucideLandmark,
  LucideRepeat,
  LucideBrain,
  LucideDownload,
  LucideRefreshCcw,
  LucideSparkles,
  LucideCreditCard,
  LucideCoins,
  LucideEye,
  LucideEyeOff,
  LucideChevronRight,
  LucideLayoutGrid,
  LucideZap,
  LucideLock,
  LucideCrown,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useStore } from "../store/useStore";
import { useEntitlement } from "../hooks/useEntitlement";
import { useIsFocused } from "@react-navigation/native";
import { useTheme } from "../theme/ThemeProvider";
import { AIModelManager } from "../services/aiModelManager";
import AIModelSetupStep from "./AIModelSetupStep";
import { TourGuideModal } from "../components/TourGuideModal";
import {
  PulseDot,
  AmountText,
  SectionLabel,
  CycleBar,
  WaveformBar,
  WavePoint,
  ResonanceRings,
} from "../components/Signal";
import { fonts, formatINR, budgetPaceColor, withAlpha } from "../theme/tokens";
import { SignalRow, IconTile, Card } from "../components/Kit";
import { useAIInsights } from "../hooks/useAIInsights";
import { WidgetId, visibleWidgetIds } from "../components/dashboard/registry";
import { cycleAnchorFrom, type CycleWindow } from "../services/salaryCycle";
import {
  toCycle,
  getUpcomingBills,
  getPlannedContributions,
  getSafeToSpend,
  getCardHealth,
  UpcomingBill,
  PlannedContribution,
  CardHealth,
} from "../components/dashboard/derive";
import {
  UpcomingWidget,
  CreditCardsWidget,
  InsightCarousel,
} from "../components/dashboard/Widgets";
import { EditDashboardSheet } from "../components/dashboard/EditDashboardSheet";
import { PayBillSheet } from "../components/PayBillSheet";
import { UpdateBanner } from "../components/UpdateBanner";

import {
  getTransactions,
  Transaction,
  getAccounts,
  Account,
  getCategories,
  Category,
  getCurrentMonthSpend,
  getGoals,
  Goal,
  getLoans,
  Loan,
  getSubscriptions,
  Subscription,
  getUnconfirmedTransactions,
  getSpendTrend,
  SpendTrendPoint,
  getCategoryBreakdown,
  CategoryBreakdown,
  getBudgetUtilization,
  BudgetUtilization,
  budgetSelections,
  getPendingSplitMembers,
  PendingSplitMember,
  getActiveInsights,
  getLastInsightGenerationDate,
  getSalaryCycleWindowAsync,
  getOpenStatements,
  CardStatement,
  Insight,
  getLastScanTime,
} from "../services/database";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const timeGreeting = (): string => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

/** Relative time: just now / Nm ago / Nh ago / Nd ago / never */
const relativeTime = (iso: string | null): string => {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

const timeOnly = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

// ─── DashboardScreen ─────────────────────────────────────────────────────────

const DashboardScreen = ({ navigation }: any) => {
  const {
    preferences,
    aiModelStatus,
    aiModelNudgeDismissed,
    setAiModelNudgeDismissed,
    aiModelProgress,
    aiModelError,
    googleUser,
    lastSynced,
    toggleHideAmounts,
  } = useStore();
  const { colors, isDark } = useTheme();
  const { generateInsights } = useAIInsights();

  // ── Existing state ──────────────────────────────────────────────────────────
  const [transactions, setTransactions] = React.useState<Transaction[]>([]);
  const [accounts, setAccounts] = React.useState<Account[]>([]);
  const { canAdd, entitlement, isPro, trialDaysLeft } = useEntitlement();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [unconfirmedCount, setUnconfirmedCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const isFocused = useIsFocused();

  // ── New state (§4) ──────────────────────────────────────────────────────────
  const [trend14, setTrend14] = useState<SpendTrendPoint[]>([]);
  const [topCategories, setTopCategories] = useState<CategoryBreakdown[]>([]);
  const [budgetWatch, setBudgetWatch] = useState<BudgetUtilization[]>([]);
  const [pendingSplits, setPendingSplits] = useState<PendingSplitMember[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);

  // ── Customizable dashboard ─────────────────────────────────────────────────
  // Loans and subscriptions were already fetched for the commitments carousel;
  // they are kept in state now because the bills and safe-to-spend widgets
  // derive from them too.
  const [loans, setLoans] = useState<Loan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [showEditDashboard, setShowEditDashboard] = useState(false);
  // Open card statements — card bills and due amounts come from these, never
  // from the running balance.
  const [statements, setStatements] = useState<CardStatement[]>([]);
  // Card whose bill is being paid; null closes the sheet.
  const [payBillFor, setPayBillFor] = useState<CardHealth | null>(null);
  // Cycle boundaries now live in the DB (recorded salary dates), so they load
  // with everything else. Null until the first load completes.
  const [cycleWindow, setCycleWindow] = useState<CycleWindow | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const insightGenGuard = useRef(false);
  const celebratedGoals = useRef<Set<number>>(new Set());
  const [celebrationTrigger, setCelebrationTrigger] = useState(0);

  const currency = preferences.currency ?? "₹";

  // ── Derived values ──────────────────────────────────────────────────────────
  // CC outstanding is a liability — subtract it from net worth
  const totalBalance = useMemo(
    () =>
      accounts.reduce(
        (sum, acc) =>
          acc.accountType === "credit_card"
            ? sum - acc.balance
            : sum + acc.balance,
        0,
      ),
    [accounts],
  );

  const budgetPct = useMemo(
    () =>
      preferences.monthlyBudget > 0
        ? Math.min((monthlySpend / preferences.monthlyBudget) * 100, 100)
        : 0,
    [monthlySpend, preferences.monthlyBudget],
  );

  const triggerHaptic = useCallback(
    (style = Haptics.ImpactFeedbackStyle.Light) => {
      if (preferences.hapticsEnabled) Haptics.impactAsync(style);
    },
    [preferences.hapticsEnabled],
  );

  // ── Derived values for the day-to-day widgets ──────────────────────────────
  // The user's payday cycle, not the calendar month — safe-to-spend and the
  // "bills still due" window both have to agree on where the cycle ends.
  // Purely derived from the anchor — no query, no async, no flash of stale data.
  // Falls back to a calendar-month-ish window only until the real one loads,
  // so the widgets render immediately instead of flashing empty.
  const cycle = useMemo(
    () =>
      toCycle(
        cycleWindow ?? {
          start: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        },
      ),
    [cycleWindow],
  );

  /**
   * e.g. "5 Aug" — the date the current cycle ENDS, which is what a "till …"
   * label means. Date only: the exact minute matters to the cycle maths but is
   * noise on the dashboard.
   */
  const cycleLabel = useMemo(
    () =>
      cycleWindow
        ? cycleWindow.end.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
        : "\u2014",
    [cycleWindow],
  );

  // Taken from the resolved cycle rather than recomputed — the old inline
  // `new Date(y, m, salaryDay)` overflowed short months for day 29–31.
  const daysLeftInCycle = useMemo(() => cycle.daysRemaining, [cycle]);

  const upcomingBills = useMemo(
    () => getUpcomingBills(subscriptions, loans, accounts, cycle.end, new Date(), statements),
    [subscriptions, loans, accounts, statements, cycle],
  );

  // Intentions, not obligations — kept out of safeToSpendData on purpose.
  const plannedContributions = useMemo(
    () => getPlannedContributions(goals),
    [goals],
  );

  const safeToSpendData = useMemo(
    () => getSafeToSpend(preferences.monthlyBudget, monthlySpend, upcomingBills, cycle),
    [preferences.monthlyBudget, monthlySpend, upcomingBills, cycle],
  );

  /**
   * Budget minus spend minus bills still due before the cycle ends.
   *
   * Subtracting committed bills is the point: budget-minus-spend alone reads as
   * a healthy surplus on the 28th even when rent clears on the 30th, which is
   * exactly when people overspend. This used to live in a separate widget that
   * duplicated the hero — one number now, and it is this one.
   */
  const safeToSpend = useMemo(
    () => safeToSpendData.amount,
    [safeToSpendData],
  );

  const cardHealth = useMemo(
    () => getCardHealth(accounts, new Date(), statements),
    [accounts, statements],
  );

  // The ordered, enabled widget ids the ScrollView actually walks.
  const orderedWidgetIds = useMemo(
    () => visibleWidgetIds(preferences.dashboardLayout),
    [preferences.dashboardLayout],
  );

  const formatAmount = useCallback(
    (val: number) => {
      if (preferences.hideAmounts) return "****";
      return `${currency}${val.toLocaleString("en-IN")}`;
    },
    [preferences.hideAmounts, currency],
  );

  // ── Data loading (§4) ───────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    const [
      txs,
      accs,
      cats,
      spend,
      gs,
      ls,
      ss,
      unconfirmed,
      trendData,
      catBreakdown,
      budgetUtil,
      splits,
      activeInsights,
      scanTime,
      lastInsightGen,
      resolvedCycle,
      openStatements,
    ] = await Promise.all([
      getTransactions({ limit: 15, confirmedOnly: true }),
      getAccounts(),
      getCategories(),
      getCurrentMonthSpend(cycleAnchorFrom(preferences)),
      getGoals(true),
      getLoans(true),
      getSubscriptions(true),
      getUnconfirmedTransactions(),
      getSpendTrend(14),
      getCategoryBreakdown(),
      getBudgetUtilization(cycleAnchorFrom(preferences)),
      getPendingSplitMembers(),
      getActiveInsights(),
      getLastScanTime(),
      getLastInsightGenerationDate(),
      getSalaryCycleWindowAsync(cycleAnchorFrom(preferences)),
      getOpenStatements(),
    ]);
    setTransactions(txs);
    setAccounts(accs);
    setCategories(cats);
    setMonthlySpend(spend);
    setUnconfirmedCount(unconfirmed.length);
    setTrend14(trendData);
    setTopCategories(catBreakdown);
    setBudgetWatch(budgetUtil);
    setPendingSplits(splits);
    setInsights(activeInsights);
    setLastScanAt(scanTime);
    setGoals(gs);
    setLoans(ls);
    setSubscriptions(ss);
    setCycleWindow(resolvedCycle);
    setStatements(openStatements);

    // §3.6 Insight freshness: generate once per mount if stale.
    // Keyed on the last GENERATION date (dismissed rows included) rather than on
    // the visible list — otherwise dismissing every card reads as "never
    // generated" and immediately regenerates the same set.
    if (!insightGenGuard.current && txs.length > 0) {
      const todayStr = new Date().toISOString().split("T")[0];
      const newestInsightDate = lastInsightGen?.split("T")[0];
      if (!newestInsightDate || newestInsightDate !== todayStr) {
        insightGenGuard.current = true;
        generateInsights()
          .then((fresh) => setInsights(fresh))
          .catch(() => {});
      }
    }

    // §3.13 Celebration hook
    for (const g of gs) {
      if (
        g.currentAmount >= g.targetAmount &&
        !celebratedGoals.current.has(g.id)
      ) {
        celebratedGoals.current.add(g.id);
        setCelebrationTrigger((t) => t + 1);
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
    }
  }, [
    preferences.salaryDay,
    preferences.salaryTime,
    preferences.currency,
    preferences.hideAmounts,
    generateInsights,
  ]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    await loadData();
    setRefreshing(false);
  }, [loadData, triggerHaptic]);

  React.useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused, loadData]);

  // ── Memos ───────────────────────────────────────────────────────────────────
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.name, c])),
    [categories],
  );

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  // §3.9 Group recent transactions
  const groupedTransactions = useMemo(() => {
    const todayKey = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toDateString();

    const groups: { label: string; items: Transaction[] }[] = [];
    for (const tx of transactions.slice(0, 10)) {
      const key = new Date(tx.date).toDateString();
      const label =
        key === todayKey
          ? "Today"
          : key === yesterdayKey
            ? "Yesterday"
            : "Earlier";
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(tx);
      else groups.push({ label, items: [tx] });
    }
    return groups;
  }, [transactions]);

  // §3.3 Waveform data
  const waveData = useMemo<WavePoint[]>(
    () =>
      trend14.map((p) => ({
        value: p.total,
        kind: (p.total > 0 ? "out" : "faint") as WavePoint["kind"],
      })),
    [trend14],
  );
  const wavePeak = useMemo(
    () => Math.max(...trend14.map((p) => p.total), 0),
    [trend14],
  );

  // §3.5 Pulse strip
  const todaySpend = useMemo(
    () => (trend14.length > 0 ? trend14[trend14.length - 1].total : 0),
    [trend14],
  );
  const biggestPulse = useMemo(() => {
    const debits = transactions.filter((t) => t.type === "debit");
    if (debits.length === 0) return null;
    return debits.reduce(
      (max, t) => (t.amount > max.amount ? t : max),
      debits[0],
    );
  }, [transactions]);

  // §3.7 Budget watch — top 3 (already urgency-sorted by the DB), shown when
  // anything is ≥60% used OR pacing to blow its limit.
  const budgetWatchFiltered = useMemo(() => {
    const top3 = budgetWatch.filter((b) => !b.orphaned).slice(0, 3);
    return top3.some(
      (b) => b.percentage >= 60 || b.pace === "risk" || b.pace === "over",
    )
      ? top3
      : [];
  }, [budgetWatch]);

  // §3.8 Owed total
  const owedTotal = useMemo(
    () =>
      pendingSplits.reduce(
        (sum, m) => sum + Math.max(0, m.memberShare - m.memberPaidAmount),
        0,
      ),
    [pendingSplits],
  );
  const owedCount = useMemo(() => {
    const names = new Set(pendingSplits.map((m) => m.memberName));
    return names.size;
  }, [pendingSplits]);

  // §3.9 Account label helper (same as TransactionsScreen)
  const getAccountLabel = useCallback(
    (item: Transaction): string => {
      if (item.type === "transfer") {
        const from =
          item.accountId != null ? accountMap.get(item.accountId) : undefined;
        const to =
          item.toAccountId != null
            ? accountMap.get(item.toAccountId)
            : undefined;
        const parts = [from, to].filter((v): v is string => !!v);
        return parts.length > 0 ? ` · ${parts.join(" → ")}` : "";
      }
      if (item.accountId != null) {
        const name = accountMap.get(item.accountId);
        return name ? ` · ${name}` : "";
      }
      return "";
    },
    [accountMap],
  );

  const amountKind = (item: Transaction): "debit" | "credit" | "transfer" =>
    item.type === "credit"
      ? "credit"
      : item.type === "transfer"
        ? "transfer"
        : "debit";

  // ── Greeting ────────────────────────────────────────────────────────────────
  const greetingBase = useMemo(() => timeGreeting(), []);
  const firstName = useMemo(
    () => googleUser?.name?.split(" ")[0],
    [googleUser],
  );

  // ── Account icon helper ─────────────────────────────────────────────────────
  const accountIcon = (type: string | undefined) => {
    switch (type) {
      case "credit_card":
        return <LucideCreditCard color={colors.accent} size={16} />;
      case "cash":
        return <LucideCoins color={colors.accent} size={16} />;
      case "wallet":
        return <LucideWallet color={colors.accent} size={16} />;
      case "bank":
      default:
        return <LucideLandmark color={colors.accent} size={16} />;
    }
  };

  // ─── Main render ──────────────────────────────────────────────────────────

  // ── Widget sections ───────────────────────────────────────────────────────
  // Each entry is one dashboard widget. The screen never renders these in a
  // fixed order — it walks the user's resolved layout and looks each id up
  // here, so reordering and hiding are pure data changes.
  const widgetSections: Partial<Record<WidgetId, React.ReactNode>> = {
    // Upcoming — bills due this cycle, and one swipe away, what to set aside.
    upcomingBills: (
      <UpcomingWidget
        bills={upcomingBills}
        planned={plannedContributions}
        currency={currency}
        masked={preferences.hideAmounts}
        onPressBill={(bill: UpcomingBill) => {
          triggerHaptic();
          if (bill.target === "card") {
            navigation.navigate("BankAccountDetail", { accountId: bill.refId });
          } else {
            navigation.navigate("Finances", {
              initialTab: bill.target,
              highlightId: bill.refId,
            });
          }
        }}
        onPressPlanned={(item: PlannedContribution) => {
          triggerHaptic();
          navigation.navigate("Finances", {
            initialTab: "goals",
            highlightId: item.refId,
          });
        }}
        onSeeAllBills={() => {
          triggerHaptic();
          navigation.navigate("Finances", { initialTab: "subs" });
        }}
        onSeeAllGoals={() => {
          triggerHaptic();
          navigation.navigate("Finances", { initialTab: "goals" });
        }}
      />
    ),

    // Credit cards — utilization against limit, statement and payment dates.
    creditCards: (
      <CreditCardsWidget
        cards={cardHealth}
        currency={currency}
        masked={preferences.hideAmounts}
        onPressCard={(card: CardHealth) => {
          triggerHaptic();
          navigation.navigate("BankAccountDetail", { accountId: card.account.id });
        }}
        onAddCard={() => {
          triggerHaptic();
          if (!canAdd("accounts", accounts.length)) {
            navigation.navigate("Paywall", { trigger: "limit_reached" });
            return;
          }
          navigation.navigate("AddAccount");
        }}
        onPayBill={(card: CardHealth) => {
          triggerHaptic();
          setPayBillFor(card);
        }}
        onSeeAll={() => {
          triggerHaptic();
          navigation.navigate("Finances", { initialTab: "cards" });
        }}
      />
    ),

    // §3.2 Hero: Safe to Spend + daily pace line
    hero: (
        <MotiView
          from={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ marginBottom: 24 }}
        >
          {/* §3.2 Net worth hero */}
          <SectionLabel
            color={totalBalance < 0 ? colors.danger : colors.accent}
          >
            Net worth
          </SectionLabel>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              marginTop: 6,
            }}
          >
            <ThemedText
              font="display"
              style={{
                fontFamily: fonts.displayBold,
                fontSize: 44,
                lineHeight: 52,
                color: totalBalance < 0 ? colors.danger : colors.primary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {totalBalance < 0 ? "−" : ""}
              {formatAmount(Math.abs(totalBalance))}
            </ThemedText>
            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                toggleHideAmounts();
              }}
              activeOpacity={0.7}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.translucent,
              }}
            >
              {preferences.hideAmounts ? (
                <LucideEyeOff color={colors.secondary} size={15} />
              ) : (
                <LucideEye color={colors.secondary} size={15} />
              )}
            </TouchableOpacity>
          </View>

          {/* Cycle progress bar */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: 16,
              gap: 10,
            }}
          >
            <CycleBar
              pct={budgetPct}
              color={budgetPct >= 100 ? colors.danger : undefined}
              style={{ flex: 1 }}
            />
            <ThemedText
              font="signal"
              style={{ fontSize: 10, color: colors.secondary }}
            >
              {daysLeftInCycle}d left
            </ThemedText>
          </View>

          {/* §3.2 Safe to spend — below the bar */}
          {preferences.monthlyBudget > 0 ? (
            <>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 10,
                }}
              >
                <SectionLabel
                  color={safeToSpend < 0 ? colors.danger : colors.accent}
                  style={{ flex: 1, marginRight: 12 }}
                >
                  {safeToSpend < 0
                    ? `Over budget · till ${cycleLabel}`
                    : `Safe to spend · till ${cycleLabel}`}
                </SectionLabel>
                <ThemedText
                  font="signal"
                  style={{
                    fontFamily: fonts.signalBold,
                    fontSize: 15,
                    color: safeToSpend < 0 ? colors.danger : colors.primary,
                    fontVariant: ["tabular-nums"],
                    flexShrink: 0,
                  }}
                >
                  {safeToSpend < 0 ? "−" : ""}
                  {formatAmount(Math.abs(safeToSpend))}
                </ThemedText>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  marginTop: 6,
                }}
              >
                {/* Both halves pinned to one line so this row stays aligned with
                    the amount row above it, whatever the numbers are. */}
                <ThemedText
                  font="signal"
                  numberOfLines={1}
                  style={{ fontSize: 10, color: colors.secondary, flexShrink: 1, marginRight: 12 }}
                >
                  spent{" "}
                  {preferences.hideAmounts
                    ? "••••"
                    : formatAmount(monthlySpend)}
                  {` of ${preferences.hideAmounts ? "••••" : formatAmount(preferences.monthlyBudget)}`}
                </ThemedText>
                {daysLeftInCycle > 0 && (
                  <ThemedText
                    font="signal"
                    numberOfLines={1}
                    style={{
                      fontSize: 10,
                      color: safeToSpend < 0 ? colors.danger : colors.secondary,
                      flexShrink: 0,
                    }}
                  >
                    {safeToSpend < 0
                      ? `over by ${preferences.hideAmounts ? "••••" : `${currency}${formatINR(Math.abs(safeToSpend))}`} · resets in ${daysLeftInCycle}d`
                      : `${preferences.hideAmounts ? "••••" : `${currency}${formatINR(Math.floor(safeToSpend / daysLeftInCycle))}`}/day · ${daysLeftInCycle}d left`}
                  </ThemedText>
                )}
              </View>
            </>
          ) : (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 10,
              }}
            >
              <SectionLabel color={colors.accent}>
                Cycle spending · from the {cycleLabel}
              </SectionLabel>
              <ThemedText
                font="signal"
                style={{
                  fontFamily: fonts.signalBold,
                  fontSize: 15,
                  color: colors.primary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatAmount(monthlySpend)}
              </ThemedText>
            </View>
          )}
        </MotiView>
    ),
    // §3.10 Accounts — restyled on kit
    accounts: (
        <View style={{ marginBottom: 24 }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <SectionLabel>Linked accounts</SectionLabel>
            <TouchableOpacity
              onPress={() => navigation.navigate("ManageAccounts")}
            >
              <ThemedText
                style={{
                  fontSize: 12,
                  fontFamily: fonts.textSemibold,
                  color: colors.accent,
                }}
              >
                Manage
              </ThemedText>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -24 }}
            contentContainerStyle={{ paddingHorizontal: 24, paddingRight: 64 }}
          >
            {accounts.map((acc, idx) => (
              <MotiView
                key={acc.id}
                from={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "timing", duration: 240, delay: idx * 40 }}
                style={{ marginRight: 12, width: 176 }}
              >
                <Card
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate("BankAccountDetail", {
                      accountId: acc.id,
                    });
                  }}
                  style={{ padding: 16 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 14,
                    }}
                  >
                    <IconTile color={colors.accent} size={32}>
                      {accountIcon(acc.accountType)}
                    </IconTile>
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                        borderRadius: 99,
                        backgroundColor: colors.translucent,
                      }}
                    >
                      <ThemedText
                        font="signal"
                        type="secondary"
                        style={{
                          fontSize: 9,
                          textTransform: "uppercase",
                          letterSpacing: 1,
                        }}
                      >
                        {acc.accountType?.replace("_", " ") || "bank"}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText
                    type="secondary"
                    style={{ fontSize: 12 }}
                    numberOfLines={1}
                  >
                    {acc.name}
                  </ThemedText>
                  <ThemedText
                    style={{
                      fontFamily: fonts.signalBold,
                      fontSize: 16,
                      marginTop: 4,
                      color:
                        acc.accountType === "credit_card"
                          ? colors.debit
                          : colors.primary,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {acc.accountType === "credit_card" ? "−" : ""}
                    {preferences.hideAmounts
                      ? "••••"
                      : `${currency}${formatINR(acc.balance)}`}
                  </ThemedText>
                </Card>
              </MotiView>
            ))}

            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                if (!canAdd("accounts", accounts.length)) {
                  navigation.navigate("Paywall", { trigger: "limit_reached" });
                  return;
                }
                navigation.navigate("AddAccount");
              }}
              style={{
                padding: 16,
                borderRadius: 20,
                width: 176,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.secondary,
                backgroundColor: colors.translucent,
              }}
            >
              <LucidePlus color={colors.primary} size={24} />
              <ThemedText
                type="secondary"
                style={{ fontSize: 12, marginTop: 8 }}
              >
                Add Account
              </ThemedText>
            </TouchableOpacity>
          </ScrollView>
        </View>
    ),
    // §3.4 Smart Inbox pulse chip — unchanged
    inboxPulse: (
         unconfirmedCount > 0 && (
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            style={{ marginBottom: 24 }}
          >
            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                navigation.navigate("SmartInbox");
              }}
              activeOpacity={0.8}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 16,
                borderRadius: 14,
                borderWidth: 1,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                gap: 12,
              }}
            >
              <PulseDot />
              <ThemedText
                style={{
                  flex: 1,
                  fontFamily: fonts.textSemibold,
                  fontSize: 14,
                }}
              >
                {unconfirmedCount} signal{unconfirmedCount !== 1 ? "s" : ""}{" "}
                awaiting review
              </ThemedText>
              <ThemedText style={{ color: colors.secondary, fontSize: 16 }}>
                →
              </ThemedText>
            </TouchableOpacity>
          </MotiView>
        )
    ),
    // §3.7 Budget watch mini
    budgetWatch: (
         budgetWatchFiltered.length > 0 && (
          <View style={{ marginBottom: 24 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <SectionLabel>Budget watch</SectionLabel>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic();
                  navigation.navigate("Budget");
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 2 }}
                hitSlop={8}
              >
                <ThemedText
                  font="signal"
                  style={{ fontSize: 10, color: colors.accent }}
                >
                  MANAGE
                </ThemedText>
                <LucideChevronRight color={colors.accent} size={13} />
              </TouchableOpacity>
            </View>
            {budgetWatchFiltered.map((item) => {
              const barColor = budgetPaceColor(item.pace, colors);
              return (
                <Pressable
                  key={item.budget.id}
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate("Txns", {
                      presetCategoryGroups: budgetSelections(item.budget),
                    });
                  }}
                  style={{ marginBottom: 10 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <ThemedText
                      style={{ fontFamily: fonts.textSemibold, fontSize: 13 }}
                      numberOfLines={1}
                    >
                      {item.displayName}
                    </ThemedText>
                    <ThemedText
                      font="signal"
                      style={{
                        fontSize: 11,
                        color: barColor,
                        fontFamily: fonts.signalBold,
                      }}
                    >
                      {item.pace === "risk"
                        ? `${item.percentage}% · pacing over`
                        : item.pace === "reached"
                          ? `${item.percentage}% · limit reached`
                          : `${item.percentage}%`}
                    </ThemedText>
                  </View>
                  <View>
                    <CycleBar
                      pct={item.percentage}
                      color={barColor}
                      height={4}
                    />
                    {/* Elapsed-cycle tick: where usage "should" be today */}
                    <View
                      style={{
                        position: "absolute",
                        left: `${Math.min(item.elapsedPct, 99)}%`,
                        top: -1,
                        width: 2,
                        height: 6,
                        backgroundColor: colors.secondary,
                      }}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        )
    ),
    // §3.8 Owed to you
    owed: (
         pendingSplits.length > 0 && owedTotal > 0 && (
          <Card
            onPress={() => {
              triggerHaptic();
              navigation.navigate("Finances", { initialTab: "splits" });
            }}
            style={{ marginBottom: 24, padding: 16 }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <IconTile emoji="🤝" color={colors.credit} size={40} />
              <View style={{ flex: 1 }}>
                <ThemedText
                  style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}
                >
                  {owedCount} {owedCount === 1 ? "person owes" : "people owe"}{" "}
                  you
                </ThemedText>
              </View>
              <ThemedText
                font="signal"
                style={{
                  fontFamily: fonts.signalBold,
                  fontSize: 14,
                  color: colors.credit,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {preferences.hideAmounts
                  ? "••••"
                  : `+${currency}${formatINR(owedTotal)}`}
              </ThemedText>
            </View>
          </Card>
        )
    ),
    // §3.5 Pulse strip — 3 stat tiles
    pulseStrip: (
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
          <Card style={{ flex: 1, padding: 12 }}>
            <SectionLabel>Today</SectionLabel>
            <ThemedText
              style={{
                fontFamily: fonts.signalBold,
                fontSize: 16,
                color: colors.debit,
                marginTop: 4,
                fontVariant: ["tabular-nums"],
              }}
              numberOfLines={1}
            >
              {preferences.hideAmounts
                ? "••••"
                : todaySpend > 0
                  ? `${currency}${formatINR(todaySpend)}`
                  : "—"}
            </ThemedText>
          </Card>
          <Card style={{ flex: 1, padding: 12 }}>
            <SectionLabel>Top cat</SectionLabel>
            {topCategories.length > 0 ? (
              <>
                <ThemedText
                  style={{
                    fontFamily: fonts.signalBold,
                    fontSize: 16,
                    color:
                      categoryMap.get(topCategories[0].category)?.color ||
                      colors.secondary,
                    marginTop: 4,
                    fontVariant: ["tabular-nums"],
                  }}
                  numberOfLines={1}
                >
                  {topCategories[0].percentage}%
                </ThemedText>
                <ThemedText
                  font="signal"
                  type="secondary"
                  style={{ fontSize: 9, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {topCategories[0].category}
                </ThemedText>
              </>
            ) : (
              <ThemedText
                style={{
                  fontFamily: fonts.signalBold,
                  fontSize: 16,
                  color: colors.secondary,
                  marginTop: 4,
                }}
              >
                —
              </ThemedText>
            )}
          </Card>
          <Card style={{ flex: 1, padding: 12 }}>
            <SectionLabel>Biggest</SectionLabel>
            {biggestPulse ? (
              <>
                <ThemedText
                  style={{
                    fontFamily: fonts.signalBold,
                    fontSize: 16,
                    color: colors.debit,
                    marginTop: 4,
                    fontVariant: ["tabular-nums"],
                  }}
                  numberOfLines={1}
                >
                  {preferences.hideAmounts
                    ? "••••"
                    : `${currency}${formatINR(biggestPulse.amount)}`}
                </ThemedText>
                <ThemedText
                  font="signal"
                  type="secondary"
                  style={{ fontSize: 9, marginTop: 2 }}
                  numberOfLines={1}
                >
                  {biggestPulse.merchant}
                </ThemedText>
              </>
            ) : (
              <ThemedText
                style={{
                  fontFamily: fonts.signalBold,
                  fontSize: 16,
                  color: colors.secondary,
                  marginTop: 4,
                }}
              >
                —
              </ThemedText>
            )}
          </Card>
        </View>
    ),
    // §3.3 Cycle waveform — the signature moment
    waveform: (
         trend14.length > 0 && (
          <Pressable
            onPress={() => {
              triggerHaptic();
              navigation.navigate("Analytics");
            }}
            style={{ marginBottom: 24 }}
          >
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: "timing", duration: 400 }}
            >
              <WaveformBar
                data={waveData}
                height={40}
                barWidth={8}
                style={{ width: "100%" }}
              />
              {wavePeak > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: 6,
                  }}
                >
                  <ThemedText
                    font="signal"
                    style={{ fontSize: 9, color: colors.muted }}
                  >
                    last 14 days
                  </ThemedText>
                  <ThemedText
                    font="signal"
                    style={{ fontSize: 9, color: colors.muted }}
                  >
                    peak{" "}
                    {preferences.hideAmounts
                      ? "••••"
                      : `${currency}${formatINR(wavePeak)}`}
                  </ThemedText>
                </View>
              )}
            </MotiView>
          </Pressable>
        )
    ),
    // §3.6 Insights — swipeable deck (see InsightCarousel for why not dismissible)
    insight: <InsightCarousel insights={insights} />,
    // §3.9 Activity feed — migrated to SignalRow
    activity: (
        <View style={{ marginBottom: 24 }}>
          {groupedTransactions.map((group) => (
            <View key={group.label}>
              <View style={{ paddingTop: 10, paddingBottom: 2 }}>
                <SectionLabel>{group.label}</SectionLabel>
              </View>
              {group.items.map((tx) => {
                const cat = categoryMap.get(tx.category);
                const kind = amountKind(tx);
                const nodeColor =
                  kind === "credit"
                    ? colors.credit
                    : kind === "debit"
                      ? colors.debit
                      : colors.secondary;
                return (
                  <SignalRow
                    key={tx.id}
                    emoji={cat?.icon ?? "📁"}
                    iconColor={cat?.color || colors.secondary}
                    title={tx.merchant}
                    subtitle={`${timeOnly(tx.date)} · ${tx.category}${getAccountLabel(tx)}${tx.tags && tx.tags.length > 0 ? ` · ${tx.tags.map((t: string) => "#" + t).join(" ")}` : ""}`}
                    nodeColor={nodeColor}
                    right={
                      <AmountText
                        value={tx.amount}
                        kind={kind}
                        showSign={kind !== "transfer"}
                        currency={currency}
                        masked={preferences.hideAmounts}
                        size={14}
                      />
                    }
                    onPress={() => {
                      triggerHaptic();
                      navigation.navigate("TransactionDetail", {
                        transaction: tx,
                      });
                    }}
                    rail={false}
                    padded={false}
                  />
                );
              })}
            </View>
          ))}
          {transactions.length === 0 && (
            <View
              style={{
                paddingTop: 40,
                paddingBottom: 16,
                alignItems: "center",
              }}
            >
              <ThemedText type="secondary">
                No signals yet — add a transaction or run a scan.
              </ThemedText>
            </View>
          )}
          {transactions.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                triggerHaptic();
                navigation.navigate("Txns");
              }}
              style={{ alignItems: "center", paddingVertical: 14 }}
            >
              <ThemedText
                font="signal"
                style={{
                  fontSize: 10,
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  color: colors.accent,
                }}
              >
                All transactions →
              </ThemedText>
            </TouchableOpacity>
          )}
        </View>
    ),
  };

  return (
    <ThemedSafeAreaView>
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.accent]}
            tintColor={colors.accent}
          />
        }
      >
        {/* §3.1 Header — personal greeting */}
        <View style={{ marginTop: 16, marginBottom: 20 }}>
          {/* Top row: brand label + action icons (full width, no overflow) */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <SectionLabel>Echo Spend</SectionLabel>
              {isPro && entitlement.source === "trial" && (
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate("Paywall", { trigger: "trial_ended" });
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 99,
                    backgroundColor: withAlpha(colors.accent, "18"),
                    borderWidth: 1,
                    borderColor: withAlpha(colors.accent, "35"),
                  }}
                >
                  <LucideZap color={colors.accent} size={11} />
                  <ThemedText style={{ fontSize: 10, fontWeight: "700", color: colors.accent }}>
                    {trialDaysLeft === 0 ? "Trial ends today" : `${trialDaysLeft}d trial left`}
                  </ThemedText>
                </TouchableOpacity>
              )}
              {isPro && entitlement.source === "founder" && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 99,
                    backgroundColor: "rgba(245, 158, 11, 0.15)",
                    borderWidth: 1,
                    borderColor: "rgba(245, 158, 11, 0.35)",
                  }}
                >
                  <LucideCrown color="#F59E0B" size={11} />
                  <ThemedText style={{ fontSize: 10, fontWeight: "700", color: "#F59E0B" }}>
                    Founder
                  </ThemedText>
                </View>
              )}
              {isPro && entitlement.source === "lifetime" && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 99,
                    backgroundColor: withAlpha(colors.accent, "18"),
                    borderWidth: 1,
                    borderColor: withAlpha(colors.accent, "35"),
                  }}
                >
                  <LucideSparkles color={colors.accent} size={11} />
                  <ThemedText style={{ fontSize: 10, fontWeight: "700", color: colors.accent }}>
                    Lifetime Pro
                  </ThemedText>
                </View>
              )}
              {isPro && entitlement.source === "play_sub" && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 99,
                    backgroundColor: withAlpha(colors.accent, "18"),
                    borderWidth: 1,
                    borderColor: withAlpha(colors.accent, "35"),
                  }}
                >
                  <LucideSparkles color={colors.accent} size={11} />
                  <ThemedText style={{ fontSize: 10, fontWeight: "700", color: colors.accent }}>
                    Echo Pro
                  </ThemedText>
                </View>
              )}
              {!isPro && (
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate("Paywall", { trigger: "trial_ended" });
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 99,
                    backgroundColor: withAlpha(colors.secondary, "14"),
                    borderWidth: 1,
                    borderColor: withAlpha(colors.secondary, "30"),
                  }}
                >
                  <LucideLock color={colors.accent} size={10} />
                  <ThemedText style={{ fontSize: 10, fontWeight: "700", color: colors.primary }}>
                    Free Plan · Upgrade
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic();
                  setShowTour(true);
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.translucent,
                }}
              >
                <LucideSparkles color={colors.ai} size={16} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic();
                  navigation.navigate("Search");
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.translucent,
                }}
              >
                <LucideSearch color={colors.secondary} size={17} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic();
                  setShowEditDashboard(true);
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.translucent,
                }}
              >
                <LucideLayoutGrid color={colors.secondary} size={17} />
              </TouchableOpacity>
            </View>
          </View>
          {/* Greeting + name below, spanning full width so long names never overflow */}
          <MotiView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 500 }}
          >
            {firstName ? (
              <>
                <ThemedText
                  font="signal"
                  type="secondary"
                  style={{ fontSize: 13, marginTop: 10, letterSpacing: 0.3 }}
                >
                  {greetingBase}
                </ThemedText>
                <ThemedText
                  font="display"
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 26,
                    lineHeight: 32,
                    marginTop: 2,
                  }}
                  numberOfLines={2}
                >
                  {firstName}
                </ThemedText>
              </>
            ) : (
              <ThemedText
                font="display"
                style={{
                  fontFamily: fonts.display,
                  fontSize: 24,
                  lineHeight: 32,
                  marginTop: 10,
                }}
                numberOfLines={2}
              >
                {greetingBase}
              </ThemedText>
            )}
          </MotiView>
        </View>

        {/* App update banner. Above the widgets rather than down with the AI
            nudge: the widget stack is long and user-reorderable, so anything
            below it is effectively invisible. Renders null when up to date. */}
        <UpdateBanner />

        {/* Widgets — order and visibility come from the user's saved layout. */}
        {orderedWidgetIds.map((id) => (
          <React.Fragment key={id}>{widgetSections[id]}</React.Fragment>
        ))}

        {/* §3.13 Goal-completion celebration. Rendered at the screen level
            rather than inside a widget: it used to live in the commitments
            carousel, which is off by default, so finishing a goal celebrated
            into a hidden widget. */}
        {celebrationTrigger > 0 && (
          <ResonanceRings
            trigger={celebrationTrigger}
            color={colors.success}
            size={120}
            style={{ alignSelf: "center", marginBottom: 24 }}
          />
        )}

        {/* AI Setup Nudge Card */}
        {((!aiModelNudgeDismissed && aiModelStatus === "not_downloaded") ||
          aiModelStatus === "downloading" ||
          aiModelStatus === "paused" ||
          aiModelStatus === "error") &&
          AIModelManager.isDeviceCompatible() && (
            <MotiView
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                padding: 20,
                borderRadius: 14,
                marginBottom: 24,
                borderWidth: 1,
                flexDirection: "row",
                gap: 16,
                backgroundColor: colors.creditSoft,
                borderColor: `${colors.ai}30`,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  backgroundColor: `${colors.ai}25`,
                }}
              >
                <LucideBrain color={colors.ai} size={20} />
              </View>
              <View style={{ flex: 1 }}>
                {aiModelStatus === "not_downloaded" && (
                  <>
                    <ThemedText
                      style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}
                    >
                      Unlock Echo AI
                    </ThemedText>
                    <ThemedText
                      type="secondary"
                      style={{ fontSize: 12, marginTop: 4, lineHeight: 18 }}
                    >
                      Download the local Echo AI engine to enable automatic
                      transaction classification. Everything runs 100% privately
                      on your device.
                    </ThemedText>
                    <View
                      style={{ flexDirection: "row", gap: 16, marginTop: 16 }}
                    >
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic();
                          setShowSetupModal(true);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderRadius: 8,
                          backgroundColor: colors.accent,
                        }}
                      >
                        <ThemedText
                          style={{
                            color: colors.onAccent,
                            fontFamily: fonts.textSemibold,
                            fontSize: 12,
                          }}
                        >
                          Setup Echo AI
                        </ThemedText>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic();
                          setAiModelNudgeDismissed(true);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: colors.border,
                        }}
                      >
                        <ThemedText
                          type="secondary"
                          style={{
                            fontFamily: fonts.textSemibold,
                            fontSize: 12,
                          }}
                        >
                          Dismiss
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {aiModelStatus === "downloading" && (
                  <>
                    <ThemedText
                      style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}
                    >
                      Downloading Echo AI...
                    </ThemedText>
                    <View style={{ marginTop: 12 }}>
                      <View
                        style={{
                          width: "100%",
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: colors.border,
                          overflow: "hidden",
                        }}
                      >
                        <MotiView
                          animate={{ width: `${aiModelProgress}%` }}
                          transition={{ type: "timing", duration: 300 }}
                          style={{
                            height: "100%",
                            borderRadius: 3,
                            backgroundColor: colors.accent,
                          }}
                        />
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          marginTop: 6,
                        }}
                      >
                        <ThemedText type="secondary" style={{ fontSize: 10 }}>
                          Downloading...
                        </ThemedText>
                        <ThemedText
                          style={{
                            fontFamily: fonts.signalBold,
                            fontSize: 10,
                            color: colors.accent,
                          }}
                        >
                          {aiModelProgress}%
                        </ThemedText>
                      </View>
                    </View>
                    <View
                      style={{ flexDirection: "row", gap: 16, marginTop: 16 }}
                    >
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic();
                          setShowSetupModal(true);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderRadius: 8,
                          backgroundColor: colors.accent,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <LucideDownload color={colors.onAccent} size={12} />
                        <ThemedText
                          style={{
                            color: colors.onAccent,
                            fontFamily: fonts.textSemibold,
                            fontSize: 12,
                          }}
                        >
                          View Progress
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  </>
                )}

                {aiModelStatus === "error" && (
                  <>
                    <ThemedText
                      style={{
                        fontFamily: fonts.textSemibold,
                        fontSize: 14,
                        color: colors.danger,
                      }}
                    >
                      Echo AI Download Failed
                    </ThemedText>
                    <ThemedText
                      type="secondary"
                      style={{ fontSize: 12, marginTop: 4 }}
                    >
                      {aiModelProgress > 0
                        ? `Failed at ${aiModelProgress}%. `
                        : ""}
                      {aiModelError ||
                        "Please check your connection and try again."}
                    </ThemedText>
                    <View
                      style={{ flexDirection: "row", gap: 16, marginTop: 16 }}
                    >
                      <TouchableOpacity
                        onPress={() => {
                          triggerHaptic();
                          setShowSetupModal(true);
                        }}
                        style={{
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                          borderRadius: 8,
                          backgroundColor: colors.accent,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <LucideRefreshCcw color={colors.onAccent} size={12} />
                        <ThemedText
                          style={{
                            color: colors.onAccent,
                            fontFamily: fonts.textSemibold,
                            fontSize: 12,
                          }}
                        >
                          Retry Setup
                        </ThemedText>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            </MotiView>
          )}

        {/* §3.12 Status footer */}
        <View
          style={{ alignItems: "center", paddingVertical: 12, marginBottom: 8 }}
        >
          <ThemedText
            font="signal"
            style={{ fontSize: 9, color: colors.muted, textAlign: "center" }}
          >
            {[
              lastScanAt !== undefined
                ? `scan ${relativeTime(lastScanAt)}`
                : null,
              lastSynced !== undefined
                ? `sync ${relativeTime(lastSynced)}`
                : null,
              `AI ${aiModelStatus === "ready" || aiModelStatus === "downloaded" ? "on-device" : "off"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </ThemedText>
        </View>

        {/* Bottom spacer for FAB clearance */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* FAB — pulse amber: the "emit a transaction" action */}
      <TouchableOpacity
        onPress={() => {
          triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
          navigation.navigate("AddTransaction");
        }}
        activeOpacity={0.85}
        style={{
          position: "absolute",
          bottom: 32,
          right: 24,
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: "center",
          justifyContent: "center",
          elevation: 8,
          backgroundColor: colors.accent,
          shadowColor: colors.accent,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.35,
          shadowRadius: 10,
        }}
      >
        <LucidePlus color={colors.onAccent} size={32} />
      </TouchableOpacity>

      {/* AI Setup Modal */}
      <Modal
        visible={showSetupModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowSetupModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <AIModelSetupStep
            showClose
            onComplete={() => setShowSetupModal(false)}
          />
        </View>
      </Modal>

      {/* Tour Guide Modal */}
      <TourGuideModal visible={showTour} onClose={() => setShowTour(false)} />

      {/* Edit dashboard — show/hide and reorder widgets */}
      <EditDashboardSheet
        visible={showEditDashboard}
        onClose={() => setShowEditDashboard(false)}
      />

      {/* Pay a credit card bill — records a transfer and reduces the statement */}
      <PayBillSheet
        visible={payBillFor !== null}
        onClose={() => setPayBillFor(null)}
        card={payBillFor?.account ?? null}
        statement={payBillFor?.statement ?? null}
        // Cards can't fund other cards.
        fundingAccounts={accounts.filter((a) => a.accountType !== "credit_card")}
        currency={currency}
        masked={preferences.hideAmounts}
        onPaid={loadData}
      />
    </ThemedSafeAreaView>
  );
};

export default DashboardScreen;
