import { registerRootComponent } from 'expo';
import { AppRegistry, Platform, NativeModules } from 'react-native';
import App from './App';
import { processIncomingSms } from './src/services/backgroundTasks';
import { SyncService } from './src/services/sync';
import { setLastSyncTimeInDb } from './src/services/database';
import { useStore } from './src/store/useStore';
import { NotificationService } from './src/services/notifications';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);


// Register Headless JS task for incoming SMS on Android
AppRegistry.registerHeadlessTask('SmsHeadlessTask', () => async (taskData: any) => {
  const { body, date } = taskData;
  if (body && date) {
    await processIncomingSms(body, Number(date));
  }
});

// Register Headless JS task for Cloud Sync triggered by AlarmManager on Android
AppRegistry.registerHeadlessTask('SyncHeadlessTask', () => {
  return async (taskData: any) => {
    
    // Timeout safeguard: reject after 45 seconds to prevent background service hanging forever
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Sync task timed out after 45 seconds')), 45000);
    });

    try {
      // Wait for Zustand hydration
      const checkHydration = () => {
        return new Promise<void>((resolve) => {
          if (useStore.getState().hasHydrated) {
            resolve();
            return;
          }
          const unsub = useStore.subscribe((state) => {
            if (state.hasHydrated) {
              unsub();
              resolve();
            }
          });
        });
      };

      await Promise.race([checkHydration(), timeoutPromise]);

      const { preferences, googleUser } = useStore.getState();
      if (!googleUser || preferences.syncSchedule === 'none') {
        console.log('[SyncHeadlessTask] Sync skipped: No googleUser or sync schedule set to none.');
        if (timeoutId) clearTimeout(timeoutId);
        return;
      }

      const result = await Promise.race([SyncService.syncToGoogleDrive(), timeoutPromise]) as boolean;
      if (result) {
        const nowIso = new Date().toISOString();
        await setLastSyncTimeInDb(nowIso);
        console.log('[SyncHeadlessTask] Sync completed successfully.');
      } else {
        console.log('[SyncHeadlessTask] Sync failed.');
      }

      // Always reschedule the alarm for tomorrow
      console.log('[SyncHeadlessTask] Rescheduling sync alarm for tomorrow...');
      await NotificationService.scheduleSyncTask(preferences.syncTime);
    } catch (error) {
      console.error('[SyncHeadlessTask] Error during headless sync:', error);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (Platform.OS === 'android') {
        const { BackgroundOptimizationModule } = NativeModules;
        if (BackgroundOptimizationModule) {
          await BackgroundOptimizationModule.stopHeadlessService('com.adkdinesh.echospend.SyncHeadlessTaskService').catch(() => {});
        }
      }
    }
  };
});

// Register Headless JS task for Boot recovery on Android
AppRegistry.registerHeadlessTask('BootHeadlessTask', () => async () => {
  console.log('[BootHeadlessTask] Device booted. Restoring scheduled alarms/reminders...');
  try {
    // Wait for Zustand hydration
    const checkHydration = () => {
      return new Promise<void>((resolve) => {
        if (useStore.getState().hasHydrated) {
          resolve();
          return;
        }
        const unsub = useStore.subscribe((state) => {
          if (state.hasHydrated) {
            unsub();
            resolve();
          }
        });
      });
    };
    await checkHydration();

    const { preferences, googleUser } = useStore.getState();
    
    // Reschedule Sync Task if enabled
    if (googleUser && preferences.syncSchedule !== 'none') {
      console.log('[BootHeadlessTask] Boot completed: rescheduling sync alarm for', preferences.syncTime);
      await NotificationService.scheduleSyncTask(preferences.syncTime);
    }
    
    // Reschedule Daily Reminder if enabled
    if (preferences.dailyReminder) {
      console.log('[BootHeadlessTask] Boot completed: rescheduling daily reminder');
      await NotificationService.scheduleDailyReminder();
    }
  } catch (e) {
    console.error('[BootHeadlessTask] Failed to restore alarms on boot:', e);
  } finally {
    if (Platform.OS === 'android') {
      const { BackgroundOptimizationModule } = NativeModules;
      if (BackgroundOptimizationModule) {
        await BackgroundOptimizationModule.stopHeadlessService('com.adkdinesh.echospend.BootHeadlessTaskService').catch(() => {});
      }
    }
  }
});
