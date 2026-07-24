# Echo Spend

React Native (Expo, bare workflow) expense tracker with on-device AI SMS parsing.

## Build notes

### llama.rn native artifacts (Echo AI)

`llama.rn` splits its Android native code in two:

- **Core libs** (`librnllama_v8_2_*.so`) — shipped prebuilt, downloaded (~80 MB) by
  llama.rn's own `postinstall` into `node_modules/llama.rn/android/src/main/jniLibs/`.
- **JNI wrapper libs** (`librnllama_jni_*.so`) — **compiled from source by CMake at build
  time**. These are what the loader calls via `System.loadLibrary("rnllama_jni_*")`.

The trap: CMake **skips** building a wrapper if the matching core `.so` isn't present at
configure time. So if the core download is ever interrupted (network, `--ignore-scripts`,
a CI cache), the next Android build configures "no wrappers" — and **Gradle's build cache
serves that stale decision on every later build** (dropping the `.so` files in afterward
does *not* invalidate the cache key). The APK then ships cores but no wrappers, and Echo AI
dies at runtime with `JSI bindings not installed` — unfixable by re-download or a plain
`clean`. This bit us once (see `git log` around the guard below).

**This is now guarded automatically.** `postinstall` runs
[`scripts/ensure-llama-libs.js`](scripts/ensure-llama-libs.js), which guarantees the cores
are present after every install (repairing or **failing the install loudly** if not) and
clears any stale CMake state so the wrappers are always rebuilt against the current cores.
Run it manually any time with:

```sh
yarn verify:echo-ai
```

**If you ever hit the JSI error again** (e.g. a poisoned Gradle cache on a machine that
built before this guard existed), force a clean CMake configure — a normal rebuild will
NOT fix it:

```sh
node node_modules/llama.rn/install/download-native-artifacts.js --force   # ensure cores
rm -rf node_modules/llama.rn/android/.cxx node_modules/llama.rn/android/build/intermediates/cxx
cd android && ./gradlew --no-daemon --no-build-cache assembleDebug        # or bundleRelease
```

**Always verify the built binary actually contains the wrappers** (not just the cores):

```sh
unzip -l android/app/build/outputs/apk/debug/app-debug.apk | grep librnllama_jni   # must be non-empty
```

Note: llama.rn only supports **arm64-v8a** and **x86_64** — Echo AI cannot run on 32-bit
(armeabi-v7a / x86) devices or emulators regardless of the build.

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
