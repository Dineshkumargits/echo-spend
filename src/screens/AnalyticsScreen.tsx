import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MotiView } from 'moti';
import { LineChart } from 'react-native-wagmi-charts';
import Svg, { Path, Circle } from 'react-native-svg';
import {
  LucideAlertCircle,
  LucideLightbulb,
  LucideX,
  LucideTrendingDown,
  LucideRefreshCw,
  LucideFlame,
} from 'lucide-react-native';
import { Dimensions } from 'react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { notify } from '../utils/notify';
import { SectionLabel, AmountText } from '../components/Signal';
import { fonts } from '../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
import {
  getSpendTrend,
  getCategoryBreakdown,
  getSpendingByTag,
  getMonthlyTotals,
  getCategories,
  getBudgetUtilization,
  getHighSpendTransactions,
  dismissInsight,
  SpendTrendPoint,
  CategoryBreakdown,
  Insight,
  Category,
  Budget,
  Transaction,
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

// ─── Donut chart (SVG stroke arcs) ───────────────────────────────────────────

const polarPoint = (cx: number, cy: number, r: number, angleDeg: number) => {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
};

const arcPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
  const start = polarPoint(cx, cy, r, endAngle);
  const end = polarPoint(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
};

interface DonutSegment { value: number; color: string; label: string }

const DonutChart = ({ segments, size = 168, strokeWidth = 20, centerTitle, centerValue, textColor, mutedColor }: {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerTitle: string;
  centerValue: string;
  textColor: string;
  mutedColor: string;
}) => {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const gapDeg = segments.length > 1 ? 3 : 0;

  let cursor = 0;
  const paths = segments.map((seg, i) => {
    const sweep = (seg.value / total) * (360 - gapDeg * segments.length);
    const d = arcPath(cx, cy, r, cursor, cursor + Math.max(sweep, 1));
    cursor += sweep + gapDeg;
    return <Path key={i} d={d} stroke={seg.color} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />;
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke={mutedColor} strokeOpacity={0.15} strokeWidth={strokeWidth} fill="none" />
        {paths}
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <ThemedText font="signal" style={{ fontSize: 9, letterSpacing: 1.4, textTransform: 'uppercase', color: mutedColor }}>
          {centerTitle}
        </ThemedText>
        <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 18, color: textColor, fontVariant: ['tabular-nums'], marginTop: 2 }}>
          {centerValue}
        </ThemedText>
      </View>
    </View>
  );
};

