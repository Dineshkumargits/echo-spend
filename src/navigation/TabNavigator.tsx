import React, { memo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  LucideLayoutDashboard,
  LucideCalendar,
  LucideSettings,
  LucideZap,
  LucideReceiptText,
} from 'lucide-react-native';
import DashboardScreen from '../screens/DashboardScreen';
import TransactionsScreen from '../screens/TransactionsScreen';
import SmartScanTab from '../screens/SmartScanTab';
import FinancesScreen from '../screens/FinancesScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';
import { fonts } from '../theme/tokens';

const Tab = createBottomTabNavigator();

/**
 * Custom elevated center tab button for Smart Scan.
 * Wrapped in React.memo so it never re-renders from tab-bar parent renders,
 * eliminating the jank caused by the former MotiView re-animating every time.
 */
const ScanTabButton = memo(({ onPress }: { onPress?: (...args: any[]) => void }) => {
  const { colors, isDark } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={scanBtnStyles.wrapper}
    >
      {/* Static echo ring — the scan button is the app's live "emitter" */}
      <View
        pointerEvents="none"
        style={[scanBtnStyles.echoRing, { borderColor: colors.accent }]}
      />
      <View
        style={[
          scanBtnStyles.circle,
          {
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            borderColor: colors.background,
          },
        ]}
      >
        <LucideZap color={colors.onAccent} size={26} />
      </View>
    </TouchableOpacity>
  );
});

const scanBtnStyles = StyleSheet.create({
  wrapper: {
    top: -20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  echoRing: {
    position: 'absolute',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    opacity: 0.35,
  },
  circle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 10,
    borderWidth: 3,
  },
});

export const TabNavigator = ({ navigation }: any) => {
  const { colors, isDark } = useTheme();
  const launchScreen = useStore(state => state.preferences.defaultLaunchScreen);

  // Navigate to SmartInbox modal on first mount if preferred
  React.useEffect(() => {
    if (launchScreen === 'SmartInbox') {
      // Use a short delay so the tab navigator finishes mounting first
      const t = setTimeout(() => navigation.navigate('SmartInbox'), 100);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingTop: 8,
          height: 85,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.secondary,
        tabBarLabelStyle: {
          fontSize: 9,
          fontFamily: fonts.signal,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
          marginBottom: 10,
        },
        tabBarIcon: ({ color, size }) => {
          if (route.name === 'Home') return <LucideLayoutDashboard color={color} size={size} />;
          if (route.name === 'Txns') return <LucideReceiptText color={color} size={size} />;
          if (route.name === 'Finances') return <LucideCalendar color={color} size={size} />;
          if (route.name === 'Settings') return <LucideSettings color={color} size={size} />;
          return null;
        },
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Txns" component={TransactionsScreen} options={{ tabBarLabel: 'Txns' }} />
      <Tab.Screen
        name="Scan"
        component={SmartScanTab}
        options={{
          tabBarLabel: () => null,
          tabBarIcon: () => null,
          tabBarButton: (props) => <ScanTabButton onPress={props.onPress} />,
        }}
      />
      <Tab.Screen name="Finances" component={FinancesScreen} options={{ tabBarLabel: 'Money' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ tabBarLabel: 'More' }} />
    </Tab.Navigator>
  );
};
