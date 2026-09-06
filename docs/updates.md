# In-app update banner

Echo Spend has no backend, so the answer to "is there a newer build?" comes from
a **static JSON manifest** on a CDN. The app polls it at most once a day and
shows a banner on the dashboard when the installed build is behind.

## Pieces

| Piece | Where |
|---|---|
| Manifest fetch, throttle, version comparison | `src/services/updateChecker.ts` |
| Persisted state (`updateInfo`, `updateLastCheckedAt`, `updateDismissedVersionCode`) | `src/store/useStore.ts` |
| Banner UI | `src/components/UpdateBanner.tsx` |
| Mount point (self-hides when up to date) | `src/screens/DashboardScreen.tsx` |
| Manual "Check for Updates" row (Settings → About) | `src/screens/SettingsScreen.tsx` |
| Check trigger (cold start + foreground, after hydration) | `App.tsx` |
| Manifest URL | `app.config.ts` → `extra.updateManifestUrl`, override with `UPDATE_MANIFEST_URL` |
| Manifest template (NOT the live one — see Hosting) | `version.json` (repo root) |
| Publish script | `scripts/publish-update-manifest.js` (`yarn publish:manifest`) |

## Manifest format

```json
{
  "android": {
    "latestVersionCode": 20,
    "latestVersionName": "1.2.8",
    "minSupportedVersionCode": 0,
    "releaseNotes": ["Bill reminders", "Faster SmartScan"],
    "url": "https://play.google.com/store/apps/details?id=com.adkdinesh.echospend"
  },
  "ios": { "...same shape..." }
}
```

- **`latestVersionCode`** — the only field compared. Integer, matches
  `versionCode` in `android/app/build.gradle`. Semver strings are never parsed.
- **`minSupportedVersionCode`** — force-update gate. When the installed build is
  below this, the banner becomes undismissible. Leave at `0` normally; raise it
  only to retire a build that is actively harmful (e.g. corrupts data). This can
  be flipped *after* the bad release is already in the wild, which is the main
  advantage over Play's In-App Updates API.
- **`releaseNotes`** — up to 6 shown, extras ignored. Optional.
- **`url`** — must be `https://`; falls back to the Play listing for the app id.

## Hosting

The manifest lives in the public repo
[Dineshkumargits/echo-spend-releases](https://github.com/Dineshkumargits/echo-spend-releases),
served from its `main` branch as:

```
https://raw.githubusercontent.com/Dineshkumargits/echo-spend-releases/main/version.json
```

Set `UPDATE_MANIFEST_URL` at build time to point somewhere else (a staging
manifest, a local test server). The repo must stay **public** — the fetch is
unauthenticated, and a private repo returns 404, which the app reads as "check
failed" and silently ignores.

## Release checklist

1. Bump `versionCode` and `versionName` in `android/app/build.gradle`.
2. Build, sign, upload to Play, complete the rollout.
3. **Only after the rollout reaches 100%**, publish the manifest:

   ```bash
   yarn publish:manifest --notes "Bill reminders" --notes "Faster SmartScan"
   ```

   The script (`scripts/publish-update-manifest.js`) clones the releases repo,
   rewrites `version.json` and pushes. It reads versionCode/versionName from
   `android/app/build.gradle` — they are never typed in and never taken from
   `app.config.ts` — and refuses to publish a versionCode at or below the one
   already live, so a stale checkout cannot roll the manifest backwards. It
   prompts about the rollout before pushing.

   | Flag | Effect |
   |---|---|
   | `--notes <text>` | A release-note bullet. Repeatable; the banner shows the first 6. Omit to keep the previously published notes. |
   | `--min-supported <n>` | Set the force-update gate. |
   | `--dry-run` | Print the resulting manifest and stop. |
   | `--yes` | Skip the rollout prompt (CI). |
   | `--repo <url>` | Publish somewhere else (a staging manifest, a local test repo). |

   Pushing uses SSH (`git@github.com:...`), so it needs a key with write access
   to the releases repo.

Step 3 is deliberately last. The manifest is a broadcast to every install — it
cannot know whether a given user is in a staged rollout bucket. Publishing it at
10% rollout tells 90% of users to update to something they can't get yet.

Forgetting step 3 fails safe: no banner, nobody is misled.

## Behaviour notes

- **Version source is the native binary.** `Application.nativeBuildVersion`, not
  `Constants.expoConfig.version`. This is a bare workflow, so `build.gradle` is
  what ships and `app.config.ts` has already drifted (it says `1.1.0` /
  `versionCode 2` while the build says `1.2.7` / `19`). Worth reconciling, but
  the update check does not depend on it.
- **Silent failure.** Offline, 404, malformed JSON, unreadable build number →
  no banner, no error, no toast. The clock is only stamped on a successful
  fetch, so an offline stretch doesn't burn the day's check.
- **Dismissal is per-version.** Tapping "Later" on 1.2.8 does not silence 1.2.9.
- **Mandatory ignores dismissal.**
- **No native rebuild needed.** `expo-application` was already linked as a
  transitive dependency of `expo-notifications`; it is now an explicit one.

## Manual check

Settings → **About** → **Check for Updates** shows the installed version, and on
tap forces a check past the 24h throttle. Finding an update also **clears any
previous dismissal**, so someone who tapped "Later" and then came looking gets
the dashboard banner back rather than silence.

`checkForUpdate()` returns `null` for both "up to date" and "the check failed",
so the row tells them apart by whether `updateLastCheckedAt` actually moved —
only a successful fetch stamps it.

## Testing

Point `UPDATE_MANIFEST_URL` at a local file server (or edit the hosted JSON) and
set `latestVersionCode` above the installed build's. Cold-start the app, or just
tap Settings → About → Check for Updates.

Debug builds permit cleartext (`android/app/src/debug/AndroidManifest.xml`), so
a plain `python3 -m http.server` on the host works: point
`UPDATE_MANIFEST_URL` at `http://10.0.2.2:<port>/version.json` for an emulator. To
re-test after dismissing, clear `updateDismissedVersionCode`, or bump the
manifest version again. To bypass the 24h throttle, call
`checkForUpdate(true)`.
