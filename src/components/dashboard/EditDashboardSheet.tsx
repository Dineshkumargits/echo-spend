/**
 * "Edit dashboard" — long-press to drag a widget into place, tap to show/hide.
 *
 * The reorder is hand-rolled on reanimated + gesture-handler rather than pulling
 * in a draggable-list dependency: rows here are a fixed height, which makes the
 * math trivial, and the ecosystem's drag-list packages lag behind reanimated
 * majors. Gestures work because Kit's BottomSheet re-establishes a
 * GestureHandlerRootView inside the RN Modal's separate native hierarchy.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LucideGripVertical, LucideRotateCcw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { ThemedText } from '../ThemedSafeAreaView';
import { useTheme } from '../../theme/ThemeProvider';
import { fonts } from '../../theme/tokens';
import { SectionLabel } from '../Signal';
import { BottomSheet, IconTile, PrimaryButton } from '../Kit';
import { useStore } from '../../store/useStore';
import type { DashboardLayoutEntry } from '../../store/useStore';
import { WIDGET_BY_ID, resolveDashboardLayout, defaultDashboardLayout } from './registry';

/** Row height must match the rendered row exactly — the drag math depends on it. */
const ROW_H = 68;

interface EditDashboardSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const EditDashboardSheet: React.FC<EditDashboardSheetProps> = ({ visible, onClose }) => {
  const { colors } = useTheme();
  const { preferences, setDashboardLayout, resetDashboardLayout } = useStore();
  const haptics = preferences.hapticsEnabled;

  // Edit against a local draft so a drag in progress never re-renders the
  // dashboard underneath, then publish on every settled change.
  const [rows, setRows] = useState<DashboardLayoutEntry[]>([]);

  useEffect(() => {
    if (visible) setRows(resolveDashboardLayout(preferences.dashboardLayout));
    // Intentionally only on open: re-syncing while the sheet is up would fight
    // the user's in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const publish = useCallback(
    (next: DashboardLayoutEntry[]) => {
      setRows(next);
      setDashboardLayout(next);
    },
    [setDashboardLayout],
  );

  const buzz = useCallback(
    (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
      if (haptics) Haptics.impactAsync(style).catch(() => {});
    },
    [haptics],
  );

  const toggle = useCallback(
    (id: string) => {
      buzz();
      publish(rows.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
    },
    [rows, publish, buzz],
  );

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
      const next = rows.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      buzz(Haptics.ImpactFeedbackStyle.Medium);
      publish(next);
    },
    [rows, publish, buzz],
  );

  const reset = useCallback(() => {
    buzz(Haptics.ImpactFeedbackStyle.Medium);
    resetDashboardLayout();
    setRows(defaultDashboardLayout());
  }, [resetDashboardLayout, buzz]);

  const enabledCount = rows.filter((r) => r.enabled).length;

