/**
 * Local Whisper via Web Workers: one worker per speaker, so the mic ("tutor") and loopback ("student")
 * streams are transcribed in parallel. Each worker serializes its own requests (one chunk in flight) and
 * keeps at most QUEUE_CAP chunks waiting; when a new chunk arrives on a full queue the OLDEST waiting chunk
 * is dropped (resolved with no segments) so the transcript stays close to real time.
 */
import type { Transcriber, TranscriberProgress } from '../../shared/interfaces';
import type { AudioChunk, Speaker, TranscriptSegment } from '../../shared/types';
import { cleanTranscriptText } from './clean';
import { BoundedQueue } from './queue';
import type { WorkerIn, WorkerOut } from './whisper.worker';

export const QUEUE_CAP = 2;
const SPEAKERS: readonly Speaker[] = ['tutor', 'student'];

export interface TranscriberStats {
  /** Chunks waiting (not yet sent to a worker), summed over speakers. */
  pending: number;
  /** Chunks dropped by backpressure since init, summed over speakers. */
  dropped: number;
  /** ms from the most recent finished chunk's endMs to its result. */
  lastLatencyMs: number;
}

interface Job {
  chunk: AudioChunk;
  resolve: (s: TranscriptSegment[]) => void;
  reject: (e: Error) => void;
}

/** One worker + its queue for a single speaker. */
class Lane {
  worker?: Worker;
  queue = new BoundedQueue<Job>(QUEUE_CAP);
  private inFlight?: { id: number; job: Job };
  private nextId = 1;

  constructor(private model: string, private workerUrl: string, private onDone: (chunk: AudioChunk) => void) {}

  init(onProgress?: (p: TranscriberProgress) => void): Promise<void> {
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
        else if (m.type === 'ready') resolve();
        else if (m.type === 'result') this.settle(m.id, m.text);
        else if (m.type === 'error') {
          if (m.id === undefined) reject(new Error(m.message));
          else this.settle(m.id, undefined, new Error(m.message));
        }
      };
      w.postMessage({ type: 'init', model: this.model } satisfies WorkerIn);
    });
  }

  enqueue(job: Job): void {
    if (!this.worker) { job.reject(new Error('LocalWhisperTranscriber not initialised')); return; }
    const evicted = this.queue.push(job);
    evicted?.resolve([]); // stale audio: skip quietly rather than surface an error
    this.pump();
  }

  private pump(): void {
    const w = this.worker;
    if (this.inFlight || !w) return;
    const job = this.queue.shift();
    if (!job) return;
    const id = this.nextId++;
    this.inFlight = { id, job };
    // Copy so the caller's buffer survives the transfer.
    const samples = job.chunk.samples.slice();
    w.postMessage({ type: 'transcribe', id, samples, sampleRate: job.chunk.sampleRate } satisfies WorkerIn, [samples.buffer]);
  }

  private settle(id: number, text?: string, err?: Error): void {
    const f = this.inFlight;
    if (!f || f.id !== id) return;
    this.inFlight = undefined;
    const { chunk } = f.job;
    if (err) f.job.reject(err);
    else {
      this.onDone(chunk);
      const t = cleanTranscriptText(text ?? '');
      f.job.resolve(t ? [{ id: crypto.randomUUID(), speaker: chunk.speaker, text: t, startMs: chunk.startMs, endMs: chunk.endMs }] : []);
    }
    this.pump(); // a failed chunk must not block the next one
  }

  failAll(err: Error): void {
    const f = this.inFlight;
    this.inFlight = undefined;
    f?.job.reject(err);
    for (const j of this.queue.drain()) j.reject(err);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.failAll(new Error('Transcriber disposed'));
  }
}

export class LocalWhisperTranscriber implements Transcriber {
  readonly kind = 'local' as const;
  private lanes = new Map<Speaker, Lane>();
  private lastLatencyMs = 0;

  // Relative URL resolves against dist/renderer/index.html.
  constructor(private model: string, private workerUrl = new URL('whisper.worker.js', document.baseURI).toString()) {}

  async init(onProgress?: (p: TranscriberProgress) => void): Promise<void> {
    const onDone = (c: AudioChunk) => { this.lastLatencyMs = Math.max(0, Date.now() - c.endMs); };
    // Sequential on purpose: the first worker downloads the model into the browser Cache, the second
    // then loads it from cache instead of downloading it a second time in parallel.
    try {
      for (const [i, sp] of SPEAKERS.entries()) {
        const lane = new Lane(this.model, this.workerUrl, onDone);
        this.lanes.set(sp, lane);
        const tag = `(${i + 1}/${SPEAKERS.length})`;
        await lane.init((p) => onProgress?.({ ...p, status: `${p.status} ${tag}` }));
      }
    } catch (e) {
      await this.dispose(); // don't leave a half-initialised worker running
      throw e;
    }
    onProgress?.({ status: 'Ready', percent: 100 });
  }

  transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    const lane = this.lanes.get(chunk.speaker);
    if (!lane) return Promise.reject(new Error('LocalWhisperTranscriber not initialised'));
    return new Promise<TranscriptSegment[]>((resolve, reject) => lane.enqueue({ chunk, resolve, reject }));
  }

  getStats(): TranscriberStats {
    let pending = 0;
    let dropped = 0;
    for (const l of this.lanes.values()) { pending += l.queue.size; dropped += l.queue.dropped; }
    return { pending, dropped, lastLatencyMs: this.lastLatencyMs };
  }

  async dispose(): Promise<void> {
    for (const l of this.lanes.values()) l.dispose();
    this.lanes.clear();
  }
}
