import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, { useEffect, useState } from "react";
import * as Notifications from "expo-notifications";
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
  PermissionsAndroid,
  Image,
} from "react-native";
import { MotiView } from "moti";
import {
  LucideDownload,
  LucideBrain,
  LucideChevronRight,
  LucideBell,
  LucideSun,
  LucideMoon,
  LucideMonitor,
  LucideCheck,
  LucideRefreshCcw,
  LucideShield,
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
  LucideSparkles,
  LucideLightbulb,
  LucideWallet,
  LucideCalendar,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";
import { notify } from "../utils/notify";
import { useStore } from "../store/useStore";
import { SyncService } from "../services/sync";
import { resetAllData } from "../services/database";
import { useBiometric } from "../hooks/useBiometric";
import { useTheme } from "../theme/ThemeProvider";
import { registerBackgroundTasks } from "../services/backgroundTasks";
import { NotificationService } from "../services/notifications";
import { AIModelManager } from "../services/aiModelManager";
import { TourGuideModal } from "../components/TourGuideModal";
import { SectionLabel } from "../components/Signal";
import { fonts, THEMES, themeSwatches } from "../theme/tokens";

const extra = Constants.expoConfig?.extra ?? {};

GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId,
  offlineAccess: true,
  scopes: ["https://www.googleapis.com/auth/drive.appdata"],
});

