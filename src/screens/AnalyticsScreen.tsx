import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MotiView } from 'moti';
import { LineChart } from 'react-native-wagmi-charts';
import {
  LucideAlertCircle,
  LucideLightbulb,
  LucideX,
  LucideTrendingDown,
  LucideTrendingUp,
  LucideRefreshCw,
} from 'lucide-react-native';
import { Dimensions } from 'react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { notify } from '../utils/notify';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
import {
  getSpendTrend,
  getCategoryBreakdown,
  getSpendingByTag,
  getMonthlyTotals,
  getCategories,
  dismissInsight,
  SpendTrendPoint,
  CategoryBreakdown,
  Insight,
  Category,
} from '../services/database';
import { useAIInsights } from '../hooks/useAIInsights';
import { useTheme } from '../theme/ThemeProvider';
import { useStore } from '../store/useStore';

const INSIGHT_ICONS: Record<string, any> = {
  anomaly: LucideAlertCircle,
  suggestion: LucideLightbulb,
  weekly_digest: LucideTrendingDown,
  recurring_detected: LucideRefreshCw,
};

const INSIGHT_COLORS: Record<string, string> = {
  anomaly: '#FF453A',
  suggestion: '#30D158',
  weekly_digest: '#0A84FF',
  recurring_detected: '#BF5AF2',
};

