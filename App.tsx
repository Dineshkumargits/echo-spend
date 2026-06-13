import "./src/global.css";
import "react-native-reanimated";
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, AppStateStatus, View, TouchableOpacity, Text, StyleSheet, Platform, PermissionsAndroid } from 'react-native';
import { Notifier } from './src/components/Notifier';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
import { initDatabase, getLastSyncTimeFromDb } from './src/services/database';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useStore } from './src/store/useStore';
import { useBiometric } from './src/hooks/useBiometric';
import { useNotifications } from './src/hooks/useNotifications';
import { registerBackgroundTasks } from './src/services/backgroundTasks';
import SyncOverlay from './src/components/SyncOverlay';
import * as Notifications from 'expo-notifications';
import { createNavigationContainerRef } from '@react-navigation/native';
import { NotificationService } from "./src/services/notifications";
import { performBackgroundSmsScan } from './src/services/backgroundTasks';
import { SyncService } from './src/services/sync';
import { AIModelManager } from './src/services/aiModelManager';

export const navigationRef = createNavigationContainerRef<any>();

function AppContent() {
  const [dbInitialized, setDbInitialized] = useState(false);
  const [dbError, setDbError] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [hasCheckedInitialLock, setHasCheckedInitialLock] = useState(false);
  // Track whether notification permissions have been granted so the daily
  // reminder effect only runs after they exist (prevents scheduling before
  // permissions, which causes the notification to mis-fire on every startup).
  const [notifPermGranted, setNotifPermGranted] = useState(false);
  const { preferences, updateLastActiveAt, dbReloadKey, googleUser, hasHydrated } = useStore();
  const { authenticate, checkSupport } = useBiometric();
  const { requestPermissions } = useNotifications();
  const { isDark } = useTheme();

  // Initial Lock Check
  useEffect(() => {
    if (hasHydrated && !hasCheckedInitialLock) {
      if (preferences.biometricLock) {
        setIsLocked(true);
      }
      setHasCheckedInitialLock(true);
    }
  }, [hasHydrated, preferences.biometricLock, hasCheckedInitialLock]);

  const handleUnlock = React.useCallback(async () => {
    const ok = await checkSupport();
    if (ok) {
      const success = await authenticate('Unlock Echo Spend');
      if (success) setIsLocked(false);
    } else {
      // Hardware not available — unlock without biometric
      setIsLocked(false);
    }
  }, [checkSupport, authenticate]);

  // Auto-trigger biometric prompt when locked
  useEffect(() => {
    if (isLocked) {
      handleUnlock();
    }
  }, [isLocked, handleUnlock]);

  useEffect(() => {
    setDbInitialized(false);
    initDatabase()
      .then(() => setDbInitialized(true))
      .catch((err) => {
        console.error('[App] DB init failed:', err);
        setDbError(true);
      });
  }, [dbReloadKey]);

  // Check AI model status on startup and try to init if downloaded
  useEffect(() => {
    if (!dbInitialized) return;
    (async () => {
      // Cleanup older/orphan model GGUF files to free up disk space
      await AIModelManager.cleanupOrphanModels().catch(() => {});

      const downloaded = await AIModelManager.isModelDownloaded();
      const store = useStore.getState();
      if (downloaded) {
        store.setAiModelStatus('downloaded');
        // Pre-load the model so it's ready for SMS scans
        AIModelManager.initModel().catch(() => {});
      } else {
        store.setAiModelStatus('not_downloaded');
      }
    })();
  }, [dbInitialized]);

  // One-time startup: background tasks + permissions, in the correct order.
  // Daily reminder is scheduled HERE (after permissions) so it never fires
  // immediately due to missing permissions. The effect re-runs if the DB is
  // reloaded (dbReloadKey increments) but requestPermissions is idempotent.
  useEffect(() => {
    if (!dbInitialized) return;

    let notifSub: ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null = null;
    let receivedSub: ReturnType<typeof Notifications.addNotificationReceivedListener> | null = null;

    const setup = async () => {
      registerBackgroundTasks();

      // 1. Request SMS Permission on Android on startup
      if (Platform.OS === 'android') {
        try {
          const hasSmsPerm = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
          if (!hasSmsPerm) {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
              title: 'SMS Permission',
              message: 'Echo Spend needs permission to read financial SMS messages to automatically scan transactions.',
              buttonPositive: 'Grant',
              buttonNegative: 'Cancel',
            });
          }
        } catch (e) {
          console.warn('[App] Failed to request SMS permission on startup:', e);
        }
      }

      // 2. Permissions must be granted before anything notification-related runs.
      const granted = await requestPermissions();
      setNotifPermGranted(granted);



      // Schedule or cancel the daily reminder now that we know permission state.
      if (granted) {
        if (preferences.dailyReminder) {
          await NotificationService.scheduleDailyReminder();
        } else {
          await NotificationService.cancelDailyReminder();
        }

        // Schedule exact background sync if enabled
        if (googleUser && preferences.syncSchedule !== 'none') {
          await NotificationService.scheduleSyncTask(preferences.syncTime);
        } else {
          await NotificationService.cancelSyncTask();
        }
      }

      // Listener for notifications received while the app is active/backgrounded
      receivedSub = Notifications.addNotificationReceivedListener(notification => {
        const data = notification.request.content.data;

        // Handle Background Sync
        if (data?.triggerSync) {
          getLastSyncTimeFromDb().then(lastSyncIso => {
            let shouldSync = true;
            if (lastSyncIso) {
              const lastSyncTime = new Date(lastSyncIso).getTime();
              const oneHourAgo = Date.now() - 60 * 60 * 1000;
              if (lastSyncTime >= oneHourAgo) {
                shouldSync = false;
              }
            }
            if (shouldSync) {
              SyncService.syncToGoogleDrive().catch(() => {});
            }
          });
        }
        if (data?.rescheduleSync && data?.syncTime && googleUser && preferences.syncSchedule !== 'none') {
          NotificationService.scheduleSyncTask(data.syncTime as string);
        }
      });

      // Deep-link handler: tap a notification → navigate to the right screen.
      notifSub = Notifications.addNotificationResponseReceivedListener(response => {
        const screen = response.notification.request.content.data?.screen as string | undefined;
        if (!screen || !navigationRef.isReady()) return;
        const navigableScreens = ['SmartInbox', 'Budget', 'Analytics', 'Home', 'Txns', 'Finances', 'Settings'];
        if (navigableScreens.includes(screen)) {
          navigationRef.navigate(screen as never);
        }
      });
    };

    setup();
    return () => { notifSub?.remove(); receivedSub?.remove(); };
  // preferences.dailyReminder intentionally excluded: handled by the effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbInitialized]);

  // React to the user toggling preferences AFTER startup.
  // Only runs once permissions have been confirmed; never fires at launch.
  useEffect(() => {
    if (!notifPermGranted) return;
    
    if (preferences.dailyReminder) {
      NotificationService.scheduleDailyReminder();
    } else {
      NotificationService.cancelDailyReminder();
    }

    if (googleUser && preferences.syncSchedule !== 'none') {
      NotificationService.scheduleSyncTask(preferences.syncTime);
    } else {
      NotificationService.cancelSyncTask();
    }
  }, [preferences.dailyReminder, preferences.syncTime, preferences.syncSchedule, googleUser, notifPermGranted]);

  // Near-instant SMS polling while active/recent-background (Android only)
  useEffect(() => {
    if (dbInitialized && Platform.OS === 'android' && preferences.autoSmsScan) {
      // Catch up immediately on launch
      const runScanIfAllowed = async () => {
        try {
          const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
          if (hasPermission) {
            await performBackgroundSmsScan(true); // Silent on launch — user is about to see the dashboard
          }
        } catch (e) {
          // Silent fail for background scan
        }
      };
      runScanIfAllowed();

      // Setup a periodic poller to catch new SMS while app is in background/foreground
      // Most Android OS will keep this timer alive for several minutes after backgrounding.
      const poller = setInterval(() => {
        performBackgroundSmsScan();
      }, 60000); // 60 seconds

      // Also scan immediately when the app returns to foreground from background,
      // so that any SMS received while backgrounded is picked up without waiting
      // for the next 60-second tick.
      const handleForegroundReturn = (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          runScanIfAllowed();
        }
      };
      const sub = AppState.addEventListener('change', handleForegroundReturn);

      return () => {
        clearInterval(poller);
        sub.remove();
      };
    }
  }, [dbInitialized, preferences.autoSmsScan]);

  // Biometric auto-lock on app background
  useEffect(() => {
    if (!preferences.biometricLock) return;

    let backgroundTimestamp: number | null = null;

    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundTimestamp = Date.now();
        updateLastActiveAt();
      } else if (nextState === 'active' && backgroundTimestamp !== null) {
        const secondsInBackground = (Date.now() - backgroundTimestamp) / 1000;
        const lockAfterSeconds = preferences.autoLockMinutes * 60;
        if (secondsInBackground >= lockAfterSeconds) {
          setIsLocked(true);
          // Lock screen UI will prompt the user to unlock via handleUnlock
        }
        backgroundTimestamp = null;
      }
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [
    preferences.biometricLock,
    preferences.autoLockMinutes,
    authenticate,
    checkSupport,
    updateLastActiveAt,
  ]);

  if (dbError) {
    return (
      <View style={lockStyles.container}>
        <Text style={lockStyles.icon}>⚠️</Text>
        <Text style={lockStyles.title}>Database Error</Text>
        <Text style={lockStyles.subtitle}>
          Echo Spend could not open its database.{'\n'}Try freeing up device storage and restarting the app.
        </Text>
      </View>
    );
  }

  if (!dbInitialized || !hasHydrated) return null;

  if (isLocked) {
    return (
      <View style={lockStyles.container}>
        <Text style={lockStyles.icon}>🔒</Text>
        <Text style={lockStyles.title}>Echo Spend is Locked</Text>
        <Text style={lockStyles.subtitle}>Authenticate to continue</Text>
        <TouchableOpacity style={lockStyles.button} onPress={handleUnlock}>
          <Text style={lockStyles.buttonText}>Unlock with Biometric</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <AppNavigator />
      <SyncOverlay />
      <StatusBar style={isDark ? "light" : "dark"} />
    </>
  );
}

const lockStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { fontSize: 64, marginBottom: 24 },
  title: { color: '#FFF', fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  subtitle: { color: '#8E8E93', fontSize: 15, textAlign: 'center', marginTop: 8, marginBottom: 40 },
  button: { backgroundColor: '#0A84FF', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 14 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeProvider>
            <AppContent />
            <Notifier />
          </ThemeProvider>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
