import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  Switch,
  TouchableOpacity,
  Platform,
  Linking,
  NativeModules,
  AppState,
  StyleSheet,
} from 'react-native';
import {
  LucideChevronLeft,
  LucideCheckCircle2,
  LucideLock,
  LucideLightbulb,
  LucideZap,
  LucideCloudSync,
  LucideTimer,
} from 'lucide-react-native';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { notify } from '../utils/notify';
import { useStore } from '../store/useStore';
import { useTheme } from '../theme/ThemeProvider';
import { registerBackgroundTasks } from '../services/backgroundTasks';
import { AIModelManager } from '../services/aiModelManager';
import { CustomAlert, AlertButton } from '../components/CustomAlert';

const extra = Constants.expoConfig?.extra ?? {};

GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId,
  offlineAccess: true,
  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
});

export const TipsScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const {
    preferences,
    googleUser,
    setGoogleUser,
    toggleAutoSmsScan,
    aiModelStatus,
  } = useStore();

  const { BackgroundOptimizationModule } = NativeModules;

  const [isBatteryOptimized, setIsBatteryOptimized] = useState(true);
  const [isExactAlarmAllowed, setIsExactAlarmAllowed] = useState(true);

  // Custom Alert State
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertButtons, setAlertButtons] = useState<AlertButton[]>([]);

  const showCustomAlert = (title: string, message: string, buttons?: AlertButton[]) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertButtons(buttons || [{ text: 'OK' }]);
    setAlertVisible(true);
  };

  const checkBackgroundPermissions = async () => {
    if (Platform.OS !== 'android' || !BackgroundOptimizationModule) return;
    try {
      const ignoring = await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
      setIsBatteryOptimized(!ignoring);

      const alarmAllowed = await BackgroundOptimizationModule.isExactAlarmAllowed();
      setIsExactAlarmAllowed(alarmAllowed);
    } catch (e) {
      console.warn('[TipsScreen] Failed to check background permissions:', e);
    }
  };

  useEffect(() => {
    checkBackgroundPermissions();

    if (Platform.OS === 'android') {
      const subscription = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          checkBackgroundPermissions();
        }
      });
      return () => subscription.remove();
    }
  }, []);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences?.hapticsEnabled) {
      Haptics.impactAsync(style);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      if (result.type === 'success') {
        const { user } = result.data;
        const tokens = await GoogleSignin.getTokens();

        setGoogleUser({
          name: user.name || 'Google User',
          email: user.email,
          photo: user.photo ?? undefined,
          accessToken: tokens.accessToken,
          refreshToken: 'native_sdk_managed',
          expiresAt: Date.now() + 3600 * 1000,
        });

        notify.success('Cloud Account Linked!');
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error: any) {
      if (error.code !== statusCodes.SIGN_IN_CANCELLED) {
        console.error('[Auth] Native Error:', error);
        notify.error('Native Auth Failed', error.message);
      }
    }
  };

  const handleBatteryOptimizationPress = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!BackgroundOptimizationModule) return;
    try {
      const isIgnoringNow = await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
      if (isIgnoringNow) {
        showCustomAlert("Already Whitelisted", "Echo Spend is already whitelisted from battery optimizations.");
        return;
      }
      await BackgroundOptimizationModule.requestIgnoreBatteryOptimizations();
    } catch (e: any) {
      notify.error("Failed to request whitelisting", e?.message);
    }
  };

  const handleExactAlarmPress = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!BackgroundOptimizationModule) return;
    try {
      const isAllowedNow = await BackgroundOptimizationModule.isExactAlarmAllowed();
      if (isAllowedNow) {
        showCustomAlert("Already Allowed", "Echo Spend already has exact alarm scheduling permissions.");
        return;
      }
      await BackgroundOptimizationModule.openExactAlarmSettings();
    } catch (e: any) {
      notify.error("Failed to open alarm settings", e?.message);
    }
  };

  const Row = ({ icon, label, sub, right, onPress, border = true }: any) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
      style={[
        styles.row,
        { borderBottomColor: border ? colors.border : 'transparent', borderBottomWidth: border ? 1 : 0 }
      ]}
    >
      <View style={styles.iconWrapper}>{icon}</View>
      <View style={{ flex: 1, marginRight: 8 }}>
        <ThemedText className="font-semibold text-base" style={{ color: colors.primary }}>{label}</ThemedText>
        {sub && <ThemedText type="secondary" style={styles.subText}>{sub}</ThemedText>}
      </View>
      {right}
    </TouchableOpacity>
  );

  // Dynamic unlock progress calculations
  const isAiCompatible = AIModelManager.isDeviceCompatible();
  const isAiActive = aiModelStatus === 'ready' || aiModelStatus === 'downloaded' || aiModelStatus === 'loading';
  const totalItems = (Platform.OS === 'android' ? 1 : 0) + (isAiCompatible ? 1 : 0) + 3;
  
  let completedCount = 0;
  if (isAiCompatible && isAiActive) completedCount++;
  if (googleUser) completedCount++;
  if (preferences?.autoSmsScan) completedCount++;
  if (Platform.OS === 'android' && !isBatteryOptimized && isExactAlarmAllowed) completedCount++;
  if (preferences?.salaryDay && preferences.salaryDay !== 1) completedCount++;
  
  const progressPercent = totalItems > 0 ? (completedCount / totalItems) * 100 : 0;

  return (
    <ThemedSafeAreaView edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <LucideChevronLeft color={colors.primary} size={28} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <ThemedText className="text-2xl font-bold">Unlock Echo Spend</ThemedText>
            <ThemedText type="secondary" className="text-xs">Configure features to unlock offline & sync options</ThemedText>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
          
          {/* Progress Card */}
          <MotiView
            from={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={[styles.progressCard, { backgroundColor: `${colors.accent}12`, borderColor: colors.border }]}
          >
            <View style={styles.progressHeader}>
              <View>
                <ThemedText className="font-bold text-base" style={{ color: colors.accent }}>Unlock Progress</ThemedText>
                <ThemedText type="secondary" className="text-xs mt-0.5">
                  {completedCount} of {totalItems} features active
                </ThemedText>
              </View>
              <ThemedText className="font-bold text-lg" style={{ color: colors.accent }}>
                {Math.round(progressPercent)}%
              </ThemedText>
            </View>
            
            <View style={[styles.progressBarBg, { backgroundColor: colors.translucent }]}>
              <MotiView 
                animate={{ width: `${progressPercent}%` }}
                transition={{ type: 'spring', damping: 15 }}
                style={[
                  styles.progressBarFill, 
                  { 
                    backgroundColor: colors.accent,
                  }
                ]} 
              />
            </View>
            <ThemedText type="secondary" style={styles.progressSub}>
              {progressPercent === 100 
                ? "🎉 Amazing! You have fully unlocked all features of Echo Spend!" 
                : "Configure the options below to activate all offline parsing & cloud sync capabilities."}
            </ThemedText>
          </MotiView>

          {/* Checklist Card */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            
            {/* Offline AI Assistant */}
            {isAiCompatible && (
              <Row
                icon={isAiActive ? <LucideCheckCircle2 color={colors.success} size={20} /> : <LucideLock color={colors.warning} size={18} />}
                label="Offline AI Assistant"
                sub={
                  aiModelStatus === 'ready'
                    ? "Qwen AI model is active and running privately on-device."
                    : aiModelStatus === 'downloaded'
                    ? "Qwen AI model is downloaded and ready to initialize."
                    : aiModelStatus === 'loading'
                    ? "Qwen AI model is initializing in the background..."
                    : "Smart categorization without internet. Tap to view how to install the model (~770MB)."
                }
                right={
                  <View style={[styles.badge, { backgroundColor: isAiActive ? `${colors.success}20` : `${colors.warning}20` }]}>
                    <ThemedText style={[styles.badgeText, { color: isAiActive ? colors.success : colors.warning }]}>
                      {aiModelStatus === 'ready' ? "ACTIVE" : aiModelStatus === 'downloaded' ? "READY" : aiModelStatus === 'loading' ? "LOADING" : "GET MODEL"}
                    </ThemedText>
                  </View>
                }
                onPress={() => {
                  triggerHaptic();
                  if (!isAiActive) {
                    showCustomAlert(
                      "Download AI Model",
                      "To enable smart on-device categorization, go back to Settings, scroll down to the 'AI Engine' section, and tap 'Download AI Model'.",
                      [{ text: "OK" }]
                    );
                  } else {
                    showCustomAlert(
                      aiModelStatus === 'ready' ? "AI Model Active" : "AI Model Ready",
                      aiModelStatus === 'ready'
                        ? "The Llama model is successfully installed and active! It classifies your transaction merchant SMS entirely locally."
                        : "The AI model is downloaded and ready. It will automatically load to process your next incoming bank SMS.",
                      [{ text: "Great" }]
                    );
                  }
                }}
              />
            )}

            {/* Google Cloud Backups */}
            <Row
              icon={googleUser ? <LucideCheckCircle2 color={colors.success} size={20} /> : <LucideLock color={colors.warning} size={18} />}
              label="Google Cloud Backups"
              sub={googleUser 
                ? `Connected to ${googleUser.email} for automatic backups.` 
                : "Keep your transaction records safe. Tap to link your Google Drive app data sandbox."}
              right={
                <View style={[styles.badge, { backgroundColor: googleUser ? `${colors.success}20` : `${colors.warning}20` }]}>
                  <ThemedText style={[styles.badgeText, { color: googleUser ? colors.success : colors.warning }]}>
                    {googleUser ? "LINKED" : "CONNECT"}
                  </ThemedText>
                </View>
              }
              onPress={() => {
                triggerHaptic();
                if (!googleUser) {
                  handleGoogleSignIn();
                } else {
                  showCustomAlert(
                    "Cloud Backups Connected",
                    `Your database is synced to ${googleUser.email}. Backup schedules can be set daily or weekly under Settings > Google Cloud Sync.`,
                    [{ text: "Awesome" }]
                  );
                }
              }}
            />

            {/* Auto SMS Detection */}
            <Row
              icon={preferences?.autoSmsScan ? <LucideCheckCircle2 color={colors.success} size={20} /> : <LucideLock color={colors.warning} size={18} />}
              label="Auto SMS Detection"
              sub={preferences?.autoSmsScan 
                ? "Echo Spend reads incoming financial messages and categorizes them instantly." 
                : "Zero manual entry required. Toggle on to auto-read incoming bank texts."}
              right={
                <View style={{ justifyContent: 'center' }}>
                  <Switch
                    value={preferences?.autoSmsScan}
                    onValueChange={() => {
                      triggerHaptic();
                      toggleAutoSmsScan();
                      setTimeout(() => registerBackgroundTasks(), 0);
                    }}
                    trackColor={{ true: colors.success }}
                  />
                </View>
              }
            />

            {/* Reliable Background Sync (Android-only) */}
            {Platform.OS === 'android' && (
              <Row
                icon={(!isBatteryOptimized && isExactAlarmAllowed) ? <LucideCheckCircle2 color={colors.success} size={20} /> : <LucideLock color={colors.warning} size={18} />}
                label="Reliable Background run"
                sub={(!isBatteryOptimized && isExactAlarmAllowed)
                  ? "Background runs are whitelisted for uninterrupted SMS scans and backups."
                  : "Tap to grant Battery Whitelist and Alarm scheduling settings."}
                right={
                  <View style={[styles.badge, { backgroundColor: (!isBatteryOptimized && isExactAlarmAllowed) ? `${colors.success}20` : `${colors.warning}20` }]}>
                    <ThemedText style={[styles.badgeText, { color: (!isBatteryOptimized && isExactAlarmAllowed) ? colors.success : colors.warning }]}>
                      {(!isBatteryOptimized && isExactAlarmAllowed) ? "CONFIGURED" : "CONFIGURE"}
                    </ThemedText>
                  </View>
                }
                onPress={() => {
                  triggerHaptic();
                  if (isBatteryOptimized || !isExactAlarmAllowed) {
                    showCustomAlert(
                      "Background Configuration",
                      "Ensure the app works in the background by setting:\n\n1. Battery Optimization -> Unrestricted\n2. Exact Alarms -> Allowed",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Whitelist Battery", onPress: handleBatteryOptimizationPress },
                        { text: "Allow Alarm Settings", onPress: handleExactAlarmPress }
                      ]
                    );
                  } else {
                    showCustomAlert(
                      "Fully Whitelisted",
                      "Echo Spend is fully authorized to run in the background. SMS received while deep sleeping will parse instantly.",
                      [{ text: "Nice" }]
                    );
                  }
                }}
              />
            )}

            {/* Payday Cycle */}
            <Row
              icon={preferences?.salaryDay !== 1 ? <LucideCheckCircle2 color={colors.success} size={20} /> : <LucideLightbulb color={colors.primary} size={18} />}
              label="Smart Pay Cycle Reset"
              sub={preferences?.salaryDay !== 1 
                ? `Monthly budget and limits calculation resets on day ${preferences?.salaryDay}.` 
                : "Reset spends on your actual payday (e.g. the 25th or 30th) rather than the 1st of the month."}
              right={
                <View style={[styles.badge, { backgroundColor: preferences?.salaryDay !== 1 ? `${colors.success}20` : `${colors.primary}20` }]}>
                  <ThemedText style={[styles.badgeText, { color: preferences?.salaryDay !== 1 ? colors.success : colors.primary }]}>
                    {preferences?.salaryDay !== 1 ? "CUSTOMIZED" : "TIP"}
                  </ThemedText>
                </View>
              }
              onPress={() => {
                triggerHaptic();
                showCustomAlert(
                  "Smart Pay Day",
                  "Go back to Settings, find the 'Financial Planning' section, and set the Salary Day to when your paycheck actually arrives. Your monthly stats will align with your actual cash flow!",
                  [{ text: "Got it" }]
                );
              }}
            />

            {/* Note Hashtags */}
            <Row
              icon={<LucideLightbulb color={colors.primary} size={18} />}
              label="Use Note Hashtags"
              sub="Tag transactions with #trip, #gifts, or #repair to group related spends together."
              right={
                <View style={[styles.badge, { backgroundColor: `${colors.primary}20` }]}>
                  <ThemedText style={[styles.badgeText, { color: colors.primary }]}>
                    TIP
                  </ThemedText>
                </View>
              }
              border={false}
              onPress={() => {
                triggerHaptic();
                showCustomAlert(
                  "Hashtag Filtering",
                  "Type a tag (like #wedding) in any transaction's notes. When searching or filtering transactions later, just search for that tag. It aggregates totals automatically, which is perfect for event budget tracking!",
                  [{ text: "I'll try it" }]
                );
              }}
            />

          </View>
        </ScrollView>
      </View>

      {/* Rich Themed Custom Alert */}
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        buttons={alertButtons}
        onClose={() => setAlertVisible(false)}
      />
    </ThemedSafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  progressCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressSub: {
    fontSize: 11,
    lineHeight: 16,
  },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', marginVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 18 },
  iconWrapper: { width: 32, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  subText: { fontSize: 11, marginTop: 4, lineHeight: 16 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '700' },
});

export default TipsScreen;
