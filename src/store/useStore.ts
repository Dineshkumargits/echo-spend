import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_THEME_ID } from '../theme/tokens';
import type { UpdateInfo } from '../services/updateChecker';
import type { Entitlement } from '../services/entitlements';


interface UserPreferences {
  theme: 'dark' | 'light' | 'system';  // light/dark mode (not the color pack)
  themeId: string;                      // curated theme pack id (see THEMES in tokens.ts)
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
  salaryDay: number;                  // NEW: Financial Cycle (1-31)
  /**
   * Local time of day, "HH:mm", for the FALLBACK cycle anchor only — used until
   * the first real salary date is recorded in the salary_dates table. Real
   * cycles are anchored on recorded arrivals; see services/salaryCycle.
   */
  salaryTime?: string;
  /**
   * Category name that identifies a salary credit, so cycle detection works for
   * renamed or custom categories instead of guessing the literal "Salary".
   */
  salaryCategory?: string;
  autoSmsScan: boolean;               // NEW: Background Automation
  dailyReminder: boolean;             // NEW: Daily 9PM Reminder
  lastWeeklyDigestDate: string | null;
  budgetNotificationHistory: Record<number, number>; // itemId -> percentage
  lastBudgetCycleReset: string | null; // ISO date of billing-cycle start when history was last cleared
  /**
   * User's dashboard composition: which widgets are shown and in what order.
   * Stored as a flat list so order is just array order. Never read this raw —
   * pass it through resolveDashboardLayout() (see components/dashboard/registry),
   * which reconciles it against the widget registry so widgets added in a later
   * app version appear and removed ones disappear. Existing installs persisted
   * `preferences` before this field existed, so it is legitimately undefined.
   */
  dashboardLayout?: DashboardLayoutEntry[];
}

export interface DashboardLayoutEntry {
  id: string;
  enabled: boolean;
}

type AiModelStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'loading' | 'ready' | 'error' | 'paused';

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

  // On-device AI model state
  aiModelStatus: AiModelStatus;
  aiModelProgress: number; // 0-100 download progress
  aiModelError: string | null;
  aiModelResumeData: string | null;
  aiModelNudgeDismissed: boolean;

  // Serverless update check (see services/updateChecker)
  /** Newest published build, when it is ahead of this one. null = up to date. */
  updateInfo: UpdateInfo | null;
  /** ISO timestamp of the last successful manifest fetch; throttles the check. */
  updateLastCheckedAt: string | null;
  /**
   * versionCode the user dismissed the banner for. Keyed by version rather than
   * a boolean so dismissing 1.2.8 does not also silence 1.2.9.
   */
  updateDismissedVersionCode: number | null;

  /**
   * Last entitlement Google Play confirmed (see services/entitlements).
   *
   * Persisted so the app knows what the user owns before — and without — a
   * network round trip. null means "never checked", which reads as free once
   * enforcement is on.
   */
  proEntitlement: Entitlement | null;
  /**
   * ISO timestamp of the last successful Play round trip. This is what bounds
   * the offline grace window, so it is only ever stamped on a real answer from
   * Play, never on a failed check.
   */
  entitlementVerifiedAt: string | null;

  setTheme: (theme: 'dark' | 'light' | 'system') => void;
  setThemeId: (themeId: string) => void;
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
  setSalaryTime: (time: string) => void;
  setSalaryCategory: (category: string) => void;
  toggleAutoSmsScan: () => void;      // NEW
  toggleDailyReminder: () => void;    // NEW
  setLastWeeklyDigestDate: (date: string) => void;
  updateBudgetNotificationHistory: (itemId: number, percentage: number) => void;
  resetBudgetNotificationHistory: (cycleStartDate: string) => void;
  importPreferences: (prefs: Partial<UserPreferences>) => void;
  setDashboardLayout: (layout: DashboardLayoutEntry[]) => void;
  toggleDashboardWidget: (id: string) => void;
  resetDashboardLayout: () => void;
  setSyncing: (isSyncing: boolean, text?: string) => void;
  setGoogleUser: (user: AppState['googleUser']) => void;
  updateLastSynced: () => void;
  incrementDbReloadKey: () => void;
  updateLastActiveAt: () => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  fullLogout: () => Promise<void>;

  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;

  // AI model actions
  setAiModelStatus: (status: AiModelStatus) => void;
  setAiModelProgress: (progress: number) => void;
  setAiModelError: (error: string | null) => void;
  setAiModelResumeData: (data: string | null) => void;
  setAiModelNudgeDismissed: (dismissed: boolean) => void;

  // Update-check actions
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateLastCheckedAt: (iso: string) => void;
  /** null clears the dismissal, so a manual check can resurface the banner. */
  dismissUpdate: (versionCode: number | null) => void;

  /** Written only by services/entitlements after Play answers. */
  setProEntitlement: (entitlement: Entitlement | null, verifiedAt: string | null) => void;
}

