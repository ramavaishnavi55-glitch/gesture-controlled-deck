/**
 * ============================================================================
 * worker.js - Background AI Processing Thread (Web Worker)
 * ============================================================================
 * 
 * WHY A WEB WORKER?
 * In JavaScript, the main browser thread handles rendering, user clicks, and animations.
 * Running heavy Machine Learning (Deep Learning / ONNX models) directly on the main thread
 * would freeze the UI and make the tab unresponsive ("Page Unresponsive" warning).
 * 
 * By offloading the model downloading, tensor computation, and token generation
 * to this background Web Worker thread, the main webpage UI stays buttery smooth (60 FPS).
 *
 * COMMUNICATION PATTERN:
 * script.js (Main Thread) <--- postMessage() / onmessage ---> worker.js (Background Thread)
 */

// 1. Import Transformers.js from CDN using ES Module syntax
// Transformers.js allows running state-of-the-art Hugging Face models directly in browser via WebAssembly (WASM) & ONNX Runtime.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// 2. Configure Environment Flags
// Disable looking for local models on a backend server (since we are a 100% client-side app).
env.allowLocalModels = false;

// Ensure browser CacheStorage (Cache API) is enabled so weights are downloaded only ONCE and cached locally for offline use.
env.useBrowserCache = true;

/**
 * Singleton Pattern: Pipeline Manager
 * We use a Singleton class so that the neural network weights (~150MB-300MB) are loaded
 * into browser memory exactly once. Subsequent summarization calls reuse this instance.
 */
class SummarizerPipeline {
  // 'summarization' pipeline maps to seq2seq models like BART / T5
  static task = 'summarization';

  // Xenova/distilbart-cnn-6-6: Quantized ONNX model specifically trained for abstractive summarization.
  // It provides high summarization accuracy while remaining small enough for client-side execution.
  static model = 'Xenova/distilbart-cnn-6-6';

  static instance = null;

  /**
   * Retrieves or instantiates the pipeline instance.
   * @param {Function} progressCallback - Callback invoked during downloading stages
   */
  static async getInstance(progressCallback = null) {
    if (this.instance === null) {
      console.log(`[Worker] Initializing ${this.model}...`);
      this.instance = await pipeline(this.task, this.model, {
        progress_callback: progressCallback,
      });
      console.log(`[Worker] Model ${this.model} loaded successfully into memory.`);
    }
    return this.instance;
  }
}

/**
 * Message Event Listener:
 * Receives execution tasks from the main UI thread (script.js).
 */
self.addEventListener('message', async (event) => {
  const { action, text, options } = event.data;

  // --------------------------------------------------------------------------
  // ACTION: SUMMARIZE
  // --------------------------------------------------------------------------
  if (action === 'summarize') {
    try {
      // Step A: Notify main thread that pipeline retrieval has started
      self.postMessage({
        type: 'status',
        status: 'loading_model',
        message: 'Loading neural network into browser memory...'
      });

      // Step B: Load or fetch cached pipeline with a progress callback
      const summarizer = await SummarizerPipeline.getInstance((progressData) => {
        // Forward downloading progress (file names, % loaded, total bytes) to UI
        self.postMessage({
          type: 'download_progress',
          data: progressData
        });
      });

      // Step C: Notify that model is ready and inference has begun
      self.postMessage({
        type: 'status',
        status: 'generating',
        message: 'Analyzing lecture notes & generating summary...'
      });

      // Step D: Calculate token boundaries based on length preference
      // Options passed from script.js:
      // - short: max 60 tokens
      // - medium: max 130 tokens
      // - detailed: max 230 tokens
      const maxNewTokens = options?.maxTokens || 130;
      const minNewTokens = options?.minTokens || 40;

      const startTime = performance.now();

      // Step E: Run inference!
      // This feeds the input text into the tokenizers and ONNX Runtime WASM backend
      const result = await summarizer(text, {
        max_new_tokens: maxNewTokens,
        min_new_tokens: minNewTokens,
        temperature: 0.7,
        repetition_penalty: 1.15,
        no_repeat_ngram_size: 3,
      });

      const inferenceTimeMs = Math.round(performance.now() - startTime);

      // Step F: Extract summary string from the returned pipeline structure
      // Result is an array of objects: [{ summary_text: "..." }]
      const summaryText = result[0]?.summary_text || '';

      // Step G: Send completed result back to script.js
      self.postMessage({
        type: 'complete',
        summary: summaryText.trim(),
        inferenceTimeMs: inferenceTimeMs
      });

    } catch (error) {
      console.error('[Worker Error]:', error);
      self.postMessage({
        type: 'error',
        error: error.message || 'An error occurred during in-browser model execution.'
      });
    }
  }

  // --------------------------------------------------------------------------
  // ACTION: PRELOAD (Optional pre-warming of model)
  // --------------------------------------------------------------------------
  else if (action === 'preload') {
    try {
      await SummarizerPipeline.getInstance((progressData) => {
        self.postMessage({
          type: 'download_progress',
          data: progressData
        });
      });
      self.postMessage({
        type: 'status',
        status: 'ready',
        message: 'AI Model cached and ready.'
      });
    } catch (error) {
      console.warn('[Worker Preload Warning]:', error);
    }
  }
});