const AnalyticsScreen = () => {
  const { colors, isDark } = useTheme();
  const [trend, setTrend] = useState<SpendTrendPoint[]>([]);
  const [rhythm, setRhythm] = useState<SpendTrendPoint[]>([]);
  const [breakdown, setBreakdown] = useState<CategoryBreakdown[]>([]);
  const [tagsBreakdown, setTagsBreakdown] = useState<{ tag: string; total: number; count: number }[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<any[]>([]);
  const [budgetUtil, setBudgetUtil] = useState<{ budget: Budget; spent: number; percentage: number }[]>([]);
  const [highSpends, setHighSpends] = useState<Transaction[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [trendDays, setTrendDays] = useState(7);
  const { getInsights, generateInsights } = useAIInsights();
  const { preferences } = useStore();
  const currency = preferences?.currency ?? '₹';
  const onFill = colors.onAccent;

  const INSIGHT_COLORS: Record<string, string> = {
    anomaly: colors.danger,
    suggestion: colors.credit,
    weekly_digest: colors.ai,
    recurring_detected: colors.debit,
  };

  const loadData = useCallback(async () => {
    const dStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10) + ' 00:00:00';
    const dEnd = new Date().toISOString().slice(0, 10) + ' 23:59:59';
    const [t, r30, b, m, i, cats, tb, bu, hs] = await Promise.all([
      getSpendTrend(trendDays),
      getSpendTrend(30),
      getCategoryBreakdown(),
      getMonthlyTotals(),
      getInsights(),
      getCategories(),
      getSpendingByTag(dStart, dEnd),
      getBudgetUtilization(preferences.salaryDay),
      getHighSpendTransactions(),
    ]);
    setTrend(t);
    setRhythm(r30);
    setBreakdown(b);
    setMonthlyTotals(m);
    setInsights(i);
    setCategories(cats);
    setTagsBreakdown(tb);
    setBudgetUtil(bu);
    setHighSpends(hs.slice(0, 6));
    setLoading(false);
    setRefreshing(false);
  }, [trendDays, getInsights, preferences.salaryDay]);

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

  const fmt = useCallback((n: number) => {
    if (preferences.hideAmounts) return '••••';
    return `${currency}${Math.round(n).toLocaleString('en-IN')}`;
  }, [currency, preferences.hideAmounts]);

  const fmtShort = useCallback((n: number) => {
    if (preferences.hideAmounts) return '••';
    if (n >= 100000) return `${currency}${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `${currency}${(n / 1000).toFixed(1)}k`;
    return `${currency}${Math.round(n)}`;
  }, [currency, preferences.hideAmounts]);

  // This month's income/expense/net from the most recent monthly total
  const thisMonth = monthlyTotals[0] ?? { income: 0, expense: 0 };
  const monthNet = Number(thisMonth.income) - Number(thisMonth.expense);

  // Donut segments: top 5 parent groups + "Other"
  const donutSegments = useMemo<DonutSegment[]>(() => {
    if (breakdown.length === 0) return [];
    const groups = new Map<string, number>();
    breakdown.forEach(item => {
      const catDef = categories.find(c => c.name === item.category);
      const parent = catDef?.parentId ? categories.find(c => c.id === catDef.parentId) : null;
      const parentName = parent?.name || item.category;
      groups.set(parentName, (groups.get(parentName) || 0) + item.total);
    });
    const sorted = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    const segs: DonutSegment[] = top.map(([name, value]) => ({
      label: name,
      value,
      color: categories.find(c => c.name === name && !c.parentId)?.color || colors.secondary,
    }));
    if (rest > 0) segs.push({ label: 'Other', value: rest, color: colors.muted });
    return segs;
  }, [breakdown, categories, colors]);

  const monthTotalSpend = donutSegments.reduce((s, seg) => s + seg.value, 0);
  const rhythmMax = Math.max(...rhythm.map(p => p.total), 1);
  const monthlyMax = Math.max(...monthlyTotals.map(r => Math.max(Number(r.income), Number(r.expense))), 1);

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
          <SectionLabel>Analytics</SectionLabel>
          <ThemedText className="text-3xl" style={{ fontFamily: fonts.displayBold }}>Your money, visualized</ThemedText>
        </MotiView>

        {/* Stat tiles */}
        <View className="flex-row mb-6" style={{ gap: 10 }}>
          {[
            { label: `Spend · ${trendDays}d`, value: fmtShort(totalThisPeriod), color: colors.accent },
            { label: 'Income · month', value: fmtShort(Number(thisMonth.income)), color: colors.credit },
            { label: 'Net · month', value: `${monthNet < 0 ? '−' : '+'}${fmtShort(Math.abs(monthNet))}`, color: monthNet >= 0 ? colors.credit : colors.danger },
          ].map((tile, i) => (
            <MotiView
              key={tile.label}
              from={{ opacity: 0, translateY: 8 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ delay: i * 60 }}
              className="flex-1 p-3 rounded-apple-md border"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <ThemedText font="signal" style={{ fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', color: colors.secondary }} numberOfLines={1}>
                {tile.label}
              </ThemedText>
              <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 16, color: tile.color, marginTop: 4, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {tile.value}
              </ThemedText>
            </MotiView>
          ))}
        </View>

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
                style={{ color: trendDays === d ? onFill : colors.secondary }}
              >
                {d}D
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>

        {/* Spend trend chart */}
        <View className="p-4 rounded-apple-md border mb-6" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <View className="mb-4">
            <SectionLabel>Total spend · {trendDays}d</SectionLabel>
            <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 26, marginTop: 4, fontVariant: ['tabular-nums'] }}>
              {fmt(totalThisPeriod)}
            </ThemedText>
            {maxDay.total > 0 && (
              <ThemedText font="signal" style={{ fontSize: 10, color: colors.secondary, marginTop: 4 }}>
                peak {new Date(maxDay.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {fmt(maxDay.total)}
              </ThemedText>
            )}
          </View>

          {chartData.length >= 2 ? (
            <View style={{ overflow: 'hidden' }}>
              <LineChart.Provider data={chartData}>
                <LineChart height={140} width={SCREEN_WIDTH - 80}>
                  <LineChart.Path color={colors.accent}>
                    <LineChart.Gradient color={colors.accent} />
                  </LineChart.Path>
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
              <ThemedText key={i} font="signal" className="text-center" style={{ flex: 1, fontSize: 8, color: colors.secondary }}>
                {new Date(p.date).toLocaleDateString('en-IN', { weekday: 'short' }).charAt(0)}
              </ThemedText>
            ))}
          </View>
        </View>

        {/* Spending rhythm — 30-day heatmap */}
        <View className="p-4 rounded-apple-md border mb-6" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
          <SectionLabel>Spending rhythm · last 30 days</SectionLabel>
          <View className="flex-row flex-wrap mt-3" style={{ gap: 5 }}>
            {rhythm.map((p, i) => {
              const intensity = p.total / rhythmMax;
              return (
                <View
                  key={i}
                  style={{
                    width: (SCREEN_WIDTH - 48 - 32 - 5 * 9) / 10,
                    height: 26,
                    borderRadius: 6,
                    backgroundColor: p.total > 0 ? colors.debit : colors.surfaceElevated,
                    opacity: p.total > 0 ? 0.25 + intensity * 0.75 : 1,
                  }}
                />
              );
            })}
          </View>
          <View className="flex-row justify-between mt-2">
            <ThemedText font="signal" style={{ fontSize: 8, color: colors.secondary }}>
              {rhythm[0] ? new Date(rhythm[0].date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
            </ThemedText>
            <ThemedText font="signal" style={{ fontSize: 8, color: colors.secondary }}>
              brighter = heavier spend day
            </ThemedText>
            <ThemedText font="signal" style={{ fontSize: 8, color: colors.secondary }}>
              {rhythm.length > 0 ? new Date(rhythm[rhythm.length - 1].date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
            </ThemedText>
          </View>
        </View>

        {/* Monthly income vs expense — mirrored signal bars */}
        {monthlyTotals.length > 0 && (
          <View className="p-4 rounded-apple-md border mb-6" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            <SectionLabel>In vs out · last {monthlyTotals.length} months</SectionLabel>
            <View className="flex-row justify-between mt-3 mb-2">
              <ThemedText font="signal" style={{ fontSize: 9, color: colors.debit }}>◀ OUT</ThemedText>
              <ThemedText font="signal" style={{ fontSize: 9, color: colors.credit }}>IN ▶</ThemedText>
            </View>
            {monthlyTotals.map((row, i) => {
              const expW = Math.max(2, (Number(row.expense) / monthlyMax) * 100);
              const incW = Math.max(2, (Number(row.income) / monthlyMax) * 100);
              const net = Number(row.income) - Number(row.expense);
              return (
                <MotiView
                  key={row.month}
                  from={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 60 }}
                  className="mb-3"
                >
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    {/* expense (left, amber) */}
                    <View className="flex-1 flex-row justify-end items-center" style={{ gap: 6 }}>
                      <ThemedText font="signal" style={{ fontSize: 9, color: colors.secondary }}>{fmtShort(Number(row.expense))}</ThemedText>
                      <View style={{ width: `${expW * 0.6}%`, height: 10, borderRadius: 5, backgroundColor: colors.debit, opacity: 0.9 }} />
                    </View>
                    <ThemedText font="signal" style={{ fontSize: 9, color: colors.primary, width: 32, textAlign: 'center' }}>
                      {new Date(row.month + '-01').toLocaleDateString('en-IN', { month: 'short' })}
                    </ThemedText>
                    {/* income (right, aqua) */}
                    <View className="flex-1 flex-row justify-start items-center" style={{ gap: 6 }}>
                      <View style={{ width: `${incW * 0.6}%`, height: 10, borderRadius: 5, backgroundColor: colors.credit, opacity: 0.9 }} />
                      <ThemedText font="signal" style={{ fontSize: 9, color: colors.secondary }}>{fmtShort(Number(row.income))}</ThemedText>
                    </View>
                  </View>
                  <ThemedText font="signal" style={{ fontSize: 8, color: net >= 0 ? colors.credit : colors.danger, textAlign: 'center', marginTop: 2 }}>
                    net {net >= 0 ? '+' : '−'}{fmtShort(Math.abs(net))}
                  </ThemedText>
                </MotiView>
              );
            })}
          </View>
        )}

        {/* Category breakdown with donut */}
        <View className="mb-6">
          <ThemedText className="text-lg mb-3" style={{ fontFamily: fonts.displayBold }}>Where it went</ThemedText>
          {breakdown.length === 0 ? (
            <View className="py-10 items-center">
              <ThemedText type="secondary">No confirmed transactions this month.</ThemedText>
            </View>
          ) : (
            <>
              {/* Donut + legend */}
              <View className="p-4 rounded-apple-md border mb-4 flex-row items-center" style={{ backgroundColor: colors.surface, borderColor: colors.border, gap: 16 }}>
                <DonutChart
                  segments={donutSegments}
                  centerTitle="This month"
                  centerValue={fmtShort(monthTotalSpend)}
                  textColor={colors.primary}
                  mutedColor={colors.secondary}
                />
                <View className="flex-1" style={{ gap: 8 }}>
                  {donutSegments.map(seg => (
                    <View key={seg.label} className="flex-row items-center" style={{ gap: 8 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: seg.color }} />
                      <ThemedText className="text-xs flex-1" numberOfLines={1}>{seg.label}</ThemedText>
                      <ThemedText font="signal" style={{ fontSize: 10, color: colors.secondary }}>
                        {Math.round((seg.value / (monthTotalSpend || 1)) * 100)}%
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </View>

              {(() => {
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
                    const totalPct = Math.round((data.total / (monthTotalSpend || 1)) * 100) || 0;

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
                            <ThemedText style={{ fontFamily: fonts.signalBold, fontVariant: ['tabular-nums'] }}>{fmt(data.total)}</ThemedText>
                            <ThemedText type="secondary" className="text-[10px]">{data.count} txn{data.count !== 1 ? 's' : ''} · {totalPct}%</ThemedText>
                          </View>
                        </View>

                        <View className="h-1.5 rounded-full overflow-hidden mb-3" style={{ backgroundColor: colors.surfaceElevated }}>
                          <View className="h-full" style={{ backgroundColor: catColor, width: `${totalPct}%` }} />
                        </View>

                        {data.subs.length > 0 && (
                          <View className="border-t pt-2" style={{ borderTopColor: colors.border }}>
                            {data.subs.sort((a, b) => b.total - a.total).map(sub => (
                              <View key={sub.category} className="flex-row justify-between items-center py-1.5">
                                <ThemedText type="secondary" className="text-xs">• {sub.category}</ThemedText>
                                <ThemedText font="signal" style={{ fontSize: 11, color: colors.secondary, fontVariant: ['tabular-nums'] }}>{fmt(sub.total)}</ThemedText>
                              </View>
                            ))}
                          </View>
                        )}
                      </MotiView>
                    );
                  });
              })()}
            </>
          )}
        </View>

        {/* Budget watch */}
        {budgetUtil.length > 0 && (
          <View className="mb-6">
            <ThemedText className="text-lg mb-3" style={{ fontFamily: fonts.displayBold }}>Budget watch</ThemedText>
            <View className="p-4 rounded-apple-md border" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              {budgetUtil
                .slice()
                .sort((a, b) => b.percentage - a.percentage)
                .map(({ budget, spent, percentage }, i) => {
                  const barColor = percentage >= 100 ? colors.danger : percentage >= 80 ? colors.debit : colors.credit;
                  return (
                    <View key={budget.id} className={i > 0 ? 'mt-4' : ''}>
                      <View className="flex-row justify-between items-center mb-1.5">
                        <ThemedText className="text-sm font-bold">{budget.categoryName}</ThemedText>
                        <ThemedText font="signal" style={{ fontSize: 10, color: barColor, fontVariant: ['tabular-nums'] }}>
                          {fmtShort(spent)} / {fmtShort(budget.amount)} · {percentage}%
                        </ThemedText>
                      </View>
                      <View className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.surfaceElevated }}>
                        <View className="h-full rounded-full" style={{ backgroundColor: barColor, width: `${Math.min(percentage, 100)}%` }} />
                      </View>
                    </View>
                  );
                })}
            </View>
          </View>
        )}

        {/* Tags breakdown */}
        {tagsBreakdown.length > 0 && (
          <View className="mb-6">
            <ThemedText className="text-lg mb-3" style={{ fontFamily: fonts.displayBold }}>Top tags this month</ThemedText>
            <View className="flex-row flex-wrap justify-between">
              {tagsBreakdown.map((tag, index) => (
                <MotiView
                  key={tag.tag}
                  from={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 40 }}
                  className="px-4 py-3 mb-3 rounded-xl border flex-row items-center justify-between"
                  style={{ backgroundColor: colors.surface, borderColor: `${colors.ai}40`, width: '48%' }}
                >
                  <View>
                    <ThemedText className="font-bold text-sm" style={{ color: colors.ai }} numberOfLines={1}>#{tag.tag}</ThemedText>
                    <ThemedText type="secondary" className="text-[10px] mt-0.5">{tag.count} txn{tag.count !== 1 ? 's' : ''}</ThemedText>
                  </View>
                  <ThemedText style={{ fontFamily: fonts.signalBold, fontSize: 13, fontVariant: ['tabular-nums'] }}>{fmtShort(tag.total)}</ThemedText>
                </MotiView>
              ))}
            </View>
          </View>
        )}

        {/* High spends */}
        {highSpends.length > 0 && (
          <View className="mb-6">
            <View className="flex-row items-center mb-3" style={{ gap: 8 }}>
              <LucideFlame color={colors.debit} size={18} />
              <ThemedText className="text-lg" style={{ fontFamily: fonts.displayBold }}>Biggest pulses</ThemedText>
            </View>
            <View className="rounded-apple-md border overflow-hidden" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              {highSpends.map((tx, i) => (
                <View
                  key={tx.id}
                  className="flex-row items-center justify-between px-4 py-3"
                  style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}
                >
                  <View className="flex-1 mr-3">
                    <ThemedText className="text-sm font-bold" numberOfLines={1}>{tx.merchant}</ThemedText>
                    <ThemedText font="signal" style={{ fontSize: 9, color: colors.secondary, marginTop: 2 }}>
                      {new Date(tx.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {tx.category}
                    </ThemedText>
                  </View>
                  <AmountText
                    value={tx.amount}
                    kind={tx.type === 'credit' ? 'credit' : tx.type === 'transfer' ? 'transfer' : 'debit'}
                    showSign={tx.type !== 'transfer'}
                    currency={currency}
                    masked={preferences.hideAmounts}
                    size={13}
                  />
                </View>
              ))}
            </View>
          </View>
        )}

        {/* AI Insights */}
        <View className="mb-8">
          <View className="flex-row justify-between items-center mb-3">
            <ThemedText className="text-lg" style={{ fontFamily: fonts.displayBold }}>Insights</ThemedText>
            <TouchableOpacity
              onPress={handleGenerateInsights}
              disabled={generatingInsights}
              className="flex-row items-center px-3 py-1.5 rounded-full"
              style={{ backgroundColor: colors.creditSoft }}
            >
              {generatingInsights ? (
                <ActivityIndicator color={colors.ai} size="small" />
              ) : (
                <>
                  <LucideRefreshCw color={colors.ai} size={12} />
                  <ThemedText className="text-xs font-bold ml-1" style={{ color: colors.ai }}>Refresh</ThemedText>
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
                Tap to generate insights from your spending data.
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
