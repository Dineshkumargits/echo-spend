/**
 * Echo Spend structural kit — "Money as Signal".
 *
 * These are the building blocks every screen is rebuilt on so the whole app
 * shares one language: editorial mono/Clash headers, a signal-timeline list
 * row (rail + node + squared icon tile + mono amount), underline segmented
 * controls, grabber sheets, and mono form fields. Deliberately distinct from
 * the old iOS-list look (circular icons, pill chips, big bold titles).
 */
import React from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, Modal, useWindowDimensions,
  ViewStyle, StyleProp, TextStyle, TextInputProps, KeyboardAvoidingView, Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius, motion } from '../theme/tokens';
import { ThemedText } from './ThemedSafeAreaView';
import { SectionLabel } from './Signal';

// ─── ScreenHeader — mono eyebrow + Clash title + optional back / right slot ──

interface ScreenHeaderProps {
  eyebrow?: string;
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  /** Large hero title (screen root) vs compact (pushed screen) */
  compact?: boolean;
}

export const ScreenHeader: React.FC<ScreenHeaderProps> = ({ eyebrow, title, onBack, right, compact }) => {
  const { colors } = useTheme();
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 8, paddingBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={{
              width: 38, height: 38, borderRadius: 12,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: colors.translucent,
            }}
          >
            <Text style={{ color: colors.primary, fontSize: 20, marginTop: -2 }}>‹</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          {eyebrow && <SectionLabel>{eyebrow}</SectionLabel>}
          <ThemedText
            font="display"
            style={{
              fontFamily: fonts.displayBold,
              fontSize: compact ? 24 : 30,
              letterSpacing: -0.5,
              marginTop: eyebrow ? 2 : 0,
            }}
            numberOfLines={1}
          >
            {title}
          </ThemedText>
        </View>
        {right}
      </View>
    </View>
  );
};

// ─── HeaderIconButton — squared translucent action for headers ──────────────

export const HeaderIconButton: React.FC<{ onPress: () => void; children: React.ReactNode; tint?: string }> = ({ onPress, children, tint }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 38, height: 38, borderRadius: 12,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: tint ? `${tint}18` : colors.translucent,
      }}
    >
      {children}
    </Pressable>
  );
};

// ─── Segmented — mono uppercase labels with a sliding underline ─────────────

interface SegOption<T extends string> { key: T; label: string; color?: string }
interface SegmentedProps<T extends string> {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Segmented<T extends string>({ options, value, onChange, scroll, style }: SegmentedProps<T>) {
  const { colors } = useTheme();

  const Item = ({ opt }: { opt: SegOption<T> }) => {
    const active = opt.key === value;
    const activeColor = opt.color ?? colors.accent;
    return (
      <Pressable
        onPress={() => { Haptics.selectionAsync(); onChange(opt.key); }}
        style={{ paddingVertical: 10, marginRight: scroll ? 22 : 0, flex: scroll ? undefined : 1, alignItems: 'center' }}
      >
        <ThemedText
          font="signal"
          style={{
            fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
            color: active ? colors.primary : colors.secondary,
          }}
        >
          {opt.label}
        </ThemedText>
        {active && (
          <MotiView
            from={{ opacity: 0, scaleX: 0.4 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ type: 'timing', duration: motion.fast }}
            style={{ height: 2, width: 22, borderRadius: 2, backgroundColor: activeColor, marginTop: 6 }}
          />
        )}
        {!active && <View style={{ height: 2, marginTop: 6 }} />}
      </Pressable>
    );
  };

  if (scroll) {
    return (
      <View style={[{ borderBottomWidth: 1, borderBottomColor: colors.border }, style]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24 }}>
          {options.map(opt => <Item key={opt.key} opt={opt} />)}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 24 }, style]}>
      {options.map(opt => <Item key={opt.key} opt={opt} />)}
    </View>
  );
}

// ─── IconTile — squared tinted tile holding an emoji or icon ────────────────

