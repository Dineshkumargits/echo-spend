# Echo Spend — Android Build Guide

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 18+ | Use fnm or nvm |
| Java (JDK) | 17 or 21 | OpenJDK recommended |
| Android SDK | API 36 | See SDK setup below |
| NDK | 27.x | Installed via sdkmanager |

---

## 1. Android SDK Setup

If the SDK is not at `~/android-sdk`, install it:

```bash
# Download cmdline-tools from https://developer.android.com/studio#command-tools
mkdir -p ~/android-sdk/cmdline-tools
unzip commandlinetools-linux-*.zip -d ~/android-sdk/cmdline-tools
mv ~/android-sdk/cmdline-tools/cmdline-tools ~/android-sdk/cmdline-tools/latest

# Add to shell profile (~/.zshrc or ~/.bashrc)
export ANDROID_HOME=$HOME/android-sdk
export ANDROID_SDK_ROOT=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

# Install required SDK components
sdkmanager --install \
  "platforms;android-36" \
  "build-tools;36.0.0" \
  "platform-tools" \
  "ndk;27.1.12297006"

sdkmanager --licenses   # Accept all licenses
```

---

## 2. Install JS Dependencies

```bash
cd echo-spend
npm install
```

---

## 3. Keystore (Release Signing)

The release keystore is already generated at:
```
android/app/echo-spend-release.keystore
```

> **IMPORTANT:** Back this file up securely. If lost, you cannot update the app on the Play Store.
> Keystore credentials are in `android/app/build.gradle` under `signingConfigs.release`.

To generate a fresh keystore (only needed once):
```bash
keytool -genkeypair -v \
  -keystore android/app/echo-spend-release.keystore \
  -alias echo-spend \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Echo Spend, OU=Mobile, O=ADKDinesh, L=Chennai, ST=Tamil Nadu, C=IN" \
  -storepass EchoSpend@2025 \
  -keypass EchoSpend@2025
```

---

## 4. Build Release APK

```bash
cd android

ANDROID_HOME=$HOME/android-sdk \
ANDROID_SDK_ROOT=$HOME/android-sdk \
./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  --no-daemon
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

### Why arm64-v8a + armeabi-v7a only?
- Covers 99%+ of real Android devices
- Skips x86/x86_64 (emulators only) → ~40% smaller APK

---

## 5. Build Release AAB (Play Store)

For Google Play submission, use an Android App Bundle (AAB) instead of APK:

```bash
cd android

ANDROID_HOME=$HOME/android-sdk \
ANDROID_SDK_ROOT=$HOME/android-sdk \
./gradlew bundleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  --no-daemon
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

---

## 6. Verify the Build

```bash
# Check APK is properly signed
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --verbose \
  android/app/build/outputs/apk/release/app-release.apk

# Inspect APK contents and size
$ANDROID_HOME/build-tools/36.0.0/aapt dump badging \
  android/app/build/outputs/apk/release/app-release.apk | head -20
```

---

## 7. Install on Device (Sideload)

```bash
# List connected devices
adb devices

# Install APK
adb install -r android/app/build/outputs/apk/release/app-release.apk

# Or with specific device
adb -s <device-id> install -r android/app/build/outputs/apk/release/app-release.apk
```

---

## 8. Version Bumping

Before each release, update version in **two places**:

1. `app.config.ts` → `version` (semver string) and `android.versionCode` (integer, must increase)
2. `android/app/build.gradle` → `defaultConfig.versionCode` and `defaultConfig.versionName`

```
Current: version = "1.1.0", versionCode = 2
Next:    version = "1.2.0", versionCode = 3
```

---

## 9. Environment Variables (Optional)

Create a `.env` file for custom endpoints:

```env
OLLAMA_ENDPOINT=https://your-ollama-host/api/generate
OLLAMA_MODEL=gemma4:latest
CF_ACCESS_CLIENT_ID=your-client-id
CF_ACCESS_CLIENT_SECRET=your-client-secret
GOOGLE_ANDROID_CLIENT_ID=608510187153-xxx.apps.googleusercontent.com
GOOGLE_WEB_CLIENT_ID=608510187153-xxx.apps.googleusercontent.com
APP_BUNDLE_ID=com.adkdinesh.echospend
```

---

## 10. Troubleshooting

### `ANDROID_HOME not set`
```bash
export ANDROID_HOME=$HOME/android-sdk
export ANDROID_SDK_ROOT=$HOME/android-sdk
```

### `SDK location not found`
```bash
echo "sdk.dir=$HOME/android-sdk" > android/local.properties
```

### Out of memory during build
Edit `android/gradle.properties`:
```
org.gradle.jvmargs=-Xmx6144m -XX:MaxMetaspaceSize=512m
```

### Metro bundler port conflict
```bash
npx react-native start --reset-cache
```

### Clean build (when cache causes issues)
```bash
cd android
./gradlew clean
cd ..
```

### `SDK Build Tools revision X.Y.Z is too low`
```bash
$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "build-tools;36.0.0"
```

---

## Build Optimizations Applied

| Optimization | What it does |
|---|---|
| **Hermes JS engine** | Compiles JS to bytecode at build time — faster startup, less RAM |
| **R8 minification** | Dead code elimination + name obfuscation |
| **Resource shrinking** | Removes unused drawables, strings, layouts |
| **arm64-v8a + armeabi-v7a only** | Skips emulator ABIs → smaller APK |
| **PNG crunching** | Losslessly compresses PNG assets |
| **New Architecture (TurboModules)** | JSI-based native modules — no bridge overhead |
| **Gradle build cache** | Incremental builds reuse prior outputs |
| **Gradle parallel** | Sub-projects compile in parallel |


cd android
./gradlew clean
./gradlew assembleRelease
adb uninstall com.adkdinesh.echospend
adb install -r app/build/outputs/apk/release/app-release.apk

keytool -genkeypair -v \                                      06:27:49
  -keystore android/app/echo-spend-release.keystore \
  -alias echo-spend \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Echo Spend, OU=Mobile, O=ADKDinesh, L=Chennai, ST=Tamil Nadu, C=IN" \
  -storepass EchoSpend@2026 \
  -keypass EchoSpend@2026