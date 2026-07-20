# Echo Spend

React Native (Expo, bare workflow) expense tracker with on-device AI SMS parsing.

## Build notes

### llama.rn native artifacts (Echo AI)

`llama.rn` does **not** ship its compiled Android/iOS binaries in the npm package. A
`postinstall` script downloads them (~80 MB) from GitHub Releases into:

- `node_modules/llama.rn/android/src/main/jniLibs/` (Android `librnllama*.so`)
- `node_modules/llama.rn/ios/rnllama.xcframework/` (iOS)

If that download is interrupted or skipped (network failure, `--ignore-scripts`),
**the app still builds successfully** but ships without the inference engine — Echo AI
then fails at runtime with `JSI bindings not installed`, even after the model file
downloads fine.

**Before building a release**, verify the libs exist:

```sh
ls node_modules/llama.rn/android/src/main/jniLibs/arm64-v8a/librnllama.so
```

If missing, re-download them:

```sh
node node_modules/llama.rn/install/download-native-artifacts.js --force
```

Optionally verify the final bundle actually contains them:

```sh
unzip -l android/app/build/outputs/bundle/release/app-release.aab | grep librnllama
```

### Release build

```sh
cd android && ./gradlew bundleRelease
```

- Kotlin **and** JS/TS changes are both picked up by `bundleRelease` (it runs Metro) —
  no separate bundling step needed.
- Do **not** run `npx expo prebuild` — the `android/` directory is maintained by hand
  (custom `SmsReceiver.kt`, headless task services, etc.) and prebuild would clobber it.
- Bump `versionCode` / `versionName` in `android/app/build.gradle` before a Play Store
  upload.
