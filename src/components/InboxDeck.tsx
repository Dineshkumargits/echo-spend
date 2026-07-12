/**
 * Smart Inbox deck — "triage as a hand of cards".
 *
 * Each unconfirmed signal is a physical card in a stack. The top card responds
 * to a pan gesture: drag right past the threshold to CONFIRM (echo), left to
 * DISMISS (alert). Cards behind rise (scale + lift) as you drag, so the next
 * one is already arriving before the top leaves. Velocity flicks count too.
 *
 * The card height is FIXED — all editing (category / account / tags / rename)
 * happens in bottom sheets owned by the screen, never by growing the card.
 * That's what keeps the deck illusion stable.
 */
import React, { useRef, useCallback, useMemo, useEffect } from "react";
import {
  View,
  Pressable,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { MotiView } from "moti";
import * as Haptics from "expo-haptics";
import {
  LucideArrowUpRight,
  LucideArrowDownLeft,
  LucideRotateCw,
  LucideCheck,
  LucideX,
  LucidePencil,
  LucideChevronDown,
  LucidePlus,
  LucideZap,
  LucideAlertTriangle,
  LucideMessageSquareText,
} from "lucide-react-native";
import { ThemedText } from "./ThemedSafeAreaView";
import { useTheme } from "../theme/ThemeProvider";
import { fonts, radius, motion } from "../theme/tokens";
import { renderCategoryIcon } from "./CategoryManager";
import { ConfidenceChip } from "./Signal";
import { Transaction, Account, Category } from "../services/database";

// ─── Card callbacks the screen wires to bottom sheets ───────────────────────

export interface CardHandlers {
  onEditCategory: (tx: Transaction) => void;
  onEditAccount: (tx: Transaction) => void;
  onEditToAccount: (tx: Transaction) => void;
  onEditTags: (tx: Transaction) => void;
  onRename: (tx: Transaction) => void;
  onTypeChange: (
    tx: Transaction,
    type: "debit" | "credit" | "transfer",
  ) => void;
}

// ─── Small chip used for category / account / tags on the card ───────────────

const CardChip: React.FC<{
  label: string;
  color: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  dashed?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}> = ({ label, color, leading, trailing, dashed, onPress, disabled }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.pill,
        backgroundColor: dashed ? "transparent" : `${color}25`, // ~15% opacity so background pill is clearly visible
        borderWidth: dashed ? 1 : 0,
        borderColor: dashed ? colors.border : "transparent",
        borderStyle: dashed ? "dashed" : "solid",
        marginRight: 12,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {leading}
        <ThemedText
          style={{ fontFamily: fonts.textSemibold, fontSize: 12, color }}
          numberOfLines={1}
        >
          {label}
        </ThemedText>
        {trailing}
      </View>
    </TouchableOpacity>
  );
};

// ─── The fixed-height card face ─────────────────────────────────────────────

interface CardFaceProps {
  tx: Transaction;
  accounts: Account[];
  categories: Category[];
  currency: string;
  accountOverride?: number;
  width: number;
  height: number;
  handlers: CardHandlers;
  /** Behind-the-top cards are non-interactive and slightly muted */
  preview?: boolean;
}

