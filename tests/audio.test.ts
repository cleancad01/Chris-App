import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeAudioSource } from '../src/renderer/audio/fake';
import { encodeWav, PcmChunker, rms, splitIntoChunks } from '../src/renderer/audio/pcm';
import { createAudioSources } from '../src/renderer/audio';
import { MockTranscriber } from '../src/renderer/transcriber/mock';
import { cleanTranscriptText, createTranscriber } from '../src/renderer/transcriber';
import type { AudioChunk } from '../src/shared/types';
import { AUDIO } from '../src/shared/config';

const SR = 16000;
const tone = (seconds: number, amp = 0.1) =>
  Float32Array.from({ length: seconds * SR }, (_, i) => amp * Math.sin((2 * Math.PI * 200 * i) / SR));
const chunk = (speaker: 'tutor' | 'student', startMs = 0): AudioChunk => ({
  speaker, samples: tone(5), sampleRate: 16000, startMs, endMs: startMs + 5000,
});

afterEach(() => vi.useRealTimers());

describe('FakeAudioSource', () => {
  it('emits AUDIO.chunkSeconds 16 kHz chunks for its speaker and skips silent ones', async () => {
    vi.useFakeTimers();
    const src = new FakeAudioSource('student', { intervalMs: 100, silentEvery: 4 });
    const got: AudioChunk[] = [];
    await src.start((c) => got.push(c));
    vi.advanceTimersByTime(800); // 8 ticks, 2 silent
    await src.stop();
    expect(got).toHaveLength(6);
    for (const c of got) {
      expect(c.speaker).toBe('student');
      expect(c.sampleRate).toBe(16000);
      expect(c.samples).toBeInstanceOf(Float32Array);
      expect(c.samples.length).toBe(AUDIO.chunkSeconds * SR);
      expect(c.endMs - c.startMs).toBe(AUDIO.chunkSeconds * 1000);
      expect(rms(c.samples)).toBeGreaterThan(0.05);
    }
    expect(src.getLevel()).toBe(0);
  });

  it('createAudioSources(mock) labels speakers', () => {
    const s = createAudioSources({ mock: true });
    expect(s.tutor.speaker).toBe('tutor');
    expect(s.student.speaker).toBe('student');
  });
});

describe('encodeWav', () => {
  it('writes a valid 16-bit mono PCM header', () => {
    const samples = new Float32Array([0, 1, -1, 0.5]);
    const v = new DataView(encodeWav(samples, 16000));
    const str = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
    expect(v.byteLength).toBe(44 + 8);
    expect(str(0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect(str(8)).toBe('WAVE');
    expect(str(12)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(str(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16383]);
  });
});

describe('chunker', () => {
  it('splits into 5 s chunks with timestamps, drops silence, keeps the tail', () => {
    const buf = new Float32Array(17 * SR);
    buf.set(tone(5), 0); // chunk 0 loud
    // chunk 1 (5-10 s) silent
    buf.set(tone(5), 10 * SR); // chunk 2 loud
    const { chunks, rest, restStartMs } = splitIntoChunks(buf, 1_000_000, 'tutor', { chunkSeconds: 5 });
    expect(chunks.map((c) => c.startMs)).toEqual([1_000_000, 1_010_000]);
    expect(chunks.map((c) => c.endMs)).toEqual([1_005_000, 1_015_000]);
    expect(chunks.every((c) => c.samples.length === 5 * SR && c.speaker === 'tutor')).toBe(true);
    expect(rest.length).toBe(2 * SR);
    expect(restStartMs).toBe(1_015_000);
  });

  it('PcmChunker accumulates small buffers into chunks', () => {
    const out: AudioChunk[] = [];
    const ch = new PcmChunker('student', (c) => out.push(c), { chunkSeconds: 5 });
    const block = tone(1).subarray(0, 4096);
    let t = 0;
    for (let i = 0; i < 40; i++) ch.push(block, (t += (4096 / SR) * 1000)); // ~10.2 s
    expect(out).toHaveLength(2);
    expect(out[0].startMs).toBe(0);
    expect(out[1].startMs).toBe(5000);
  });
});

describe('MockTranscriber', () => {
  it('returns speaker-matched scripted lines in order', async () => {
    const t = createTranscriber('mock', { model: 'x' });
    expect(t.kind).toBe('mock');
    await t.init();
    const a = await t.transcribe(chunk('tutor', 0));
    const b = await t.transcribe(chunk('student', 5000));
    const c = await t.transcribe(chunk('tutor', 10000));
    expect(a[0].speaker).toBe('tutor');
    expect(b[0].speaker).toBe('student');
    expect(c[0].speaker).toBe('tutor');
    expect(a[0].text).toMatch(/quadratic/i);
    expect(c[0].text).not.toBe(a[0].text);
    expect(b[0].startMs).toBe(5000);
    expect(b[0].endMs).toBe(10000);
    expect(new Set([a, b, c].map((s) => s[0].id)).size).toBe(3);
  });

  it('cycles through about 20 lines', async () => {
    const t = new MockTranscriber();
    const texts: string[] = [];
    for (let i = 0; i < 22; i++) texts.push((await t.transcribe(chunk(i % 2 ? 'student' : 'tutor')))[0].text);
    expect(new Set(texts).size).toBe(20);
  });
});

describe('cleanTranscriptText', () => {
  it.each([
    ['[BLANK_AUDIO]', ''],
    [' (silence) ', ''],
    ['Thank you. Thank you. Thank you.', ''],
    ['[MUSIC] ♪♪', ''],
    ['  you  ', ''],
    ['Thanks for watching!', ''],
    ['  So x equals minus 2.  ', 'So x equals minus 2.'],
    ['It factors as (x + 2)(x + 3).', 'It factors as (x + 2)(x + 3).'],
    ['[BLANK_AUDIO] What is the discriminant?', 'What is the discriminant?'],
    ['Is it 2.5? Is it 2.5?', 'Is it 2.5?'],
    ['x is 2.5 here', 'x is 2.5 here'],
  ])('%j -> %j', (input, expected) => {
    expect(cleanTranscriptText(input)).toBe(expected);
  });
});
