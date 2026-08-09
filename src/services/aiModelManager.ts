import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { initLlama, LlamaContext } from 'llama.rn';
import * as Device from 'expo-device';
import { useStore } from '../store/useStore';

const extra = Constants.expoConfig?.extra ?? {};
const AI_MODEL_URL: string =
  extra.aiModelUrl || 'https://huggingface.co/ADKDinesh/Qwen2.5-0.5B-SMS-Finance-Parser-GGUF/resolve/main/qwen2.5-0.5b-sms-finance-parser-q4_k_m.gguf';

const MODEL_DIR = `${FileSystem.documentDirectory}models/`;
const getModelFilename = (): string => {
  try {
    const urlParts = AI_MODEL_URL.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    if (lastPart && lastPart.endsWith('.gguf')) {
      return lastPart;
    }
  } catch { /* fallback */ }
  return 'qwen2.5-0.5b-sms-finance-parser-q4_k_m.gguf';
};
const MODEL_FILENAME = getModelFilename();
const MODEL_PATH = `${MODEL_DIR}${MODEL_FILENAME}`;

// Auto-release model from RAM after this many ms of inactivity
const AUTO_RELEASE_MS = 60_000;

// Minimum total device RAM before Echo AI is offered at all. See isDeviceCompatible.
const MIN_DEVICE_RAM_BYTES = 4 * 1024 * 1024 * 1024;

// ─── Singleton State ─────────────────────────────────────────────────────────

let _context: LlamaContext | null = null;
let _releaseTimer: ReturnType<typeof setTimeout> | null = null;
let _downloadResumable: FileSystem.DownloadResumable | null = null;
// Number of in-flight batch jobs that need the context to stay alive. Several
// independent callers (real-time SMS handler, deferred AI enrichment, periodic
// scan, SmartScan) can overlap, and without this an early finisher's
// releaseModel() would null the context out from under a job still mid-batch —
// every remaining inference then throws "AI model is not loaded".
let _refCount = 0;

/**
 * Threads to give llama.cpp. A hardcoded 2 left most of the CPU idle on the
 * 6- and 8-core devices this app actually runs on, and on a CPU-only context
 * decode throughput scales close to linearly with threads until memory bandwidth
 * saturates — so this is the cheapest latency win available.
 *
 * Neither expo-device nor React Native exposes a core count without a native
 * module, so RAM stands in as a proxy for device class: in practice Android
 * phones with >=6GB are 8-core, 4-6GB are 8-core but slower, and anything under
 * 4GB is a low-end 4-core. Two cores are always left for the UI thread and the
 * rest of the system so a scan can't make the app janky.
 */
