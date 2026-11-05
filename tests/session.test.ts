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
  const s: Storage & { lessons: typeof lessons; transcripts: typeof transcripts; memories: typeof memories } = {
    dataDir: '/mem', lessons, transcripts, memories,
    getSettings: async () => settings,
    saveSettings: async (x) => { settings = x; },
    listStudents: async () => [student],
    createStudent: async (name) => ({ ...student, name }),
    getStudent: async (id) => (id === 'alex' ? student : undefined),
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
  const reports: ReportGenerator = {
    generate: async () => report,
    renderMarkdown: () => '# report',
  };
  const s = new LessonSession({
    storage, helpMe, reports, screen: new NoopScreenCapture(),
    windowSegments: (segs, min, now) => segs.filter((x) => x.endMs >= now - min * 60_000),
    hasApiKey: () => true,
  });
  return { s, storage, requests };
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

  it('helpMe without lesson returns error result', async () => {
    const { s } = setup();
    const r = await s.helpMe();
    expect(r.ok).toBe(false);
  });
});
