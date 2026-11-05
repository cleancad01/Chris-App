import type { Transcriber } from '../../shared/interfaces';
import { HostedTranscriber } from './hosted';
import { LocalWhisperTranscriber } from './local';
import { MockTranscriber } from './mock';

export { cleanTranscriptText } from './clean';
export { HostedTranscriber, LocalWhisperTranscriber, MockTranscriber };

export function createTranscriber(
  kind: 'local' | 'hosted' | 'mock',
  opts: { model: string; hostedApiKey?: string },
): Transcriber {
  switch (kind) {
    case 'hosted': return new HostedTranscriber(opts.hostedApiKey);
    case 'mock': return new MockTranscriber();
    default: return new LocalWhisperTranscriber(opts.model);
  }
}
