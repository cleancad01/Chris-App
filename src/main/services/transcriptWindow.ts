import type { TranscriptSegment } from '../../shared/types';
import type { TranscriptWindowing } from '../../shared/interfaces';

const pad = (n: number) => String(n).padStart(2, '0');

export function windowSegments(segments: TranscriptSegment[], windowMinutes: number, nowMs: number): TranscriptSegment[] {
  const cutoff = nowMs - windowMinutes * 60_000;
  return segments.filter((s) => s.endMs >= cutoff);
}

export function formatTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const d = new Date(s.startMs);
      const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      return `[${t}] ${s.speaker === 'tutor' ? 'Tutor' : 'Student'}: ${s.text}`;
    })
    .join('\n');
}

/** Keeps the END of the text. */
export function truncateToChars(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : '...' + text.slice(text.length - maxChars);
}

export const transcriptWindowing: TranscriptWindowing = { window: windowSegments, format: formatTranscript };
