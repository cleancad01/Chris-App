import type {
  HelpMeService, ReportGenerator, ScreenCapture, Storage,
} from '../shared/interfaces';
import type {
  AppState, Concept, HelpMeResult, LessonSummaryEntry, Lesson, Settings, Student, StudentMemory, TranscriptSegment,
} from '../shared/types';

export interface SessionDeps {
  storage: Storage;
  helpMe: HelpMeService;
  reports: ReportGenerator;
  screen: ScreenCapture;
  windowSegments: (segments: TranscriptSegment[], windowMinutes: number, nowMs: number) => TranscriptSegment[];
  hasApiKey: () => boolean;
  now?: () => number;
}

const MAX_CONCEPTS = 30;
const MAX_CONTEXT_CHARS = 1500;

/** Last maxChars of text, cut at a line boundary, prefixed with "..." when cut. */
function tailAtLine(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  let tail = t.slice(t.length - maxChars);
  const nl = tail.indexOf('\n');
  tail = nl >= 0 ? tail.slice(nl + 1) : tail;
  return `...\n${tail}`;
}

export class LessonSession {
  private status: AppState['status'] = 'idle';
  private lesson?: Lesson;
  private student?: Student;
  private transcript: TranscriptSegment[] = [];
  private levels = { tutor: 0, student: 0 };
  private transcriberReady = false;
  private transcriberStatus = 'Idle';
  private listeners: Array<(s: AppState) => void> = [];

  constructor(private deps: SessionDeps) {}

  onChange(fn: (s: AppState) => void): void { this.listeners.push(fn); }

  getState(): AppState {
    return {
      status: this.status,
      lesson: this.lesson,
      student: this.student,
      transcriberReady: this.transcriberReady,
      transcriberStatus: this.transcriberStatus,
      audioLevels: { ...this.levels },
      hasApiKey: this.deps.hasApiKey(),
    };
  }

  private emit(): void {
    const s = this.getState();
    for (const l of this.listeners) l(s);
  }

  getTranscript(): TranscriptSegment[] { return [...this.transcript]; }

  setLevels(l: { tutor: number; student: number }): void { this.levels = l; this.emit(); }

  setTranscriberStatus(ready: boolean, status: string): void {
    this.transcriberReady = ready;
    this.transcriberStatus = status;
    this.emit();
  }

  async start(studentId: string, subject?: string): Promise<Lesson> {
    if (this.status !== 'idle') throw new Error('A lesson is already in progress');
    const student = await this.deps.storage.getStudent(studentId);
    if (!student) throw new Error(`Unknown student: ${studentId}`);
    const lesson = await this.deps.storage.createLesson(studentId, subject || undefined);
    this.student = student;
    this.lesson = lesson;
    this.transcript = [];
    this.status = 'running';
    this.emit();
    return lesson;
  }

  async appendTranscript(segments: TranscriptSegment[]): Promise<void> {
    if (!this.lesson || !this.student || segments.length === 0) return;
    this.transcript.push(...segments);
    await this.deps.storage.appendTranscript(this.student.id, this.lesson.id, segments);
  }

  async helpMe(windowMinutes?: number, question?: string, onDelta?: (partialAnswer: string) => void): Promise<HelpMeResult> {
    if (!this.lesson || !this.student) {
      return { ok: false, error: 'No lesson in progress', fallbackTranscript: [] };
    }
    const settings: Settings = await this.deps.storage.getSettings();
    const now = (this.deps.now ?? Date.now)();
    const windowed = this.deps.windowSegments(this.transcript, windowMinutes ?? settings.transcriptWindowMinutes, now);
    const memory: StudentMemory = await this.deps.storage.getMemory(this.student.id);
    const memoryOn = this.student.memoryEnabled !== false;
    let concepts: Concept[];
    let priorLessonSummaries: LessonSummaryEntry[] = [];
    let priorContext: string | undefined;
    if (memoryOn) {
      concepts = [...memory.concepts].sort((a, b) => b.lastLessonId.localeCompare(a.lastLessonId)).slice(0, MAX_CONCEPTS);
      priorLessonSummaries = memory.lessonSummaries.slice(-3).reverse();
      priorContext = tailAtLine(await this.deps.storage.getStudentContext(this.student.id), MAX_CONTEXT_CHARS) || undefined;
    } else {
      concepts = memory.concepts.filter((c) => c.lastLessonId === this.lesson!.id);
    }
    const result = await this.deps.helpMe.ask({
      transcript: windowed,
      screenshot: this.deps.screen.latest(),
      ...(question?.trim() ? { question: question.trim() } : {}),
      context: {
        studentName: this.student.name,
        subject: this.lesson.subject,
        runningSummary: this.lesson.runningSummary,
        concepts,
        priorLessonSummaries,
        ...(priorContext ? { priorContext } : {}),
      },
    }, onDelta);
    if (result.ok && result.response.updatedRunningSummary?.trim()) {
      this.lesson = { ...this.lesson, runningSummary: result.response.updatedRunningSummary };
      await this.deps.storage.saveLesson(this.lesson);
    }
    return result;
  }