const InboxCardFace: React.FC<CardFaceProps> = ({
  tx,
  accounts,
  categories,
  currency,
  accountOverride,
  width,
  height,
  handlers,
  preview,
}) => {
  const { colors } = useTheme();
  const isOffline = tx.confidence === "low" && !!tx.rawSms;
  const sourceLabel =
    tx.source === "sms"
      ? "SMS"
      : tx.source === "auto"
        ? "AUTO"
        : tx.source === "csv"
          ? "CSV"
          : "MANUAL";
  const amountColor =
    tx.type === "credit"
      ? colors.credit
      : tx.type === "transfer"
        ? colors.primary
        : colors.debit;
  const DirIcon =
    tx.type === "credit"
      ? LucideArrowDownLeft
      : tx.type === "transfer"
        ? LucideRotateCw
        : LucideArrowUpRight;
  const cat = categories.find((c) => c.name === tx.category);
  const effectiveAcc = accounts.find(
    (a) => a.id === (accountOverride ?? tx.accountId),
  );
  const toAcc = accounts.find((a) => a.id === tx.toAccountId);
  const dt = tx.date ? new Date(tx.date) : null;

  const types: {
    id: "debit" | "credit" | "transfer";
    label: string;
    icon: any;
    color: string;
  }[] = [
    {
      id: "debit",
      label: "Expense",
      icon: LucideArrowUpRight,
      color: colors.debit,
    },
    {
      id: "credit",
      label: "Income",
      icon: LucideArrowDownLeft,
      color: colors.credit,
    },
    {
      id: "transfer",
      label: "Transfer",
      icon: LucideRotateCw,
      color: colors.secondary,
    },
  ];

  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
        // A soft lift so the card reads as a physical object above the ground.
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: preview ? 0.12 : 0.22,
        shadowRadius: 16,
        elevation: preview ? 3 : 8,
      }}
    >
      {/* Top signal band — confidence + provenance */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 4,
        }}
      >
        <ConfidenceChip confidence={(tx.confidence ?? "medium") as any} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {isOffline ? (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <LucideAlertTriangle color={colors.warning} size={11} />
              <ThemedText
                font="signal"
                style={{
                  fontSize: 8.5,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: colors.warning,
                }}
              >
                Local parse
              </ThemedText>
            </View>
          ) : (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <LucideZap color={colors.muted} size={10} />
              <ThemedText
                font="signal"
                style={{
                  fontSize: 8.5,
                  letterSpacing: 1.2,
                  color: colors.muted,
                }}
              >
                {sourceLabel}
              </ThemedText>
            </View>
          )}
        </View>
      </View>

      {/* Amount hero */}
      <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${amountColor}18`,
            }}
          >
            <DirIcon color={amountColor} size={19} />
          </View>
          <ThemedText
            style={{
              fontFamily: fonts.signalBold,
              fontSize: 38,
              lineHeight: 44,
              color: amountColor,
              fontVariant: ["tabular-nums"],
            }}
            numberOfLines={1}
          >
            {tx.type === "credit" ? "+" : "−"}
            {currency}
            {tx.amount?.toLocaleString("en-IN") ?? "0"}
          </ThemedText>
        </View>

        {/* Merchant — tap to rename */}
        <Pressable
          onPress={() => !preview && handlers.onRename(tx)}
          disabled={preview}
          style={{ marginTop: 12 }}
        >
          <ThemedText
            style={{
              fontFamily: fonts.displayBold,
              fontSize: 22,
              letterSpacing: -0.3,
            }}
            numberOfLines={1}
          >
            {tx.merchant || "Unknown"}
          </ThemedText>
        </Pressable>
        <ThemedText
          font="signal"
          type="secondary"
          style={{ fontSize: 10.5, marginTop: 4, letterSpacing: 0.3 }}
        >
          {dt
            ? dt.toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              }) +
              "  ·  " +
              dt.toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </ThemedText>
      </View>

      {/* Type segmented — core triage, stays on the card */}
      <View style={{ paddingHorizontal: 18, marginTop: 16 }}>
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.translucent,
            padding: 3,
            borderRadius: radius.pill,
          }}
        >
          {types.map((t) => {
            const active = tx.type === t.id;
            const Icon = t.icon;
            return (
              <Pressable
                key={t.id}
                onPress={() => !preview && handlers.onTypeChange(tx, t.id)}
                disabled={preview}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 5,
                  paddingVertical: 8,
                  borderRadius: radius.pill,
                  backgroundColor: active
                    ? colors.surfaceElevated
                    : "transparent",
                }}
              >
                <Icon color={active ? t.color : colors.muted} size={13} />
                <ThemedText
                  font="signal"
                  style={{
                    fontSize: 9.5,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: active ? colors.primary : colors.secondary,
                  }}
                >
                  {t.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Meta chips — category / account / tags → open sheets */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          paddingHorizontal: 18,
          marginTop: 16,
        }}
      >
        <CardChip
          label={tx.category || "Uncategorized"}
          color={colors.accent}
          leading={
            cat ? renderCategoryIcon(cat.icon, colors.accent, 13) : undefined
          }
          trailing={<LucideChevronDown color={colors.accent} size={12} />}
          onPress={() => handlers.onEditCategory(tx)}
          disabled={preview}
        />
        <CardChip
          label={
            (tx.type === "transfer" ? "From " : "") +
            (effectiveAcc?.name ?? "No account")
          }
          color={colors.secondary}
          trailing={<LucideChevronDown color={colors.secondary} size={12} />}
          onPress={() => handlers.onEditAccount(tx)}
          disabled={preview}
        />
        {tx.type === "transfer" && (
          <CardChip
            label={"To " + (toAcc?.name ?? "Select")}
            color={colors.credit}
            trailing={<LucideChevronDown color={colors.credit} size={12} />}
            onPress={() => handlers.onEditToAccount(tx)}
            disabled={preview}
          />
        )}
        {(tx.tags || []).slice(0, 3).map((tag) => (
          <CardChip
            key={tag}
            label={`#${tag}`}
            color={colors.violet}
            onPress={() => handlers.onEditTags(tx)}
            disabled={preview}
          />
        ))}
        <CardChip
          label="Tag"
          color={colors.secondary}
          leading={<LucidePlus color={colors.secondary} size={12} />}
          dashed
          onPress={() => handlers.onEditTags(tx)}
          disabled={preview}
        />
      </View>

      {/* Raw SMS trace — the original signal, filling the card's base */}
      <View
        style={{
          flex: 1,
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 18,
        }}
      >
        <View
          style={{
            flex: 1,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.background,
            padding: 13,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <LucideMessageSquareText color={colors.muted} size={12} />
            <ThemedText
              font="signal"
              style={{
                fontSize: 8.5,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: colors.muted,
              }}
            >
              Signal trace
            </ThemedText>
          </View>
          <ThemedText
            font="signal"
            style={{
              fontSize: 10.5,
              lineHeight: 16,
              color: colors.secondary,
              letterSpacing: 0.1,
            }}
            numberOfLines={4}
          >
            {tx.rawSms || tx.notes || "Added manually — no message trace."}
          </ThemedText>
        </View>
      </View>
    </View>
  );
};

