import React from 'react';
import { View, ViewStyle, Text, TextStyle, StyleProp, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, radius } from '../theme/tokens';

interface SafeAreaProps {
  children: React.ReactNode;
  className?: string;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

/**
 * Drop-in replacement for SafeAreaView that automatically applies
 * the current theme background color via inline styles.
 */
export const ThemedSafeAreaView: React.FC<SafeAreaProps> = ({ children, className = '', edges }) => {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      className={`flex-1 ${className}`}
      style={{ backgroundColor: colors.background }}
      edges={edges}
    >
      {children}
    </SafeAreaView>
  );
};

interface ThemedCardProps {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Themed card/surface component — uses the theme's surface color
 * for card backgrounds.
 */
export const ThemedCard: React.FC<ThemedCardProps> = ({ children, className = '', style }) => {
  const { colors } = useTheme();

  return (
    <View
      className={className}
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};

interface ThemedTextProps {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<TextStyle>;
  type?: 'primary' | 'secondary' | 'muted';
  /**
   * Typeface role from the "Money as Signal" system:
   *  - text (default): Switzer — everything readable
   *  - display: Clash Display — hero amounts & big headings
   *  - signal: JetBrains Mono — raw SMS traces, hashes, metadata, labels
   */
  font?: 'text' | 'display' | 'signal';
  numberOfLines?: number;
}

// Weight-aware family per role — each weight tier maps to an actual font
// *file*, never a synthetic bold. Display/Signal only ship Regular + Bold
// files, so anything semibold-or-heavier on those roles resolves to Bold.
const FONT_FAMILY_BY_WEIGHT: Record<NonNullable<ThemedTextProps['font']>, (weight: number) => string> = {
  text: (weight) =>
    weight >= 700 ? fonts.textBold :
    weight >= 600 ? fonts.textSemibold :
    weight >= 500 ? fonts.textMedium :
    fonts.text,
  display: (weight) => (weight >= 500 ? fonts.displayBold : fonts.display),
  signal: (weight) => (weight >= 500 ? fonts.signalBold : fonts.signal),
};

// NativeWind resolves `font-bold`/`font-semibold`/`font-medium` classNames
// outside this component's own style prop, so they can't be read off `style`.
// Sniff the className string itself to fold them into the same weight tier.
const weightFromClassName = (className: string): number => {
  if (/\bfont-black\b/.test(className)) return 900;
  if (/\bfont-extrabold\b/.test(className)) return 800;
  if (/\bfont-bold\b/.test(className)) return 700;
  if (/\bfont-semibold\b/.test(className)) return 600;
  if (/\bfont-medium\b/.test(className)) return 500;
  return 0;
};

const weightToNumber = (weight: TextStyle['fontWeight']): number => {
  if (!weight) return 0;
  if (weight === 'bold') return 700;
  if (weight === 'normal') return 400;
  const n = parseInt(String(weight), 10);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Themed text component that automatically applies theme colors and the
 * brand typeface. These are static font *files*, not a variable font, so a
 * bare `fontWeight` can't select a bolder face — RN would just fake-bold the
 * Regular file. Instead, any bold weight (from `style` or a `font-bold`-style
 * className) is resolved to the matching Bold/Semibold/Medium font file, and
 * `fontWeight` is reset to 'normal' so RN never synthesizes on top of it.
 */
export const ThemedText: React.FC<ThemedTextProps> = ({
  children,
  className = '',
  style,
  type = 'primary',
  font = 'text',
  numberOfLines
}) => {
  const { colors } = useTheme();

  const textColor = type === 'primary' ? colors.primary :
                    type === 'secondary' ? colors.secondary :
                    colors.muted;

  const flatStyle = StyleSheet.flatten(style) as TextStyle | undefined;
  const weight = Math.max(weightToNumber(flatStyle?.fontWeight), weightFromClassName(className));
  const fontFamily = FONT_FAMILY_BY_WEIGHT[font](weight);

  return (
    <Text
      className={className}
      style={[
        { color: textColor, fontFamily },
        style,
        { fontFamily, fontWeight: 'normal' },
      ]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
};