  async end(): Promise<{ reportPath: string; lesson: Lesson }> {
    if (this.status !== 'running' || !this.lesson || !this.student) throw new Error('No lesson in progress');
    this.status = 'ending';
    this.emit();
    try {
      const r = await this.completeLesson(this.student, this.lesson, this.transcript);
      this.deps.screen.stop();
      this.lesson = undefined;
      this.student = undefined;
      this.transcript = [];
      this.transcriberReady = false;
      this.transcriberStatus = 'Idle';
      this.status = 'idle';
      this.emit();
      return r;
    } catch (e) {
      this.status = 'running';
      this.emit();
      throw e;
    }
  }

  private async completeLesson(student: Student, lesson0: Lesson, transcript: TranscriptSegment[], endedAt?: string): Promise<{ reportPath: string; lesson: Lesson }> {
    const { storage, reports } = this.deps;
    let lesson = lesson0;
    const priorMemory = await storage.getMemory(student.id);
    const memoryOn = student.memoryEnabled !== false;
    const priorContext = memoryOn ? tailAtLine(await storage.getStudentContext(student.id), MAX_CONTEXT_CHARS) || undefined : undefined;
    const report = await reports.generate({
      lesson, student, transcript, priorMemory,
      includePriorInPrompt: memoryOn,
      ...(priorContext ? { priorContext } : {}),
    });
    lesson = { ...lesson, endedAt: endedAt ?? new Date((this.deps.now ?? Date.now)()).toISOString() };
    const md = reports.renderMarkdown({ lesson, student, report, transcript });
    const reportPath = await storage.saveReport(student.id, lesson.id, md, report);
    await storage.saveMemory({
      studentId: student.id,
      concepts: report.concepts,
      lessonSummaries: [
        ...priorMemory.lessonSummaries,
        { lessonId: lesson.id, date: lesson.endedAt!.slice(0, 10), summary: report.lessonSummary },
      ],
    });
    await storage.saveLesson(lesson);
    // Memory is always recorded; the toggle only controls whether it is read.
    const d = new Date(lesson.startedAt);
    const pad = (n: number): string => String(n).padStart(2, '0');
    const localDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const keys = report.concepts.filter((c) => c.lastLessonId === lesson.id).map((c) => `${c.name} (${c.status})`).slice(0, 10).join(', ') || 'none';
    await storage.appendStudentContext(student.id, `## ${localDate} - ${lesson.subject ?? 'no subject'}\n${report.lessonSummary}\nKey concepts: ${keys}\n`);
    return { reportPath, lesson };
  }

  async finishInterrupted(studentId: string, lessonId: string): Promise<string> {
    if (this.status !== 'idle') throw new Error('Cannot finish a lesson while another is active');
    const { storage } = this.deps;
    const lesson = await storage.getLesson(studentId, lessonId);
    const student = await storage.getStudent(studentId);
    if (!lesson || !student) throw new Error('Lesson not found');
    const transcript = await storage.getTranscript(studentId, lessonId);
    const lastEnd = transcript.length ? transcript[transcript.length - 1].endMs : 0;
    const endedAt = lesson.endedAt ?? new Date(lastEnd > Date.parse(lesson.startedAt) ? lastEnd : (this.deps.now ?? Date.now)()).toISOString();
    this.status = 'ending';
    this.emit();
    try {
      return (await this.completeLesson(student, lesson, transcript, endedAt)).reportPath;
    } finally {
      this.status = 'idle';
      this.emit();
    }
  }
}
