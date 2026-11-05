/**
 * Shared domain types for Tutor Copilot.
 * Everything crossing a process boundary (IPC, worker messages, files on disk) uses these.
 * Keep this file dependency-free: it is imported by main, preload, renderer and tests.
 */

/** Who is speaking. Mic = tutor, system (loopback) audio = student. */
export type Speaker = 'tutor' | 'student';

/** One transcribed utterance. Times are epoch milliseconds. */
export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  text: string;
  /** Wall-clock time the audio for this segment started. */
  startMs: number;
  /** Wall-clock time the audio for this segment ended. */
  endMs: number;
}

/** Raw PCM audio handed from an AudioSource to a Transcriber. Mono, 16 kHz, float32 in [-1, 1]. */
export interface AudioChunk {
  speaker: Speaker;
  samples: Float32Array;
  sampleRate: 16000;
  startMs: number;
  endMs: number;
}

export interface Student {
  id: string; // folder-safe slug, e.g. "alex-kim"
  name: string;
  createdAt: string; // ISO date-time
  notes?: string;
  /** Include memory of past lessons in Help-me and reports. Default true when undefined. */
  memoryEnabled?: boolean;
}

export type ConceptStatus = 'introduced' | 'practiced' | 'mastered' | 'struggling';

/** A concept the student has encountered. Lives in <student>/concepts.json. */
export interface Concept {
  name: string;
  description: string;
  status: ConceptStatus;
  firstLessonId: string;
  lastLessonId: string;
}

export interface LessonSummaryEntry {
  lessonId: string;
  date: string; // ISO date
  summary: string; // 1-3 sentences
}

/** Per-student long-term memory. */
export interface StudentMemory {
  studentId: string;
  concepts: Concept[];
  lessonSummaries: LessonSummaryEntry[];
}

export interface Lesson {
  id: string; // e.g. "2026-11-05T19-02-11" (folder name)
  studentId: string;
  startedAt: string; // ISO date-time
  endedAt?: string;
  subject?: string;
  /** Short running summary of the lesson so far, updated by Help-me calls. */
  runningSummary?: string;
}

export interface Screenshot {
  capturedAt: number; // epoch ms
  mimeType: 'image/jpeg' | 'image/png';
  dataBase64: string;
  width: number;
  height: number;
}

/** Context sent along with every Help-me request. Kept small to control cost. */
export interface LessonContext {
  studentName: string;
  subject?: string;
  runningSummary?: string;
  /** Concepts from this and past lessons (names + status), for the roadmap. */
  concepts: Concept[];
  /** Summaries of previous lessons with this student, most recent first, at most a handful. */
  priorLessonSummaries: LessonSummaryEntry[];
  /** Tail of the student's master context file (context.md); only set when memory is on. */
  priorContext?: string;
}

export interface HelpMeRequest {
  /** Recent transcript window (already trimmed to the configured window). */
  transcript: TranscriptSegment[];
  screenshot?: Screenshot;
  context: LessonContext;
}

export type ConnectionSource = 'this-lesson' | 'past-lesson' | 'new';

export interface ConnectionItem {
  concept: string;
  /** How the current discussion relates to that concept, one sentence. */
  relation: string;
  source: ConnectionSource;
}

export interface HelpMeResponse {
  /** Direct answer to the question just asked/discussed. Always non-empty. */
  answer: string;
  /** Short confidence note, e.g. "High - standard definition" or "Medium - audio was unclear". */
  confidence: string;
  /** 1-3 sentence overview of what is being discussed. */
  overview: string;
  /** Roadmap of connections to earlier concepts. May be empty. */
  connections: ConnectionItem[];
  /** Updated 1-3 sentence running summary of the lesson so far. */
  updatedRunningSummary: string;
  createdAt: number; // epoch ms
}

/** What the renderer gets back from a Help-me IPC call. Never blank: on failure it carries the transcript fallback. */
export type HelpMeResult =
  | { ok: true; response: HelpMeResponse }
  | { ok: false; error: string; fallbackTranscript: TranscriptSegment[] };

export interface LessonReport {
  overview: string;
  learned: string[];
  yetToLearn: string[];
  struggles: string[];
  nextSteps: string[];
  /** Full updated concept list for the student (merged with prior concepts). */
  concepts: Concept[];
  /** 1-3 sentence summary stored in StudentMemory.lessonSummaries. */
  lessonSummary: string;
}

export type TranscriberKind = 'local' | 'hosted' | 'mock';

export interface Settings {
  transcriptWindowMinutes: number; // default 5
  transcriber: TranscriberKind; // default 'local'
  whisperModel: string; // default 'Xenova/whisper-base.en'
  screenshotIntervalSec: number; // default 10
  screenshotsEnabled: boolean; // default true
  alwaysOnTop: boolean; // default true
  opacity: number; // 0.3 - 1, default 1
  dataDir?: string; // override data folder
}

export type LessonStatus = 'idle' | 'running' | 'ending';

export interface AppState {
  status: LessonStatus;
  lesson?: Lesson;
  student?: Student;
  transcriberReady: boolean;
  transcriberStatus: string; // human-readable, e.g. "Loading Whisper model (43%)"
  audioLevels: { tutor: number; student: number }; // 0..1 RMS
  hasApiKey: boolean;
}
