/**
 * Synthetic audio source for tests and TUTOR_MOCK_AUDIO=1. No Web Audio: plain setInterval, runs in node.
 * Emits an amplitude-modulated tone + noise; every `silentEvery`-th chunk is silent and therefore dropped
 * (just like the real sources), so consumers see realistic gaps.
 */
import type { AudioSource } from '../../shared/interfaces';
import type { AudioChunk, Speaker } from '../../shared/types';
import { AUDIO } from '../../shared/config';
import { rms } from './pcm';

export interface FakeAudioOptions {
  /** Real time between chunks (default chunkSeconds*1000). Lower it in tests. */
  intervalMs?: number;
  /** Every Nth chunk is silent and skipped (default 4; 0 = never). */
  silentEvery?: number;
}

export class FakeAudioSource implements AudioSource {
  private timer?: ReturnType<typeof setInterval>;
  private n = 0;
  private level = 0;

  constructor(readonly speaker: Speaker, private opts: FakeAudioOptions = {}) {}

  /** Pure-ish: build chunk #index (exposed for tests). */
  synth(index: number): Float32Array {
    const sr = AUDIO.sampleRate;
    const len = AUDIO.chunkSeconds * sr;
    const out = new Float32Array(len);
    const silentEvery = this.opts.silentEvery ?? 4;
    if (silentEvery > 0 && index % silentEvery === silentEvery - 1) return out;
    const f = this.speaker === 'tutor' ? 180 : 260; // different "voices"
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t); // syllable-ish 3 Hz modulation
      out[i] = 0.2 * env * Math.sin(2 * Math.PI * f * t) + 0.02 * (Math.random() * 2 - 1);
    }
    return out;
  }

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    await this.stop();
    const durMs = AUDIO.chunkSeconds * 1000;
    this.timer = setInterval(() => {
      const samples = this.synth(this.n++);
      this.level = rms(samples);
      if (this.level < AUDIO.silenceRms) return;
      const endMs = Date.now();
      onChunk({ speaker: this.speaker, samples, sampleRate: 16000, startMs: endMs - durMs, endMs });
    }, this.opts.intervalMs ?? durMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.level = 0;
  }

  getLevel(): number {
    return this.level;
  }
}
