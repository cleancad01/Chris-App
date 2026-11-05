import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Lesson, LessonReport, Settings, Student, StudentMemory, TranscriptSegment } from '../../shared/types';
import type { Storage } from '../../shared/interfaces';
import { DEFAULT_SETTINGS } from '../../shared/config';

const pad = (n: number) => String(n).padStart(2, '0');
const slug = (name: string) =>
  name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'student';

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

export function lessonIdFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

export function createStorage(dataDir: string): Storage {
  const sDir = (id: string) => path.join(dataDir, 'students', id);
  const lDir = (sid: string, lid: string) => path.join(sDir(sid), 'lessons', lid);
  const safe = (id: string) => {
    if (!id || id !== path.basename(id) || id === '.' || id === '..') throw new Error(`Invalid id: ${id}`);
    return id;
  };

  const storage: Storage = {
    dataDir,
    async getSettings() {
      const s = await readJson<Partial<Settings>>(path.join(dataDir, 'settings.json'));
      return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    },
    async saveSettings(s) {
      await writeJson(path.join(dataDir, 'settings.json'), s);
    },
    async listStudents() {
      let names: string[] = [];
      try { names = await fs.readdir(path.join(dataDir, 'students')); } catch { return []; }
      const all = await Promise.all(names.map((n) => readJson<Student>(path.join(sDir(n), 'student.json'))));
      return all.filter((s): s is Student => !!s).sort((a, b) => a.name.localeCompare(b.name));
    },
    async createStudent(name) {
      const base = slug(name);
      let id = base;
      for (let n = 2; await readJson(path.join(sDir(id), 'student.json')); n++) id = `${base}-${n}`;
      const student: Student = { id, name: name.trim(), createdAt: new Date().toISOString() };
      await writeJson(path.join(sDir(id), 'student.json'), student);
      return student;
    },
    getStudent(id) {
      return readJson<Student>(path.join(sDir(safe(id)), 'student.json'));
    },
    async getMemory(id) {
      const m = await readJson<StudentMemory>(path.join(sDir(safe(id)), 'concepts.json'));
      return { studentId: id, concepts: m?.concepts ?? [], lessonSummaries: m?.lessonSummaries ?? [] };
    },
    async saveMemory(m) {
      await writeJson(path.join(sDir(safe(m.studentId)), 'concepts.json'), m);
    },
    async createLesson(studentId, subject) {
      safe(studentId);
      let id = lessonIdFromDate(new Date());
      const base = id;
      for (let n = 2; await readJson(path.join(lDir(studentId, id), 'lesson.json')); n++) id = `${base}-${n}`;
      const lesson: Lesson = { id, studentId, startedAt: new Date().toISOString(), ...(subject ? { subject } : {}) };
      await storage.saveLesson(lesson);
      return lesson;
    },
    async saveLesson(l) {
      await writeJson(path.join(lDir(safe(l.studentId), safe(l.id)), 'lesson.json'), l);
    },
    getLesson(sid, lid) {
      return readJson<Lesson>(path.join(lDir(safe(sid), safe(lid)), 'lesson.json'));
    },
    async listLessons(sid) {
      let names: string[] = [];
      try { names = await fs.readdir(path.join(sDir(safe(sid)), 'lessons')); } catch { return []; }
      const all = await Promise.all(names.map((n) => readJson<Lesson>(path.join(lDir(sid, n), 'lesson.json'))));
      return all.filter((l): l is Lesson => !!l).sort((a, b) => a.id.localeCompare(b.id));
    },
    async appendTranscript(sid, lid, segments) {
      if (!segments.length) return;
      const dir = lDir(safe(sid), safe(lid));
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, 'transcript.jsonl'), segments.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
    },
    async getTranscript(sid, lid) {
      let text: string;
      try { text = await fs.readFile(path.join(lDir(safe(sid), safe(lid)), 'transcript.jsonl'), 'utf8'); } catch { return []; }
      const out: TranscriptSegment[] = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { out.push(JSON.parse(line) as TranscriptSegment); } catch { /* skip torn line */ }
      }
      return out;
    },
    async saveReport(sid, lid, markdown, report: LessonReport) {
      const dir = lDir(safe(sid), safe(lid));
      await fs.mkdir(dir, { recursive: true });
      const md = path.join(dir, 'report.md');
      await fs.writeFile(md, markdown, 'utf8');
      await writeJson(path.join(dir, 'report.json'), report);
      return md;
    },
    async saveLessonFile(sid, lid, fileName, contents) {
      const dir = lDir(safe(sid), safe(lid));
      await fs.mkdir(dir, { recursive: true });
      const p = path.join(dir, safe(fileName));
      await fs.writeFile(p, contents, 'utf8');
      return p;
    },
  };
  return storage;
}
