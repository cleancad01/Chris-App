import type {
  HelpMeService, ReportGenerator, ScreenCapture, Storage,
} from '../shared/interfaces';
import type {
  AppState, HelpMeResult, Lesson, Settings, Student, StudentMemory, TranscriptSegment,
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

  async helpMe(windowMinutes?: number): Promise<HelpMeResult> {
    if (!this.lesson || !this.student) {
      return { ok: false, error: 'No lesson in progress', fallbackTranscript: [] };
    }
    const settings: Settings = await this.deps.storage.getSettings();
    const now = (this.deps.now ?? Date.now)();
    const windowed = this.deps.windowSegments(this.transcript, windowMinutes ?? settings.transcriptWindowMinutes, now);
    const memory: StudentMemory = await this.deps.storage.getMemory(this.student.id);
    const result = await this.deps.helpMe.ask({
      transcript: windowed,
      screenshot: this.deps.screen.latest(),
      context: {
        studentName: this.student.name,
        subject: this.lesson.subject,
        runningSummary: this.lesson.runningSummary,
        concepts: memory.concepts,
        priorLessonSummaries: memory.lessonSummaries.slice(-3).reverse(),
      },
    });
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
      const { storage, reports } = this.deps;
      const student = this.student;
      let lesson = this.lesson;
      const priorMemory = await storage.getMemory(student.id);
      const report = await reports.generate({ lesson, student, transcript: this.transcript, priorMemory });
      lesson = { ...lesson, endedAt: new Date((this.deps.now ?? Date.now)()).toISOString() };
      const md = reports.renderMarkdown({ lesson, student, report, transcript: this.transcript });
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
      this.deps.screen.stop();
      this.lesson = undefined;
      this.student = undefined;
      this.transcript = [];
      this.transcriberReady = false;
      this.transcriberStatus = 'Idle';
      this.status = 'idle';
      this.emit();
      return { reportPath, lesson };
    } catch (e) {
      this.status = 'running';
      this.emit();
      throw e;
    }
  }
}
