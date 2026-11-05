/**
 * Whisper in a Web Worker (transformers.js, onnxruntime-web WASM backend).
 * Bundled as ESM to dist/renderer/whisper.worker.js; loaded with new Worker('whisper.worker.js', {type:'module'}).
 *
 * Protocol (see WorkerIn / WorkerOut):
 *   {type:'init', model}                         -> {type:'progress', status, percent?}* then {type:'ready'} | {type:'error', message}
 *   {type:'transcribe', id, samples, sampleRate} -> {type:'result', id, text} | {type:'error', id, message}
 *
 * Model files are fetched from the Hugging Face Hub once and kept in the browser Cache API
 * (env.useBrowserCache, the default), so later launches work offline. The ONNX Runtime .wasm binary is
 * loaded from transformers.js' default CDN path (jsDelivr) and is cached by Chromium's HTTP cache.
 */
import { env, pipeline } from '@huggingface/transformers';

export type WorkerIn =
  | { type: 'init'; model: string }
  | { type: 'transcribe'; id: number; samples: Float32Array; sampleRate: number };
export type WorkerOut =
  | { type: 'progress'; status: string; percent?: number }
  | { type: 'ready' }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

env.allowLocalModels = false;
env.useBrowserCache = true;

// Multi-threaded WASM needs SharedArrayBuffer, i.e. crossOriginIsolated (COOP/COEP headers on app://, see
// src/main/index.ts; disabled with TUTOR_WASM_THREADS=0). Two workers run at once (one per speaker), so each
// takes about half the cores, capped at 4.
const isolated = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
const wasmEnv = env.backends?.onnx?.wasm;
if (isolated && wasmEnv) wasmEnv.numThreads = Math.max(1, Math.min(4, Math.floor(cores / 2)));
console.log(`[whisper.worker] crossOriginIsolated=${isolated} hardwareConcurrency=${cores} wasm.numThreads=${wasmEnv?.numThreads ?? 'default'}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Asr = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<any>;
let asr: Asr | undefined;
let multilingual = false;

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function init(model: string): Promise<void> {
  multilingual = !/\.en$/i.test(model);
  post({ type: 'progress', status: 'Loading Whisper model', percent: 0 });
  let last = -1;
  asr = (await pipeline('automatic-speech-recognition', model, {
    dtype: 'q8',
    device: 'wasm',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    progress_callback: (p: any) => {
      // 'progress_total' aggregates all files; throttle to whole percents.
      if (p.status === 'progress_total' && typeof p.progress === 'number') {
        const pct = Math.floor(p.progress);
        if (pct !== last) post({ type: 'progress', status: 'Downloading Whisper model', percent: (last = pct) });
      }
    },
  })) as unknown as Asr;
  post({ type: 'progress', status: 'Warming up', percent: 100 });
  await asr(new Float32Array(16000)); // first run compiles kernels; do it before real audio arrives
  post({ type: 'ready' });
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      await init(msg.model);
    } catch (err) {
      post({ type: 'error', message: `Whisper init failed: ${errMsg(err)}` });
    }
    return;
  }
  if (msg.type === 'transcribe') {
    try {
      if (!asr) throw new Error('Whisper not initialised');
      if (msg.sampleRate !== 16000) throw new Error(`Expected 16 kHz audio, got ${msg.sampleRate}`);
      const out = await asr(msg.samples, {
        // Whisper's window is 30 s; shorter input is padded into one window, so only long input needs
        // chunking (chunk_length_s adds strided overlap passes).
        ...(msg.samples.length > 30 * msg.sampleRate ? { chunk_length_s: 30 } : {}),
        ...(multilingual ? { language: 'en', task: 'transcribe' } : {}),
      });
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out?.text ?? '';
      post({ type: 'result', id: msg.id, text });
    } catch (err) {
      post({ type: 'error', id: msg.id, message: errMsg(err) });
    }
  }
};
