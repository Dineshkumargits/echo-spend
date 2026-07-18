/**
 * Signature "Money as Signal" components.
 *
 * Motion rules (see design direction):
 *  01 Emit    — actions that move money ripple once from the touch point
 *  02 Arrive  — new data fades up with a small stagger, no bounce
 *  03 Breathe — only live things pulse (unconfirmed txns, active scan)
 *  04 Resonate— milestones ring outward (celebrations only)
 */
import React, { useState, useRef } from 'react';
import { View, Pressable, ViewStyle, StyleProp, TextStyle } from 'react-native';
import { MotiView } from 'moti';
import { Easing } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, motion, radius, formatINR } from '../theme/tokens';
import { ThemedText } from './ThemedSafeAreaView';

// ─── PulseDot — Rule 03: the app's "something needs you" primitive ──────────

interface PulseDotProps {
  size?: number;
  color?: string;
  /** Set false to render a static dot (e.g. reduced-motion contexts) */
  animated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const PulseDot: React.FC<PulseDotProps> = ({ size = 9, color, animated = true, style }) => {
  const { colors } = useTheme();
  // The live "something needs you" primitive uses the brand hue (signal green),
  // not a debit color — attention, not money-direction.
  const dotColor = color ?? colors.brand;

  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {animated && (
        <MotiView
          from={{ scale: 1, opacity: 0.55 }}
          animate={{ scale: 2.4, opacity: 0 }}
          transition={{ type: 'timing', duration: motion.pulsePeriod, loop: true, repeatReverse: false }}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: dotColor,
          }}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dotColor }} />
    </View>
  );
};

// ─── AmountText — numerals are the interface ────────────────────────────────

interface AmountTextProps {
  value: number;
  /** Cash-flow direction: debit = pulse amber, credit = echo aqua */
  kind?: 'debit' | 'credit' | 'transfer' | 'neutral';
  size?: number;
  showSign?: boolean;
  currency?: string;
  /** Hide value behind asterisks (privacy mode) */
  masked?: boolean;
  style?: StyleProp<TextStyle>;
}

export const AmountText: React.FC<AmountTextProps> = ({
  value,
  kind = 'neutral',
  size = 15,
  showSign = false,
  currency = '₹',
  masked = false,
  style,
}) => {
  const { colors } = useTheme();
  const color =
    kind === 'debit' ? colors.debit :
    kind === 'credit' ? colors.credit :
    kind === 'transfer' ? colors.secondary :
    colors.primary;
  const sign = !showSign ? '' : kind === 'debit' ? '−' : kind === 'credit' ? '+' : '';

  return (
    <ThemedText
      font="signal"
      style={[{ color, fontSize: size, fontFamily: fonts.signalBold, fontVariant: ['tabular-nums'] }, style]}
    >
      {masked ? `${currency}••••` : `${sign}${currency}${formatINR(Math.abs(value))}`}
    </ThemedText>
  );
};

// ─── SectionLabel — uppercase mono eyebrow ──────────────────────────────────

interface SectionLabelProps {
  children: React.ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
}

export const SectionLabel: React.FC<SectionLabelProps> = ({ children, color, style }) => {
  const { colors } = useTheme();
  return (
    <ThemedText
      font="signal"
      style={[{
        fontSize: 10,
        letterSpacing: 2.2,
        textTransform: 'uppercase',
        color: color ?? colors.secondary,
      }, style]}
    >
      {children}
    </ThemedText>
  );
};

// ─── ConfidenceChip — honest AI confidence ──────────────────────────────────

interface ConfidenceChipProps {
  confidence: 'high' | 'medium' | 'low';
  style?: StyleProp<ViewStyle>;
}

export const ConfidenceChip: React.FC<ConfidenceChipProps> = ({ confidence, style }) => {
  const { colors } = useTheme();
  const { fg, bg, label } =
    confidence === 'high'
      ? { fg: colors.ai, bg: colors.creditSoft, label: 'AI · High' }
      : confidence === 'medium'
        ? { fg: colors.debit, bg: colors.debitSoft, label: 'AI · Check this' }
        : { fg: colors.danger, bg: colors.alertSoft, label: 'AI · Unsure' };

  return (
    <View
      style={[{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 5,
        paddingHorizontal: 11,
        borderRadius: radius.pill,
        backgroundColor: bg,
        alignSelf: 'flex-start',
      }, style]}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: fg }} />
      <ThemedText font="signal" style={{ fontSize: 9, letterSpacing: 1.2, textTransform: 'uppercase', color: fg }}>
        {label}
      </ThemedText>
    </View>
  );
};

// ─── WaveformBar — spend trend as an audio wave ─────────────────────────────

export interface WavePoint {
  value: number;
  kind?: 'out' | 'in' | 'faint';
}

interface WaveformBarProps {
  data: WavePoint[];
  height?: number;
  barWidth?: number;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export const WaveformBar: React.FC<WaveformBarProps> = ({
  data,
  height = 44,
  barWidth = 6,
  gap = 3,
  style,
}) => {
  const { colors } = useTheme();
  const max = Math.max(...data.map(d => Math.abs(d.value)), 1);

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height }, style]}>
      {data.map((d, i) => {
        const h = Math.max(3, (Math.abs(d.value) / max) * height);
        const bg = d.kind === 'in' ? colors.credit : d.kind === 'out' ? colors.debit : colors.accent;
        return (
          <MotiView
            key={i}
            from={{ height: 3, opacity: 0 }}
            animate={{ height: h, opacity: d.kind === 'faint' ? 0.22 : 0.9 }}
            transition={{ type: 'timing', duration: motion.base, delay: i * motion.staggerStep }}
            style={{ width: barWidth, borderRadius: barWidth / 2, backgroundColor: bg }}
          />
        );
      })}
    </View>
  );
};

