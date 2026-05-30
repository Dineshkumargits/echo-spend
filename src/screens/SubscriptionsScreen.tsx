import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect } from 'react';
import { View, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MotiView } from 'moti';
import { LucideCalendar, LucideRefreshCcw } from 'lucide-react-native';
import * as LucideIcons from 'lucide-react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { useStore } from '../store/useStore';
import { useIsFocused } from '@react-navigation/native';
import { getTransactions, Transaction, getCategories, Category } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';

export const SubscriptionsScreen = ({ navigation }: any) => {
  const { colors, isDark } = useTheme();
  const { preferences } = useStore();
  const [subscriptions, setSubscriptions] = useState<(Transaction & { nextDate: Date })[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) loadData();
  }, [isFocused]);

  const loadData = async () => {
    setLoading(true);
    const [allTxs, cats] = await Promise.all([
      getTransactions({ limit: 1000, confirmedOnly: true }),
      getCategories(),
    ]);
    
    setCategories(cats);

    // Group by merchant to find unique recurring ones. If they said 'isRecurring', filter them.
    const recurringTxs = allTxs.filter(t => t.isRecurring);

    // Grouping the latest recurring tx per merchant
    const latestPerMerchant = new Map<string, Transaction>();
    recurringTxs.forEach(tx => {
      const existing = latestPerMerchant.get(tx.merchant);
      if (!existing || new Date(tx.date) > new Date(existing.date)) {
        latestPerMerchant.set(tx.merchant, tx);
      }
    });

    const activeSubs = Array.from(latestPerMerchant.values()).map(tx => {
       // Estimate next date (e.g. +1 month)
       const date = new Date(tx.date);
       let nextDate = new Date(date);
       nextDate.setMonth(nextDate.getMonth() + 1);
       // if nextDate is in the past, keep incrementing until it's in the future
       while (nextDate < new Date()) {
         nextDate.setMonth(nextDate.getMonth() + 1);
       }
       return { ...tx, nextDate };
    }).sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());

    setSubscriptions(activeSubs);
    setLoading(false);
  };

  const totalMonthlyBurn = subscriptions.reduce((acc, sub) => acc + sub.amount, 0);

  const renderIcon = (iconName: string, color: string, size = 20) => {
    const Icon = (LucideIcons as any)[iconName] || LucideIcons.Zap;
    return <Icon color={color} size={size} />;
  };

  const getDaysUntil = (date: Date) => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const target = new Date(date);
    target.setHours(0,0,0,0);
    const diff = (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `In ${Math.ceil(diff)} days`;
  };

  return (
    <ThemedSafeAreaView>
      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: -20 }}
          animate={{ opacity: 1, translateY: 0 }}
          className="mt-6 mb-6"
        >
          <ThemedText type="secondary" className="text-sm uppercase tracking-widest flex-row items-center">
            <LucideRefreshCcw color={colors.secondary} size={12} /> Auto-Payments
          </ThemedText>
          <ThemedText className="text-3xl font-bold">Subscriptions</ThemedText>
        </MotiView>

        <MotiView
          from={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="p-6 rounded-apple-lg border mb-8 overflow-hidden"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
        >
          <View 
            className="absolute top-0 right-0 w-32 h-32 rounded-full -mr-10 -mt-10" 
            style={{ backgroundColor: `${colors.accent}10` }}
          />
          <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-2">Fixed Monthly Burn</ThemedText>
          <ThemedText className="text-4xl font-bold">
            {preferences.currency}{totalMonthlyBurn.toLocaleString('en-IN')}
          </ThemedText>
          <ThemedText type="secondary" className="text-xs mt-2">
            Across {subscriptions.length} active service{subscriptions.length !== 1 ? 's' : ''}
          </ThemedText>
        </MotiView>

        <View className="flex-row justify-between mb-4 items-center">
          <ThemedText className="font-bold text-xl">Upcoming Bills</ThemedText>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : subscriptions.length === 0 ? (
          <View 
            className="items-center mt-10 p-6 rounded-apple-lg border"
            style={{ backgroundColor: `${colors.surface}50`, borderColor: colors.border }}
          >
             <View className="w-16 h-16 rounded-full items-center justify-center mb-4" style={{ backgroundColor: colors.translucent }}>
                <LucideCalendar color={colors.secondary} size={32} />
             </View>
             <ThemedText className="font-bold text-center">No subscriptions yet</ThemedText>
             <ThemedText type="secondary" className="text-xs text-center mt-2 px-4">
               Mark your transactions as "Recurring" when adding them, and they will automatically appear here.
             </ThemedText>
          </View>
        ) : (
          <View className="mb-20">
            {subscriptions.map((sub, i) => {
              const cat = categories.find(c => c.name === sub.category);
              const daysText = getDaysUntil(sub.nextDate);
              const isUrgent = daysText === 'Today' || daysText === 'Tomorrow' || daysText.includes(' 2 ') || daysText.includes(' 3 ');
              
              return (
                <MotiView
                  key={sub.id}
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ delay: i * 50 }}
                  className="p-4 rounded-apple-md mb-3 flex-row justify-between items-center border"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  <View className="flex-row items-center flex-1 mr-4">
                    <View 
                      className="w-12 h-12 rounded-full items-center justify-center mr-4"
                      style={{ backgroundColor: `${cat?.color || colors.secondary}20` }}
                    >
                      {renderIcon(cat?.icon || 'Zap', cat?.color || colors.secondary, 20)}
                    </View>
                    <View className="flex-1">
                      <ThemedText className="font-bold text-lg" numberOfLines={1}>{sub.merchant}</ThemedText>
                      <View className="flex-row items-center mt-1">
                        <LucideCalendar color={colors.secondary} size={12} />
                        <ThemedText type="secondary" className="text-[10px] uppercase font-bold ml-1 mr-2">
                          {sub.nextDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </ThemedText>
                        <View className="px-1.5 py-0.5 rounded-sm" style={{ backgroundColor: isUrgent ? `${colors.danger}20` : colors.translucent }}>
                          <ThemedText style={{ fontSize: 9, color: isUrgent ? colors.danger : colors.secondary, fontWeight: 'bold' }}>
                            {daysText.toUpperCase()}
                          </ThemedText>
                        </View>
                      </View>
                    </View>
                  </View>
                  <ThemedText className="font-bold text-lg">
                    {preferences.currency}{sub.amount.toLocaleString('en-IN')}
                  </ThemedText>
                </MotiView>
              );
            })}
          </View>
        )}
      </ScrollView>
    </ThemedSafeAreaView>
  );
};

export default SubscriptionsScreen;
