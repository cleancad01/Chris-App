/** OpenAI hosted Whisper (whisper-1). Optional; sends each 5 s chunk as a WAV upload. */
import type { Transcriber, TranscriberProgress } from '../../shared/interfaces';
import type { AudioChunk, TranscriptSegment } from '../../shared/types';
import { encodeWav } from '../audio/pcm';
import { cleanTranscriptText } from './clean';

const URL_ = 'https://api.openai.com/v1/audio/transcriptions';
const TIMEOUT_MS = 30_000;

export class HostedTranscriber implements Transcriber {
  readonly kind = 'hosted' as const;
  constructor(private apiKey: string | undefined, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  async init(onProgress?: (p: TranscriberProgress) => void): Promise<void> {
    if (!this.apiKey) throw new Error('Hosted transcriber needs an OpenAI API key (OPENAI_API_KEY)');
    onProgress?.({ status: 'Ready (hosted Whisper)', percent: 100 });
  }

  async transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    const form = new FormData();
    form.append('file', new Blob([encodeWav(chunk.samples, chunk.sampleRate)], { type: 'audio/wav' }), 'chunk.wav');
    form.append('model', 'whisper-1');
    form.append('language', 'en');
    form.append('response_format', 'json');
    const res = await this.fetchImpl(URL_, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenAI transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const text = cleanTranscriptText(((await res.json()) as { text?: string }).text ?? '');
    if (!text) return [];
    return [{ id: crypto.randomUUID(), speaker: chunk.speaker, text, startMs: chunk.startMs, endMs: chunk.endMs }];
  }

  async dispose(): Promise<void> {}
}
