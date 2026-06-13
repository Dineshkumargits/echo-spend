import React, { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import {
  LucideArrowRight, LucideCheck, LucideWallet, LucideCalendar,
  LucideSun, LucideMoon, LucideMonitor, LucideTag, LucideZap,
  LucideCloud, LucideTarget, LucideSmartphone, LucideSparkles,
} from 'lucide-react-native';
import { useStore } from '../store/useStore';
import { useTheme } from '../theme/ThemeProvider';
import AIModelSetupStep from './AIModelSetupStep';

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

const WelcomeStep = ({ onNext }: { onNext: () => void }) => {
  const { colors } = useTheme();
  return (
    <View className="flex-1 items-center justify-center px-8">
      <MotiView
        from={{ opacity: 0, translateY: 30 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 500 }}
        className="items-center"
      >
        <View
          className="w-24 h-24 rounded-3xl items-center justify-center mb-8"
          style={{ backgroundColor: colors.accent }}
        >
          <LucideWallet color="#fff" size={44} />
        </View>
        <ThemedText className="text-4xl font-bold mb-3 text-center">Echo Spend</ThemedText>
        <ThemedText type="secondary" className="text-base text-center leading-7 mb-12">
          Your private, local-first finance tracker.{'\n'}No ads. No cloud required. Just you and your money.
        </ThemedText>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onNext(); }}
          className="flex-row items-center gap-3 px-10 py-4 rounded-full"
          style={{ backgroundColor: colors.accent }}
        >
          <ThemedText className="font-bold text-lg" style={{ color: '#fff' }}>Get Started</ThemedText>
          <LucideArrowRight color="#fff" size={20} />
        </TouchableOpacity>
      </MotiView>
    </View>
  );
};

// ─── Step 2: Preferences ─────────────────────────────────────────────────────

