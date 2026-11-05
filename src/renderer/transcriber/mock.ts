/** Scripted tutoring dialogue (quadratic equations). Tutor chunks get tutor lines, student chunks student lines. */
import type { Transcriber, TranscriberProgress } from '../../shared/interfaces';
import type { AudioChunk, Speaker, TranscriptSegment } from '../../shared/types';

export const MOCK_LINES: Record<Speaker, string[]> = {
  tutor: [
    "Okay, today we're going to look at quadratic equations, things like x squared plus 5x plus 6 equals 0.",
    'A quadratic is any equation where the highest power of x is two.',
    'One way to solve it is factoring. We want two numbers that multiply to 6 and add to 5.',
    'Exactly, 2 and 3. So it factors as (x + 2)(x + 3) equals 0.',
    'If a product is zero, one of the factors has to be zero. So x is minus 2 or minus 3.',
    "Good question. When it doesn't factor nicely we use the quadratic formula.",
    'x equals minus b plus or minus the square root of b squared minus 4ac, all over 2a.',
    'The part under the square root, b squared minus 4ac, is called the discriminant.',
    "If the discriminant is negative there are no real solutions. Let's try 2x squared minus 4x minus 6.",
    'Nice work. For homework, try problems 4 through 10 on the worksheet.',
  ],
  student: [
    'Is that the same as the parabola stuff we did last week?',
    'Um, is it 2 and 3?',
    'So we just set each bracket to zero?',
    'What if I can\'t find two numbers that work, like x squared plus x plus 1?',
    'Wait, why is it plus or minus? I always forget that part.',
    'So a is 2, b is minus 4 and c is minus 6?',
    'b squared minus 4ac is 16 plus 48, so 64, and the square root is 8.',
    'So x is 3 or minus 1?',
    'Does a negative discriminant mean the parabola never touches the x-axis?',
    'Okay, I think I get it now. Can we do one more next time?',
  ],
};

export class MockTranscriber implements Transcriber {
  readonly kind = 'mock' as const;
  private idx: Record<Speaker, number> = { tutor: 0, student: 0 };

  async init(onProgress?: (p: TranscriberProgress) => void): Promise<void> {
    onProgress?.({ status: 'Ready (mock transcriber)', percent: 100 });
  }

  async transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]> {
    const lines = MOCK_LINES[chunk.speaker];
    const text = lines[this.idx[chunk.speaker]++ % lines.length];
    return [{ id: crypto.randomUUID(), speaker: chunk.speaker, text, startMs: chunk.startMs, endMs: chunk.endMs }];
  }

  async dispose(): Promise<void> {}
}
