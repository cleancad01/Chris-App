import type { AudioSource } from '../../shared/interfaces';
import { FakeAudioSource } from './fake';
import { LoopbackAudioSource } from './loopback';
import { MicAudioSource } from './mic';

export { encodeWav, rms, peak, PcmChunker, splitIntoChunks } from './pcm';
export { FakeAudioSource, MicAudioSource, LoopbackAudioSource };

/** Mic = tutor, system loopback = student. mock => synthetic sources (no devices needed). */
export function createAudioSources(opts: { mock: boolean }): { tutor: AudioSource; student: AudioSource } {
  if (opts.mock) return { tutor: new FakeAudioSource('tutor'), student: new FakeAudioSource('student') };
  return { tutor: new MicAudioSource(), student: new LoopbackAudioSource() };
}
