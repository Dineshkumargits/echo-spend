import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { View, useColorScheme, Appearance } from 'react-native';
import { useStore } from '../store/useStore';
import { useColorScheme as useTailwindColorScheme } from 'nativewind';

import { buildColors, getPalette, darkColors, fonts, typeScale, spacing, radius, motion } from './tokens';

interface ThemeContextValue {
  theme: 'dark' | 'light';
  isDark: boolean;
  themeId: string;
  colors: typeof darkColors;
  fonts: typeof fonts;
  typeScale: typeof typeScale;
  spacing: typeof spacing;
  radius: typeof radius;
  motion: typeof motion;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  isDark: true,
  themeId: 'echo',
  colors: darkColors,
  fonts,
  typeScale,
  spacing,
  radius,
  motion,
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
  const themeId = preferences.themeId || 'echo';

  // Resolve the selected curated pack + mode into semantic colors.
  const colors = useMemo(
    () => buildColors(getPalette(themeId, resolvedTheme)),
    [themeId, resolvedTheme]
  );

  // Sync Tailwind (NativeWind) with our theme state
  useEffect(() => {
    setTailwindColorScheme(isDark ? 'dark' : 'light');
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, isDark, themeId, colors, fonts, typeScale, spacing, radius, motion }}>
      <View
        key={`${themeId}-${resolvedTheme}`} // Force re-render of base view on theme change
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        {children}
      </View>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
