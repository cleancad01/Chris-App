/**
 * Module interfaces. Every implementation (real or mock) must satisfy these so the rest of the
 * app can be tested without a microphone, speakers, display or API key.
 */
import type {
  AudioChunk,
  Concept,
  HelpMeRequest,
  HelpMeResponse,
  Lesson,
  LessonReport,
  Screenshot,
  Settings,
  Speaker,
  Student,
  StudentMemory,
  TranscriptSegment,
} from './types';

// ---------------------------------------------------------------------------
// Audio capture (renderer process)
// ---------------------------------------------------------------------------

/**
 * Produces 16 kHz mono float32 chunks for one speaker.
 * Implementations: MicAudioSource (getUserMedia), LoopbackAudioSource (getDisplayMedia + Electron loopback),
 * FakeAudioSource (replays a bundled sample; used for tests and TUTOR_MOCK_AUDIO=1).
 */
export interface AudioSource {
  readonly speaker: Speaker;
  /** Start capturing. onChunk is called every few seconds with a chunk; silence may be skipped. */
  start(onChunk: (chunk: AudioChunk) => void): Promise<void>;
  stop(): Promise<void>;
  /** Current RMS level 0..1 for the level meter. */
  getLevel(): number;
}

// ---------------------------------------------------------------------------
// Transcription (renderer process; local impl runs in a Web Worker)
// ---------------------------------------------------------------------------

export interface TranscriberProgress {
  /** e.g. "Downloading model", "Ready", "Transcribing" */
  status: string;
  /** 0..100 when known */
  percent?: number;
}

export interface Transcriber {
  readonly kind: 'local' | 'hosted' | 'mock';
  /** Load models / check credentials. Must resolve before transcribe() is called. */
  init(onProgress?: (p: TranscriberProgress) => void): Promise<void>;
  /** Transcribe one chunk. Returns zero or more segments (empty text => none). Must not throw on silence. */
  transcribe(chunk: AudioChunk): Promise<TranscriptSegment[]>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Screen capture (main process)
// ---------------------------------------------------------------------------

export interface ScreenCapture {
  /** Start periodic capture. onShot fires only when the screen changed meaningfully. */
  start(intervalMs: number, onShot: (shot: Screenshot) => void): void;
  stop(): void;
  /** Most recent screenshot, if any. */
  latest(): Screenshot | undefined;
  /** Recent screenshots, newest first (at most a few). */
  recent(): Screenshot[];
}

// ---------------------------------------------------------------------------
// LLM client (main process)
// ---------------------------------------------------------------------------

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: 'image/jpeg' | 'image/png'; dataBase64: string };

export interface LlmRequest {
  model: string;
  system: string;
  /** Single user turn; content blocks (text + optional image). */
  content: LlmContentBlock[];
  maxTokens: number;
  /** Abort the request after this many ms. */
  timeoutMs: number;
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmClient {
  /** True when credentials are configured. */
  isConfigured(): boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Storage (main process). Plain JSON + Markdown files, one folder per student.
//
// <dataDir>/
//   settings.json
//   students/<studentId>/student.json
//   students/<studentId>/concepts.json          (StudentMemory)
//   students/<studentId>/lessons/<lessonId>/lesson.json
//   students/<studentId>/lessons/<lessonId>/transcript.jsonl   (one TranscriptSegment per line, appended live)
//   students/<studentId>/lessons/<lessonId>/report.md
//   students/<studentId>/lessons/<lessonId>/report.json        (LessonReport)
// ---------------------------------------------------------------------------

export interface Storage {
  readonly dataDir: string;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;

  listStudents(): Promise<Student[]>;
  createStudent(name: string): Promise<Student>;
  getStudent(studentId: string): Promise<Student | undefined>;

  getMemory(studentId: string): Promise<StudentMemory>;
  saveMemory(memory: StudentMemory): Promise<void>;

  createLesson(studentId: string, subject?: string): Promise<Lesson>;
  saveLesson(lesson: Lesson): Promise<void>;
  getLesson(studentId: string, lessonId: string): Promise<Lesson | undefined>;
  listLessons(studentId: string): Promise<Lesson[]>;

  appendTranscript(studentId: string, lessonId: string, segments: TranscriptSegment[]): Promise<void>;
  getTranscript(studentId: string, lessonId: string): Promise<TranscriptSegment[]>;

  /** Writes report.md and report.json; returns the absolute path of report.md. */
  saveReport(studentId: string, lessonId: string, markdown: string, report: LessonReport): Promise<string>;
  /** Writes a plain-text/markdown file (e.g. raw-transcript.md) next to the lesson files. Returns path. */
  saveLessonFile(studentId: string, lessonId: string, fileName: string, contents: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Services built on top of the above (main process)
// ---------------------------------------------------------------------------

export interface HelpMeService {
  /** Always resolves (never rejects). Applies timeout + one retry internally. */
  ask(req: HelpMeRequest): Promise<import('./types').HelpMeResult>;
}

export interface ReportGenerator {
  /** Produces the structured report. Falls back to a minimal report if the LLM fails. */
  generate(input: {
    lesson: Lesson;
    student: Student;
    transcript: TranscriptSegment[];
    priorMemory: StudentMemory;
  }): Promise<LessonReport>;
  /** Renders report.md (report + full transcript). Pure function. */
  renderMarkdown(input: {
    lesson: Lesson;
    student: Student;
    report: LessonReport;
    transcript: TranscriptSegment[];
  }): string;
}

/** Pure helper used by both Help-me and the UI. */
export interface TranscriptWindowing {
  /** Segments whose endMs >= nowMs - windowMinutes*60_000, in order. */
  window(segments: TranscriptSegment[], windowMinutes: number, nowMs: number): TranscriptSegment[];
  /** "[19:02:11] Tutor: ..." lines. */
  format(segments: TranscriptSegment[]): string;
}

/** Merge helper for concept memory. */
export type MergeConcepts = (existing: Concept[], incoming: Concept[], lessonId: string) => Concept[];

export type { HelpMeResponse };
