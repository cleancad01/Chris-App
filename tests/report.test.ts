import { describe, expect, it } from 'vitest';
import { createReportGenerator } from '../src/main/services/report';
import { MockLlmClient } from '../src/main/services/llm';
import type { Lesson, Student, StudentMemory } from '../src/shared/types';

const lesson: Lesson = { id: 'L2', studentId: 's', startedAt: '2026-11-05T10:00:00.000Z', endedAt: '2026-11-05T10:45:00.000Z', subject: 'Algebra' };
const student: Student = { id: 's', name: 'Alex', createdAt: '' };
const transcript = [{ id: '1', speaker: 'tutor' as const, text: 'Hello there', startMs: 1_700_000_000_000, endMs: 1_700_000_001_000 }];
const priorMemory: StudentMemory = {
  studentId: 's', lessonSummaries: [],
  concepts: [{ name: 'Fractions', description: 'old', status: 'mastered', firstLessonId: 'L1', lastLessonId: 'L1' }],
};

describe('ReportGenerator', () => {
  it('generates and merges concepts', async () => {
    const llm = new MockLlmClient();
    const r = await createReportGenerator(llm).generate({ lesson, student, transcript, priorMemory });
    expect(r.overview).toContain('linear equations');
    expect(r.concepts.map((c) => c.name)).toEqual(['Fractions', 'Linear equations']);
    expect(r.concepts[1].firstLessonId).toBe('L2');
  });
  it('falls back without throwing, retrying once', async () => {
    const llm = new MockLlmClient();
    llm.respond = () => { throw new Error('x'); };
    const r = await createReportGenerator(llm).generate({ lesson, student, transcript, priorMemory });
    expect(r.overview).toBe('Report generation failed; transcript saved.');
    expect(r.concepts).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
  });
  it('renders all sections', async () => {
    const gen = createReportGenerator(new MockLlmClient());
    const report = await gen.generate({ lesson, student, transcript, priorMemory });
    const md = gen.renderMarkdown({ lesson, student, report, transcript });
    expect(md).toContain('## Lesson report - Alex - ');
    for (const h of ['### Overview', '### What the student learned', '### Not yet learned', '### Where they struggled', '### Suggested next steps', '### Concept roadmap', '### Full transcript']) expect(md).toContain(h);
    expect(md).toContain('45 min');
    expect(md).toContain('| Linear equations | practiced |');
    expect(md).toContain('Tutor: Hello there');
  });
});
