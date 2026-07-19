import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  RefreshControl,
  Modal,
  Pressable,
  KeyboardAvoidingView,
} from "react-native";
import {
  GestureHandlerRootView,
  ScrollView as GHScrollView,
} from "react-native-gesture-handler";
import {
  LucideSearch,
  LucideX,
  LucideSlidersHorizontal,
  LucideRepeat,
  LucideSmartphone,
  LucidePenLine,
  LucideZap,
  LucideRadio,
} from "lucide-react-native";
import { FlashList } from "@shopify/flash-list";
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useStore } from "../store/useStore";
import {
  getTransactions,
  getCategories,
  getAccounts,
  getAllUniqueTags,
  Transaction,
  Category,
  Account,
} from "../services/database";
import { useTheme } from "../theme/ThemeProvider";
import {
  ScreenHeader,
  HeaderIconButton,
  Segmented,
  SignalRow,
  GroupLabel,
  PillButton,
  StatBlock,
  EmptyState,
  SheetHandle,
  PrimaryButton,
  FieldLabel,
  TextField,
} from "../components/Kit";
import { AmountText, PulseDot, SectionLabel } from "../components/Signal";
import { fonts } from "../theme/tokens";

// ─── Types ───────────────────────────────────────────────────────────────────

type SortOption = "newest" | "oldest" | "highest" | "lowest";
type DatePreset = "today" | "week" | "month" | "last_month" | "all" | "custom";
type SourceFilter = "all" | "sms" | "manual" | "auto";

interface Filters {
  type: "all" | "debit" | "credit" | "transfer";
  // Multi-select category filter. `categoryNames` are exact matches (typically
  // subcategories); `categoryGroups` are parent-inclusive (parent + all its
  // subcategories). A transaction matching either set passes.
  categoryNames: string[];
  categoryGroups: string[];
  tagValue: string | null;
  accountId: number | null;
  datePreset: DatePreset;
  customStart: string;
  customEnd: string;
  minAmount: string;
  maxAmount: string;
  source: SourceFilter;
  recurring: boolean;
  sort: SortOption;
}

const DEFAULT_FILTERS: Filters = {
  type: "all",
  categoryNames: [],
  categoryGroups: [],
  tagValue: null,
  accountId: null,
  datePreset: "all",
  customStart: new Date().toISOString().split("T")[0],
  customEnd: new Date().toISOString().split("T")[0],
  minAmount: "",
  maxAmount: "",
  source: "all",
  recurring: false,
  sort: "newest",
};

const PAGE_SIZE = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getDateRange = (
  preset: DatePreset,
  customStart: string,
  customEnd: string,
) => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (preset) {
    case "today":
      return { startDate: fmt(now), endDate: fmt(now) };
    case "week": {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { startDate: fmt(start), endDate: fmt(now) };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(now) };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: fmt(start), endDate: fmt(end) };
    }
    case "custom":
      return {
        startDate: customStart || undefined,
        endDate: customEnd || undefined,
      };
    default:
      return { startDate: undefined, endDate: undefined };
  }
};

const countActiveFilters = (f: Filters): number => {
  let count = 0;
  if (f.type !== "all") count++;
  count += f.categoryNames.length + f.categoryGroups.length;
  if (f.tagValue) count++;
  if (f.accountId) count++;
  if (f.datePreset !== "all") count++;
  if (f.minAmount || f.maxAmount) count++;
  if (f.source !== "all") count++;
  if (f.recurring) count++;
  return count;
};

const fmtShortMoney = (n: number, currency = "₹") => {
  if (n >= 100000) return `${currency}${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${currency}${(n / 1000).toFixed(1)}k`;
  return `${currency}${Math.round(n).toLocaleString("en-IN")}`;
};

