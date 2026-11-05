import { describe, expect, it } from 'vitest';
import { formatTranscript, truncateToChars, windowSegments } from '../src/main/services/transcriptWindow';

const mk = (id: string, speaker: 'tutor' | 'student', startMs: number, endMs: number) => ({ id, speaker, text: id, startMs, endMs });

describe('transcriptWindow', () => {
  it('windows by endMs', () => {
    const now = 10 * 60_000;
    const segs = [mk('old', 'tutor', 0, 1000), mk('edge', 'student', 5 * 60_000 - 1000, 5 * 60_000), mk('new', 'tutor', 9 * 60_000, 9 * 60_000 + 1000)];
    expect(windowSegments(segs, 5, now).map((s) => s.id)).toEqual(['edge', 'new']);
  });
  it('formats lines in local time', () => {
    const d = new Date(2026, 10, 5, 19, 2, 11);
    const out = formatTranscript([mk('hi', 'tutor', d.getTime(), d.getTime() + 1), mk('yo', 'student', d.getTime() + 4000, d.getTime() + 5000)]);
    expect(out).toBe('[19:02:11] Tutor: hi\n[19:02:15] Student: yo');
  });
  it('truncates keeping the end', () => {
    expect(truncateToChars('abcdef', 10)).toBe('abcdef');
    const t = truncateToChars('abcdefghij', 3);
    expect(t.endsWith('hij')).toBe(true);
    expect(t).not.toContain('abc');
  });
});
