/** Local Whisper via the Web Worker. Requests are serialized: one chunk in flight at a time. */
import type { Transcriber, TranscriberProgress } from '../../shared/interfaces';
import type { AudioChunk, TranscriptSegment } from '../../shared/types';
import { cleanTranscriptText } from './clean';
import type { WorkerIn, WorkerOut } from './whisper.worker';

export class LocalWhisperTranscriber implements Transcriber {
  readonly kind = 'local' as const;
  private worker?: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private model: string, private workerUrl = 'whisper.worker.js') {}

  init(onProgress?: (p: TranscriberProgress) => void): Promise<void> {
    // Relative URL resolves against dist/renderer/index.html.
    const w = new Worker(this.workerUrl, { type: 'module' });
    this.worker = w;
    return new Promise<void>((resolve, reject) => {
      w.onerror = (e) => {
        const err = new Error(`Whisper worker error: ${e.message}`);
        reject(err); // no-op once ready
        this.failAll(err); // never leave transcribe() hanging if the worker dies
      };
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.({ status: m.status, percent: m.percent });
        else if (m.type === 'ready') { onProgress?.({ status: 'Ready', percent: 100 }); resolve(); }
        else if (m.type === 'result') this.settle(m.id, m.text);
        else if (m.type === 'error') {
          if (m.id === undefined) reject(new Error(m.message));
          else this.settle(m.id, undefined, new Error(m.message));
        }
      };
      w.postMessage({ type: 'init', model: this.model } satisfies WorkerIn);
    });
  }

  private settle(id: number, text?: string, err?: Error) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (err) p.reject(err);
    else p.resolve(text ?? '');
  }

  private run(chunk: AudioChunk): Promise<string> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error('LocalWhisperTranscriber not initialised'));
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Copy so the caller's buffer survives the transfer.
      const samples = chunk.samples.slice();
      w.postMessage({ type: 'transcribe', id, samples, sampleRate: chunk.sampleRate } satisfies WorkerIn, [samples.buffer]);
    });
  }

  transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    const job = this.queue.then(async () => {
      const text = cleanTranscriptText(await this.run(chunk));
      if (!text) return [];
      return [{ id: crypto.randomUUID(), speaker: chunk.speaker, text, startMs: chunk.startMs, endMs: chunk.endMs }];
    });
    this.queue = job.catch(() => undefined); // a failed chunk must not block the next one
    return job;
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  async dispose(): Promise<void> {
    this.worker?.terminate();
    this.worker = undefined;
    this.failAll(new Error('Transcriber disposed'));
  }
}
