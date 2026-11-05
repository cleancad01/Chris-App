import { describe, expect, it } from 'vitest';
import { buildHelpMePrompt, buildReportPrompt, parseHelpMeResponse, parseReport } from '../src/main/services/prompts';
import type { HelpMeRequest, TranscriptSegment } from '../src/shared/types';

const seg = (speaker: 'tutor' | 'student', text: string, startMs: number): TranscriptSegment => ({ id: text, speaker, text, startMs, endMs: startMs + 2000 });
const req: HelpMeRequest = {
  transcript: [seg('tutor', 'What is 2x+3=7?', 1_700_000_000_000), seg('student', 'I am not sure', 1_700_000_005_000)],
  screenshot: { capturedAt: 1, mimeType: 'image/png', dataBase64: 'AAAA', width: 1, height: 1 },
  context: {
    studentName: 'Alex', subject: 'Algebra', runningSummary: 'Started equations',
    concepts: [{ name: 'Fractions', description: '', status: 'practiced', firstLessonId: 'a', lastLessonId: 'a' }],
    priorLessonSummaries: [{ lessonId: 'a', date: '2026-10-01', summary: 'Did fractions' }],
  },
};

describe('help-me prompt', () => {
  it('has transcript, context and image first', () => {
    const { system, content } = buildHelpMePrompt(req);
    expect(system).toContain('JSON');
    expect(content[0].type).toBe('image');
    const text = content.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n');
    expect(text).toMatch(/\] Tutor: What is 2x\+3=7\?/);
    expect(text).toMatch(/\] Student: I am not sure/);
    expect(text).toContain('Alex');
    expect(text).toContain('Algebra');
    expect(text).toContain('Fractions (practiced)');
    expect(text).toContain('Did fractions');
    expect(text).toContain('Started equations');
  });
  it('works without screenshot and truncates long transcripts keeping the end', () => {
    const many = Array.from({ length: 2000 }, (_, i) => seg('tutor', `line number ${i}`, 1_700_000_000_000 + i));
    const { content } = buildHelpMePrompt({ ...req, screenshot: undefined, transcript: many });
    expect(content[0].type).toBe('text');
    const t = (content[0] as any).text as string;
    expect(t).toContain('line number 1999');
    expect(t).not.toContain('line number 0\n');
  });
});

describe('priorContext', () => {
  it('appears in help-me and report prompts only when provided', () => {
    const none = (buildHelpMePrompt(req).content.at(-1) as any).text;
    expect(none).not.toContain('Notes from past lessons');
    const withCtx = (buildHelpMePrompt({ ...req, context: { ...req.context, priorContext: 'Likes pizza fractions' } }).content.at(-1) as any).text;
    expect(withCtx).toContain('Notes from past lessons:\nLikes pizza fractions');
    const r = buildReportPrompt({
      lesson: { id: 'L', studentId: 's', startedAt: '2026-11-05T10:00:00Z' }, student: { id: 's', name: 'Alex', createdAt: '' },
      transcript: req.transcript, priorMemory: { studentId: 's', concepts: [], lessonSummaries: [] }, priorContext: 'Likes pizza fractions',
    });
    expect((r.content[0] as any).text).toContain('Likes pizza fractions');
  });
});

describe('parseHelpMeResponse', () => {
  const good = { answer: 'x=2', confidence: 'High', overview: 'o', connections: [{ concept: 'c', relation: 'r', source: 'new' }], updatedRunningSummary: 's' };
  it('parses plain and fenced JSON', () => {
    expect(parseHelpMeResponse(JSON.stringify(good), 5).answer).toBe('x=2');
    const r = parseHelpMeResponse('```json\n' + JSON.stringify(good) + '\n```', 5);
    expect(r.connections).toHaveLength(1);
    expect(r.createdAt).toBe(5);
  });
  it('coerces bad fields', () => {
    const r = parseHelpMeResponse('{"answer":"a","connections":"nope","overview":3}', 1);
    expect(r.connections).toEqual([]);
    expect(r.overview).toBe('3');
  });
  it('falls back on garbage', () => {
    const r = parseHelpMeResponse('just some text', 1);
    expect(r.answer).toBe('just some text');
    expect(r.confidence).toMatch(/Unknown/);
    expect(r.connections).toEqual([]);
  });
  it('never returns empty answer', () => {
    expect(parseHelpMeResponse('', 1).answer).toMatch(/Retry/);
    expect(parseHelpMeResponse('{"answer":""}', 1).answer).toBe('{"answer":""}');
  });
});

describe('report prompt/parse', () => {
  it('builds prompt with prior concepts', () => {
    const { content } = buildReportPrompt({
      lesson: { id: 'L', studentId: 's', startedAt: '2026-11-05T10:00:00Z' }, student: { id: 's', name: 'Alex', createdAt: '' },
      transcript: req.transcript,
      priorMemory: { studentId: 's', concepts: [{ name: 'Fractions', description: 'd', status: 'mastered', firstLessonId: 'a', lastLessonId: 'a' }], lessonSummaries: [] },
    });
    expect((content[0] as any).text).toContain('Fractions (mastered)');
  });
  it('parses fenced report and sets lesson ids', () => {
    const r = parseReport('```json\n{"overview":"o","learned":["a"],"concepts":[{"name":"N","description":"d","status":"bogus"}],"lessonSummary":"s"}\n```', 'L1');
    expect(r.learned).toEqual(['a']);
    expect(r.concepts[0]).toMatchObject({ name: 'N', status: 'introduced', firstLessonId: 'L1', lastLessonId: 'L1' });
  });
  it('falls back on garbage', () => {
    const r = parseReport('nope', 'L');
    expect(r.overview).toBe('Report generation failed; transcript saved.');
    expect(r.learned).toEqual([]);
  });
});

import { extractPartialAnswer } from '../src/main/services/prompts';
describe('extractPartialAnswer', () => {
  it('handles partial and complete strings', () => {
    expect(extractPartialAnswer('')).toBe('');
    expect(extractPartialAnswer('{"ans')).toBe('');
    expect(extractPartialAnswer('{"answer": ')).toBe('');
    expect(extractPartialAnswer('{"answer": "x = ')).toBe('x = ');
    expect(extractPartialAnswer('{"answer":"a\\nb \\"q\\" c","confidence":"hi"')).toBe('a\nb "q" c');
    expect(extractPartialAnswer('{"answer":"abc\\')).toBe('abc');
    expect(extractPartialAnswer('{"answer":"\\u00e9\\u00')).toBe('\u00e9');
  });
});
