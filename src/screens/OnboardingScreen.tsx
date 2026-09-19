import React, { useState } from 'react';
import {
  View, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import {
  LucideArrowRight, LucideCheck, LucideWallet, LucideCalendar, LucideClock,
  LucideSun, LucideMoon, LucideMonitor, LucideTag, LucideZap,
  LucideCloud, LucideTarget, LucideSmartphone, LucideSparkles,
  LucideLandmark, LucideCreditCard, LucideShieldCheck, LucideRefreshCw,
} from 'lucide-react-native';
import { ActivityIndicator } from 'react-native';
import { useStore } from '../store/useStore';
import { addSalaryDate } from '../services/database';
import { useTheme } from '../theme/ThemeProvider';
import AIModelSetupStep from './AIModelSetupStep';
import {
  detectAccountsFromSms,
  addDetectedAccounts,
  checkSmsPermission,
  requestSmsPermission,
  DetectedAccountCandidate,
} from '../services/accountDetector';

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
  salaryAt, setSalaryAt,
  theme, setTheme,
  onFinish,
}: {
  budget: string; setBudget: (b: string) => void;
  salaryAt: Date; setSalaryAt: (d: Date) => void;
  theme: 'dark' | 'light' | 'system'; setTheme: (t: 'dark' | 'light' | 'system') => void;
  onFinish: () => void;
}) => {
  const { colors } = useTheme();
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  const THEMES: { key: 'dark' | 'light' | 'system'; label: string; icon: React.ReactNode }[] = [
    { key: 'dark', label: 'Dark', icon: <LucideMoon size={16} color={theme === 'dark' ? '#fff' : colors.secondary} /> },
    { key: 'light', label: 'Light', icon: <LucideSun size={16} color={theme === 'light' ? '#fff' : colors.secondary} /> },
    { key: 'system', label: 'System', icon: <LucideMonitor size={16} color={theme === 'system' ? '#fff' : colors.secondary} /> },
  ];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
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

          {/* Last salary — a real date+time, matching how transactions are entered. */}
          <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-1">
            When did your last salary arrive?
          </ThemedText>
          <ThemedText type="secondary" className="text-xs mb-3">
            Your spending cycle runs from that exact moment. You can update it each
            month when the date moves.
          </ThemedText>
          <TouchableOpacity
            onPress={() => { setPickerMode('date'); setShowPicker(true); }}
            activeOpacity={0.7}
            className="flex-row items-center gap-3 mb-8"
            style={{
              padding: 14, borderRadius: 12, borderWidth: 1,
              borderColor: colors.border, backgroundColor: colors.translucent,
            }}
          >
            <LucideCalendar color={colors.secondary} size={18} />
            <ThemedText style={{ flex: 1, fontSize: 16 }}>
              {salaryAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}
              {salaryAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </ThemedText>
            <ThemedText type="secondary" className="text-xs">CHANGE</ThemedText>
          </TouchableOpacity>

          {showPicker && (
            <DateTimePicker
              value={salaryAt}
              mode={Platform.OS === 'ios' ? 'datetime' : pickerMode}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              maximumDate={new Date()}
              onChange={(event: any, selected?: Date) => {
                if (event?.type === 'dismissed') { setShowPicker(false); setPickerMode('date'); return; }
                if (!selected) return;
                if (Platform.OS === 'ios') { setSalaryAt(selected); return; }
                if (pickerMode === 'date') {
                  const next = new Date(selected);
                  next.setHours(salaryAt.getHours(), salaryAt.getMinutes(), 0, 0);
                  setSalaryAt(next);
                  setPickerMode('time');
                  return;
                }
                const next = new Date(salaryAt);
                next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
                setSalaryAt(next);
                setShowPicker(false);
                setPickerMode('date');
              }}
            />
          )}

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

// ─── Step 2: Detect Accounts ──────────────────────────────────────────────────

interface CandidateItem extends DetectedAccountCandidate {
  selected: boolean;
  nameInput: string;
  balanceInput: string;
}

const COMMON_PRESETS = [
  { name: 'HDFC Bank', type: 'bank' as const },
  { name: 'State Bank of India', type: 'bank' as const },
  { name: 'ICICI Bank', type: 'bank' as const },
  { name: 'Axis Bank', type: 'bank' as const },
  { name: 'Cash Wallet', type: 'cash' as const },
];

const AccountDiscoveryStep = ({ onFinish }: { onFinish: () => void }) => {
  const { colors, isDark } = useTheme();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [addedPresets, setAddedPresets] = useState<string[]>([]);

  const runScan = async () => {
    setIsScanning(true);
    try {
      const res = await detectAccountsFromSms({ daysBack: 180, maxMessages: 2500 });
      const items: CandidateItem[] = res.newCandidates.map((c) => ({
        ...c,
        selected: true,
        nameInput: c.suggestedName,
        balanceInput: c.balance > 0 ? String(c.balance) : '0',
      }));
      setCandidates(items);
      setHasScanned(true);
      if (items.length > 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      console.warn('[Onboarding] Scan failed:', e);
    } finally {
      setIsScanning(false);
    }
  };

  React.useEffect(() => {
    if (Platform.OS === 'android') {
      checkSmsPermission().then((granted) => {
        setHasPermission(granted);
        if (granted) {
          runScan();
        }
      });
    }
  }, []);

  const handleRequestPermission = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const granted = await requestSmsPermission();
    setHasPermission(granted);
    if (granted) {
      runScan();
    }
  };

  const toggleSelect = (key: string) => {
    Haptics.selectionAsync();
    setCandidates((prev) =>
      prev.map((c) => (c.key === key ? { ...c, selected: !c.selected } : c))
    );
  };

  const updateCandidateName = (key: string, nameInput: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.key === key ? { ...c, nameInput } : c))
    );
  };

  const updateCandidateBalance = (key: string, balanceInput: string) => {
    setCandidates((prev) =>
      prev.map((c) => (c.key === key ? { ...c, balanceInput } : c))
    );
  };

  const handleSaveAndContinue = async () => {
    const selected = candidates.filter((c) => c.selected);
    if (selected.length > 0) {
      setIsSaving(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await addDetectedAccounts(
          selected.map((s) => ({
            name: s.nameInput.trim() || s.suggestedName,
            balance: parseFloat(s.balanceInput) || 0,
            accountType: s.accountType,
            last4Digits: s.last4Digits,
          }))
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        console.warn('[Onboarding] Error saving detected accounts:', err);
      } finally {
        setIsSaving(false);
      }
    }
    onFinish();
  };

  const handleAddPreset = async (preset: { name: string; type: 'bank' | 'credit_card' | 'cash' }) => {
    if (addedPresets.includes(preset.name)) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAddedPresets((prev) => [...prev, preset.name]);
    try {
      await addDetectedAccounts([{ name: preset.name, balance: 0, accountType: preset.type }]);
    } catch (e) {
      console.warn('[Onboarding] Failed to add preset:', e);
    }
  };

  const selectedCount = candidates.filter((c) => c.selected).length;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
        >
          <ThemedText className="text-2xl font-bold mt-6 mb-1">Detect Accounts</ThemedText>
          <ThemedText type="secondary" className="mb-6 leading-5">
            Auto-detect your bank accounts and credit cards directly from SMS.
          </ThemedText>

          {/* Privacy badge */}
          <View
            className="flex-row items-center p-3 rounded-2xl border mb-6"
            style={{ backgroundColor: colors.translucent, borderColor: colors.border }}
          >
            <LucideShieldCheck color={colors.accent} size={18} />
            <ThemedText type="secondary" className="text-xs flex-1 ml-2 font-medium">
              100% On-Device · Your SMS never leaves your phone.
            </ThemedText>
          </View>

          {/* iOS Fallback */}
          {Platform.OS === 'ios' && (
            <View className="mb-6">
              <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-3">
                Quick Add Popular Banks
              </ThemedText>
              <View className="gap-3">
                {COMMON_PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.name}
                    onPress={() => handleAddPreset(p)}
                    activeOpacity={0.7}
                    className="flex-row items-center justify-between p-4 rounded-2xl border"
                    style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                  >
                    <View className="flex-row items-center gap-3">
                      <View
                        className="w-10 h-10 rounded-xl items-center justify-center"
                        style={{ backgroundColor: `${colors.accent}15` }}
                      >
                        {p.type === 'cash' ? (
                          <LucideWallet color={colors.accent} size={20} />
                        ) : (
                          <LucideLandmark color={colors.accent} size={20} />
                        )}
                      </View>
                      <ThemedText className="font-bold text-base">{p.name}</ThemedText>
                    </View>
                    {addedPresets.includes(p.name) ? (
                      <View className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-full" style={{ backgroundColor: `${colors.accent}15` }}>
                        <LucideCheck color={colors.accent} size={14} strokeWidth={3} />
                        <ThemedText style={{ color: colors.accent, fontWeight: '700', fontSize: 12 }}>
                          Added
                        </ThemedText>
                      </View>
                    ) : (
                      <ThemedText style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
                        + Add
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Android: Request SMS permission */}
          {Platform.OS === 'android' && hasPermission === false && !isScanning && (
            <View
              className="p-6 rounded-3xl border items-center mb-6"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <View
                className="w-16 h-16 rounded-full items-center justify-center mb-4"
                style={{ backgroundColor: `${colors.accent}15` }}
              >
                <LucideSparkles color={colors.accent} size={30} />
              </View>
              <ThemedText className="text-lg font-bold text-center mb-2">
                Scan SMS for Bank Accounts
              </ThemedText>
              <ThemedText type="secondary" className="text-xs text-center leading-5 mb-5">
                Echo Spend can scan your financial messages to discover your active bank accounts and credit cards with their latest balances.
              </ThemedText>

              <TouchableOpacity
                onPress={handleRequestPermission}
                activeOpacity={0.8}
                className="w-full py-4 rounded-full items-center justify-center flex-row gap-2"
                style={{ backgroundColor: colors.accent }}
              >
                <ThemedText className="font-bold text-base" style={{ color: '#fff' }}>
                  Allow & Scan SMS
                </ThemedText>
                <LucideArrowRight color="#fff" size={18} />
              </TouchableOpacity>
            </View>
          )}

          {/* Android: Scanning indicator */}
          {isScanning && (
            <View className="items-center justify-center py-12">
              <ActivityIndicator size="large" color={colors.accent} />
              <ThemedText className="text-base font-bold mt-4 mb-1">
                Scanning Financial Messages...
              </ThemedText>
              <ThemedText type="secondary" className="text-xs text-center">
                Finding bank accounts and credit cards
              </ThemedText>
            </View>
          )}

          {/* Android: Found candidates */}
          {!isScanning && hasPermission && candidates.length > 0 && (
            <View className="mb-6">
              <View className="flex-row items-center justify-between mb-3">
                <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest">
                  Found {candidates.length} {candidates.length === 1 ? 'Account' : 'Accounts'}
                </ThemedText>
                <TouchableOpacity onPress={runScan} activeOpacity={0.6}>
                  <ThemedText style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>
                    Re-scan
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View className="gap-3">
                {candidates.map((item) => {
                  const isCC = item.accountType === 'credit_card';
                  return (
                    <View
                      key={item.key}
                      className="p-4 rounded-2xl border"
                      style={{
                        backgroundColor: item.selected ? (isDark ? '#1e242b' : '#f4f8fa') : colors.surface,
                        borderColor: item.selected ? colors.accent : colors.border,
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => toggleSelect(item.key)}
                        activeOpacity={0.7}
                        className="flex-row items-center"
                      >
                        <View
                          className="w-6 h-6 rounded-md items-center justify-center border"
                          style={{
                            backgroundColor: item.selected ? colors.accent : 'transparent',
                            borderColor: item.selected ? colors.accent : colors.border,
                          }}
                        >
                          {item.selected && <LucideCheck color="#fff" size={14} strokeWidth={3} />}
                        </View>

                        <View
                          className="w-9 h-9 rounded-xl items-center justify-center ml-3"
                          style={{ backgroundColor: `${colors.accent}15` }}
                        >
                          {isCC ? (
                            <LucideCreditCard color={colors.accent} size={18} />
                          ) : (
                            <LucideLandmark color={colors.accent} size={18} />
                          )}
                        </View>

                        <View className="flex-1 ml-3">
                          <ThemedText className="font-bold text-base">{item.bankName}</ThemedText>
                          <ThemedText type="secondary" className="text-[11px]">
                            {isCC ? 'Credit Card' : 'Bank Account'} · ending in {item.last4Digits}
                          </ThemedText>
                        </View>

                        {item.balance > 0 && (
                          <View className="px-2.5 py-1 rounded-full border" style={{ borderColor: colors.border, backgroundColor: colors.translucent }}>
                            <ThemedText font="signal" className="text-xs font-bold" style={{ color: colors.accent }}>
                              ₹{item.balance.toLocaleString('en-IN')}
                            </ThemedText>
                          </View>
                        )}
                      </TouchableOpacity>

                      {item.selected && (
                        <View className="flex-row items-center gap-3 mt-3 pt-3 border-t" style={{ borderTopColor: colors.border }}>
                          <View className="flex-1">
                            <ThemedText type="secondary" className="text-[10px] font-bold uppercase mb-1">
                              Account Name
                            </ThemedText>
                            <TextInput
                              value={item.nameInput}
                              onChangeText={(val) => updateCandidateName(item.key, val)}
                              className="px-3 py-2 rounded-lg border font-semibold text-xs"
                              style={{
                                color: colors.primary,
                                borderColor: colors.border,
                                backgroundColor: colors.surface,
                              }}
                            />
                          </View>
                          <View style={{ width: 100 }}>
                            <ThemedText type="secondary" className="text-[10px] font-bold uppercase mb-1">
                              Balance (₹)
                            </ThemedText>
                            <TextInput
                              value={item.balanceInput}
                              onChangeText={(val) => updateCandidateBalance(item.key, val)}
                              keyboardType="numeric"
                              className="px-3 py-2 rounded-lg border font-semibold text-xs"
                              style={{
                                color: colors.primary,
                                borderColor: colors.border,
                                backgroundColor: colors.surface,
                              }}
                            />
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Android: No accounts found after scan */}
          {!isScanning && hasPermission && hasScanned && candidates.length === 0 && (
            <View
              className="p-6 rounded-3xl border items-center mb-6"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <ThemedText className="text-base font-bold text-center mb-1">
                No Accounts Detected in SMS
              </ThemedText>
              <ThemedText type="secondary" className="text-xs text-center leading-5 mb-5">
                We didn't find any financial account alerts in recent messages. You can add your accounts later anytime in Manage Accounts.
              </ThemedText>

              <ThemedText type="secondary" className="text-xs font-bold uppercase tracking-widest mb-3 self-start">
                Or Quick Add a Preset:
              </ThemedText>
              <View className="w-full gap-2 mb-2">
                {COMMON_PRESETS.slice(0, 3).map((p) => (
                  <TouchableOpacity
                    key={p.name}
                    onPress={() => handleAddPreset(p)}
                    activeOpacity={0.7}
                    className="flex-row items-center justify-between p-3.5 rounded-xl border"
                    style={{ backgroundColor: colors.translucent, borderColor: colors.border }}
                  >
                    <ThemedText className="font-semibold text-sm">{p.name}</ThemedText>
                    {addedPresets.includes(p.name) ? (
                      <View className="flex-row items-center gap-1.5 px-3 py-1 rounded-full" style={{ backgroundColor: `${colors.accent}15` }}>
                        <LucideCheck color={colors.accent} size={13} strokeWidth={3} />
                        <ThemedText style={{ color: colors.accent, fontWeight: '700', fontSize: 11 }}>
                          Added
                        </ThemedText>
                      </View>
                    ) : (
                      <ThemedText style={{ color: colors.accent, fontWeight: '700', fontSize: 12 }}>
                        + Add
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </MotiView>
      </ScrollView>

      {/* Bottom Footer Actions */}
      <View className="px-6 pb-8 pt-2">
        {candidates.length > 0 && selectedCount > 0 ? (
          <>
            <TouchableOpacity
              onPress={handleSaveAndContinue}
              disabled={isSaving}
              className="flex-row items-center justify-center gap-3 py-4 rounded-full mb-3"
              style={{ backgroundColor: colors.accent }}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <ThemedText className="font-bold text-base" style={{ color: '#fff' }}>
                    Add {selectedCount} {selectedCount === 1 ? 'Account' : 'Accounts'} & Continue
                  </ThemedText>
                  <LucideArrowRight color="#fff" size={18} />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onFinish();
              }}
              className="items-center justify-center py-2"
            >
              <ThemedText type="secondary" className="font-semibold text-sm">
                Skip for now
              </ThemedText>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onFinish();
            }}
            className="flex-row items-center justify-center gap-3 py-4 rounded-full"
            style={{ backgroundColor: colors.accent }}
          >
            <ThemedText className="font-bold text-base" style={{ color: '#fff' }}>
              Continue
            </ThemedText>
            <LucideArrowRight color="#fff" size={18} />
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── Step 3: Pro Tips ─────────────────────────────────────────────────────────

const TIPS = [
  {
    step: 1,
    icon: LucideWallet,
    color: '#56D4C0',
    title: 'Add all your accounts',
    desc: 'Link your bank accounts, credit cards, cash, and wallets so every rupee is tracked in one place.',
  },
  {
    step: 2,
    icon: LucideTag,
    color: '#56D4C0',
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
    color: '#FFB454',
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

// ─── Step 3: Plan Overview ───────────────────────────────────────────────────

const PlanStep = ({ onNext }: { onNext: () => void }) => {
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400 }}
          style={{ marginTop: 8, marginBottom: 20 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: `${colors.accent}20`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <LucideZap color={colors.accent} size={18} />
            </View>
            <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>Free & Pro Plans</ThemedText>
          </View>
          <ThemedText style={{ fontSize: 14, color: colors.secondary, lineHeight: 20 }}>
            Echo Spend is local-first. Core tracking is free forever — no credit card needed.
          </ThemedText>
        </MotiView>

        {/* Free Plan Card */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 100 }}
          style={{
            padding: 16, borderRadius: 18, marginBottom: 14,
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <ThemedText style={{ fontSize: 16, fontWeight: '700' }}>Free Forever</ThemedText>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: `${colors.secondary}20` }}>
              <ThemedText style={{ fontSize: 10, fontWeight: '700', color: colors.secondary }}>INCLUDED</ThemedText>
            </View>
          </View>
          <View style={{ gap: 8 }}>
            {[
              'Real-time SMS transaction auto-capture',
              'Manual expense, income & transfer logging',
              '0 Ads & 100% local, offline privacy',
              'CSV export & Google Drive backup/restore',
              'Up to 3 accounts, 3 budgets, 90-day scan history',
            ].map((item, idx) => (
              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <LucideCheck color={colors.accent} size={14} />
                <ThemedText style={{ fontSize: 12.5, color: colors.primary, flex: 1 }}>{item}</ThemedText>
              </View>
            ))}
          </View>
        </MotiView>

        {/* Echo Pro Card */}
        <MotiView
          from={{ opacity: 0, translateY: 20 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 200 }}
          style={{
            padding: 16, borderRadius: 18, marginBottom: 14,
            backgroundColor: `${colors.accent}10`, borderWidth: 1, borderColor: colors.accent,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <LucideSparkles color={colors.accent} size={16} />
              <ThemedText style={{ fontSize: 16, fontWeight: '700', color: colors.accent }}>Echo Pro</ThemedText>
            </View>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: colors.accent }}>
              <ThemedText style={{ fontSize: 9.5, fontWeight: '800', color: '#fff' }}>7-DAY TRIAL ACTIVE</ThemedText>
            </View>
          </View>
          <View style={{ gap: 8 }}>
            {[
              'Full SMS Archive — scan history beyond 90 days',
              'Merchant breakdowns & spending trend analytics',
              'Automated background backups & bill reminders',
              'Unlimited accounts, budgets, goals, loans & subscriptions',
            ].map((item, idx) => (
              <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <LucideSparkles color={colors.accent} size={13} />
                <ThemedText style={{ fontSize: 12.5, color: colors.primary, fontWeight: '600', flex: 1 }}>{item}</ThemedText>
              </View>
            ))}
          </View>
        </MotiView>
      </ScrollView>

      <View style={{ paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 }}>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onNext();
          }}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
            gap: 10, paddingVertical: 16, borderRadius: 99,
            backgroundColor: colors.accent,
          }}
        >
          <ThemedText style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
            Got It, Continue
          </ThemedText>
          <LucideArrowRight color="#fff" size={18} />
        </TouchableOpacity>
      </View>
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
  const [salaryAt, setSalaryAtLocal] = useState<Date>(new Date());
  const [budget, setBudgetLocal] = useState(String(preferences.monthlyBudget ?? 50000));
  const [theme, setThemeLocal] = useState<'dark' | 'light' | 'system'>(preferences.theme ?? 'dark');

  const TOTAL_STEPS = 6;

  const savePreferences = () => {
    setCurrency('₹');
    // Record the real salary instant as the first cycle boundary. salaryDay is
    // still mirrored so the fallback anchor stays sensible if the row is ever lost.
    setSalaryDay(salaryAt.getDate());
    addSalaryDate(salaryAt.toISOString(), 'manual').catch(() => {});
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
          salaryAt={salaryAt} setSalaryAt={setSalaryAtLocal}
          theme={theme} setTheme={setThemeLocal}
          onFinish={() => { savePreferences(); setStep(2); }}
        />
      )}
      {step === 2 && (
        <AccountDiscoveryStep onFinish={() => setStep(3)} />
      )}
      {step === 3 && (
        <AIModelSetupStep variant="onboarding" onComplete={() => setStep(4)} />
      )}
      {step === 4 && (
        <PlanStep onNext={() => setStep(5)} />
      )}
      {step === 5 && (
        <ProTipsStep onFinish={completeOnboarding} />
      )}
    </ThemedSafeAreaView>
  );
};

export default OnboardingScreen;
