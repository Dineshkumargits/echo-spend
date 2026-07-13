import {
  ThemedSafeAreaView,
  ThemedText,
} from "../components/ThemedSafeAreaView";
import React, { useEffect, useState } from "react";
import {
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  NativeModules,
} from "react-native";
import {
  LucideChevronLeft,
  LucideChevronRight,
  LucideCloudSync,
  LucideDownload,
  LucideRefreshCcw,
  LucideTimer,
  LucideUserCircle,
  LucideLogOut,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";
import DateTimePicker from "@react-native-community/datetimepicker";
import { notify } from "../utils/notify";
import { useStore } from "../store/useStore";
import { SyncService } from "../services/sync";
import {
  resetAllData,
  getLastSyncAttempt,
  SyncAttemptLog,
} from "../services/database";
import { useTheme } from "../theme/ThemeProvider";
import { registerBackgroundTasks } from "../services/backgroundTasks";
import { SectionLabel } from "../components/Signal";
import { fonts } from "../theme/tokens";

const extra = Constants.expoConfig?.extra ?? {};

GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId,
  offlineAccess: true,
  scopes: ["https://www.googleapis.com/auth/drive.appdata"],
});

const AccountBackupScreen = ({ navigation }: any) => {
  const {
    preferences,
    lastSynced,
    googleUser,
    isSyncing,
    setSyncSchedule,
    setSyncTime,
    setGoogleUser,
    fullLogout,
  } = useStore();

  const { colors, isDark } = useTheme();
  const { BackgroundOptimizationModule } = NativeModules;

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [, setLastSyncAttempt] = useState<SyncAttemptLog | null>(null);

  const loadLastSyncAttempt = async () => {
    try {
      setLastSyncAttempt(await getLastSyncAttempt());
    } catch (e) {
      console.warn("[AccountBackup] Failed to load last sync attempt:", e);
    }
  };

  useEffect(() => {
    loadLastSyncAttempt();
  }, []);

  const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
    if (preferences.hapticsEnabled) {
      Haptics.impactAsync(style);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();

      if (result.type === "success") {
        const { user } = result.data;
        const tokens = await GoogleSignin.getTokens();

        setGoogleUser({
          name: user.name || "Google User",
          email: user.email,
          photo: user.photo ?? undefined,
          accessToken: tokens.accessToken,
          refreshToken: "native_sdk_managed",
          expiresAt: Date.now() + 3600 * 1000,
        });

        notify.success("Cloud Account Linked!");
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
      }
    } catch (error: any) {
      if (error.code !== statusCodes.SIGN_IN_CANCELLED) {
        console.error("[Auth] Native Error:", error);
        notify.error("Native Auth Failed", error.message);
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
      notify.success("Synced to Google Drive");
    } else {
      notify.error("Sync failed. Check your connection.");
    }
  };

  const handleRestoreFromDrive = () => {
    if (!googleUser) {
      notify.info("Please link your Google account first");
      return;
    }

    Alert.alert(
      "Restore from Google Drive",
      "This will replace ALL local data with the Drive backup. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore Now",
          style: "destructive",
          onPress: async () => {
            const ok = await SyncService.restoreFromGoogleDrive();
            if (ok) {
              notify.success("Data Restored Successfully");
              triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
            } else {
              notify.error("Restore failed");
            }
          },
        },
      ],
    );
  };

  const handleSyncScheduleChange = async (
    schedule: "none" | "daily" | "weekly",
  ) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    if (schedule === "none") {
      setSyncSchedule("none");
      setTimeout(() => registerBackgroundTasks(), 0);
      return;
    }

    if (Platform.OS === "android" && BackgroundOptimizationModule) {
      try {
        const alarmAllowed =
          await BackgroundOptimizationModule.isExactAlarmAllowed();
        if (!alarmAllowed) {
          Alert.alert(
            "Precision Alarm Recommendation",
            "To run automatic backups precisely at your scheduled time, Echo Spend recommends the 'Alarms & Reminders' permission. Without it, backups will still run but may be slightly delayed to optimize battery life.",
            [
              {
                text: "Continue Anyway",
                onPress: () => {
                  setSyncSchedule(schedule);
                  setTimeout(() => registerBackgroundTasks(), 0);
                },
              },
              {
                text: "Open Settings",
                onPress: async () => {
                  setSyncSchedule(schedule);
                  setTimeout(() => registerBackgroundTasks(), 0);
                  await BackgroundOptimizationModule.openExactAlarmSettings();
                },
              },
            ],
          );
          return;
        }
      } catch (e) {
        console.warn("[AccountBackup] Failed to check exact alarm permission:", e);
      }
    }

    setSyncSchedule(schedule);
    setTimeout(() => registerBackgroundTasks(), 0);
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
              if (googleUser) {
                await GoogleSignin.signOut();
              }
              await resetAllData();
              await fullLogout();

              notify.success(
                googleUser
                  ? "Logged out and data wiped"
                  : "App reset and data wiped",
              );
              triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
              navigation.goBack();
            } catch (error) {
              console.error("Logout failed", error);
              notify.error("Logout failed partially");
            }
          },
        },
      ],
    );
  };

  const formatDisplayTime = (timeStr: string): string => {
    return timeStr;
  };

  const getDateTimeObject = (timeStr: string): Date => {
    const date = new Date();
    try {
      const [hoursStr, minutesStr] = timeStr.split(":");
      date.setHours(parseInt(hoursStr, 10), parseInt(minutesStr, 10), 0, 0);
    } catch {}
    return date;
  };

  const handleTimePickerChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === "android") {
      setShowTimePicker(false);
    }
    if (selectedDate && event.type !== "dismissed") {
      const hours = selectedDate.getHours().toString().padStart(2, "0");
      const minutes = selectedDate.getMinutes().toString().padStart(2, "0");
      const timeStr = `${hours}:${minutes}`;
      setSyncTime(timeStr);
      notify.success("Sync time updated");
      registerBackgroundTasks();
    }
  };

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
      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        <View className="flex-row items-center mt-4 mb-2" style={{ gap: 8 }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <LucideChevronLeft color={colors.primary} size={26} />
          </TouchableOpacity>
          <View>
            <SectionLabel>Google Cloud</SectionLabel>
            <ThemedText
              style={{
                fontFamily: fonts.displayBold,
                fontSize: 26,
                letterSpacing: -0.5,
              }}
            >
              Account & Backup
            </ThemedText>
          </View>
        </View>

        {/* ── Google Cloud Sync ── */}
        <View
          className="rounded-apple-md overflow-hidden mt-4"
          style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {!googleUser ? (
            <Row
              icon={<LucideUserCircle color={colors.secondary} size={20} />}
              label="Link Google Cloud"
              sub="Secure your data with daily Drive backups"
              onPress={handleGoogleSignIn}
              right={
                <View
                  className="px-3 py-1 rounded-full"
                  style={{ backgroundColor: colors.accent }}
                >
                  <ThemedText
                    className="text-[10px] font-bold"
                    style={{ color: colors.onAccent }}
                  >
                    CONNECT
                  </ThemedText>
                </View>
              }
            />
          ) : (
            <>
              <Row
                icon={<LucideCloudSync color={colors.success} size={20} />}
                label={googleUser.name}
                sub={googleUser.email}
                right={
                  <TouchableOpacity onPress={handleLogout}>
                    <LucideLogOut color={colors.danger} size={18} />
                  </TouchableOpacity>
                }
              />
              <Row
                icon={<LucideRefreshCcw color={colors.accent} size={18} />}
                label="Manual Backup"
                sub={
                  lastSynced
                    ? `Last: ${new Date(lastSynced).toLocaleString("en-IN")}`
                    : "Never synced"
                }
                onPress={handleSyncNow}
                right={
                  isSyncing ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <ThemedText
                      className="text-xs font-bold"
                      style={{ color: colors.accent }}
                    >
                      SYNC NOW
                    </ThemedText>
                  )
                }
              />
              <Row
                icon={<LucideTimer color={colors.primary} size={18} />}
                label="Sync Schedule"
                sub={`Frequency: ${preferences.syncSchedule}`}
              />
              <View
                className="flex-row p-1"
                style={{ backgroundColor: colors.translucent }}
              >
                {(["none", "daily", "weekly"] as const).map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => handleSyncScheduleChange(s)}
                    style={[
                      {
                        flex: 1,
                        padding: 8,
                        alignItems: "center",
                        borderRadius: 8,
                      },
                      preferences.syncSchedule === s && {
                        backgroundColor: colors.surface,
                        elevation: 1,
                      },
                    ]}
                  >
                    <ThemedText
                      style={{
                        fontSize: 10,
                        fontWeight: "bold",
                        color:
                          preferences.syncSchedule === s
                            ? colors.primary
                            : colors.secondary,
                      }}
                    >
                      {s.toUpperCase()}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              {preferences.syncSchedule !== "none" && (
                <View
                  className="p-4 border-t"
                  style={{ borderTopColor: colors.border }}
                >
                  <ThemedText
                    type="secondary"
                    className="text-[10px] uppercase font-bold mb-2"
                  >
                    Sync Time (Auto)
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => {
                      setShowTimePicker(true);
                      Haptics.selectionAsync();
                    }}
                    className="bg-border flex-row justify-between items-center p-3 rounded-apple-sm"
                    activeOpacity={0.7}
                  >
                    <ThemedText
                      className="font-bold text-sm"
                      style={{ color: colors.primary }}
                    >
                      {formatDisplayTime(preferences.syncTime)}
                    </ThemedText>
                    <ThemedText
                      className="text-xs font-bold"
                      style={{ color: colors.accent }}
                    >
                      SELECT TIME
                    </ThemedText>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <View
                      style={
                        Platform.OS === "ios"
                          ? {
                              backgroundColor: colors.surface,
                              borderRadius: 14,
                              overflow: "hidden",
                              marginTop: 12,
                              borderWidth: 1,
                              borderColor: colors.border,
                            }
                          : undefined
                      }
                    >
                      <DateTimePicker
                        value={getDateTimeObject(preferences.syncTime)}
                        mode="time"
                        is24Hour={true}
                        display={Platform.OS === "ios" ? "spinner" : "default"}
                        onChange={handleTimePickerChange}
                        themeVariant={isDark ? "dark" : "light"}
                      />
                      {Platform.OS === "ios" && (
                        <TouchableOpacity
                          onPress={() => setShowTimePicker(false)}
                          style={{
                            borderTopWidth: 1,
                            borderTopColor: colors.border,
                            padding: 12,
                            alignItems: "center",
                          }}
                        >
                          <ThemedText
                            style={{
                              color: colors.accent,
                              fontWeight: "bold",
                            }}
                          >
                            Done
                          </ThemedText>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              )}
            </>
          )}
          <Row
            icon={<LucideDownload color={colors.primary} size={20} />}
            label="Restore Data"
            sub="Replace local data with Drive backup"
            onPress={handleRestoreFromDrive}
          />
        </View>
      </ScrollView>
    </ThemedSafeAreaView>
  );
};

export default AccountBackupScreen;
