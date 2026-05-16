import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { View, useColorScheme, Appearance } from 'react-native';
import { useStore } from '../store/useStore';
import { useColorScheme as useTailwindColorScheme } from 'nativewind';

interface ThemeContextValue {
  theme: 'dark' | 'light';
  isDark: boolean;
  colors: typeof darkColors;
}

const darkColors = {
  background: '#000000',
  surface: '#1C1C1E',
  surfaceElevated: '#2C2C2E',
  primary: '#FFFFFF',
  secondary: '#8E8E93',
  muted: '#48484A',
  accent: '#0A84FF',
  success: '#30D158',
  warning: '#FF9500',
  danger: '#FF453A',
  border: 'rgba(255,255,255,0.1)',
  translucent: 'rgba(255,255,255,0.05)',
};

const lightColors: typeof darkColors = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceElevated: '#F2F2F7',
  primary: '#000000',
  secondary: '#6C6C70',
  muted: '#D1D1D6',
  accent: '#007AFF',
  success: '#34C759',
  warning: '#FF9500',
  danger: '#FF3B30',
  border: 'rgba(0,0,0,0.1)',
  translucent: 'rgba(0,0,0,0.05)',
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isDark: true,
  colors: darkColors,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { preferences } = useStore();
  const reactNativeScheme = useColorScheme();
  const [currentScheme, setCurrentScheme] = useState(reactNativeScheme);
  const { setColorScheme: setTailwindColorScheme } = useTailwindColorScheme();

  // Listen for appearance changes to ensure reactive theme switching
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setCurrentScheme(colorScheme);
    });

    return () => subscription.remove();
  }, []);

  const resolvedTheme: 'dark' | 'light' = useMemo(() => {
    const activeScheme = currentScheme || reactNativeScheme || 'dark';
    if (preferences.theme === 'system') {
      return activeScheme === 'light' ? 'light' : 'dark';
    }
    return preferences.theme;
  }, [preferences.theme, currentScheme, reactNativeScheme]);

  const isDark = resolvedTheme === 'dark';
  const colors = isDark ? darkColors : lightColors;

  // Sync Tailwind (NativeWind) with our theme state
  useEffect(() => {
    setTailwindColorScheme(isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, isDark, colors }}>
      <View 
        key={resolvedTheme} // Force re-render of base view on theme change
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