const PreferencesStep = ({
  budget, setBudget,
  salaryDay, setSalaryDay,
  theme, setTheme,
  onFinish,
}: {
  budget: string; setBudget: (b: string) => void;
  salaryDay: string; setSalaryDay: (d: string) => void;
  theme: 'dark' | 'light' | 'system'; setTheme: (t: 'dark' | 'light' | 'system') => void;
  onFinish: () => void;
}) => {
  const { colors } = useTheme();

  const THEMES: { key: 'dark' | 'light' | 'system'; label: string; icon: React.ReactNode }[] = [
    { key: 'dark', label: 'Dark', icon: <LucideMoon size={16} color={theme === 'dark' ? '#fff' : colors.secondary} /> },
    { key: 'light', label: 'Light', icon: <LucideSun size={16} color={theme === 'light' ? '#fff' : colors.secondary} /> },
    { key: 'system', label: 'System', icon: <LucideMonitor size={16} color={theme === 'system' ? '#fff' : colors.secondary} /> },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
        >
          <ThemedText className="text-2xl font-bold mt-6 mb-1">Set Preferences</ThemedText>
          <ThemedText type="secondary" className="mb-8">Configure your budget, cycle, and app theme.</ThemedText>

          {/* Monthly budget */}
          <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-3">
            Monthly Budget (₹)
          </ThemedText>
          <TextInput
            value={budget}
            onChangeText={setBudget}
            keyboardType="number-pad"
            placeholder="50000"
            placeholderTextColor={colors.muted}
            style={{
              padding: 16, borderRadius: 12, borderWidth: 1,
              borderColor: colors.border, color: colors.primary,
              backgroundColor: colors.translucent,
              fontSize: 28, fontWeight: 'bold', marginBottom: 16,
            }}
          />

          {/* Salary day */}
          <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-1">
            Salary / Pay Cycle Starts On
          </ThemedText>
          <ThemedText type="secondary" className="text-xs mb-3">
            Day of month your salary arrives — used to calculate monthly spend cycles.
          </ThemedText>
          <View className="flex-row items-center gap-3 mb-8">
            <LucideCalendar color={colors.secondary} size={18} />
            <TextInput
              value={salaryDay}
              onChangeText={v => {
                const n = parseInt(v);
                if (!v) { setSalaryDay(''); return; }
                if (!isNaN(n) && n >= 1 && n <= 31) setSalaryDay(v);
              }}
              keyboardType="number-pad"
              placeholder="1"
              placeholderTextColor={colors.muted}
              style={{
                flex: 1, padding: 14, borderRadius: 12, borderWidth: 1,
                borderColor: colors.border, color: colors.primary,
                backgroundColor: colors.translucent, fontSize: 16,
              }}
              maxLength={2}
            />
            <ThemedText type="secondary" className="text-sm">of each month</ThemedText>
          </View>

          {/* Theme */}
          <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-3">
            App Theme
          </ThemedText>
          <View className="flex-row gap-3 mb-10">
            {THEMES.map(t => (
              <TouchableOpacity
                key={t.key}
                onPress={() => { Haptics.selectionAsync(); setTheme(t.key); }}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border"
                style={{
                  backgroundColor: theme === t.key ? colors.accent : 'transparent',
                  borderColor: theme === t.key ? colors.accent : colors.border,
                }}
              >
                {t.icon}
                <ThemedText
                  className="font-bold text-sm"
                  style={{ color: theme === t.key ? '#fff' : colors.secondary }}
                >
                  {t.label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </MotiView>
      </ScrollView>

      <View className="px-6 pb-8">
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onFinish(); }}
          className="flex-row items-center justify-center gap-3 py-4 rounded-full"
          style={{ backgroundColor: colors.accent }}
        >
          <ThemedText className="font-bold text-base" style={{ color: '#fff' }}>Continue</ThemedText>
          <LucideArrowRight color="#fff" size={18} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── Step 3: Pro Tips ─────────────────────────────────────────────────────────

const TIPS = [
  {
    step: 1,
    icon: LucideWallet,
    color: '#0A84FF',
    title: 'Add all your accounts',
    desc: 'Link your bank accounts, credit cards, cash, and wallets so every rupee is tracked in one place.',
  },
  {
    step: 2,
    icon: LucideTag,
    color: '#30D158',
    title: 'Customise categories',
    desc: 'Rename, recolour, or add categories that match your actual spending habits — food, EMI, fuel, etc.',
  },
  {
    step: 3,
    icon: LucideSmartphone,
    color: '#FFD60A',
    title: 'Enable Smart Scan',
    desc: 'Grant SMS permission once and let AI auto-import transactions from every bank alert.',
  },
  {
    step: 4,
    icon: LucideTarget,
    color: '#FF9500',
    title: 'Set goals & track loans',
    desc: 'Create savings goals, log borrowed money, and add recurring subscriptions to stay on top of commitments.',
  },
  {
    step: 5,
    icon: LucideCloud,
    color: '#BF5AF2',
    title: 'Sign in & enable backup',
    desc: 'Connect your Google account to back up your data to Drive — restore on any device, anytime.',
  },
];

const ProTipsStep = ({ onFinish }: { onFinish: () => void }) => {
  const { colors, isDark } = useTheme();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
          style={{ marginTop: 8, marginBottom: 24 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: `${colors.accent}20`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <LucideSparkles color={colors.accent} size={18} />
            </View>
            <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>You're all set!</ThemedText>
          </View>
          <ThemedText style={{ fontSize: 14, color: colors.secondary, lineHeight: 20 }}>
            Here's how to get the most out of Echo Spend — follow these steps after setup.
          </ThemedText>
        </MotiView>

        {/* Tip cards */}
        {TIPS.map((tip, i) => {
          const Icon = tip.icon;
          return (
            <MotiView
              key={tip.step}
              from={{ opacity: 0, translateX: -20 }}
              animate={{ opacity: 1, translateX: 0 }}
              transition={{ type: 'timing', duration: 380, delay: 80 + i * 90 }}
              style={{
                flexDirection: 'row',
                marginBottom: 12,
                borderRadius: 18,
                overflow: 'hidden',
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              {/* Colored left stripe */}
              <View style={{ width: 4, backgroundColor: tip.color }} />

              <View style={{ flex: 1, padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
                {/* Icon */}
                <View style={{
                  width: 44, height: 44, borderRadius: 13,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: `${tip.color}18`,
                  flexShrink: 0,
                }}>
                  <Icon color={tip.color} size={20} />
                </View>

                {/* Text */}
                <View style={{ flex: 1, paddingTop: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <View style={{
                      width: 20, height: 20, borderRadius: 6,
                      backgroundColor: `${tip.color}22`,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <ThemedText style={{ fontSize: 10, fontWeight: '800', color: tip.color }}>
                        {tip.step}
                      </ThemedText>
                    </View>
                    <ThemedText style={{ fontSize: 14, fontWeight: '700', flex: 1 }}>
                      {tip.title}
                    </ThemedText>
                  </View>
                  <ThemedText style={{ fontSize: 12, color: colors.secondary, lineHeight: 18 }}>
                    {tip.desc}
                  </ThemedText>
                </View>
              </View>
            </MotiView>
          );
        })}

        {/* Tip footer note */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 600, type: 'timing', duration: 400 }}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 4, marginBottom: 8, marginTop: 4,
          }}
        >
          <LucideZap color={colors.muted} size={12} />
          <ThemedText style={{ fontSize: 11, color: colors.muted, lineHeight: 16, flex: 1 }}>
            You can always revisit these in Settings. Everything is stored locally — no data ever leaves your device without your permission.
          </ThemedText>
        </MotiView>
      </ScrollView>

      {/* CTA */}
      <MotiView
        from={{ opacity: 0, translateY: 12 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ delay: 500, type: 'spring', damping: 18 }}
        style={{ paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 }}
      >
        <TouchableOpacity
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onFinish();
          }}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 10, paddingVertical: 16, borderRadius: 99,
            backgroundColor: colors.accent,
          }}
        >
          <LucideCheck color="#fff" size={20} />
          <ThemedText style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
            Start tracking
          </ThemedText>
        </TouchableOpacity>
      </MotiView>
    </View>
  );
};

// ─── Dot Indicator ────────────────────────────────────────────────────────────

const Dots = ({ total, current, colors }: { total: number; current: number; colors: any }) => (
  <View className="flex-row items-center justify-center gap-2 py-3">
    {Array.from({ length: total }).map((_, i) => (
      <View
        key={i}
        style={{
          width: i === current ? 20 : 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: i === current ? colors.accent : colors.border,
        }}
      />
    ))}
  </View>
);

// ─── Main ─────────────────────────────────────────────────────────────────────

const OnboardingScreen = () => {
  const { colors } = useTheme();
  const { preferences, completeOnboarding, setCurrency, setSalaryDay, setMonthlyBudget, setTheme } = useStore();

  const [step, setStep] = useState(0);
  const [salaryDay, setSalaryDayLocal] = useState(String(preferences.salaryDay ?? 1));
  const [budget, setBudgetLocal] = useState(String(preferences.monthlyBudget ?? 50000));
  const [theme, setThemeLocal] = useState<'dark' | 'light' | 'system'>(preferences.theme ?? 'dark');

  const TOTAL_STEPS = 4;

  const savePreferences = () => {
    setCurrency('₹');
    setSalaryDay(parseInt(salaryDay) || 1);
    setMonthlyBudget(parseFloat(budget) || 50000);
    setTheme(theme);
  };

  return (
    <ThemedSafeAreaView className="flex-1">
      {step > 0 && <Dots total={TOTAL_STEPS} current={step} colors={colors} />}

      {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
      {step === 1 && (
        <PreferencesStep
          budget={budget} setBudget={setBudgetLocal}
          salaryDay={salaryDay} setSalaryDay={setSalaryDayLocal}
          theme={theme} setTheme={setThemeLocal}
          onFinish={() => { savePreferences(); setStep(2); }}
        />
      )}
      {step === 2 && (
        <AIModelSetupStep onComplete={() => setStep(3)} />
      )}
      {step === 3 && (
        <ProTipsStep onFinish={completeOnboarding} />
      )}
    </ThemedSafeAreaView>
  );
};

export default OnboardingScreen;
