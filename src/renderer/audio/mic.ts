/** Microphone = the tutor's voice. */
import type { AudioSource } from '../../shared/interfaces';
import type { AudioChunk } from '../../shared/types';
import { PcmChunker, StreamCapture } from './pcm';

export class MicAudioSource implements AudioSource {
  readonly speaker = 'tutor' as const;
  private stream?: MediaStream;
  private capture = new StreamCapture();

  constructor(private deviceId?: string) {}

  async start(onChunk: (chunk: AudioChunk) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // removes the student's voice coming out of the tutor's speakers
        noiseSuppression: true,
        ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}),
      },
      video: false,
    });
    const chunker = new PcmChunker(this.speaker, onChunk);
    await this.capture.start(this.stream, (s, t) => chunker.push(s, t));
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
