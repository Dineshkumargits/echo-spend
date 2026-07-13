import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { LucidePlus, LucideTrash2, LucideTarget, LucideX, LucideCheck, LucideWallet, LucideTimer } from 'lucide-react-native';
import { renderCategoryIcon } from '../components/CategoryManager';
import { notify } from '../utils/notify';
import {
  getBudgetUtilization,
  upsertBudget,
  deleteBudget,
  getCategories,
  Category,
} from '../services/database';
import { useNotifications } from '../hooks/useNotifications';
import { useTheme } from '../theme/ThemeProvider';
import { CategoryPicker } from '../components/CategoryPicker';
import { useStore } from '../store/useStore';


interface BudgetRow {
  budget: { id: number; categoryName: string; amount: number; period: string; startDate: string };
  spent: number;
  percentage: number;
}

const BudgetScreen = () => {
  const { colors, theme } = useTheme();
  const { preferences, setMonthlyBudget, setSalaryDay } = useStore();
  const currency = preferences?.currency ?? '₹';
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const { checkBudgetAlerts } = useNotifications();

  // Overall monthly budget & salary-cycle config (moved here from Settings)
  const [monthlyBudgetInput, setMonthlyBudgetInput] = useState(
    (preferences?.monthlyBudget ?? 50000).toString(),
  );
  const [salaryDayInput, setSalaryDayInput] = useState(
    (preferences?.salaryDay ?? 1).toString(),
  );

  useEffect(() => {
    setMonthlyBudgetInput((preferences?.monthlyBudget ?? 50000).toString());
    setSalaryDayInput((preferences?.salaryDay ?? 1).toString());
  }, [preferences?.monthlyBudget, preferences?.salaryDay]);

  const handleSaveMonthlyBudget = () => {
    const val = parseFloat(monthlyBudgetInput);
    if (!isNaN(val)) {
      setMonthlyBudget(val);
      notify.success('Budget updated');
    } else {
      setMonthlyBudgetInput((preferences?.monthlyBudget ?? 50000).toString());
    }
  };

  const handleSaveSalaryDay = () => {
    const val = parseInt(salaryDayInput);
    if (!isNaN(val) && val >= 1 && val <= 31) {
      setSalaryDay(val);
      notify.success('Financial cycle updated');
    } else {
      setSalaryDayInput((preferences?.salaryDay ?? 1).toString());
    }
  };

  const refreshCategories = useCallback(() => {
    getCategories().then(setCategories);
  }, []);


  const load = useCallback(async () => {
    setLoading(true);
    const [util, cats] = await Promise.all([getBudgetUtilization(), getCategories()]);
    setRows(util);
    setCategories(cats.filter(c => c.type === 'expense'));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!selectedCategory) {
      notify.error('Select a category');
      return;
    }
    const amount = parseFloat(budgetAmount);
    if (!budgetAmount || isNaN(amount) || amount <= 0) {
      notify.error('Enter a valid budget amount');
      return;
    }

    await upsertBudget({
      categoryName: selectedCategory,
      amount,
      period,
      startDate: new Date().toISOString().slice(0, 10),
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    notify.success(`Budget set for ${selectedCategory}`);
    setShowForm(false);
    setSelectedCategory('');
    setBudgetAmount('');
    await load();
    await checkBudgetAlerts();
  };

  const handleDelete = (id: number, name: string) => {
    Alert.alert('Remove Budget', `Remove budget for ${name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteBudget(id);
          await load();
        },
      },
    ]);
  };

  const getBarColor = (pct: number): string => {
    if (pct >= 100) return colors.danger;
    if (pct >= 80) return colors.warning;
    return colors.success;
  };


  return (
    <ThemedSafeAreaView>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {/* Header */}
          <MotiView
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            className="mt-4 mb-6"
          >
            <ThemedText type="secondary" className="text-sm uppercase tracking-widest">Finance</ThemedText>
            <ThemedText className="text-3xl font-bold">Budgets</ThemedText>
          </MotiView>

          {/* ── Overall plan: monthly budget + salary cycle ── */}
          <View
            className="rounded-apple-md overflow-hidden mb-6"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View className="p-4">
              <View className="flex-row items-center mb-2">
                <LucideWallet color={colors.primary} size={20} className="mr-3" />
                <ThemedText className="font-medium">Monthly Budget</ThemedText>
              </View>
              <View className="flex-row gap-2">
                <TextInput
                  className="bg-border flex-1 p-2 rounded-apple-sm font-bold"
                  style={{ color: colors.primary }}
                  value={monthlyBudgetInput}
                  onChangeText={setMonthlyBudgetInput}
                  onBlur={handleSaveMonthlyBudget}
                  keyboardType="numeric"
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                />
                <TouchableOpacity
                  onPress={handleSaveMonthlyBudget}
                  className="px-4 justify-center rounded-apple-sm"
                  style={{ backgroundColor: colors.accent }}
                >
                  <ThemedText className="font-bold text-xs" style={{ color: '#FFFFFF' }}>
                    SAVE
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
            <View className="p-4 border-t" style={{ borderTopColor: colors.border }}>
              <View className="flex-row items-center mb-2">
                <LucideTimer color={colors.primary} size={20} className="mr-3" />
                <ThemedText className="font-medium">Salary Day (1-31)</ThemedText>
              </View>
              <View className="flex-row gap-2">
                <TextInput
                  className="bg-border flex-1 p-2 rounded-apple-sm font-bold"
                  style={{ color: colors.primary }}
                  value={salaryDayInput}
                  onChangeText={setSalaryDayInput}
                  onBlur={handleSaveSalaryDay}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  onPress={handleSaveSalaryDay}
                  className="px-4 justify-center rounded-apple-sm"
                  style={{ backgroundColor: colors.accent }}
                >
                  <ThemedText className="font-bold text-xs" style={{ color: '#FFFFFF' }}>
                    SET
                  </ThemedText>
                </TouchableOpacity>
              </View>
              <ThemedText type="secondary" className="text-[10px] mt-2">
                Adjusts when your monthly spend resets.
              </ThemedText>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : rows.length === 0 && !showForm ? (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="items-center py-20"
            >
              <LucideTarget color={colors.muted} size={64} />
              <ThemedText className="font-bold text-lg mt-6">No Budgets Set</ThemedText>
              <ThemedText type="secondary" className="text-center mt-2 px-6">
                Set spending limits per category to stay on track.
              </ThemedText>
              <TouchableOpacity
                onPress={() => setShowForm(true)}
                className="mt-8 px-8 py-3 rounded-full"
                style={{ backgroundColor: colors.accent }}
              >
                <ThemedText className="font-bold" style={{ color: '#FFFFFF' }}>Set First Budget</ThemedText>
              </TouchableOpacity>
            </MotiView>
          ) : (
            <>
              {/* Budget list */}
              {rows.map((row, index) => {
                const cat = categories.find(c => c.name === row.budget.categoryName);
                const barColor = getBarColor(row.percentage);
                return (
                  <MotiView
                    key={row.budget.id}
                    from={{ opacity: 0, translateX: -20 }}
                    animate={{ opacity: 1, translateX: 0 }}
                    transition={{ delay: index * 60 }}
                    className="p-4 rounded-apple-md border mb-4"
                    style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                  >
                    <View className="flex-row justify-between items-center mb-3">
                      <View className="flex-row items-center">
                        <View
                          className="w-9 h-9 rounded-full items-center justify-center mr-3"
                          style={{ backgroundColor: `${cat?.color || colors.secondary}20` }}
                        >
                          {renderCategoryIcon(cat?.icon ?? '📁', cat?.color || colors.secondary, 18)}
                        </View>
                        <View>
                          <ThemedText className="font-bold">{row.budget.categoryName}</ThemedText>
                          <ThemedText type="secondary" className="text-[10px] uppercase">{row.budget.period}</ThemedText>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleDelete(row.budget.id, row.budget.categoryName)}
                        className="w-8 h-8 rounded-full items-center justify-center"
                        style={{ backgroundColor: colors.translucent }}
                      >
                        <LucideTrash2 color={colors.danger} size={14} />
                      </TouchableOpacity>
                    </View>

                    <View className="flex-row justify-between mb-2">
                      <ThemedText type="secondary" className="text-xs">
                        {currency}{row.spent.toLocaleString('en-IN')} spent
                      </ThemedText>
                      <ThemedText className="text-xs font-bold" style={{ color: barColor }}>
                        {row.percentage}% of {currency}{row.budget.amount.toLocaleString('en-IN')}
                      </ThemedText>
                    </View>

                    <View className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: colors.translucent }}>
                      <View
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: barColor,
                          width: `${Math.min(row.percentage, 100)}%`,
                        }}
                      />
                    </View>

                    {row.percentage >= 100 && (
                      <ThemedText className="text-xs mt-2 font-bold" style={{ color: colors.danger }}>
                        Over budget by {currency}{(row.spent - row.budget.amount).toLocaleString('en-IN')}
                      </ThemedText>
                    )}
                  </MotiView>
                );
              })}

              {/* Add new budget form */}
              {showForm ? (
                <MotiView
                  from={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-5 rounded-apple-md border mb-6"
                  style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                >
                  <View className="flex-row justify-between items-center mb-4">
                    <ThemedText className="font-bold text-lg">New Budget</ThemedText>
                    <TouchableOpacity onPress={() => setShowForm(false)}>
                      <LucideX color={colors.secondary} size={20} />
                    </TouchableOpacity>
                  </View>

                  {/* Amount & Category Section */}
                  <View style={{ flexDirection: 'row', gap: 16, marginBottom: 20, alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <ThemedText type="secondary" className="text-xs uppercase tracking-widest mb-2">Limit Amount</ThemedText>
                      <TextInput
                        placeholder="e.g. 5000"
                        placeholderTextColor={colors.muted}
                        style={{
                          fontSize: 24,
                          fontWeight: 'bold',
                          color: colors.primary,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          paddingVertical: 8,
                        }}
                        keyboardType="numeric"
                        value={budgetAmount}
                        onChangeText={setBudgetAmount}
                        autoFocus
                      />
                    </View>

                    <CategoryPicker
                      selectedCategory={selectedCategory}
                      onSelect={setSelectedCategory}
                      categories={categories}
                      type="expense"
                      refreshCategories={refreshCategories}
                      variant="square"
                    />
                  </View>

                  {/* Period */}
                  <ThemedText type="secondary" className="text-xs uppercase tracking-widest mb-2">Period</ThemedText>
                  <View className="flex-row mb-4 p-1 rounded-full" style={{ backgroundColor: colors.translucent }}>
                    {(['monthly', 'weekly'] as const).map(p => (
                      <TouchableOpacity
                        key={p}
                        onPress={() => setPeriod(p)}
                        className={`flex-1 py-2 rounded-full items-center ${period === p ? 'shadow-sm border' : ''}`}
                        style={{
                          backgroundColor: period === p ? colors.surface : 'transparent',
                          borderColor: period === p ? colors.border : 'transparent'
                        }}
                      >
                        <ThemedText className={`text-xs font-bold ${period === p ? '' : 'opacity-50'}`}>
                          {p.toUpperCase()}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity
                    onPress={handleSave}
                    className="p-4 rounded-apple-md flex-row items-center justify-center"
                    style={{ backgroundColor: colors.accent }}
                  >
                    <LucideCheck color="#FFFFFF" size={18} />
                    <ThemedText className="font-bold ml-2" style={{ color: '#FFFFFF' }}>Set Budget</ThemedText>
                  </TouchableOpacity>
                </MotiView>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowForm(true)}
                  className="border border-dashed p-4 rounded-apple-md flex-row items-center justify-center mb-20"
                  style={{ borderColor: colors.secondary }}
                >
                  <LucidePlus color={colors.secondary} size={20} />
                  <ThemedText type="secondary" className="font-bold ml-2">Add Budget</ThemedText>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default BudgetScreen;