  // ── Drag state, shared across rows ─────────────────────────────────────────
  const draggingIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);

  /** Slot the dragged row would land in, given how far it has travelled. */
  const hoverIndex = useDerivedValue(() => {
    if (draggingIndex.value < 0) return -1;
    const shift = Math.round(dragY.value / ROW_H);
    const target = draggingIndex.value + shift;
    return Math.max(0, Math.min(target, rows.length - 1));
  }, [rows.length]);

  const onDrop = useCallback(
    (from: number, to: number) => {
      move(from, to);
    },
    [move],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Edit dashboard">
      <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
        <ThemedText
          style={{ fontFamily: fonts.text, fontSize: 13, color: colors.secondary, lineHeight: 19 }}
        >
          Long-press a widget to drag it into place. Tap to show or hide it.
        </ThemedText>
      </View>

      <ScrollView
        style={{ maxHeight: ROW_H * 6.5 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {rows.map((row, index) => (
          <WidgetRow
            key={row.id}
            row={row}
            index={index}
            draggingIndex={draggingIndex}
            dragY={dragY}
            hoverIndex={hoverIndex}
            onToggle={toggle}
            onDrop={onDrop}
            onDragStart={() => buzz(Haptics.ImpactFeedbackStyle.Medium)}
          />
        ))}
      </ScrollView>

      {enabledCount === 0 && (
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <ThemedText
            style={{ fontFamily: fonts.text, fontSize: 12, color: colors.danger, lineHeight: 18 }}
          >
            Every widget is hidden — your dashboard will show only the header.
          </ThemedText>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 16 }}>
        <Pressable
          onPress={reset}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 16,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <LucideRotateCcw size={14} color={colors.secondary} />
          <SectionLabel>Reset</SectionLabel>
        </Pressable>
        <View style={{ flex: 1 }}>
          <PrimaryButton label="Done" onPress={onClose} tone="echo" />
        </View>
      </View>
    </BottomSheet>
  );
};

// ─── Row ─────────────────────────────────────────────────────────────────────

interface WidgetRowProps {
  row: DashboardLayoutEntry;
  index: number;
  draggingIndex: ReturnType<typeof useSharedValue<number>>;
  dragY: ReturnType<typeof useSharedValue<number>>;
  hoverIndex: Readonly<{ value: number }>;
  onToggle: (id: string) => void;
  onDrop: (from: number, to: number) => void;
  onDragStart: () => void;
}

const WidgetRow: React.FC<WidgetRowProps> = ({
  row,
  index,
  draggingIndex,
  dragY,
  hoverIndex,
  onToggle,
  onDrop,
  onDragStart,
}) => {
  const { colors } = useTheme();
  const meta = WIDGET_BY_ID[row.id];

  const pan = Gesture.Pan()
    // Long-press activation is what lets the parent ScrollView keep working:
    // a normal drag scrolls, a held drag reorders.
    .activateAfterLongPress(220)
    .onStart(() => {
      draggingIndex.value = index;
      dragY.value = 0;
      runOnJS(onDragStart)();
    })
    .onUpdate((e) => {
      if (draggingIndex.value === index) dragY.value = e.translationY;
    })
    .onEnd(() => {
      if (draggingIndex.value !== index) return;
      const to = hoverIndex.value;
      draggingIndex.value = -1;
      dragY.value = 0;
      if (to !== index && to >= 0) runOnJS(onDrop)(index, to);
    })
    .onFinalize(() => {
      // Covers cancellation (e.g. the sheet closing mid-drag), which never
      // fires onEnd and would otherwise leave the list stuck mid-shift.
      if (draggingIndex.value === index) {
        draggingIndex.value = -1;
        dragY.value = 0;
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    const active = draggingIndex.value === index;
    if (active) {
      return {
        transform: [{ translateY: dragY.value }, { scale: 1.03 }],
        zIndex: 10,
        opacity: 0.95,
      };
    }

    // Rows between the dragged row's origin and its hover slot slide one place
    // to open the gap.
    let shift = 0;
    if (draggingIndex.value >= 0) {
      const from = draggingIndex.value;
      const to = hoverIndex.value;
      if (index > from && index <= to) shift = -ROW_H;
      else if (index < from && index >= to) shift = ROW_H;
    }

    return {
      transform: [{ translateY: withSpring(shift, { damping: 20, stiffness: 200 }) }, { scale: 1 }],
      zIndex: 0,
      opacity: 1,
    };
  });

  // A stale id can't reach here (resolveDashboardLayout drops them), but render
  // nothing rather than crash if that ever changes. Checked after the hooks so
  // the hook order stays identical on every render.
  if (!meta) return null;

  const tint = row.enabled ? colors.accent : colors.secondary;

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ height: ROW_H, justifyContent: 'center' }, animatedStyle]}>
        <Pressable
          onPress={() => onToggle(row.id)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: row.enabled ? colors.border : 'transparent',
            backgroundColor: row.enabled ? colors.surfaceElevated : 'transparent',
            opacity: row.enabled ? 1 : 0.55,
          }}
        >
          <LucideGripVertical size={16} color={colors.muted} />
          <IconTile emoji={meta.emoji} color={tint} size={34} />

          <View style={{ flex: 1 }}>
            <ThemedText
              numberOfLines={1}
              style={{ fontFamily: fonts.textMedium, fontSize: 14, color: colors.primary }}
            >
              {meta.title}
            </ThemedText>
            <ThemedText
              numberOfLines={1}
              style={{ fontFamily: fonts.text, fontSize: 11, color: colors.secondary, marginTop: 2 }}
            >
              {meta.description}
            </ThemedText>
          </View>

          {/* Static switch-like affordance — the whole row is the hit target. */}
          <View
            style={{
              width: 42,
              height: 24,
              borderRadius: 12,
              padding: 3,
              backgroundColor: row.enabled ? colors.accent : colors.surfaceElevated,
              borderWidth: 1,
              borderColor: row.enabled ? colors.accent : colors.border,
              alignItems: row.enabled ? 'flex-end' : 'flex-start',
            }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: row.enabled ? colors.onAccent : colors.muted,
              }}
            />
          </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
};