const secureStorage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  themeId: DEFAULT_THEME_ID,
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
  salaryTime: '00:00',
  salaryCategory: 'Salary',
  autoSmsScan: false,
  dailyReminder: true,
  lastWeeklyDigestDate: null,
  budgetNotificationHistory: {},
  lastBudgetCycleReset: null,
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      preferences: DEFAULT_PREFERENCES,
      lastSynced: null,
      isOnboarded: false,
      lastActiveAt: null,
      isSyncing: false,
      syncProgressText: '',
      dbReloadKey: 0,
      aiModelStatus: 'not_downloaded' as AiModelStatus,
      aiModelProgress: 0,
      aiModelError: null,
      aiModelResumeData: null,
      aiModelNudgeDismissed: false,
      updateInfo: null,
      updateLastCheckedAt: null,
      updateDismissedVersionCode: null,
      proEntitlement: null,
      entitlementVerifiedAt: null,
      googleUser: null,
      hasHydrated: false,

      setTheme: (theme) =>
        set((s) => ({ preferences: { ...s.preferences, theme } })),

      setThemeId: (themeId) =>
        set((s) => ({ preferences: { ...s.preferences, themeId } })),

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

      setSalaryTime: (salaryTime) =>
        set((s) => ({ preferences: { ...s.preferences, salaryTime } })),

      setSalaryCategory: (salaryCategory) =>
        set((s) => ({ preferences: { ...s.preferences, salaryCategory } })),

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

      setDashboardLayout: (dashboardLayout) =>
        set((s) => ({ preferences: { ...s.preferences, dashboardLayout } })),

      // Toggling a widget the stored layout doesn't list yet (one added in a
      // newer app version) must still work, so fall back to appending it.
      toggleDashboardWidget: (id) =>
        set((s) => {
          // Array.isArray, not `?? []` — a restored backup can hand us a
          // malformed value, and .some() on a non-array throws.
          const stored = s.preferences.dashboardLayout;
          const current = Array.isArray(stored) ? stored : [];
          const next = current.some((w) => w.id === id)
            ? current.map((w) => (w.id === id ? { ...w, enabled: !w.enabled } : w))
            : [...current, { id, enabled: true }];
          return { preferences: { ...s.preferences, dashboardLayout: next } };
        }),

      // Clearing the field (rather than writing defaults) lets resolveDashboardLayout
      // rebuild from the registry, so "reset" always means today's defaults.
      resetDashboardLayout: () =>
        set((s) => ({ preferences: { ...s.preferences, dashboardLayout: undefined } })),

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
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      // AI model actions
      setAiModelStatus: (aiModelStatus) => set({ aiModelStatus }),
      setAiModelProgress: (aiModelProgress) => set({ aiModelProgress }),
      setAiModelError: (aiModelError) => set({ aiModelError }),
      setAiModelResumeData: (aiModelResumeData) => set({ aiModelResumeData }),
      setAiModelNudgeDismissed: (aiModelNudgeDismissed) => set({ aiModelNudgeDismissed }),

      setUpdateInfo: (updateInfo) => set({ updateInfo }),
      setUpdateLastCheckedAt: (updateLastCheckedAt) => set({ updateLastCheckedAt }),
      dismissUpdate: (updateDismissedVersionCode) => set({ updateDismissedVersionCode }),

      setProEntitlement: (proEntitlement, entitlementVerifiedAt) =>
        set({ proEntitlement, entitlementVerifiedAt }),

      resetOnboarding: () =>
        set({
          isOnboarded: false,
          lastSynced: null,
          googleUser: null,
          preferences: DEFAULT_PREFERENCES,
        }),

      fullLogout: async () => {
        // The Play entitlement belongs to the device's Google Play account,
        // not the Drive sign-in this clears — a paying user must not read as
        // free just because they logged out of backup/sync.
        const { proEntitlement, entitlementVerifiedAt } = get();

        // 1. Clear Zustand state in memory
        set({
          isOnboarded: false,
          lastSynced: null,
          googleUser: null,
          preferences: DEFAULT_PREFERENCES,
          dbReloadKey: (get() as any).dbReloadKey + 1,
        });
        // 2. Wipe the SecureStore persistence
        await SecureStore.deleteItemAsync('echo-spend-storage');
        // 3. Re-persist the entitlement immediately after the wipe. The next
        // set() call is what actually writes to SecureStore again (via the
        // persist middleware), so without this the purchase would sit
        // unpersisted until the next Play round trip re-populates it.
        set({ proEntitlement, entitlementVerifiedAt });
      },
    }),
    {
      name: 'echo-spend-storage',
      storage: createJSONStorage(() => secureStorage as any),
      partialize: (state) => {
        const {
          isSyncing,
          syncProgressText,
          hasHydrated,
          dbReloadKey,
          ...rest
        } = state;
        return rest;
      },
      merge: (persistedState: any, currentState: AppState) => {
        // Deep merge preferences to ensure new fields are present
        const merged = { ...currentState, ...(persistedState as AppState) };
        merged.preferences = {
          ...DEFAULT_PREFERENCES,
          ...(merged.preferences || {}),
        };
        return merged as AppState;
      },
      onRehydrateStorage: () => {
        return (state, error) => {
          if (!error && state) {
            state.setHasHydrated(true);

            // Clean up stale AI model status and delete partial downloads on startup
            if (state.aiModelStatus === 'downloading' || state.aiModelStatus === 'paused') {
              state.setAiModelStatus('not_downloaded');
              state.setAiModelProgress(0);
              state.setAiModelResumeData(null);
              // Asynchronously delete any partial/stale model files
              setTimeout(async () => {
                try {
                  const { AIModelManager } = require('../services/aiModelManager');
                  await AIModelManager.deleteModelFiles();
                  console.log('[useStore] Stale AI model and directory cleaned up on app start.');
                } catch (err) {
                  console.error('[useStore] Failed to clean up stale model files on startup:', err);
                }
              }, 0);
            } else if (state.aiModelStatus === 'loading' || state.aiModelStatus === 'ready') {
              // Context is freed on app close, reset to downloaded
              state.setAiModelStatus('downloaded');
            }
          }
        };
      },
    }
  )
);