// ─── RippleButton — Rule 01: actions that move money emit one ring ──────────

interface RippleButtonProps {
  children: React.ReactNode;
  onPress: () => void;
  /** pulse = primary amber action; echo = confirm/success aqua; danger = destructive */
  tone?: 'pulse' | 'echo' | 'danger' | 'surface';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const RippleButton: React.FC<RippleButtonProps> = ({
  children,
  onPress,
  tone = 'pulse',
  disabled = false,
  style,
}) => {
  const { colors, isDark } = useTheme();
  const [rippleKey, setRippleKey] = useState(0);

  const bg =
    tone === 'pulse' ? colors.accent :
    tone === 'echo' ? colors.success :
    tone === 'danger' ? colors.danger :
    colors.surfaceElevated;
  // Amber/aqua fills need ink text for contrast in dark mode; light mode fills are dark enough for white.
  const contentColor = tone === 'surface' ? colors.primary : (colors.onAccent);

  const handlePress = () => {
    if (disabled) return;
    setRippleKey(k => k + 1); // one ring per action, never more
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.pill,
          paddingVertical: 13,
          paddingHorizontal: 26,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {rippleKey > 0 && (
        <MotiView
          key={rippleKey}
          from={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ type: 'timing', duration: motion.slow }}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0, bottom: 0, left: 0, right: 0,
            borderRadius: radius.pill,
            borderWidth: 1.5,
            borderColor: bg,
          }}
        />
      )}
      {typeof children === 'string' ? (
        <ThemedText style={{ color: contentColor, fontFamily: fonts.textBold, fontSize: 15 }}>
          {children}
        </ThemedText>
      ) : children}
    </Pressable>
  );
};

// ─── CycleBar — budget-cycle progress, echo→pulse gradient ──────────────────

interface CycleBarProps {
  /** 0–100 */
  pct: number;
  height?: number;
  /** Overrides the gradient with a solid color (e.g. danger when overbudget) */
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export const CycleBar: React.FC<CycleBarProps> = ({ pct, height = 6, color, style }) => {
  const { colors } = useTheme();
  const gradId = useRef(`cycle-${Math.random().toString(36).slice(2, 8)}`).current;
  const clamped = Math.max(0, Math.min(pct, 100));

  return (
    <View style={[{ height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: colors.surfaceElevated }, style]}>
      <View style={{ width: `${clamped}%`, height: '100%', borderRadius: height / 2, overflow: 'hidden' }}>
        {color ? (
          <View style={{ flex: 1, backgroundColor: color }} />
        ) : (
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <SvgLinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.credit} />
                <Stop offset="1" stopColor={colors.debit} />
              </SvgLinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
          </Svg>
        )}
      </View>
    </View>
  );
};

// ─── SonarSweep — the AI's face during a scan ────────────────────────────────

interface SonarSweepProps {
  size?: number;
  /** Sweep arm rotates while true; rings stay static when false */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const SonarSweep: React.FC<SonarSweepProps> = ({ size = 180, active = true, style }) => {
  const { colors } = useTheme();
  const ringStyle = (inset: number): ViewStyle => ({
    position: 'absolute',
    top: inset, left: inset, right: inset, bottom: inset,
    borderRadius: size / 2,
    borderWidth: 1,
    borderColor: colors.border,
  });
  // Fixed blip positions (fractions of size) — echoes lighting up as the arm passes
  const blips = [
    { top: 0.30, left: 0.66, color: colors.credit, delay: 400 },
    { top: 0.62, left: 0.26, color: colors.debit, delay: 1600 },
    { top: 0.20, left: 0.38, color: colors.credit, delay: 2400 },
  ];

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View style={ringStyle(0)} />
      <View style={ringStyle(size * 0.17)} />
      <View style={ringStyle(size * 0.34)} />

      {/* Sweep arm */}
      {active && (
        <MotiView
          from={{ rotate: '0deg' }}
          animate={{ rotate: '360deg' }}
          transition={{
            type: 'timing',
            duration: 3200,
            loop: true,
            repeatReverse: false,
            easing: Easing.linear,
          }}
          style={{ position: 'absolute', width: size, height: size, alignItems: 'center' }}
        >
          <View style={{
            width: 2,
            height: size / 2,
            backgroundColor: colors.accent,
            opacity: 0.7,
            borderRadius: 1,
          }} />
          <View style={{
            position: 'absolute',
            top: 0,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.accent,
          }} />
        </MotiView>
      )}

      {/* Blips */}
      {active && blips.map((b, i) => (
        <MotiView
          key={i}
          from={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            type: 'timing',
            duration: 900,
            delay: b.delay,
            loop: true,
            repeatReverse: true,
          }}
          style={{
            position: 'absolute',
            top: b.top * size,
            left: b.left * size,
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: b.color,
          }}
        />
      ))}

      {/* Core */}
      <View style={{
        position: 'absolute',
        top: size / 2 - 6,
        left: size / 2 - 6,
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: colors.accent,
      }} />
    </View>
  );
};

// ─── ResonanceRings — Rule 04: milestones ring outward (celebrations) ───────

interface ResonanceRingsProps {
  /** Increment to trigger a celebration burst */
  trigger: number;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export const ResonanceRings: React.FC<ResonanceRingsProps> = ({ trigger, color, size = 120, style }) => {
  const { colors } = useTheme();
  const ringColor = color ?? colors.success;
  if (trigger <= 0) return null;

  return (
    <View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      {[0, 1, 2].map(i => (
        <MotiView
          key={`${trigger}-${i}`}
          from={{ scale: 0.3, opacity: 0.6 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ type: 'timing', duration: motion.slow * 3, delay: i * 180 }}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: ringColor,
          }}
        />
      ))}
    </View>
  );
};
