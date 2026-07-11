import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import { initLlama, LlamaContext } from 'llama.rn';
import * as Device from 'expo-device';
import { useStore } from '../store/useStore';

const extra = Constants.expoConfig?.extra ?? {};
const AI_MODEL_URL: string =
  extra.aiModelUrl || 'https://huggingface.co/ADKDinesh/Qwen2.5-1.5B-SMS-Finance-Parser-GGUF/resolve/main/qwen2.5-1.5b-sms-finance-parser-q4_k_m.gguf';

const MODEL_DIR = `${FileSystem.documentDirectory}models/`;
const getModelFilename = (): string => {
  try {
    const urlParts = AI_MODEL_URL.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    if (lastPart && lastPart.endsWith('.gguf')) {
      return lastPart;
    }
  } catch { /* fallback */ }
  return 'qwen2.5-1.5b-sms-finance-parser-q4_k_m.gguf';
};
const MODEL_FILENAME = getModelFilename();
const MODEL_PATH = `${MODEL_DIR}${MODEL_FILENAME}`;

// Auto-release model from RAM after this many ms of inactivity
const AUTO_RELEASE_MS = 60_000;

// ─── Singleton State ─────────────────────────────────────────────────────────

let _context: LlamaContext | null = null;
let _releaseTimer: ReturnType<typeof setTimeout> | null = null;
let _downloadResumable: FileSystem.DownloadResumable | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetReleaseTimer() {
  if (_releaseTimer) clearTimeout(_releaseTimer);
  _releaseTimer = setTimeout(() => {
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
    return 986047968; // fallback ~940 MB
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
  /** Check if the device is compatible (has at least 2GB of total RAM) */
  isDeviceCompatible(): boolean {
    const totalMemory = Device.totalMemory;
    if (totalMemory && totalMemory < 2 * 1024 * 1024 * 1024) {
      console.warn('[AIModelManager] Device incompatible: total RAM is < 2GB:', totalMemory);
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
      throw new Error('Device is not compatible: at least 2GB of total RAM is required.');
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
      await AIModelManager.releaseModel();
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
      console.warn('[AIModelManager] Cannot init model: device total RAM is < 2GB.');
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
        n_threads: 2,     // Don't hog all CPU cores
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
      store.setAiModelStatus('error');
      store.setAiModelError(error?.message || 'Failed to load AI model');
      return false;
    }
  },

  /** Unload model from memory to free RAM */
  async releaseModel(): Promise<void> {
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
      stopSequences = ['}'],
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

      // Append the final '}' that was used as a stop sequence (if the output looks like JSON)
      if (text.trim().length > 0 && !text.trim().endsWith('}')) {
        const completedText = text + '}';
        console.log('[AIModelManager] Inference complete (JSON post-processed).');
        return completedText;
      }
      console.log('[AIModelManager] Inference complete.');
      return text;
    } catch (err) {
      console.error('[AIModelManager] Inference failed or timed out:', err);
      throw err;
    }
  },
};
