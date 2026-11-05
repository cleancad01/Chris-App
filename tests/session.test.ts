import { describe, it, expect } from 'vitest';
import { LessonSession } from '../src/main/session';
import { NoopScreenCapture } from '../src/main/screen';
import { DEFAULT_SETTINGS } from '../src/shared/config';
import type { HelpMeService, ReportGenerator, Storage } from '../src/shared/interfaces';
import type {
  HelpMeRequest, Lesson, LessonReport, Settings, Student, StudentMemory, TranscriptSegment,
} from '../src/shared/types';

function fakeStorage() {
  const memories = new Map<string, StudentMemory>();
  const lessons = new Map<string, Lesson>();
  const transcripts: TranscriptSegment[] = [];
  const student: Student = { id: 'alex', name: 'Alex', createdAt: '2026-01-01T00:00:00Z' };
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const ctx = { text: '' };
  const s: Storage & { lessons: typeof lessons; transcripts: typeof transcripts; memories: typeof memories; student: Student; ctx: typeof ctx } = {
    dataDir: '/mem', lessons, transcripts, memories, student, ctx,
    getSettings: async () => settings,
    saveSettings: async (x) => { settings = x; },
    listStudents: async () => [student],
    createStudent: async (name) => ({ ...student, name }),
    getStudent: async (id) => (id === 'alex' ? student : undefined),
    saveStudent: async (x) => { Object.assign(student, x); },
    appendStudentContext: async (_id, entry) => { ctx.text += (ctx.text ? '\n' : '# Context\n') + entry; },
    getStudentContext: async () => ctx.text,
    getMemory: async (id) => memories.get(id) ?? { studentId: id, concepts: [], lessonSummaries: [] },
    saveMemory: async (m) => { memories.set(m.studentId, m); },
    createLesson: async (studentId, subject) => {
      const l: Lesson = { id: 'L1', studentId, startedAt: '2026-11-05T10:00:00Z', subject };
      lessons.set(l.id, l);
      return l;
    },
    saveLesson: async (l) => { lessons.set(l.id, l); },
    getLesson: async (_s, id) => lessons.get(id),
    listLessons: async () => [...lessons.values()],
    appendTranscript: async (_s, _l, segs) => { transcripts.push(...segs); },
    getTranscript: async () => transcripts,
    saveReport: async (_s, l) => `/mem/${l}/report.md`,
    reportPath: (_s, l) => `/mem/${l}/report.md`,
    saveLessonFile: async (_s, l, f) => `/mem/${l}/${f}`,
  };
  return s;
}

const seg = (id: string, endMs: number): TranscriptSegment => ({ id, speaker: 'student', text: id, startMs: endMs - 1000, endMs });

const report: LessonReport = {
  overview: 'o', learned: [], yetToLearn: [], struggles: [], nextSteps: [],
  concepts: [{ name: 'Fractions', description: 'd', status: 'introduced', firstLessonId: 'L1', lastLessonId: 'L1' }],
  lessonSummary: 'Did fractions.',
};

function setup() {
  const storage = fakeStorage();
  const requests: HelpMeRequest[] = [];
  const helpMe: HelpMeService = {
    ask: async (req) => {
      requests.push(req);
      return { ok: true, response: { answer: 'a', confidence: 'High', overview: 'o', connections: [], updatedRunningSummary: 'new summary', createdAt: 1 } };
    },
  };
  const generateInputs: Array<{ includePriorInPrompt?: boolean; priorContext?: string }> = [];
  const reports: ReportGenerator = {
    generate: async (input) => { generateInputs.push(input); return report; },
    renderMarkdown: () => '# report',
  };
  const s = new LessonSession({
    storage, helpMe, reports, screen: new NoopScreenCapture(),
    windowSegments: (segs, min, now) => segs.filter((x) => x.endMs >= now - min * 60_000),
    hasApiKey: () => true,
  });
  return { s, storage, requests, generateInputs };
}