const inferenceThreadCount = (): number => {
  const gb = (Device.totalMemory ?? 0) / (1024 * 1024 * 1024);
  if (gb >= 6) return 6;
  if (gb >= 4) return 4;
  return 2;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetReleaseTimer() {
  if (_releaseTimer) clearTimeout(_releaseTimer);
  _releaseTimer = setTimeout(() => {
    _releaseTimer = null;
    // Don't unload out from under an active holder — re-arm and check again.
    if (_refCount > 0) {
      resetReleaseTimer();
      return;
    }
    AIModelManager.releaseModel();
  }, AUTO_RELEASE_MS);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const AIModelManager = {
  // ── Model File Management ────────────────────────────────────────────────

  /** Check if the GGUF model file exists on disk */
  async isModelDownloaded(): Promise<boolean> {
    try {
      const info = await FileSystem.getInfoAsync(MODEL_PATH);
      return info.exists && !info.isDirectory;
    } catch {
      return false;
    }
  },

  /** Get expected model size in bytes, fetching from Hugging Face if online or using default fallback */
  async getExpectedModelSize(): Promise<number> {
    try {
      const res = await fetch(AI_MODEL_URL, { method: 'HEAD' });
      const sizeStr = res.headers.get('content-length');
      if (sizeStr) {
        const size = parseInt(sizeStr, 10);
        if (!isNaN(size) && size > 0) {
          return size;
        }
      }
    } catch (e) {
      console.warn('[AIModelManager] Failed to fetch dynamic model size, using fallback:', e);
    }
    return 397807392; // fallback ~379 MB (0.5B q4_k_m)
  },

  /** Get human-readable formatted expected model size */
  async getFormattedExpectedSize(): Promise<string> {
    const bytes = await this.getExpectedModelSize();
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    if (sizes[i] === 'GB') {
      return `~${val.toFixed(1)} GB`;
    }
    return `~${Math.round(val)} ${sizes[i]}`;
  },

  /** Get model file size on disk in bytes, or 0 if not downloaded */
  async getModelSizeOnDisk(): Promise<number> {
    try {
      const info = await FileSystem.getInfoAsync(MODEL_PATH);
      if (info.exists && !info.isDirectory) {
        return (info as any).size ?? 0;
      }
      return 0;
    } catch {
      return 0;
    }
  },

  /** Absolute path to the model file */
  getModelPath(): string {
    return MODEL_PATH;
  },

  /**
   * Download the GGUF model file to the app's document directory.
   * Calls `onProgress(0–100)` during download.
   * Resolves `true` on success, throws on failure.
   */
  /** Check if the device is compatible (has at least 4GB of total RAM) */
  isDeviceCompatible(): boolean {
    // A 2GB floor was aspirational rather than honest: the model file alone is
    // ~380MB, and a 2GB device running Android plus the app has little to spare
    // free. Those devices passed the gate, downloaded a GB over mobile data, then
    // either OOM'd on initLlama or ran inference so slowly that the scan timed
    // out — the worst possible outcome, since it looks like the app is broken.
    // 4GB is the realistic floor for loading it at all; below that, regex-only
    // parsing is genuinely the better product.
    const totalMemory = Device.totalMemory;
    if (totalMemory && totalMemory < MIN_DEVICE_RAM_BYTES) {
      console.warn('[AIModelManager] Device incompatible: total RAM is < 4GB:', totalMemory);
      return false;
    }
    return true;
  },

  /** Scan the models/ directory and delete any GGUF files that do not match MODEL_FILENAME */
  async cleanupOrphanModels(): Promise<void> {
    try {
      const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
      if (!dirInfo.exists || !dirInfo.isDirectory) return;

      const files = await FileSystem.readDirectoryAsync(MODEL_DIR);
      console.log('[AIModelManager] Cleaning up old models. Found files:', files);

      for (const file of files) {
        if (file.endsWith('.gguf') && file !== MODEL_FILENAME) {
          const filePath = `${MODEL_DIR}${file}`;
          console.log('[AIModelManager] Deleting orphan model file:', file);
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
      }
    } catch (error) {
      console.error('[AIModelManager] Error cleaning up orphan models:', error);
    }
  },

  async downloadModel(
    onProgress?: (percent: number) => void,
  ): Promise<boolean> {
    if (!AIModelManager.isDeviceCompatible()) {
      throw new Error('Device is not compatible: at least 4GB of total RAM is required.');
    }

    // Guard: Prevent concurrent downloads
    if (_downloadResumable) {
      console.warn('[AIModelManager] Download already in progress.');
      return false;
    }

    const store = useStore.getState();

    // Ensure directory exists
    const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    }

    // Always start a clean download - delete any existing files/directories first to clear cache
    await AIModelManager.deleteModelFiles();
    // Recreate directory after deleteModelFiles wipes it
    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });

    store.setAiModelProgress(0);
    store.setAiModelStatus('downloading');
    store.setAiModelError(null);

    try {
      _downloadResumable = FileSystem.createDownloadResumable(
        AI_MODEL_URL,
        MODEL_PATH,
        {},
        (downloadProgress) => {
          const pct = Math.round(
            (downloadProgress.totalBytesWritten /
              downloadProgress.totalBytesExpectedToWrite) *
            100,
          );
          store.setAiModelProgress(pct);
          onProgress?.(pct);
        }
      );

      const result = await _downloadResumable.downloadAsync();
      _downloadResumable = null;

      if (!result || result.status !== 200) {
        throw new Error(`Download failed with status ${result?.status ?? 'unknown'}`);
      }

      store.setAiModelStatus('downloaded');
      store.setAiModelProgress(100);
      store.setAiModelResumeData(null);
      return true;
    } catch (error: any) {
      _downloadResumable = null;

      const currentStatus = useStore.getState().aiModelStatus;
      if (currentStatus === 'not_downloaded') {
        // This was a user-initiated cancel, so don't treat it as an error
        return false;
      }

      // Clean up partial downloads and cache on actual failures
      await AIModelManager.deleteModelFiles();

      store.setAiModelStatus('error');
      store.setAiModelError(error?.message || 'Download failed');
      throw error;
    }
  },

  /** Pause download (deprecated) */
  async pauseDownload(): Promise<void> {
    console.warn('[AIModelManager] pauseDownload is deprecated.');
  },

  /** Delete model files and directory cache */
  async deleteModelFiles(): Promise<void> {
    try {
      // Forced: the file is about to be deleted, so no holder may keep it open.
      await AIModelManager.releaseModel(true);
      await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
      const dirInfo = await FileSystem.getInfoAsync(MODEL_DIR);
      if (dirInfo.exists) {
        await FileSystem.deleteAsync(MODEL_DIR, { idempotent: true });
      }
    } catch (error) {
      console.error('[AIModelManager] Error deleting model files:', error);
    }
  },

  /** Cancel an in-progress download */
  async cancelDownload(): Promise<void> {
    const store = useStore.getState();
    store.setAiModelStatus('not_downloaded');
    store.setAiModelProgress(0);
    store.setAiModelResumeData(null);

    if (_downloadResumable) {
      try {
        if (typeof (_downloadResumable as any).cancelAsync === 'function') {
          await (_downloadResumable as any).cancelAsync();
        } else {
          await _downloadResumable.pauseAsync();
        }
      } catch {
        try {
          await _downloadResumable.pauseAsync();
        } catch { /* ignore */ }
      }
      _downloadResumable = null;
    }

    // Clean up partial files and directory cache
    await AIModelManager.deleteModelFiles();
  },

  /** Delete the model file from disk and release from memory */
  async deleteModel(): Promise<void> {
    await AIModelManager.deleteModelFiles();
    const store = useStore.getState();
    store.setAiModelStatus('not_downloaded');
    store.setAiModelProgress(0);
    store.setAiModelError(null);
    store.setAiModelResumeData(null);
  },

  // ── Model Lifecycle ──────────────────────────────────────────────────────

  /** Load the model into memory. No-op if already loaded. */
  async initModel(): Promise<boolean> {
    if (!AIModelManager.isDeviceCompatible()) {
      console.warn('[AIModelManager] Cannot init model: device total RAM is < 4GB.');
      return false;
    }
    if (_context) {
      console.log('[AIModelManager] LLM context already loaded.');
      return true;
    }

    const downloaded = await AIModelManager.isModelDownloaded();
    console.log('[AIModelManager] Initializing LLM. Path:', MODEL_PATH, 'Downloaded:', downloaded);
    if (!downloaded) {
      console.warn('[AIModelManager] Cannot init model: not yet downloaded.');
      return false;
    }

    const store = useStore.getState();
    store.setAiModelStatus('loading');

    try {
      console.log('[AIModelManager] Starting llama.rn initLlama...');
      _context = await initLlama({
        model: MODEL_PATH,
        n_ctx: 2048,      // 2048 context — safe for mobile and covers prompt + categories
        n_threads: inferenceThreadCount(),
        n_gpu_layers: 0,  // CPU-only for max device compatibility
        use_mlock: false,  // Don't lock pages — let OS manage memory
      });

      console.log('[AIModelManager] LLM context initialized successfully! Context ID:', _context?.id);
      store.setAiModelStatus('ready');
      resetReleaseTimer();
      return true;
    } catch (error: any) {
      console.error('[AIModelManager] Error during initLlama:', error);
      _context = null;

      // A LOAD failure is not a DOWNLOAD failure. We only reach here after
      // confirming the file exists on disk, and completed downloads are
      // size-checked at fetch time — so initLlama throwing almost always means
      // a runtime/native issue: missing JSI bindings on an unsupported ABI,
      // transient OOM (common in headless background scans), etc. None of these
      // are fixed by re-downloading the ~380 MB model, yet setting status to
      // 'error' makes every screen nag "Echo AI Download Failed → redownload".
      // Keep the model marked 'downloaded' so parsing silently falls back to
      // regex and loading can be retried later. Only flag for redownload when
      // the file is genuinely missing or truncated.
      const sizeOnDisk = await AIModelManager.getModelSizeOnDisk();
      const looksTruncated = sizeOnDisk > 0 && sizeOnDisk < 100 * 1024 * 1024;
      if (sizeOnDisk === 0 || looksTruncated) {
        store.setAiModelStatus('error');
        store.setAiModelError('Echo AI model file is missing or incomplete. Please re-download.');
      } else {
        store.setAiModelStatus('downloaded');
        store.setAiModelError(null);
      }
      return false;
    }
  },

  /**
   * Take a hold on the model for a batch of inferences, loading it if needed.
   * Every successful acquire MUST be paired with a releaseHold() in a `finally`.
   * While any hold is outstanding, releaseModel() and the idle timer will not
   * unload the context. Returns whether the model is usable.
   */
  async acquireModel(): Promise<boolean> {
    if (_releaseTimer) {
      clearTimeout(_releaseTimer);
      _releaseTimer = null;
    }
    _refCount++;
    if (_context) return true;

    const ok = await AIModelManager.initModel();
    if (!ok) _refCount = Math.max(0, _refCount - 1);
    return ok;
  },

  /**
   * Drop a hold taken by acquireModel(). The last holder decides what happens:
   * `immediate` unloads right away (headless/background callers, where RAM
   * pressure kills the task), otherwise the context is left warm for the idle
   * timer so a foreground screen doesn't pay a ~380 MB reload.
   */
  async releaseHold(immediate = false): Promise<void> {
    _refCount = Math.max(0, _refCount - 1);
    if (_refCount > 0) return;
    if (immediate) {
      await AIModelManager.releaseModel();
    } else {
      resetReleaseTimer();
    }
  },

  /**
   * Unload model from memory to free RAM. Skipped while another caller holds
   * the model via acquireModel(), unless `force` is set — the download flow
   * forces it because it is about to overwrite the file on disk.
   */
  async releaseModel(force = false): Promise<void> {
    if (!force && _refCount > 0) {
      console.log(`[AIModelManager] Release skipped — ${_refCount} holder(s) still using the model.`);
      return;
    }
    // Past this point the context really is going away, so any stale holds
    // (e.g. a forced release during re-download) are void.
    _refCount = 0;
    if (_releaseTimer) {
      clearTimeout(_releaseTimer);
      _releaseTimer = null;
    }
    if (_context) {
      try {
        console.log('[AIModelManager] Releasing LLM context to free RAM.');
        await _context.release();
      } catch (error) {
        console.error('[AIModelManager] Error releasing context:', error);
      }
      _context = null;
    }
    // Only update status if we're not in downloading/not_downloaded state
    const store = useStore.getState();
    const currentStatus = store.aiModelStatus;
    if (currentStatus === 'ready' || currentStatus === 'loading') {
      store.setAiModelStatus('downloaded');
    }
  },

  /** Check if the model is currently loaded in memory */
  isModelLoaded(): boolean {
    return _context !== null;
  },

  // ── Inference ────────────────────────────────────────────────────────────

  /**
   * Run a prompt through the on-device LLM.
   * Returns the raw text response.
   * Throws if model is not loaded.
   * Includes a per-call timeout to prevent scan hangs.
   */
  async runInference(
    prompt: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      timeoutMs?: number;
      stopSequences?: string[];
      jsonSchema?: string;
    },
  ): Promise<string> {
    if (!_context) {
      console.error('[AIModelManager] Inference requested but context is null!');
      throw new Error('AI model is not loaded. Call initModel() first.');
    }

    resetReleaseTimer();

    const {
      maxTokens = 512,
      temperature = 0.1,
      timeoutMs = 25000,
      // Callers that constrain output with a JSON grammar need no stop sequence —
      // the grammar itself ends generation. Defaulting to '}' truncated the closing
      // brace off every response and required patching it back on.
      stopSequences = [],
      jsonSchema,
    } = options ?? {};

    console.log('[AIModelManager] Running on-device LLM inference...');

    // Race against a timeout to prevent infinite hangs
    const inferencePromise = _context.completion(
      {
        prompt,
        n_predict: maxTokens,
        temperature,
        stop: stopSequences,
        // Encourage structured JSON output
        top_k: 40,
        top_p: 0.9,
        penalty_repeat: 1.1,
        json_schema: jsonSchema,
      },
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI inference timed out')), timeoutMs),
    );

    try {
      const result = await Promise.race([inferencePromise, timeoutPromise]);
      const text = (result as any)?.text ?? '';
      console.log('[AIModelManager] Inference complete.');
      return text;
    } catch (err) {
      console.error('[AIModelManager] Inference failed or timed out:', err);
      throw err;
    }
  },
};