/** Mono timeline group label: TODAY / YESTERDAY / MON 8 JUL */
const dayLabel = (dateStr: string) => {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const timeOnly = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

// ─── TransactionsScreen ───────────────────────────────────────────────────────

const TransactionsScreen = () => {
  const { colors } = useTheme();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? "₹";
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const canGoBack = navigation.canGoBack();

  const presetAccountId: number | undefined = route.params?.presetAccountId;
  const presetCategory: string | undefined = route.params?.presetCategory;
  const presetCategoryGroup: string | undefined =
    route.params?.presetCategoryGroup;
  // Multi-group preset (e.g. a multi-category budget drill-down)
  const presetCategoryGroups: string[] | undefined =
    route.params?.presetCategoryGroups;
  const presetSearch: string | undefined = route.params?.presetSearch;
  // Date window to pair with a preset (e.g. Analytics drill-downs are scoped
  // to "this month" data, so the filter should land on the same window).
  const presetDatePreset: DatePreset | undefined = route.params?.presetDatePreset;

  // ── State ────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState(presetSearch ?? "");
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    ...(presetAccountId ? { accountId: presetAccountId } : null),
    ...(presetCategory ? { categoryNames: [presetCategory] } : null),
    ...(presetCategoryGroup ? { categoryGroups: [presetCategoryGroup] } : null),
    ...(presetCategoryGroups?.length
      ? { categoryGroups: presetCategoryGroups }
      : null),
    ...(presetDatePreset ? { datePreset: presetDatePreset } : null),
  }));
  const [showFilters, setShowFilters] = useState(false);
  // One sheet-local search that narrows the account / category / tag pill
  // lists together. Cleared whenever the sheet closes.
  const [filterSearch, setFilterSearch] = useState("");
  useEffect(() => {
    if (!showFilters) setFilterSearch("");
  }, [showFilters]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Use a ref for the current page offset so loadMore never captures a stale value
  // from a closure, which was causing duplicate pages to load.
  const offsetRef = useRef(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [tagsList, setTagsList] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Apply preset filters when navigated with params (e.g. drill-down from
  // Analytics: a tapped category or merchant). Params are consumed once and then
  // cleared so returning to this tab later doesn't re-pin a stale filter.
  useEffect(() => {
    if (
      !presetAccountId &&
      !presetCategory &&
      !presetCategoryGroup &&
      !presetCategoryGroups?.length &&
      !presetDatePreset &&
      presetSearch === undefined
    )
      return;
    if (presetAccountId) {
      setFilters((f) => ({ ...f, accountId: presetAccountId }));
    }
    if (presetCategory) {
      setFilters((f) => ({ ...f, categoryNames: [presetCategory], categoryGroups: [] }));
    }
    if (presetCategoryGroup) {
      setFilters((f) => ({ ...f, categoryGroups: [presetCategoryGroup], categoryNames: [] }));
    }
    if (presetCategoryGroups?.length) {
      setFilters((f) => ({ ...f, categoryGroups: presetCategoryGroups, categoryNames: [] }));
    }
    if (presetDatePreset) {
      setFilters((f) => ({ ...f, datePreset: presetDatePreset }));
    }
    if (presetSearch !== undefined) {
      setSearch(presetSearch);
    }
    navigation.setParams({
      presetAccountId: undefined,
      presetCategory: undefined,
      presetCategoryGroup: undefined,
      presetCategoryGroups: undefined,
      presetDatePreset: undefined,
      presetSearch: undefined,
    });
  }, [
    presetAccountId,
    presetCategory,
    presetCategoryGroup,
    presetCategoryGroups,
    presetDatePreset,
    presetSearch,
    navigation,
  ]);

  // ── Load metadata ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (isFocused) {
      Promise.all([getCategories(), getAccounts(), getAllUniqueTags()]).then(
        ([cats, accs, tgs]) => {
          setCategories(cats); // show all including subcategories
          setAccounts(accs);
          setTagsList(tgs);
        },
      );
    }
  }, [isFocused]);

  // ── Build query opts ──────────────────────────────────────────────────────
  const buildQueryOpts = useCallback(
    (currentOffset: number, searchStr: string, f: Filters) => {
      const { startDate, endDate } = getDateRange(
        f.datePreset,
        f.customStart,
        f.customEnd,
      );
      return {
        limit: PAGE_SIZE,
        offset: currentOffset,
        search: searchStr.trim() || undefined,
        type:
          f.type !== "all"
            ? (f.type as "credit" | "debit" | "transfer")
            : undefined,
        categories: f.categoryNames.length > 0 ? f.categoryNames : undefined,
        categoryGroups:
          f.categoryGroups.length > 0 ? f.categoryGroups : undefined,
        tag: f.tagValue ?? undefined,
        minAmount: f.minAmount ? parseFloat(f.minAmount) : undefined,
        maxAmount: f.maxAmount ? parseFloat(f.maxAmount) : undefined,
        startDate,
        endDate,
        isRecurring: f.recurring ? true : undefined,
        confirmedOnly: true, // Only show confirmed transactions on this screen
        accountId: f.accountId ?? undefined,
      };
    },
    [],
  );

  // ── Client-side filters (source, sort) ────────────────────────────────────
  const applyClientFilters = useCallback(
    (raw: Transaction[], f: Filters): Transaction[] => {
      let result = raw;
      if (f.source !== "all") {
        result = result.filter((t) => t.source === f.source);
      }
      if (f.sort === "oldest") {
        result = [...result].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      } else if (f.sort === "highest") {
        result = [...result].sort((a, b) => b.amount - a.amount);
      } else if (f.sort === "lowest") {
        result = [...result].sort((a, b) => a.amount - b.amount);
      }
      // 'newest' is default (DB returns DESC)
      return result;
    },
    [],
  );

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchTransactions = useCallback(
    async (searchStr: string, f: Filters, reset = true) => {
      if (reset) {
        setLoading(true);
        offsetRef.current = 0;
        setHasMore(true);
      } else {
        setLoadingMore(true);
      }

      // Read offset directly from ref — never stale, no closure capture needed.
      const currentOffset = offsetRef.current;
      const opts = buildQueryOpts(currentOffset, searchStr, f);
      const raw = await getTransactions(opts);
      const filtered = applyClientFilters(raw, f);

      if (reset) {
        setTransactions(filtered);
        offsetRef.current = PAGE_SIZE;
      } else {
        setTransactions((prev) => [...prev, ...filtered]);
        offsetRef.current = currentOffset + PAGE_SIZE;
      }

      setHasMore(raw.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    },
    [buildQueryOpts, applyClientFilters],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await fetchTransactions(search, filters, true);
    setRefreshing(false);
  }, [search, filters, fetchTransactions]);

  // ── Consolidated Fetching Logic ──────────────────────────────────────────
  // Use a ref to prevent double-firing on initial mount/focus or simultaneous updates
  const lastFetchRef = useRef<string>("");

  useEffect(() => {
    if (!isFocused) return;

    const currentParams = JSON.stringify({ search, filters });
    if (currentParams === lastFetchRef.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    // If it's the very first load, we can fire immediately.
    // Otherwise debounce to catch rapid typing or filter changes.
    const isFirstTime = lastFetchRef.current === "";

    debounceRef.current = setTimeout(
      () => {
        lastFetchRef.current = currentParams;
        fetchTransactions(search, filters, true);
      },
      isFirstTime ? 0 : 350,
    );

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isFocused, search, filters, fetchTransactions]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let expenses = 0;
    let income = 0;

    transactions.forEach((t) => {
      if (t.type === "debit") {
        expenses += t.amount;
      } else if (t.type === "credit") {
        income += t.amount;
      } else if (t.type === "transfer") {
        // If we are looking at a specific account, classify transfer as income/expense
        if (filters.accountId) {
          if (t.toAccountId === filters.accountId) {
            income += t.amount;
          } else if (t.accountId === filters.accountId) {
            expenses += t.amount;
          }
        }
        // If we are looking at all accounts, transfers are neutral (ignore for stats)
      }
    });

    return { count: transactions.length, expenses, income };
  }, [transactions, filters.accountId]);

  // ── Open detail ───────────────────────────────────────────────────────────
  const openDetail = (tx: Transaction) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("TransactionDetail", { transaction: tx });
  };

  const activeFilterCount = countActiveFilters(filters);

  // Memoize category lookup map to avoid O(n) find on every transaction row render
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.name, c])),
    [categories],
  );

  // Parent → children tree for the grouped category filter
  const categoryTree = useMemo(() => {
    const kids = new Map<number, Category[]>();
    categories.forEach((c) => {
      if (c.parentId) {
        kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c]);
      }
    });
    return categories
      .filter((c) => !c.parentId)
      .map((p) => ({ parent: p, children: kids.get(p.id) ?? [] }));
  }, [categories]);

  // ── Sheet search results ──────────────────────────────────────────────────
  // `shown` is what the query matched; `children` stays complete so the group
  // toggle / exclude-one logic always operates on the full membership.
  const filterQuery = filterSearch.trim().toLowerCase();
  const searchingFilters = filterQuery.length > 0;

  const visibleCategoryTree = useMemo(() => {
    const base = categoryTree.map((g) => ({ ...g, shown: g.children }));
    if (!filterQuery) return base;
    return base
      .map((g) => {
        if (g.parent.name.toLowerCase().includes(filterQuery)) return g;
        const shown = g.children.filter((c) =>
          c.name.toLowerCase().includes(filterQuery),
        );
        return shown.length > 0 ? { ...g, shown } : null;
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  }, [categoryTree, filterQuery]);

  const visibleAccounts = useMemo(
    () =>
      filterQuery
        ? accounts.filter((a) => a.name.toLowerCase().includes(filterQuery))
        : accounts,
    [accounts, filterQuery],
  );

  const visibleTags = useMemo(
    () =>
      filterQuery
        ? tagsList.filter((t) => t.toLowerCase().includes(filterQuery))
        : tagsList,
    [tagsList, filterQuery],
  );

  const toggleCategoryGroup = (parent: Category, children: Category[]) => {
    setFilters((f) => {
      if (f.categoryGroups.includes(parent.name)) {
        return {
          ...f,
          categoryGroups: f.categoryGroups.filter((g) => g !== parent.name),
        };
      }
      // Selecting the whole group absorbs any individually-selected members
      const members = new Set([parent.name, ...children.map((c) => c.name)]);
      return {
        ...f,
        categoryGroups: [...f.categoryGroups, parent.name],
        categoryNames: f.categoryNames.filter((n) => !members.has(n)),
      };
    });
  };

  const toggleCategoryName = (
    cat: Category,
    parent?: Category,
    siblings: Category[] = [],
  ) => {
    setFilters((f) => {
      if (parent && f.categoryGroups.includes(parent.name)) {
        // Whole group is on: tapping one member excludes just that one — the
        // group degrades to explicit picks of every other member.
        const rest = [parent.name, ...siblings.map((c) => c.name)].filter(
          (n) => n !== cat.name,
        );
        return {
          ...f,
          categoryGroups: f.categoryGroups.filter((g) => g !== parent.name),
          categoryNames: [...new Set([...f.categoryNames, ...rest])],
        };
      }
      return {
        ...f,
        categoryNames: f.categoryNames.includes(cat.name)
          ? f.categoryNames.filter((n) => n !== cat.name)
          : [...f.categoryNames, cat.name],
      };
    });
  };

  // O(1) account name lookup — accounts are already loaded for the filter UI
  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  // Active-filter chips shown on the main screen — tap one to clear just it.
  const filterChips = useMemo(() => {
    const chips: {
      key: string;
      label: string;
      color?: string;
      onClear: () => void;
    }[] = [];
    const dateLabels: Record<DatePreset, string> = {
      all: "",
      today: "Today",
      week: "7 days",
      month: "This month",
      last_month: "Last month",
      custom: `${filters.customStart} → ${filters.customEnd}`,
    };
    filters.categoryGroups.forEach((g) =>
      chips.push({
        key: `grp-${g}`,
        label: `${g} · all`,
        color: categoryMap.get(g)?.color,
        onClear: () =>
          setFilters((f) => ({
            ...f,
            categoryGroups: f.categoryGroups.filter((x) => x !== g),
          })),
      }),
    );
    filters.categoryNames.forEach((n) =>
      chips.push({
        key: `cat-${n}`,
        label: n,
        color: categoryMap.get(n)?.color,
        onClear: () =>
          setFilters((f) => ({
            ...f,
            categoryNames: f.categoryNames.filter((x) => x !== n),
          })),
      }),
    );
    if (filters.tagValue) {
      chips.push({
        key: "tag",
        label: `#${filters.tagValue}`,
        color: colors.ai,
        onClear: () => setFilters((f) => ({ ...f, tagValue: null })),
      });
    }
    if (filters.accountId) {
      chips.push({
        key: "acct",
        label: accountMap.get(filters.accountId) ?? "Account",
        onClear: () => setFilters((f) => ({ ...f, accountId: null })),
      });
    }
    if (filters.datePreset !== "all") {
      chips.push({
        key: "date",
        label: dateLabels[filters.datePreset],
        onClear: () => setFilters((f) => ({ ...f, datePreset: "all" })),
      });
    }
    if (filters.minAmount || filters.maxAmount) {
      chips.push({
        key: "amt",
        label: `${currency}${filters.minAmount || "0"}–${filters.maxAmount || "∞"}`,
        onClear: () =>
          setFilters((f) => ({ ...f, minAmount: "", maxAmount: "" })),
      });
    }
    if (filters.source !== "all") {
      chips.push({
        key: "src",
        label: filters.source.toUpperCase(),
        onClear: () => setFilters((f) => ({ ...f, source: "all" })),
      });
    }
    if (filters.recurring) {
      chips.push({
        key: "rec",
        label: "Recurring",
        color: colors.ai,
        onClear: () => setFilters((f) => ({ ...f, recurring: false })),
      });
    }
    return chips;
  }, [filters, categoryMap, accountMap, colors.ai, currency]);

  // Returns a formatted account label string (with leading " · ") or empty string
  const getAccountLabel = (item: Transaction): string => {
    if (item.type === "transfer") {
      const from =
        item.accountId != null ? accountMap.get(item.accountId) : undefined;
      const to =
        item.toAccountId != null ? accountMap.get(item.toAccountId) : undefined;
      const parts = [from, to].filter((v): v is string => !!v);
      return parts.length > 0 ? ` · ${parts.join(" → ")}` : "";
    }
    if (item.accountId != null) {
      const name = accountMap.get(item.accountId);
      return name ? ` · ${name}` : "";
    }
    return "";
  };

  // ── Signal semantics per row ──────────────────────────────────────────────
  const amountKind = (item: Transaction): "debit" | "credit" | "transfer" => {
    if (item.type === "credit") return "credit";
    if (item.type === "transfer") {
      if (filters.accountId && item.toAccountId === filters.accountId)
        return "credit";
      if (filters.accountId && item.accountId === filters.accountId)
        return "debit";
      return "transfer";
    }
    return "debit";
  };

  const sourceGlyph = (source?: string) => {
    if (source === "sms")
      return <LucideSmartphone color={colors.muted} size={11} />;
    if (source === "manual")
      return <LucidePenLine color={colors.muted} size={11} />;
    if (source === "auto") return <LucideZap color={colors.muted} size={11} />;
    return null;
  };

  // Date grouping only makes sense in chronological sorts
  const grouped = filters.sort === "newest" || filters.sort === "oldest";

  // Flatten headers + rows into one heterogeneous list. Each FlashList cell then
  // renders a single element (a header OR a row) — never a wrapper containing
  // both — which is what FlashList v2's auto-measurement needs to size cells
  // correctly. Wrapping a header and a row in one <View> was throwing off the
  // measurement and causing the rows to render misaligned/overlapping.
  type ListRow =
    | { kind: "header"; id: string; label: string }
    | { kind: "tx"; id: string; tx: Transaction };

  const listData = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    let lastLabel = "";
    transactions.forEach((tx) => {
      if (grouped) {
        const label = dayLabel(tx.date);
        if (label !== lastLabel) {
          out.push({ kind: "header", id: `h-${label}`, label });
          lastLabel = label;
        }
      }
      out.push({ kind: "tx", id: `t-${tx.id}`, tx });
    });
    return out;
  }, [transactions, grouped]);

  // ─── Timeline row ─────────────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListRow }) => {
    if (item.kind === "header") {
      return <GroupLabel label={item.label} />;
    }
    const tx = item.tx;
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
        emoji={cat?.icon ?? "📁"}
        iconColor={cat?.color || colors.secondary}
        title={tx.merchant}
        subtitle={`${timeOnly(tx.date)} · ${tx.category}${getAccountLabel(tx)}${tx.tags && tx.tags.length > 0 ? ` · ${tx.tags.map((t: string) => "#" + t).join(" ")}` : ""}`}
        nodeColor={nodeColor}
        badges={
          <>
            {sourceGlyph(tx.source)}
            {tx.isRecurring ? (
              <LucideRepeat color={colors.ai} size={11} />
            ) : null}
            {!tx.isConfirmed ? <PulseDot size={6} /> : null}
          </>
        }
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
        onPress={() => openDetail(tx)}
        rail={false}
      />
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────

  return (
    <ThemedSafeAreaView edges={["top", "bottom"]}>
      <ScreenHeader
        eyebrow="Ledger"
        title="Transactions"
        onBack={canGoBack ? () => navigation.goBack() : undefined}
        right={
          <HeaderIconButton
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowFilters(true);
            }}
            tint={activeFilterCount > 0 ? colors.accent : undefined}
          >
            <LucideSlidersHorizontal
              color={activeFilterCount > 0 ? colors.accent : colors.secondary}
              size={17}
            />
            {activeFilterCount > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: -3,
                  right: -3,
                  backgroundColor: colors.accent,
                  borderRadius: 99,
                  minWidth: 15,
                  height: 15,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 3,
                }}
              >
                <ThemedText
                  font="signal"
                  style={{ fontSize: 8, color: colors.background }}
                >
                  {activeFilterCount}
                </ThemedText>
              </View>
            )}
          </HeaderIconButton>
        }
      />

      {/* ── Search ── */}
      <View style={{ paddingHorizontal: 24, marginBottom: 10 }}>
        <TextField
          placeholder="Search merchants, categories, #tags…"
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          leading={<LucideSearch color={colors.muted} size={16} />}
          trailing={
            search.length > 0 ? (
              <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                <LucideX color={colors.muted} size={15} />
              </TouchableOpacity>
            ) : undefined
          }
        />
      </View>

      {/* ── Type segmented (underline style) ── */}
      <Segmented
        value={filters.type}
        onChange={(t) => setFilters((f) => ({ ...f, type: t }))}
        options={[
          { key: "all", label: "All" },
          { key: "debit", label: "Out", color: colors.debit },
          { key: "credit", label: "In", color: colors.credit },
          { key: "transfer", label: "Moves", color: colors.secondary },
        ]}
      />

      {/* ── Totals strip ── */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 24,
          paddingVertical: 14,
          gap: 24,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <StatBlock
          label="Signals"
          value={`${stats.count}${hasMore ? "+" : ""}`}
          style={{ flex: 1 }}
        />
        <StatBlock
          label="Out"
          value={
            preferences.hideAmounts
              ? "••••"
              : `−${fmtShortMoney(stats.expenses, currency)}`
          }
          color={colors.debit}
          style={{ flex: 1 }}
        />
        <StatBlock
          label="In"
          value={
            preferences.hideAmounts
              ? "••••"
              : `+${fmtShortMoney(stats.income, currency)}`
          }
          color={colors.credit}
          style={{ flex: 1 }}
        />
      </View>

      {/* ── Active filter chips ── */}
      {filterChips.length > 0 && (
        <View
          style={{
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            paddingVertical: 10,
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}
          >
            {filterChips.map((chip) => (
              <PillButton
                key={chip.key}
                label={chip.label}
                color={chip.color}
                active
                icon={
                  <LucideX color={chip.color ?? colors.accent} size={11} />
                }
                onPress={chip.onClear}
              />
            ))}
            {filterChips.length > 1 && (
              <PillButton
                label="Clear all"
                color={colors.danger}
                onPress={() => setFilters(DEFAULT_FILTERS)}
              />
            )}
          </ScrollView>
        </View>
      )}

      {/* ── Timeline list ── */}
      {loading && !refreshing ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      ) : (
        <FlashList
          data={listData}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          getItemType={(item) => item.kind}
          extraData={`${filters.accountId}-${filters.sort}-${preferences.hideAmounts}`}
          // FlashList v2 turns maintainVisibleContentPosition ON by default (a
          // chat-style scroll anchor). This is a top→bottom paginated ledger, not
          // a chat, so the anchoring fights v2's on-the-fly cell re-measurement:
          // after a fast fling down + scroll back up it shifts/blanks the top
          // rows. Disable it so cells position by simple offset again.
          maintainVisibleContentPosition={{ disabled: true }}
          // Render further beyond the viewport so fast flings don't outrun the
          // recycler and momentarily reveal unrendered (blank) cells.
          drawDistance={500}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: 32 }}
          onEndReached={() => {
            if (hasMore && !loadingMore && !loading) {
              fetchTransactions(search, filters, false);
            }
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon={<LucideRadio color={colors.muted} size={44} />}
              title="No signals here"
              subtitle={
                search.length > 0 || activeFilterCount > 0
                  ? "Nothing matches this search or filter set. Try widening the net."
                  : "Confirmed transactions will appear on this timeline."
              }
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                color={colors.accent}
                style={{ marginVertical: 16 }}
              />
            ) : hasMore && transactions.length > 0 ? (
              <TouchableOpacity
                onPress={() => fetchTransactions(search, filters, false)}
                style={{ alignItems: "center", paddingVertical: 16 }}
              >
                <SectionLabel color={colors.accent}>Load more ↓</SectionLabel>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {/* ── Filter sheet ── */}
      <Modal
        visible={showFilters}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilters(false)}
      >
        {/* Modal renders outside the root GestureHandlerRootView; re-establish one
            so the ScrollView scrolls over its pressable filter rows (RNGH fix). */}
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Pressable
            style={{
              flex: 1,
              backgroundColor: "rgba(4,10,11,0.6)",
              justifyContent: "flex-end",
            }}
            onPress={() => setShowFilters(false)}
          >
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              style={{ maxHeight: "85%" }}
            >
              <Pressable
                onPress={(e) => e.stopPropagation()}
                style={{
                  backgroundColor: colors.background,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  borderWidth: 1,
                  borderColor: colors.border,
                  maxHeight: "100%",
                }}
              >
                <SheetHandle
                  title="Tune the signal"
                  onClose={() => setShowFilters(false)}
                  right={
                    activeFilterCount > 0 ? (
                      <TouchableOpacity
                        onPress={() => {
                          Haptics.notificationAsync(
                            Haptics.NotificationFeedbackType.Warning,
                          );
                          setFilters(DEFAULT_FILTERS);
                        }}
                      >
                        <SectionLabel color={colors.danger}>Reset</SectionLabel>
                      </TouchableOpacity>
                    ) : undefined
                  }
                />

                {/* One search across accounts, categories and tags */}
                <View style={{ paddingHorizontal: 24, marginTop: 4 }}>
                  <TextField
                    placeholder="Find account, category or #tag…"
                    value={filterSearch}
                    onChangeText={setFilterSearch}
                    autoCorrect={false}
                    leading={<LucideSearch color={colors.muted} size={15} />}
                    trailing={
                      filterSearch.length > 0 ? (
                        <TouchableOpacity
                          onPress={() => setFilterSearch("")}
                          hitSlop={8}
                        >
                          <LucideX color={colors.muted} size={14} />
                        </TouchableOpacity>
                      ) : undefined
                    }
                  />
                </View>

                <GHScrollView
                  // Let the first tap land on a pill even while the search
                  // keyboard is open (default "never" swallows it to dismiss).
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 24,
                    paddingBottom: 24,
                  }}
                >
                  {/* Static controls step aside while searching so matches
                      from the lists below are immediately visible. */}
                  {!searchingFilters && (
                    <>
                  {/* Date presets */}
                  <FieldLabel style={{ marginTop: 14 }}>Window</FieldLabel>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {(
                      [
                        { id: "all", label: "All time" },
                        { id: "today", label: "Today" },
                        { id: "week", label: "7 days" },
                        { id: "month", label: "This month" },
                        { id: "last_month", label: "Last month" },
                        { id: "custom", label: "Custom" },
                      ] as { id: DatePreset; label: string }[]
                    ).map((item) => (
                      <PillButton
                        key={item.id}
                        label={item.label}
                        active={filters.datePreset === item.id}
                        onPress={() =>
                          setFilters((f) => ({ ...f, datePreset: item.id }))
                        }
                      />
                    ))}
                  </View>

                  {filters.datePreset === "custom" && (
                    <View
                      style={{ flexDirection: "row", gap: 10, marginTop: 12 }}
                    >
                      <View style={{ flex: 1 }}>
                        <FieldLabel>From</FieldLabel>
                        <TextField
                          placeholder="YYYY-MM-DD"
                          value={filters.customStart}
                          onChangeText={(v) =>
                            setFilters((f) => ({ ...f, customStart: v }))
                          }
                          style={{ fontFamily: fonts.signal, fontSize: 13 }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <FieldLabel>To</FieldLabel>
                        <TextField
                          placeholder="YYYY-MM-DD"
                          value={filters.customEnd}
                          onChangeText={(v) =>
                            setFilters((f) => ({ ...f, customEnd: v }))
                          }
                          style={{ fontFamily: fonts.signal, fontSize: 13 }}
                        />
                      </View>
                    </View>
                  )}

                  {/* Amount range */}
                  <FieldLabel style={{ marginTop: 20 }}>
                    Amount range ({currency})
                  </FieldLabel>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <TextField
                        placeholder="min"
                        keyboardType="numeric"
                        value={filters.minAmount}
                        onChangeText={(v) =>
                          setFilters((f) => ({ ...f, minAmount: v }))
                        }
                        style={{ fontFamily: fonts.signal, fontSize: 13 }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <TextField
                        placeholder="max"
                        keyboardType="numeric"
                        value={filters.maxAmount}
                        onChangeText={(v) =>
                          setFilters((f) => ({ ...f, maxAmount: v }))
                        }
                        style={{ fontFamily: fonts.signal, fontSize: 13 }}
                      />
                    </View>
                  </View>

                    </>
                  )}

                  {/* Account */}
                  {(!searchingFilters || visibleAccounts.length > 0) && (
                    <>
                      <FieldLabel style={{ marginTop: 20 }}>Account</FieldLabel>
                      <ScrollView
                        horizontal
                        keyboardShouldPersistTaps="handled"
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 8 }}
                      >
                        <PillButton
                          label="All"
                          active={filters.accountId === null}
                          onPress={() =>
                            setFilters((f) => ({ ...f, accountId: null }))
                          }
                        />
                        {visibleAccounts.map((a) => (
                          <PillButton
                            key={a.id}
                            label={a.name}
                            active={filters.accountId === a.id}
                            onPress={() =>
                              setFilters((f) => ({
                                ...f,
                                accountId: f.accountId === a.id ? null : a.id,
                              }))
                            }
                          />
                        ))}
                      </ScrollView>
                    </>
                  )}

                  {/* Categories — grouped multi-select */}
                  {(!searchingFilters || visibleCategoryTree.length > 0) && (
                    <>
                  <FieldLabel style={{ marginTop: 20 }}>Categories</FieldLabel>
                  <ThemedText
                    style={{
                      fontSize: 11,
                      color: colors.muted,
                      marginBottom: 10,
                    }}
                  >
                    Pick as many as you like. A parent includes all its
                    subcategories — tap a sub to drop just that one.
                  </ThemedText>
                  {!searchingFilters && (
                    <PillButton
                      label="All"
                      active={
                        filters.categoryNames.length === 0 &&
                        filters.categoryGroups.length === 0
                      }
                      onPress={() =>
                        setFilters((f) => ({
                          ...f,
                          categoryNames: [],
                          categoryGroups: [],
                        }))
                      }
                      style={{ alignSelf: "flex-start" }}
                    />
                  )}
                  {visibleCategoryTree.map(({ parent, children, shown }) => {
                    const groupOn = filters.categoryGroups.includes(
                      parent.name,
                    );
                    const pickedCount = groupOn
                      ? 0
                      : [parent, ...children].filter((c) =>
                          filters.categoryNames.includes(c.name),
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
                          active={
                            groupOn ||
                            (children.length === 0 &&
                              filters.categoryNames.includes(parent.name))
                          }
                          count={pickedCount}
                          onPress={() =>
                            children.length > 0
                              ? toggleCategoryGroup(parent, children)
                              : toggleCategoryName(parent)
                          }
                        />
                        {shown.map((c) => (
                          <PillButton
                            key={c.id}
                            label={c.name}
                            color={c.color}
                            active={
                              groupOn ||
                              filters.categoryNames.includes(c.name)
                            }
                            onPress={() =>
                              toggleCategoryName(c, parent, children)
                            }
                          />
                        ))}
                      </ScrollView>
                    );
                  })}
                    </>
                  )}

                  {/* Tag */}
                  {visibleTags.length > 0 && (
                    <>
                      <FieldLabel style={{ marginTop: 20 }}>Tag</FieldLabel>
                      <ScrollView
                        horizontal
                        keyboardShouldPersistTaps="handled"
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 8 }}
                      >
                        <PillButton
                          label="All"
                          active={filters.tagValue === null}
                          onPress={() =>
                            setFilters((f) => ({ ...f, tagValue: null }))
                          }
                        />
                        {visibleTags.map((t) => (
                          <PillButton
                            key={t}
                            label={`#${t}`}
                            color={colors.ai}
                            active={filters.tagValue === t}
                            onPress={() =>
                              setFilters((f) => ({
                                ...f,
                                tagValue: f.tagValue === t ? null : t,
                              }))
                            }
                          />
                        ))}
                      </ScrollView>
                    </>
                  )}

                  {!searchingFilters && (
                    <>
                  {/* Source */}
                  <FieldLabel style={{ marginTop: 20 }}>Source</FieldLabel>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {(
                      [
                        { id: "all", label: "All" },
                        { id: "sms", label: "SMS" },
                        { id: "manual", label: "Manual" },
                        { id: "auto", label: "Auto" },
                      ] as { id: SourceFilter; label: string }[]
                    ).map((item) => (
                      <PillButton
                        key={item.id}
                        label={item.label}
                        active={filters.source === item.id}
                        onPress={() =>
                          setFilters((f) => ({ ...f, source: item.id }))
                        }
                      />
                    ))}
                  </View>

                  {/* Sort */}
                  <FieldLabel style={{ marginTop: 20 }}>Order</FieldLabel>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                  >
                    {(
                      [
                        { id: "newest", label: "Newest" },
                        { id: "oldest", label: "Oldest" },
                        { id: "highest", label: "Biggest" },
                        { id: "lowest", label: "Smallest" },
                      ] as { id: SortOption; label: string }[]
                    ).map((item) => (
                      <PillButton
                        key={item.id}
                        label={item.label}
                        active={filters.sort === item.id}
                        onPress={() =>
                          setFilters((f) => ({ ...f, sort: item.id }))
                        }
                      />
                    ))}
                  </View>

                  {/* Recurring toggle */}
                  <FieldLabel style={{ marginTop: 20 }}>Special</FieldLabel>
                  <PillButton
                    label="Recurring only"
                    icon={
                      <LucideRepeat
                        color={filters.recurring ? colors.ai : colors.secondary}
                        size={12}
                      />
                    }
                    color={colors.ai}
                    active={filters.recurring}
                    onPress={() =>
                      setFilters((f) => ({ ...f, recurring: !f.recurring }))
                    }
                    style={{ alignSelf: "flex-start" }}
                  />
                    </>
                  )}

                  {searchingFilters &&
                    visibleAccounts.length === 0 &&
                    visibleCategoryTree.length === 0 &&
                    visibleTags.length === 0 && (
                      <ThemedText
                        style={{
                          fontSize: 12,
                          color: colors.muted,
                          marginTop: 24,
                        }}
                      >
                        Nothing matches “{filterSearch.trim()}”.
                      </ThemedText>
                    )}

                  <View style={{ height: 24 }} />

                  <PrimaryButton
                    label={
                      activeFilterCount > 0
                        ? `Apply · ${activeFilterCount} active`
                        : "Apply"
                    }
                    onPress={() => {
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Success,
                      );
                      setShowFilters(false);
                    }}
                    style={{ marginBottom: Platform.OS === "ios" ? 20 : 8 }}
                  />
                </GHScrollView>
              </Pressable>
            </KeyboardAvoidingView>
          </Pressable>
        </GestureHandlerRootView>
      </Modal>
    </ThemedSafeAreaView>
  );
};

export default TransactionsScreen;
