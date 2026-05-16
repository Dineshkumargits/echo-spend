import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

interface UserPreferences {
  theme: 'dark' | 'light' | 'system';
  autoApproveSmallSpends: boolean;
  autoApproveThreshold: number;
  monthlyBudget: number;
  biometricLock: boolean;
  autoLockMinutes: number;
  budgetAlerts: boolean;
  recurringAlerts: boolean;
  weeklyDigest: boolean;
  currency: string;
  syncSchedule: 'daily' | 'weekly' | 'none';
  syncTime: string;
  hideAmounts: boolean;               // NEW: Privacy Mode
  hapticsEnabled: boolean;            // NEW: Interaction
  defaultLaunchScreen: 'Dashboard' | 'SmartInbox'; // NEW: Navigation
  salaryDay: number;                  // NEW: Financial Cycle (1-28)
  autoSmsScan: boolean;               // NEW: Background Automation
  dailyReminder: boolean;             // NEW: Daily 9PM Reminder
  lastWeeklyDigestDate: string | null;
  budgetNotificationHistory: Record<number, number>; // itemId -> percentage
  lastBudgetCycleReset: string | null; // ISO date of billing-cycle start when history was last cleared
}

interface AppState {
  preferences: UserPreferences;
  lastSynced: string | null;
  isOnboarded: boolean;
  lastActiveAt: string | null;
  isSyncing: boolean;
  syncProgressText: string;
  dbReloadKey: number;
  googleUser: {
    name: string;
    email: string;
    photo?: string;
    refreshToken: string;
    accessToken: string;
    expiresAt: number; // timestamp
  } | null;

  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  toggleAutoApprove: () => void;
  setAutoApproveThreshold: (amount: number) => void;
  setMonthlyBudget: (budget: number) => void;
  toggleBiometricLock: () => void;
  setAutoLockMinutes: (minutes: number) => void;
  toggleBudgetAlerts: () => void;
  toggleRecurringAlerts: () => void;
  toggleWeeklyDigest: () => void;
  setCurrency: (currency: string) => void;
  setSyncSchedule: (schedule: 'daily' | 'weekly' | 'none') => void;
  setSyncTime: (time: string) => void;
  toggleHideAmounts: () => void;      // NEW
  toggleHaptics: () => void;          // NEW
  setLaunchScreen: (screen: 'Dashboard' | 'SmartInbox') => void; // NEW
  setSalaryDay: (day: number) => void; // NEW
  toggleAutoSmsScan: () => void;      // NEW
  toggleDailyReminder: () => void;    // NEW
  setLastWeeklyDigestDate: (date: string) => void;
  updateBudgetNotificationHistory: (itemId: number, percentage: number) => void;
  resetBudgetNotificationHistory: (cycleStartDate: string) => void;
  importPreferences: (prefs: Partial<UserPreferences>) => void;
  setSyncing: (isSyncing: boolean, text?: string) => void;
  setGoogleUser: (user: AppState['googleUser']) => void;
  updateLastSynced: () => void;
  incrementDbReloadKey: () => void;
  updateLastActiveAt: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

const secureStorage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  autoApproveSmallSpends: false,
  autoApproveThreshold: 100,
  monthlyBudget: 50000,
  biometricLock: false,
  autoLockMinutes: 5,
  budgetAlerts: true,
  recurringAlerts: true,
  weeklyDigest: true,
  currency: '₹',
  syncSchedule: 'daily',
  syncTime: '03:00',
  hideAmounts: false,
  hapticsEnabled: true,
  defaultLaunchScreen: 'Dashboard',
  salaryDay: 1,
  autoSmsScan: false,
  dailyReminder: true,
  lastWeeklyDigestDate: null,
  budgetNotificationHistory: {},
  lastBudgetCycleReset: null,
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      preferences: DEFAULT_PREFERENCES,
      lastSynced: null,
      isOnboarded: false,
      lastActiveAt: null,
      isSyncing: false,
      syncProgressText: '',
      dbReloadKey: 0,
      googleUser: null,

      setTheme: (theme) =>
        set((s) => ({ preferences: { ...s.preferences, theme } })),

