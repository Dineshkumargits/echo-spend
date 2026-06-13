import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  Alert,
  Modal,
  ActivityIndicator,
} from "react-native";
import { MotiView } from "moti";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  LucideX,
  LucideCheck,
  LucideRepeat,
  LucideTarget,
  LucideLandmark,
  LucideChevronDown,
  LucideChevronUp,
  LucideUsers,
  LucidePlus,
  LucideCalendar,
  LucideSearch,
  LucideTag,
  LucideChevronRight,
  LucideSplit,
  LucideToggleLeft,
  LucideToggleRight,
  LucideWallet,
  LucideTrash2,
} from "lucide-react-native";
import { renderCategoryIcon } from "../components/CategoryManager";
import * as Haptics from "expo-haptics";
import { notify } from "../utils/notify";
import { useNavigation } from "@react-navigation/native";
import {
  addTransaction,
  addLoan,
  createSplit,
  getCategories,
  Category,
  getAccounts,
  Account,
  getGoals,
  Goal,
  getLoans,
  Loan,
  getSubscriptions,
  Subscription,
  getPendingSplitMembers,
  PendingSplitMember,
} from "../services/database";
import { useTheme } from "../theme/ThemeProvider";
import { useStore } from "../store/useStore";
import {
  useCategoryManager,
  CategoryManagerModal,
} from "../components/CategoryManager";
import { useNotifications } from "../hooks/useNotifications";
import { TagInput } from "../components/TagInput";
import { CategoryPicker } from "../components/CategoryPicker";

// ─── Shared entity linker used by both Add & Edit ────────────────────────────

interface EntityLinkerProps {
  goals: Goal[];
  loans: Loan[];
  subscriptions: Subscription[];
  splitMembers: PendingSplitMember[];
  selectedGoal: number | null;
  selectedLoan: number | null;
  selectedSub: number | null;
  selectedSplitMember: number | null;
  onGoal: (id: number | null) => void;
  onLoan: (id: number | null) => void;
  onSub: (id: number | null) => void;
  onSplitMember: (id: number | null) => void;
  colors: any;
  currency: string;
  txType: "debit" | "credit" | "transfer";
  prefillName?: string;
  prefillAmount?: string;
  prefillCategory?: string;
  prefillAccountId?: number | null;
  /** Called just before navigating away to create a new entity from the picker */
  onNavigatingToCreate?: (type: 'sub' | 'goal') => void;
}