// ─── Circular dock button ────────────────────────────────────────────────────

const DockButton: React.FC<{
  size: number;
  onPress: () => void;
  children: React.ReactNode;
  filled?: string;
  ring?: string;
}> = ({ size, onPress, children, filled, ring }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: filled ?? colors.surface,
        borderWidth: filled ? 0 : 1.5,
        borderColor: ring ?? colors.border,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      {children}
    </TouchableOpacity>
  );
};

// ─── The deck ────────────────────────────────────────────────────────────────

interface InboxDeckProps {
  queue: Transaction[];
  accounts: Account[];
  categories: Category[];
  currency: string;
  accountOverrides: Record<number, number>;
  onConfirm: (tx: Transaction) => void;
  onDismiss: (tx: Transaction) => void;
  onEdit: (tx: Transaction) => void;
  handlers: CardHandlers;
}

export const InboxDeck: React.FC<InboxDeckProps> = ({
  queue,
  accounts,
  categories,
  currency,
  accountOverrides,
  onConfirm,
  onDismiss,
  onEdit,
  handlers,
}) => {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();

  const CARD_W = width - 44;
  const CARD_H = Math.min(Math.max(height * 0.54, 430), 580);
  const THRESHOLD = width * 0.26;
  const OUT = width * 1.3;

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const top = queue[0];
  const topId = top?.id;

  // Latest-state ref so gesture worklet JS callbacks never act on a stale card.
  const stateRef = useRef({ queue, onConfirm, onDismiss, onEdit });
  stateRef.current = { queue, onConfirm, onDismiss, onEdit };

  const decideConfirm = useCallback(() => {
    const q = stateRef.current.queue;
    translateX.value = 0;
    translateY.value = 0;
    if (q[0]) stateRef.current.onConfirm(q[0]);
  }, []);
  const decideDismiss = useCallback(() => {
    const q = stateRef.current.queue;
    translateX.value = 0;
    translateY.value = 0;
    if (q[0]) stateRef.current.onDismiss(q[0]);
  }, []);
  const buzz = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid).catch(() => {});
  }, []);
  const softBuzz = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  // Backstop reset if the top changes by any path other than a decision.
  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
  }, [topId]);

  const flyOut = useCallback(
    (dir: "left" | "right") => {
      buzz();
      translateX.value = withTiming(
        dir === "right" ? OUT : -OUT,
        { duration: 220 },
        (finished) => {
          if (finished)
            runOnJS(dir === "right" ? decideConfirm : decideDismiss)();
        },
      );
    },
    [OUT],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-16, 16])
        .onUpdate((e) => {
          translateX.value = e.translationX;
          translateY.value = e.translationY * 0.1;
        })
        .onEnd((e) => {
          const x = translateX.value;
          if (x > THRESHOLD || e.velocityX > 850) {
            runOnJS(buzz)();
            translateX.value = withTiming(OUT, { duration: 200 }, (f) => {
              if (f) runOnJS(decideConfirm)();
            });
          } else if (x < -THRESHOLD || e.velocityX < -850) {
            runOnJS(buzz)();
            translateX.value = withTiming(-OUT, { duration: 200 }, (f) => {
              if (f) runOnJS(decideDismiss)();
            });
          } else {
            translateX.value = withSpring(0, { damping: 18, stiffness: 200 });
            translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
          }
        }),
    [THRESHOLD, OUT],
  );

  // Animated styles
  const topStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${(translateX.value / width) * 9}deg` },
    ],
  }));
  const secondStyle = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(translateX.value) / THRESHOLD, 1);
    return {
      transform: [{ scale: 0.93 + 0.07 * p }, { translateY: 22 - 22 * p }],
      opacity: 0.55 + 0.45 * p,
    };
  });
  const thirdStyle = useAnimatedStyle(() => {
    const p = Math.min(Math.abs(translateX.value) / THRESHOLD, 1);
    return {
      transform: [{ scale: 0.86 + 0.07 * p }, { translateY: 44 - 22 * p }],
      opacity: 0.3 + 0.25 * p,
    };
  });
  const confirmStampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(translateX.value / THRESHOLD, 0), 1),
  }));
  const dismissStampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(-translateX.value / THRESHOLD, 0), 1),
  }));

  const absCard = {
    position: "absolute" as const,
    top: 0,
    width: CARD_W,
    height: CARD_H,
  };
  const faceProps = {
    accounts,
    categories,
    currency,
    width: CARD_W,
    height: CARD_H,
    handlers,
  };

  return (
    <View style={{ alignItems: "center" }}>
      {/* Stack */}
      <View style={{ width: CARD_W, height: CARD_H + 46 }}>
        {queue[2] && (
          <Animated.View
            style={[absCard, thirdStyle, { zIndex: 1 }]}
            pointerEvents="none"
          >
            <InboxCardFace tx={queue[2]} {...faceProps} preview />
          </Animated.View>
        )}
        {queue[1] && (
          <Animated.View
            style={[absCard, secondStyle, { zIndex: 2 }]}
            pointerEvents="none"
          >
            <InboxCardFace tx={queue[1]} {...faceProps} preview />
          </Animated.View>
        )}
        {top && (
          <GestureDetector gesture={pan}>
            <Animated.View style={[absCard, topStyle, { zIndex: 3 }]}>
              <MotiView
                key={topId}
                from={{ scale: 0.97, opacity: 0.85 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "timing", duration: motion.fast }}
              >
                <InboxCardFace
                  tx={top}
                  accountOverride={accountOverrides[top.id]}
                  {...faceProps}
                />
              </MotiView>

              {/* Directional stamps */}
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    top: 26,
                    left: 22,
                    borderWidth: 3,
                    borderColor: colors.credit,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    transform: [{ rotate: "-14deg" }],
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: `${colors.credit}12`,
                  },
                  confirmStampStyle,
                ]}
              >
                <LucideCheck color={colors.credit} size={16} />
                <ThemedText
                  font="signal"
                  style={{
                    fontSize: 13,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: colors.credit,
                  }}
                >
                  Confirm
                </ThemedText>
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    top: 26,
                    right: 22,
                    borderWidth: 3,
                    borderColor: colors.danger,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    transform: [{ rotate: "14deg" }],
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: `${colors.danger}12`,
                  },
                  dismissStampStyle,
                ]}
              >
                <LucideX color={colors.danger} size={16} />
                <ThemedText
                  font="signal"
                  style={{
                    fontSize: 13,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    color: colors.danger,
                  }}
                >
                  Not a txn
                </ThemedText>
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      {/* Action dock */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 26,
          marginTop: 8,
        }}
      >
        <DockButton
          size={58}
          onPress={() => flyOut("left")}
          ring={colors.danger}
        >
          <LucideX color={colors.danger} size={26} />
        </DockButton>
        <DockButton
          size={48}
          onPress={() => {
            softBuzz();
            const t = stateRef.current.queue[0];
            if (t) stateRef.current.onEdit(t);
          }}
        >
          <LucidePencil color={colors.warning} size={20} />
        </DockButton>
        <DockButton
          size={58}
          onPress={() => flyOut("right")}
          filled={colors.credit}
        >
          <LucideCheck color={colors.onAccent} size={26} />
        </DockButton>
      </View>
    </View>
  );
};
