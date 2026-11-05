/**
 * System audio (WASAPI loopback) = the student's voice coming out of Zoom.
 * Requires main to have called session.setDisplayMediaRequestHandler(..., cb({ video: screenSource, audio: 'loopback' })).
 * Chromium insists on a video track with getDisplayMedia, so we request one and stop it immediately.
 */
import type { AudioSource } from '../../shared/interfaces';
import type { AudioChunk } from '../../shared/types';
import { PcmChunker, StreamCapture } from './pcm';

export class LoopbackAudioSource implements AudioSource {
  readonly speaker = 'student' as const;
  private stream?: MediaStream;
  private capture = new StreamCapture();

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('System audio unavailable: getDisplayMedia returned no audio track (loopback not granted by main process?)');
    }
    this.stream = stream;
    const chunker = new PcmChunker(this.speaker, onChunk);
    await this.capture.start(stream, (s, t) => chunker.push(s, t));
  }

  async stop(): Promise<void> {
    await this.capture.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }

  getLevel(): number {
    return this.capture.level;
  }
}