export const EntityLinker = ({
  goals,
  loans,
  subscriptions,
  splitMembers,
  selectedGoal,
  selectedLoan,
  selectedSub,
  selectedSplitMember,
  onGoal,
  onLoan,
  onSub,
  onSplitMember,
  colors,
  currency,
  txType,
  prefillName,
  prefillAmount,
  prefillCategory,
  prefillAccountId,
  onNavigatingToCreate,
}: EntityLinkerProps) => {
  const [openPicker, setOpenPicker] = useState<
    "goal" | "loan" | "sub" | "split" | null
  >(null);
  const navigation = useNavigation<any>();

  useEffect(() => {
    setOpenPicker(null);
  }, [txType]);

  const toggle = (type: "goal" | "loan" | "sub" | "split") => {
    setOpenPicker((prev) => (prev === type ? null : type));
    Haptics.selectionAsync();
  };

  const chipStyle = (active: boolean, color: string) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: active ? color : colors.border,
    backgroundColor: active ? `${color}15` : colors.surface,
    gap: 6,
    flex: 1,
  });

  const selectedGoalObj = goals.find((g) => g.id === selectedGoal);
  const selectedLoanObj = loans.find((l) => l.id === selectedLoan);
  const selectedSubObj = subscriptions.find((s) => s.id === selectedSub);
  const selectedSplitMemberObj = splitMembers.find(
    (sm) => sm.memberId === selectedSplitMember,
  );

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
        {/* Subscription chip or Split Repayment chip */}
        {txType === "credit" ? (
          <TouchableOpacity
            style={chipStyle(!!selectedSplitMember, "#BF5AF2")}
            onPress={() => (splitMembers.length > 0 ? toggle("split") : null)}
            disabled={splitMembers.length === 0}
            activeOpacity={0.7}
          >
            <LucideUsers
              color={selectedSplitMember ? "#BF5AF2" : colors.secondary}
              size={14}
            />
            <ThemedText
              style={{
                color: selectedSplitMember ? "#BF5AF2" : colors.secondary,
                fontSize: 12,
                fontWeight: "bold",
                flex: 1,
              }}
              numberOfLines={1}
            >
              {selectedSplitMemberObj
                ? selectedSplitMemberObj.memberName
                : splitMembers.length > 0
                  ? "Split Repay"
                  : "No Splits"}
            </ThemedText>
            {splitMembers.length > 0 &&
              (openPicker === "split" ? (
                <LucideChevronUp color={colors.secondary} size={12} />
              ) : (
                <LucideChevronDown color={colors.secondary} size={12} />
              ))}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={chipStyle(!!selectedSub, "#5AC8FA")}
            onPress={() => toggle("sub")}
            activeOpacity={0.7}
          >
            <LucideRepeat
              color={selectedSub ? "#5AC8FA" : colors.secondary}
              size={14}
            />
            <ThemedText
              style={{
                color: selectedSub ? "#5AC8FA" : colors.secondary,
                fontSize: 12,
                fontWeight: "bold",
                flex: 1,
              }}
              numberOfLines={1}
            >
              {selectedSubObj ? selectedSubObj.name : "Subscription"}
            </ThemedText>
            {openPicker === "sub" ? (
              <LucideChevronUp color={colors.secondary} size={12} />
            ) : (
              <LucideChevronDown color={colors.secondary} size={12} />
            )}
          </TouchableOpacity>
        )}

        {/* Goal chip */}
        <TouchableOpacity
          style={chipStyle(!!selectedGoal, "#34C759")}
          onPress={() => toggle("goal")}
          activeOpacity={0.7}
        >
          <LucideTarget
            color={selectedGoal ? "#34C759" : colors.secondary}
            size={14}
          />
          <ThemedText
            style={{
              color: selectedGoal ? "#34C759" : colors.secondary,
              fontSize: 12,
              fontWeight: "bold",
              flex: 1,
            }}
            numberOfLines={1}
          >
            {selectedGoalObj ? selectedGoalObj.name : "Goal"}
          </ThemedText>
          {openPicker === "goal" ? (
            <LucideChevronUp color={colors.secondary} size={12} />
          ) : (
            <LucideChevronDown color={colors.secondary} size={12} />
          )}
        </TouchableOpacity>

        {/* Loan chip */}
        <TouchableOpacity
          style={chipStyle(!!selectedLoan, "#FF9500")}
          onPress={() => toggle("loan")}
          activeOpacity={0.7}
        >
          <LucideLandmark
            color={selectedLoan ? "#FF9500" : colors.secondary}
            size={14}
          />
          <ThemedText
            style={{
              color: selectedLoan ? "#FF9500" : colors.secondary,
              fontSize: 12,
              fontWeight: "bold",
              flex: 1,
            }}
            numberOfLines={1}
          >
            {selectedLoan === -1 ? "New Lend" : selectedLoan === -2 ? "New Borrow" : selectedLoanObj ? selectedLoanObj.lender : "Loan"}
          </ThemedText>
          {openPicker === "loan" ? (
            <LucideChevronUp color={colors.secondary} size={12} />
          ) : (
            <LucideChevronDown color={colors.secondary} size={12} />
          )}
        </TouchableOpacity>
      </View>

      {/* Subscription picker */}
      {openPicker === "sub" && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#5AC8FA40",
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <TouchableOpacity
            style={{
              padding: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
            onPress={() => {
              onSub(null);
              setOpenPicker(null);
            }}
          >
            <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>
              None — unlink subscription
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              gap: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: `${colors.accent}10`,
            }}
            onPress={() => {
              setOpenPicker(null);
              onNavigatingToCreate?.('sub');
              navigation.navigate("AddSubscription", {
                prefillName,
                prefillAmount,
                prefillCategory,
                prefillAccountId: prefillAccountId || undefined,
              });
            }}
          >
            <LucidePlus color="#5AC8FA" size={15} />
            <ThemedText
              style={{ fontWeight: "bold", color: "#5AC8FA", fontSize: 13 }}
            >
              Create new subscription...
            </ThemedText>
          </TouchableOpacity>
          {subscriptions.map((sub) => (
            <TouchableOpacity
              key={sub.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 12,
                gap: 10,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                backgroundColor:
                  selectedSub === sub.id ? "#5AC8FA12" : "transparent",
              }}
              onPress={() => {
                onSub(sub.id);
                setOpenPicker(null);
              }}
            >
              <LucideRepeat
                color={selectedSub === sub.id ? "#5AC8FA" : colors.secondary}
                size={15}
              />
              <View style={{ flex: 1 }}>
                <ThemedText
                  style={{
                    fontWeight: "bold",
                    color: selectedSub === sub.id ? "#5AC8FA" : colors.primary,
                  }}
                >
                  {sub.name}
                </ThemedText>
                <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                  {sub.frequency} · {currency}
                  {sub.amount.toLocaleString("en-IN")}
                  {sub.splitEnabled
                    ? ` · Split ${
                        sub.splitMembers
                          ? (() => {
                              try {
                                return JSON.parse(sub.splitMembers).length + 1;
                              } catch {
                                return "";
                              }
                            })() + " people"
                          : ""
                      }`
                    : ""}
                </ThemedText>
              </View>
              {selectedSub === sub.id && (
                <LucideCheck color="#5AC8FA" size={15} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Split Repayment picker */}
      {openPicker === "split" && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#BF5AF240",
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <TouchableOpacity
            style={{
              padding: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
            onPress={() => {
              onSplitMember(null);
              setOpenPicker(null);
            }}
          >
            <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>
              None — unlink split repayment
            </ThemedText>
          </TouchableOpacity>
          {splitMembers.map((member) => {
            const remaining = member.memberShare - member.memberPaidAmount;
            return (
              <TouchableOpacity
                key={member.memberId}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 12,
                  gap: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  backgroundColor:
                    selectedSplitMember === member.memberId
                      ? "#BF5AF212"
                      : "transparent",
                }}
                onPress={() => {
                  onSplitMember(member.memberId);
                  setOpenPicker(null);
                }}
              >
                <LucideUsers
                  color={
                    selectedSplitMember === member.memberId
                      ? "#BF5AF2"
                      : colors.secondary
                  }
                  size={15}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText
                    style={{
                      fontWeight: "bold",
                      color:
                        selectedSplitMember === member.memberId
                          ? "#BF5AF2"
                          : colors.primary,
                    }}
                  >
                    {member.memberName} — {member.splitTitle}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    Owes: {currency}
                    {remaining.toLocaleString("en-IN")} (Share: {currency}
                    {member.memberShare.toLocaleString("en-IN")})
                  </ThemedText>
                </View>
                {selectedSplitMember === member.memberId && (
                  <LucideCheck color="#BF5AF2" size={15} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Goal picker */}
      {openPicker === "goal" && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#34C75940",
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <TouchableOpacity
            style={{
              padding: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
            onPress={() => {
              onGoal(null);
              setOpenPicker(null);
            }}
          >
            <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>
              None — unlink goal
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              gap: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: `${colors.accent}10`,
            }}
            onPress={() => {
              setOpenPicker(null);
              onNavigatingToCreate?.('goal');
              navigation.navigate("AddGoal", {
                prefillName,
                prefillAmount,
                prefillCategory,
                prefillAccountId: prefillAccountId || undefined,
              });
            }}
          >
            <LucidePlus color="#34C759" size={15} />
            <ThemedText
              style={{ fontWeight: "bold", color: "#34C759", fontSize: 13 }}
            >
              Create new goal...
            </ThemedText>
          </TouchableOpacity>
          {goals.map((goal) => {
            const pct =
              goal.targetAmount > 0
                ? Math.round((goal.currentAmount / goal.targetAmount) * 100)
                : 0;
            return (
              <TouchableOpacity
                key={goal.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 12,
                  gap: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  backgroundColor:
                    selectedGoal === goal.id ? "#34C75912" : "transparent",
                }}
                onPress={() => {
                  onGoal(goal.id);
                  setOpenPicker(null);
                }}
              >
                <LucideTarget
                  color={
                    selectedGoal === goal.id ? "#34C759" : colors.secondary
                  }
                  size={15}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText
                    style={{
                      fontWeight: "bold",
                      color:
                        selectedGoal === goal.id ? "#34C759" : colors.primary,
                    }}
                  >
                    {goal.name}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    {currency}
                    {goal.currentAmount.toLocaleString("en-IN")} / {currency}
                    {goal.targetAmount.toLocaleString("en-IN")} · {pct}%
                  </ThemedText>
                </View>
                {selectedGoal === goal.id && (
                  <LucideCheck color="#34C759" size={15} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Loan picker */}
      {openPicker === "loan" && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#FF950040",
            marginBottom: 8,
            overflow: "hidden",
          }}
        >
          <TouchableOpacity
            style={{
              padding: 12,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
            onPress={() => {
              onLoan(null);
              setOpenPicker(null);
            }}
          >
            <ThemedText style={{ color: colors.secondary, fontSize: 13 }}>
              None — unlink loan
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 12,
              gap: 10,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: `${colors.accent}10`,
            }}
            onPress={() => {
              onLoan(txType === "credit" ? -2 : -1);
              setOpenPicker(null);
            }}
          >
            <LucidePlus color="#FF9500" size={15} />
            <ThemedText
              style={{ fontWeight: "bold", color: "#FF9500", fontSize: 13 }}
            >
              {txType === "credit"
                ? "Mark as new loan borrowed (Borrowing)..."
                : "Mark as new loan lent (Lending)..."}
            </ThemedText>
          </TouchableOpacity>

          <View style={{ backgroundColor: colors.translucent, padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <ThemedText style={{ fontSize: 11, fontWeight: "bold", color: colors.secondary, textTransform: "uppercase" }}>
              {txType === "credit" ? "Repayments of Existing Loans (Lending)" : "Repay Existing Loans (Borrowing)"}
            </ThemedText>
          </View>

          {(() => {
            const filteredLoans = loans.filter(l => txType === "credit" ? l.type === "lent" : l.type === "borrowed");
            if (filteredLoans.length === 0) {
              return (
                <View style={{ padding: 16, alignItems: "center" }}>
                  <ThemedText style={{ color: colors.muted, fontSize: 13 }}>
                    {txType === "credit" ? "No active lending loans" : "No active borrowing loans"}
                  </ThemedText>
                </View>
              );
            }
            return filteredLoans.map((loan) => (
              <TouchableOpacity
                key={loan.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 12,
                  gap: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  backgroundColor:
                    selectedLoan === loan.id ? "#FF950012" : "transparent",
                }}
                onPress={() => {
                  onLoan(loan.id);
                  setOpenPicker(null);
                }}
              >
                <LucideLandmark
                  color={selectedLoan === loan.id ? "#FF9500" : colors.secondary}
                  size={15}
                />
                <View style={{ flex: 1 }}>
                  <ThemedText
                    style={{
                      fontWeight: "bold",
                      color:
                        selectedLoan === loan.id ? "#FF9500" : colors.primary,
                    }}
                  >
                    {loan.lender}
                  </ThemedText>
                  <ThemedText style={{ fontSize: 11, color: colors.secondary }}>
                    {loan.type === "borrowed" ? "Borrowing" : "Lending"} ·{" "}
                    {currency}
                    {loan.remainingAmount.toLocaleString("en-IN")} remaining
                    {loan.emiAmount
                      ? ` · EMI ${currency}${loan.emiAmount.toLocaleString("en-IN")}`
                      : ""}
                  </ThemedText>
                </View>
                {selectedLoan === loan.id && (
                  <LucideCheck color="#FF9500" size={15} />
                )}
              </TouchableOpacity>
            ));
          })()}
        </View>
      )}

      {/* Context hints */}
      {selectedSubObj && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#5AC8FA10",
            borderRadius: 10,
            padding: 10,
            marginBottom: 6,
          }}
        >
          <LucideRepeat color="#5AC8FA" size={13} />
          <ThemedText style={{ fontSize: 12, color: "#5AC8FA", flex: 1 }}>
            Linked to {selectedSubObj.name} subscription. Payment will advance
            next due date.
            {selectedSubObj.splitEnabled ? " Split will be auto-created." : ""}
          </ThemedText>
        </View>
      )}
      {selectedSplitMemberObj && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#BF5AF210",
            borderRadius: 10,
            padding: 10,
            marginBottom: 6,
          }}
        >
          <LucideUsers color="#BF5AF2" size={13} />
          <ThemedText style={{ fontSize: 12, color: "#BF5AF2", flex: 1 }}>
            Linked to split repayment for "{selectedSplitMemberObj.splitTitle}"
            from {selectedSplitMemberObj.memberName}.
          </ThemedText>
        </View>
      )}
      {selectedGoalObj && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#34C75910",
            borderRadius: 10,
            padding: 10,
            marginBottom: 6,
          }}
        >
          <LucideTarget color="#34C759" size={13} />
          <ThemedText style={{ fontSize: 12, color: "#34C759", flex: 1 }}>
            Linked to "{selectedGoalObj.name}" goal. Amount will be added to
            goal progress.
          </ThemedText>
        </View>
      )}
      {selectedLoanObj && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: "#FF950010",
            borderRadius: 10,
            padding: 10,
            marginBottom: 6,
          }}
        >
          <LucideLandmark color="#FF9500" size={13} />
          <ThemedText style={{ fontSize: 12, color: "#FF9500", flex: 1 }}>
            Linked to {selectedLoanObj.lender} loan. Payment will reduce
            remaining balance.
          </ThemedText>
        </View>
      )}
    </View>
  );
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export const AddTransactionScreen = ({ navigation: navProp, route }: any) => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const navigation = navProp ?? useNavigation();
  const { checkBudgetAlerts } = useNotifications();

  // Pre-fill from route params (e.g. deep-link from a subscription/goal/loan card)
  const prefill = route?.params ?? {};

  const [amount, setAmount] = useState(
    prefill.amount ? String(prefill.amount) : "",
  );
  const [merchant, setMerchant] = useState(prefill.merchant ?? "");
  const [category, setCategory] = useState(prefill.category ?? "Other");
  const [type, setType] = useState<"debit" | "credit" | "transfer">(
    prefill.type ?? "debit",
  );
  const [notes, setNotes] = useState(prefill.notes ?? "");
  const [tags, setTags] = useState<string[]>(prefill.tags ?? []);
  const [isRecurring, setIsRecurring] = useState(prefill.isRecurring ?? false);
  const [date, setDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<"date" | "time">("date");

  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);

  const [selectedAccount, setSelectedAccount] = useState<number | null>(
    prefill.accountId ?? null,
  );
  const [selectedToAccount, setSelectedToAccount] = useState<number | null>(
    prefill.toAccountId ?? null,
  );
  const [selectedGoal, setSelectedGoal] = useState<number | null>(
    prefill.goalId ?? null,
  );
  const [selectedLoan, setSelectedLoan] = useState<number | null>(
    prefill.loanId ?? null,
  );
  const [loanPersonName, setLoanPersonName] = useState("");
  const [selectedSub, setSelectedSub] = useState<number | null>(
    prefill.subscriptionId ?? null,
  );

  const [errors, setErrors] = useState<{
    amount?: string;
    merchant?: string;
    account?: string;
    toAccount?: string;
  }>({});
  const [saving, setSaving] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [modalVisible, setModalVisible] = useState(false);

  // Split configurations
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitEqually, setSplitEqually] = useState(true);
  const [receiveToAccountId, setReceiveToAccountId] = useState<number | null>(
    null,
  );

  interface MemberRow {
    key: string;
    name: string;
    share: string;
  }
  const [splitMembers, setSplitMembers] = useState<MemberRow[]>([
    { key: "p1", name: "", share: "" },
  ]);

  const [pendingSplitMembers, setPendingSplitMembers] = useState<
    PendingSplitMember[]
  >([]);
  const [selectedSplitMember, setSelectedSplitMember] = useState<number | null>(
    prefill.splitMemberId ?? null,
  );

  const isFirstLoadRef = React.useRef(true);
  // Tracks when the user explicitly navigated to create a new sub or goal from the EntityLinker.
  // Auto-link only fires on focus return when this flag is set.
  const pendingLinkTypeRef = React.useRef<'sub' | 'goal' | null>(null);
  const goalsRef = React.useRef<Goal[]>([]);
  const subsRef = React.useRef<Subscription[]>([]);

  const themedStyles = useMemo(
    () => createThemedStyles(colors, isDark),
    [colors, isDark],
  );
  const refreshCategories = () => {
    getCategories().then(setCategories);
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      if (event.type === "set" && selectedDate) {
        if (pickerMode === "date") {
          const newDate = new Date(date);
          newDate.setFullYear(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
          );
          setDate(newDate);
          setPickerMode("time");
          setShowDatePicker(false);
          // Android needs a small delay between pickers
          setTimeout(() => setShowDatePicker(true), 100);
          return;
        } else {
          const newDate = new Date(date);
          newDate.setHours(selectedDate.getHours(), selectedDate.getMinutes());
          setDate(newDate);
        }
      }
      setShowDatePicker(false);
      setPickerMode("date");
    } else {
      if (selectedDate) setDate(selectedDate);
    }
  };

  useEffect(() => {
    const loadData = () => {
      Promise.all([
        getCategories(),
        getAccounts(),
        getGoals(true),
        getLoans(true),
        getSubscriptions(true),
        getPendingSplitMembers(),
      ]).then(([cats, accs, gs, ls, ss, sms]) => {
        setCategories(cats);
        setAccounts(accs);

        // Smart auto-link: only fires when the user explicitly navigated from
        // the EntityLinker to create a new sub or goal (pendingLinkTypeRef is set).
        if (!isFirstLoadRef.current && pendingLinkTypeRef.current === 'goal') {
          if (gs.length > goalsRef.current.length) {
            const newGoal = gs.find(g => !goalsRef.current.some(old => old.id === g.id));
            if (newGoal) handleGoalSelect(newGoal.id);
          }
          pendingLinkTypeRef.current = null;
        } else if (!isFirstLoadRef.current && pendingLinkTypeRef.current === 'sub') {
          if (ss.length > subsRef.current.length) {
            const newSub = ss.find(s => !subsRef.current.some(old => old.id === s.id));
            if (newSub) handleSubSelect(newSub.id);
          }
          pendingLinkTypeRef.current = null;
        }

        // Update tracking refs with the latest lists
        goalsRef.current = gs;
        subsRef.current = ss;

        setGoals(gs);
        setLoans(ls);
        setSubscriptions(ss);
        setPendingSplitMembers(sms);

        if (isFirstLoadRef.current) {
          isFirstLoadRef.current = false;
          const otherMatch = cats.find(
            (c) =>
              c.name === "Other" &&
              (type === "transfer"
                ? c.type === "transfer"
                : type === "debit"
                  ? c.type === "expense"
                  : c.type === "income"),
          );
          if (otherMatch && !prefill.category) {
            setCategory(otherMatch.name);
          } else if (!prefill.category) {
            const firstMatch = cats.find((c) => {
              if (type === "transfer") return c.type === "transfer";
              return type === "debit"
                ? c.type === "expense"
                : c.type === "income";
            });
            if (firstMatch) setCategory(firstMatch.name);
          }

          if (accs.length > 0 && !prefill.accountId) {
            setSelectedAccount(accs[0].id);
            setReceiveToAccountId(accs[0].id);
          } else if (accs.length > 0) {
            setReceiveToAccountId(prefill.accountId ?? accs[0].id);
          }
        }
      });
    };

    loadData();
    const unsubscribe = navigation.addListener("focus", loadData);
    return unsubscribe;
  }, [navigation, type]);

  // Auto-populate when split member selected
  const handleSplitMemberSelect = (id: number | null) => {
    setSelectedSub(null);
    setSelectedGoal(null);
    setSelectedLoan(null);
    setSelectedSplitMember(id);
    if (!id) return;
    const member = pendingSplitMembers.find((sm) => sm.memberId === id);
    if (!member) return;
    const remaining = member.memberShare - member.memberPaidAmount;
    if (remaining > 0) {
      setAmount(String(remaining));
    }
    setMerchant(`${member.memberName} — ${member.splitTitle}`);
    setCategory("Split");
    setNotes(`Split repayment from ${member.memberName}`);
  };

  // Auto-populate when subscription selected
  const handleSubSelect = (id: number | null) => {
    setSelectedGoal(null);
    setSelectedLoan(null);
    setSelectedSplitMember(null);
    setSelectedSub(id);
    if (!id) return;
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) return;
    if (!merchant) setMerchant(sub.name);
    if (sub.amount && !amount) setAmount(String(sub.amount));
    setCategory(sub.category);
    setIsRecurring(true);

    // Auto-prefill split from subscription if enabled
    if (sub.splitEnabled && sub.splitMembers) {
      try {
        const subMembers = JSON.parse(sub.splitMembers) as { name: string }[];
        if (subMembers.length > 0) {
          setSplitEnabled(true);
          setSplitEqually(true);
          const membersList = subMembers.map((m, idx) => ({
            key: `p${idx + 1}`,
            name: m.name,
            share: "",
          }));
          setSplitMembers(membersList);
        }
      } catch (err) {
        console.warn("Failed to parse subscription split members", err);
      }
    }
    if (sub.debitAccountId) setSelectedAccount(sub.debitAccountId);
  };

  // Auto-populate when goal selected
  const handleGoalSelect = (id: number | null) => {
    setSelectedSub(null);
    setSelectedLoan(null);
    setSelectedSplitMember(null);
    setSelectedGoal(id);
    if (!id) return;
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;
    setMerchant(goal.name);
    setCategory(goal.category);
    setNotes(`Contribution to goal: ${goal.name}`);
    const remaining = goal.targetAmount - goal.currentAmount;
    if (goal.monthlyContribution && goal.monthlyContribution > 0) {
      setAmount(String(goal.monthlyContribution));
    } else if (remaining > 0) {
      setAmount(String(remaining));
    } else {
      setAmount(String(goal.targetAmount));
    }
    if (goal.linkedAccountId) {
      if (type === "transfer") {
        setSelectedToAccount(goal.linkedAccountId);
      } else {
        setSelectedAccount(goal.linkedAccountId);
      }
    }
  };

  // Auto-populate when loan selected
  const handleLoanSelect = (id: number | null) => {
    setSelectedSub(null);
    setSelectedGoal(null);
    setSelectedSplitMember(null);
    setSelectedLoan(id);
    if (!id) return;
    if (id === -1 || id === -2) {
      setCategory("Debt");
      const initialName = loanPersonName || merchant || "";
      if (initialName) {
        setMerchant(initialName);
        setNotes(id === -1 ? `New loan lending to ${initialName}` : `New loan borrowed from ${initialName}`);
      } else {
        setNotes(id === -1 ? "New loan lending" : "New loan borrowed");
      }
      return;
    }
    const loan = loans.find((l) => l.id === id);
    if (!loan) return;
    setMerchant(loan.lender);
    setCategory("Debt");

    const isRepayment =
      (loan.type === "lent" && type === "credit") ||
      (loan.type === "borrowed" && type === "debit");
    if (isRepayment && loan.emiAmount && loan.emiAmount > 0) {
      setAmount(String(loan.emiAmount));
    } else if (loan.remainingAmount > 0) {
      setAmount(String(loan.remainingAmount));
    } else {
      setAmount(String(loan.totalAmount));
    }

    if (loan.type === "borrowed") {
      setNotes(
        type === "credit"
          ? `Loan disbursement from ${loan.lender}`
          : `EMI payment for loan from ${loan.lender}`,
      );
    } else {
      setNotes(
        type === "credit"
          ? `Loan repayment from ${loan.lender}`
          : `Additional loan to ${loan.lender}`,
      );
    }

    if (loan.linkedAccountId) {
      setSelectedAccount(loan.linkedAccountId);
    }
  };

  // Sync merchant with loanPersonName and notes when selectedLoan is new
  useEffect(() => {
    if (selectedLoan === -1 || selectedLoan === -2) {
      if (loanPersonName) {
        setMerchant(loanPersonName);
        setNotes(
          selectedLoan === -1
            ? `New loan lending to ${loanPersonName}`
            : `New loan borrowed from ${loanPersonName}`
        );
      }
    }
  }, [loanPersonName, selectedLoan]);

  useEffect(() => {
    if ((selectedLoan === -1 || selectedLoan === -2) && !loanPersonName && merchant) {
      setLoanPersonName(merchant);
    }
  }, [merchant, selectedLoan]);

  useEffect(() => {
    if (selectedLoan !== -1 && selectedLoan !== -2) {
      setLoanPersonName('');
    }
  }, [selectedLoan]);

  // Enforce type-specific linking constraints when type changes
  useEffect(() => {
    if (type !== "debit") {
      setSelectedSub(null);
    }
    if (type !== "credit") {
      setSelectedSplitMember(null);
    }
  }, [type]);

  // Reset category when type changes
  useEffect(() => {
    if (selectedSub || selectedGoal || selectedLoan) return; // don't override linked entity category
    const otherMatch = categories.find(
      (c) =>
        c.name === "Other" &&
        (type === "transfer"
          ? c.type === "transfer"
          : type === "debit"
            ? c.type === "expense"
            : c.type === "income"),
    );
    if (otherMatch) {
      setCategory(otherMatch.name);
    } else {
      const firstMatch = categories.find((c) => {
        if (type === "transfer") return c.type === "transfer";
        return type === "debit" ? c.type === "expense" : c.type === "income";
      });
      if (firstMatch) setCategory(firstMatch.name);
    }
  }, [type, categories]);



  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      newErrors.amount = "Enter a valid amount greater than 0";
    } else if (parsed > 10_000_000) {
      const currency = preferences?.currency ?? "₹";
      newErrors.amount = `Amount cannot exceed ${currency}1,00,00,000`;
    }
    if (!merchant.trim()) {
      newErrors.merchant = "Merchant / source name is required";
    } else if (merchant.trim().length > 100) {
      newErrors.merchant = "Max 100 characters";
    }
    if (!selectedAccount) {
      newErrors.account = "Select an account";
    }
    if (type === "transfer" && !selectedToAccount) {
      newErrors.toAccount = "Select a destination account";
    } else if (type === "transfer" && selectedAccount === selectedToAccount) {
      newErrors.toAccount = "Source and destination cannot be the same";
    }

    if (splitEnabled && type === "debit") {
      if (splitMembers.some((m) => !m.name.trim())) {
        notify.error("Enter a name for each person in split");
        return false;
      }
      if (splitMembers.some((m) => (parseFloat(m.share) || 0) <= 0)) {
        notify.error("Each person needs a split share > 0");
        return false;
      }
      if (othersTotal >= parsed) {
        notify.error(
          "Others' total share cannot exceed the transaction amount",
        );
        return false;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Helper calculations for split
  const total = parseFloat(amount) || 0;
  const othersTotal = splitMembers.reduce(
    (s, m) => s + (parseFloat(m.share) || 0),
    0,
  );
  const myShare = Math.max(0, Math.round((total - othersTotal) * 100) / 100);

  const distributeEqually = useCallback((count: number, tot: number) => {
    if (count < 1 || tot <= 0) return "";
    const each = tot / (count + 1); // +1 for "me"
    return each.toFixed(2);
  }, []);

  useEffect(() => {
    if (!splitEqually || !splitEnabled) return;
    const share = distributeEqually(splitMembers.length, total);
    setSplitMembers((prev) => prev.map((m) => ({ ...m, share })));
  }, [
    splitEqually,
    splitMembers.length,
    total,
    splitEnabled,
    distributeEqually,
  ]);

  const addSplitMember = () => {
    const key = `p${Date.now()}`;
    const share = splitEqually
      ? distributeEqually(splitMembers.length + 1, total)
      : "";
    setSplitMembers((prev) => [...prev, { key, name: "", share }]);
    Haptics.selectionAsync();
  };

  const removeSplitMember = (key: string) => {
    if (splitMembers.length === 1) return;
    setSplitMembers((prev) => {
      const next = prev.filter((m) => m.key !== key);
      if (splitEqually) {
        const share = distributeEqually(next.length, total);
        return next.map((m) => ({ ...m, share }));
      }
      return next;
    });
    Haptics.selectionAsync();
  };

  const updateSplitMember = (
    key: string,
    field: "name" | "share",
    value: string,
  ) => {
    setSplitMembers((prev) =>
      prev.map((m) => (m.key === key ? { ...m, [field]: value } : m)),
    );
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    let finalLoanId: number | undefined = selectedLoan || undefined;

    if (selectedLoan === -1 || selectedLoan === -2) {
      const newLoanType = selectedLoan === -1 ? "lent" : "borrowed";
      const newLoanId = await addLoan({
        lender: (loanPersonName || merchant).trim(),
        totalAmount: parseFloat(amount),
        remainingAmount: 0,
        emiAmount: 0,
        nextDueDate: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString(),
        interestRate: undefined,
        isActive: true,
        type: newLoanType,
        linkedAccountId: selectedAccount || undefined,
        tenure: undefined,
        notes: notes.trim() || undefined,
      });
      finalLoanId = newLoanId;
    }

    const txId = await addTransaction({
      amount: parseFloat(amount),
      merchant: merchant.trim(),
      category,
      type,
      date: date.toISOString(),
      accountId: selectedAccount || undefined,
      toAccountId:
        type === "transfer" ? selectedToAccount || undefined : undefined,
      rawSms: "Manual Entry",
      isRecurring,
      isConfirmed: true,
      isTransfer: type === "transfer",
      notes: notes.trim() || undefined,
      goalId: selectedGoal || undefined,
      loanId: finalLoanId,
      subscriptionId: selectedSub || undefined,
      tags: tags.length > 0 ? tags : undefined,
      splitMemberId: selectedSplitMember || undefined,
    });

    if (splitEnabled && type === "debit") {
      const allMembers = [
        { name: "Me", share: myShare, isMe: true, isPaid: true },
        ...splitMembers.map((m) => ({
          name: m.name.trim(),
          share: parseFloat(m.share),
          isMe: false,
          isPaid: false,
        })),
      ];
      await createSplit(
        {
          transactionId: txId,
          title: merchant.trim(),
          totalAmount: parseFloat(amount),
          paidByAccountId: selectedAccount || undefined,
          receiveToAccountId: receiveToAccountId || undefined,
          date: date.toISOString().split("T")[0],
        },
        allMembers,
      );
    }

    notify.success("Transaction saved");
    checkBudgetAlerts();
    navigation.goBack();
  };

  const isValid = !!amount && !!merchant.trim() && parseFloat(amount) > 0;

  return (
    <ThemedSafeAreaView edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={themedStyles.content}>
          <View style={themedStyles.header}>
            <ThemedText className="text-2xl font-bold">
              New Transaction
            </ThemedText>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <LucideX color={colors.secondary} size={24} />
            </TouchableOpacity>
          </View>

          {/* Type toggle */}
          <View
            style={[
              themedStyles.typeToggle,
              { backgroundColor: colors.translucent },
            ]}
          >
            {(["debit", "credit", "transfer"] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                style={[
                  themedStyles.typeBtn,
                  type === t && {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    borderWidth: 1,
                  },
                ]}
              >
                <ThemedText
                  className="text-xs font-bold"
                  style={{
                    color: type === t ? colors.primary : colors.secondary,
                  }}
                >
                  {t === "debit"
                    ? "EXPENSE"
                    : t === "transfer"
                      ? "TRANSFER"
                      : "INCOME"}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 40 }}
          >
            {/* Account Selector */}
            {/* Priority Section: Amount & Category side-by-side */}
            <View
              style={{
                flexDirection: "row",
                gap: 16,
                marginBottom: 24,
                alignItems: "center",
              }}
            >
              {/* 1. Amount */}
              <View style={{ flex: 1 }}>
                <ThemedText type="secondary" style={themedStyles.label}>
                  Amount ({preferences.currency})
                </ThemedText>
                <TextInput
                  style={[
                    themedStyles.amountInput,
                    {
                      color:
                        type === "transfer"
                          ? colors.warning
                          : type === "credit"
                            ? colors.success
                            : colors.accent,
                    },
                    errors.amount && { borderBottomColor: colors.danger },
                  ]}
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  value={amount}
                  onChangeText={(v) => {
                    setAmount(v);
                    setErrors((e) => ({ ...e, amount: undefined }));
                  }}
                />
                {errors.amount && (
                  <ThemedText
                    style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}
                  >
                    {errors.amount}
                  </ThemedText>
                )}
              </View>

              {/* 2. Category Square Card */}
              <CategoryPicker
                selectedCategory={category}
                onSelect={setCategory}
                categories={categories}
                type={
                  type === "debit"
                    ? "expense"
                    : type === "credit"
                      ? "income"
                      : "transfer"
                }
                refreshCategories={refreshCategories}
                variant="square"
              />
            </View>

            {/* 3. Account Selector */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                {type === "transfer" ? "From Account" : "Account"}
              </ThemedText>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="-mx-6 mb-2"
                contentContainerStyle={{
                  paddingHorizontal: 24,
                  paddingRight: 32,
                }}
                nestedScrollEnabled={true}
              >
                {accounts
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((acc) => (
                    <TouchableOpacity
                      key={acc.id}
                      onPress={() => {
                        setSelectedAccount(acc.id);
                        setErrors((e) => ({ ...e, account: undefined }));
                      }}
                      style={[
                        themedStyles.pill,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                        selectedAccount === acc.id && {
                          backgroundColor: `${colors.accent}15`,
                          borderColor: colors.accent,
                        },
                      ]}
                    >
                      <ThemedText
                        style={{
                          color:
                            selectedAccount === acc.id
                              ? colors.accent
                              : colors.secondary,
                          fontWeight: "bold",
                        }}
                      >
                        {acc.name}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
              {errors.account && (
                <ThemedText style={{ color: colors.danger, fontSize: 12 }}>
                  {errors.account}
                </ThemedText>
              )}
            </View>

            {/* 3.5. To Account Selector (Transfer only) */}
            {type === "transfer" && (
              <View style={themedStyles.field}>
                <ThemedText type="secondary" style={themedStyles.label}>
                  To Account
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="-mx-6 mb-2"
                  contentContainerStyle={{
                    paddingHorizontal: 24,
                    paddingRight: 32,
                  }}
                  nestedScrollEnabled={true}
                >
                  {accounts
                    .sort((a, b) => a.displayOrder - b.displayOrder)
                    .map((acc) => (
                      <TouchableOpacity
                        key={`to-${acc.id}`}
                        onPress={() => {
                          setSelectedToAccount(acc.id);
                          setErrors((e) => ({ ...e, toAccount: undefined }));
                        }}
                        style={[
                          themedStyles.pill,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                          selectedToAccount === acc.id && {
                            backgroundColor: `${colors.warning}15`,
                            borderColor: colors.warning,
                          },
                        ]}
                      >
                        <ThemedText
                          style={{
                            color:
                              selectedToAccount === acc.id
                                ? colors.warning
                                : colors.secondary,
                            fontWeight: "bold",
                          }}
                        >
                          {acc.name}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
                {errors.toAccount && (
                  <ThemedText style={{ color: colors.danger, fontSize: 12 }}>
                    {errors.toAccount}
                  </ThemedText>
                )}
              </View>
            )}

            {/* 4. Merchant */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                Merchant / Source
              </ThemedText>
              <TextInput
                style={[
                  themedStyles.merchantInput,
                  { color: colors.primary, borderBottomColor: colors.border },
                  errors.merchant && { borderBottomColor: colors.danger },
                ]}
                placeholder="e.g. Starbucks, Salary"
                placeholderTextColor={colors.muted}
                value={merchant}
                onChangeText={(v) => {
                  setMerchant(v);
                  setErrors((e) => ({ ...e, merchant: undefined }));
                }}
                maxLength={100}
              />
              {errors.merchant && (
                <ThemedText
                  style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}
                >
                  {errors.merchant}
                </ThemedText>
              )}
            </View>

            {/* 5. Date */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                Transaction Date
              </ThemedText>
              <TouchableOpacity
                style={[
                  themedStyles.dateRow,
                  { borderBottomColor: colors.border },
                ]}
                onPress={() => setShowDatePicker(true)}
                activeOpacity={0.7}
              >
                <LucideCalendar color={colors.secondary} size={16} />
                <ThemedText style={{ fontSize: 16 }}>
                  {date.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  ·{" "}
                  {date.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </ThemedText>
              </TouchableOpacity>
              {showDatePicker && (
                <View
                  style={
                    Platform.OS === "ios"
                      ? themedStyles.iosPickerContainer
                      : undefined
                  }
                >
                  <DateTimePicker
                    value={date}
                    mode={Platform.OS === "ios" ? "datetime" : pickerMode}
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    onChange={handleDateChange}
                    maximumDate={new Date()}
                    themeVariant={isDark ? "dark" : "light"}
                  />
                  {Platform.OS === "ios" && (
                    <TouchableOpacity
                      onPress={() => setShowDatePicker(false)}
                      style={themedStyles.iosPickerDone}
                    >
                      <ThemedText
                        style={{ color: colors.accent, fontWeight: "bold" }}
                      >
                        Done
                      </ThemedText>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            {/* 6. Link to entity */}
            <View style={themedStyles.field}>
              <ThemedText
                type="secondary"
                style={[themedStyles.label, { marginBottom: 12 }]}
              >
                Link to Subscription / Goal / Loan
              </ThemedText>
              <EntityLinker
                goals={goals}
                loans={loans}
                subscriptions={subscriptions}
                splitMembers={pendingSplitMembers}
                selectedGoal={selectedGoal}
                selectedLoan={selectedLoan}
                selectedSub={selectedSub}
                selectedSplitMember={selectedSplitMember}
                onGoal={handleGoalSelect}
                onLoan={handleLoanSelect}
                onSub={handleSubSelect}
                onSplitMember={handleSplitMemberSelect}
                colors={colors}
                currency={preferences.currency}
                txType={type}
                prefillName={merchant}
                prefillAmount={amount}
                prefillCategory={category}
                prefillAccountId={selectedAccount}
                onNavigatingToCreate={(type) => { pendingLinkTypeRef.current = type; }}
              />
              {(selectedLoan === -1 || selectedLoan === -2) && (
                <View style={{ marginTop: 12 }}>
                  <ThemedText style={[themedStyles.label, { marginBottom: 6, fontSize: 13 }]}>
                    {selectedLoan === -1 ? "Borrowing Friend's Name" : "Lender's Name"}
                  </ThemedText>
                  <TextInput
                    style={[
                      themedStyles.merchantInput,
                      { color: colors.primary, borderBottomColor: colors.border },
                    ]}
                    placeholder="Enter name"
                    placeholderTextColor={colors.muted}
                    value={loanPersonName}
                    onChangeText={(v) => {
                      setLoanPersonName(v);
                      setMerchant(v);
                      setNotes(
                        selectedLoan === -1
                          ? `New loan lending to ${v}`
                          : `New loan borrowed from ${v}`
                      );
                    }}
                    maxLength={100}
                  />
                </View>
              )}
            </View>

            {/* Split Expense Inline Section */}
            {type === "debit" && (
              <View
                style={[
                  themedStyles.field,
                  {
                    backgroundColor: colors.surface,
                    borderRadius: 16,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: splitEnabled
                      ? `${colors.accent}50`
                      : colors.border,
                    marginBottom: 24,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: splitEnabled ? 16 : 0,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <LucideUsers
                      color={splitEnabled ? colors.accent : colors.secondary}
                      size={20}
                    />
                    <View>
                      <ThemedText style={{ fontWeight: "bold", fontSize: 15 }}>
                        Split this Expense
                      </ThemedText>
                      <ThemedText type="secondary" className="text-xs">
                        Split bill with friends
                      </ThemedText>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setSplitEnabled((v) => !v);
                      Haptics.selectionAsync();
                    }}
                  >
                    {splitEnabled ? (
                      <LucideToggleRight color={colors.accent} size={32} />
                    ) : (
                      <LucideToggleLeft color={colors.muted} size={32} />
                    )}
                  </TouchableOpacity>
                </View>

                {splitEnabled && (
                  <MotiView
                    from={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    transition={{ type: "timing", duration: 200 }}
                    style={{ overflow: "hidden" }}
                  >
                    {/* Repayment account selector */}
                    <View style={{ marginBottom: 16, marginTop: 12 }}>
                      <ThemedText
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: colors.secondary,
                          textTransform: "uppercase",
                          letterSpacing: 0.8,
                          marginBottom: 8,
                        }}
                      >
                        Collect Repayments To
                      </ThemedText>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 8 }}
                      >
                        {accounts.map((acc) => (
                          <TouchableOpacity
                            key={`repay-to-${acc.id}`}
                            onPress={() => setReceiveToAccountId(acc.id)}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 99,
                              borderWidth: 1.5,
                              backgroundColor:
                                receiveToAccountId === acc.id
                                  ? `${colors.accent}18`
                                  : "transparent",
                              borderColor:
                                receiveToAccountId === acc.id
                                  ? colors.accent
                                  : colors.border,
                            }}
                          >
                            <LucideWallet
                              color={
                                receiveToAccountId === acc.id
                                  ? colors.accent
                                  : colors.secondary
                              }
                              size={13}
                            />
                            <ThemedText
                              style={{
                                fontSize: 13,
                                fontWeight: "600",
                                color:
                                  receiveToAccountId === acc.id
                                    ? colors.accent
                                    : colors.primary,
                              }}
                            >
                              {acc.name}
                            </ThemedText>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>

                    {/* Split equally toggle */}
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 16,
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: colors.translucent,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <View>
                        <ThemedText style={{ fontSize: 13, fontWeight: "600" }}>
                          Split equally
                        </ThemedText>
                        <ThemedText
                          style={{
                            fontSize: 11,
                            color: colors.secondary,
                            marginTop: 2,
                          }}
                        >
                          Auto-divide including you
                        </ThemedText>
                      </View>
                      <TouchableOpacity
                        onPress={() => {
                          setSplitEqually((v) => !v);
                          Haptics.selectionAsync();
                        }}
                      >
                        {splitEqually ? (
                          <LucideToggleRight color={colors.accent} size={28} />
                        ) : (
                          <LucideToggleLeft color={colors.muted} size={28} />
                        )}
                      </TouchableOpacity>
                    </View>

                    {/* Members title & Add button */}
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 12,
                      }}
                    >
                      <ThemedText
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: colors.secondary,
                          textTransform: "uppercase",
                          letterSpacing: 0.8,
                        }}
                      >
                        Split with
                      </ThemedText>
                      <TouchableOpacity
                        onPress={addSplitMember}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 99,
                          backgroundColor: `${colors.accent}18`,
                        }}
                      >
                        <LucidePlus color={colors.accent} size={12} />
                        <ThemedText
                          style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: colors.accent,
                          }}
                        >
                          Add person
                        </ThemedText>
                      </TouchableOpacity>
                    </View>

                    {/* Me row (read-only) */}
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 10,
                        padding: 12,
                        borderRadius: 12,
                        backgroundColor: `${colors.accent}10`,
                        borderWidth: 1,
                        borderColor: `${colors.accent}30`,
                      }}
                    >
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: `${colors.accent}20`,
                        }}
                      >
                        <ThemedText
                          style={{
                            fontSize: 12,
                            fontWeight: "800",
                            color: colors.accent,
                          }}
                        >
                          Me
                        </ThemedText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText
                          style={{
                            fontSize: 13,
                            fontWeight: "600",
                            color: colors.accent,
                          }}
                        >
                          You (paid full bill)
                        </ThemedText>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <ThemedText
                          style={{
                            fontSize: 14,
                            fontWeight: "700",
                            color: colors.accent,
                          }}
                        >
                          {preferences.currency}
                          {myShare > 0 ? myShare.toFixed(2) : "—"}
                        </ThemedText>
                      </View>
                    </View>

                    {/* Member rows */}
                    {splitMembers.map((m, idx) => (
                      <View
                        key={m.key}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <View
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: colors.translucent,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <ThemedText
                            style={{
                              fontSize: 12,
                              fontWeight: "700",
                              color: colors.secondary,
                            }}
                          >
                            {idx + 1}
                          </ThemedText>
                        </View>
                        <TextInput
                          value={m.name}
                          onChangeText={(v) =>
                            updateSplitMember(m.key, "name", v)
                          }
                          placeholder="Name"
                          placeholderTextColor={colors.muted}
                          style={{
                            flex: 1,
                            padding: 10,
                            borderRadius: 10,
                            borderWidth: 1,
                            borderColor: colors.border,
                            color: colors.primary,
                            backgroundColor: colors.surface,
                            fontSize: 14,
                          }}
                        />
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            borderWidth: 1,
                            borderColor: colors.border,
                            borderRadius: 10,
                            backgroundColor: colors.surface,
                            paddingHorizontal: 8,
                          }}
                        >
                          <ThemedText
                            style={{ fontSize: 13, color: colors.secondary }}
                          >
                            {preferences.currency}
                          </ThemedText>
                          <TextInput
                            value={m.share}
                            onChangeText={(v) =>
                              !splitEqually &&
                              updateSplitMember(m.key, "share", v)
                            }
                            editable={!splitEqually}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={colors.muted}
                            style={{
                              width: 60,
                              padding: 10,
                              fontSize: 14,
                              fontWeight: "600",
                              color: splitEqually
                                ? colors.secondary
                                : colors.primary,
                            }}
                          />
                        </View>
                        {splitMembers.length > 1 && (
                          <TouchableOpacity
                            onPress={() => removeSplitMember(m.key)}
                            style={{ padding: 4 }}
                          >
                            <LucideTrash2 color={colors.danger} size={16} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </MotiView>
                )}
              </View>
            )}

            {/* 7. Recurring */}
            <View
              style={[
                themedStyles.field,
                {
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 26,
                },
              ]}
            >
              <View>
                <ThemedText
                  type="secondary"
                  style={[themedStyles.label, { marginBottom: 4 }]}
                >
                  Recurring Bill
                </ThemedText>
                <ThemedText type="secondary" className="text-xs">
                  Check if this repeats monthly
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => setIsRecurring(!isRecurring)}
                style={{
                  width: 50,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: isRecurring ? colors.success : colors.muted,
                  justifyContent: "center",
                  paddingHorizontal: 2,
                }}
              >
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    backgroundColor: "#FFFFFF",
                    transform: [{ translateX: isRecurring ? 20 : 0 }],
                  }}
                />
              </TouchableOpacity>
            </View>

            {/* 8. Notes */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                Notes (optional)
              </ThemedText>
              <TextInput
                style={[
                  themedStyles.notesInput,
                  { color: colors.primary, borderBottomColor: colors.border },
                ]}
                placeholder="Add a note..."
                placeholderTextColor={colors.muted}
                value={notes}
                onChangeText={setNotes}
                maxLength={200}
              />
            </View>

            {/* 9. Tags */}
            <View style={themedStyles.field}>
              <ThemedText type="secondary" style={themedStyles.label}>
                Tags (optional)
              </ThemedText>
              <TagInput tags={tags} onChangeTags={setTags} />
            </View>
          </ScrollView>

          {/* Sticky Save Button */}
          <View
            style={[themedStyles.footer, { borderTopColor: colors.border }]}
          >
            <TouchableOpacity
              style={[
                themedStyles.saveButton,
                { backgroundColor: colors.accent },
                (!isValid || saving) && { opacity: 0.5 },
              ]}
              onPress={handleSave}
              disabled={!isValid || saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <LucideCheck color="#FFFFFF" size={22} />
                  <ThemedText
                    className="font-bold text-lg ml-2"
                    style={{ color: "#FFFFFF" }}
                  >
                    Save Transaction
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

const createThemedStyles = (colors: any, isDark: boolean) =>
  StyleSheet.create({
    content: { padding: 24, flex: 1 },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 24,
    },
    typeToggle: {
      flexDirection: "row",
      borderRadius: 50,
      padding: 4,
      marginBottom: 24,
    },
    typeBtn: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 50,
      alignItems: "center",
    },
    field: { marginBottom: 24 },
    label: {
      fontSize: 11,
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontWeight: "bold",
    },
    amountInput: {
      fontSize: 40,
      fontWeight: "bold",
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: "transparent",
    },
    merchantInput: {
      fontSize: 18,
      borderBottomWidth: 1,
      paddingVertical: 12,
      fontWeight: "500",
    },
    notesInput: { fontSize: 15, borderBottomWidth: 1, paddingVertical: 10 },
    categorySquare: {
      width: 80,
      height: 80,
      borderRadius: 16,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center",
      padding: 8,
    },
    squareIconWrap: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    },
    categorySelector: {
      height: 60,
      borderRadius: 16,
      borderWidth: 1.5,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
    },
    selectedIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    categoryItem: {
      borderRadius: 16,
      padding: 12,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1.5,
    },
    subcategoryItem: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      marginRight: 8,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
    },
    emojiCircle: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    saveButton: {
      height: 60,
      borderRadius: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    },
    footer: { padding: 20, borderTopWidth: 1 },
    dateRow: {
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: 1,
      paddingVertical: 12,
      gap: 10,
    },
    pill: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      marginRight: 8,
    },
    iosPickerContainer: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      overflow: "hidden",
      marginTop: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    iosPickerDone: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      padding: 12,
      alignItems: "center",
    },
  });

export default AddTransactionScreen;
