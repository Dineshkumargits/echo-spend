#!/usr/bin/env node
/**
 * Echo AI native-library guard.
 *
 * Why this exists (do not delete):
 * llama.rn ships only the prebuilt "core" libs (librnllama_v8_2_*.so) and
 * compiles the "JNI wrapper" libs (librnllama_jni_*.so) from source at build
 * time. Its CMake SKIPS building a wrapper when the matching core .so isn't
 * present at configure time. The cores are fetched by llama.rn's own
 * postinstall — but if that download is ever interrupted (network, CI cache,
 * --ignore-scripts), the cores are missing, the next Android build configures
 * CMake with "no wrappers", and Gradle's build cache then serves that stale
 * decision FOREVER (adding the .so files later does not invalidate the cache
 * key). The APK ends up with cores but no wrappers, and Echo AI dies at runtime
 * with "JSI bindings not installed" — unfixable by re-download or a plain clean.
 *
 * This guard makes that impossible by guaranteeing, on every install, that the
 * cores are present BEFORE any build can poison the cache — failing loudly if
 * they can't be fetched — and clearing any stale CMake configure so the wrappers
 * are always (re)built against the current cores.
 *
 * See memory: echo-ai-jsi-and-model-errors.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LLAMA = path.join(ROOT, 'node_modules', 'llama.rn');

// llama.rn not installed (e.g. a lockfile without it) — nothing to guard.
if (!fs.existsSync(LLAMA)) process.exit(0);

const JNI = path.join(LLAMA, 'android', 'src', 'main', 'jniLibs');
// Representative cores per supported ABI — if the tarball extracted, these exist.
const REQUIRED_CORES = [
  path.join(JNI, 'arm64-v8a', 'librnllama.so'),
  path.join(JNI, 'arm64-v8a', 'librnllama_v8_2.so'),
  path.join(JNI, 'x86_64', 'librnllama.so'),
];

const coresPresent = () => REQUIRED_CORES.every((p) => fs.existsSync(p));

function downloadCores() {
  const script = path.join(LLAMA, 'install', 'download-native-artifacts.js');
  if (!fs.existsSync(script)) return false;
  try {
    console.log('[ensure-llama-libs] Core libs missing — downloading llama.rn native artifacts…');
    execFileSync(process.execPath, [script, '--force'], { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error('[ensure-llama-libs] Download failed:', e.message);
    return false;
  }
}

// 1. Guarantee the cores are present (repair once if not).
if (!coresPresent()) {
  downloadCores();
  if (!coresPresent()) {
    console.error(
      '\n[ensure-llama-libs] FATAL: llama.rn core libraries are still missing after a repair attempt.\n' +
        '  Echo AI will fail at runtime ("JSI bindings not installed") if you build now.\n' +
        '  Fix your network/proxy, then run:\n' +
        '    node node_modules/llama.rn/install/download-native-artifacts.js --force\n',
    );
    process.exit(1); // fail loudly — never let a build run without cores
  }
}

// 2. Clear any stale CMake configure so the wrappers are (re)built against the
//    cores that are present now. Cheap: a reconfigure only recompiles the small
//    JNI wrappers, not llama.cpp itself.
for (const stale of [
  path.join(LLAMA, 'android', '.cxx'),
  path.join(LLAMA, 'android', 'build', 'intermediates', 'cxx'),
]) {
  try {
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { recursive: true, force: true });
      console.log('[ensure-llama-libs] Cleared stale CMake state:', path.relative(ROOT, stale));
    }
  } catch (e) {
    console.warn('[ensure-llama-libs] Could not clear', stale, '-', e.message);
  }
}

console.log('[ensure-llama-libs] OK — Echo AI native cores present, CMake state clean.');
