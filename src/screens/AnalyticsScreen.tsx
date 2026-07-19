import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Modal,
  GestureResponderEvent,
  Pressable,
} from "react-native";
import { MotiView } from "moti";
import { LineChart } from "react-native-wagmi-charts";
import {
  LucideAlertCircle,
  LucideLightbulb,
  LucideX,
  LucideTrendingDown,
  LucideRefreshCw,
  LucideFlame,
  LucideChevronRight,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { renderCategoryIcon } from "../components/CategoryManager";
import { notify } from "../utils/notify";
import { SectionLabel, AmountText } from "../components/Signal";
import {
  DeltaChip,
  SavingsMeter,
  WeekdayBars,
  TopMerchants,
  InteractiveDonut,
  CalendarHeatmap,
  PremiumGate,
  DonutSegment,
} from "../components/AnalyticsKit";
import { fonts } from "../theme/tokens";
import {
  getSpendTrend,
  getCategoryBreakdown,
  getSpendingByTag,
  getMonthlyTotals,
  getCategories,
  getBudgetUtilization,
  getHighSpendTransactions,
  getWeekdaySpending,
  getTopMerchants,
  getTransactions,
  dismissInsight,
  SpendTrendPoint,
  CategoryBreakdown,
  Insight,
  Category,
  BudgetUtilization,
  budgetSelections,
  Transaction,
} from "../services/database";
import { useAIInsights } from "../hooks/useAIInsights";
import { useTheme } from "../theme/ThemeProvider";
import { useStore } from "../store/useStore";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

const INSIGHT_ICONS: Record<string, any> = {
  anomaly: LucideAlertCircle,
  suggestion: LucideLightbulb,
  weekly_digest: LucideTrendingDown,
  recurring_detected: LucideRefreshCw,
};

const TREND_PERIODS = [7, 14, 30, 90];

const AnalyticsScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();

  const [trend, setTrend] = useState<SpendTrendPoint[]>([]);
  const [rhythm, setRhythm] = useState<SpendTrendPoint[]>([]);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown[]>([]);
  const [tagsBreakdown, setTagsBreakdown] = useState<
    { tag: string; total: number; count: number }[]
  >([]);
  const [monthlyTotals, setMonthlyTotals] = useState<any[]>([]);
  const [budgetUtil, setBudgetUtil] = useState<BudgetUtilization[]>([]);
  const [highSpends, setHighSpends] = useState<Transaction[]>([]);
  const [weekday, setWeekday] = useState<
    { weekday: number; total: number; count: number }[]
  >([]);
  const [merchants, setMerchants] = useState<
    { merchant: string; total: number; count: number }[]
  >([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [trendDays, setTrendDays] = useState(7);
  const [trendMode, setTrendMode] = useState<"daily" | "cumulative">("daily");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayTxns, setDayTxns] = useState<Transaction[]>([]);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number } | null>(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const { getInsights, generateInsights } = useAIInsights();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? "₹";
  const onFill = colors.onAccent;

  // Premium seam — advanced sections are wrapped in <PremiumGate>. Flip this to
  // false (from the future subscription flow) to lock them behind the paywall.
  const isPremium = true;

  const INSIGHT_COLORS: Record<string, string> = {
    anomaly: colors.danger,
    suggestion: colors.credit,
    weekly_digest: colors.ai,
    recurring_detected: colors.debit,
  };

  const loadData = useCallback(async () => {
    const dStart =
      new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .slice(0, 10) + " 00:00:00";
    const dEnd = new Date().toISOString().slice(0, 10) + " 23:59:59";
    const [t, r30, b, m, i, cats, tb, bu, hs, wd, tm] = await Promise.all([
      getSpendTrend(trendDays),
      getSpendTrend(30),
      getCategoryBreakdown(),
      getMonthlyTotals(),
      getInsights(),
      getCategories(),
      getSpendingByTag(dStart, dEnd),
      getBudgetUtilization(preferences.salaryDay),
      getHighSpendTransactions(),
      getWeekdaySpending(84),
      getTopMerchants(undefined, 6),
    ]);
    setTrend(t);
    setRhythm(r30);
    setBreakdown(b);
    setMonthlyTotals(m);
    setInsights(i);
    setCategories(cats);
    setTagsBreakdown(tb);
    setBudgetUtil(bu);
    setHighSpends(hs.slice(0, 6));
    setWeekday(wd);
    setMerchants(tm);
    setLoading(false);
    setRefreshing(false);
  }, [trendDays, getInsights, preferences.salaryDay]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const handleGenerateInsights = async () => {
    setGeneratingInsights(true);
    try {
      const fresh = await generateInsights();
      setInsights(fresh);
      notify.success("Insights updated");
    } catch {
      notify.error("Failed to generate insights");
    }
    setGeneratingInsights(false);
  };

  const handleDismissInsight = async (id: number) => {
    await dismissInsight(id);
    setInsights((prev) => prev.filter((i) => i.id !== id));
  };

  // Drill-downs into the (sibling tab) Transactions timeline. Category cards are
  // parent groups, so drill parent-inclusive (parent + its subcategories).
  // Both the breakdown and top-merchants data here are scoped to the current
  // calendar month, so carry that window along — otherwise the filtered list
  // silently shows all-time totals instead of matching what was tapped.
  const drillCategory = (name: string) =>
    navigation.navigate("Txns", {
      presetCategoryGroup: name,
      presetDatePreset: "month",
    });
  const drillMerchant = (name: string) =>
    navigation.navigate("Txns", {
      presetSearch: name,
      presetDatePreset: "month",
    });

  // Tap a calendar day → fetch that day's spending to preview inline.
  const handleDayPress = useCallback(async (date: string, event?: GestureResponderEvent) => {
    if (!date) {
      setSelectedDay(null);
      setDayTxns([]);
      setPopoverAnchor(null);
      return;
    }
    if (event) {
      const { pageX, pageY } = event.nativeEvent;
      setPopoverAnchor({ x: pageX, y: pageY });
    }
    setSelectedDay(date);
    setDayTxns([]);
    setLoadingTxns(true);
    try {
      const txns = await getTransactions({
        startDate: date,
        endDate: date,
        type: "debit",
        confirmedOnly: true,
        limit: 20,
      });
      setDayTxns(txns);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTxns(false);
    }
  }, []);

  // Convert trend to wagmi chart format. In cumulative mode each point is the
  // running total so far — a burn-down curve you can read against the budget pace.
  const chartData = useMemo(() => {
    let running = 0;
    return trend.map((p, i) => {
      running += p.total;
      return {
        timestamp: new Date(p.date).getTime() + i,
        value: trendMode === "cumulative" ? running : p.total,
      };
    });
  }, [trend, trendMode]);

  const totalThisPeriod = trend.reduce((s, p) => s + p.total, 0);
  const avgPerDay = trend.length > 0 ? totalThisPeriod / trend.length : 0;

  // Budget pace for the visible window (monthly budget prorated to N days). Lets
  // the cumulative curve be read as "on track / over" without a floating chart line.
  const periodBudget =
    preferences.monthlyBudget > 0
      ? (preferences.monthlyBudget * trendDays) / 30
      : 0;
  const budgetPacePct =
    periodBudget > 0 ? Math.round((totalThisPeriod / periodBudget) * 100) : 0;
  const paceColor =
    budgetPacePct >= 100
      ? colors.danger
      : budgetPacePct >= 80
        ? colors.debit
        : colors.credit;
  const maxDay = trend.reduce(
    (m, p) => (p.total > m.total ? p : m),
    trend[0] || { date: "", total: 0 },
  );

  const fmt = useCallback(
    (n: number) => {
      if (preferences.hideAmounts) return "••••";
      return `${currency}${Math.round(n).toLocaleString("en-IN")}`;
    },
    [currency, preferences.hideAmounts],
  );

  const fmtShort = useCallback(
    (n: number) => {
      if (preferences.hideAmounts) return "••";
      if (n >= 100000) return `${currency}${(n / 100000).toFixed(1)}L`;
      if (n >= 1000) return `${currency}${(n / 1000).toFixed(1)}k`;
      return `${currency}${Math.round(n)}`;
    },
    [currency, preferences.hideAmounts],
  );

  // This month vs last month (from the 6-month monthly totals)
  const thisMonth = monthlyTotals[0] ?? { income: 0, expense: 0 };
  const lastMonth = monthlyTotals[1] ?? { income: 0, expense: 0 };
  const monthExpense = Number(thisMonth.expense);
  const monthIncome = Number(thisMonth.income);
  const prevExpense = Number(lastMonth.expense);

  // Donut segments: top 5 parent groups + "Other"
  const donutSegments = useMemo<DonutSegment[]>(() => {
    if (breakdown.length === 0) return [];
    const groups = new Map<string, number>();
    breakdown.forEach((item) => {
      const catDef = categories.find((c) => c.name === item.category);
      const parent = catDef?.parentId
        ? categories.find((c) => c.id === catDef.parentId)
        : null;
      const parentName = parent?.name || item.category;
      groups.set(parentName, (groups.get(parentName) || 0) + item.total);
    });
    const sorted = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const segs: DonutSegment[] = top.map(([name, value]) => ({
      label: name,
      value,
      color:
        categories.find((c) => c.name === name && !c.parentId)?.color ||
        colors.secondary,
    }));
    if (rest > 0)
      segs.push({ label: "Other", value: rest, color: colors.muted });
    return segs;
  }, [breakdown, categories, colors]);

  const monthTotalSpend = donutSegments.reduce((s, seg) => s + seg.value, 0);
  const selectedSeg = donutSegments.find((s) => s.label === selectedCat);
  const rhythmMax = Math.max(...rhythm.map((p) => p.total), 1);
  const monthlyMax = Math.max(
    ...monthlyTotals.map((r) => Math.max(Number(r.income), Number(r.expense))),
    1,
  );

  const cardStyle = {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  };

  if (loading) {
    return (
      <ThemedSafeAreaView className="items-center justify-center">
        <ActivityIndicator color={colors.accent} size="large" />
      </ThemedSafeAreaView>
    );
  }

  return (
    <ThemedSafeAreaView>
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
      >
        <MotiView
          from={{ opacity: 0, translateY: -20 }}
          animate={{ opacity: 1, translateY: 0 }}
          className="mt-4 mb-5"
        >
          <SectionLabel>Analytics</SectionLabel>
          <ThemedText
            className="text-3xl"
            style={{ fontFamily: fonts.displayBold }}
          >
            Your money, visualized
          </ThemedText>
        </MotiView>

        {/* Hero — spent this month + MoM delta */}
        <View
          className="p-4 rounded-apple-md border mb-3"
          style={cardStyle}
        >
          <View className="flex-row items-center justify-between">
            <SectionLabel>Spent · this month</SectionLabel>
            <DeltaChip current={monthExpense} previous={prevExpense} />
          </View>
          <ThemedText
            style={{
              fontFamily: fonts.signalBold,
              fontSize: 34,
              marginTop: 6,
              fontVariant: ["tabular-nums"],
            }}
          >
            {fmt(monthExpense)}
          </ThemedText>
          <ThemedText
            font="signal"
            style={{ fontSize: 10, color: colors.secondary, marginTop: 2 }}
          >
            income {fmtShort(monthIncome)} · last month {fmtShort(prevExpense)}
          </ThemedText>
        </View>

        {/* Savings rate meter */}
        <View className="mb-6">
          <SavingsMeter
            income={monthIncome}
            expense={monthExpense}
            currency={currency}
            masked={preferences.hideAmounts}
          />
        </View>

        {/* Trend period + mode selectors */}
        <View className="flex-row mb-4 items-center justify-between">
          <View
            className="flex-row p-1 rounded-full"
            style={{ backgroundColor: colors.translucent }}
          >
            {TREND_PERIODS.map((d) => (
              <TouchableOpacity
                key={d}
                onPress={() => setTrendDays(d)}
                className="px-3.5 py-1.5 rounded-full"
                style={{
                  backgroundColor:
                    trendDays === d ? colors.accent : "transparent",
                  ...(trendDays === d && {
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.15,
                    shadowRadius: 2,
                    elevation: 1,
                  }),
                }}
              >
                <ThemedText
                  className="text-xs font-bold"
                  style={{ color: trendDays === d ? onFill : colors.secondary }}
                >
                  {d}D
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
          <View
            className="flex-row p-1 rounded-full"
            style={{ backgroundColor: colors.translucent }}
          >
            {(["daily", "cumulative"] as const).map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => setTrendMode(m)}
                className="px-3 py-1.5 rounded-full"
                style={{
                  backgroundColor:
                    trendMode === m ? colors.accent : "transparent",
                  ...(trendMode === m && {
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.15,
                    shadowRadius: 2,
                    elevation: 1,
                  }),
                }}
              >
                <ThemedText
                  font="signal"
                  style={{
                    fontSize: 9,
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                    fontWeight: "700",
                    color: trendMode === m ? onFill : colors.secondary,
                  }}
                >
                  {m === "daily" ? "Daily" : "Cumul."}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Interactive spend trend chart */}
        <View className="p-4 rounded-apple-md border mb-6" style={cardStyle}>
          <View className="mb-3 flex-row items-start justify-between">
            <View>
              <SectionLabel>Total spend · {trendDays}d</SectionLabel>
              <ThemedText
                style={{
                  fontFamily: fonts.signalBold,
                  fontSize: 26,
                  marginTop: 4,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {fmt(totalThisPeriod)}
              </ThemedText>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <ThemedText
                font="signal"
                style={{ fontSize: 9, color: colors.secondary }}
              >
                AVG / DAY
              </ThemedText>
              <ThemedText
                font="signal"
                style={{
                  fontSize: 14,
                  fontWeight: "700",
                  color: colors.primary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {fmtShort(avgPerDay)}
              </ThemedText>
            </View>
          </View>

          {chartData.length >= 2 ? (
            <LineChart.Provider data={chartData}>
              <LineChart height={150} width={SCREEN_WIDTH - 80}>
                <LineChart.Path color={colors.debit}>
                  <LineChart.Gradient color={colors.debit} />
                </LineChart.Path>
                <LineChart.CursorCrosshair color={colors.primary}>
                  <LineChart.Tooltip
                    textStyle={{
                      backgroundColor: colors.surfaceElevated,
                      borderRadius: 8,
                      color: colors.primary,
                      fontSize: 12,
                      fontFamily: fonts.signalBold,
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                      overflow: "hidden",
                    }}
                    format={({ value }) => {
                      "worklet";
                      return preferences.hideAmounts
                        ? "••••"
                        : `${currency}${Math.round(Number(value)).toLocaleString("en-IN")}`;
                    }}
                  />
                  <LineChart.Tooltip position="bottom">
                    <LineChart.DatetimeText
                      style={{ fontSize: 9, color: colors.secondary, fontFamily: fonts.signal }}
                      locale="en-IN"
                      options={{ day: "numeric", month: "short" }}
                    />
                  </LineChart.Tooltip>
                </LineChart.CursorCrosshair>
              </LineChart>
            </LineChart.Provider>
          ) : (
            <View className="h-[150px] items-center justify-center">
              <ThemedText type="secondary" className="text-sm">
                Not enough data for chart
              </ThemedText>
            </View>
          )}

          {trendMode === "cumulative" && periodBudget > 0 ? (
            <View style={{ marginTop: 12 }}>
              <View className="flex-row items-center justify-between mb-1.5">
                <ThemedText
                  font="signal"
                  style={{ fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase", color: colors.secondary }}
                >
                  Budget pace · {trendDays}d
                </ThemedText>
                <ThemedText
                  font="signal"
                  style={{ fontSize: 10, color: paceColor, fontVariant: ["tabular-nums"] }}
                >
                  {fmtShort(totalThisPeriod)} / ~{fmtShort(periodBudget)} · {budgetPacePct}%
                </ThemedText>
              </View>
              <View
                className="h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: colors.surfaceElevated }}
              >
                <MotiView
                  from={{ width: "0%" }}
                  animate={{ width: `${Math.min(budgetPacePct, 100)}%` }}
                  transition={{ type: "timing", duration: 700 }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: paceColor }}
                />
              </View>
            </View>
          ) : (
            maxDay.total > 0 && (
              <ThemedText
                font="signal"
                style={{ fontSize: 10, color: colors.secondary, marginTop: 10 }}
              >
                peak{" "}
                {new Date(maxDay.date).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })}{" "}
                · {fmt(maxDay.total)} · drag the chart to inspect any day
              </ThemedText>
            )
          )}
        </View>

        {/* Category breakdown with interactive donut */}
        <View className="mb-6">
          <ThemedText
            className="text-lg mb-3"
            style={{ fontFamily: fonts.displayBold }}
          >
            Where it went
          </ThemedText>
          {breakdown.length === 0 ? (
            <View className="py-10 items-center">
              <ThemedText type="secondary">
                No confirmed transactions this month.
              </ThemedText>
            </View>
          ) : (
            <>
              {/* Donut + legend */}
              <View
                className="p-4 rounded-apple-md border mb-4 flex-row items-center"
                style={{ ...cardStyle, gap: 16 }}
              >
                <InteractiveDonut
                  segments={donutSegments}
                  selectedLabel={selectedCat}
                  onSelect={setSelectedCat}
                  centerTitle={selectedSeg ? selectedSeg.label : "This month"}
                  centerValue={fmtShort(
                    selectedSeg ? selectedSeg.value : monthTotalSpend,
                  )}
                />
                <View className="flex-1" style={{ gap: 8 }}>
                  {donutSegments.map((seg) => {
                    const active = selectedCat === seg.label;
                    const dim = selectedCat != null && !active;
                    return (
                      <TouchableOpacity
                        key={seg.label}
                        onPress={() =>
                          setSelectedCat(active ? null : seg.label)
                        }
                        className="flex-row items-center"
                        style={{ gap: 8, opacity: dim ? 0.4 : 1 }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: seg.color,
                          }}
                        />
                        <ThemedText
                          className="text-xs flex-1"
                          style={active ? { fontFamily: fonts.textSemibold } : undefined}
                          numberOfLines={1}
                        >
                          {seg.label}
                        </ThemedText>
                        <ThemedText
                          font="signal"
                          style={{ fontSize: 10, color: colors.secondary }}
                        >
                          {Math.round(
                            (seg.value / (monthTotalSpend || 1)) * 100,
                          )}
                          %
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {(() => {
                // Group breakdown by parent category
                const parentGroups = new Map<
                  string,
                  { total: number; count: number; subs: any[] }
                >();

                breakdown.forEach((item) => {
                  const catDef = categories.find(
                    (c) => c.name === item.category,
                  );
                  const parent = catDef?.parentId
                    ? categories.find((c) => c.id === catDef.parentId)
                    : null;
                  const parentName = parent?.name || item.category;

                  const existing = parentGroups.get(parentName) || {
                    total: 0,
                    count: 0,
                    subs: [],
                  };
                  existing.total += item.total;
                  existing.count += item.count;
                  if (parent) {
                    existing.subs.push(item);
                  }
                  parentGroups.set(parentName, existing);
                });

                return Array.from(parentGroups.entries())
                  .sort((a, b) => b[1].total - a[1].total)
                  .filter(
                    ([name]) => selectedCat == null || selectedCat === name,
                  )
                  .map(([parentName, data], index) => {
                    const parentDef = categories.find(
                      (c) => c.name === parentName,
                    );
                    const catIcon = parentDef?.icon || "HelpCircle";
                    const catColor = parentDef?.color || colors.secondary;
                    const budgetRow = budgetUtil.find(
                      (u) =>
                        !u.orphaned &&
                        budgetSelections(u.budget).includes(parentName),
                    );
                    const budgetColor = budgetRow
                      ? budgetRow.pace === "over" || budgetRow.percentage >= 100
                        ? colors.danger
                        : budgetRow.pace === "risk"
                          ? colors.warning
                          : colors.credit
                      : colors.muted;
                    const totalPct =
                      Math.round((data.total / (monthTotalSpend || 1)) * 100) ||
                      0;

                    return (
                      <MotiView
                        key={parentName}
                        from={{ opacity: 0, translateX: -20 }}
                        animate={{ opacity: 1, translateX: 0 }}
                        transition={{ delay: index * 60 }}
                        className="mb-4 p-4 rounded-apple-md border"
                        style={cardStyle}
                      >
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => drillCategory(parentName)}
                          className="flex-row justify-between items-center mb-2"
                        >
                          <View className="flex-row items-center flex-1">
                            <View
                              className="w-8 h-8 rounded-full items-center justify-center mr-3"
                              style={{ backgroundColor: `${catColor}20` }}
                            >
                              {renderCategoryIcon(catIcon, catColor, 14)}
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <ThemedText className="font-bold" numberOfLines={1}>
                                {parentName}
                              </ThemedText>
                              {budgetRow && (
                                <ThemedText
                                  font="signal"
                                  style={{
                                    fontSize: 9,
                                    color: budgetColor,
                                    fontVariant: ["tabular-nums"],
                                  }}
                                >
                                  {budgetRow.percentage}% of{" "}
                                  {fmtShort(budgetRow.effectiveLimit)} budget
                                </ThemedText>
                              )}
                            </View>
                          </View>
                          <View className="items-end flex-row" style={{ gap: 4 }}>
                            <View className="items-end">
                              <ThemedText
                                style={{
                                  fontFamily: fonts.signalBold,
                                  fontVariant: ["tabular-nums"],
                                }}
                              >
                                {fmt(data.total)}
                              </ThemedText>
                              <ThemedText
                                type="secondary"
                                className="text-[10px]"
                              >
                                {data.count} txn{data.count !== 1 ? "s" : ""} ·{" "}
                                {totalPct}%
                              </ThemedText>
                            </View>
                            <LucideChevronRight
                              color={colors.muted}
                              size={14}
                            />
                          </View>
                        </TouchableOpacity>

                        <View
                          className="h-1.5 rounded-full overflow-hidden mb-3"
                          style={{ backgroundColor: colors.surfaceElevated }}
                        >
                          <View
                            className="h-full"
                            style={{
                              backgroundColor: catColor,
                              width: `${totalPct}%`,
                            }}
                          />
                        </View>

                        {data.subs.length > 0 && (
                          <View
                            className="border-t pt-2"
                            style={{ borderTopColor: colors.border }}
                          >
                            {data.subs
                              .sort((a, b) => b.total - a.total)
                              .map((sub) => (
                                <View
                                  key={sub.category}
                                  className="flex-row justify-between items-center py-1.5"
                                >
                                  <ThemedText
                                    type="secondary"
                                    className="text-xs"
                                  >
                                    • {sub.category}
                                  </ThemedText>
                                  <ThemedText
                                    font="signal"
                                    style={{
                                      fontSize: 11,
                                      color: colors.secondary,
                                      fontVariant: ["tabular-nums"],
                                    }}
                                  >
                                    {fmt(sub.total)}
                                  </ThemedText>
                                </View>
                              ))}
                          </View>
                        )}
                      </MotiView>
                    );
                  });
              })()}
            </>
          )}
        </View>

        {/* Weekly rhythm — premium */}
        <View className="mb-6">
          <ThemedText
            className="text-lg mb-3"
            style={{ fontFamily: fonts.displayBold }}
          >
            When you spend
          </ThemedText>
          <PremiumGate
            premium={isPremium}
            title="Unlock spending patterns"
            onUnlock={() => notify.success("Premium coming soon")}
          >
            <WeekdayBars
              data={weekday}
              currency={currency}
              masked={preferences.hideAmounts}
            />
          </PremiumGate>
        </View>

        {/* Top merchants — premium */}
        {merchants.length > 0 && (
          <View className="mb-6">
            <ThemedText
              className="text-lg mb-3"
              style={{ fontFamily: fonts.displayBold }}
            >
              Top merchants · this month
            </ThemedText>
            <PremiumGate
              premium={isPremium}
              title="Unlock merchant analytics"
              onUnlock={() => notify.success("Premium coming soon")}
            >
              <TopMerchants
                data={merchants}
                currency={currency}
                masked={preferences.hideAmounts}
                onPressMerchant={drillMerchant}
              />
            </PremiumGate>
          </View>
        )}

        {/* Spending rhythm — tappable 30-day calendar */}
        <View className="p-4 rounded-apple-md border mb-6" style={cardStyle}>
          <View className="flex-row items-center justify-between mb-3">
            <SectionLabel>Spending rhythm · last 30 days</SectionLabel>
            <ThemedText
              font="signal"
              style={{ fontSize: 8, color: colors.secondary }}
            >
              tap a day
            </ThemedText>
          </View>

          <CalendarHeatmap
            data={rhythm}
            innerWidth={SCREEN_WIDTH - 80}
            selectedDate={selectedDay}
            onDayPress={handleDayPress}
          />

          <ThemedText
            font="signal"
            style={{ fontSize: 8, color: colors.secondary, marginTop: 8, textAlign: "center" }}
          >
            brighter = heavier spend day
          </ThemedText>
        </View>

        {/* Monthly income vs expense — mirrored signal bars */}
        {monthlyTotals.length > 0 && (
          <View className="p-4 rounded-apple-md border mb-6" style={cardStyle}>
            <SectionLabel>
              In vs out · last {monthlyTotals.length} months
            </SectionLabel>
            <View className="flex-row justify-between mt-3 mb-2">
              <ThemedText
                font="signal"
                style={{ fontSize: 9, color: colors.debit }}
              >
                ◀ OUT
              </ThemedText>
              <ThemedText
                font="signal"
                style={{ fontSize: 9, color: colors.credit }}
              >
                IN ▶
              </ThemedText>
            </View>
            {monthlyTotals.map((row, i) => {
              const expW = Math.max(
                2,
                (Number(row.expense) / monthlyMax) * 100,
              );
              const incW = Math.max(2, (Number(row.income) / monthlyMax) * 100);
              const net = Number(row.income) - Number(row.expense);
              return (
                <MotiView
                  key={row.month}
                  from={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 60 }}
                  className="mb-3"
                >
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <View
                      className="flex-1 flex-row justify-end items-center"
                      style={{ gap: 6 }}
                    >
                      <ThemedText
                        font="signal"
                        style={{ fontSize: 9, color: colors.secondary }}
                      >
                        {fmtShort(Number(row.expense))}
                      </ThemedText>
                      <View
                        style={{
                          width: `${expW * 0.6}%`,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: colors.debit,
                          opacity: 0.9,
                        }}
                      />
                    </View>
                    <ThemedText
                      font="signal"
                      style={{
                        fontSize: 9,
                        color: colors.primary,
                        width: 32,
                        textAlign: "center",
                      }}
                    >
                      {new Date(row.month + "-01").toLocaleDateString("en-IN", {
                        month: "short",
                      })}
                    </ThemedText>
                    <View
                      className="flex-1 flex-row justify-start items-center"
                      style={{ gap: 6 }}
                    >
                      <View
                        style={{
                          width: `${incW * 0.6}%`,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: colors.credit,
                          opacity: 0.9,
                        }}
                      />
                      <ThemedText
                        font="signal"
                        style={{ fontSize: 9, color: colors.secondary }}
                      >
                        {fmtShort(Number(row.income))}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText
                    font="signal"
                    style={{
                      fontSize: 8,
                      color: net >= 0 ? colors.credit : colors.danger,
                      textAlign: "center",
                      marginTop: 2,
                    }}
                  >
                    net {net >= 0 ? "+" : "−"}
                    {fmtShort(Math.abs(net))}
                  </ThemedText>
                </MotiView>
              );
            })}
          </View>
        )}

        {/* Budget watch */}
        {budgetUtil.length > 0 && (
          <View className="mb-6">
            <View className="flex-row items-center justify-between mb-3">
              <ThemedText
                className="text-lg"
                style={{ fontFamily: fonts.displayBold }}
              >
                Budget watch
              </ThemedText>
              <TouchableOpacity
                onPress={() => navigation.navigate("Budget")}
                className="flex-row items-center"
                style={{ gap: 2 }}
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
            <View className="p-4 rounded-apple-md border" style={cardStyle}>
              {budgetUtil
                .filter((u) => !u.orphaned)
                .map((u, i) => {
                  const { budget, spent, percentage } = u;
                  const barColor =
                    u.pace === "over" || percentage >= 100
                      ? colors.danger
                      : u.pace === "risk"
                        ? colors.warning
                        : colors.credit;
                  return (
                    <View key={budget.id} className={i > 0 ? "mt-4" : ""}>
                      <View className="flex-row justify-between items-center mb-1.5">
                        <ThemedText className="text-sm font-bold">
                          {u.displayName}
                        </ThemedText>
                        <ThemedText
                          font="signal"
                          style={{
                            fontSize: 10,
                            color: barColor,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {fmtShort(spent)} / {fmtShort(u.effectiveLimit)} ·{" "}
                          {u.pace === "risk"
                            ? `${percentage}% · pacing over`
                            : `${percentage}%`}
                        </ThemedText>
                      </View>
                      <View
                        className="h-1.5 rounded-full overflow-hidden"
                        style={{ backgroundColor: colors.surfaceElevated }}
                      >
                        <MotiView
                          from={{ width: "0%" }}
                          animate={{ width: `${Math.min(percentage, 100)}%` }}
                          transition={{ type: "timing", duration: 700 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: barColor }}
                        />
                        {/* Elapsed-window tick — usage should be near this line */}
                        <View
                          style={{
                            position: "absolute",
                            left: `${Math.min(u.elapsedPct, 99)}%`,
                            top: 0,
                            bottom: 0,
                            width: 2,
                            backgroundColor: colors.secondary,
                          }}
                        />
                      </View>
                    </View>
                  );
                })}
            </View>
          </View>
        )}

        {/* Tags breakdown */}
        {tagsBreakdown.length > 0 && (
          <View className="mb-6">
            <ThemedText
              className="text-lg mb-3"
              style={{ fontFamily: fonts.displayBold }}
            >
              Top tags this month
            </ThemedText>
            <View className="flex-row flex-wrap justify-between">
              {tagsBreakdown.map((tag, index) => (
                <MotiView
                  key={tag.tag}
                  from={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 40 }}
                  className="px-4 py-3 mb-3 rounded-xl border flex-row items-center justify-between"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: `${colors.ai}40`,
                    width: "48%",
                  }}
                >
                  <View>
                    <ThemedText
                      className="font-bold text-sm"
                      style={{ color: colors.ai }}
                      numberOfLines={1}
                    >
                      #{tag.tag}
                    </ThemedText>
                    <ThemedText type="secondary" className="text-[10px] mt-0.5">
                      {tag.count} txn{tag.count !== 1 ? "s" : ""}
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={{
                      fontFamily: fonts.signalBold,
                      fontSize: 13,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {fmtShort(tag.total)}
                  </ThemedText>
                </MotiView>
              ))}
            </View>
          </View>
        )}

        {/* High spends */}
        {highSpends.length > 0 && (
          <View className="mb-6">
            <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
              <LucideFlame color={colors.debit} size={18} />
              <ThemedText
                className="text-lg"
                style={{ fontFamily: fonts.displayBold }}
              >
                Biggest pulses
              </ThemedText>
            </View>
            <View
              className="rounded-apple-md border overflow-hidden"
              style={cardStyle}
            >
              {highSpends.map((tx, i) => (
                <View
                  key={tx.id}
                  className="flex-row items-center justify-between px-4 py-3"
                  style={{
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <View className="flex-1 mr-3">
                    <ThemedText className="text-sm font-bold" numberOfLines={1}>
                      {tx.merchant}
                    </ThemedText>
                    <ThemedText
                      font="signal"
                      style={{
                        fontSize: 9,
                        color: colors.secondary,
                        marginTop: 2,
                      }}
                    >
                      {new Date(tx.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · {tx.category}
                    </ThemedText>
                  </View>
                  <AmountText
                    value={tx.amount}
                    kind={
                      tx.type === "credit"
                        ? "credit"
                        : tx.type === "transfer"
                          ? "transfer"
                          : "debit"
                    }
                    showSign={tx.type !== "transfer"}
                    currency={currency}
                    masked={preferences.hideAmounts}
                    size={13}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* AI Insights */}
        <View className="mb-8">
          <View className="flex-row justify-between items-center mb-3">
            <ThemedText
              className="text-lg"
              style={{ fontFamily: fonts.displayBold }}
            >
              Insights
            </ThemedText>
            <TouchableOpacity
              onPress={handleGenerateInsights}
              disabled={generatingInsights}
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{ backgroundColor: colors.creditSoft }}
            >
              {generatingInsights ? (
                <ActivityIndicator color={colors.ai} size="small" />
              ) : (
                <>
                  <LucideRefreshCw color={colors.ai} size={12} />
                  <ThemedText
                    className="text-xs font-bold ml-1"
                    style={{ color: colors.ai }}
                  >
                    Refresh
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>

          {insights.length === 0 ? (
            <TouchableOpacity
              onPress={handleGenerateInsights}
              className="border border-dashed p-6 rounded-apple-md items-center"
              style={{ borderColor: colors.secondary }}
            >
              <LucideLightbulb color={colors.muted} size={32} />
              <ThemedText type="secondary" className="text-sm mt-3 text-center">
                Tap to generate insights from your spending data.
              </ThemedText>
            </TouchableOpacity>
          ) : (
            insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || LucideLightbulb;
              const color = INSIGHT_COLORS[insight.type] || colors.accent;
              return (
                <MotiView
                  key={insight.id}
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ delay: i * 60 }}
                  className="p-4 rounded-apple-md border mb-3 flex-row items-start"
                  style={{
                    backgroundColor: `${color}15`,
                    borderColor: colors.border,
                  }}
                >
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3 mt-0.5"
                    style={{ backgroundColor: `${color}25` }}
                  >
                    <Icon color={color} size={18} />
                  </View>
                  <View className="flex-1">
                    <ThemedText
                      className="font-bold text-sm"
                      style={{ color: isDark ? colors.primary : color }}
                    >
                      {insight.title}
                    </ThemedText>
                    <ThemedText
                      type="secondary"
                      className="text-xs mt-1 leading-4"
                    >
                      {insight.body}
                    </ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDismissInsight(insight.id)}
                    className="ml-2 p-1"
                  >
                    <LucideX color={colors.secondary} size={14} />
                  </TouchableOpacity>
                </MotiView>
              );
            })
          )}
        </View>
      </ScrollView>
      {/* Day detail popover */}
      {selectedDay && popoverAnchor && (
        <Modal
          visible={true}
          transparent
          animationType="fade"
          onRequestClose={() => handleDayPress("")}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
            onPress={() => handleDayPress("")}
          >
            <MotiView
              from={{ opacity: 0, scale: 0.95, translateY: popoverAnchor.y > SCREEN_HEIGHT * 0.55 ? 10 : -10 }}
              animate={{ opacity: 1, scale: 1, translateY: 0 }}
              transition={{ type: "timing", duration: 150 }}
              style={{
                position: "absolute",
                left: Math.max(16, Math.min(SCREEN_WIDTH - 296, popoverAnchor.x - 140)),
                ...(popoverAnchor.y > SCREEN_HEIGHT * 0.55
                  ? { bottom: SCREEN_HEIGHT - popoverAnchor.y + 12 }
                  : { top: popoverAnchor.y + 12 }),
                width: 280,
                maxHeight: 280,
                backgroundColor: colors.surfaceElevated,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 14,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.22,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              {/* Caret/Arrow */}
              <View
                style={{
                  position: "absolute",
                  width: 10,
                  height: 10,
                  backgroundColor: colors.surfaceElevated,
                  transform: [{ rotate: "45deg" }],
                  borderWidth: 1,
                  borderColor: colors.border,
                  left: Math.max(12, Math.min(280 - 12 - 10, popoverAnchor.x - Math.max(16, Math.min(SCREEN_WIDTH - 296, popoverAnchor.x - 140)) - 5)),
                  ...(popoverAnchor.y > SCREEN_HEIGHT * 0.55
                    ? { bottom: -6, borderTopWidth: 0, borderLeftWidth: 0 }
                    : { top: -6, borderBottomWidth: 0, borderRightWidth: 0 }),
                }}
              />

              {/* Popover content */}
              <View style={{ flex: 1 }}>
                <View className="flex-row items-center justify-between mb-2">
                  <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 13 }}>
                    {new Date(selectedDay).toLocaleDateString("en-IN", {
                      weekday: "long",
                      day: "numeric",
                      month: "short",
                    })}
                  </ThemedText>
                  <ThemedText
                    font="signal"
                    style={{ fontSize: 13, fontWeight: "700", color: colors.debit }}
                  >
                    {fmt(rhythm.find((r) => r.date === selectedDay)?.total ?? 0)}
                  </ThemedText>
                </View>

                {loadingTxns ? (
                  <View style={{ height: 100, justifyContent: "center", alignItems: "center" }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingBottom: 4 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {dayTxns.length === 0 ? (
                      <ThemedText
                        font="signal"
                        style={{ fontSize: 10, color: colors.secondary, marginTop: 4 }}
                      >
                        No spending recorded on this day.
                      </ThemedText>
                    ) : (
                      dayTxns.slice(0, 8).map((tx) => (
                        <View
                          key={tx.id}
                          className="flex-row items-center justify-between py-1.5"
                        >
                          <ThemedText
                            className="text-xs flex-1 mr-3"
                            numberOfLines={1}
                          >
                            {tx.merchant}
                            <ThemedText type="secondary" style={{ fontSize: 10 }}>
                              {"  "}· {tx.category}
                            </ThemedText>
                          </ThemedText>
                          <ThemedText
                            font="signal"
                            style={{
                              fontSize: 11,
                              color: colors.secondary,
                              fontVariant: ["tabular-nums"],
                            }}
                          >
                            {fmt(tx.amount)}
                          </ThemedText>
                        </View>
                      ))
                    )}
                    {dayTxns.length > 8 && (
                      <ThemedText
                        type="secondary"
                        font="signal"
                        style={{ fontSize: 10, marginTop: 4 }}
                      >
                        +{dayTxns.length - 8} more
                      </ThemedText>
                    )}
                  </ScrollView>
                )}
              </View>
            </MotiView>
          </Pressable>
        </Modal>
      )}
    </ThemedSafeAreaView>
  );
};

export default AnalyticsScreen;