      toggleAutoApprove: () =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            autoApproveSmallSpends: !s.preferences.autoApproveSmallSpends,
          },
        })),

      setAutoApproveThreshold: (amount) =>
        set((s) => ({ preferences: { ...s.preferences, autoApproveThreshold: amount } })),

      setMonthlyBudget: (budget) =>
        set((s) => ({ preferences: { ...s.preferences, monthlyBudget: budget } })),

      toggleBiometricLock: () =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            biometricLock: !s.preferences.biometricLock,
          },
        })),

      setAutoLockMinutes: (minutes) =>
        set((s) => ({ preferences: { ...s.preferences, autoLockMinutes: minutes } })),

      toggleBudgetAlerts: () =>
        set((s) => ({
          preferences: { ...s.preferences, budgetAlerts: !s.preferences.budgetAlerts },
        })),

      toggleRecurringAlerts: () =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            recurringAlerts: !s.preferences.recurringAlerts,
          },
        })),

      toggleWeeklyDigest: () =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            weeklyDigest: !s.preferences.weeklyDigest,
          },
        })),

      setCurrency: (currency) =>
        set((s) => ({ preferences: { ...s.preferences, currency } })),

      setSyncSchedule: (syncSchedule) =>
        set((s) => ({ preferences: { ...s.preferences, syncSchedule } })),

      setSyncTime: (syncTime) =>
        set((s) => ({ preferences: { ...s.preferences, syncTime } })),

      toggleHideAmounts: () =>
        set((s) => ({
          preferences: { ...s.preferences, hideAmounts: !s.preferences.hideAmounts }
        })),

      toggleHaptics: () =>
        set((s) => ({
          preferences: { ...s.preferences, hapticsEnabled: !s.preferences.hapticsEnabled }
        })),

      setLaunchScreen: (screen) =>
        set((s) => ({
          preferences: { ...s.preferences, defaultLaunchScreen: screen }
        })),

      setSalaryDay: (day) =>
        set((s) => ({
          preferences: { ...s.preferences, salaryDay: day }
        })),

      toggleAutoSmsScan: () =>
        set((s) => ({
          preferences: { ...s.preferences, autoSmsScan: !s.preferences.autoSmsScan }
        })),
      
      toggleDailyReminder: () =>
        set((s) => ({
          preferences: { ...s.preferences, dailyReminder: !s.preferences.dailyReminder }
        })),

      setLastWeeklyDigestDate: (date) =>
        set((s) => ({
          preferences: { ...s.preferences, lastWeeklyDigestDate: date }
        })),

      updateBudgetNotificationHistory: (itemId, percentage) =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            budgetNotificationHistory: {
              ...s.preferences.budgetNotificationHistory,
              [itemId]: percentage
            }
          }
        })),

      resetBudgetNotificationHistory: (cycleStartDate) =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            budgetNotificationHistory: {},
            lastBudgetCycleReset: cycleStartDate,
          }
        })),

      importPreferences: (prefs) =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            ...prefs,
          }
        })),

      setSyncing: (isSyncing, syncProgressText = '') =>
        set({ isSyncing, syncProgressText }),

      setGoogleUser: (googleUser) =>
        set({ googleUser }),

      incrementDbReloadKey: () =>
        set((s) => ({ dbReloadKey: s.dbReloadKey + 1 })),

      updateLastSynced: () =>
        set({ lastSynced: new Date().toISOString() }),

      updateLastActiveAt: () =>
        set({ lastActiveAt: new Date().toISOString() }),

      completeOnboarding: () => set({ isOnboarded: true }),

      resetOnboarding: () =>
        set({
          isOnboarded: false,
          lastSynced: null,
          preferences: DEFAULT_PREFERENCES,
        }),
    }),
    {
      name: 'echo-spend-storage',
      storage: createJSONStorage(() => secureStorage as any),
      merge: (persistedState: any, currentState: AppState) => {
        // Deep merge preferences to ensure new fields are present
        const merged = { ...currentState, ...(persistedState as AppState) };
        merged.preferences = {
          ...DEFAULT_PREFERENCES,
          ...(merged.preferences || {}),
        };
        return merged as AppState;
      },
    }
  )
);