const SettingsScreen = ({ navigation }: any) => {
  const {
    preferences,
    lastSynced,
    googleUser,
    setTheme,
    setThemeId,
    fullLogout,
    toggleAutoApprove,
    setAutoApproveThreshold,
    toggleBiometricLock,
    toggleBudgetAlerts,
    toggleRecurringAlerts,
    toggleWeeklyDigest,
    toggleDailyReminder,
    toggleHaptics,
    setAutoLockMinutes,
    toggleAutoSmsScan,
  } = useStore();

  const aiModelStatus = useStore((s) => s.aiModelStatus);
  const aiModelProgress = useStore((s) => s.aiModelProgress);
  const aiModelError = useStore((s) => s.aiModelError);

  const { BackgroundOptimizationModule } = NativeModules;

  const [isBatteryOptimized, setIsBatteryOptimized] = useState(true);
  const [isExactAlarmAllowed, setIsExactAlarmAllowed] = useState(true);
  const [isNotificationGranted, setIsNotificationGranted] = useState(true);

  const checkBackgroundPermissions = async () => {
    // Check notification permission (all platforms)
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setIsNotificationGranted(status === "granted");
    } catch (e) {
      console.warn("[Settings] Failed to check notification permission:", e);
    }

    if (Platform.OS !== "android" || !BackgroundOptimizationModule) return;
    try {
      const ignoring =
        await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
      setIsBatteryOptimized(!ignoring);

      const alarmAllowed =
        await BackgroundOptimizationModule.isExactAlarmAllowed();
      setIsExactAlarmAllowed(alarmAllowed);
    } catch (e) {
      console.warn("[Settings] Failed to check background permissions:", e);
    }
  };

  useEffect(() => {
    checkBackgroundPermissions();

    if (Platform.OS === "android") {
      const subscription = AppState.addEventListener("change", (nextState) => {
        if (nextState === "active") {
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
        "We've added native Android code to handle background tasks and SMS listening. Please stop your current run and execute 'yarn android' in your terminal to compile the new native features.",
      );
      return;
    }
    try {
      const isIgnoringNow =
        await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
      if (isIgnoringNow) {
        Alert.alert(
          "Already Allowed",
          "Echo Spend is already whitelisted from battery optimizations.",
        );
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
            },
          },
        ],
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
        "We've added native Android code to handle background tasks and SMS listening. Please stop your current run and execute 'yarn android' in your terminal to compile the new native features.",
      );
      return;
    }
    try {
      const isAllowedNow =
        await BackgroundOptimizationModule.isExactAlarmAllowed();
      if (isAllowedNow) {
        Alert.alert(
          "Already Allowed",
          "Echo Spend already has exact alarm scheduling permissions.",
        );
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
            },
          },
        ],
      );
    } catch (e: any) {
      notify.error("Failed to open exact alarm settings", e?.message);
    }
  };

  const handleAutoSmsScanToggle = async (value: boolean) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!value) {
      toggleAutoSmsScan();
      setTimeout(() => registerBackgroundTasks(), 0);
      return;
    }

    const proceedWithSmsScanEnable = async () => {
      if (Platform.OS === "android" && BackgroundOptimizationModule) {
        try {
          const ignoring =
            await BackgroundOptimizationModule.isIgnoringBatteryOptimizations();
          if (!ignoring) {
            Alert.alert(
              "Recommended Setting",
              "To scan SMS messages reliably in the background (especially when your phone is asleep), we recommend setting Echo Spend to run 'Unrestricted' in battery settings.",
              [
                {
                  text: "Not Now",
                  style: "cancel",
                  onPress: () => {
                    toggleAutoSmsScan();
                    setTimeout(() => registerBackgroundTasks(), 0);
                  },
                },
                {
                  text: "Set Unrestricted",
                  onPress: async () => {
                    try {
                      await BackgroundOptimizationModule.requestIgnoreBatteryOptimizations();
                    } catch (err) {
                      console.warn(
                        "[Settings] Failed to request battery optimization bypass:",
                        err,
                      );
                    }
                    toggleAutoSmsScan();
                    setTimeout(() => registerBackgroundTasks(), 0);
                  },
                },
              ],
            );
            return;
          }
        } catch (e) {
          console.warn("[Settings] Failed to check battery optimization:", e);
        }
      }

      toggleAutoSmsScan();
      setTimeout(() => registerBackgroundTasks(), 0);
    };

    if (Platform.OS === "android") {
      try {
        const hasSmsPerm = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.READ_SMS,
        );
        if (!hasSmsPerm) {
          Alert.alert(
            "SMS Transaction Scanning",
            "Echo Spend requests permission to read and receive SMS messages (READ_SMS and RECEIVE_SMS) to automatically scan, detect, and import financial transactions from your bank or card alerts. This process runs completely locally and offline on your device, ensuring your sensitive financial data remains private.\n\nDo you want to enable this feature and grant the required permissions?",
            [
              {
                text: "Decline",
                style: "cancel",
                onPress: () => {
                  // Do nothing
                },
              },
              {
                text: "Agree & Enable",
                onPress: async () => {
                  try {
                    const granted = await PermissionsAndroid.request(
                      PermissionsAndroid.PERMISSIONS.READ_SMS,
                      {
                        title: "SMS Permission Required",
                        message:
                          "Echo Spend needs permission to read financial SMS messages to automatically scan transactions.",
                        buttonPositive: "Grant",
                        buttonNegative: "Cancel",
                      },
                    );
                    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
                      await proceedWithSmsScanEnable();
                    } else {
                      Alert.alert(
                        "Permission Denied",
                        "Echo Spend cannot auto-scan transactions without SMS permissions.",
                      );
                    }
                  } catch (e) {
                    console.warn(
                      "[Settings] Failed to request SMS permission:",
                      e,
                    );
                  }
                },
              },
            ],
          );
          return;
        }
      } catch (e) {
        console.warn("[Settings] Failed to check SMS permission:", e);
        return;
      }
    }

    await proceedWithSmsScanEnable();
  };

  const checkNotificationPermission = async (featureName: string) => {
    try {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        Alert.alert(
          "Notification Permission Required",
          `To receive ${featureName}, Echo Spend needs permission to show notifications. Please enable notifications in your system settings.`,
        );
        return false;
      }

      if (Platform.OS === "android" && BackgroundOptimizationModule) {
        const alarmAllowed =
          await BackgroundOptimizationModule.isExactAlarmAllowed();
        if (!alarmAllowed) {
          Alert.alert(
            "Precision Alarm Recommendation",
            `To deliver ${featureName} precisely at the scheduled time, Echo Spend recommends the 'Alarms & Reminders' permission. Without it, alerts will still be delivered but may be slightly delayed by the system.`,
            [
              { text: "Continue" },
              {
                text: "Open Settings",
                onPress: async () => {
                  await BackgroundOptimizationModule.openExactAlarmSettings();
                },
              },
            ],
          );
        }
      }

      return true;
    } catch (e) {
      console.warn(
        `[Settings] Failed to check/request permission for ${featureName}:`,
        e,
      );
      return false;
    }
  };

  const handleDailyReminderToggle = async (value: boolean) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!value) {
      toggleDailyReminder();
      await NotificationService.cancelDailyReminder();
      return;
    }

    const hasPerm = await checkNotificationPermission(
      "daily expense reminders",
    );
    if (!hasPerm) return;

    toggleDailyReminder();
    await NotificationService.scheduleDailyReminder();
  };

  const handleBudgetAlertsToggle = async (value: boolean) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!value) {
      toggleBudgetAlerts();
      return;
    }

    const hasPerm = await checkNotificationPermission("budget alerts");
    if (!hasPerm) return;

    toggleBudgetAlerts();
  };

  const handleRecurringAlertsToggle = async (value: boolean) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!value) {
      toggleRecurringAlerts();
      return;
    }

    const hasPerm = await checkNotificationPermission("bill reminders");
    if (!hasPerm) return;

    toggleRecurringAlerts();
  };

  const handleWeeklyDigestToggle = async (value: boolean) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (!value) {
      toggleWeeklyDigest();
      return;
    }

    const hasPerm = await checkNotificationPermission("weekly digests");
    if (!hasPerm) return;

    toggleWeeklyDigest();
  };

  const { colors, isDark, themeId } = useTheme();

  const [aiModelSize, setAiModelSize] = useState<string>("");

  const [thresholdInput, setThresholdInput] = useState(
    (preferences?.autoApproveThreshold ?? 100).toString(),
  );
  const [autoLockInput, setAutoLockInput] = useState(
    (preferences?.autoLockMinutes ?? 5).toString(),
  );
  const [expectedModelSize, setExpectedModelSize] = useState<string>("~1.2 GB");
  const [loadingExpectedSize, setLoadingExpectedSize] = useState<boolean>(true);

  useEffect(() => {
    AIModelManager.getFormattedExpectedSize()
      .then(setExpectedModelSize)
      .finally(() => setLoadingExpectedSize(false));
  }, []);

  const { checkSupport, authenticate, isSupported } = useBiometric();
  const [showTour, setShowTour] = useState(false);

  useEffect(() => {
    checkSupport();
    if (preferences.syncSchedule !== "none" && googleUser) {
      registerBackgroundTasks();
    }
    // Check AI model size on disk
    AIModelManager.getModelSizeOnDisk().then((size) => {
      if (size > 0) setAiModelSize(`${(size / (1024 * 1024)).toFixed(0)} MB`);
    });
  }, [aiModelStatus]);

  // Sync local text input state when preferences are updated from external sources (e.g. Google Drive restore)
  useEffect(() => {
    setThresholdInput((preferences?.autoApproveThreshold ?? 100).toString());
    setAutoLockInput((preferences?.autoLockMinutes ?? 5).toString());
  }, [preferences?.autoApproveThreshold, preferences?.autoLockMinutes]);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences.hapticsEnabled) {
      Haptics.impactAsync(style);
    }
  };


  const handleSaveThreshold = () => {
    const val = parseFloat(thresholdInput);
    if (!isNaN(val)) {
      setAutoApproveThreshold(val);
      notify.success("Threshold updated");
    } else {
      setThresholdInput(preferences.autoApproveThreshold.toString());
    }
  };

  const handleSaveAutoLock = () => {
    const val = parseInt(autoLockInput);
    if (!isNaN(val) && val >= 1 && val <= 60) {
      setAutoLockMinutes(val);
      notify.success("Auto-lock delay updated");
    } else {
      setAutoLockInput(preferences.autoLockMinutes.toString());
    }
  };

  const handleBiometricToggle = async () => {
    if (!preferences.biometricLock) {
      if (!isSupported) {
        Alert.alert("Biometric Error", "Hardware not available.");
        return;
      }
      const ok = await authenticate("Confirm to enable");
      if (!ok) return;
    }
    toggleBiometricLock();
  };

  const handleLogout = () => {
    const alertMessage = googleUser
      ? "This will PERMANENTLY delete all local transactions, accounts, and settings.\n\nIMPORTANT: Please ensure you have synced your data to Google Drive before proceeding, as this local data cannot be recovered once deleted.\n\nAre you absolutely sure?"
      : "This will PERMANENTLY delete all local transactions, accounts, and settings.\n\nSince you are in local-only mode, your data is not backed up to the cloud and cannot be recovered once deleted.\n\nAre you absolutely sure?";

    Alert.alert(
      googleUser ? "Logout & Wipe Data" : "Reset App & Wipe Data",
      alertMessage,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: googleUser
            ? "Logout & Delete Everything"
            : "Reset & Delete Everything",
          style: "destructive",
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

              notify.success(
                googleUser
                  ? "Logged out and data wiped"
                  : "App reset and data wiped",
              );
              triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
            } catch (error) {
              console.error("Logout failed", error);
              notify.error("Logout failed partially");
            }
          },
        },
      ],
    );
  };

  const alertsBlocked =
    !isNotificationGranted ||
    (Platform.OS === "android" && !isExactAlarmAllowed);

  const Section = ({ title }: { title: string }) => (
    <SectionLabel style={{ marginTop: 26, marginBottom: 10, marginLeft: 4 }}>
      {title}
    </SectionLabel>
  );

  const Row = ({ icon, label, sub, right, onPress, danger }: any) => (
    <TouchableOpacity
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center px-4 py-3.5 ${onPress ? "active:opacity-70" : ""}`}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        gap: 13,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: danger ? colors.alertSoft : colors.translucent,
        }}
      >
        {icon}
      </View>
      <View className="flex-1">
        <ThemedText
          style={{
            fontFamily: fonts.textSemibold,
            fontSize: 15,
            color: danger ? colors.danger : colors.primary,
          }}
        >
          {label}
        </ThemedText>
        {sub && (
          <ThemedText
            type="secondary"
            className="text-xs mt-0.5"
            numberOfLines={2}
          >
            {sub}
          </ThemedText>
        )}
      </View>
      {right ??
        (onPress && <LucideChevronRight color={colors.muted} size={15} />)}
    </TouchableOpacity>
  );

  return (
    <ThemedSafeAreaView>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1 px-6"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          <MotiView
            from={{ opacity: 0, translateY: -20 }}
            animate={{ opacity: 1, translateY: 0 }}
            className="mt-6 mb-2"
          >
            <SectionLabel>Profile & Controls</SectionLabel>
            <ThemedText
              style={{
                fontFamily: fonts.displayBold,
                fontSize: 30,
                letterSpacing: -0.5,
                marginTop: 2,
              }}
            >
              More
            </ThemedText>
          </MotiView>

          {/* ── Account & Backup (entry to detail screen) ── */}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              triggerHaptic();
              navigation.navigate("AccountBackup");
            }}
            className="rounded-apple-md overflow-hidden mt-4 flex-row items-center px-4 py-4"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 14,
            }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.translucent,
                overflow: "hidden",
              }}
            >
              {googleUser?.photo ? (
                <Image
                  source={{ uri: googleUser.photo }}
                  style={{ width: 48, height: 48 }}
                />
              ) : googleUser ? (
                <ThemedText
                  style={{
                    fontFamily: fonts.displayBold,
                    fontSize: 20,
                    color: colors.primary,
                  }}
                >
                  {googleUser.name?.charAt(0)?.toUpperCase() ?? "U"}
                </ThemedText>
              ) : (
                <LucideUserCircle color={colors.secondary} size={26} />
              )}
            </View>
            <View className="flex-1">
              <ThemedText
                style={{ fontFamily: fonts.textSemibold, fontSize: 16 }}
                numberOfLines={1}
              >
                {googleUser ? googleUser.name : "Local Account"}
              </ThemedText>
              <ThemedText
                type="secondary"
                className="text-xs mt-0.5"
                numberOfLines={1}
              >
                {googleUser
                  ? googleUser.email
                  : "Tap to link Google Cloud & back up"}
              </ThemedText>
              <View
                className="flex-row items-center mt-1.5"
                style={{ gap: 5 }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: googleUser
                      ? colors.success
                      : colors.warning,
                  }}
                />
                <ThemedText
                  font="signal"
                  type="secondary"
                  style={{ fontSize: 9, letterSpacing: 0.4 }}
                >
                  {googleUser
                    ? lastSynced
                      ? `SYNCED ${new Date(lastSynced).toLocaleDateString("en-IN")}`
                      : "NEVER SYNCED"
                    : "LOCAL ONLY"}
                </ThemedText>
              </View>
            </View>
            <LucideChevronRight color={colors.muted} size={18} />
          </TouchableOpacity>

          {/* ── Appearance ── */}
          <Section title="Appearance" />

          {/* Light / Dark / System — segmented mode selector */}
          <View
            className="flex-row rounded-apple-md p-1 mb-4"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {(["light", "dark", "system"] as const).map((v) => {
              const active = preferences.theme === v;
              const Icon =
                v === "dark"
                  ? LucideMoon
                  : v === "light"
                    ? LucideSun
                    : LucideMonitor;
              return (
                <TouchableOpacity
                  key={v}
                  onPress={() => {
                    triggerHaptic();
                    setTheme(v as any);
                  }}
                  style={[
                    {
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      paddingVertical: 10,
                      borderRadius: 10,
                    },
                    active && {
                      backgroundColor: colors.translucent,
                    },
                  ]}
                >
                  <Icon
                    size={16}
                    color={active ? colors.accent : colors.secondary}
                  />
                  <ThemedText
                    style={{
                      fontSize: 12,
                      fontFamily: fonts.textSemibold,
                      color: active ? colors.primary : colors.secondary,
                    }}
                  >
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>

          <ThemedText
            type="secondary"
            className="text-[10px] uppercase font-bold mb-2 ml-1"
          >
            Color Theme
          </ThemedText>
          <View className="flex-row flex-wrap justify-between">
            {THEMES.map((t) => {
              const sw = themeSwatches(t, isDark ? "dark" : "light");
              const selected = themeId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  activeOpacity={0.85}
                  onPress={() => setThemeId(t.id)}
                  style={{
                    width: "48.5%",
                    marginBottom: 12,
                    borderRadius: 16,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? sw.accent : colors.border,
                    backgroundColor: sw.bg,
                    padding: 12,
                    overflow: "hidden",
                  }}
                >
                  {/* Mini preview: a surface bar + swatch dots */}
                  <View
                    style={{
                      height: 34,
                      borderRadius: 9,
                      backgroundColor: sw.surface,
                      flexDirection: "row",
                      alignItems: "center",
                      paddingHorizontal: 8,
                      gap: 6,
                    }}
                  >
                    <View
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: sw.accent,
                      }}
                    />
                    <View
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 6,
                        backgroundColor: sw.credit,
                      }}
                    />
                    <View
                      style={{
                        flex: 1,
                        height: 5,
                        borderRadius: 3,
                        backgroundColor: sw.text,
                        opacity: 0.35,
                      }}
                    />
                  </View>
                  <View
                    className="flex-row items-center justify-between"
                    style={{ marginTop: 10 }}
                  >
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        font="display"
                        style={{ color: sw.text, fontSize: 15 }}
                        numberOfLines={1}
                      >
                        {t.name}
                      </ThemedText>
                      <ThemedText
                        style={{
                          color: sw.text,
                          opacity: 0.55,
                          fontSize: 11,
                          marginTop: 1,
                        }}
                        numberOfLines={1}
                      >
                        {t.blurb}
                      </ThemedText>
                    </View>
                    {selected && (
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 10,
                          backgroundColor: sw.accent,
                          alignItems: "center",
                          justifyContent: "center",
                          marginLeft: 6,
                        }}
                      >
                        <LucideCheck size={13} color={sw.bg} strokeWidth={3} />
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Categorization ── */}
          <Section title="Organization" />
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Row
              icon={<LucideTag color={colors.primary} size={20} />}
              label="Manage Categories"
              sub="Icons, colors and sub-groups"
              onPress={() => navigation.navigate("Categories")}
            />
            <Row
              icon={<LucideWallet color={colors.primary} size={20} />}
              label="Budgets & Salary"
              sub="Monthly limits, salary day and spend tracking"
              onPress={() => navigation.navigate("Budget")}
            />
            <Row
              icon={<LucideCalendar color={colors.primary} size={20} />}
              label="Money"
              sub="Goals, loans, subscriptions and splits"
              onPress={() => navigation.navigate("Finances")}
            />
          </View>

          {/* ── Alerts & Reminders ── */}
          <Section title="Alerts & Reminders" />
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {/* ── Permission Status Banner ── */}
            {alertsBlocked && (
              <View
                style={{
                  padding: 16,
                  backgroundColor: `${colors.warning}12`,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <LucideAlertTriangle color={colors.warning} size={16} />
                  <ThemedText
                    style={{ fontWeight: "700", fontSize: 13, marginLeft: 8 }}
                  >
                    Permissions Required
                  </ThemedText>
                </View>
                <ThemedText
                  type="secondary"
                  style={{ fontSize: 11, lineHeight: 16, marginBottom: 12 }}
                >
                  To deliver alerts and reminders precisely at the right time,
                  Echo Spend needs the following permissions:
                </ThemedText>

                {!isNotificationGranted && (
                  <TouchableOpacity
                    onPress={async () => {
                      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                      const { status } =
                        await Notifications.requestPermissionsAsync();
                      if (status === "granted") {
                        setIsNotificationGranted(true);
                      } else {
                        Alert.alert(
                          "Notifications Blocked",
                          "Echo Spend needs notification permissions to deliver alerts. Since the permission was previously denied, please enable it manually in your device settings.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Open Settings",
                              onPress: () => Linking.openSettings(),
                            },
                          ],
                        );
                      }
                    }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: 12,
                      borderRadius: 10,
                      marginBottom: 8,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: `${colors.danger}30`,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flex: 1,
                      }}
                    >
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          backgroundColor: `${colors.danger}15`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <LucideBell color={colors.danger} size={16} />
                      </View>
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <ThemedText style={{ fontWeight: "600", fontSize: 12 }}>
                          Notifications
                        </ThemedText>
                        <ThemedText type="secondary" style={{ fontSize: 10 }}>
                          Show alert banners, badges & sounds
                        </ThemedText>
                      </View>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: colors.accent,
                      }}
                    >
                      <ThemedText
                        style={{
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: "700",
                        }}
                      >
                        ENABLE
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                )}

                {Platform.OS === "android" && !isExactAlarmAllowed && (
                  <TouchableOpacity
                    onPress={async () => {
                      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                      if (BackgroundOptimizationModule) {
                        await BackgroundOptimizationModule.openExactAlarmSettings();
                      }
                    }}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: 12,
                      borderRadius: 10,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: `${colors.danger}30`,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flex: 1,
                      }}
                    >
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          backgroundColor: `${colors.danger}15`,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <LucideTimer color={colors.danger} size={16} />
                      </View>
                      <View style={{ marginLeft: 10, flex: 1 }}>
                        <ThemedText style={{ fontWeight: "600", fontSize: 12 }}>
                          Alarms & Reminders
                        </ThemedText>
                        <ThemedText type="secondary" style={{ fontSize: 10 }}>
                          Precise scheduling at exact times
                        </ThemedText>
                      </View>
                    </View>
                    <View
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                        backgroundColor: colors.accent,
                      }}
                    >
                      <ThemedText
                        style={{
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: "700",
                        }}
                      >
                        ENABLE
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <Row
              icon={
                <LucideBell
                  color={alertsBlocked ? colors.secondary : colors.primary}
                  size={20}
                />
              }
              label="Budget Alerts"
              sub={
                alertsBlocked
                  ? "⚠ Enable permissions above to activate"
                  : undefined
              }
              right={
                <Switch
                  value={preferences.budgetAlerts}
                  onValueChange={(val) => handleBudgetAlertsToggle(val)}
                  trackColor={{ true: colors.success }}
                />
              }
            />
            <Row
              icon={
                <LucideBrain
                  color={alertsBlocked ? colors.secondary : colors.primary}
                  size={20}
                />
              }
              label="Daily Expense Reminder"
              sub={
                alertsBlocked
                  ? "⚠ Enable permissions above to activate"
                  : "9:00 PM reminder to record spends"
              }
              right={
                <Switch
                  value={preferences.dailyReminder}
                  onValueChange={(val) => handleDailyReminderToggle(val)}
                  trackColor={{ true: colors.success }}
                />
              }
            />
            <Row
              icon={
                <LucideRefreshCcw
                  color={alertsBlocked ? colors.secondary : colors.primary}
                  size={20}
                />
              }
              label="Bill Reminders"
              sub={
                alertsBlocked
                  ? "⚠ Enable permissions above to activate"
                  : undefined
              }
              right={
                <Switch
                  value={preferences.recurringAlerts}
                  onValueChange={(val) => handleRecurringAlertsToggle(val)}
                  trackColor={{ true: colors.success }}
                />
              }
            />
            <Row
              icon={
                <LucideDownload
                  color={alertsBlocked ? colors.secondary : colors.primary}
                  size={20}
                />
              }
              label="Weekly Digest"
              sub={
                alertsBlocked
                  ? "⚠ Enable permissions above to activate"
                  : undefined
              }
              right={
                <Switch
                  value={preferences.weeklyDigest}
                  onValueChange={(val) => handleWeeklyDigestToggle(val)}
                  trackColor={{ true: colors.success }}
                />
              }
            />
          </View>

          {/* ── Privacy & Security ── */}
          <Section title="Privacy & Security" />
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >

            <Row
              icon={<LucideShield color={colors.primary} size={20} />}
              label="Biometric Lock"
              sub="Authenticate on app launch"
              right={
                <Switch
                  value={preferences.biometricLock}
                  onValueChange={handleBiometricToggle}
                  trackColor={{ true: colors.success }}
                />
              }
            />
            {preferences.biometricLock && (
              <View
                className="p-4 border-t"
                style={{ borderTopColor: colors.border }}
              >
                <ThemedText
                  type="secondary"
                  className="text-[10px] uppercase font-bold mb-2"
                >
                  Auto-lock After (minutes, 1–60)
                </ThemedText>
                <View className="flex-row gap-2">
                  <TextInput
                    className="bg-border flex-1 p-2 rounded-apple-sm font-bold"
                    style={{ color: colors.primary }}
                    value={autoLockInput}
                    onChangeText={setAutoLockInput}
                    onBlur={handleSaveAutoLock}
                    keyboardType="numeric"
                  />
                  <TouchableOpacity
                    onPress={handleSaveAutoLock}
                    className="px-4 justify-center rounded-apple-sm"
                    style={{ backgroundColor: colors.accent }}
                  >
                    <ThemedText
                      className="font-bold text-xs"
                      style={{ color: colors.onAccent }}
                    >
                      SET
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            <Row
              icon={<LucideDownload color={colors.primary} size={20} />}
              label="Export to CSV"
              sub="Download all transactions as a spreadsheet"
              onPress={() => SyncService.exportToCSV()}
            />
            {!googleUser && (
              <Row
                icon={<LucideLogOut color={colors.danger} size={18} />}
                label="Reset App & Wipe Data"
                sub="Permanently delete all local data"
                onPress={handleLogout}
                danger
              />
            )}
          </View>

          {/* ── Interaction & Experience ── */}
          <Section title="Experience" />
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Row
              icon={<LucideZap color={colors.primary} size={18} />}
              label="Haptic Feedback"
              sub="Vibrate on actions"
              right={
                <Switch
                  value={preferences.hapticsEnabled}
                  onValueChange={toggleHaptics}
                  trackColor={{ true: colors.success }}
                />
              }
            />
          </View>

          {/* ── Automation ── */}
          <Section title="Automation & AI" />
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Row
              icon={<LucideBrain color={colors.primary} size={20} />}
              label="Auto-approve Small Spends"
              sub={`Threshold: ${preferences.currency}${preferences.autoApproveThreshold}`}
              right={
                <Switch
                  value={preferences.autoApproveSmallSpends}
                  onValueChange={toggleAutoApprove}
                  trackColor={{ true: colors.success }}
                />
              }
            />
            <Row
              icon={<LucideZap color={colors.primary} size={20} />}
              label="Auto-detect via SMS"
              sub="Detect bank SMS and notify you instantly"
              right={
                <Switch
                  value={preferences.autoSmsScan}
                  onValueChange={(val) => handleAutoSmsScanToggle(val)}
                  trackColor={{ true: colors.success }}
                />
              }
            />
            {preferences.autoSmsScan && Platform.OS === "android" && (
              <Row
                icon={<LucideAlertTriangle color={colors.warning} size={18} />}
                label="Troubleshoot Background Runs"
                sub="Guide to keep background scans alive on your device"
                onPress={() => {
                  Linking.openURL("https://dontkillmyapp.com").catch(() => {
                    notify.error("Could not open troubleshooting URL");
                  });
                }}
                right={
                  <LucideChevronRight color={colors.secondary} size={14} />
                }
              />
            )}
            {preferences.autoApproveSmallSpends && (
              <View
                className="p-4 border-t"
                style={{ borderTopColor: colors.border }}
              >
                <ThemedText
                  type="secondary"
                  className="text-[10px] uppercase font-bold mb-2"
                >
                  Threshold Amount ({preferences.currency})
                </ThemedText>
                <View className="flex-row gap-2">
                  <TextInput
                    className="bg-border flex-1 p-2 rounded-apple-sm font-bold"
                    style={{ color: colors.primary }}
                    value={thresholdInput}
                    onChangeText={setThresholdInput}
                    onBlur={handleSaveThreshold}
                    keyboardType="numeric"
                  />
                  <TouchableOpacity
                    onPress={handleSaveThreshold}
                    className="px-4 justify-center rounded-apple-sm"
                    style={{ backgroundColor: colors.accent }}
                  >
                    <ThemedText
                      className="font-bold text-xs"
                      style={{ color: colors.onAccent }}
                    >
                      SET
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          {/* ── Echo AI (on-device engine) ── */}
          <ThemedText
            type="secondary"
            className="text-[10px] uppercase font-bold mb-2 ml-1"
            style={{ marginTop: 18 }}
          >
            Echo AI Engine
          </ThemedText>
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {!AIModelManager.isDeviceCompatible() ? (
              /* Low RAM Compatibility Warning */
              <>
                <Row
                  icon={<LucideAlertTriangle color={colors.danger} size={20} />}
                  label="Echo AI Incompatible"
                  sub="Your device has less than 2GB of total RAM. On-device Echo AI is disabled to prevent crashes."
                />
                <View
                  style={{
                    padding: 12,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <ThemedText type="secondary" className="text-xs">
                    Echo Spend will fall back to high-performance local regex
                    parsing. No action is required.
                  </ThemedText>
                </View>
              </>
            ) : aiModelStatus === "not_downloaded" ? (
              /* Model not downloaded — show download prompt */
              <>
                <Row
                  icon={
                    <LucideAlertTriangle color={colors.warning} size={20} />
                  }
                  label="Echo AI Not Installed"
                  sub="Smart SMS parsing is using basic mode"
                />
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                    navigation.navigate("AIModelSetup");
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    paddingVertical: 12,
                    margin: 12,
                    borderRadius: 12,
                    backgroundColor: colors.accent,
                  }}
                >
                  {loadingExpectedSize ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <LucideDownload color="#fff" size={16} />
                  )}
                  <ThemedText
                    style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}
                  >
                    Download Echo AI{" "}
                    {loadingExpectedSize ? "..." : `(${expectedModelSize})`}
                  </ThemedText>
                </TouchableOpacity>
              </>
            ) : aiModelStatus === "downloading" ? (
              /* Downloading */
              <>
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate("AIModelSetup");
                  }}
                >
                  <Row
                    icon={<LucideDownload color={colors.accent} size={20} />}
                    label="Downloading Echo AI..."
                    sub={`${aiModelProgress}% complete • Tap to view progress`}
                  />
                </TouchableOpacity>
              </>
            ) : aiModelStatus === "error" ? (
              /* Error */
              <>
                <TouchableOpacity
                  onPress={() => {
                    triggerHaptic();
                    navigation.navigate("AIModelSetup");
                  }}
                >
                  <Row
                    icon={
                      <LucideAlertTriangle color={colors.danger} size={20} />
                    }
                    label="Echo AI Download Failed"
                    sub="Tap to retry or cancel setup"
                  />
                </TouchableOpacity>
              </>
            ) : (
              /* Model is downloaded/ready */
              <>
                <Row
                  icon={<LucideCpu color={colors.success} size={20} />}
                  label="Echo AI"
                  sub={`Local Engine • ${aiModelSize || expectedModelSize} • ${aiModelStatus === "ready" ? "Active" : "Ready"}`}
                  right={
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: `${colors.success}20`,
                      }}
                    >
                      <ThemedText
                        style={{
                          fontSize: 10,
                          fontWeight: "700",
                          color: colors.success,
                        }}
                      >
                        {aiModelStatus === "ready" ? "ACTIVE" : "READY"}
                      </ThemedText>
                    </View>
                  }
                />
                <Row
                  icon={<LucideTrash2 color={colors.danger} size={18} />}
                  label="Delete Echo AI"
                  sub={`Free up ${aiModelSize || expectedModelSize} of storage`}
                  onPress={() => {
                    Alert.alert(
                      "Delete Echo AI?",
                      `Without the Echo AI, SMS analysis will use basic pattern matching which is less accurate for unusual transactions.\n\nYou'll need to re-download ${expectedModelSize} later to restore Echo AI features.`,
                      [
                        { text: "Keep Echo AI", style: "cancel" },
                        {
                          text: "Delete Echo AI",
                          style: "destructive",
                          onPress: async () => {
                            await AIModelManager.deleteModel();
                            setAiModelSize("");
                            notify.info(
                              "Echo AI deleted",
                              "Using basic SMS parsing mode",
                            );
                            triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
                          },
                        },
                      ],
                    );
                  }}
                />
              </>
            )}
          </View>

          {/* ── Help & Support ── */}
          <Section title="Help & Support" />
          <View
            className="rounded-apple-md overflow-hidden"
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Row
              icon={<LucideSparkles color={colors.accent} size={18} />}
              label="Echo Spend Tour Guide"
              sub="Explore all features and power-user tips"
              onPress={() => {
                triggerHaptic();
                setShowTour(true);
              }}
            />
            <Row
              icon={<LucideLightbulb color={colors.primary} size={18} />}
              label="Tips & Tricks"
              sub="Unlock and configure the app's full potential"
              onPress={() => {
                triggerHaptic();
                navigation.navigate("Tips");
              }}
            />
          </View>

          {/* ── Developer Testing ── (Hidden in Release) */}
          {__DEV__ && (
            <>
              <Section title="Developer Testing" />
              <View
                className="rounded-apple-md overflow-hidden mb-24"
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Row
                  icon={<LucideZap color={colors.accent} size={20} />}
                  label="Test Transaction Notification"
                  sub="Single transaction deep-link to SmartInbox"
                  onPress={() =>
                    NotificationService.notifyNewTransaction(
                      1250,
                      "Starbucks",
                      "Food",
                    )
                  }
                />
                <Row
                  icon={<LucideZap color={colors.accent} size={20} />}
                  label="Test Batch Notification"
                  sub="Multiple transactions deep-link to SmartInbox"
                  onPress={() =>
                    NotificationService.notifyBatchTransactions(
                      3,
                      4500,
                      "Zomato",
                    )
                  }
                />
                <Row
                  icon={<LucideBell color={colors.warning} size={20} />}
                  label="Test Budget Alert"
                  sub="80% utilization deep-link to Home"
                  onPress={() =>
                    NotificationService.notifyBudgetAlert(
                      42000,
                      50000,
                      preferences.currency,
                    )
                  }
                />
                <Row
                  icon={<LucideLayout color={colors.primary} size={20} />}
                  label="Test Weekly Digest"
                  sub="Summary deep-link to Analytics"
                  onPress={() =>
                    NotificationService.notifyWeeklyDigest(
                      15400,
                      "Shopping",
                      preferences.currency,
                    )
                  }
                />
                <Row
                  icon={<LucideBell color={colors.accent} size={20} />}
                  label="Test Daily Reminder"
                  sub="Immediate test of 9PM check-in msg"
                  onPress={() => {
                    NotificationService.scheduleLocalNotification(
                      "Daily Expense Check-in",
                      "Don't forget to add today's expenses! Tap to open Echo Spend.",
                      "alerts",
                      { screen: "Home" },
                    );
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
