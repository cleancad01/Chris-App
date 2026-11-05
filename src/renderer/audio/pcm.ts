/**
 * PCM helpers shared by the real audio sources (and the capture-test diagnostic).
 *
 * Pipeline: MediaStream -> AudioContext({sampleRate:16000}) (Chromium resamples for us)
 *   -> ScriptProcessorNode (1 channel, 'speakers' downmix) -> PcmChunker (AUDIO.chunkSeconds chunks, silence dropped).
 * Everything except StreamCapture is pure and runs in node/vitest.
 */
import type { AudioChunk, Speaker } from '../../shared/types';
import { AUDIO } from '../../shared/config';

/** Root-mean-square of a buffer (0..1 for normalised float PCM). */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Absolute peak of a buffer. */
export function peak(samples: Float32Array): number {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

export interface ChunkOptions {
  chunkSeconds?: number;
  silenceRms?: number;
  sampleRate?: 16000;
}

/**
 * Pure: split a contiguous 16 kHz buffer that started at `startMs` into full chunks.
 * Returns the emitted (non-silent) chunks and the leftover tail (< 1 chunk) for the next call.
 */
export function splitIntoChunks(
  samples: Float32Array,
  startMs: number,
  speaker: Speaker,
  opts: ChunkOptions = {},
): { chunks: AudioChunk[]; rest: Float32Array; restStartMs: number } {
  const sr = opts.sampleRate ?? AUDIO.sampleRate;
  const size = Math.round((opts.chunkSeconds ?? AUDIO.chunkSeconds) * sr);
  const silence = opts.silenceRms ?? AUDIO.silenceRms;
  const chunks: AudioChunk[] = [];
  let off = 0;
  for (; off + size <= samples.length; off += size) {
    const part = samples.slice(off, off + size);
    if (rms(part) < silence) continue; // drop silence
    const s = startMs + (off / sr) * 1000;
    chunks.push({ speaker, samples: part, sampleRate: 16000, startMs: Math.round(s), endMs: Math.round(s + (size / sr) * 1000) });
  }
  return { chunks, rest: samples.slice(off), restStartMs: startMs + (off / sr) * 1000 };
}

/**
 * Stateful accumulator around splitIntoChunks. Timestamps are derived from the sample count since the
 * first buffer (anchored to wall clock once), so they don't jitter with callback timing.
 */
export class PcmChunker {
  private buf: Float32Array = new Float32Array(0);
  private bufStartMs = 0;
  constructor(
    private speaker: Speaker,
    private onChunk: (c: AudioChunk) => void,
    private opts: ChunkOptions = {},
  ) {}

  /** `endMs` = wall-clock time of the last sample in `samples` (defaults to now). */
  push(samples: Float32Array, endMs = Date.now()): void {
    const sr = this.opts.sampleRate ?? AUDIO.sampleRate;
    if (this.buf.length === 0) this.bufStartMs = endMs - (samples.length / sr) * 1000;
    const merged = new Float32Array(this.buf.length + samples.length);
    merged.set(this.buf);
    merged.set(samples, this.buf.length);
    const { chunks, rest, restStartMs } = splitIntoChunks(merged, this.bufStartMs, this.speaker, this.opts);
    this.buf = rest;
    this.bufStartMs = restStartMs;
    chunks.forEach(this.onChunk);
  }

  reset(): void {
    this.buf = new Float32Array(0);
  }
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/**
 * Browser-only: pulls 16 kHz mono float32 frames out of a MediaStream.
 * `onFrames` gets every ~256 ms buffer; level is a smoothed RMS for meters.
 */
export class StreamCapture {
  private ctx?: AudioContext;
  private nodes: AudioNode[] = [];
  level = 0;

  async start(stream: MediaStream, onFrames: (samples: Float32Array, endMs: number) => void): Promise<void> {
    const ctx = new AudioContext({ sampleRate: AUDIO.sampleRate });
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but universally available in Chromium and needs no extra file/Blob.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.channelCount = 1;
    proc.channelCountMode = 'explicit';
    proc.channelInterpretation = 'speakers'; // stereo -> mono downmix
    proc.onaudioprocess = (e) => {
      const frames = new Float32Array(e.inputBuffer.getChannelData(0)); // copy: buffer is reused
      this.level = this.level * 0.6 + rms(frames) * 0.4;
      onFrames(frames, Date.now());
    };
    // The processor must reach the destination to be pulled; a muted gain avoids echo/feedback.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    this.nodes = [src, proc, mute];
    if (ctx.state === 'suspended') await ctx.resume();
  }

  async stop(): Promise<void> {
    this.nodes.forEach((n) => n.disconnect());
    this.nodes = [];
    this.level = 0;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
  }
}
