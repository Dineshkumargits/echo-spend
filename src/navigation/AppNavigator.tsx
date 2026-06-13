import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef } from '../../App';
import { useStore } from '../store/useStore';
import OnboardingScreen from '../screens/OnboardingScreen';
import { TabNavigator } from './TabNavigator';
import SmartInboxScreen from '../screens/SmartInboxScreen';
import BudgetScreen from '../screens/BudgetScreen';
import CategoriesScreen from '../screens/CategoriesScreen';
import SearchScreen from '../screens/SearchScreen';
import AddTransactionScreen from '../screens/AddTransactionScreen';
import AddAccountScreen from '../screens/AddAccountScreen';
import EditTransactionScreen from '../screens/EditTransactionScreen';
import SmartScanScreen from '../screens/SmartScanScreen';
import AddGoalScreen from '../screens/AddGoalScreen';
import AddLoanScreen from '../screens/AddLoanScreen';
import AddSubscriptionScreen from '../screens/AddSubscriptionScreen';
import SubscriptionsScreen from '../screens/SubscriptionsScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import TransactionDetailScreen from '../screens/TransactionDetailScreen';
import BankAccountDetailScreen from '../screens/BankAccountDetailScreen';
import SplitExpenseScreen from '../screens/SplitExpenseScreen';
import SplitDetailScreen from '../screens/SplitDetailScreen';
import { useTheme } from '../theme/ThemeProvider';

import ManageAccountsScreen from '../screens/ManageAccountsScreen';
import TipsScreen from '../screens/TipsScreen';

const Stack = createStackNavigator();

export const AppNavigator = () => {
  const isOnboarded = useStore(state => state.isOnboarded);
  const { colors } = useTheme();

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          cardStyle: { backgroundColor: colors.background },
        }}
      >
        {!isOnboarded ? (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={TabNavigator} />
            <Stack.Screen name="ManageAccounts" component={ManageAccountsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="SmartInbox" component={SmartInboxScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Budget" component={BudgetScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="Categories" component={CategoriesScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="Search" component={SearchScreen} />
            <Stack.Screen name="AddTransaction" component={AddTransactionScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="AddAccount" component={AddAccountScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="EditTransaction" component={EditTransactionScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="SmartScan" component={SmartScanScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="AddGoal" component={AddGoalScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="AddLoan" component={AddLoanScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="AddSubscription" component={AddSubscriptionScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="Subscriptions" component={SubscriptionsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="Analytics" component={AnalyticsScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="BankAccountDetail" component={BankAccountDetailScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="SplitExpense" component={SplitExpenseScreen} options={{ presentation: 'modal' }} />
            <Stack.Screen name="SplitDetail" component={SplitDetailScreen} options={{ presentation: 'card' }} />
            <Stack.Screen name="Tips" component={TipsScreen} options={{ presentation: 'card' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