const AnalyticsScreen = () => {
  const { colors, isDark } = useTheme();
  const [trend, setTrend] = useState<SpendTrendPoint[]>([]);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown[]>([]);
  const [tagsBreakdown, setTagsBreakdown] = useState<{ tag: string; total: number; count: number }[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<any[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [trendDays, setTrendDays] = useState(7);
  const { getInsights, generateInsights } = useAIInsights();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';

  const loadData = useCallback(async () => {
    const dStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10) + ' 00:00:00';
    const dEnd = new Date().toISOString().slice(0, 10) + ' 23:59:59';
    const [t, b, m, i, cats, tb] = await Promise.all([
      getSpendTrend(trendDays),
      getCategoryBreakdown(),
      getMonthlyTotals(),
      getInsights(),
      getCategories(),
      getSpendingByTag(dStart, dEnd),
    ]);
    setTrend(t);
    setBreakdown(b);
    setMonthlyTotals(m);
    setInsights(i);
    setCategories(cats);
    setTagsBreakdown(tb);
    setLoading(false);
    setRefreshing(false);
  }, [trendDays, getInsights]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const handleGenerateInsights = async () => {
    setGeneratingInsights(true);
    try {
      const fresh = await generateInsights();
      setInsights(fresh);
      notify.success('Insights updated');
    } catch {
      notify.error('Failed to generate insights');
    }
    setGeneratingInsights(false);
  };

  const handleDismissInsight = async (id: number) => {
    await dismissInsight(id);
    setInsights(prev => prev.filter(i => i.id !== id));
  };

  // Convert trend to wagmi chart format
  const chartData = trend
    .filter(p => p.total > 0 || true)
    .map((p, i) => ({
      timestamp: new Date(p.date).getTime() + i,
      value: p.total,
    }));

  const totalThisPeriod = trend.reduce((s, p) => s + p.total, 0);
  const maxDay = trend.reduce((m, p) => p.total > m.total ? p : m, trend[0] || { date: '', total: 0 });


  if (loading) {
    return (
      <ThemedSafeAreaView className="items-center justify-center">
        <ActivityIndicator color={colors.accent} size="large" />
      </ThemedSafeAreaView>
    );
  }

  return (
    <ThemedSafeAreaView>
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <MotiView
          from={{ opacity: 0, translateY: -20 }}
          animate={{ opacity: 1, translateY: 0 }}
          className="mt-4 mb-6"
        >
          <ThemedText type="secondary" className="text-sm uppercase tracking-widest">Analytics</ThemedText>
          <ThemedText className="text-3xl font-bold">Trends</ThemedText>
        </MotiView>

        {/* Trend period selector */}
        <View className="flex-row mb-4 p-1 rounded-full self-start" style={{ backgroundColor: colors.translucent }}>
          {[7, 14, 30].map(d => (
            <TouchableOpacity
              key={d}
              onPress={() => setTrendDays(d)}
              className={`px-4 py-1.5 rounded-full ${trendDays === d ? 'shadow-sm' : ''}`}
              style={{ backgroundColor: trendDays === d ? colors.accent : 'transparent' }}
            >
              <ThemedText
                className="text-xs font-bold"
                style={{ color: trendDays === d ? '#FFFFFF' : colors.secondary }}
              >
                {d}D
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {/* Spend trend chart */}
        <View className="p-4 rounded-apple-md border mb-6" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <View className="mb-4">
            <ThemedText type="secondary" className="text-xs">Total Spend ({trendDays}D)</ThemedText>
            <ThemedText className="text-2xl font-bold">{currency}{totalThisPeriod.toLocaleString('en-IN')}</ThemedText>
            {maxDay.total > 0 && (
              <ThemedText type="secondary" className="text-xs mt-1">
                Peak: {maxDay.date} — {currency}{maxDay.total.toLocaleString('en-IN')}
              </ThemedText>
            )}
          </View>

          {chartData.length >= 2 ? (
            <View style={{ overflow: 'hidden' }}>
              <LineChart.Provider data={chartData}>
                <LineChart height={140} width={SCREEN_WIDTH - 80}>
                  <LineChart.Path color={colors.accent} />
                  <LineChart.CursorCrosshair color={colors.primary} />
                </LineChart>
              </LineChart.Provider>
            </View>
          ) : (
            <View className="h-[140px] items-center justify-center">
              <ThemedText type="secondary" className="text-sm">Not enough data for chart</ThemedText>
            </View>
          )}

          <View className="flex-row justify-between mt-3">
            {trend.map((p, i) => (
              <ThemedText key={i} type="secondary" className="text-[9px] text-center" style={{ flex: 1 }}>
                {new Date(p.date).toLocaleDateString('en-IN', { weekday: 'short' }).charAt(0)}
              </ThemedText>
            ))}
          </View>
        </View>

        {/* Monthly Income vs Expense */}
        {monthlyTotals.length > 0 && (
          <View className="mb-6">
            <ThemedText className="text-lg font-bold mb-3">Monthly Overview</ThemedText>
            {monthlyTotals.slice(0, 3).map((row, i) => (
              <MotiView
                key={row.month}
                from={{ opacity: 0, translateX: -16 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ delay: i * 80 }}
                className="p-4 rounded-apple-md border mb-3"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <View className="flex-row justify-between items-center mb-2">
                  <ThemedText className="font-bold">
                    {new Date(row.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                  </ThemedText>
                </View>
                <View className="flex-row justify-between">
                  <View className="flex-row items-center">
                    <LucideTrendingDown color={colors.danger} size={14} />
                    <ThemedText className="text-sm ml-1">{currency}{Number(row.expense).toLocaleString('en-IN')}</ThemedText>
                  </View>
                  <View className="flex-row items-center">
                    <LucideTrendingUp color={colors.success} size={14} />
                    <ThemedText className="text-sm ml-1" style={{ color: colors.success }}>{currency}{Number(row.income).toLocaleString('en-IN')}</ThemedText>
                  </View>
                  <ThemedText className="text-sm font-bold" style={{ color: row.income >= row.expense ? colors.success : colors.danger }}>
                    {row.income >= row.expense ? '+' : '-'}{currency}{Math.abs(row.income - row.expense).toLocaleString('en-IN')}
                  </ThemedText>
                </View>
              </MotiView>
            ))}
          </View>
        )}

        {/* Category breakdown */}
        <View className="mb-6">
          <ThemedText className="text-lg font-bold mb-3">This Month</ThemedText>
          {breakdown.length === 0 ? (
            <View className="py-10 items-center">
              <ThemedText type="secondary">No confirmed transactions this month.</ThemedText>
            </View>
          ) : (
            (() => {
              // Group breakdown by parent category
              const parentGroups = new Map<string, { total: number; count: number; subs: any[] }>();
              
              breakdown.forEach(item => {
                const catDef = categories.find(c => c.name === item.category);
                const parent = catDef?.parentId ? categories.find(c => c.id === catDef.parentId) : null;
                const parentName = parent?.name || item.category; // fallback to self if no parent

                const existing = parentGroups.get(parentName) || { total: 0, count: 0, subs: [] };
                existing.total += item.total;
                existing.count += item.count;
                if (parent) {
                  existing.subs.push(item);
                }
                parentGroups.set(parentName, existing);
              });

              return Array.from(parentGroups.entries())
                .sort((a, b) => b[1].total - a[1].total)
                .map(([parentName, data], index) => {
                  const parentDef = categories.find(c => c.name === parentName);
                  const catIcon = parentDef?.icon || 'HelpCircle';
                  const catColor = parentDef?.color || colors.secondary;
                  const totalPct = Math.round((data.total / totalThisPeriod) * 100) || 0;

                  return (
                    <MotiView
                      key={parentName}
                      from={{ opacity: 0, translateX: -20 }}
                      animate={{ opacity: 1, translateX: 0 }}
                      transition={{ delay: index * 60 }}
                      className="mb-4 p-4 rounded-apple-md border"
                      style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                    >
                      <View className="flex-row justify-between items-center mb-2">
                        <View className="flex-row items-center flex-1">
                          <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: `${catColor}20` }}>
                            {renderCategoryIcon(catIcon, catColor, 14)}
                          </View>
                          <ThemedText className="font-bold">{parentName}</ThemedText>
                        </View>
                        <View className="items-end">
                          <ThemedText className="font-bold">{currency}{data.total.toLocaleString('en-IN')}</ThemedText>
                          <ThemedText type="secondary" className="text-[10px]">{data.count} txn{data.count !== 1 ? 's' : ''}</ThemedText>
                        </View>
                      </View>
                      
                      <View className="h-1.5 rounded-full bg-border overflow-hidden mb-3">
                        <View className="h-full" style={{ backgroundColor: catColor, width: `${totalPct}%` }} />
                      </View>

                      {data.subs.length > 0 && (
                        <View className="border-t pt-2" style={{ borderTopColor: colors.border }}>
                          {data.subs.sort((a, b) => b.total - a.total).map(sub => (
                            <View key={sub.category} className="flex-row justify-between items-center py-1.5">
                              <ThemedText type="secondary" className="text-xs">• {sub.category}</ThemedText>
                              <ThemedText type="secondary" className="text-xs font-medium">{currency}{sub.total.toLocaleString('en-IN')}</ThemedText>
                            </View>
                          ))}
                        </View>
                      )}
                    </MotiView>
                  );
                });
            })()
          )}
        </View>

        {/* Tags breakdown */}
        {tagsBreakdown.length > 0 && (
          <View className="mb-6">
            <ThemedText className="text-lg font-bold mb-3">Top Tags (This Month)</ThemedText>
            <View className="flex-row flex-wrap justify-between">
              {tagsBreakdown.map((tag, index) => (
                <MotiView
                  key={tag.tag}
                  from={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 40 }}
                  className="px-4 py-3 mb-3 rounded-xl border flex-row items-center justify-between"
                  style={{ backgroundColor: colors.surface, borderColor: `${colors.accent}40`, width: '48%' }}
                >
                  <View>
                    <ThemedText className="font-bold text-sm" style={{ color: colors.accent }} numberOfLines={1}>#{tag.tag}</ThemedText>
                    <ThemedText type="secondary" className="text-[10px] mt-0.5">{tag.count} txn{tag.count !== 1 ? 's' : ''}</ThemedText>
                  </View>
                  <ThemedText className="font-bold text-sm ml-2">{currency}{tag.total >= 1000 ? (tag.total / 1000).toFixed(1) + 'k' : tag.total}</ThemedText>
                </MotiView>
              ))}
            </View>
          </View>
        )}

        {/* AI Insights */}
        <View className="mb-8">
          <View className="flex-row justify-between items-center mb-3">
            <ThemedText className="text-lg font-bold">AI Insights</ThemedText>
            <TouchableOpacity
              onPress={handleGenerateInsights}
              disabled={generatingInsights}
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{ backgroundColor: `${colors.accent}20` }}
            >
              {generatingInsights ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <>
                  <LucideRefreshCw color={colors.accent} size={12} />
                  <ThemedText className="text-xs font-bold ml-1" style={{ color: colors.accent }}>Refresh</ThemedText>
                </>
              )}
            </TouchableOpacity>
          </View>

          {insights.length === 0 ? (
            <TouchableOpacity
              onPress={handleGenerateInsights}
              className="border border-dashed p-6 rounded-apple-md items-center"
              style={{ borderColor: colors.secondary }}
            >
              <LucideLightbulb color={colors.muted} size={32} />
              <ThemedText type="secondary" className="text-sm mt-3 text-center">
                Tap to generate AI-powered insights from your spending data.
              </ThemedText>
            </TouchableOpacity>
          ) : (
            insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || LucideLightbulb;
              const color = INSIGHT_COLORS[insight.type] || colors.accent;
              return (
                <MotiView
                  key={insight.id}
                  from={{ opacity: 0, translateY: 10 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ delay: i * 60 }}
                  className="p-4 rounded-apple-md border mb-3 flex-row items-start"
                  style={{ backgroundColor: `${color}15`, borderColor: colors.border }}
                >
                  <View
                    className="w-9 h-9 rounded-full items-center justify-center mr-3 mt-0.5"
                    style={{ backgroundColor: `${color}25` }}
                  >
                    <Icon color={color} size={18} />
                  </View>
                  <View className="flex-1">
                    <ThemedText className="font-bold text-sm" style={{ color: isDark ? colors.primary : color }}>{insight.title}</ThemedText>
                    <ThemedText type="secondary" className="text-xs mt-1 leading-4">{insight.body}</ThemedText>
                  </View>
                  <TouchableOpacity onPress={() => handleDismissInsight(insight.id)} className="ml-2 p-1">
                    <LucideX color={colors.secondary} size={14} />
                  </TouchableOpacity>
                </MotiView>
              );
            })
          )}
        </View>
      </ScrollView>
    </ThemedSafeAreaView>
  );
};

export default AnalyticsScreen;
