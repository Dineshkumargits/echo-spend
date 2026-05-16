import React from 'react';
import { View, ViewStyle, Text, TextStyle, StyleProp } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';

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
      style={[{ backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }, style]}
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
  numberOfLines?: number;
}

/**
 * Themed text component that automatically applies theme colors.
 */
export const ThemedText: React.FC<ThemedTextProps> = ({ 
  children, 
  className = '', 
  style, 
  type = 'primary',
  numberOfLines
}) => {
  const { colors } = useTheme();
  
  const textColor = type === 'primary' ? colors.primary : 
                    type === 'secondary' ? colors.secondary : 
                    colors.muted;

  return (
    <Text 
      className={className} 
      style={[{ color: textColor }, style]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
};
