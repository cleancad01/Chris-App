/**
 * IPC contract between renderer (via preload) and main.
 * Renderer calls `invoke` channels and gets a Promise; main pushes `event` channels.
 */
import type {
  AppState,
  HelpMeResult,
  Lesson,
  Screenshot,
  Settings,
  Student,
  TranscriptSegment,
} from './types';

/** invoke(channel, arg) -> Promise<result> */
export interface IpcInvoke {
  'app:getState': { arg: void; result: AppState };
  'settings:get': { arg: void; result: Settings };
  'settings:set': { arg: Partial<Settings>; result: Settings };
  'students:list': { arg: void; result: Student[] };
  'students:update': { arg: { studentId: string; memoryEnabled: boolean }; result: Student };
  'students:create': { arg: { name: string }; result: Student };
  /** Starts a lesson (after the consent dialog was accepted in the renderer). */
  'lesson:start': { arg: { studentId: string; subject?: string }; result: Lesson };
  /** Ends the lesson, generates the report, returns the path to report.md. */
  'lesson:end': { arg: void; result: { reportPath: string; lesson: Lesson } };
  /** Renderer pushes newly transcribed segments; main appends them to transcript.jsonl. */
  'transcript:append': { arg: TranscriptSegment[]; result: void };
  'transcript:get': { arg: void; result: TranscriptSegment[] };
  /** Help-me. Main gathers transcript window + latest screenshot + context itself. */
  'helpme:ask': { arg: { windowMinutes?: number }; result: HelpMeResult };
  'screenshot:latest': { arg: void; result: Screenshot | undefined };
  'audio:levels': { arg: { tutor: number; student: number }; result: void };
  'transcriber:status': { arg: { ready: boolean; status: string }; result: void };
  'window:setOpacity': { arg: number; result: void };
  'window:setAlwaysOnTop': { arg: boolean; result: void };
  'window:setSize': { arg: { width: number; height: number }; result: void };
  'shell:openPath': { arg: string; result: void };
}

/** main -> renderer events */
export interface IpcEvents {
  'state:changed': AppState;
  'screenshot:updated': { capturedAt: number; width: number; height: number };
  /** Global F9 shortcut pressed (works while another app has focus). */
  'helpme:trigger': void;
  /** Partial Help-me answer text while streaming. */
  'helpme:partial': string;
}

export type IpcInvokeChannel = keyof IpcInvoke;
export type IpcEventChannel = keyof IpcEvents;

/** The API exposed on window.api by the preload script. */
export interface RendererApi {
  invoke<C extends IpcInvokeChannel>(channel: C, arg: IpcInvoke[C]['arg']): Promise<IpcInvoke[C]['result']>;
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEvents[C]) => void): () => void;
  /** Environment flags the renderer needs at startup. */
  env: {
    mockAudio: boolean;
    transcriber: 'local' | 'hosted' | 'mock';
    whisperModel: string;
    /** OpenAI key for the hosted transcriber (local desktop app; renderer loads only local files). */
    hostedApiKey?: string;
  };
}

declare global {
  interface Window {
    api: RendererApi;
  }
}