interface IconTileProps {
  emoji?: string;
  children?: React.ReactNode;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export const IconTile: React.FC<IconTileProps> = ({ emoji, children, color, size = 40, style }) => {
  const { colors } = useTheme();
  const tint = color ?? colors.secondary;
  return (
    <View
      style={[{
        width: size, height: size, borderRadius: size * 0.3,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${tint}1f`,
      }, style]}
    >
      {emoji ? <Text style={{ fontSize: size * 0.44 }}>{emoji}</Text> : children}
    </View>
  );
};

// ─── PillButton — mono uppercase chip / action (outline or filled) ──────────

interface PillButtonProps {
  label: string;
  onPress: () => void;
  active?: boolean;
  color?: string;
  icon?: React.ReactNode;
  count?: number;
  style?: StyleProp<ViewStyle>;
}

export const PillButton: React.FC<PillButtonProps> = ({ label, onPress, active, color, icon, count, style }) => {
  const { colors } = useTheme();
  const c = color ?? colors.accent;
  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 9,
        borderRadius: 11, borderWidth: 1,
        backgroundColor: active ? `${c}18` : 'transparent',
        borderColor: active ? c : colors.border,
      }, style]}
    >
      {icon}
      <ThemedText
        font="signal"
        style={{ fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: active ? c : colors.secondary }}
      >
        {label}
      </ThemedText>
      {count != null && count > 0 && (
        <View style={{ backgroundColor: c, borderRadius: 99, paddingHorizontal: 5, paddingVertical: 1 }}>
          <ThemedText font="signal" style={{ fontSize: 9, color: colors.background }}>{count}</ThemedText>
        </View>
      )}
    </Pressable>
  );
};

// ─── SignalRow — the transaction timeline row ───────────────────────────────
// Rail (continuous vertical line + node dot) + squared icon tile + text + right.

interface SignalRowProps {
  emoji?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** node color; also used as rail accent */
  nodeColor?: string;
  badges?: React.ReactNode;
  onPress?: () => void;
  rail?: boolean;
  padded?: boolean;
}

export const SignalRow: React.FC<SignalRowProps> = ({
  emoji, iconColor, title, subtitle, right, nodeColor, badges, onPress, rail = true, padded = true,
}) => {
  const { colors } = useTheme();
  const node = nodeColor ?? colors.secondary;
  // A plain, always-centered flex row. Every child participates in normal
  // layout (no absolute positioning, no percentage heights) so the icon, text
  // and amount stay vertically centered and the amount never drops or overlaps.
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 13,
          paddingHorizontal: padded ? 24 : 0,
          width: '100%',
        }}
      >
        {/* Signal node — a fixed-size colored dot marking direction (out/in). */}
        {rail && (
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: node, marginRight: 12, flexShrink: 0 }} />
        )}
        <IconTile emoji={emoji} color={iconColor} size={40} style={{ flexShrink: 0 }} />
        {/* minWidth: 0 lets the text column shrink so long titles/subtitles
            truncate instead of pushing the amount off the row. */}
        <View style={{ flex: 1, minWidth: 0, marginLeft: 12, marginRight: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 15, flexShrink: 1, minWidth: 0 }} numberOfLines={1}>
              {title}
            </ThemedText>
            {badges != null && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 }}>{badges}</View>}
          </View>
          {subtitle != null && (
            <ThemedText font="signal" type="secondary" style={{ fontSize: 10, marginTop: 3, letterSpacing: 0.2 }} numberOfLines={1}>
              {subtitle}
            </ThemedText>
          )}
        </View>
        <View style={{ flexShrink: 0, alignItems: 'flex-end' }}>{right}</View>
      </View>
    </Pressable>
  );
};

// ─── GroupLabel — mono date/section divider that keeps the rail continuous ──

export const GroupLabel: React.FC<{ label: string }> = ({ label }) => {
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 18, paddingBottom: 6 }}>
      <SectionLabel>{label}</SectionLabel>
    </View>
  );
};

// ─── Card — soft surface block (low-border, subtle) ─────────────────────────

export const Card: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean }> = ({ children, style, onPress, padded = true }) => {
  const { colors } = useTheme();
  const inner = (
    <View style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: padded ? 18 : 0 }, style]}>
      {children}
    </View>
  );
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{inner}</Pressable>;
  return inner;
};

// ─── StatBlock — mono label + big mono value ────────────────────────────────

export const StatBlock: React.FC<{ label: string; value: string; color?: string; style?: StyleProp<ViewStyle> }> = ({ label, value, color, style }) => {
  const { colors } = useTheme();
  return (
    <View style={style}>
      <SectionLabel>{label}</SectionLabel>
      <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 18, color: color ?? colors.primary, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
};

// ─── EmptyState ─────────────────────────────────────────────────────────────

export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode }> = ({ icon, title, subtitle, action }) => {
  const { colors } = useTheme();
  return (
    <MotiView from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} style={{ alignItems: 'center', paddingTop: 72, paddingHorizontal: 40 }}>
      {icon}
      <ThemedText style={{ fontFamily: fonts.displayBold, fontSize: 18, marginTop: 18, textAlign: 'center' }}>{title}</ThemedText>
      {subtitle && <ThemedText type="secondary" style={{ textAlign: 'center', marginTop: 8, fontSize: 14, lineHeight: 20 }}>{subtitle}</ThemedText>}
      {action && <View style={{ marginTop: 22 }}>{action}</View>}
    </MotiView>
  );
};

// ─── SheetHandle — grabber + title for bottom sheets ────────────────────────

export const SheetHandle: React.FC<{ title?: string; onClose?: () => void; right?: React.ReactNode }> = ({ title, onClose, right }) => {
  const { colors } = useTheme();
  return (
    <View style={{ paddingTop: 10 }}>
      <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.muted, alignSelf: 'center', opacity: 0.5 }} />
      {(title || onClose) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
          {title && <ThemedText style={{ fontFamily: fonts.displayBold, fontSize: 20, flex: 1 }}>{title}</ThemedText>}
          {right}
          {onClose && (
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.translucent, marginLeft: 10 }}>
              <Text style={{ color: colors.primary, fontSize: 15 }}>✕</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
};

// ─── BottomSheet — slide-up modal shell (grabber + backdrop tap-to-close) ────
// A focused, single-purpose sheet: keeps editing flows OFF the card so card
// height stays fixed (essential for the inbox deck). Content is provided by the
// caller; the shell owns the backdrop, slide animation, grabber and max-height.

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  /** Fraction of screen height the sheet may occupy (default 0.82) */
  maxHeightPct?: number;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ visible, onClose, title, right, children, maxHeightPct = 0.82 }) => {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      {/* react-native Modal renders in a separate native hierarchy OUTSIDE the app's
          root GestureHandlerRootView. Without re-establishing one here, RNGH breaks
          touch arbitration for the inner ScrollView vs its Pressable rows — scroll
          only works over non-pressable areas (e.g. an icon). This wrapper fixes it. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <MotiView
          from={{ translateY: 32, opacity: 0 }}
          animate={{ translateY: 0, opacity: 1 }}
          transition={{ type: 'timing', duration: motion.base }}
        >
          {/* Swallow taps so touches inside the sheet don't close it */}
          <Pressable onPress={() => {}} style={{ width: '100%' }}>
            <View
              style={{
                backgroundColor: colors.surface,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                borderWidth: 1,
                borderBottomWidth: 0,
                borderColor: colors.border,
                maxHeight: height * maxHeightPct,
                paddingBottom: 28,
              }}
            >
              <SheetHandle title={title} onClose={onClose} right={right} />
              {children}
            </View>
          </Pressable>
        </MotiView>
      </Pressable>
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
};

// ─── PrimaryButton — filled amber/aqua action with mono label ───────────────

export const PrimaryButton: React.FC<{ label: string; onPress: () => void; tone?: 'pulse' | 'echo' | 'danger'; disabled?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ label, onPress, tone = 'pulse', disabled, icon, style }) => {
  const { colors, isDark } = useTheme();
  const bg = tone === 'echo' ? colors.success : tone === 'danger' ? colors.danger : colors.accent;
  const fg = colors.onAccent;
  return (
    <Pressable
      onPress={() => { if (!disabled) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); } }}
      disabled={disabled}
      style={({ pressed }) => [{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: bg, borderRadius: radius.md, paddingVertical: 16,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      }, style]}
    >
      {icon}
      <Text style={{ fontFamily: fonts.signalBold, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: fg }}>{label}</Text>
    </Pressable>
  );
};

// ─── FieldLabel + TextField — mono-labelled inputs for forms ────────────────

export const FieldLabel: React.FC<{ children: React.ReactNode; style?: StyleProp<TextStyle> }> = ({ children, style }) => (
  <SectionLabel style={[{ marginBottom: 8 }, style]}>{children}</SectionLabel>
);

export const TextField: React.FC<TextInputProps & { leading?: React.ReactNode; trailing?: React.ReactNode }> = ({ leading, trailing, style, ...props }) => {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12 } as any}>
      {leading}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[{ flex: 1, color: colors.primary, fontFamily: fonts.text, fontSize: 15, padding: 0 }, style]}
        {...props}
      />
      {trailing}
    </View>
  );
};

// ─── SettingRow — icon tile + label/sub + right control, for Settings ───────

export const SettingRow: React.FC<{
  icon?: React.ReactNode;
  iconColor?: string;
  label: string;
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
}> = ({ icon, iconColor, label, sub, right, onPress, last }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        opacity: pressed && onPress ? 0.6 : 1,
      })}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: last ? 0 : 1,
          borderBottomColor: colors.border,
          width: '100%',
        }}
      >
        {icon && <IconTile color={iconColor} size={36}>{icon}</IconTile>}
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontFamily: fonts.textSemibold, fontSize: 15 }}>{label}</ThemedText>
          {sub && <ThemedText type="secondary" style={{ fontSize: 12, marginTop: 2 }} numberOfLines={2}>{sub}</ThemedText>}
        </View>
        {right}
      </View>
    </Pressable>
  );
};
