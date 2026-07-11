import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import { useStore } from '../store/useStore';
import {
  getAllTransactionsForExport,
  Transaction,
  closeDatabase,
  initDatabase,
  checkpointWal,
  saveInternalPreferences,
  getInternalPreferences,
  setLastSyncTimeInDb,
  getLastSyncTimeFromDb,
} from './database';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  documentDirectory,
  getInfoAsync,
  readAsStringAsync,
  downloadAsync,
  writeAsStringAsync,
  deleteAsync,
  EncodingType
} from 'expo-file-system/legacy';

const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_LIST_URL = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)';

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 15000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
};

export class SyncService {
  /** 
   * Get a valid access token. 
   * Uses native SDK to get/refresh tokens automatically.
   */
  static async getValidAccessToken(): Promise<string | null> {
    const { googleUser, setGoogleUser } = useStore.getState();
    if (!googleUser) return null;

    try {
      // Ensure Google Signin is configured before making any SDK calls
      const extra = Constants.expoConfig?.extra ?? {};
      GoogleSignin.configure({
        webClientId: extra.googleWebClientId,
        iosClientId: extra.googleIosClientId,
        offlineAccess: true,
        scopes: ['https://www.googleapis.com/auth/drive.appdata'],
      });

      // Check if user is still signed in and get fresh tokens
      const currentUser = await GoogleSignin.getCurrentUser();
      if (!currentUser) {
        // Try silent sign-in if session exists but user object is missing
        await GoogleSignin.signInSilently();
      }
      
      const tokens = await GoogleSignin.getTokens();
      
      // Update store if token changed
      if (tokens.accessToken !== googleUser.accessToken) {
        setGoogleUser({
          ...googleUser,
          accessToken: tokens.accessToken,
          expiresAt: Date.now() + 3600 * 1000, 
        });
      }
      
      return tokens.accessToken;
    } catch (error) {
      console.error('[Sync] Failed to get valid access token:', error);
      return null;
    }
  }

  /**
   * Checks if an automated sync is due based on user preferences and 
   * the last successful sync time stored in SQLite.
   */
  static async shouldAutoSync(): Promise<boolean> {
    const { preferences, googleUser } = useStore.getState();
    if (!googleUser || preferences.syncSchedule === 'none') return false;

    try {
      const lastSyncIso = await getLastSyncTimeFromDb();
      if (!lastSyncIso) return true; // Never synced before

      const lastSyncMs = new Date(lastSyncIso).getTime();
      const elapsedMs = Date.now() - lastSyncMs;

      if (preferences.syncSchedule === 'daily') {
        // Require at least 20 hours since last sync to allow for some drift
        return elapsedMs >= 20 * 60 * 60 * 1000;
      } else if (preferences.syncSchedule === 'weekly') {
        // Require at least 6 days since last sync
        return elapsedMs >= 6 * 24 * 60 * 60 * 1000;
      }
      return false;
    } catch {
      return true; // Fallback to attempting sync on error
    }
  }

