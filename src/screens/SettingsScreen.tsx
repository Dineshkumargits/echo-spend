import { ThemedSafeAreaView, ThemedText } from '../components/ThemedSafeAreaView';
import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Linking,
  NativeModules,
  AppState,
} from 'react-native';
import { MotiView } from 'moti';
import {
  LucideCloudSync,
  LucideDownload,
  LucideBrain,
  LucideChevronRight,
  LucideFingerprint,
  LucideBell,
  LucideSun,
  LucideMoon,
  LucideMonitor,
  LucideRefreshCcw,
  LucideShield,
  LucideWallet,
  LucideTag,
  LucideUserCircle,
  LucideLogOut,
  LucideTimer,
  LucideEyeOff,
  LucideZap,
  LucideLayout,
  LucideTrash2,
  LucideCpu,
  LucideAlertTriangle,
  LucidePlay,
  LucidePause,
  LucideX,
  LucideSparkles,
  LucideLightbulb,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';
import { notify } from '../utils/notify';
import { useStore } from '../store/useStore';
import { SyncService } from '../services/sync';
import { resetAllData } from '../services/database';
import { useBiometric } from '../hooks/useBiometric';
import { useTheme } from '../theme/ThemeProvider';
import { registerBackgroundTasks } from '../services/backgroundTasks';
import { NotificationService } from '../services/notifications';
import { AIModelManager } from '../services/aiModelManager';
import { TourGuideModal } from '../components/TourGuideModal';

const extra = Constants.expoConfig?.extra ?? {};

GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId,
  offlineAccess: true,
  scopes: ['https://www.googleapis.com/auth/drive.appdata'],
});

