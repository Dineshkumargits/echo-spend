import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import {
  LucidePlus,
  LucideTarget,
  LucideTrash2,
  LucideSettings2,
  LucideRepeat,
  LucideList,
  LucideSearch,
  LucideX,
  LucideTag,
} from "lucide-react-native";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { notify } from "../utils/notify";
import {
  getBudgetUtilization,
  getBudgetSummary,
  getSuggestedBudgetAmount,
  upsertBudget,
  deleteBudget,
  getCategories,
  budgetSelections,
  BudgetUtilization,
  BudgetSummary,
  BudgetPace,
  Category,
} from "../services/database";
import { useNotifications } from "../hooks/useNotifications";
import { useTheme } from "../theme/ThemeProvider";
import { useStore } from "../store/useStore";
import {
  ScreenHeader,
  HeaderIconButton,
  IconTile,
  PillButton,
  StatBlock,
  EmptyState,
  BottomSheet,
  PrimaryButton,
  FieldLabel,
  TextField,
} from "../components/Kit";
import { SectionLabel } from "../components/Signal";
import { fonts } from "../theme/tokens";

// ─── Pace gauge — usage fill + "where you should be" tick ────────────────────

const PaceGauge: React.FC<{
  pct: number;
  elapsedPct: number;
  color: string;
}> = ({ pct, elapsedPct, color }) => {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: 7,
        borderRadius: 4,
        backgroundColor: colors.translucent,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${Math.min(pct, 100)}%`,
          height: "100%",
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      {/* Elapsed-time marker: the pace you're being measured against */}
      <View
        style={{
          position: "absolute",
          left: `${Math.min(elapsedPct, 99)}%`,
          top: 0,
          width: 2,
          height: 7,
          backgroundColor: colors.secondary,
        }}
      />
    </View>
  );
};

// ─── BudgetScreen ────────────────────────────────────────────────────────────

const BudgetScreen = () => {
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const { colors } = useTheme();
  const { preferences, setMonthlyBudget, setSalaryDay } = useStore();
  const currency = preferences?.currency ?? "₹";
  const salaryDay = preferences?.salaryDay ?? 1;
  const { checkBudgetAlerts } = useNotifications();

  const [rows, setRows] = useState<BudgetUtilization[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Budget editor sheet: null = closed, 'new' = create, otherwise the row edited
  const [editing, setEditing] = useState<BudgetUtilization | "new" | null>(null);
  const [formSelections, setFormSelections] = useState<string[]>([]);
  const [formAmount, setFormAmount] = useState("");
  const [formPeriod, setFormPeriod] = useState<"monthly" | "weekly">("monthly");
  const [formRollover, setFormRollover] = useState(false);
  const [suggested, setSuggested] = useState<number | null>(null);

  // Category picker sheet (stacked over the editor so the editor stays clean)
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  useEffect(() => {
    if (!showCatPicker) setCatSearch("");
  }, [showCatPicker]);

  // Plan sheet (overall monthly budget + salary day)
  const [showPlan, setShowPlan] = useState(false);
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState("");
  const [salaryDayInput, setSalaryDayInput] = useState("");

  const fmt = (n: number) =>
    preferences.hideAmounts
      ? "••••"
      : `${currency}${Math.round(n).toLocaleString("en-IN")}`;

  const load = useCallback(async () => {
    const [util, sum, cats] = await Promise.all([
      getBudgetUtilization(salaryDay),
      getBudgetSummary(salaryDay),
      getCategories(),
    ]);
    setRows(util);
    setSummary(sum);
    setCategories(cats.filter((c) => c.type === "expense"));
    setLoading(false);
  }, [salaryDay]);

  useEffect(() => {
    if (isFocused) load();
  }, [isFocused, load]);

  // Parent → children tree for the category selector (same grammar as the
  // Transactions filter sheet).
  const categoryTree = useMemo(() => {
    const kids = new Map<number, Category[]>();
    categories.forEach((c) => {
      if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
    });
    return categories
      .filter((c) => !c.parentId)
      .map((p) => ({ parent: p, children: kids.get(p.id) ?? [] }));
  }, [categories]);

  // Picker search — same narrowing behavior as the transactions filter sheet:
  // a matching parent keeps its whole row, otherwise only matching subs show
  // (with the full membership still driving the toggle logic).
  const pickerQuery = catSearch.trim().toLowerCase();
  const visibleTree = useMemo(() => {
    const base = categoryTree.map((g) => ({ ...g, shown: g.children }));
    if (!pickerQuery) return base;
    return base
      .map((g) => {
        if (g.parent.name.toLowerCase().includes(pickerQuery)) return g;
        const shown = g.children.filter((c) =>
          c.name.toLowerCase().includes(pickerQuery),
        );
        return shown.length > 0 ? { ...g, shown } : null;
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [categoryTree, pickerQuery]);

  // ── Selection toggles — a selected parent name implies all its subs ───────
  const toggleParent = (parent: Category, children: Category[]) => {
    setFormSelections((sel) => {
      if (sel.includes(parent.name)) {
        return sel.filter((n) => n !== parent.name);
      }
      // Parent absorbs any individually-selected children
      const childNames = new Set(children.map((c) => c.name));
      return [...sel.filter((n) => !childNames.has(n)), parent.name];
    });
  };

  const toggleChild = (
    child: Category,
    parent: Category,
    siblings: Category[],
  ) => {
    setFormSelections((sel) => {
      if (sel.includes(parent.name)) {
        // Parent covered everything: tapping a sub excludes just that one —
        // the parent degrades to its other children.
        return [
          ...sel.filter((n) => n !== parent.name),
          ...siblings
            .filter((c) => c.name !== child.name)
            .map((c) => c.name),
        ];
      }
      return sel.includes(child.name)
        ? sel.filter((n) => n !== child.name)
        : [...sel, child.name];
    });
  };

  // ── Suggestion: 3-window average for the current selection set ────────────
  const selectionsKey = formSelections.join("|");
  useEffect(() => {
    if (!editing || formSelections.length === 0) {
      setSuggested(null);
      return;
    }
    let alive = true;
    getSuggestedBudgetAmount(formSelections, formPeriod, salaryDay).then((v) => {
      if (alive) setSuggested(v);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectionsKey, formPeriod, salaryDay]);

  // ── Sheet openers ─────────────────────────────────────────────────────────
  const openCreate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormSelections([]);
    setFormAmount("");
    setFormPeriod("monthly");
    setFormRollover(false);
    setEditing("new");
  };

  const openEdit = (row: BudgetUtilization) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFormSelections(budgetSelections(row.budget));
    setFormAmount(String(row.budget.amount));
    setFormPeriod(row.budget.period);
    setFormRollover(!!row.budget.rollover);
    setEditing(row);
  };

  const editingRow = editing !== null && editing !== "new" ? editing : null;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (formSelections.length === 0) {
      notify.error("Pick at least one category");
      return;
    }
    const amount = parseFloat(formAmount);
    if (!formAmount || isNaN(amount) || amount <= 0) {
      notify.error("Enter a valid budget amount");
      return;
    }
    await upsertBudget({
      id: editingRow?.budget.id,
      categoryName: formSelections[0],
      categoryNames: formSelections,
      amount,
      period: formPeriod,
      startDate: new Date().toISOString().slice(0, 10),
      rollover: formRollover,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notify.success("Budget saved");
    setEditing(null);
    await load();
    await checkBudgetAlerts();
  };

  const handleDelete = (id: number, name: string) => {
    Alert.alert("Remove budget", `Remove the budget for ${name}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await deleteBudget(id);
          setEditing(null);
          await load();
        },
      },
    ]);
  };

  const openTransactions = (u: BudgetUtilization) => {
    setEditing(null);
    // Each selection maps to a category group (name + its subcategories) —
    // exactly the budget's own matching. Budget lives on the root stack, so
    // target the Txns tab through the Main navigator.
    navigation.navigate("Main", {
      screen: "Txns",
      params: { presetCategoryGroups: budgetSelections(u.budget) },
    });
  };

  const savePlan = () => {
    const budgetVal = parseFloat(monthlyBudgetInput);
    const dayVal = parseInt(salaryDayInput, 10);
    if (!isNaN(budgetVal) && budgetVal >= 0) setMonthlyBudget(budgetVal);
    if (!isNaN(dayVal) && dayVal >= 1 && dayVal <= 31) setSalaryDay(dayVal);
    setShowPlan(false);
    notify.success("Plan updated");
    load();
  };

  // ── Row visuals ───────────────────────────────────────────────────────────
  const paceColor = (pace: BudgetPace, pct: number): string => {
    if (pct >= 100 || pace === "over") return colors.danger;
    if (pace === "risk") return colors.warning;
    if (pace === "under") return colors.credit;
    return colors.accent;
  };

  const paceLabel = (u: BudgetUtilization): { text: string; color: string } => {
    if (u.orphaned)
      return { text: "category removed — tap to clean up", color: colors.danger };
    if (u.spent >= u.effectiveLimit && u.spent > 0)
      return {
        text:
          u.spent - u.effectiveLimit < 1
            ? `limit reached · ${u.daysLeft}d left`
            : `over by ${fmt(u.spent - u.effectiveLimit)}`,
        color: colors.danger,
      };
    if (u.pace === "risk")
      return {
        text: `on pace for ${fmt(u.projectedSpend)} · ${u.daysLeft}d left`,
        color: colors.warning,
      };
    if (u.pace === "under")
      return { text: `ahead of pace · ${fmt(u.remaining)} left`, color: colors.credit };
    return { text: `${fmt(u.remaining)} left · ${u.daysLeft}d`, color: colors.secondary };
  };

  const catFor = (name: string) => categories.find((c) => c.name === name);

  const overCommitted =
    summary && preferences.monthlyBudget > 0
      ? summary.totalBudgeted - preferences.monthlyBudget
      : 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <ThemedSafeAreaView edges={["top", "bottom"]}>
      <ScreenHeader
        eyebrow="Finance"
        title="Budgets"
        onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
        right={
          <HeaderIconButton
            onPress={() => {
              setMonthlyBudgetInput(String(preferences?.monthlyBudget ?? 0));
              setSalaryDayInput(String(salaryDay));
              setShowPlan(true);
            }}
          >
            <LucideSettings2 color={colors.secondary} size={17} />
          </HeaderIconButton>
        }
      />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      ) : (
        <GHScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120 }}
        >
          {/* ── Cycle overview ── */}
          {summary && (
            <View
              style={{
                flexDirection: "row",
                gap: 20,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                marginBottom: 4,
              }}
            >
              <StatBlock
                label="Budgeted"
                value={fmt(summary.totalBudgeted)}
                style={{ flex: 1 }}
              />
              <StatBlock
                label="Spent in budgets"
                value={fmt(summary.budgetedSpent)}
                color={colors.debit}
                style={{ flex: 1 }}
              />
              <StatBlock
                label="Unbudgeted"
                value={fmt(summary.unbudgetedSpend)}
                color={
                  summary.unbudgetedSpend > 0 ? colors.warning : undefined
                }
                style={{ flex: 1 }}
              />
            </View>
          )}

          {overCommitted > 0 && (
            <ThemedText
              font="signal"
              style={{ fontSize: 11, color: colors.warning, marginTop: 8 }}
            >
              Category budgets exceed your {fmt(preferences.monthlyBudget)}{" "}
              monthly budget by {fmt(overCommitted)}.
            </ThemedText>
          )}

          {/* ── Gauges ── */}
          {rows.length === 0 ? (
            <EmptyState
              icon={<LucideTarget color={colors.muted} size={44} />}
              title="No budgets yet"
              subtitle="Set a limit for one category or a bundle — a parent category covers all its subcategories."
              action={
                <PrimaryButton label="Set first budget" onPress={openCreate} />
              }
            />
          ) : (
            <>
              <SectionLabel style={{ marginTop: 18, marginBottom: 4 }}>
                This cycle
              </SectionLabel>
              {rows.map((u) => {
                const cat = catFor(u.budget.categoryName);
                const color = paceColor(u.pace, u.percentage);
                const label = paceLabel(u);
                const prevDelta = u.budget.amount - u.prevSpent;
                return (
                  <TouchableOpacity
                    key={u.budget.id}
                    activeOpacity={0.7}
                    onPress={() => openEdit(u)}
                    style={{
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                      opacity: u.orphaned ? 0.55 : 1,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      <IconTile
                        emoji={cat?.icon ?? "📁"}
                        color={cat?.color || colors.secondary}
                        size={34}
                      />
                      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                        <ThemedText
                          numberOfLines={1}
                          style={{ fontFamily: fonts.textSemibold, fontSize: 14 }}
                        >
                          {u.displayName}
                        </ThemedText>
                        <ThemedText
                          font="signal"
                          style={{
                            fontSize: 9,
                            letterSpacing: 0.8,
                            color: colors.muted,
                            textTransform: "uppercase",
                            marginTop: 1,
                          }}
                        >
                          {u.budget.period === "weekly" ? "This week" : "This cycle"}
                          {u.coveredCount > 1
                            ? ` · ${u.coveredCount} categories`
                            : ""}
                          {u.rolloverCarry !== 0
                            ? ` · ${u.rolloverCarry > 0 ? "+" : "−"}${fmt(Math.abs(u.rolloverCarry))} carried`
                            : ""}
                        </ThemedText>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <ThemedText
                          font="signal"
                          style={{
                            fontFamily: fonts.signalBold,
                            fontSize: 14,
                            color,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {u.percentage}%
                        </ThemedText>
                        <ThemedText
                          font="signal"
                          style={{ fontSize: 10, color: colors.secondary }}
                        >
                          {fmt(u.spent)} / {fmt(u.effectiveLimit)}
                        </ThemedText>
                      </View>
                    </View>

                    <PaceGauge
                      pct={u.percentage}
                      elapsedPct={u.elapsedPct}
                      color={color}
                    />

                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 7,
                      }}
                    >
                      <ThemedText
                        font="signal"
                        style={{ fontSize: 10.5, color: label.color }}
                      >
                        {label.text}
                      </ThemedText>
                      {u.prevSpent > 0 && !u.orphaned && (
                        <ThemedText
                          font="signal"
                          style={{
                            fontSize: 10,
                            color: prevDelta >= 0 ? colors.credit : colors.danger,
                          }}
                        >
                          last {u.budget.period === "weekly" ? "week" : "cycle"}{" "}
                          {prevDelta >= 0
                            ? `${fmt(prevDelta)} under`
                            : `${fmt(-prevDelta)} over`}
                        </ThemedText>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </GHScrollView>
      )}

      {/* ── Add budget FAB (matches Dashboard / Finances) ── */}
      {!loading && rows.length > 0 && (
        <TouchableOpacity
          onPress={openCreate}
          style={{
            position: "absolute",
            bottom: 32,
            right: 24,
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: colors.accent,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.35,
            shadowRadius: 10,
            elevation: 6,
          }}
        >
          <LucidePlus color={colors.onAccent} size={32} />
        </TouchableOpacity>
      )}

      {/* ── Budget editor sheet ── */}
      <BottomSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New budget" : "Edit budget"}
        right={
          editingRow ? (
            <TouchableOpacity
              onPress={() =>
                handleDelete(editingRow.budget.id, editingRow.displayName)
              }
              hitSlop={8}
            >
              <LucideTrash2 color={colors.danger} size={17} />
            </TouchableOpacity>
          ) : undefined
        }
      >
        <GHScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}
        >
          {/* Priority row: Amount (left) + Category square card (right) —
              mirrors AddTransactionScreen's amount+category layout so the
              budget sheet reads like the rest of the money-entry flows. */}
          <View
            style={{
              flexDirection: "row",
              gap: 16,
              marginTop: 14,
              alignItems: "flex-start",
            }}
          >
            <View style={{ flex: 1 }}>
              <FieldLabel>Limit amount ({currency})</FieldLabel>
              <TextInput
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                value={formAmount}
                onChangeText={setFormAmount}
                style={{
                  fontFamily: fonts.signalBold,
                  fontSize: 40,
                  fontVariant: ["tabular-nums"],
                  color: colors.primary,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              />
              {suggested !== null && (
                <TouchableOpacity
                  onPress={() => setFormAmount(String(suggested))}
                  style={{ marginTop: 8 }}
                >
                  <ThemedText
                    font="signal"
                    style={{ fontSize: 10.5, color: colors.accent }}
                  >
                    Avg of last 3 {formPeriod === "weekly" ? "weeks" : "cycles"}:{" "}
                    {fmt(suggested)} — tap to use
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>

            {/* Category square card — opens the multi-select sheet instead of
                CategoryPicker's own single-select modal */}
            <View>
              <FieldLabel>Categories</FieldLabel>
              <TouchableOpacity
                onPress={() => setShowCatPicker(true)}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 16,
                  borderWidth: 1.5,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 8,
                }}
              >
                {formSelections.length > 0 ? (
                  <View style={{ alignItems: "center" }}>
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 2,
                        backgroundColor: `${catFor(formSelections[0])?.color ?? colors.secondary}15`,
                      }}
                    >
                      <ThemedText style={{ fontSize: 22 }}>
                        {catFor(formSelections[0])?.icon ?? "📁"}
                      </ThemedText>
                    </View>
                    <ThemedText
                      numberOfLines={1}
                      style={{
                        fontSize: 11,
                        fontFamily: fonts.textSemibold,
                        color: colors.primary,
                      }}
                    >
                      {formSelections.length > 1
                        ? `+${formSelections.length - 1} more`
                        : formSelections[0]}
                    </ThemedText>
                  </View>
                ) : (
                  <View style={{ alignItems: "center" }}>
                    <LucideTag color={colors.secondary} size={22} />
                    <ThemedText
                      style={{ fontSize: 10, color: colors.secondary, marginTop: 4 }}
                    >
                      Select
                    </ThemedText>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {formSelections.length > 0 && (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 12,
              }}
            >
              {formSelections.map((name) => {
                const cat = catFor(name);
                return (
                  <PillButton
                    key={name}
                    label={cat?.icon ? `${cat.icon} ${name}` : name}
                    color={cat?.color}
                    active
                    icon={
                      <LucideX color={cat?.color ?? colors.accent} size={11} />
                    }
                    onPress={() =>
                      setFormSelections((sel) => sel.filter((n) => n !== name))
                    }
                  />
                );
              })}
            </View>
          )}
          <ThemedText style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
            One limit across everything selected — a parent covers all its
            subcategories.
          </ThemedText>

          <FieldLabel style={{ marginTop: 18 }}>Period</FieldLabel>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <PillButton
              label="Monthly cycle"
              active={formPeriod === "monthly"}
              onPress={() => setFormPeriod("monthly")}
            />
            <PillButton
              label="Weekly"
              active={formPeriod === "weekly"}
              onPress={() => setFormPeriod("weekly")}
            />
          </View>

          <FieldLabel style={{ marginTop: 18 }}>Rollover</FieldLabel>
          <PillButton
            label={formRollover ? "Rollover on" : "Rollover off"}
            icon={
              <LucideRepeat
                color={formRollover ? colors.ai : colors.secondary}
                size={12}
              />
            }
            color={colors.ai}
            active={formRollover}
            onPress={() => setFormRollover((v) => !v)}
            style={{ alignSelf: "flex-start" }}
          />
          <ThemedText
            style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}
          >
            Carries last {formPeriod === "weekly" ? "week's" : "cycle's"} leftover
            (or overspend) into this limit.
          </ThemedText>

          {editingRow && !editingRow.orphaned && (
            <PillButton
              label="View transactions"
              icon={<LucideList color={colors.secondary} size={13} />}
              onPress={() => openTransactions(editingRow)}
              style={{ alignSelf: "flex-start", marginTop: 18 }}
            />
          )}

          <PrimaryButton
            label="Save budget"
            onPress={handleSave}
            style={{ marginTop: 22 }}
          />
        </GHScrollView>
      </BottomSheet>

      {/* ── Category picker sheet (stacked over the editor) ── */}
      <BottomSheet
        visible={showCatPicker}
        onClose={() => setShowCatPicker(false)}
        title="Choose categories"
        maxHeightPct={0.88}
      >
        <View style={{ paddingHorizontal: 24, marginBottom: 4 }}>
          <TextField
            placeholder="Find a category…"
            value={catSearch}
            onChangeText={setCatSearch}
            autoCorrect={false}
            leading={<LucideSearch color={colors.muted} size={15} />}
            trailing={
              catSearch.length > 0 ? (
                <TouchableOpacity onPress={() => setCatSearch("")} hitSlop={8}>
                  <LucideX color={colors.muted} size={14} />
                </TouchableOpacity>
              ) : undefined
            }
          />
        </View>
        <GHScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}
        >
          <ThemedText
            style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}
          >
            A parent covers all its subcategories — tap a sub to drop just that
            one.
          </ThemedText>
          {visibleTree.map(({ parent, children, shown }) => {
            const parentOn = formSelections.includes(parent.name);
            const pickedKids = children.filter((c) =>
              formSelections.includes(c.name),
            ).length;
            return (
              <ScrollView
                key={parent.id}
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                style={{ marginTop: 8 }}
              >
                <PillButton
                  label={
                    children.length > 0
                      ? `${parent.icon} ${parent.name} · all`
                      : `${parent.icon} ${parent.name}`
                  }
                  color={parent.color}
                  active={parentOn}
                  count={parentOn ? 0 : pickedKids}
                  onPress={() => toggleParent(parent, children)}
                />
                {shown.map((c) => (
                  <PillButton
                    key={c.id}
                    label={c.name}
                    color={c.color}
                    active={parentOn || formSelections.includes(c.name)}
                    onPress={() => toggleChild(c, parent, children)}
                  />
                ))}
              </ScrollView>
            );
          })}
          {pickerQuery.length > 0 && visibleTree.length === 0 && (
            <ThemedText
              style={{ fontSize: 12, color: colors.muted, marginTop: 20 }}
            >
              Nothing matches “{catSearch.trim()}”.
            </ThemedText>
          )}

          <PrimaryButton
            label={
              formSelections.length > 0
                ? `Done · ${formSelections.length} selected`
                : "Done"
            }
            onPress={() => setShowCatPicker(false)}
            style={{ marginTop: 22 }}
          />
        </GHScrollView>
      </BottomSheet>

      {/* ── Plan sheet ── */}
      <BottomSheet
        visible={showPlan}
        onClose={() => setShowPlan(false)}
        title="Cycle plan"
      >
        <View style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
          <FieldLabel>Monthly budget ({currency})</FieldLabel>
          <TextField
            keyboardType="numeric"
            value={monthlyBudgetInput}
            onChangeText={setMonthlyBudgetInput}
            placeholder="e.g. 50000"
            style={{ fontFamily: fonts.signal, fontSize: 14 }}
          />

          <FieldLabel style={{ marginTop: 18 }}>Salary day (1–31)</FieldLabel>
          <TextField
            keyboardType="numeric"
            value={salaryDayInput}
            onChangeText={setSalaryDayInput}
            placeholder="1"
            style={{ fontFamily: fonts.signal, fontSize: 14 }}
          />
          <ThemedText style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
            Your spending cycle and all monthly budgets reset on this day.
          </ThemedText>

          <PrimaryButton label="Save plan" onPress={savePlan} style={{ marginTop: 22 }} />
        </View>
      </BottomSheet>
    </ThemedSafeAreaView>
  );
};

export default BudgetScreen;