  /** Upload local SQLite DB to Google Drive appDataFolder */
  static async syncToGoogleDrive(manualToken?: string): Promise<boolean> {
    const { isSyncing, setSyncing, updateLastSynced } = useStore.getState();
    if (isSyncing) {
      console.log('[Sync] Sync already in progress, skipping concurrent run.');
      return false;
    }

    let isAborted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        isAborted = true;
        reject(new Error('Sync operation timed out after 45 seconds'));
      }, 45000);
    });

    const safeSetSyncing = (status: boolean, text = '') => {
      if (!isAborted) {
        setSyncing(status, text);
      }
    };

    const runSync = async () => {
      safeSetSyncing(true, 'Preparing backup...');
      
      const accessToken = manualToken || await SyncService.getValidAccessToken();
      if (isAborted) return false;
      if (!accessToken) throw new Error('No authentication available');

      const dbPath = `${documentDirectory}SQLite/echospend.db`;
      const fileInfo = await getInfoAsync(dbPath);
      if (isAborted) return false;
      if (!fileInfo.exists) throw new Error('Database file not found');

      safeSetSyncing(true, 'Reading local data...');
      // Backup current preferences into the DB file so they travel together
      const { preferences } = useStore.getState();
      await saveInternalPreferences(JSON.stringify(preferences));

      // Close the database to force SQLite to merge all WAL changes into the main .db file.
      // A full close is much more reliable than checkpointWal() because
      // checkpointWal() can fail silently (without throwing) if there are active read connections.
      if (isAborted) return false;
      await closeDatabase();

      let base64Content: string;
      try {
        if (isAborted) return false;
        base64Content = await readAsStringAsync(dbPath, {
          encoding: EncodingType.Base64,
        });
      } finally {
        // Always re-initialize the database connection so the app can continue working
        await initDatabase();
      }

      if (isAborted) return false;
      safeSetSyncing(true, 'Connecting to Google Drive...');
      const existingId = await SyncService.getExistingBackupId(accessToken);

      const metadata = {
        name: 'echospend_backup.db',
        mimeType: 'application/x-sqlite3',
        ...(!existingId && { parents: ['appDataFolder'] }),
      };

      const boundary = 'echo_spending_boundary';
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/x-sqlite3\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Content}\r\n` +
        `--${boundary}--`;

      const url = existingId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
        : DRIVE_UPLOAD_URL;

      if (isAborted) return false;
      safeSetSyncing(true, 'Uploading to Drive...');
      const response = await fetchWithTimeout(url, {
        method: existingId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      });

      if (isAborted) return false;
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Drive upload failed: ${JSON.stringify(err)}`);
      }

      if (isAborted) return false;
      safeSetSyncing(true, 'Finishing up...');
      updateLastSynced();
      // Also persist to SQLite so background tasks can reliably read it
      await setLastSyncTimeInDb(new Date().toISOString());
      
      // Delay slightly for UX
      await new Promise(r => setTimeout(r, 800));
      return true;
    };

    try {
      const result = await Promise.race([runSync(), timeoutPromise]);
      setSyncing(false);
      return result;
    } catch (error) {
      console.error('[Sync] Sync failed:', error);
      setSyncing(false);
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /** Get ID of existing backup file in Drive appDataFolder */
  static async getExistingBackupId(accessToken: string): Promise<string | null> {
    try {
      const res = await fetchWithTimeout(DRIVE_LIST_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const backup = (data.files || []).find((f: any) => f.name === 'echospend_backup.db');
      return backup?.id ?? null;
    } catch {
      return null;
    }
  }

  static async restoreFromGoogleDrive(manualToken?: string): Promise<boolean> {
    const { isSyncing, setSyncing } = useStore.getState();
    if (isSyncing) {
      console.log('[Sync] Restore/Sync already in progress, skipping concurrent run.');
      return false;
    }

    let isAborted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        isAborted = true;
        reject(new Error('Restore operation timed out after 45 seconds'));
      }, 45000);
    });

    const safeSetSyncing = (status: boolean, text = '') => {
      if (!isAborted) {
        setSyncing(status, text);
      }
    };

    const runRestore = async () => {
      safeSetSyncing(true, 'Locating backup on Drive...');
      
      const accessToken = manualToken || await SyncService.getValidAccessToken();
      if (isAborted) return false;
      if (!accessToken) throw new Error('No authentication available');

      const existingId = await SyncService.getExistingBackupId(accessToken);
      if (isAborted) return false;
      if (!existingId) throw new Error('No backup found in Google Drive');

      safeSetSyncing(true, 'Downloading database...');
      const downloadUrl = `https://www.googleapis.com/drive/v3/files/${existingId}?alt=media`;
      const dbPath = `${documentDirectory}SQLite/echospend.db`;
      const tempPath = `${documentDirectory}echospend_restore_tmp.db`;

      // Download to a temp path first to avoid corrupting the live DB on failure
      if (isAborted) return false;
      safeSetSyncing(true, 'Downloading backup...');
      const downloadResult = await downloadAsync(downloadUrl, tempPath, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (isAborted) return false;
      if (downloadResult.status !== 200) {
        throw new Error(`Download failed with status ${downloadResult.status}`);
      }

      // Close the live connection before swapping the file
      if (isAborted) return false;
      safeSetSyncing(true, 'Applying backup...');
      await closeDatabase();

      // Delete the existing database file and stale WAL/SHM files
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      try { await deleteAsync(dbPath, { idempotent: true }); } catch (_) {}
      try { await deleteAsync(walPath, { idempotent: true }); } catch (_) {}
      try { await deleteAsync(shmPath, { idempotent: true }); } catch (_) {}

      // Move temp file over the live DB
      if (isAborted) return false;
      const { moveAsync } = await import('expo-file-system/legacy');
      await moveAsync({ from: tempPath, to: dbPath });

      // Reinitialize so the app picks up restored data immediately
      if (isAborted) return false;
      safeSetSyncing(true, 'Reinitializing database...');
      await initDatabase();

      // Restore preferences from the internal DB table
      try {
        console.log('[Sync] Restored database initialization complete. Reading saved preferences...');
        const savedPrefs = await getInternalPreferences();
        console.log('[Sync] Retrieved saved preferences from DB:', savedPrefs);
        if (savedPrefs) {
          const parsed = JSON.parse(savedPrefs);
          useStore.getState().importPreferences(parsed);
          console.log('[Sync] Imported preferences successfully. Restored budget:', parsed.monthlyBudget, 'Restored salaryDay:', parsed.salaryDay);
        } else {
          console.warn('[Sync] No user_preferences row found in app_settings table of restored DB.');
        }
      } catch (e) {
        console.warn('[Sync] Failed to restore preferences from DB:', e);
      }

      // Signal App.tsx to remount all screens so they reload from the restored DB.
      // Without this, every screen still shows its stale in-memory state.
      useStore.getState().incrementDbReloadKey();

      // Clean up the temporary download file to free up space
      try { await deleteAsync(tempPath, { idempotent: true }); } catch (_) {}

      await new Promise(r => setTimeout(r, 500));
      return true;
    };

    try {
      const result = await Promise.race([runRestore(), timeoutPromise]);
      setSyncing(false);
      return result;
    } catch (error) {
      console.error('[Sync] Drive restore failed:', error);
      setSyncing(false);
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /** Export all confirmed transactions as CSV and open share sheet */
  static async exportToCSV(): Promise<string | null> {
    try {
      const transactions = await getAllTransactionsForExport();
      const rows = [
        'Date,Merchant,Amount,Type,Category,Notes',
        ...transactions.map((t: Transaction) => [
          new Date(t.date).toLocaleDateString('en-IN'),
          `"${(t.merchant || '').replace(/"/g, '""')}"`,
          t.amount.toFixed(2),
          t.type,
          `"${(t.category || '').replace(/"/g, '""')}"`,
          `"${(t.notes || '').replace(/"/g, '""')}"`,
        ].join(',')),
      ].join('\n');

      const fileName = `echo_spending_${new Date().toISOString().slice(0, 10)}.csv`;
      const fileUri = `${documentDirectory}${fileName}`;
      await writeAsStringAsync(fileUri, rows, {
        encoding: EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export Transactions',
          UTI: 'public.comma-separated-values-text',
        });
      }

      return fileUri;
    } catch (error) {
      console.error('[Export] CSV export failed:', error);
      return null;
    }
  }
}