describe('LessonSession', () => {
  it('runs a full lesson', async () => {
    const { s, storage, requests } = setup();
    const states: string[] = [];
    s.onChange((st) => states.push(st.status));
    expect(s.getState().status).toBe('idle');

    await s.start('alex', 'Math');
    expect(s.getState().status).toBe('running');
    await expect(s.start('alex')).rejects.toThrow();

    const now = Date.now();
    await s.appendTranscript([seg('old', now - 20 * 60_000), seg('new', now - 1000)]);
    expect(storage.transcripts).toHaveLength(2);
    expect(s.getTranscript()).toHaveLength(2);

    const res = await s.helpMe(5);
    expect(res.ok).toBe(true);
    expect(requests[0].transcript.map((x) => x.id)).toEqual(['new']);
    expect(requests[0].context.studentName).toBe('Alex');
    expect(storage.lessons.get('L1')!.runningSummary).toBe('new summary');

    const out = await s.end();
    expect(out.reportPath).toBe('/mem/L1/report.md');
    expect(out.lesson.endedAt).toBeTruthy();
    expect(storage.memories.get('alex')!.concepts[0].name).toBe('Fractions');
    expect(storage.memories.get('alex')!.lessonSummaries[0].summary).toBe('Did fractions.');
    expect(states).toContain('ending');
    expect(s.getState().status).toBe('idle');
  });

  const oldConcept = (name: string, last: string) => ({ name, description: '', status: 'practiced' as const, firstLessonId: 'a', lastLessonId: last });

  it('memory on: context has concepts and priorContext; context.md appended', async () => {
    const { s, storage, requests, generateInputs } = setup();
    storage.memories.set('alex', {
      studentId: 'alex',
      concepts: Array.from({ length: 40 }, (_, i) => oldConcept(`C${i}`, `A${String(i).padStart(2, '0')}`)),
      lessonSummaries: [1, 2, 3, 4].map((i) => ({ lessonId: `A${i}`, date: '2026-10-0' + i, summary: `s${i}` })),
    });
    storage.ctx.text = 'line one\n' + 'x'.repeat(2000) + '\nlast line';
    await s.start('alex', 'Math');
    await s.appendTranscript([seg('a', Date.now())]);
    await s.helpMe();
    const c = requests[0].context;
    expect(c.concepts).toHaveLength(30);
    expect(c.concepts[0].name).toBe('C39');
    expect(c.priorLessonSummaries.map((p) => p.summary)).toEqual(['s4', 's3', 's2']);
    expect(c.priorContext!.startsWith('...')).toBe(true);
    expect(c.priorContext!.length).toBeLessThanOrEqual(1510);
    expect(c.priorContext).toContain('last line');
    await s.end();
    expect(generateInputs[0].includePriorInPrompt).toBe(true);
    expect(storage.ctx.text).toContain('- Math\nDid fractions.\nKey concepts: Fractions (introduced)');
  });

  it('memory off: no concepts or prior; context.md still appended', async () => {
    const { s, storage, requests, generateInputs } = setup();
    storage.student.memoryEnabled = false;
    storage.memories.set('alex', {
      studentId: 'alex', concepts: [oldConcept('Old', 'A1'), oldConcept('Now', 'L1')],
      lessonSummaries: [{ lessonId: 'A1', date: '2026-10-01', summary: 's1' }],
    });
    storage.ctx.text = 'secret notes';
    await s.start('alex');
    await s.appendTranscript([seg('a', Date.now())]);
    await s.helpMe();
    const c = requests[0].context;
    expect(c.concepts.map((x) => x.name)).toEqual(['Now']);
    expect(c.priorLessonSummaries).toEqual([]);
    expect(c.priorContext).toBeUndefined();
    await s.end();
    expect(generateInputs[0].includePriorInPrompt).toBe(false);
    expect(generateInputs[0].priorContext).toBeUndefined();
    expect(storage.ctx.text).toContain('no subject');
    storage.student.memoryEnabled = true;
  });

  it('helpMe without lesson returns error result', async () => {
    const { s } = setup();
    const r = await s.helpMe();
    expect(r.ok).toBe(false);
  });

  it('finishes an interrupted lesson', async () => {
    const { s, storage } = setup();
    await s.start('alex', 'Math');
    await s.appendTranscript([seg('a', Date.parse('2026-11-05T10:30:00Z'))]);
    const saved: string[] = [];
    storage.saveReport = async (_s, l) => { saved.push(l); return `/mem/${l}/report.md`; };
    const { s: fresh } = setup();
    // fresh session sharing the same storage
    const s2 = new LessonSession({
      storage, helpMe: { ask: async () => { throw new Error('x'); } }, reports: { generate: async () => report, renderMarkdown: () => '# report' },
      screen: new NoopScreenCapture(), windowSegments: () => [], hasApiKey: () => true,
    });
    void fresh;
    expect(storage.lessons.get('L1')!.endedAt).toBeUndefined();
    const p = await s2.finishInterrupted('alex', 'L1');
    expect(p).toBe('/mem/L1/report.md');
    expect(saved).toEqual(['L1']);
    expect(storage.lessons.get('L1')!.endedAt).toBe('2026-11-05T10:30:00.000Z');
    expect(s2.getState().status).toBe('idle');
  });
});