const SettingsScreen = ({ navigation }: any) => {
  const {
    preferences,
    lastSynced,
    googleUser,
    isSyncing,
    setTheme,
    setSyncSchedule,
    setSyncTime,
    setGoogleUser,
    updateLastSynced,
    resetOnboarding,
    fullLogout,
    toggleAutoApprove,
    setAutoApproveThreshold,
    toggleBiometricLock,
    toggleBudgetAlerts,
    toggleRecurringAlerts,
    toggleWeeklyDigest,
    toggleDailyReminder,
    setMonthlyBudget,
    toggleHideAmounts,
    toggleHaptics,
    setLaunchScreen,
    setSalaryDay,
    setAutoLockMinutes,
    toggleAutoSmsScan,
  } = useStore();

  const aiModelStatus = useStore(s => s.aiModelStatus);
  const aiModelProgress = useStore(s => s.aiModelProgress);
  const aiModelError = useStore(s => s.aiModelError);

  const { BackgroundOptimizationModule } = NativeModules;

  const [isBatteryOptimized, setIsBatteryOptimized] = useState(true);
  const [isExactAlarmAllowed, setIsExactAlarmAllowed] = useState(true);

  const checkBackgroundPermissions = async () => {
    if (Platform.OS !== 'android' || !BackgroundOptimizationModule) return;
    try {
      const ignoring = await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
      setIsBatteryOptimized(!ignoring);

      const alarmAllowed = await BackgroundOptimizationModule.isExactAlarmAllowed();
      setIsExactAlarmAllowed(alarmAllowed);
    } catch (e) {
      console.warn('[Settings] Failed to check background permissions:', e);
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

  const handleBatteryOptimizationPress = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!BackgroundOptimizationModule) {
      Alert.alert(
        "Rebuild Required",
        "We've added native Android code to handle background tasks and SMS listening. Please stop your current run and execute 'yarn android' in your terminal to compile the new native features."
      );
      return;
    }
    try {
      const isIgnoringNow = await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
      if (isIgnoringNow) {
        Alert.alert("Already Allowed", "Echo Spend is already whitelisted from battery optimizations.");
        return;
      }
      
      Alert.alert(
        "Disable Battery Optimization",
        "Android restricts network and background task execution for battery-saving. To run cloud backups and scan SMS instantly, allow Echo Spend to run unrestricted in the background.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Request Whitelist",
            onPress: async () => {
              await BackgroundOptimizationModule.requestIgnoreBatteryOptimizations();
            }
          }
        ]
      );
    } catch (e: any) {
      notify.error("Failed to request battery whitelisting", e?.message);
    }
  };

  const handleExactAlarmPress = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!BackgroundOptimizationModule) {
      Alert.alert(
        "Rebuild Required",
        "We've added native Android code to handle background tasks and SMS listening. Please stop your current run and execute 'yarn android' in your terminal to compile the new native features."
      );
      return;
    }
    try {
      const isAllowedNow = await BackgroundOptimizationModule.isExactAlarmAllowed();
      if (isAllowedNow) {
        Alert.alert("Already Allowed", "Echo Spend already has exact alarm scheduling permissions.");
        return;
      }

      Alert.alert(
        "Allow Exact Alarms",
        "To sync and backup exactly at your scheduled time daily, Echo Spend needs the 'Alarms & Reminders' permission. Tap to open Settings and toggle it on.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: async () => {
              await BackgroundOptimizationModule.openExactAlarmSettings();
            }
          }
        ]
      );
    } catch (e: any) {
      notify.error("Failed to open exact alarm settings", e?.message);
    }
  };
  
  const { colors, isDark } = useTheme();
  
  const [aiModelSize, setAiModelSize] = useState<string>('');
  
  const [thresholdInput, setThresholdInput] = useState((preferences?.autoApproveThreshold ?? 100).toString());
  const [budgetInput, setBudgetInput] = useState((preferences?.monthlyBudget ?? 50000).toString());
  const [syncTimeInput, setSyncTimeInput] = useState(preferences?.syncTime ?? '03:00');
  const [salaryDayInput, setSalaryDayInput] = useState((preferences?.salaryDay ?? 1).toString());
  
  const [autoLockInput, setAutoLockInput] = useState((preferences?.autoLockMinutes ?? 5).toString());

  const { checkSupport, authenticate, isSupported } = useBiometric();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    checkSupport();
    if (preferences.syncSchedule !== 'none' && googleUser) {
      registerBackgroundTasks();
    }
    // Check AI model size on disk
    AIModelManager.getModelSizeOnDisk().then(size => {
      if (size > 0) setAiModelSize(`${(size / (1024 * 1024)).toFixed(0)} MB`);
    });
  }, [aiModelStatus]);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences.hapticsEnabled) {
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

  const handleSyncNow = async () => {
    if (isSyncing) return;
    if (!googleUser) {
      handleGoogleSignIn();
      return;
    }
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    const success = await SyncService.syncToGoogleDrive();
    if (success) {
      notify.success('Synced to Google Drive');
    } else {
      notify.error('Sync failed. Check your connection.');
    }
  };

  const handleRestoreFromDrive = () => {
    if (!googleUser) {
       notify.info('Please link your Google account first');
       return;
    }

    Alert.alert(
      'Restore from Google Drive',
      'This will replace ALL local data with the Drive backup. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore Now',
          style: 'destructive',
          onPress: async () => {
            const ok = await SyncService.restoreFromGoogleDrive();
            if (ok) {
              notify.success('Data Restored Successfully');
              triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
            } else {
              notify.error('Restore failed');
            }
          },
        },
      ]
    );
  };

  const handleSaveSyncTime = () => {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (timeRegex.test(syncTimeInput)) {
      setSyncTime(syncTimeInput);
      notify.success('Sync time updated');
      registerBackgroundTasks();
    } else {
      setSyncTimeInput(preferences.syncTime);
    }
  };

  const handleSaveBudget = () => {
    const val = parseFloat(budgetInput);
    if (!isNaN(val)) {
      setMonthlyBudget(val);
      notify.success('Budget updated');
    } else {
      setBudgetInput(preferences.monthlyBudget.toString());
    }
  };

  const handleSaveThreshold = () => {
    const val = parseFloat(thresholdInput);
    if (!isNaN(val)) {
      setAutoApproveThreshold(val);
      notify.success('Threshold updated');
    } else {
      setThresholdInput(preferences.autoApproveThreshold.toString());
    }
  };

  const handleSaveSalaryDay = () => {
    const val = parseInt(salaryDayInput);
    if (!isNaN(val) && val >= 1 && val <= 31) {
      setSalaryDay(val);
      notify.success('Financial cycle updated');
    } else {
      setSalaryDayInput(preferences.salaryDay.toString());
    }
  };

  const handleSaveAutoLock = () => {
    const val = parseInt(autoLockInput);
    if (!isNaN(val) && val >= 1 && val <= 60) {
      setAutoLockMinutes(val);
      notify.success('Auto-lock delay updated');
    } else {
      setAutoLockInput(preferences.autoLockMinutes.toString());
    }
  };

  const handleBiometricToggle = async () => {
    if (!preferences.biometricLock) {
      if (!isSupported) {
        Alert.alert('Biometric Error', 'Hardware not available.');
        return;
      }
      const ok = await authenticate('Confirm to enable');
      if (!ok) return;
    }
    toggleBiometricLock();
  };

  const handleLogout = () => {
    const alertMessage = googleUser
      ? 'This will PERMANENTLY delete all local transactions, accounts, and settings.\n\nIMPORTANT: Please ensure you have synced your data to Google Drive before proceeding, as this local data cannot be recovered once deleted.\n\nAre you absolutely sure?'
      : 'This will PERMANENTLY delete all local transactions, accounts, and settings.\n\nSince you are in local-only mode, your data is not backed up to the cloud and cannot be recovered once deleted.\n\nAre you absolutely sure?';

    Alert.alert(
      googleUser ? 'Logout & Wipe Data' : 'Reset App & Wipe Data',
      alertMessage,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: googleUser ? 'Logout & Delete Everything' : 'Reset & Delete Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Sign out of Google if linked
              if (googleUser) {
                await GoogleSignin.signOut();
              }
              
              // 2. Wipe the SQLite database (includes categories/settings)
              await resetAllData();
              
              // 3. Clear all persisted store state and SecureStore
              await fullLogout();
              
              notify.success(googleUser ? 'Logged out and data wiped' : 'App reset and data wiped');
              triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
            } catch (error) {
              console.error('Logout failed', error);
              notify.error('Logout failed partially');
            }
          },
        },
      ]
    );
  };

  const Section = ({ title }: { title: string }) => (
    <ThemedText type="secondary" className="text-xs uppercase tracking-widest mb-3 mt-6 ml-1">{title}</ThemedText>
  );

  const Row = ({ icon, label, sub, right, onPress, danger }: any) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center px-4 py-4 ${onPress ? 'active:opacity-70' : ''}`}
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
    >
      <View className="w-8 items-center mr-3">{icon}</View>
      <View className="flex-1">
        <ThemedText className="font-medium" style={{ color: danger ? colors.danger : colors.primary }}>{label}</ThemedText>
        {sub && <ThemedText type="secondary" className="text-xs mt-0.5" numberOfLines={1}>{sub}</ThemedText>}
      </View>
      {right ?? (onPress && <LucideChevronRight color={colors.secondary} size={16} />)}
    </TouchableOpacity>
  );

  return (
    <ThemedSafeAreaView>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        <MotiView from={{ opacity: 0, translateY: -20 }} animate={{ opacity: 1, translateY: 0 }} className="mt-6 mb-2">
          <ThemedText type="secondary" className="text-sm uppercase tracking-widest">Settings</ThemedText>
          <ThemedText className="text-3xl font-bold">Preferences</ThemedText>
        </MotiView>

        {/* ── Google Cloud Sync ── */}
        <Section title="Google Cloud Sync" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {!googleUser ? (
            <Row
              icon={<LucideUserCircle color={colors.secondary} size={20} />}
              label="Link Google Cloud"
              sub="Secure your data with daily Drive backups"
              onPress={handleGoogleSignIn}
              right={<View className="bg-accent px-3 py-1 rounded-full"><ThemedText className="text-[10px] font-bold text-white">CONNECT</ThemedText></View>}
            />
          ) : (
            <>
              <Row
                icon={<LucideCloudSync color={colors.success} size={20} />}
                label={googleUser.name}
                sub={googleUser.email}
                right={<TouchableOpacity onPress={handleLogout}><LucideLogOut color={colors.danger} size={18} /></TouchableOpacity>}
              />
              <Row
                icon={<LucideRefreshCcw color={colors.accent} size={18} />}
                label="Manual Backup"
                sub={lastSynced ? `Last: ${new Date(lastSynced).toLocaleString('en-IN')}` : 'Never synced'}
                onPress={handleSyncNow}
                right={isSyncing ? <ActivityIndicator size="small" color={colors.accent} /> : <ThemedText className="text-xs font-bold" style={{ color: colors.accent }}>SYNC NOW</ThemedText>}
              />
              <Row icon={<LucideTimer color={colors.primary} size={18} />} label="Sync Schedule" sub={`Frequency: ${preferences.syncSchedule}`} />
              <View className="flex-row p-1" style={{ backgroundColor: colors.translucent }}>
                {(['none', 'daily', 'weekly'] as const).map(s => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => { setSyncSchedule(s); setTimeout(() => registerBackgroundTasks(), 0); }}
                    style={[{ flex: 1, padding: 8, alignItems: 'center', borderRadius: 8 }, preferences.syncSchedule === s && { backgroundColor: colors.surface, elevation: 1 }]}
                  >
                    <ThemedText style={{ fontSize: 10, fontWeight: 'bold', color: preferences.syncSchedule === s ? colors.primary : colors.secondary }}>{s.toUpperCase()}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              {preferences.syncSchedule !== 'none' && (
                <View className="p-4 border-t" style={{ borderTopColor: colors.border }}>
                   <ThemedText type="secondary" className="text-[10px] uppercase font-bold mb-2">Sync Time (Auto)</ThemedText>
                   <View className="flex-row gap-2">
                     <TextInput 
                        className="bg-border flex-1 p-2 rounded-apple-sm font-bold" 
                        style={{ color: colors.primary }}
                        value={syncTimeInput}
                        onChangeText={setSyncTimeInput}
                        onBlur={handleSaveSyncTime}
                        placeholder="HH:MM"
                        keyboardType="numbers-and-punctuation"
                     />
                     <TouchableOpacity onPress={handleSaveSyncTime} className="bg-accent px-4 justify-center rounded-apple-sm"><ThemedText className="text-white font-bold text-xs">SET</ThemedText></TouchableOpacity>
                   </View>
                </View>
              )}
            </>
          )}
          <Row icon={<LucideDownload color={colors.primary} size={20} />} label="Restore Data" sub="Replace local data with Drive backup" onPress={handleRestoreFromDrive} />
        </View>

        {/* ── Privacy & Security ── */}
        <Section title="Privacy & Security" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Row
            icon={<LucideEyeOff color={colors.primary} size={18} />}
            label="Mask Amount Values"
            sub="Asterisks (****) on Dashboard"
            right={<Switch value={preferences.hideAmounts} onValueChange={toggleHideAmounts} trackColor={{ true: colors.success }} />}
          />
          <Row
            icon={<LucideShield color={colors.primary} size={20} />}
            label="Biometric Lock"
            sub="Authenticate on app launch"
            right={<Switch value={preferences.biometricLock} onValueChange={handleBiometricToggle} trackColor={{ true: colors.success }} />}
          />
          {preferences.biometricLock && (
            <View className="p-4 border-t" style={{ borderTopColor: colors.border }}>
              <ThemedText type="secondary" className="text-[10px] uppercase font-bold mb-2">Auto-lock After (minutes, 1–60)</ThemedText>
              <View className="flex-row gap-2">
                <TextInput
                  className="bg-border flex-1 p-2 rounded-apple-sm font-bold"
                  style={{ color: colors.primary }}
                  value={autoLockInput}
                  onChangeText={setAutoLockInput}
                  onBlur={handleSaveAutoLock}
                  keyboardType="numeric"
                />
                <TouchableOpacity onPress={handleSaveAutoLock} className="bg-accent px-4 justify-center rounded-apple-sm">
                  <ThemedText className="text-white font-bold text-xs">SET</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* ── Interaction & Experience ── */}
        <Section title="Experience" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Row
            icon={<LucideZap color={colors.primary} size={18} />}
            label="Haptic Feedback"
            sub="Vibrate on actions"
            right={<Switch value={preferences.hapticsEnabled} onValueChange={toggleHaptics} trackColor={{ true: colors.success }} />}
          />
          <Row icon={<LucideLayout color={colors.primary} size={18} />} label="Startup Screen" sub={`Opens to: ${preferences.defaultLaunchScreen}`} />
          <View className="flex-row p-1" style={{ backgroundColor: colors.translucent }}>
            {(['Dashboard', 'SmartInbox'] as const).map(screen => (
              <TouchableOpacity 
                key={screen} 
                onPress={() => setLaunchScreen(screen)} 
                style={[{ flex: 1, padding: 8, alignItems: 'center', borderRadius: 8 }, preferences.defaultLaunchScreen === screen && { backgroundColor: colors.surface, elevation: 1 }]}
              >
                <ThemedText style={{ fontSize: 10, fontWeight: 'bold', color: preferences.defaultLaunchScreen === screen ? colors.primary : colors.secondary }}>{screen.replace('Smart', '').toUpperCase()}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
          <Row
            icon={<LucideSparkles color={colors.accent} size={18} />}
            label="Echo Spend Tour Guide"
            sub="Explore all features and power-user tips"
            onPress={() => { triggerHaptic(); setShowTour(true); }}
          />
          <Row
            icon={<LucideLightbulb color={colors.primary} size={18} />}
            label="Tips & Tricks"
            sub="Unlock and configure the app's full potential"
            onPress={() => { triggerHaptic(); navigation.navigate('Tips'); }}
          />
        </View>

        {/* ── Financial Cycle ── */}
        <Section title="Financial Planning" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <View className="p-4">
             <View className="flex-row items-center mb-2">
                <LucideWallet color={colors.primary} size={20} className="mr-3"/>
                <ThemedText className="font-medium">Monthly Budget</ThemedText>
             </View>
             <View className="flex-row gap-2">
                <TextInput 
                  className="bg-border flex-1 p-2 rounded-apple-sm font-bold" 
                  style={{ color: colors.primary }}
                  value={budgetInput}
                  onChangeText={setBudgetInput}
                  onBlur={handleSaveBudget}
                  keyboardType="numeric"
                  placeholder="0.00"
                />
                <TouchableOpacity onPress={handleSaveBudget} className="bg-accent px-4 justify-center rounded-apple-sm"><ThemedText className="text-white font-bold text-xs">SAVE</ThemedText></TouchableOpacity>
             </View>
          </View>
          <View className="p-4 border-t" style={{ borderTopColor: colors.border }}>
             <View className="flex-row items-center mb-2">
                <LucideTimer color={colors.primary} size={20} className="mr-3"/>
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
                <TouchableOpacity onPress={handleSaveSalaryDay} className="bg-accent px-4 justify-center rounded-apple-sm"><ThemedText className="text-white font-bold text-xs">SET</ThemedText></TouchableOpacity>
             </View>
             <ThemedText type="secondary" className="text-[10px] mt-2">Adjusts when your monthly spend resets.</ThemedText>
          </View>
        </View>

        {/* ── Categorization ── */}
        <Section title="Organization" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Row icon={<LucideTag color={colors.primary} size={20} />} label="Manage Categories" sub="Icons, colors and sub-groups" onPress={() => navigation.navigate('Categories')} />
        </View>

        {/* ── Notifications ── */}
        <Section title="Alerts" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Row
            icon={<LucideBell color={colors.primary} size={20} />}
            label="Budget Alerts"
            right={<Switch value={preferences.budgetAlerts} onValueChange={toggleBudgetAlerts} trackColor={{ true: colors.success }} />}
          />
          <Row
            icon={<LucideBrain color={colors.primary} size={20} />}
            label="Daily Expense Reminder"
            sub="9:00 PM reminder to record spends"
            right={
              <Switch 
                value={preferences.dailyReminder} 
                onValueChange={() => {
                  triggerHaptic();
                  toggleDailyReminder();
                  // Schedule/Cancel based on the new value (deferred)
                  if (!preferences.dailyReminder) {
                    NotificationService.scheduleDailyReminder();
                  } else {
                    NotificationService.cancelDailyReminder();
                  }
                }} 
                trackColor={{ true: colors.success }} 
              />
            }
          />
          <Row
            icon={<LucideRefreshCcw color={colors.primary} size={20} />}
            label="Bill Reminders"
            right={<Switch value={preferences.recurringAlerts} onValueChange={toggleRecurringAlerts} trackColor={{ true: colors.success }} />}
          />
          <Row
            icon={<LucideDownload color={colors.primary} size={20} />}
            label="Weekly Digest"
            right={<Switch value={preferences.weeklyDigest} onValueChange={toggleWeeklyDigest} trackColor={{ true: colors.success }} />}
          />
        </View>

        {/* ── Appearance ── */}
        <Section title="Aesthetics" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {['dark', 'light', 'system'].map(v => (
            <Row 
              key={v}
              icon={v === 'dark' ? <LucideMoon size={18} color={colors.primary}/> : v === 'light' ? <LucideSun size={18} color={colors.primary}/> : <LucideMonitor size={18} color={colors.primary}/>}
              label={v.charAt(0).toUpperCase() + v.slice(1)} 
              onPress={() => setTheme(v as any)} 
              right={preferences.theme === v ? <View className="w-2 h-2 rounded-full bg-accent"/> : null} 
            />
          ))}
        </View>

        {/* ── Automation ── */}
        <Section title="Automation" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Row
            icon={<LucideBrain color={colors.primary} size={20} />}
            label="Auto-approve Small Spends"
            sub={`Threshold: ${preferences.currency}${preferences.autoApproveThreshold}`}
            right={<Switch value={preferences.autoApproveSmallSpends} onValueChange={toggleAutoApprove} trackColor={{ true: colors.success }} />}
          />
          <Row
            icon={<LucideZap color={colors.primary} size={20} />}
            label="Auto-detect via SMS"
            sub="Detect bank SMS and notify you instantly"
            right={
              <Switch
                value={preferences.autoSmsScan}
                onValueChange={() => {
                  triggerHaptic();
                  toggleAutoSmsScan();
                  // registerBackgroundTasks reads from store after the toggle commits,
                  // so defer by one tick to pick up the updated preference value.
                  setTimeout(() => registerBackgroundTasks(), 0);
                }}
                trackColor={{ true: colors.success }}
              />
            }
          />
          {preferences.autoApproveSmallSpends && (
            <View className="p-4 border-t" style={{ borderTopColor: colors.border }}>
               <ThemedText type="secondary" className="text-[10px] uppercase font-bold mb-2">Threshold Amount ({preferences.currency})</ThemedText>
               <View className="flex-row gap-2">
                 <TextInput 
                    className="bg-border flex-1 p-2 rounded-apple-sm font-bold" 
                    style={{ color: colors.primary }}
                    value={thresholdInput}
                    onChangeText={setThresholdInput}
                    onBlur={handleSaveThreshold}
                    keyboardType="numeric"
                 />
                 <TouchableOpacity onPress={handleSaveThreshold} className="bg-accent px-4 justify-center rounded-apple-sm"><ThemedText className="text-white font-bold text-xs">SET</ThemedText></TouchableOpacity>
               </View>
            </View>
          )}
        </View>

        {/* ── AI Engine ── */}
        <Section title="AI Engine" />
        <View className="rounded-apple-md overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          {!AIModelManager.isDeviceCompatible() ? (
            /* Low RAM Compatibility Warning */
            <>
              <Row
                icon={<LucideAlertTriangle color={colors.danger} size={20} />}
                label="AI Engine Incompatible"
                sub="Your device has less than 2GB of total RAM. On-device AI is disabled to prevent crashes."
              />
              <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                <ThemedText type="secondary" className="text-xs">
                  Echo Spend will fall back to high-performance local regex parsing. No action is required.
                </ThemedText>
              </View>
            </>
          ) : aiModelStatus === 'not_downloaded' ? (
            /* Model not downloaded — show download prompt */
            <>
              <Row
                icon={<LucideAlertTriangle color={colors.warning} size={20} />}
                label="AI Model Not Installed"
                sub="Smart SMS parsing is using basic mode"
              />
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                  navigation.navigate('AIModelSetup');
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 8, paddingVertical: 12, margin: 12, borderRadius: 12,
                  backgroundColor: colors.accent,
                }}
              >
                <LucideDownload color="#fff" size={16} />
                <ThemedText style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>
                  Download AI Model (~980 MB)
                </ThemedText>
              </TouchableOpacity>
            </>
          ) : aiModelStatus === 'downloading' ? (
            /* Downloading */
            <>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic();
                  navigation.navigate('AIModelSetup');
                }}
              >
                <Row
                  icon={<LucideDownload color={colors.accent} size={20} />}
                  label="Downloading AI Model..."
                  sub={`${aiModelProgress}% complete • Tap to view progress`}
                />
              </TouchableOpacity>
            </>
          ) : aiModelStatus === 'error' ? (
            /* Error */
            <>
              <TouchableOpacity
                onPress={() => {
                  triggerHaptic();
                  navigation.navigate('AIModelSetup');
                }}
              >
                <Row
                  icon={<LucideAlertTriangle color={colors.danger} size={20} />}
                  label="AI Model Download Failed"
                  sub="Tap to retry or cancel setup"
                />
              </TouchableOpacity>
            </>
          ) : (
            /* Model is downloaded/ready */
            <>
              <Row
                icon={<LucideCpu color={colors.success} size={20} />}
                label="On-Device AI"
                sub={`Llama 3.2 1B • ${aiModelSize || '~980 MB'} • ${aiModelStatus === 'ready' ? 'Active' : 'Downloaded'}`}
                right={
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: `${colors.success}20` }}>
                    <ThemedText style={{ fontSize: 10, fontWeight: '700', color: colors.success }}>
                      {aiModelStatus === 'ready' ? 'ACTIVE' : 'READY'}
                    </ThemedText>
                  </View>
                }
              />
              <Row
                icon={<LucideTrash2 color={colors.danger} size={18} />}
                label="Delete AI Model"
                sub={`Free up ${aiModelSize || '~980 MB'} of storage`}
                onPress={() => {
                  Alert.alert(
                    'Delete AI Model?',
                    'Without the AI model, SMS analysis will use basic pattern matching which is less accurate for unusual transactions.\n\nYou\'ll need to re-download ~980 MB later to restore AI features.',
                    [
                      { text: 'Keep Model', style: 'cancel' },
                      {
                        text: 'Delete Model',
                        style: 'destructive',
                        onPress: async () => {
                           await AIModelManager.deleteModel();
                           setAiModelSize('');
                           notify.info('AI model deleted', 'Using basic SMS parsing mode');
                           triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
                        },
                      },
                    ]
                  );
                }}
              />
            </>
          )}
        </View>

        <Section title="Data & Privacy" />
        <View className="rounded-apple-md overflow-hidden mb-24" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Row icon={<LucideDownload color={colors.primary} size={20} />} label="Export to CSV" onPress={() => SyncService.exportToCSV()} />
          {!googleUser && (
            <Row icon={<LucideLogOut color={colors.danger} size={18} />} label="Reset App & Wipe Data" onPress={handleLogout} danger />
          )}
        </View>

        {/* ── Developer Testing ── (Hidden in Release) */}
        {__DEV__ && (
          <>
            <Section title="Developer Testing" />
            <View className="rounded-apple-md overflow-hidden mb-24" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
               <Row 
                 icon={<LucideZap color={colors.accent} size={20} />} 
                 label="Test Transaction Notification" 
                 sub="Single transaction deep-link to SmartInbox" 
                 onPress={() => NotificationService.notifyNewTransaction(1250, 'Starbucks', 'Food')} 
               />
               <Row 
                 icon={<LucideZap color={colors.accent} size={20} />} 
                 label="Test Batch Notification" 
                 sub="Multiple transactions deep-link to SmartInbox" 
                 onPress={() => NotificationService.notifyBatchTransactions(3, 4500, 'Zomato')} 
               />
               <Row 
                 icon={<LucideBell color={colors.warning} size={20} />} 
                 label="Test Budget Alert" 
                 sub="80% utilization deep-link to Home" 
                 onPress={() => NotificationService.notifyBudgetAlert(42000, 50000, preferences.currency)} 
               />
               <Row 
                 icon={<LucideLayout color={colors.primary} size={20} />} 
                 label="Test Weekly Digest" 
                 sub="Summary deep-link to Analytics" 
                 onPress={() => NotificationService.notifyWeeklyDigest(15400, 'Shopping', preferences.currency)} 
               />
               <Row 
                 icon={<LucideBell color={colors.accent} size={20} />} 
                 label="Test Daily Reminder" 
                 sub="Immediate test of 9PM check-in msg" 
                 onPress={() => {
                   NotificationService.scheduleLocalNotification(
                     'Daily Expense Check-in',
                     "Don't forget to add today's expenses! Tap to open Echo Spend.",
                     'alerts',
                     { screen: 'Dashboard' }
                   );
                 }} 
               />
            </View>
          </>
        )}

        {/* ── Android Background Tasks (Android Only) ── */}
        {Platform.OS === 'android' && (
          <>
            <Section title="Background Tasks & Sync (Android)" />
            <View className="rounded-apple-md overflow-hidden mb-24" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Row
                icon={<LucideZap color={isBatteryOptimized ? colors.warning : colors.success} size={20} />}
                label="Unrestricted Background Run"
                sub={isBatteryOptimized ? "Restricted — tap to request whitelisting" : "Allowed — app runs freely in background"}
                onPress={handleBatteryOptimizationPress}
                right={
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: isBatteryOptimized ? `${colors.warning}20` : `${colors.success}20` }}>
                    <ThemedText style={{ fontSize: 10, fontWeight: '700', color: isBatteryOptimized ? colors.warning : colors.success }}>
                      {isBatteryOptimized ? "RESTRICTED" : "UNRESTRICTED"}
                    </ThemedText>
                  </View>
                }
              />
              <Row
                icon={<LucideTimer color={isExactAlarmAllowed ? colors.success : colors.warning} size={20} />}
                label="Exact Alarm Scheduling"
                sub={isExactAlarmAllowed ? "Allowed — backups run precisely on time" : "Delayed — tap to grant exact alarm permission"}
                onPress={handleExactAlarmPress}
                right={
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: isExactAlarmAllowed ? `${colors.success}20` : `${colors.warning}20` }}>
                    <ThemedText style={{ fontSize: 10, fontWeight: '700', color: isExactAlarmAllowed ? colors.success : colors.warning }}>
                      {isExactAlarmAllowed ? "ALLOWED" : "DELAYED"}
                    </ThemedText>
                  </View>
                }
              />
              <Row
                icon={<LucideAlertTriangle color={colors.accent} size={20} />}
                label="Background Troubleshooting Guide"
                sub="Guide to keep background tasks alive on OEM devices"
                onPress={() => {
                  Linking.openURL('https://dontkillmyapp.com').catch(() => {
                    notify.error("Could not open troubleshooting URL");
                  });
                }}
              />
            </View>
          </>
        )}
      </ScrollView>
      <TourGuideModal visible={showTour} onClose={() => setShowTour(false)} />
      </KeyboardAvoidingView>
    </ThemedSafeAreaView>
  );
};

export default SettingsScreen;
