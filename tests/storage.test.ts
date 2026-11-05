import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/main/services/storage';
import { DEFAULT_SETTINGS } from '../src/shared/config';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(os.tmpdir(), 'tc-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('storage', () => {
  it('students: slug and collision', async () => {
    const st = createStorage(dir);
    expect(await st.listStudents()).toEqual([]);
    const a = await st.createStudent('Alex Kim');
    const b = await st.createStudent('Alex Kim');
    expect(a.id).toBe('alex-kim');
    expect(b.id).toBe('alex-kim-2');
    expect((await st.getStudent('alex-kim'))?.name).toBe('Alex Kim');
    expect(await st.listStudents()).toHaveLength(2);
    expect(await st.getStudent('nobody')).toBeUndefined();
  });
  it('lessons and transcript', async () => {
    const st = createStorage(dir);
    const s = await st.createStudent('Sam');
    const l = await st.createLesson(s.id, 'Math');
    expect(l.id).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d/);
    expect(await st.getTranscript(s.id, l.id)).toEqual([]);
    const seg = (id: string) => ({ id, speaker: 'tutor' as const, text: id, startMs: 1, endMs: 2 });
    await st.appendTranscript(s.id, l.id, [seg('a'), seg('b')]);
    await st.appendTranscript(s.id, l.id, [seg('c')]);
    expect((await st.getTranscript(s.id, l.id)).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    await st.saveLesson({ ...l, endedAt: 'x' });
    expect((await st.getLesson(s.id, l.id))?.endedAt).toBe('x');
    expect(await st.listLessons(s.id)).toHaveLength(1);
  });
  it('memory roundtrip and empty default', async () => {
    const st = createStorage(dir);
    const s = await st.createStudent('Mem');
    expect(await st.getMemory(s.id)).toEqual({ studentId: s.id, concepts: [], lessonSummaries: [] });
    const m = { studentId: s.id, concepts: [{ name: 'A', description: '', status: 'introduced' as const, firstLessonId: 'l', lastLessonId: 'l' }], lessonSummaries: [] };
    await st.saveMemory(m);
    expect(await st.getMemory(s.id)).toEqual(m);
  });
  it('saveStudent and context append/get', async () => {
    const st = createStorage(dir);
    const s = await st.createStudent('Ctx Kid');
    await st.saveStudent({ ...s, memoryEnabled: false });
    expect((await st.getStudent(s.id))!.memoryEnabled).toBe(false);
    expect(await st.getStudentContext(s.id)).toBe('');
    await st.appendStudentContext(s.id, '## d1\nOne\n');
    await st.appendStudentContext(s.id, '## d2\nTwo\n');
    const txt = await st.getStudentContext(s.id);
    expect(txt.startsWith('# Context for Ctx Kid\n')).toBe(true);
    expect(txt.indexOf('## d1')).toBeLessThan(txt.indexOf('## d2'));
    expect(txt.match(/# Context for/g)).toHaveLength(1);
  });

  it('saveReport and lesson files', async () => {
    const st = createStorage(dir);
    const s = await st.createStudent('Rep');
    const l = await st.createLesson(s.id);
    const p = await st.saveReport(s.id, l.id, '# hi', { overview: 'o', learned: [], yetToLearn: [], struggles: [], nextSteps: [], concepts: [], lessonSummary: '' });
    expect(existsSync(p)).toBe(true);
    expect(existsSync(path.join(path.dirname(p), 'report.json'))).toBe(true);
    expect(existsSync(await st.saveLessonFile(s.id, l.id, 'raw-transcript.md', 'x'))).toBe(true);
  });
  it('settings merged with defaults', async () => {
    const st = createStorage(dir);
    expect(await st.getSettings()).toEqual(DEFAULT_SETTINGS);
    await st.saveSettings({ ...DEFAULT_SETTINGS, opacity: 0.5 });
    expect((await st.getSettings()).opacity).toBe(0.5);
  });
});
