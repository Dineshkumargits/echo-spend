import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { useStore } from '../store/useStore';

/**
 * Serverless update check.
 *
 * Echo Spend has no backend, so "is there a newer build?" is answered by a
 * static JSON manifest on a CDN — the same shape of dependency as the AI model
 * URL in services/aiModelManager. The manifest is published alongside a release
 * and the app polls it at most once a day; there is nothing to run and nothing
 * to pay for.
 *
 * Failure is always silent. This app is offline-first and the check is pure
 * nice-to-have: a dead network, a 404, or a malformed manifest must never
 * surface an error to someone trying to log a coffee.
 */

const extra = Constants.expoConfig?.extra ?? {};

const MANIFEST_URL: string =
  extra.updateManifestUrl ||
  'https://raw.githubusercontent.com/Dineshkumargits/echo-spend-releases/main/version.json';

/** Minimum gap between network checks. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8000;

export interface UpdateInfo {
  /** versionCode (Android) / CFBundleVersion (iOS) of the newest published build. */
  versionCode: number;
  /** Human-facing version, e.g. "1.2.8". Display only — never compared. */
  versionName: string;
  releaseNotes: string[];
  /** Where "Update" sends the user — normally the Play listing. */
  url: string;
  /**
   * True when the installed build is below the manifest's minSupportedVersionCode.
   * The banner renders undismissibly in this case; it is the escape hatch for
   * shipping a build that corrupts data, since it can be flipped on *after* the
   * bad release is already in the wild.
   */
  mandatory: boolean;
}

interface PlatformManifest {
  latestVersionCode?: number;
  latestVersionName?: string;
  minSupportedVersionCode?: number;
  releaseNotes?: unknown;
  url?: string;
}

/**
 * The versionCode of the running build.
 *
 * Deliberately NOT Constants.expoConfig.version: this is a bare workflow, so
 * android/app/build.gradle is what actually ships, and app.config.ts has
 * already drifted away from it. Application.nativeBuildVersion reads the
 * installed binary, which is the only value that cannot lie.
 *
 * Comparison is on the integer build number, never on the semver string —
 * versionCode is monotonic, so "is 20 > 19" needs no parsing rules.
 */
export const getCurrentVersionCode = (): number => {
  const raw = Application.nativeBuildVersion;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getCurrentVersionName = (): string =>
  Application.nativeApplicationVersion ?? '';

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, 6)
    : [];

const fetchManifest = async (): Promise<PlatformManifest | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // cache: 'no-store' so a CDN edge cache can't pin the app to a stale
    // manifest for the lifetime of the process.
    const res = await fetch(MANIFEST_URL, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const platformKey = Platform.OS === 'ios' ? 'ios' : 'android';
    const section = json?.[platformKey];
    return section && typeof section === 'object' ? (section as PlatformManifest) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Check for a newer published build and record the result in the store.
 *
 * @param force skip the once-a-day throttle (for a manual "check now").
 * @returns the update found, or null when up to date / check skipped / failed.
 */
export const checkForUpdate = async (force = false): Promise<UpdateInfo | null> => {
  const { updateLastCheckedAt, setUpdateInfo, setUpdateLastCheckedAt } = useStore.getState();

  if (!force && updateLastCheckedAt) {
    const elapsed = Date.now() - new Date(updateLastCheckedAt).getTime();
    // A future timestamp (clock change, restored backup) reads as negative
    // elapsed and would otherwise freeze checks until the clock caught up.
    if (elapsed >= 0 && elapsed < CHECK_INTERVAL_MS) return null;
  }

  const manifest = await fetchManifest();
  // Only stamp the clock on a successful round trip, so an offline stretch
  // doesn't burn the day's check.
  if (!manifest) return null;
  setUpdateLastCheckedAt(new Date().toISOString());

  const latest = Number(manifest.latestVersionCode);
  if (!Number.isFinite(latest) || latest <= 0) return null;

  const current = getCurrentVersionCode();
  // current === 0 means the build number was unreadable; comparing against it
  // would tell everyone to update, so bail instead.
  if (current <= 0 || latest <= current) {
    setUpdateInfo(null);
    return null;
  }

  const minSupported = Number(manifest.minSupportedVersionCode);

  const info: UpdateInfo = {
    versionCode: latest,
    versionName: typeof manifest.latestVersionName === 'string' ? manifest.latestVersionName : '',
    releaseNotes: asStringArray(manifest.releaseNotes),
    url:
      typeof manifest.url === 'string' && manifest.url.startsWith('https://')
        ? manifest.url
        : `https://play.google.com/store/apps/details?id=${Application.applicationId ?? ''}`,
    mandatory: Number.isFinite(minSupported) && current < minSupported,
  };

  setUpdateInfo(info);
  return info;
};
